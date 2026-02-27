import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { prisma } from '../lib/prisma';
import { dispatch } from '../resolvers/resolver';

const BACKEND_URL = (process.env.AUDIO_QUEUE_BACKEND_URL ?? 'https://audio-queue-production.up.railway.app').replace(/\/$/, '');

function isGooglevideo(url: string): boolean {
  return url.includes('googlevideo.com');
}

function isExpiredYouTubeURL(url: string): boolean {
  const match = url.match(/[?&]expire=(\d+)/);
  if (!match) return false;
  const expiry = parseInt(match[1], 10);
  return Date.now() / 1000 > expiry - 300; // expire 5 min early as buffer
}

const router = Router();

// GET /api/queue — fetch user's items ordered by position
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const items = await prisma.queueItem.findMany({
    where: { userId: req.userId! },
    orderBy: { position: 'asc' },
  });
  // Replace IP-locked googlevideo URLs with our proxy endpoint
  const transformed = items.map(item => ({
    ...item,
    audioURL: item.audioURL && isGooglevideo(item.audioURL)
      ? `${BACKEND_URL}/api/queue/${item.id}/stream`
      : item.audioURL,
  }));
  res.json(transformed);
});

// POST /api/queue — insert pending item, fire-and-forget resolve
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };
  if (!url) {
    res.status(400).json({ error: 'url required' });
    return;
  }

  // Determine next position
  const last = await prisma.queueItem.findFirst({
    where: { userId: req.userId! },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const position = (last?.position ?? -1) + 1;

  const item = await prisma.queueItem.create({
    data: {
      userId: req.userId!,
      originalURL: url,
      title: url,
      position,
      resolveStatus: 'pending',
    },
  });

  // Fire-and-forget resolution
  resolveInBackground(item.id, url);

  res.status(201).json(item);
});

// DELETE /api/queue/:id
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const item = await prisma.queueItem.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.queueItem.delete({ where: { id } });
  res.status(204).send();
});

// PATCH /api/queue/reorder — bulk position update
router.patch('/reorder', async (req: Request, res: Response): Promise<void> => {
  const { order } = req.body as { order?: Array<{ id: string; position: number }> };
  if (!Array.isArray(order)) {
    res.status(400).json({ error: 'order array required' });
    return;
  }

  await prisma.$transaction(
    order.map(({ id, position }) =>
      prisma.queueItem.updateMany({
        where: { id, userId: req.userId! },
        data: { position },
      })
    )
  );

  res.json({ ok: true });
});

// PATCH /api/queue/:id — update isListened
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { isListened } = req.body as { isListened?: boolean };

  const item = await prisma.queueItem.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const updated = await prisma.queueItem.update({
    where: { id },
    data: { isListened: isListened ?? item.isListened },
  });
  res.json(updated);
});

// Background resolution helper
async function resolveInBackground(itemId: string, url: string): Promise<void> {
  try {
    const resolved = await dispatch(url);
    await prisma.queueItem.update({
      where: { id: itemId },
      data: {
        title: resolved.title || url,
        sourceType: resolved.sourceType,
        audioURL: resolved.audioURL ?? null,
        durationSeconds: resolved.durationSeconds ?? null,
        thumbnailURL: resolved.thumbnailURL ?? null,
        publisher: resolved.publisher ?? null,
        resolveStatus: resolved.audioURL ? 'resolved' : 'failed',
        resolveError: resolved.audioURL ? null : 'No audio stream found',
      },
    });
  } catch (err) {
    console.error(`Resolution failed for ${itemId}:`, err);
    await prisma.queueItem.update({
      where: { id: itemId },
      data: {
        resolveStatus: 'failed',
        resolveError: (err as Error).message,
      },
    }).catch(() => {});
  }
}

// ─── Public stream proxy (registered in index.ts, no auth required) ──────────
// Item IDs are cuids (25 random chars) — unguessable without the authenticated
// GET /api/queue response, so ownership check is unnecessary here.
export async function handleQueueStream(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const item = await prisma.queueItem.findUnique({
    where: { id },
    select: { id: true, audioURL: true, originalURL: true },
  });

  if (!item?.audioURL) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  let audioURL = item.audioURL;

  // Re-resolve if the stored YouTube URL has expired
  if (isGooglevideo(audioURL) && isExpiredYouTubeURL(audioURL)) {
    console.log(`Stream: re-resolving expired URL for item ${id}`);
    try {
      const resolved = await dispatch(item.originalURL);
      if (resolved.audioURL) {
        audioURL = resolved.audioURL;
        await prisma.queueItem.update({ where: { id }, data: { audioURL } });
      }
    } catch (err) {
      console.error('Stream: re-resolve failed:', err);
      res.status(502).json({ error: 'Could not refresh stream URL' });
      return;
    }
  }

  // Re-mux via ffmpeg → fragmented MP4 with empty_moov at start.
  // This guarantees AVPlayer can parse the container immediately without
  // needing to seek to the end for the moov atom.
  console.log(`Stream ${id}: starting ffmpeg for ${audioURL.slice(0, 60)}…`);

  res.setHeader('Content-Type', 'audio/mp4');

  const ffmpeg = spawn('ffmpeg', [
    '-i', audioURL,
    '-vn',                    // drop video
    '-c:a', 'copy',           // copy AAC — no re-encode, fast
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',                 // write to stdout
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Kill ffmpeg if client disconnects
  req.on('close', () => ffmpeg.kill('SIGKILL'));

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    // ffmpeg writes normal progress to stderr; only log errors
    if (/error|failed|invalid/i.test(line)) {
      console.error(`Stream ${id} ffmpeg: ${line}`);
    }
  });

  ffmpeg.on('error', (err: Error) => {
    console.error(`Stream ${id} ffmpeg spawn error:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
  });

  ffmpeg.on('close', (code: number | null) => {
    console.log(`Stream ${id}: ffmpeg exited code=${code}`);
    if (!res.writableEnded) res.end();
  });

  ffmpeg.stdout.pipe(res);
}

export { resolveInBackground };
export default router;
