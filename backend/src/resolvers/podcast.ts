import * as cheerio from 'cheerio';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { normalizeTitle, wordOverlapScore } from '../utils/textMatch';

/**
 * A saved link resolves to exactly one of two things:
 *
 *   podcast episode — audioURL set; the app plays it
 *   web page        — audioURL unset; the app opens it in a web view
 *
 * The whole pipeline is: read the page's title, ask Listen Notes whether an
 * episode by that name exists, and take its CDN audio if it does.
 */
export interface ResolvedItem {
  title: string;
  publisher?: string;
  audioURL?: string;
  durationSeconds?: number;
}

const USER_AGENT = 'Mozilla/5.0 (compatible; CueApp/1.0)';
const PAGE_TIMEOUT_MS = 6_000;
const SEARCH_TIMEOUT_MS = 8_000;
const MAX_HTML_BYTES = 400_000;
/** Minimum share of significant words an episode title must have in common. */
const MIN_TITLE_MATCH = 0.5;

export async function resolve(url: string): Promise<ResolvedItem> {
  const page = await fetchPageMeta(url);
  if (!page) return { title: url };

  const episode = await findEpisode(page.title, page.show);
  if (episode) return episode;

  return { title: page.title, publisher: page.show ?? page.site };
}

// ---------------------------------------------------------------------------
// Page metadata
// ---------------------------------------------------------------------------

export interface PageMeta {
  /** Episode/video/article title, cleaned of platform suffixes */
  title: string;
  /** Show or channel name, when the page exposes one */
  show?: string;
  /** Site name, used as the publisher line for web items */
  site: string;
}

export async function fetchPageMeta(url: string): Promise<PageMeta | null> {
  let html: string;
  try {
    const resp = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' } },
      PAGE_TIMEOUT_MS,
    );
    if (!resp.ok) return null;
    html = (await resp.text()).slice(0, MAX_HTML_BYTES);
  } catch (err) {
    console.warn(`Page fetch failed for ${url}:`, (err as Error).message);
    return null;
  }

  const host = hostOf(url);
  const $ = cheerio.load(html);
  const meta = (selector: string) => $(selector).attr('content')?.trim() || undefined;

  const rawTitle =
    meta('meta[property="og:title"]') ??
    meta('meta[name="twitter:title"]') ??
    $('title').first().text().trim();
  if (!rawTitle) return null;

  const site = meta('meta[property="og:site_name"]') ?? host;
  let title = cleanTitle(rawTitle);
  let show =
    // Spotify episode pages describe themselves as "Show Name · Episode"
    meta('meta[property="og:description"]')?.match(/^(.+?)\s+·/)?.[1]?.trim() ??
    meta('meta[name="author"]') ??
    $('link[itemprop="name"]').attr('content')?.trim(); // YouTube channel

  // Apple Podcasts titles read "Show Name: Episode Title"
  if (host.endsWith('podcasts.apple.com')) {
    const split = title.match(/^(.+?):\s+(.+)$/);
    if (split) {
      show ??= split[1].trim();
      title = split[2].trim();
    }
  }

  return { title, show: show ? cleanTitle(show) : undefined, site };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Strip the platform boilerplate sites append to their page titles. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/‎/g, '')
    .replace(/\s*\|\s*Podcast on Spotify\s*$/i, '')
    .replace(/\s+on Apple Podcasts\s*$/i, '')
    .replace(/\s*[-–|]\s*(YouTube|Spotify|SoundCloud)\s*$/i, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Listen Notes episode search
// ---------------------------------------------------------------------------

export interface ListenNotesEpisode {
  audio?: string;
  audio_length_sec?: number;
  title_original?: string;
  podcast?: {
    title_original?: string;
    publisher_original?: string;
  };
}

/**
 * Search Listen Notes for an episode with this title and return its direct
 * CDN audio. Returns null when the key is unset, the search fails, or nothing
 * matches closely enough — in every one of those cases the link becomes a web
 * item, which is the intended fallback.
 */
export async function findEpisode(title: string, show?: string): Promise<ResolvedItem | null> {
  const apiKey = process.env.LISTEN_NOTES_API_KEY?.trim();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    q: title,
    type: 'episode',
    only_in: 'title',
    safe_mode: '0',
    page_size: '10',
  });

  let episodes: ListenNotesEpisode[];
  try {
    const resp = await fetchWithTimeout(
      `https://listen-api.listennotes.com/api/v2/search?${params}`,
      { headers: { 'X-ListenAPI-Key': apiKey } },
      SEARCH_TIMEOUT_MS,
    );
    if (!resp.ok) {
      console.warn(`Listen Notes search failed: HTTP ${resp.status}`);
      return null;
    }
    const data = (await resp.json()) as { results?: ListenNotesEpisode[] };
    episodes = data.results ?? [];
  } catch (err) {
    console.warn('Listen Notes search error:', (err as Error).message);
    return null;
  }

  const best = pickBestEpisode(episodes, title, show);
  if (!best?.audio) return null;

  return {
    title: best.title_original ?? title,
    publisher: best.podcast?.title_original ?? best.podcast?.publisher_original,
    audioURL: best.audio,
    durationSeconds: best.audio_length_sec,
  };
}

/** Score candidates by title overlap; a matching show name breaks ties. */
export function pickBestEpisode(
  episodes: ListenNotesEpisode[],
  title: string,
  show?: string,
): ListenNotesEpisode | null {
  const target = normalizeTitle(title);
  const targetShow = show ? normalizeTitle(show) : null;

  let best: ListenNotesEpisode | null = null;
  let bestScore = 0;

  for (const episode of episodes) {
    if (!episode.audio || !episode.title_original) continue;
    let score = wordOverlapScore(normalizeTitle(episode.title_original), target);
    if (score < MIN_TITLE_MATCH) continue;
    if (targetShow && episode.podcast?.title_original) {
      score += wordOverlapScore(normalizeTitle(episode.podcast.title_original), targetShow);
    }
    if (score > bestScore) {
      bestScore = score;
      best = episode;
    }
  }

  return best;
}
