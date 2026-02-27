import { execYtDlp, extractYouTubeId } from '../utils/ytdlp';
import { resolveRSS } from './rssResolver';
import { resolvePodcastPlatform, resolveYouTubeViaPodcastIndex } from './podcastIndexResolver';

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
  audioURL?: string;         // direct stream URL; undefined means open externally
  durationSeconds?: number;
  thumbnailURL?: string;
  originalURL: string;
}

export async function dispatch(url: string): Promise<ResolvedItem> {
  // 0. Spotify / Apple Podcasts → Podcast Index → RSS
  if (
    url.includes('open.spotify.com/show') ||
    url.includes('open.spotify.com/episode') ||
    url.includes('podcasts.apple.com')
  ) {
    try {
      const result = await resolvePodcastPlatform(url);
      if (result) return { ...result, originalURL: url };
    } catch (err) {
      console.log(`Podcast platform resolver failed for ${url}:`, (err as Error).message);
    }
    return { sourceType: 'unsupported', title: url, audioURL: undefined, originalURL: url };
  }

  // 1. YouTube — check if the video is also a podcast episode on an RSS feed.
  //    If found: return playable podcast audio.
  //    If not:   return sourceType='youtube' with no audioURL → iOS opens in YouTube app.
  if (extractYouTubeId(url)) {
    const rssResult = await resolveYouTubeViaPodcastIndex(url).catch((err: unknown) => {
      console.log(`YouTube→Podcast lookup failed for ${url}:`, (err as Error).message);
      return null;
    });
    if (rssResult) return rssResult;

    // No RSS match — resolve metadata only (title, thumbnail) via oEmbed for display
    const meta = await fetchYouTubeMeta(url);
    return {
      sourceType: 'youtube',
      title: meta?.title ?? url,
      publisher: meta?.channelName,
      thumbnailURL: meta?.thumbnailURL,
      audioURL: undefined,   // signals iOS to open in YouTube app
      originalURL: url,
    };
  }

  // 2. yt-dlp for non-YouTube sites (SoundCloud, Vimeo, etc.)
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
  } catch (err) {
    console.log(`yt-dlp failed for ${url}:`, (err as Error).message);
  }

  // 3. RSS / podcast / direct audio
  try {
    return await resolveRSS(url);
  } catch (err) {
    console.log(`RSS failed for ${url}:`, (err as Error).message);
  }

  // 4. Unsupported
  return { sourceType: 'unsupported', title: url, audioURL: undefined, originalURL: url };
}

// ---------------------------------------------------------------------------
// YouTube oEmbed metadata (title + channel, no auth)
// ---------------------------------------------------------------------------

interface YouTubeMeta { title: string; channelName: string; thumbnailURL?: string }

async function fetchYouTubeMeta(url: string): Promise<YouTubeMeta | null> {
  try {
    const videoId = extractYouTubeId(url);
    if (!videoId) return null;
    const resp = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as { title: string; author_name: string; thumbnail_url?: string };
    return { title: data.title, channelName: data.author_name, thumbnailURL: data.thumbnail_url };
  } catch {
    return null;
  }
}

function classifyExtractor(url: string, extractor: string): SourceType {
  const e = extractor.toLowerCase();
  if (e.includes('soundcloud')) return 'soundcloud';
  if (url.includes('substack.com') || e.includes('substack')) return 'substack';
  return 'other';
}
