import * as crypto from 'crypto';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { resolveRSS } from './rssResolver';
import { ResolvedItem } from './resolver';
import { extractYouTubeId } from '../utils/ytdlp';

const parser = new Parser({
  timeout: 10_000,
  customFields: { item: [['itunes:duration', 'itunesDuration'], ['itunes:image', 'itunesImage']] },
});

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

  // Fetch Open Graph metadata from Spotify page
  let episodeTitle: string | undefined;
  let showName: string | undefined;
  try {
    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AudioQueue/1.0)' },
    }, 8_000);
    const html = await resp.text();
    const $ = cheerio.load(html);

    episodeTitle = $('meta[property="og:title"]').attr('content');

    // og:description for episodes is "Show Name · Episode" — extract the show name
    const description = $('meta[property="og:description"]').attr('content') ?? '';
    const showMatch = description.match(/^(.+?)\s*·/);
    showName = showMatch?.[1]?.trim();
  } catch {
    return null;
  }

  // Search Podcast Index by show name (more reliable than episode title)
  const searchQuery = showName ?? episodeTitle;
  if (!searchQuery) {
    rssCache.set(url, null);
    return null;
  }

  console.log(`Spotify: episode="${episodeTitle}" show="${showName}" → searching "${searchQuery}"`);

  const feedUrl = await searchPodcastIndex(searchQuery);
  rssCache.set(url, feedUrl);
  if (!feedUrl) return null;

  // Resolve the RSS feed, then try to find the specific episode by title
  const feedResult = await resolveRSS(feedUrl).catch(() => null);
  if (!feedResult || !episodeTitle) return feedResult;

  // If the RSS returned a different episode, try to find the right one by title
  if (feedResult.title !== episodeTitle) {
    const specific = await findEpisodeInFeed(feedUrl, episodeTitle);
    if (specific) return { ...specific, originalURL: url };
  }

  return { ...feedResult, originalURL: url };
}

// ---------------------------------------------------------------------------
// YouTube → Podcast Index episode lookup
// ---------------------------------------------------------------------------

/**
 * Given a YouTube video URL, check if the video is also available as a podcast
 * episode on an RSS feed indexed by Podcast Index.
 *
 * Flow:
 *   1. YouTube oEmbed API → video title + channel name (free, no auth)
 *   2. Search Podcast Index by channel name → up to 3 candidate feeds
 *   3. For each feed, scan recent episodes for a title that matches the video
 *   4. Return the matching episode's audio URL, or null if no match
 */
export async function resolveYouTubeViaPodcastIndex(url: string): Promise<ResolvedItem | null> {
  const videoId = extractYouTubeId(url);
  if (!videoId) return null;

  // Step 1: YouTube oEmbed — title and channel name, no auth required
  let videoTitle: string;
  let channelName: string;
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const resp = await fetchWithTimeout(oEmbedUrl, {}, 5_000);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { title: string; author_name: string };
    videoTitle = data.title;
    channelName = data.author_name;
  } catch {
    return null;
  }

  console.log(`YouTube→Podcast: video="${videoTitle}" channel="${channelName}"`);

  // Step 2: Search Podcast Index by channel name
  const feedUrls = await searchPodcastIndexFeeds(channelName, 3);
  if (feedUrls.length === 0) {
    console.log(`YouTube→Podcast: no Podcast Index feeds found for "${channelName}"`);
    return null;
  }

  // Step 3: Scan each feed's recent episodes for a matching title
  for (const feedUrl of feedUrls) {
    const episode = await findEpisodeInFeed(feedUrl, videoTitle);
    if (episode) {
      console.log(`YouTube→Podcast: matched episode "${episode.title}" in ${feedUrl}`);
      return { ...episode, originalURL: url };
    }
  }

  console.log(`YouTube→Podcast: no episode match found across ${feedUrls.length} feed(s)`);
  return null;
}

// ---------------------------------------------------------------------------
// Podcast Index search
// ---------------------------------------------------------------------------

/** Returns up to `max` feed URLs matching the search query. */
async function searchPodcastIndexFeeds(query: string, max = 3): Promise<string[]> {
  const apiKey = process.env.PODCAST_INDEX_API_KEY?.trim();
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET?.trim();
  if (!apiKey || !apiSecret) return [];

  const unixTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(apiKey + apiSecret + unixTime).digest('hex');

  const params = new URLSearchParams({ q: query, max: String(max) });
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
      8_000,
    );
    const data = (await resp.json()) as { feeds?: Array<{ url?: string }> };
    return (data.feeds ?? []).map((f) => f.url).filter((u): u is string => !!u);
  } catch {
    return [];
  }
}

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

  const params = new URLSearchParams({ q: query, max: '3' });
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

// ---------------------------------------------------------------------------
// Find a specific episode in a feed by title
// ---------------------------------------------------------------------------

function wordOverlapScore(a: string, b: string): number {
  const words = (s: string) => new Set(s.split(/\s+/).filter((w) => w.length > 3));
  const aWords = words(a);
  const bWords = words(b);
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap++;
  const maxSize = Math.max(aWords.size, bWords.size);
  return maxSize === 0 ? 0 : overlap / maxSize;
}

async function findEpisodeInFeed(feedUrl: string, episodeTitle: string): Promise<ResolvedItem | null> {
  try {
    const feed = await parser.parseURL(feedUrl);
    const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const target = normalize(episodeTitle);

    const item =
      // 1. Exact match
      feed.items?.find((i) => i.title && normalize(i.title) === target) ??
      // 2. One contains the other (handles slightly different formatting)
      feed.items?.find((i) => i.title && normalize(i.title).includes(target.slice(0, 40))) ??
      // 3. Word overlap ≥ 60% (handles reordering, minor title differences)
      feed.items?.find((i) => i.title && wordOverlapScore(normalize(i.title), target) >= 0.6);

    if (!item?.enclosure?.url) return null;

    const durationRaw = (item as any).itunesDuration;
    const durationSeconds = parseDuration(durationRaw);
    const thumbnailURL =
      feed.image?.url ??
      (item as any).itunesImage?.['$']?.href;

    return {
      sourceType: 'podcast',
      title: item.title ?? episodeTitle,
      publisher: feed.title ?? feed.author,
      audioURL: item.enclosure.url,
      durationSeconds,
      thumbnailURL,
      originalURL: feedUrl,
    };
  } catch {
    return null;
  }
}

function parseDuration(raw: string | number | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return raw;
  const parts = String(raw).split(':').map(Number);
  if (parts.some(isNaN)) return undefined;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];
  return undefined;
}
