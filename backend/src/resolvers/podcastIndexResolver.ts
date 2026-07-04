import * as crypto from 'crypto';
import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { resolveRSS } from './rssResolver';
import { ResolvedItem } from './resolver';
import { resolveEpisodeViaListenNotes } from './listenNotesResolver';
import { extractYouTubeId } from '../utils/ytdlp';
import { parseDuration } from '../utils/parseDuration';
import { normalizeTitle, wordOverlapScore } from '../utils/textMatch';
import { TTLCache } from '../utils/ttlCache';

export { wordOverlapScore };

const parser = new Parser({
  timeout: 10_000,
  customFields: {
    item: [
      ['itunes:duration', 'itunesDuration'],
      ['itunes:image', 'itunesImage'],
      ['media:thumbnail', 'mediaThumbnail'],
    ],
  },
});

// Feed-URL lookups cached for 6h; respects Podcast Index / iTunes rate limits
const feedUrlCache = new TTLCache<string | null>(6 * 60 * 60 * 1000);

/**
 * Resolve a Spotify or Apple Podcasts URL to the episode's direct audio.
 * Every podcast platform link goes through the podcast directories
 * (Listen Notes → Podcast Index → iTunes/RSS) — we never try to play
 * audio from the platform page itself.
 *
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

interface ITunesLookupResult {
  wrapperType?: string;
  kind?: string;
  feedUrl?: string;
  trackName?: string;
  collectionName?: string;
  episodeUrl?: string;
  artworkUrl600?: string;
  artworkUrl160?: string;
  trackTimeMillis?: number;
}

async function iTunesLookup(id: string, entity: string): Promise<ITunesLookupResult[]> {
  const resp = await fetchWithTimeout(
    `https://itunes.apple.com/lookup?id=${id}&entity=${entity}`,
    {},
    8_000,
  );
  const data = (await resp.json()) as { results?: ITunesLookupResult[] };
  return data.results ?? [];
}

async function resolveApplePodcasts(url: string): Promise<ResolvedItem | null> {
  const showMatch = url.match(/id(\d+)/);
  if (!showMatch) return null;
  const itunesId = showMatch[1];

  // Episode link (…?i=<episodeId>) → resolve that exact episode.
  const episodeId = url.match(/[?&]i=(\d+)/)?.[1];
  if (episodeId) {
    const episode = await resolveAppleEpisode(episodeId).catch(() => null);
    if (episode) return episode;
    // fall through to feed-level resolution below
  }

  const feedUrl = await appleFeedUrl(itunesId);
  if (!feedUrl) return null;
  return resolveRSS(feedUrl).catch(() => null);
}

/** iTunes episode lookup returns the enclosure URL directly — no RSS scan needed. */
async function resolveAppleEpisode(episodeId: string): Promise<ResolvedItem | null> {
  const results = await iTunesLookup(episodeId, 'podcastEpisode');
  const episode = results.find(
    (r) => r.wrapperType === 'podcastEpisode' || r.kind === 'podcast-episode',
  );
  if (!episode) return null;

  if (episode.episodeUrl) {
    return {
      sourceType: 'podcast',
      playbackType: 'direct',
      title: episode.trackName ?? '',
      publisher: episode.collectionName,
      audioURL: episode.episodeUrl,
      durationSeconds: episode.trackTimeMillis
        ? Math.round(episode.trackTimeMillis / 1000)
        : undefined,
      thumbnailURL: episode.artworkUrl600 ?? episode.artworkUrl160,
      originalURL: '',
    };
  }

  // No direct enclosure in the lookup — find the episode in the show's feed by title.
  if (episode.feedUrl && episode.trackName) {
    return findEpisodeInFeed(episode.feedUrl, episode.trackName);
  }
  return null;
}

