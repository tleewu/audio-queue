/** Normalize a title for comparison: lowercase, strip punctuation, collapse spaces. */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Fraction of significant words (length > 3) shared between two strings,
 * relative to the larger word set. 1.0 = identical word sets, 0 = disjoint.
 */
export function wordOverlapScore(a: string, b: string): number {
  const words = (s: string) => new Set(s.split(/\s+/).filter((w) => w.length > 3));
  const aWords = words(a);
  const bWords = words(b);
  let overlap = 0;
  for (const w of aWords) if (bWords.has(w)) overlap++;
  const maxSize = Math.max(aWords.size, bWords.size);
  return maxSize === 0 ? 0 : overlap / maxSize;
}

/**
 * Fraction of `needle`'s significant words that appear in `haystack`.
 * Asymmetric on purpose: page titles are "episode title + platform
 * decorations", so extra words in the haystack must never hurt the score.
 */
export function containmentScore(needle: string, haystack: string): number {
  const words = (s: string) => new Set(s.split(/\s+/).filter((w) => w.length > 3));
  const needleWords = words(needle);
  if (needleWords.size === 0) return 0;
  const haystackWords = words(haystack);
  let overlap = 0;
  for (const w of needleWords) if (haystackWords.has(w)) overlap++;
  return overlap / needleWords.size;
}

/**
 * Queries to try against the search index, most specific first. Page titles
 * decorate the episode title around separator characters ("Guest: Topic |
 * Show #499"), so after the full title, retry with trailing segments dropped.
 * No knowledge of any particular show or format.
 */
export function queryCandidates(title: string): string[] {
  const segments = title.split(/\s*[|\u2022\u00b7\u2013\u2014]\s*/).filter(Boolean);
  const candidates = [title.trim()];
  for (let keep = segments.length - 1; keep >= 1; keep--) {
    candidates.push(segments.slice(0, keep).join(' ').trim());
  }
  return [...new Set(candidates.filter(Boolean))].slice(0, 4);
}

/**
 * Does the YouTube channel name corroborate the candidate's podcast title?
 * Names differ in shape ("All-In Podcast" vs "All-In with Chamath, Jason,
 * Sacks & Friedberg"), so this compares ALL words — short ones carry the
 * identity in names — after dropping generic filler.
 */
const SHOW_FILLER = new Set(['podcast', 'podcasts', 'show', 'the', 'with', 'official', 'channel', 'network']);

export function showMatchScore(channelName: string, podcastTitle: string): number {
  const words = (s: string) =>
    new Set(normalizeTitle(s).split(/\s+/).filter((w) => w && !SHOW_FILLER.has(w)));
  const channel = words(channelName);
  if (channel.size === 0) return 0;
  const podcast = words(podcastTitle);
  let overlap = 0;
  for (const w of channel) if (podcast.has(w)) overlap++;
  return overlap / channel.size;
}
