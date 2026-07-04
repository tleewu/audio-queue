import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../lib/prisma', () => ({
  prisma: {
    queueItem: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock('../utils/ytdlp', () => ({
  execYtDlp: vi.fn(),
}));

import { prisma } from '../lib/prisma';
import { execYtDlp } from '../utils/ytdlp';
import streamRouter from '../routes/stream';
import { requireAuthAllowQueryToken } from '../middleware/auth';

const TEST_SECRET = 'test-jwt-secret';
const USER_ID = 'user-abc';

function makeApp() {
  const app = express();
  process.env.JWT_SECRET = TEST_SECRET;
  app.use('/api/stream', requireAuthAllowQueryToken, streamRouter);
  return app;
}

function authToken(userId = USER_ID) {
  return jwt.sign({ userId }, TEST_SECRET, { expiresIn: '1h' });
}

function proxyItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'item-1',
    userId: USER_ID,
    originalURL: 'https://www.youtube.com/watch?v=abc',
    audioURL: 'https://upstream.example.com/audio.m4a',
    playbackType: 'proxy',
    updatedAt: new Date(), // fresh
    ...overrides,
  };
}

/** Minimal upstream Response stub the proxy can pipe. */
function upstreamResponse(status = 200, headers: Record<string, string> = {}, body = 'AUDIO') {
  return new Response(status >= 400 ? null : body, {
    status,
    headers: { 'content-type': 'audio/mp4', ...headers },
  });
}

describe('GET /api/stream/:id', () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
  });

  it('401s without a token', async () => {
    const res = await request(app).get('/api/stream/item-1');
    expect(res.status).toBe(401);
  });

  it('accepts the JWT as a query parameter (AVPlayer cannot send headers reliably)', async () => {
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(proxyItem() as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse()));

    const res = await request(app).get(`/api/stream/item-1?token=${authToken()}`);

    expect(res.status).toBe(200);
    expect((res.body as Buffer).toString()).toBe('AUDIO');
  });

  it('404s for another user\'s item', async () => {
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/stream/item-1')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(res.status).toBe(404);
    expect(prisma.queueItem.findFirst).toHaveBeenCalledWith({
      where: { id: 'item-1', userId: USER_ID },
    });
  });

  it('409s for non-proxy items', async () => {
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(
      proxyItem({ playbackType: 'direct' }) as any,
    );

    const res = await request(app)
      .get('/api/stream/item-1')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(res.status).toBe(409);
  });

  it('forwards Range requests and 206 responses', async () => {
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(proxyItem() as any);
    const fetchMock = vi.fn().mockResolvedValue(
      upstreamResponse(206, {
        'content-range': 'bytes 0-4/100',
        'accept-ranges': 'bytes',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .get('/api/stream/item-1')
      .set('Authorization', `Bearer ${authToken()}`)
      .set('Range', 'bytes=0-4');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 0-4/100');
    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.headers.Range).toBe('bytes=0-4');
  });

  it('re-resolves with yt-dlp when the upstream URL has expired', async () => {
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(proxyItem() as any);
    vi.mocked(prisma.queueItem.updateMany).mockResolvedValue({ count: 1 } as any);
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'Video',
      url: 'https://upstream.example.com/fresh.m4a',
      extractor: 'youtube',
      webpage_url: 'https://www.youtube.com/watch?v=abc',
    } as any);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(upstreamResponse(403))
      .mockResolvedValueOnce(upstreamResponse(200));
    vi.stubGlobal('fetch', fetchMock);

    const res = await request(app)
      .get('/api/stream/item-1')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(res.status).toBe(200);
    expect(execYtDlp).toHaveBeenCalledWith('https://www.youtube.com/watch?v=abc');
    expect(prisma.queueItem.updateMany).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: { audioURL: 'https://upstream.example.com/fresh.m4a' },
    });
    expect(fetchMock.mock.calls[1][0]).toBe('https://upstream.example.com/fresh.m4a');
  });

  it('502s when upstream fails and re-resolution also fails', async () => {
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue(proxyItem() as any);
    vi.mocked(execYtDlp).mockRejectedValue(new Error('video gone'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(upstreamResponse(403)));

    const res = await request(app)
      .get('/api/stream/item-1')
      .set('Authorization', `Bearer ${authToken()}`);

    expect(res.status).toBe(502);
  });
});
