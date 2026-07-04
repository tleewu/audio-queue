import { execYtDlp, extractYouTubeId, isTwitterUrl } from '../utils/ytdlp';
import { resolveRSS } from './rssResolver';
import { resolvePodcastPlatform, resolveYouTubeViaPodcastIndex } from './podcastIndexResolver';

export type SourceType =
  | 'podcast'
  | 'youtube'
  | 'x'
  | 'soundcloud'
  | 'substack'
  | 'other'
  | 'unsupported';

/**
 * How the client plays the item:
 *   direct   — audioURL is a stable public stream (podcast CDN, HLS); play it as-is
 *   proxy    — audioURL expires or is IP-locked to this server (yt-dlp results);
 *              client streams via GET /api/stream/:id which re-resolves on expiry
 *   external — no in-app audio; client opens originalURL in the source app
 */
export type PlaybackType = 'direct' | 'proxy' | 'external';

export interface ResolvedItem {
  sourceType: SourceType;
  playbackType: PlaybackType;
  title: string;
  publisher?: string;
  audioURL?: string;
  durationSeconds?: number;
  thumbnailURL?: string;
  originalURL: string;
}

export async function dispatch(url: string): Promise<ResolvedItem> {
  // 0. Spotify / Apple Podcasts → podcast directory lookup → direct episode audio.
  //    We never play from the platform page itself: every podcast link is mapped
  //    to the episode's own CDN audio via Listen Notes / Podcast Index / iTunes.
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
    return unsupported(url);
  }

  // 1. YouTube — three tiers:
  //    a) The video is also a podcast episode on an RSS feed → direct podcast audio.
  //    b) yt-dlp can extract an audio stream → in-app playback via the stream proxy.
  //    c) Neither → metadata only, opens in the YouTube app.
  if (extractYouTubeId(url)) {
    const rssResult = await resolveYouTubeViaPodcastIndex(url).catch((err: unknown) => {
      console.log(`YouTube→Podcast lookup failed for ${url}:`, (err as Error).message);
      return null;
    });
    if (rssResult) return rssResult;

    const viaYtDlp = await tryYtDlp(url);
    if (viaYtDlp) return viaYtDlp;

    const meta = await fetchYouTubeMeta(url);
    return {
      sourceType: 'youtube',
      playbackType: 'external',
      title: meta?.title ?? url,
      publisher: meta?.channelName,
      thumbnailURL: meta?.thumbnailURL,
      audioURL: undefined,
      originalURL: url,
    };
  }

  // 2. X / Twitter video — yt-dlp extraction, else open in the X app.
  if (isTwitterUrl(url)) {
    const viaYtDlp = await tryYtDlp(url);
    if (viaYtDlp) return viaYtDlp;
    return {
      sourceType: 'x',
      playbackType: 'external',
      title: url,
      audioURL: undefined,
      originalURL: url,
    };
  }

  // 3. RSS / podcast / direct audio — try before yt-dlp so podcast feeds
  //    resolve with proper episode title & podcast author from the feed.
  try {
    return await resolveRSS(url);
  } catch (err) {
    console.log(`RSS failed for ${url}:`, (err as Error).message);
  }

  // 4. yt-dlp for everything else it supports (SoundCloud, Vimeo, Twitch VODs, …)
  const viaYtDlp = await tryYtDlp(url);
  if (viaYtDlp) return viaYtDlp;

  // 5. Unsupported
  return unsupported(url);
}

function unsupported(url: string): ResolvedItem {
  return {
    sourceType: 'unsupported',
    playbackType: 'external',
    title: url,
    audioURL: undefined,
    originalURL: url,
  };
}

// ---------------------------------------------------------------------------
// yt-dlp extraction → proxy (or direct for HLS playlists, which AVPlayer
// streams natively and which cannot be piped through a single-response proxy)
// ---------------------------------------------------------------------------

async function tryYtDlp(url: string): Promise<ResolvedItem | null> {
  try {
    const info = await execYtDlp(url);
    return {
      sourceType: classifyExtractor(url, info.extractor),
      playbackType: isHlsUrl(info.url) ? 'direct' : 'proxy',
      title: info.title,
      publisher: info.uploader ?? info.channel,
      audioURL: info.url,
      durationSeconds: info.duration,
      thumbnailURL: info.thumbnail,
      originalURL: url,
    };
  } catch (err) {
    console.log(`yt-dlp failed for ${url}:`, (err as Error).message);
    return null;
  }
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8($|\?)/i.test(url);
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

export function classifyExtractor(url: string, extractor: string): SourceType {
  const e = extractor.toLowerCase();
  if (e.includes('youtube')) return 'youtube';
  if (e.includes('twitter') || e.includes('periscope')) return 'x';
  if (e.includes('soundcloud')) return 'soundcloud';
  if (url.includes('substack.com') || e.includes('substack')) return 'substack';
  return 'other';
}
