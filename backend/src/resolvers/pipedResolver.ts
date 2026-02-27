/**
 * YouTube resolver using public Piped / Invidious / cobalt instances.
 *
 * Strategy (each tier races instances in parallel):
 *   1. Piped — open-source YT front-end, audio URLs proxied through Piped servers
 *   2. Invidious — similar project, different codebase and instance pool
 *   3. cobalt.tools — media extraction service, returns a proxied tunnel URL
 */

import type { ResolvedItem } from './resolver';

const TIMEOUT_MS = 10_000;

// ─── Instance lists ───────────────────────────────────────────────────────────

// https://github.com/TeamPiped/Piped/wiki/Instances
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://piped-api.garudalinux.org',
  'https://pipedapi.adminforge.de',
  'https://api.piped.yt',
  'https://pipedapi.in.projectsegfau.lt',
  'https://piped-api.codeberg.page',
  'https://watchapi.whatever.social',
  'https://api.piped.privacydev.net',
];

// https://api.invidious.io/instances.json
const INVIDIOUS_INSTANCES = [
  'https://invidious.io.lol',
  'https://invidious.privacyredirect.com',
  'https://invidious.nerdvpn.de',
  'https://inv.nadeko.net',
  'https://invidious.fdn.fr',
  'https://invidious.perennialte.ch',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function timedFetch(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Race a list of async tasks; log each individual failure so we can diagnose. */
async function raceWithLogging<T>(
  label: string,
  tasks: Array<{ name: string; promise: Promise<T> }>,
): Promise<T> {
  const tagged = tasks.map(({ name, promise }) =>
    promise.catch((err: unknown) => {
      console.log(`  ${label} [${name}] failed: ${(err as Error).message}`);
      throw err;
    }),
  );
  return Promise.any(tagged);
}

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
  const resp = await timedFetch(`${base}/streams/${videoId}`, {
    headers: { 'User-Agent': 'AudioQueue/1.0' },
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = (await resp.json()) as PipedResponse;
  if (!Array.isArray(data.audioStreams) || data.audioStreams.length === 0) {
    throw new Error('no audio streams');
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
    originalURL: '',
  };
}

// ─── Invidious ────────────────────────────────────────────────────────────────

interface InvidiousFormat {
  type: string;
  url: string;
  bitrate: number;
}

interface InvidiousResponse {
  title: string;
  author: string;
  lengthSeconds: number;
  videoThumbnails: Array<{ quality: string; url: string }>;
  adaptiveFormats: InvidiousFormat[];
}

async function fetchFromInvidious(base: string, videoId: string): Promise<ResolvedItem> {
  const resp = await timedFetch(
    `${base}/api/v1/videos/${videoId}?fields=title,author,lengthSeconds,videoThumbnails,adaptiveFormats`,
    { headers: { 'User-Agent': 'AudioQueue/1.0' } },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const data = (await resp.json()) as InvidiousResponse;
  const audioOnly = (data.adaptiveFormats ?? []).filter((f) => f.type.startsWith('audio/'));
  if (audioOnly.length === 0) throw new Error('no audio formats');

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
    originalURL: '',
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function extractYouTubeId(url: string): string | null {
  const short = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (short) return short[1];

  const long = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|v\/))([A-Za-z0-9_-]{11})/,
  );
  if (long) return long[1];

  return null;
}

export async function resolveViaPiped(url: string): Promise<ResolvedItem> {
  const videoId = extractYouTubeId(url);
  if (!videoId) throw new Error(`Not a YouTube URL: ${url}`);

  // Tier 1: Piped
  console.log(`YouTube resolver: trying ${PIPED_INSTANCES.length} Piped instances for ${videoId}`);
  try {
    const result = await raceWithLogging('Piped', PIPED_INSTANCES.map((base) => ({
      name: base,
      promise: fetchFromPiped(base, videoId),
    })));
    console.log(`YouTube resolver: Piped succeeded for ${videoId}`);
    return { ...result, originalURL: url };
  } catch {
    console.log(`YouTube resolver: all Piped failed, trying Invidious`);
  }

  // Tier 2: Invidious
  console.log(`YouTube resolver: trying ${INVIDIOUS_INSTANCES.length} Invidious instances for ${videoId}`);
  const result = await raceWithLogging('Invidious', INVIDIOUS_INSTANCES.map((base) => ({
    name: base,
    promise: fetchFromInvidious(base, videoId),
  }))).catch((err: unknown) => {
    throw new Error(`All YouTube resolvers failed for ${videoId}: ${(err as Error).message}`);
  });
  console.log(`YouTube resolver: Invidious succeeded for ${videoId}`);
  return { ...result, originalURL: url };
}
