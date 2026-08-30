import * as cheerio from 'cheerio';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { containmentScore, normalizeTitle, queryCandidates, showMatchScore } from '../utils/textMatch';

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
/** Fallback cap for pages that never close <head>. */
const MAX_HTML_BYTES = 2_000_000;
/**
 * Minimum share of the episode title's significant words that must appear in
 * the page title. A true match contains the episode title almost verbatim and
 * scores ~1.0, so anything much lower is a different episode.
 */
const MIN_TITLE_MATCH = 0.7;

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
  // YouTube serves datacenter IPs a stub page titled "- YouTube" while a
  // browser gets the real thing, so scraping it from a server is unreliable by
  // design. oEmbed is a supported API, returns exactly the title and channel we
  // need, and is not subject to that treatment.
  if (isYouTube(url)) {
    const viaOEmbed = await fetchYouTubeOEmbed(url);
    if (viaOEmbed) return viaOEmbed;
  }

  let html: string;
  try {
    const resp = await fetchWithTimeout(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' } },
      PAGE_TIMEOUT_MS,
    );
    if (!resp.ok) {
      // Silent until now, and the actual failure in production: YouTube answers
      // datacenter IPs with 429/403 where a laptop gets the page.
      console.warn(`Page fetch for ${url} returned HTTP ${resp.status} ${resp.statusText}`);
      return null;
    }
    // Everything we parse lives in <head>, so cut on the head boundary rather
    // than a flat byte count: YouTube's <head> alone runs past 700 KB, and a
    // fixed cap sliced og:title off the end and left the item titled by its URL.
    const text = await resp.text();
    const headEnd = text.indexOf('</head>');
    html = headEnd > -1 ? text.slice(0, headEnd + 7) : text.slice(0, MAX_HTML_BYTES);
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
  if (!rawTitle) {
    // No title at all usually means we were served something other than the
    // real page — a consent wall or bot check, which datacenter IPs see far
    // more often than a laptop does. Record enough to tell them apart.
    console.warn(`No title found for ${url}: ${html.length} bytes, starts ${JSON.stringify(html.slice(0, 120))}`);
    return null;
  }

  const site = meta('meta[property="og:site_name"]') ?? host;
  let title = cleanTitle(rawTitle);
  // cleanTitle can strip a page title down to nothing — an age-gated or
  // unavailable YouTube video titles itself just "- YouTube". There is nothing
  // to search for, and Listen Notes rejects a blank q with a 400.
  if (!title) {
    console.warn(`Title cleaned to nothing for ${url}: raw was ${JSON.stringify(rawTitle)}`);
    return null;
  }
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

function isYouTube(url: string): boolean {
  const host = hostOf(url);
  return host === 'youtube.com' || host === 'youtu.be' || host.endsWith('.youtube.com');
}

/** Title and channel straight from YouTube's oEmbed API — no page scraping. */
export async function fetchYouTubeOEmbed(url: string): Promise<PageMeta | null> {
  const endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  try {
    const resp = await fetchWithTimeout(
      endpoint,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } },
      PAGE_TIMEOUT_MS,
    );
    if (!resp.ok) {
      // 401/404 here is normal for private, deleted, or age-gated videos.
      console.warn(`YouTube oEmbed for ${url} returned HTTP ${resp.status}`);
      return null;
    }
    const data = (await resp.json()) as { title?: string; author_name?: string };
    const title = cleanTitle(data.title ?? '');
    if (!title) return null;
    return {
      title,
      show: data.author_name ? cleanTitle(data.author_name) : undefined,
      site: 'YouTube',
    };
  } catch (err) {
    console.warn(`YouTube oEmbed failed for ${url}:`, (err as Error).message);
    return null;
  }
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

  // The page title is the episode title plus platform decorations, and the
  // search index only knows the former — so the full title can find nothing
  // while a trimmed one hits exactly. Probe most-specific first; acceptance is
  // always judged against the full page title, so a short probe cannot
  // false-positive its way in.
  for (const query of queryCandidates(title)) {
    const episodes = await searchEpisodes(apiKey, query);
    const best = pickBestEpisode(episodes, title, show);
    if (best?.audio) {
      return {
        title: best.title_original ?? title,
        publisher: best.podcast?.title_original ?? best.podcast?.publisher_original,
        audioURL: best.audio,
        durationSeconds: best.audio_length_sec,
      };
    }
  }
  return null;
}

async function searchEpisodes(apiKey: string, query: string): Promise<ListenNotesEpisode[]> {
  // q is the only required parameter; a blank one is a guaranteed 400.
  if (!query.trim()) return [];

  const params = new URLSearchParams({
    q: query.trim(),
    type: 'episode',
    only_in: 'title',
    safe_mode: '0',
    page_size: '10',
  });

  try {
    const resp = await fetchWithTimeout(
      `https://listen-api.listennotes.com/api/v2/search?${params}`,
      { headers: { 'X-ListenAPI-Key': apiKey } },
      SEARCH_TIMEOUT_MS,
    );
    if (!resp.ok) {
      // Listen Notes explains 4xx in the body; without it a 400 is undiagnosable.
      const detail = await resp.text().catch(() => '');
      console.warn(
        `Listen Notes search failed: HTTP ${resp.status} ${detail.slice(0, 300)} ` +
          `(q=${JSON.stringify(query)}, len=${query.length})`,
      );
      return [];
    }
    const data = (await resp.json()) as { results?: ListenNotesEpisode[] };
    return data.results ?? [];
  } catch (err) {
    console.warn('Listen Notes search error:', (err as Error).message);
    return [];
  }
}

/**
 * Accept an episode only when its own title is contained in the page title.
 * The containment is asymmetric — extra words in the page title (platform
 * decorations, show names, episode numbers) never lower the score — which is
 * what lets the search be probed with trimmed queries safely. A matching show
 * name breaks ties.
 */
export function pickBestEpisode(
  episodes: ListenNotesEpisode[],
  pageTitle: string,
  show?: string,
): ListenNotesEpisode | null {
  const target = normalizeTitle(pageTitle);
  const targetShow = show ? normalizeTitle(show) : null;

  let best: ListenNotesEpisode | null = null;
  let bestScore = 0;

  const distinctiveWords = target.split(/\s+/).filter((w) => w.length > 3).length;

  for (const episode of episodes) {
    if (!episode.audio || !episode.title_original) continue;
    const titleScore = containmentScore(normalizeTitle(episode.title_original), target);
    if (titleScore < MIN_TITLE_MATCH) continue;

    const showScore =
      targetShow && episode.podcast?.title_original
        ? showMatchScore(targetShow, normalizeTitle(episode.podcast.title_original))
        : 0;

    // When we know the show, demand it corroborates the match — unless the
    // title evidence alone is overwhelming. Channel and feed names legitimately
    // diverge ("PowerfulJRE" vs "The Joe Rogan Experience"), so a near-exact,
    // distinctive title may stand on its own; a short generic one may not
    // cross shows.
    if (targetShow && showScore < 0.5 && !(titleScore >= 0.9 && distinctiveWords >= 4)) {
      continue;
    }

    const score = titleScore + showScore;
    if (score > bestScore) {
      bestScore = score;
      best = episode;
    }
  }

  return best;
}
