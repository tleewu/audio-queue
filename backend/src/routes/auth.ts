import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { verifyAppleToken } from '../utils/appleAuth';
import { prisma } from '../lib/prisma';
import { requireAuth, optionalAuth } from '../middleware/auth';

const router = Router();

const TOKEN_TTL = '90d';

function issueToken(userId: string): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  return jwt.sign({ userId }, secret, { expiresIn: TOKEN_TTL });
}

/** What the app knows about the session: an id, an email once signed in, and whether it syncs. */
function publicUser(user: User) {
  return { id: user.id, email: user.email, isSignedIn: !!user.appleUserId };
}

// POST /api/auth/device — anonymous account keyed to a device-generated id.
// Every install starts here; no sign-in required to use the app.
router.post('/device', async (req: Request, res: Response): Promise<void> => {
  const { deviceId } = req.body as { deviceId?: string };
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length < 8 || deviceId.length > 128) {
    res.status(400).json({ error: 'deviceId required' });
    return;
  }

  const user = await prisma.user.upsert({
    where: { deviceId },
    update: {},
    create: { deviceId },
  });

  const token = issueToken(user.id);
  if (!token) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }
  res.json({ token, user: publicUser(user) });
});

// POST /api/auth/apple — sign in to sync. When the caller is already using an
// anonymous account, that account is upgraded in place (or merged into the
// existing Apple account) so nothing they saved is lost.
router.post('/apple', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const { identityToken } = req.body as { identityToken?: string };
  if (!identityToken) {
    res.status(400).json({ error: 'identityToken required' });
    return;
  }
  if (!process.env.JWT_SECRET) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  try {
    const { sub, email } = await verifyAppleToken(identityToken);

    const existing = await prisma.user.findUnique({ where: { appleUserId: sub } });
    const current = req.userId
      ? await prisma.user.findUnique({ where: { id: req.userId } })
      : null;
    /// Only an account that has never signed in can be folded into another one.
    const anonymous = current && !current.appleUserId ? current : null;

    let user: User;
    if (existing) {
      if (anonymous && anonymous.id !== existing.id) {
        await mergeQueue(anonymous.id, existing.id);
        await prisma.user.delete({ where: { id: anonymous.id } });
      }
      user = email && email !== existing.email
        ? await prisma.user.update({ where: { id: existing.id }, data: { email } })
        : existing;
    } else if (anonymous) {
      user = await prisma.user.update({
        where: { id: anonymous.id },
        data: { appleUserId: sub, email: email ?? anonymous.email },
      });
    } else {
      user = await prisma.user.create({ data: { appleUserId: sub, email } });
    }

    res.json({ token: issueToken(user.id), user: publicUser(user) });
  } catch (err) {
    console.error('Apple auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

/** Moves one account's queue onto another, appending it after what's already there. */
async function mergeQueue(fromUserId: string, toUserId: string): Promise<void> {
  const last = await prisma.queueItem.findFirst({
    where: { userId: toUserId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const offset = (last?.position ?? -1) + 1;
  await prisma.$executeRaw`
    UPDATE "QueueItem"
    SET "userId" = ${toUserId}, "position" = "position" + ${offset}
    WHERE "userId" = ${fromUserId}`;
}

// GET /api/auth/me — validate the token and describe the session
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  res.json(publicUser(user));
});

// DELETE /api/auth/account — permanently delete the account and all its data.
// Required by App Store Review Guideline 5.1.1(v).
router.delete('/account', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    // Queue items cascade via the FK
    await prisma.user.delete({ where: { id: req.userId! } });
    res.status(204).send();
  } catch (err) {
    console.error('Account deletion error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

export default router;
