import Parser from 'rss-parser';
import { ResolvedItem } from './resolver';
import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { parseDuration } from '../utils/parseDuration';

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
const audioExtensions = /\.(mp3|m4a|ogg|opus|aac|flac|wav)(\?.*)?$/i;

export function isDirectAudioURL(url: string): boolean {
  return audioExtensions.test(url);
}

export function titleFromAudioURL(url: string): string {
  return decodeURIComponent(url.split('/').pop()?.split('?')[0] ?? url);
}

export async function resolveRSS(url: string): Promise<ResolvedItem> {
  // 1. Direct audio file?
  if (isDirectAudioURL(url)) {
    return {
      sourceType: 'other',
      title: titleFromAudioURL(url),
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

