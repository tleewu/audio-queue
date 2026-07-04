import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { verifyAppleToken } from '../utils/appleAuth';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();

// POST /api/auth/apple
router.post('/apple', async (req: Request, res: Response): Promise<void> => {
  const { identityToken } = req.body as { identityToken?: string };
  if (!identityToken) {
    res.status(400).json({ error: 'identityToken required' });
    return;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  try {
    const { sub, email } = await verifyAppleToken(identityToken);

    const user = await prisma.user.upsert({
      where: { appleUserId: sub },
      update: email ? { email } : {},
      create: { appleUserId: sub, email },
    });

    const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '90d' });

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    console.error('Apple auth error:', err);
    res.status(401).json({ error: 'Authentication failed' });
  }
});

// DELETE /api/auth/account — permanently delete the user and all their data.
// Required by App Store Review Guideline 5.1.1(v): apps with account creation
// must offer in-app account deletion.
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

// GET /api/auth/me — validate token and return current user
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = await prisma.user.findUnique({ where: { id: req.userId! } });
  if (!user) {
    res.status(401).json({ error: 'User not found' });
    return;
  }
  res.json({ id: user.id, email: user.email });
});

export default router;
