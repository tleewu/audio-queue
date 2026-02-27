/**
 * YouTube resolver using public Piped / Invidious instances.
 *
 * Both are open-source YouTube front-ends whose APIs return audio stream URLs
 * proxied through their own servers — no IP locking, no bot detection on our end.
 *
 * Strategy:
 *   1. Race all Piped instances (Promise.any, 10s each) — return first success
 *   2. If all Piped are down, race all Invidious instances
 *   3. Throw if everything fails
 */

import type { ResolvedItem } from './resolver';

const TIMEOUT_MS = 10_000;

// Public Piped API instances.  API: GET {base}/streams/{videoId}
// Full list at https://github.com/TeamPiped/Piped/wiki/Instances
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.in.projectsegfau.lt',
];

// Public Invidious API instances.  API: GET {base}/api/v1/videos/{videoId}
// Full list at https://api.invidious.io/instances.json?sort_by=health
const INVIDIOUS_INSTANCES = [
  'https://invidious.io.lol',
  'https://invidious.privacyredirect.com',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
];

// ─── Piped ────────────────────────────────────────────────────────────────────

interface PipedStream {
  url: string;
  mimeType: string;
  quality: string;
  bitrate: number;
}

interface PipedResponse {
  title: string;
  uploader: string;
  thumbnailUrl: string;
  duration: number;
  audioStreams: PipedStream[];
}

async function fetchFromPiped(base: string, videoId: string): Promise<ResolvedItem> {
  const url = `${base}/streams/${videoId}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AudioQueue/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw new Error(`Piped ${base} → ${resp.status}`);

  const data = (await resp.json()) as PipedResponse;
  if (!Array.isArray(data.audioStreams) || data.audioStreams.length === 0) {
    throw new Error(`Piped ${base}: no audio streams`);
  }

  const m4a = data.audioStreams.filter(
    (s) => s.mimeType.includes('audio/mp4') || s.mimeType.includes('mp4a'),
  );
  const pool = m4a.length > 0 ? m4a : data.audioStreams;
  const best = pool.reduce((a, b) => (b.bitrate > a.bitrate ? b : a));

  return {
    sourceType: 'youtube',
    title: data.title,
    publisher: data.uploader,
    audioURL: best.url,
    durationSeconds: data.duration,
    thumbnailURL: data.thumbnailUrl,
    originalURL: '',   // filled in by caller
  };
}

// ─── Invidious ────────────────────────────────────────────────────────────────

interface InvidiousFormat {
  type: string;     // e.g. "audio/mp4; codecs=\"mp4a.40.2\""
  url: string;
  bitrate: number;
  container?: string;
}

interface InvidiousResponse {
  title: string;
  author: string;
  lengthSeconds: number;
  videoThumbnails: Array<{ quality: string; url: string }>;
  adaptiveFormats: InvidiousFormat[];
}

async function fetchFromInvidious(base: string, videoId: string): Promise<ResolvedItem> {
  const url = `${base}/api/v1/videos/${videoId}?fields=title,author,lengthSeconds,videoThumbnails,adaptiveFormats`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let resp: Response;
  try {
    resp = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'AudioQueue/1.0' },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) throw new Error(`Invidious ${base} → ${resp.status}`);

  const data = (await resp.json()) as InvidiousResponse;
  const audioOnly = (data.adaptiveFormats ?? []).filter(
    (f) => f.type.startsWith('audio/'),
  );
  if (audioOnly.length === 0) throw new Error(`Invidious ${base}: no audio formats`);

  const m4a = audioOnly.filter(
    (f) => f.type.includes('audio/mp4') || f.type.includes('mp4a'),
  );
  const pool = m4a.length > 0 ? m4a : audioOnly;
  const best = pool.reduce((a, b) => (b.bitrate > a.bitrate ? b : a));

  const thumb =
    data.videoThumbnails?.find((t) => t.quality === 'maxresdefault')?.url ??
    data.videoThumbnails?.[0]?.url;

  return {
    sourceType: 'youtube',
    title: data.title,
    publisher: data.author,
    audioURL: best.url,
    durationSeconds: data.lengthSeconds,
    thumbnailURL: thumb,
    originalURL: '',   // filled in by caller
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

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
 * Resolve a YouTube URL via Piped (preferred) or Invidious (fallback).
 * Races all instances of each provider in parallel; returns first success.
 * Throws only if every instance of every provider fails.
 */
export async function resolveViaPiped(url: string): Promise<ResolvedItem> {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Not a YouTube URL: ${url}`);

  console.log(`YouTube resolver: trying Piped instances for ${videoId}`);

  // Try all Piped instances concurrently; use first success
  let result: ResolvedItem | null = null;
  try {
    result = await Promise.any(
      PIPED_INSTANCES.map((base) => fetchFromPiped(base, videoId)),
    );
    console.log(`YouTube resolver: Piped succeeded for ${videoId}`);
  } catch {
    console.log(`YouTube resolver: all Piped instances failed for ${videoId}, trying Invidious`);
  }

  if (!result) {
    result = await Promise.any(
      INVIDIOUS_INSTANCES.map((base) => fetchFromInvidious(base, videoId)),
    ).catch(() => {
      throw new Error(`All Piped and Invidious instances failed for ${videoId}`);
    });
    console.log(`YouTube resolver: Invidious succeeded for ${videoId}`);
  }

  return {
    sourceType: result.sourceType ?? 'youtube',
    title: result.title ?? '',
    publisher: result.publisher,
    audioURL: result.audioURL,
    durationSeconds: result.durationSeconds,
    thumbnailURL: result.thumbnailURL,
    originalURL: url,
  };
}
