import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

vi.mock('../lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    queueItem: { findFirst: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('../utils/appleAuth', () => ({
  verifyAppleToken: vi.fn(),
}));

import { prisma } from '../lib/prisma';
import { verifyAppleToken } from '../utils/appleAuth';
import authRouter from '../routes/auth';

const TEST_SECRET = 'test-jwt-secret';

function makeApp() {
  process.env.JWT_SECRET = TEST_SECRET;
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  return app;
}

function tokenFor(userId: string) {
  return jwt.sign({ userId }, TEST_SECRET, { expiresIn: '1h' });
}

const anonymousUser = { id: 'anon-1', deviceId: 'device-abc', appleUserId: null, email: null };
const appleUser = { id: 'apple-1', deviceId: null, appleUserId: 'apple-sub', email: 'me@example.com' };

describe('POST /api/auth/device', () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
  });

  it('creates or reuses the account for a device id', async () => {
    vi.mocked(prisma.user.upsert).mockResolvedValue(anonymousUser as any);

    const res = await request(app).post('/api/auth/device').send({ deviceId: 'device-abc' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'anon-1', email: null, isSignedIn: false });
    expect(jwt.verify(res.body.token, TEST_SECRET)).toMatchObject({ userId: 'anon-1' });
    expect(prisma.user.upsert).toHaveBeenCalledWith({
      where: { deviceId: 'device-abc' },
      update: {},
      create: { deviceId: 'device-abc' },
    });
  });

  it('rejects a missing or too-short device id', async () => {
    expect((await request(app).post('/api/auth/device').send({})).status).toBe(400);
    expect((await request(app).post('/api/auth/device').send({ deviceId: 'short' })).status).toBe(400);
  });
});

describe('POST /api/auth/apple', () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
    vi.mocked(verifyAppleToken).mockResolvedValue({ sub: 'apple-sub', email: 'me@example.com' });
  });

  it('upgrades the calling anonymous account in place', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)                 // no existing Apple account
      .mockResolvedValueOnce(anonymousUser as any); // the caller
    vi.mocked(prisma.user.update).mockResolvedValue({ ...anonymousUser, appleUserId: 'apple-sub', email: 'me@example.com' } as any);

    const res = await request(app)
      .post('/api/auth/apple')
      .set('Authorization', `Bearer ${tokenFor('anon-1')}`)
      .send({ identityToken: 'apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'anon-1', email: 'me@example.com', isSignedIn: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'anon-1' },
      data: { appleUserId: 'apple-sub', email: 'me@example.com' },
    });
    expect(prisma.user.delete).not.toHaveBeenCalled();
  });

  it('merges the anonymous queue into an existing Apple account', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(appleUser as any)      // existing Apple account
      .mockResolvedValueOnce(anonymousUser as any); // the caller
    vi.mocked(prisma.queueItem.findFirst).mockResolvedValue({ position: 4 } as any);

    const res = await request(app)
      .post('/api/auth/apple')
      .set('Authorization', `Bearer ${tokenFor('anon-1')}`)
      .send({ identityToken: 'apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('apple-1');
    expect(prisma.$executeRaw).toHaveBeenCalled();
    expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'anon-1' } });
  });

  it('creates a fresh account when signing in without a session', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);
    vi.mocked(prisma.user.create).mockResolvedValue(appleUser as any);

    const res = await request(app).post('/api/auth/apple').send({ identityToken: 'apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.user).toEqual({ id: 'apple-1', email: 'me@example.com', isSignedIn: true });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { appleUserId: 'apple-sub', email: 'me@example.com' },
    });
  });

  it('never folds one signed-in account into another', async () => {
    const otherSignedIn = { id: 'apple-2', deviceId: null, appleUserId: 'other-sub', email: null };
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(appleUser as any)
      .mockResolvedValueOnce(otherSignedIn as any);

    const res = await request(app)
      .post('/api/auth/apple')
      .set('Authorization', `Bearer ${tokenFor('apple-2')}`)
      .send({ identityToken: 'apple-token' });

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('apple-1');
    expect(prisma.user.delete).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('returns 401 when the Apple token is invalid', async () => {
    vi.mocked(verifyAppleToken).mockRejectedValue(new Error('bad token'));

    const res = await request(app).post('/api/auth/apple').send({ identityToken: 'nope' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  let app: express.Express;

  beforeEach(() => {
    app = makeApp();
    vi.clearAllMocks();
  });

  it('describes an anonymous session', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(anonymousUser as any);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor('anon-1')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'anon-1', email: null, isSignedIn: false });
  });

  it('returns 401 for a deleted account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${tokenFor('gone')}`);

    expect(res.status).toBe(401);
  });
});
