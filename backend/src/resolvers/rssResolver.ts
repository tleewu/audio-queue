import Parser from 'rss-parser';
import { ResolvedItem } from './resolver';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';

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

/**
 * Attempt to resolve a URL as a podcast RSS feed or direct audio file.
 *
 * Handles:
 *  - Direct .mp3 / .m4a / .ogg / .opus / .aac URLs
 *  - RSS / Atom feeds (podcast episodes — picks most recent item)
 *  - Substack /feed URLs
 */
export async function resolveRSS(url: string): Promise<ResolvedItem> {
  // 1. Direct audio file?
  const audioExtensions = /\.(mp3|m4a|ogg|opus|aac|flac|wav)(\?.*)?$/i;
  if (audioExtensions.test(url)) {
    const title = decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? url);
    return {
      sourceType: 'other',
      title,
      audioURL: url,
      originalURL: url,
    };
  }

  // 2. Try to parse as RSS/Atom feed
  let feedUrl = url;

  // Substack: convert article URL to feed URL
  if (url.includes('substack.com') && !url.endsWith('/feed')) {
    const base = new URL(url);
    feedUrl = `${base.protocol}//${base.hostname}/feed`;
  }

  const feed = await parser.parseURL(feedUrl);
  const item = feed.items?.[0];

  if (!item) {
    throw new Error('RSS feed has no items');
  }

  // Find the enclosure (audio file URL)
  const enclosureUrl =
    item.enclosure?.url ??
    (item as any).mediaContent?.[0]?.['$']?.url;

  if (!enclosureUrl) {
    throw new Error('No audio enclosure found in RSS item');
  }

  const durationSeconds = parseDuration((item as any).itunesDuration);
  // Prefer episode artwork over podcast/feed image
  const thumbnailURL =
    (item as any).itunesImage?.['$']?.href ??
    (item as any).mediaThumbnail?.['$']?.url ??
    feed.image?.url;

  const isSubstack = url.includes('substack.com');
  const sourceType = isSubstack ? 'substack' : 'podcast';

  return {
    sourceType,
    title: item.title ?? feed.title ?? url,
    publisher: feed.title ?? feed.author,
    audioURL: enclosureUrl,
    durationSeconds,
    thumbnailURL,
    originalURL: url,
  };
}

/**
 * Parse iTunes duration string (HH:MM:SS or MM:SS or raw seconds) → seconds.
 */
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
