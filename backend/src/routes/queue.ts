import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { resolve, ResolvedItem } from '../resolvers/podcast';
import { assertPublicHttpUrl } from '../utils/urlGuard';

const router = Router();

const MAX_QUEUE_ITEMS = 500;

// GET /api/queue — the user's items in queue order
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const items = await prisma.queueItem.findMany({
    where: { userId: req.userId! },
    orderBy: { position: 'asc' },
  });
  res.json(items);
});

// POST /api/queue — resolve the link, then save it
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { url } = req.body as { url?: string };
  if (!url || typeof url !== 'string' || url.length > 2048) {
    res.status(400).json({ error: 'url required' });
    return;
  }
  const trimmed = url.trim();

  try {
    await assertPublicHttpUrl(trimmed);
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

  // Resolution never throws away the link: anything that isn't a podcast
  // episode is saved as a web item and opened in a web view.
  const resolved: ResolvedItem = await resolve(trimmed).catch((err: unknown) => {
    console.error(`Resolution failed for ${trimmed}:`, (err as Error).message);
    return { title: trimmed };
  });

  const item = await prisma.queueItem.create({
    data: {
      userId: req.userId!,
      originalURL: trimmed,
      title: resolved.title || trimmed,
      publisher: resolved.publisher ?? null,
      audioURL: resolved.audioURL ?? null,
      durationSeconds: resolved.durationSeconds ?? null,
      position: (last?.position ?? -1) + 1,
    },
  });

  res.status(201).json(item);
});

// PATCH /api/queue/reorder — bulk position update
router.patch('/reorder', async (req: Request, res: Response): Promise<void> => {
  const { order } = req.body as { order?: Array<{ id: string; position: number }> };
  if (!Array.isArray(order) || order.length > 1000) {
    res.status(400).json({ error: 'order array required' });
    return;
  }

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

// PATCH /api/queue/:id — archive / unarchive
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const { isListened } = req.body as { isListened?: boolean };
  const item = await prisma.queueItem.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const updated = await prisma.queueItem.update({
    where: { id: item.id },
    data: { isListened: isListened ?? item.isListened },
  });
  res.json(updated);
});

// DELETE /api/queue/:id
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const item = await prisma.queueItem.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });
  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await prisma.queueItem.delete({ where: { id: item.id } });
  res.status(204).send();
});

export default router;
