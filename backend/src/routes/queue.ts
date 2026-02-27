import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { dispatch } from '../resolvers/resolver';

const router = Router();

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
    // 'youtube' items intentionally have no audioURL (opens in YouTube app) — mark resolved not failed
    const isExternal = resolved.sourceType === 'youtube' && !resolved.audioURL;
    // updateMany is a no-op when the item was deleted before resolution finished
    await prisma.queueItem.updateMany({
      where: { id: itemId },
      data: {
        title: resolved.title || url,
        sourceType: resolved.sourceType,
        audioURL: resolved.audioURL ?? null,
        durationSeconds: resolved.durationSeconds ?? null,
        thumbnailURL: resolved.thumbnailURL ?? null,
        publisher: resolved.publisher ?? null,
        resolveStatus: resolved.audioURL || isExternal ? 'resolved' : 'failed',
        resolveError: resolved.audioURL || isExternal ? null : 'No audio stream found',
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