async function appleFeedUrl(itunesId: string): Promise<string | null> {
  const cached = feedUrlCache.get(`apple:${itunesId}`);
  if (cached !== undefined) return cached;

  try {
    const results = await iTunesLookup(itunesId, 'podcast');
    const feedUrl = results[0]?.feedUrl ?? null;
    feedUrlCache.set(`apple:${itunesId}`, feedUrl);
    return feedUrl;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Spotify
// ---------------------------------------------------------------------------

async function resolveSpotifyPodcast(url: string): Promise<ResolvedItem | null> {
  const meta = await fetchSpotifyMeta(url);
  if (!meta?.title) return null;

  const isEpisode = url.includes('/episode/');
  const episodeTitle = isEpisode ? meta.title : undefined;
  const showName = isEpisode ? meta.showName : meta.title;

  console.log(`Spotify: episode="${episodeTitle}" show="${showName}"`);

  // 1. Listen Notes episode search — strongest episode-level matcher (when configured)
  if (episodeTitle) {
    const viaListenNotes = await resolveEpisodeViaListenNotes(episodeTitle, showName);
    if (viaListenNotes) return { ...viaListenNotes, originalURL: url };
  }

  // 2. Podcast Index — find the show's RSS feed, then locate the episode in it
  const searchQuery = showName ?? episodeTitle;
  if (!searchQuery) return null;

  let feedUrl = feedUrlCache.get(`spotify:${searchQuery}`);
  if (feedUrl === undefined) {
    feedUrl = await searchPodcastIndex(searchQuery);
    feedUrlCache.set(`spotify:${searchQuery}`, feedUrl);
  }
  if (!feedUrl) return null;

  if (episodeTitle) {
    const specific = await findEpisodeInFeed(feedUrl, episodeTitle);
    if (specific) return { ...specific, originalURL: url };
  }

  // Show link (or episode not found in feed): latest episode
  const feedResult = await resolveRSS(feedUrl).catch(() => null);
  return feedResult ? { ...feedResult, originalURL: url } : null;
}

interface SpotifyMeta { title?: string; showName?: string; thumbnailURL?: string }

/**
 * Spotify metadata via oEmbed (reliable, unauthenticated), falling back to
 * scraping Open Graph tags (gives us the show name for episode links).
 */
async function fetchSpotifyMeta(url: string): Promise<SpotifyMeta | null> {
  let title: string | undefined;
  let thumbnailURL: string | undefined;
  let showName: string | undefined;

  try {
    const resp = await fetchWithTimeout(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
      {},
      8_000,
    );
    if (resp.ok) {
      const data = (await resp.json()) as { title?: string; thumbnail_url?: string };
      title = data.title;
      thumbnailURL = data.thumbnail_url;
    }
  } catch {
    // fall through to scraping
  }

  // og:description on episode pages is "Show Name · Episode" — grab the show name
  try {
    const resp = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CueApp/1.0)' },
    }, 8_000);
    const html = await resp.text();
    const $ = cheerio.load(html);
    title ??= $('meta[property="og:title"]').attr('content');
    const description = $('meta[property="og:description"]').attr('content') ?? '';
    showName = description.match(/^(.+?)\s*·/)?.[1]?.trim();
  } catch {
    // scraping is best-effort; oEmbed title alone is enough to search on
  }

  if (!title) return null;
  return { title, showName, thumbnailURL };
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
 *   2. Listen Notes episode search (when configured)
 *   3. Search Podcast Index by channel name → up to 3 candidate feeds
 *   4. For each feed, scan recent episodes for a title that matches the video
 *   5. Return the matching episode's audio URL, or null if no match
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

  // Step 2: Listen Notes episode search
  const viaListenNotes = await resolveEpisodeViaListenNotes(videoTitle, channelName);
  if (viaListenNotes) return { ...viaListenNotes, originalURL: url };

  // Step 3: Search Podcast Index by channel name
  const feedUrls = await searchPodcastIndexFeeds(channelName, 3);
  if (feedUrls.length === 0) {
    console.log(`YouTube→Podcast: no Podcast Index feeds found for "${channelName}"`);
    return null;
  }

  // Step 4: Scan each feed's recent episodes for a matching title
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

function podcastIndexHeaders(): Record<string, string> | null {
  const apiKey = process.env.PODCAST_INDEX_API_KEY?.trim();
  const apiSecret = process.env.PODCAST_INDEX_API_SECRET?.trim();
  if (!apiKey || !apiSecret) {
    console.warn('Podcast Index API not configured (PODCAST_INDEX_API_KEY / PODCAST_INDEX_API_SECRET)');
    return null;
  }

  const unixTime = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(apiKey + apiSecret + unixTime).digest('hex');
  return {
    'X-Auth-Key': apiKey,
    'X-Auth-Date': String(unixTime),
    Authorization: hash,
    'User-Agent': 'CueApp/1.0',
  };
}

/** Returns up to `max` feed URLs matching the search query. */
async function searchPodcastIndexFeeds(query: string, max = 3): Promise<string[]> {
  const headers = podcastIndexHeaders();
  if (!headers) return [];

  const params = new URLSearchParams({ q: query, max: String(max) });
  try {
    const resp = await fetchWithTimeout(
      `https://api.podcastindex.org/api/1.0/search/byterm?${params}`,
      { headers },
      8_000,
    );
    const data = (await resp.json()) as { feeds?: Array<{ url?: string }> };
    return (data.feeds ?? []).map((f) => f.url).filter((u): u is string => !!u);
  } catch {
    return [];
  }
}

async function searchPodcastIndex(query: string): Promise<string | null> {
  const feeds = await searchPodcastIndexFeeds(query, 3);
  return feeds[0] ?? null;
}

// ---------------------------------------------------------------------------
// Find a specific episode in a feed by title
// ---------------------------------------------------------------------------

async function findEpisodeInFeed(feedUrl: string, episodeTitle: string): Promise<ResolvedItem | null> {
  try {
    const feed = await parser.parseURL(feedUrl);
    const target = normalizeTitle(episodeTitle);

    const item =
      // 1. Exact match
      feed.items?.find((i) => i.title && normalizeTitle(i.title) === target) ??
      // 2. One contains the other (handles slightly different formatting)
      feed.items?.find((i) => i.title && normalizeTitle(i.title).includes(target.slice(0, 40))) ??
      // 3. Word overlap ≥ 60% (handles reordering, minor title differences)
      feed.items?.find((i) => i.title && wordOverlapScore(normalizeTitle(i.title), target) >= 0.6);

    if (!item?.enclosure?.url) return null;

    const durationRaw = (item as any).itunesDuration;
    const durationSeconds = parseDuration(durationRaw);
    // Prefer episode artwork over podcast/feed image
    const thumbnailURL =
      (item as any).itunesImage?.['$']?.href ??
      (item as any).mediaThumbnail?.['$']?.url ??
      feed.image?.url;

    return {
      sourceType: 'podcast',
      playbackType: 'direct',
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
