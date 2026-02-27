import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

// Write YOUTUBE_COOKIES env var to a temp file once per process lifetime.
// undefined = not yet checked; null = env var not set; string = file path.
let cookieFilePath: string | null | undefined = undefined;

function getCookieFilePath(): string | null {
  if (cookieFilePath !== undefined) return cookieFilePath;

  const cookies = process.env.YOUTUBE_COOKIES?.trim();
  if (!cookies) {
    cookieFilePath = null;
    return null;
  }

  const path = join(tmpdir(), 'yt-cookies.txt');
  writeFileSync(path, cookies, 'utf-8');
  cookieFilePath = path;
  console.log('ytdlp: cookie file written to', path);
  return path;
}

/**
 * Returns true if YOUTUBE_COOKIES is configured in the environment.
 * Used by callers to decide whether to try yt-dlp for YouTube.
 */
export function hasYouTubeCookies(): boolean {
  return !!process.env.YOUTUBE_COOKIES?.trim();
}

/**
 * Runs yt-dlp and returns parsed JSON info for the given URL.
 * Selects best audio-only format and does NOT download.
 * Throws if yt-dlp exits non-zero or the URL is unsupported.
 *
 * Uses execFile (not exec) so args are passed directly — no shell
 * interpretation of brackets, quotes, or special characters.
 *
 * When YOUTUBE_COOKIES is set, passes --cookies <file> to yt-dlp so
 * that a real browser session is used, bypassing YouTube bot detection
 * on Railway's datacenter IP.
 */
export async function execYtDlp(url: string, timeoutMs = 30_000): Promise<YtDlpInfo> {
  const args = [
    '--dump-json',
    '--no-playlist',
    '-f', 'bestaudio[ext=m4a]/bestaudio[acodec=mp4a]/bestaudio/best',
    '--extractor-args', 'youtube:player_client=tv_embedded',
    '--no-warnings',
    '--quiet',
  ];

  const cookiePath = getCookieFilePath();
  if (cookiePath) {
    args.push('--cookies', cookiePath);
  }

  args.push(url);

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
