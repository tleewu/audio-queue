import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// Augment Express Request type
declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

function verifyToken(token: string): string | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    return (payload.userId as string) ?? null;
  } catch {
    return null;
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (!process.env.JWT_SECRET) {
    res.status(500).json({ error: 'Server misconfigured' });
    return;
  }

  const userId = verifyToken(header.slice(7));
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.userId = userId;
  next();
}
