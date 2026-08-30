import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import authRouter from './routes/auth';
import queueRouter from './routes/queue';
import legalRouter from './routes/legal';
import debugRouter from './routes/debug';
import { requireAuth } from './middleware/auth';

// Surface silent crashes in Railway logs
// Log loudly, but do not take the server down. Route rejections are handled by
// asyncHandler + the error middleware below; anything reaching here is a stray
// promise, and killing a healthy process over one caused a day-long outage.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  process.exit(1);
});

const app = express();
// Use 8080 when PORT is unset/invalid so we match Dockerfile EXPOSE and Railway's default.
const PORT = (() => {
  const p = process.env.PORT;
  const n = p ? parseInt(p, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 8080;
})();

// Behind Railway's proxy — needed so rate limiting sees real client IPs
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '64kb' }));

// General API limiter, plus a tighter one for auth (token issuance)
const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Public HTML pages (privacy policy / support / terms for App Store listing)
app.use('/', legalRouter);

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/queue', apiLimiter, requireAuth, queueRouter);
// Resolver diagnostics. Inert unless DEBUG_RESOLVE=1; see routes/debug.ts.
app.use('/api/debug', apiLimiter, requireAuth, debugRouter);

// Terminal error handler. Must come after the routes, and must take four
// arguments for Express to recognise it as an error handler.
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(`Request failed: ${req.method} ${req.path}`, err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

const host = '0.0.0.0';
app.listen(PORT, host, () => {
  console.log(`cue backend listening on http://${host}:${PORT}`);
});

export default app;
