/**
 * Piped API resolver for YouTube URLs.
 *
 * Piped (https://github.com/TeamPiped/Piped) is an open-source YouTube front-end
 * whose API returns audio stream URLs that are proxied through Piped's own servers.
 * This means:
 *   - No bot detection (Piped handles that)
 *   - No IP locking (URLs are served via Piped's infrastructure, not our Railway IP)
 *   - No yt-dlp needed for YouTube
 *
 * API: GET https://pipedapi.kavin.rocks/streams/{videoId}
 * Returns audioStreams array sorted by bitrate; we prefer the highest-quality m4a/mp4a
 * stream so ffmpeg can copy the audio container without re-encoding.
 */

import type { ResolvedItem } from './resolver';

const PIPED_API = 'https://pipedapi.kavin.rocks';
const TIMEOUT_MS = 15_000;

interface PipedStream {
  url: string;
  mimeType: string;   // e.g. "audio/mp4; codecs=\"mp4a.40.2\""
  quality: string;    // e.g. "128k"
  bitrate: number;
  codec: string;      // e.g. "mp4a.40.2"
  audioTrackName?: string;
}

interface PipedResponse {
  title: string;
  uploader: string;
  uploaderUrl: string;
  thumbnailUrl: string;
  duration: number;        // seconds
  audioStreams: PipedStream[];
}

/**
 * Extract YouTube video ID from any standard YouTube URL form.
 * Returns null if the URL is not a recognisable YouTube URL.
 */
export function extractYouTubeId(url: string): string | null {
  // youtu.be/ID
  const short = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];

  // youtube.com/watch?v=ID  or  /embed/ID  or  /shorts/ID  or  /v/ID
  const long = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{11})/);
  if (long) return long[1];

  return null;
}

/**
 * Resolve a YouTube URL via the Piped API.
 * Returns a ResolvedItem with a proxied audio URL (served by Piped, not Railway).
 * Throws if the video is unavailable or Piped returns an unexpected response.
 */
export async function resolveViaPiped(url: string): Promise<ResolvedItem> {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Not a YouTube URL: ${url}`);

  const apiUrl = `${PIPED_API}/streams/${videoId}`;
  console.log(`Piped: resolving ${videoId} via ${apiUrl}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AudioQueue/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    throw new Error(`Piped API ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = (await resp.json()) as PipedResponse;

  if (!Array.isArray(data.audioStreams) || data.audioStreams.length === 0) {
    throw new Error(`Piped returned no audio streams for ${videoId}`);
  }

  // Prefer m4a/mp4a (AAC) streams — ffmpeg can copy-container these without re-encoding.
  // Among those, take the highest bitrate. Fall back to any stream if none are m4a.
  const m4aStreams = data.audioStreams.filter(
    (s) => s.mimeType.includes('audio/mp4') || s.mimeType.includes('mp4a'),
  );
  const candidates = m4aStreams.length > 0 ? m4aStreams : data.audioStreams;
  const best = candidates.reduce((a, b) => (b.bitrate > a.bitrate ? b : a));

  console.log(`Piped: ${videoId} → ${best.mimeType} ${best.quality} bitrate=${best.bitrate}`);

  return {
    sourceType: 'youtube',
    title: data.title,
    publisher: data.uploader,
    audioURL: best.url,
    durationSeconds: data.duration,
    thumbnailURL: data.thumbnailUrl,
    originalURL: url,
  };
}
