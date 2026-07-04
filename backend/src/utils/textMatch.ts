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
