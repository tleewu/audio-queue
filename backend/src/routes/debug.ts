import { Router, Request, Response } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';
import { fetchPageMeta, findEpisode, cleanTitle } from '../resolvers/podcast';
import { assertPublicHttpUrl } from '../utils/urlGuard';

/**
 * Diagnostics for the resolver, run from inside production.
 *
 * The resolver behaves differently here than on a developer's laptop — most of
 * all because sites serve datacenter IPs differently (consent walls, bot
 * checks). This endpoint reports what *this* host sees for a URL, without
 * saving anything, so a failure can be diagnosed without guesswork.
 *
 * It makes the server fetch an arbitrary URL, so it is deliberately fenced in:
 * off unless DEBUG_RESOLVE is set, behind requireAuth, and behind the same SSRF
 * guard the queue route uses.
 */
const router = Router();

router.get('/resolve', asyncHandler(async (req: Request, res: Response): Promise<void> => {
  if (process.env.DEBUG_RESOLVE !== '1') {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url || url.length > 2048) {
    res.status(400).json({ error: 'url query parameter required' });
    return;
  }

  try {
    await assertPublicHttpUrl(url);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const startedAt = Date.now();
  const page = await fetchPageMeta(url).catch((err: unknown) => {
    return { error: (err as Error).message } as const;
  });

  if (!page || 'error' in page) {
    // The single most common real-world failure: we did not get a usable page.
    res.json({
      url,
      ms: Date.now() - startedAt,
      pageMeta: null,
      reason: page && 'error' in page ? `fetch threw: ${page.error}` : 'fetchPageMeta returned null — no usable title (see logs for the body snippet)',
      episode: null,
    });
    return;
  }

  const episode = await findEpisode(page.title, page.show).catch(() => null);

  res.json({
    url,
    ms: Date.now() - startedAt,
    pageMeta: page,
    cleanedTitle: cleanTitle(page.title),
    listenNotesKeySet: Boolean(process.env.LISTEN_NOTES_API_KEY?.trim()),
    episode: episode
      ? {
          title: episode.title,
          publisher: episode.publisher,
          hasAudio: Boolean(episode.audioURL),
          durationSeconds: episode.durationSeconds,
        }
      : null,
    outcome: episode?.audioURL ? 'podcast' : 'web item',
  });
}));

export default router;
