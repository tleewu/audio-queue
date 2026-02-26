import { Router, Request, Response } from 'express';
import { dispatch } from '../resolvers/resolver';

const router = Router();

// POST /api/resolve — single URL
router.post('/', async (req: Request, res: Response) => {
  const { url } = req.body as { url?: string };

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing required field: url' });
  }

  try {
    const result = await dispatch(url.trim());
    return res.json(result);
  } catch (err) {
    console.error('Resolve error:', err);
    return res.status(500).json({ error: 'Internal resolver error' });
  }
});

// POST /api/resolve/batch — multiple URLs
router.post('/batch', async (req: Request, res: Response) => {
  const { urls } = req.body as { urls?: string[] };

  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Missing required field: urls (array)' });
  }

  if (urls.length > 20) {
    return res.status(400).json({ error: 'Batch limit is 20 URLs' });
  }

  try {
    const results = await Promise.allSettled(
      urls.map((url) => dispatch(url.trim()))
    );

    const items = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      console.error(`Batch resolve failed for ${urls[i]}:`, r.reason);
      return {
        sourceType: 'unsupported' as const,
        title: urls[i],
        audioURL: undefined,
        originalURL: urls[i],
      };
    });

    return res.json(items);
  } catch (err) {
    console.error('Batch resolve error:', err);
    return res.status(500).json({ error: 'Internal resolver error' });
  }
});

export default router;
