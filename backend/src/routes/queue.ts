import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import { prisma } from '../lib/prisma';
import { dispatch } from '../resolvers/resolver';
import { execYtDlp, hasYouTubeCookies } from '../utils/ytdlp';
import { extractYouTubeId, resolveViaPiped } from '../resolvers/pipedResolver';

const BACKEND_URL = (process.env.AUDIO_QUEUE_BACKEND_URL ?? 'https://audio-queue-production.up.railway.app').replace(/\/$/, '');

// ─── Stream URL cache ─────────────────────────────────────────────────────────
// Cache resolved URLs to avoid hitting yt-dlp/Piped on every request.
// YouTube CDN URLs embed ?expire= and are IP-locked to Railway's IP — fine
// since ffmpeg also runs on Railway. Piped URLs use a fixed 4h TTL.
const streamUrlCache = new Map<string, { url: string; expiresAt: number }>();
const DEFAULT_CACHE_TTL_SECONDS = 4 * 3600;

function urlExpiresAt(url: string): number {
  const m = url.match(/[?&]expire=(\d+)/);
  return m
    ? parseInt(m[1], 10) - 300                                // 5 min before YouTube CDN expiry
    : Math.floor(Date.now() / 1000) + DEFAULT_CACHE_TTL_SECONDS;
}

async function getStreamUrl(itemId: string, originalURL: string): Promise<string> {
  const cached = streamUrlCache.get(itemId);
  if (cached && Date.now() / 1000 < cached.expiresAt) {
    console.log(`Stream ${itemId}: using cached URL`);
    return cached.url;
  }

  if (extractYouTubeId(originalURL)) {
    let audioUrl: string;

    if (hasYouTubeCookies()) {
      // yt-dlp with cookies → IP-locked CDN URL, but ffmpeg runs on same Railway IP
      console.log(`Stream ${itemId}: resolving via yt-dlp (cookies)`);
      const info = await execYtDlp(originalURL);
      audioUrl = info.url;
    } else {
      // No cookies → fall back to Piped/Invidious proxied URL
      console.log(`Stream ${itemId}: resolving via Piped`);
      const resolved = await resolveViaPiped(originalURL);
      audioUrl = resolved.audioURL!;
    }

    streamUrlCache.set(itemId, { url: audioUrl, expiresAt: urlExpiresAt(audioUrl) });
    return audioUrl;
  }

  // Non-YouTube: stored audioURL from DB (yt-dlp/RSS resolved at add-time)
  const item = await prisma.queueItem.findUnique({
    where: { id: itemId },
    select: { audioURL: true },
  });
  if (!item?.audioURL) throw new Error(`No audioURL stored for item ${itemId}`);
  return item.audioURL;
}

const router = Router();

// GET /api/queue — fetch user's items ordered by position
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const items = await prisma.queueItem.findMany({
    where: { userId: req.userId! },
    orderBy: { position: 'asc' },
  });
  // YouTube CDN URLs are IP-locked; route through the stream proxy instead
  const transformed = items.map(item => ({
    ...item,
    audioURL: item.sourceType === 'youtube' && item.audioURL
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
    // updateMany is a no-op (not an error) when the item was deleted before resolution finished
    await prisma.queueItem.updateMany({
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
    await prisma.queueItem.updateMany({
      where: { id: itemId },
      data: {
        resolveStatus: 'failed',
        resolveError: (err as Error).message,
      },
    }).catch(() => {});
  }
}

// ─── Public stream proxy (registered in index.ts, no auth required) ──────────
// Item IDs are cuids — unguessable without the authenticated GET /api/queue.
// Flow: getStreamUrl (Piped for YouTube, cached) → ffmpeg (re-mux to fMP4) → iOS AVPlayer.
export async function handleQueueStream(req: Request, res: Response): Promise<void> {
  const { id } = req.params;
  const item = await prisma.queueItem.findUnique({
    where: { id },
    select: { originalURL: true },
  });

  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  let streamUrl: string;
  try {
    streamUrl = await getStreamUrl(id, item.originalURL);
  } catch (err) {
    console.error(`Stream ${id}: URL resolution failed:`, err);
    res.status(502).json({ error: 'Could not resolve stream URL' });
    return;
  }

  console.log(`Stream ${id}: ffmpeg from Piped/source URL`);
  res.setHeader('Content-Type', 'audio/mp4');

  // Re-mux to fragmented MP4: puts empty_moov at the very start so AVPlayer
  // can parse codec info immediately without scanning the entire file.
  const ffmpeg = spawn('ffmpeg', [
    '-i', streamUrl,
    '-vn',
    '-c:a', 'copy',      // no re-encoding — just container swap
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
    '-f', 'mp4',
    'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  req.on('close', () => ffmpeg.kill('SIGKILL'));

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (/error|failed|invalid/i.test(line)) {
      console.error(`Stream ${id} ffmpeg: ${line}`);
    }
  });

  ffmpeg.on('error', (err: Error) => {
    console.error(`Stream ${id} ffmpeg spawn error:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'Stream failed' });
  });

  ffmpeg.on('close', (code: number | null) => {
    console.log(`Stream ${id}: done (ffmpeg code=${code})`);
    if (!res.writableEnded) res.end();
  });

  ffmpeg.stdout.pipe(res);
}

export { resolveInBackground };
export default router;
