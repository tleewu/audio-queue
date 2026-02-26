import express from 'express';
import resolveRouter from './routes/resolve';
import authRouter from './routes/auth';
import queueRouter from './routes/queue';
import { requireAuth } from './middleware/auth';
import { prisma } from './lib/prisma';

// Surface silent crashes in Railway logs
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  process.exit(1);
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

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Public
app.use('/api/resolve', resolveRouter);
app.use('/api/auth', authRouter);

// Protected
app.use('/api/queue', requireAuth, queueRouter);

const host = '0.0.0.0';
app.listen(PORT, host, () => {
  console.log(`Audio Queue backend listening on http://${host}:${PORT}`);

  // Run startup cleanup outside the listen callback to avoid
  // unhandled-rejection crashes (Express doesn't await async callbacks)
  setTimeout(() => {
    runStartupCleanup().catch((err) => {
      console.warn('Startup cleanup failed:', err);
    });
  }, 1000);
});

async function runStartupCleanup(): Promise<void> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const { count } = await prisma.queueItem.updateMany({
    where: { resolveStatus: 'pending', savedAt: { lt: cutoff } },
    data: { resolveStatus: 'failed', resolveError: 'Server restarted during resolution' },
  });
  if (count > 0) console.log(`Reset ${count} stuck-pending item(s) to failed`);
}

export default app;
