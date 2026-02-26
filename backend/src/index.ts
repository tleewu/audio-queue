import express from 'express';
import resolveRouter from './routes/resolve';
import authRouter from './routes/auth';
import queueRouter from './routes/queue';
import { requireAuth } from './middleware/auth';
import { prisma } from './lib/prisma';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Public
app.use('/api/resolve', resolveRouter);
app.use('/api/auth', authRouter);

// Protected
app.use('/api/queue', requireAuth, queueRouter);

app.listen(PORT, async () => {
  console.log(`Audio Queue backend running on port ${PORT}`);

  // Reset stuck-pending items (crashed mid-resolution, > 5 min ago)
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);
    const { count } = await prisma.queueItem.updateMany({
      where: { resolveStatus: 'pending', savedAt: { lt: cutoff } },
      data: { resolveStatus: 'failed', resolveError: 'Server restarted during resolution' },
    });
    if (count > 0) console.log(`Reset ${count} stuck-pending item(s) to failed`);
  } catch (err) {
    console.warn('Startup cleanup skipped (DB not yet available?):', (err as Error).message);
  }
});

export default app;
