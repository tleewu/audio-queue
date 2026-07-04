import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { normalizeTitle, wordOverlapScore } from '../utils/textMatch';
import { ResolvedItem } from './resolver';

/**
 * Listen Notes episode search — the strongest episode-level matcher we have.
 * Given an episode title (and optionally the show name), returns the episode's
 * direct audio URL from the podcast's own CDN.
 *
 * Requires LISTEN_NOTES_API_KEY. When unset this resolver is skipped and the
 * pipeline falls back to Podcast Index + RSS matching, which is free but only
 * feed-level (we then scan the feed for the episode ourselves).
 */

interface ListenNotesEpisode {
  audio?: string;
  audio_length_sec?: number;
  title_original?: string;
  image?: string;
  thumbnail?: string;
  podcast?: {
    title_original?: string;
    publisher_original?: string;
  };
}

export function isListenNotesConfigured(): boolean {
  return !!process.env.LISTEN_NOTES_API_KEY?.trim();
}

export async function resolveEpisodeViaListenNotes(
  episodeTitle: string,
  showName?: string,
): Promise<ResolvedItem | null> {
  const apiKey = process.env.LISTEN_NOTES_API_KEY?.trim();
  if (!apiKey) return null;

  const params = new URLSearchParams({
    q: episodeTitle,
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
      8_000,
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

  const best = pickBestEpisode(episodes, episodeTitle, showName);
  if (!best?.audio) return null;

  return {
    sourceType: 'podcast',
    playbackType: 'direct',
    title: best.title_original ?? episodeTitle,
    publisher: best.podcast?.title_original ?? best.podcast?.publisher_original,
    audioURL: best.audio,
    durationSeconds: best.audio_length_sec,
    thumbnailURL: best.image ?? best.thumbnail,
    originalURL: '',
  };
}

/** Score candidates by title overlap; require a decent match, prefer matching show name. */
export function pickBestEpisode(
  episodes: ListenNotesEpisode[],
  episodeTitle: string,
  showName?: string,
): ListenNotesEpisode | null {
  const target = normalizeTitle(episodeTitle);
  const targetShow = showName ? normalizeTitle(showName) : null;

  let best: ListenNotesEpisode | null = null;
  let bestScore = 0;

  for (const ep of episodes) {
    if (!ep.audio || !ep.title_original) continue;
    let score = wordOverlapScore(normalizeTitle(ep.title_original), target);
    if (score < 0.5) continue;
    if (targetShow && ep.podcast?.title_original) {
      const showScore = wordOverlapScore(normalizeTitle(ep.podcast.title_original), targetShow);
      score += showScore; // matching show breaks ties between similarly-titled episodes
    }
    if (score > bestScore) {
      bestScore = score;
      best = ep;
    }
  }

  return best;
}
