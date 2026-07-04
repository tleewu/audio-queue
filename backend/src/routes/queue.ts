import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { dispatch } from '../resolvers/resolver';
import { assertPublicHttpUrl } from '../utils/urlGuard';

const router = Router();

const MAX_QUEUE_ITEMS = 500;

// GET /api/queue — fetch user's items ordered by position
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const items = await prisma.queueItem.findMany({
    where: { userId: req.userId! },
    orderBy: { position: 'asc' },
  });
  res.json(items);
});

// POST /api/queue — insert pending item, fire-and-forget resolve
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string' || url.length > 2048) {
    res.status(400).json({ error: 'url required' });
    return;
  }

  try {
    await assertPublicHttpUrl(url.trim());
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const count = await prisma.queueItem.count({ where: { userId: req.userId! } });
  if (count >= MAX_QUEUE_ITEMS) {
    res.status(400).json({ error: `Queue limit of ${MAX_QUEUE_ITEMS} items reached` });
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
      originalURL: url.trim(),
      title: url.trim(),
      position,
      resolveStatus: 'pending',
    },
  });

  resolveInBackground(item.id, url.trim());
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
  const { order } = req.body as { order?: Array<{ id: string; position: number | string }> };
  if (!Array.isArray(order) || order.length > 1000) {
    res.status(400).json({ error: 'order array required' });
    return;
  }

  // Older clients send position as a string — coerce and validate
  const updates: Array<{ id: string; position: number }> = [];
  for (const entry of order) {
    const position = Number(entry?.position);
    if (typeof entry?.id !== 'string' || !Number.isInteger(position)) {
      res.status(400).json({ error: 'order entries must be {id, position}' });
      return;
    }
    updates.push({ id: entry.id, position });
  }

  await prisma.$transaction(
    updates.map(({ id, position }) =>
      prisma.queueItem.updateMany({
        where: { id, userId: req.userId! },
        data: { position },
      })
    )
  );
  res.json({ ok: true });
});

// PATCH /api/queue/:id — update isListened and/or playbackPositionSeconds
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { isListened, playbackPositionSeconds } = req.body as {
    isListened?: boolean;
    playbackPositionSeconds?: number;
  };

  const data: { isListened?: boolean; playbackPositionSeconds?: number } = {};
  if (typeof isListened === 'boolean') {
    data.isListened = isListened;
  }
  if (playbackPositionSeconds !== undefined) {
    const secs = Number(playbackPositionSeconds);
    if (!Number.isFinite(secs) || secs < 0) {
      res.status(400).json({ error: 'playbackPositionSeconds must be a non-negative number' });
      return;
    }
    data.playbackPositionSeconds = Math.floor(secs);
  }

  const item = await prisma.queueItem.findFirst({
    where: { id, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const updated = await prisma.queueItem.update({
    where: { id },
    data,
  });
  res.json(updated);
});

// Background resolution helper
async function resolveInBackground(itemId: string, url: string): Promise<void> {
  try {
    const resolved = await dispatch(url);
    // 'external' items intentionally have no audioURL (open in the source app) —
    // resolved as long as we know where to send the user; only 'unsupported' fails.
    const isExternal = resolved.playbackType === 'external' && resolved.sourceType !== 'unsupported';
    const ok = !!resolved.audioURL || isExternal;
    // updateMany is a no-op when the item was deleted before resolution finished
    await prisma.queueItem.updateMany({
      where: { id: itemId },
      data: {
        title: resolved.title || url,
        sourceType: resolved.sourceType,
        playbackType: resolved.playbackType,
        audioURL: resolved.audioURL ?? null,
        durationSeconds: resolved.durationSeconds ?? null,
        thumbnailURL: resolved.thumbnailURL ?? null,
        publisher: resolved.publisher ?? null,
        resolveStatus: ok ? 'resolved' : 'failed',
        resolveError: ok ? null : 'No audio stream found',
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

export { resolveInBackground };
export default router;
