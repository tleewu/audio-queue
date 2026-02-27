import * as crypto from 'crypto';
import * as cheerio from 'cheerio';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { resolveRSS } from './rssResolver';
import { ResolvedItem } from './resolver';

// Simple in-process cache to respect 10k/day rate limit
const rssCache = new Map<string, string | null>();

/**
 * Attempt to resolve a Spotify or Apple Podcasts URL via Podcast Index.
 * Returns null if the URL isn't a podcast platform URL or lookup fails.
 */
export async function resolvePodcastPlatform(url: string): Promise<ResolvedItem | null> {
  if (url.includes('podcasts.apple.com')) {
    return resolveApplePodcasts(url);
  }
  if (url.includes('open.spotify.com/show') || url.includes('open.spotify.com/episode')) {
    return resolveSpotifyPodcast(url);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Apple Podcasts
// ---------------------------------------------------------------------------

async function resolveApplePodcasts(url: string): Promise<ResolvedItem | null> {
  const match = url.match(/id(\d+)/);
  if (!match) return null;
  const itunesId = match[1];

  if (rssCache.has(itunesId)) {
    const feedUrl = rssCache.get(itunesId);
    if (!feedUrl) return null;
    return resolveRSS(feedUrl).catch(() => null);
  }

  try {
    const resp = await fetchWithTimeout(
      `https://itunes.apple.com/lookup?id=${itunesId}&entity=podcast`,
      {},
      8_000
    );
    const data = (await resp.json()) as { results?: Array<{ feedUrl?: string }> };
    const feedUrl = data.results?.[0]?.feedUrl ?? null;
    rssCache.set(itunesId, feedUrl);
    if (!feedUrl) return null;
    return resolveRSS(feedUrl).catch(() => null);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Spotify
// ---------------------------------------------------------------------------

async function resolveSpotifyPodcast(url: string): Promise<ResolvedItem | null> {
  if (rssCache.has(url)) {
    const feedUrl = rssCache.get(url);
    if (!feedUrl) return null;
    return resolveRSS(feedUrl).catch(() => null);
  }

  // Extract show title from Open Graph metadata
  let showTitle: string | undefined;
  try {
    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AudioQueue/1.0)' },
    }, 8_000);
    const html = await resp.text();
    const $ = cheerio.load(html);
    showTitle =
      $('meta[property="og:title"]').attr('content') ??
      $('title').text() ??
      undefined;
  } catch {
    return null;
  }

  if (!showTitle) {
    rssCache.set(url, null);
    return null;
  }

  // Search Podcast Index by title
  const feedUrl = await searchPodcastIndex(showTitle);
  rssCache.set(url, feedUrl);
  if (!feedUrl) return null;

  return resolveRSS(feedUrl).catch(() => null);
}

// ---------------------------------------------------------------------------
// Podcast Index search
// ---------------------------------------------------------------------------

async function searchPodcastIndex(query: string): Promise<string | null> {
  const apiKey = process.env.PODCAST_INDEX_API_KEY?.trim();
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    const missing = [
      !apiKey && 'PODCAST_INDEX_API_KEY',
      !apiSecret && 'PODCAST_INDEX_API_SECRET',
    ].filter(Boolean);
    console.warn('Podcast Index API not configured (missing or empty):', missing.join(', '));
    return null;
  }

  const unixTime = Math.floor(Date.now() / 1000);
  const hash = crypto
    .createHash('sha1')
    .update(apiKey + apiSecret + unixTime)
    .digest('hex');

  const params = new URLSearchParams({ q: query, max: '1' });
  try {
    const resp = await fetchWithTimeout(
      `https://api.podcastindex.org/api/1.0/search/byterm?${params}`,
      {
        headers: {
          'X-Auth-Key': apiKey,
          'X-Auth-Date': String(unixTime),
          Authorization: hash,
          'User-Agent': 'AudioQueue/1.0',
        },
      },
      8_000
    );
    const data = (await resp.json()) as { feeds?: Array<{ url?: string }> };
    return data.feeds?.[0]?.url ?? null;
  } catch {
    return null;
  }
}
