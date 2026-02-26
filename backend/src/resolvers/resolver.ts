import { execYtDlp } from '../utils/ytdlp';
import { resolveRSS } from './rssResolver';

export type SourceType =
  | 'podcast'
  | 'youtube'
  | 'soundcloud'
  | 'substack'
  | 'other'
  | 'unsupported';

export interface ResolvedItem {
  sourceType: SourceType;
  title: string;
  publisher?: string;
  audioURL?: string;         // direct stream URL; undefined if unsupported
  durationSeconds?: number;
  thumbnailURL?: string;
  originalURL: string;
}

/**
 * Master resolver — tries yt-dlp first, RSS second, returns unsupported on total failure.
 *
 * yt-dlp covers YouTube, SoundCloud, Vimeo, Twitch clips, and hundreds of other sites.
 * RSS covers standard podcast feeds, Substack, and direct audio file URLs.
 */
export async function dispatch(url: string): Promise<ResolvedItem> {
  // 1. Try yt-dlp (YouTube, SoundCloud, and 1000+ sites)
  try {
    const info = await execYtDlp(url);
    return {
      sourceType: classifyExtractor(url, info.extractor),
      title: info.title,
      publisher: info.uploader ?? info.channel,
      audioURL: info.url,
      durationSeconds: info.duration,
      thumbnailURL: info.thumbnail,
      originalURL: url,
    };
  } catch (ytErr) {
    console.log(`yt-dlp failed for ${url}:`, (ytErr as Error).message);
  }

  // 2. Try RSS / podcast / direct audio
  try {
    return await resolveRSS(url);
  } catch (rssErr) {
    console.log(`RSS failed for ${url}:`, (rssErr as Error).message);
  }

  // 3. Unsupported
  return {
    sourceType: 'unsupported',
    title: url,
    audioURL: undefined,
    originalURL: url,
  };
}

/**
 * Map yt-dlp extractor name to our SourceType enum.
 */
function classifyExtractor(url: string, extractor: string): SourceType {
  const e = extractor.toLowerCase();

  if (e.includes('youtube')) return 'youtube';
  if (e.includes('soundcloud')) return 'soundcloud';

  if (
    url.includes('substack.com') ||
    e.includes('substack')
  ) return 'substack';

  // Anything else yt-dlp can handle is "other" (Vimeo, Twitch, etc.)
  return 'other';
}
