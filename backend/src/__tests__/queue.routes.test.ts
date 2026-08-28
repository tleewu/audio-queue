import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Mock Prisma before importing modules that use it
vi.mock('../lib/prisma', () => ({
  prisma: {
    queueItem: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock resolution to avoid real network calls
vi.mock('../resolvers/podcast', () => ({
  resolve: vi.fn(),
}));

// Mock the SSRF guard to avoid real DNS lookups
vi.mock('../utils/urlGuard', () => ({
  assertPublicHttpUrl: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from '../lib/prisma';
import { resolve } from '../resolvers/podcast';
import queueRouter from '../routes/queue';
import { requireAuth } from '../middleware/auth';

const TEST_SECRET = 'test-jwt-secret';
const USER_ID = 'user-abc';

function makeApp() {
  const app = express();
  app.use(express.json());
  process.env.JWT_SECRET = TEST_SECRET;
  app.use('/api/queue', requireAuth, queueRouter);
  return app;
}

function authToken(userId = USER_ID) {
  return jwt.sign({ userId }, TEST_SECRET, { expiresIn: '1h' });
}

describe('Queue routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
    vi.mocked(resolve).mockResolvedValue({ title: 'Resolved title' });
  });

  // GET /api/queue
  describe('GET /api/queue', () => {
    it('returns user items', async () => {
      const items = [
        { id: '1', title: 'Episode 1', position: 0, userId: USER_ID },
        { id: '2', title: 'Episode 2', position: 1, userId: USER_ID },
      ];
      vi.mocked(prisma.queueItem.findMany).mockResolvedValue(items as any);

      const res = await request(app)
        .get('/api/queue')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(items);
      expect(prisma.queueItem.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        orderBy: { position: 'asc' },
      });
    });

    it('returns 401 without token', async () => {
      const res = await request(app).get('/api/queue');
      expect(res.status).toBe(401);
    });
  });

  // POST /api/queue
  describe('POST /api/queue', () => {
    it('saves a resolved podcast episode and returns 201', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.queueItem.count).mockResolvedValue(0);
      vi.mocked(resolve).mockResolvedValue({
        title: 'Episode 42',
        publisher: 'The Show',
        audioURL: 'https://cdn.example.com/ep.mp3',
        durationSeconds: 1800,
      });
      vi.mocked(prisma.queueItem.create).mockResolvedValue({ id: 'new-1' } as any);

      const res = await request(app)
        .post('/api/queue')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ url: 'https://open.spotify.com/episode/abc' });

      expect(res.status).toBe(201);
      expect(res.body.id).toBe('new-1');
      expect(prisma.queueItem.create).toHaveBeenCalledWith({
        data: {
          userId: USER_ID,
          originalURL: 'https://open.spotify.com/episode/abc',
          title: 'Episode 42',
          publisher: 'The Show',
          audioURL: 'https://cdn.example.com/ep.mp3',
          durationSeconds: 1800,
          position: 0,
        },
      });
    });

    it('saves a web item when nothing resolves as a podcast', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.queueItem.count).mockResolvedValue(0);
      vi.mocked(resolve).mockResolvedValue({ title: 'An essay', publisher: 'Example Blog' });
      vi.mocked(prisma.queueItem.create).mockResolvedValue({ id: 'new-2' } as any);

      const res = await request(app)
        .post('/api/queue')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ url: 'https://example.com/essay' });

      expect(res.status).toBe(201);
      expect(vi.mocked(prisma.queueItem.create).mock.calls[0][0].data).toMatchObject({
        title: 'An essay',
        audioURL: null,
        durationSeconds: null,
      });
    });

    it('still saves the link when resolution throws', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.queueItem.count).mockResolvedValue(0);
      vi.mocked(resolve).mockRejectedValue(new Error('listen notes down'));
      vi.mocked(prisma.queueItem.create).mockResolvedValue({ id: 'new-3' } as any);

      const res = await request(app)
        .post('/api/queue')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ url: 'https://example.com/essay' });

      expect(res.status).toBe(201);
      expect(vi.mocked(prisma.queueItem.create).mock.calls[0][0].data).toMatchObject({
        title: 'https://example.com/essay',
        audioURL: null,
      });
    });

    it('returns 400 when url is missing', async () => {
      const res = await request(app)
        .post('/api/queue')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('url required');
    });
  });

  // DELETE /api/queue/:id
  describe('DELETE /api/queue/:id', () => {
    it('returns 204 for own item', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue({ id: 'item-1', userId: USER_ID } as any);
      vi.mocked(prisma.queueItem.delete).mockResolvedValue({} as any);

      const res = await request(app)
        .delete('/api/queue/item-1')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(204);
    });

    it('returns 404 for another user item', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .delete('/api/queue/item-1')
        .set('Authorization', `Bearer ${authToken()}`);

      expect(res.status).toBe(404);
    });
  });

  // PATCH /api/queue/reorder
  describe('PATCH /api/queue/reorder', () => {
    it('calls $transaction for valid order', async () => {
      vi.mocked(prisma.$transaction).mockResolvedValue([]);
      // We need updateMany to be chainable for the transaction array
      vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 1 } as any);

      const res = await request(app)
        .patch('/api/queue/reorder')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ order: [{ id: '1', position: 0 }, { id: '2', position: 1 }] });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('returns 400 for invalid body', async () => {
      const res = await request(app)
        .patch('/api/queue/reorder')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ order: 'not-an-array' });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('order array required');
    });
  });

  // PATCH /api/queue/:id
  describe('PATCH /api/queue/:id', () => {
    it('toggles isListened', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue({ id: 'item-1', userId: USER_ID, isListened: false } as any);
      vi.mocked(prisma.queueItem.update).mockResolvedValue({ id: 'item-1', isListened: true } as any);

      const res = await request(app)
        .patch('/api/queue/item-1')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ isListened: true });

      expect(res.status).toBe(200);
      expect(prisma.queueItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { isListened: true },
      });
    });

    it('returns 404 for non-existent item', async () => {
      vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/queue/nonexistent')
        .set('Authorization', `Bearer ${authToken()}`)
        .send({ isListened: true });

      expect(res.status).toBe(404);
    });
  });
});
