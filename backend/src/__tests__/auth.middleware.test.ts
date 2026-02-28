import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { requireAuth } from '../middleware/auth';
import type { Request, Response, NextFunction } from 'express';

const TEST_SECRET = 'test-jwt-secret-for-unit-tests';

function mockReqResNext(authHeader?: string) {
  const req = { headers: { authorization: authHeader } } as unknown as Request;
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response;
  const next = vi.fn() as NextFunction;
  return { req, res, next };
}

describe('requireAuth middleware', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });

  afterEach(() => {
    delete process.env.JWT_SECRET;
  });

  it('sets req.userId and calls next() for valid token', () => {
    const token = jwt.sign({ userId: 'user-123' }, TEST_SECRET, { expiresIn: '1h' });
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(req.userId).toBe('user-123');
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 for expired token', () => {
    const token = jwt.sign({ userId: 'user-123' }, TEST_SECRET, { expiresIn: '-1s' });
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for missing Authorization header', () => {
    const { req, res, next } = mockReqResNext(undefined);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for malformed Bearer prefix', () => {
    const { req, res, next } = mockReqResNext('Token abc');

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 for token signed with wrong secret', () => {
    const token = jwt.sign({ userId: 'user-123' }, 'wrong-secret');
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 500 when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    const token = jwt.sign({ userId: 'user-123' }, TEST_SECRET);
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    requireAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Server misconfigured' });
    expect(next).not.toHaveBeenCalled();
  });
});
