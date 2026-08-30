import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve } from '../resolvers/podcast';

/**
 * Platform matrix for the resolver — the core product logic.
 *
 * Success criteria:
 *   TRUE POSITIVE — a link to real podcast content resolves to that exact
 *   episode with playable audio. Never a different episode, never a
 *   different show.
 *   TRUE NEGATIVE — a link to non-podcast content (a clip, a lecture, a
 *   song) resolves to a web item. The resolver must not manufacture a match.
 *
 * Every mock below mirrors a response shape observed live on 2026-08-30.
 */

const KEY = 'test-listen-notes-key';

const html = (body: string) => ({ ok: true, text: async () => body }) as unknown as Response;
const json = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

const oembed = (title: string, channel: string, thumb = 'https://i.ytimg.com/vi/x/hqdefault.jpg') =>
  json({ title, author_name: channel, thumbnail_url: thumb });

const lnResults = (...episodes: unknown[]) => json({ results: episodes });

const lnEpisode = (title: string, podcast: string, audio = `https://cdn.example.com/${encodeURIComponent(title)}.mp3`) => ({
  audio,
  audio_length_sec: 3600,
  image: `https://cdn.example.com/art/${encodeURIComponent(title)}.jpg`,
  title_original: title,
  podcast: { title_original: podcast },
});

beforeEach(() => {
  process.env.LISTEN_NOTES_API_KEY = KEY;
});
afterEach(() => {
  delete process.env.LISTEN_NOTES_API_KEY;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------

describe('YouTube', () => {
  it('TP: a full episode with a decorated title resolves to that exact episode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        oembed('Gary Gallagher: American Civil War, Slavery, Lincoln | Lex Fridman Podcast #499', 'Lex Fridman'),
      )
      // full decorated title: index has nothing
      .mockResolvedValueOnce(lnResults())
      // trimmed probe hits
      .mockResolvedValueOnce(
        lnResults(lnEpisode('#499 – Gary Gallagher: American Civil War, Slavery, Lincoln', 'Lex Fridman Podcast')),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://www.youtube.com/watch?v=XyXBwO5jYpw');

    expect(item.audioURL).toBeTruthy();
    expect(item.title).toBe('#499 – Gary Gallagher: American Civil War, Slavery, Lincoln');
    expect(item.publisher).toBe('Lex Fridman Podcast');
    // the episode's own artwork beats the video thumbnail
    expect(item.imageURL).toContain('cdn.example.com/art/');
  });

  it('TN: a clip from a podcast channel stays a web item — no episode exists for it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(oembed('David Friedberg: Government Spending Ruins Everything it Touches', 'All-In Podcast'))
      // the search can only offer episodes that are NOT this clip
      .mockResolvedValueOnce(
        lnResults(lnEpisode('Government Spending Special: David Friedberg Extended Interview', 'Some Other Money Show')),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://www.youtube.com/watch?v=m-HbN9IHF-A');

    expect(item.audioURL).toBeUndefined();
    expect(item.title).toBe('David Friedberg: Government Spending Ruins Everything it Touches');
    // still artwork: a web item falls back to the page thumbnail
    expect(item.imageURL).toBe('https://i.ytimg.com/vi/x/hqdefault.jpg');
  });

  it('TN: a lecture with a short generic title cannot grab audio from an unrelated show', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(oembed('Introduction to Machine Learning', 'MIT OpenCourseWare'))
      // an unrelated show happens to have an identically-titled episode
      .mockResolvedValueOnce(lnResults(lnEpisode('Introduction to Machine Learning', 'The AI Chat Show')));
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://www.youtube.com/watch?v=lecture1');

    expect(item.audioURL).toBeUndefined();
  });

  it('TN: a fresh episode not yet indexed is not confused with an older similar one', async () => {
    // Observed live: page is Lex #501 (DHH), index only has #474 (also DHH,
    // near-identical title). The wrong episode must be rejected.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        oembed('DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux | Lex Fridman Podcast #501', 'Lex Fridman'),
      )
      .mockResolvedValueOnce(lnResults())
      .mockResolvedValueOnce(
        lnResults(lnEpisode('#474 – DHH: Future of Programming, AI, Ruby on Rails, Productivity & Parenting', 'Lex Fridman Podcast')),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://www.youtube.com/watch?v=fresh501');

    expect(item.audioURL).toBeUndefined();
    expect(item.publisher).toBe('Lex Fridman');
  });
});

