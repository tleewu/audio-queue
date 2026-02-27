import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface YtDlpInfo {
  title: string;
  uploader?: string;
  channel?: string;
  duration?: number;         // seconds
  thumbnail?: string;
  url: string;               // direct audio stream URL
  extractor: string;         // e.g. "youtube", "soundcloud"
  webpage_url: string;
}

/**
 * Extract YouTube video ID from any standard YouTube URL form.
 * Returns null if the URL is not a recognisable YouTube URL.
 */
export function extractYouTubeId(url: string): string | null {
  const short = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];

  const long = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{11})/,
  );
  if (long) return long[1];

  return null;
}

/**
 * Runs yt-dlp and returns parsed JSON info for the given URL.
 * Selects best audio-only format and does NOT download.
 * Throws if yt-dlp exits non-zero or the URL is unsupported.
 *
 * Uses execFile (not exec) so args are passed directly — no shell
 * interpretation of brackets, quotes, or special characters.
 */
export async function execYtDlp(url: string, timeoutMs = 30_000): Promise<YtDlpInfo> {
  const args = [
    '--dump-json',
    '--no-playlist',
    '-f', 'bestaudio[ext=m4a]/bestaudio[acodec=mp4a]/bestaudio/best',
    '--extractor-args', 'youtube:player_client=tv_embedded',
    '--no-warnings',
    '--quiet',
    url,
  ];

  const { stdout } = await execFileAsync('yt-dlp', args, {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });

  const info = JSON.parse(stdout.trim()) as YtDlpInfo;

  if (!info.url) {
    throw new Error('yt-dlp returned no stream URL');
  }

  return info;
}
