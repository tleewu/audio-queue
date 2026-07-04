import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { prisma } from '../lib/prisma';
import { execYtDlp } from '../utils/ytdlp';

const router = Router();

/**
 * GET /api/stream/:id — audio relay for playbackType='proxy' items.
 *
 * yt-dlp stream URLs (YouTube, X, SoundCloud progressive, …) are short-lived
 * and often IP-locked to the machine that resolved them, so the client can't
 * play them directly. This endpoint fetches the upstream from the server and
 * pipes it through, forwarding Range headers so AVPlayer can seek. When the
 * stored upstream URL has expired (4xx or older than STALE_AFTER_MS) it is
 * re-resolved with yt-dlp once and retried.
 */

const STALE_AFTER_MS = 3 * 60 * 60 * 1000; // yt-dlp URLs generally live ~6h; refresh at 3h

// Response headers worth forwarding from the upstream CDN
const FORWARD_HEADERS = [
  'content-type',
  'content-length',
  'content-range',
  'accept-ranges',
];

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const item = await prisma.queueItem.findFirst({
    where: { id: req.params.id, userId: req.userId! },
  });

  if (!item) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (item.playbackType !== 'proxy' || !item.audioURL) {
    res.status(409).json({ error: 'Item is not proxy-streamable' });
    return;
  }

  const isStale = Date.now() - item.updatedAt.getTime() > STALE_AFTER_MS;
  let upstreamURL = item.audioURL;

  if (isStale) {
    upstreamURL = (await refreshUpstream(item.id, item.originalURL)) ?? upstreamURL;
  }

  try {
    let upstream = await fetchUpstream(upstreamURL, req.headers.range);

    // Expired/invalidated URL → re-resolve once and retry
    if (upstream.status >= 400 && !isStale) {
      console.log(`[stream] upstream ${upstream.status} for item ${item.id}; re-resolving`);
      upstream.body?.cancel().catch(() => {});
      const fresh = await refreshUpstream(item.id, item.originalURL);
      if (!fresh) {
        res.status(502).json({ error: 'Source stream unavailable' });
        return;
      }
      upstream = await fetchUpstream(fresh, req.headers.range);
    }

    if (upstream.status >= 400) {
      console.error(`[stream] upstream failed with ${upstream.status} for item ${item.id}`);
      res.status(502).json({ error: 'Source stream unavailable' });
      return;
    }

    res.status(upstream.status); // 200 or 206 (partial content)
    for (const name of FORWARD_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    if (!upstream.headers.get('accept-ranges')) {
      res.setHeader('accept-ranges', 'bytes');
    }

    if (!upstream.body) {
      res.end();
      return;
    }

    const body = Readable.fromWeb(upstream.body as any);
    // Client disconnects (seek, pause, app close) are routine — stop pulling upstream
    res.on('close', () => body.destroy());
    body.on('error', () => res.end());
    body.pipe(res);
  } catch (err) {
    console.error(`[stream] error for item ${item.id}:`, (err as Error).message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Source stream unavailable' });
    } else {
      res.end();
    }
  }
});

async function fetchUpstream(url: string, range?: string): Promise<globalThis.Response> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (compatible; CueApp/1.0)',
  };
  if (range) headers.Range = range;
  return fetch(url, { headers, redirect: 'follow' });
}

/** Re-run yt-dlp for the original URL and persist the fresh stream URL. */
async function refreshUpstream(itemId: string, originalURL: string): Promise<string | null> {
  try {
    const info = await execYtDlp(originalURL);
    await prisma.queueItem.updateMany({
      where: { id: itemId },
      data: { audioURL: info.url },
    });
    return info.url;
  } catch (err) {
    console.error(`[stream] re-resolution failed for ${originalURL}:`, (err as Error).message);
    return null;
  }
}

export default router;
