import express from 'express';
import resolveRouter from './routes/resolve';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/resolve', resolveRouter);

app.listen(PORT, () => {
  console.log(`Audio Queue backend running on port ${PORT}`);
});

export default app;