// ---------------------------------------------------------------------------
// Apple Podcasts
// ---------------------------------------------------------------------------

describe('Apple Podcasts', () => {
  it('TP: an episode link resolves directly via the iTunes lookup — exact audio, no search', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      json({
        results: [
          { kind: 'podcast', collectionName: 'Lex Fridman Podcast' },
          {
            kind: 'podcast-episode',
            trackId: 1000786117598,
            trackName: '#501 – DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux',
            collectionName: 'Lex Fridman Podcast',
            episodeUrl: 'https://media.example.com/lex_501.mp3',
            trackTimeMillis: 19317000,
            artworkUrl600: 'https://is1-ssl.mzstatic.com/image/600x600bb.jpg',
            artworkUrl160: 'https://is1-ssl.mzstatic.com/image/160x160bb.jpg',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve(
      'https://podcasts.apple.com/us/podcast/501-dhh/id1434243584?i=1000786117598&uo=4',
    );

    expect(item.audioURL).toBe('https://media.example.com/lex_501.mp3');
    expect(item.title).toBe('#501 – DHH: Future of Programming, AI, Agentic Engineering, Vibe Coding & Linux');
    expect(item.publisher).toBe('Lex Fridman Podcast');
    expect(item.durationSeconds).toBe(19317);
    expect(item.imageURL).toBe('https://is1-ssl.mzstatic.com/image/600x600bb.jpg');
    // the platform asserted the match; the episode search must not run
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('itunes.apple.com/lookup');
  });

  it('does not send Apple\'s "Podcast Episode · ..." description to the matcher as a show name', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ results: [] })) // lookup window miss
      .mockResolvedValueOnce(
        html(
          '<html><head>' +
            '<meta property="og:title" content="‎The Daily: A very long day on Apple Podcasts">' +
            '<meta property="og:description" content="Podcast Episode · The Daily · 25 min">' +
            '</head></html>',
        ),
      )
      .mockResolvedValueOnce(lnResults());
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=99');

    // the show must come from the title split, not the description boilerplate
    expect(item.publisher).toBe('The Daily');
  });
});

// ---------------------------------------------------------------------------
// Spotify
// ---------------------------------------------------------------------------

describe('Spotify', () => {
  it('TP: an episode page resolves through scraping and the episode search', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        html(
          '<html><head>' +
            '<meta property="og:title" content="Nvidia&#39;s Historic Quarter, SaaS Comeback">' +
            '<meta property="og:description" content="All-In with Chamath, Jason, Sacks &amp; Friedberg · Episode">' +
            '<meta property="og:site_name" content="Spotify">' +
            '<meta property="og:type" content="music.song">' + // Spotify labels episodes music.song too
            '</head></html>',
        ),
      )
      .mockResolvedValueOnce(
        lnResults(lnEpisode("Nvidia's Historic Quarter, SaaS Comeback", 'All-In with Chamath, Jason, Sacks & Friedberg')),
      );
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://open.spotify.com/episode/2Ygvem599PTPNf2H8xHU6x');

    expect(item.audioURL).toBeTruthy();
    expect(item.publisher).toBe('All-In with Chamath, Jason, Sacks & Friedberg');
  });

  it('TN: a song is structurally not an episode — web item, and the search never runs', async () => {
    // /track/ URLs are songs by construction. og:type is useless here:
    // Spotify labels podcast episodes "music.song" as well.
    const fetchMock = vi.fn().mockResolvedValueOnce(
      html(
        '<html><head>' +
          '<meta property="og:title" content="Never Gonna Give You Up">' +
          '<meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987">' +
          '<meta property="og:image" content="https://image-cdn-ak.spotifycdn.com/image/cover">' +
          '<meta property="og:site_name" content="Spotify">' +
          '<meta property="og:type" content="music.song">' +
          '</head></html>',
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const item = await resolve('https://open.spotify.com/track/4PTG3Z6ehGkBFwjybzWkR8');

    expect(item.audioURL).toBeUndefined();
    expect(item.title).toBe('Never Gonna Give You Up');
    // a web item, but not a barren one
    expect(item.imageURL).toBe('https://image-cdn-ak.spotifycdn.com/image/cover');
    // one fetch only: the page. No Listen Notes call for a song.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
