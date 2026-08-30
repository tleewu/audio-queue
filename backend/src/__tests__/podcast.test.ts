import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pickBestEpisode, cleanTitle, findEpisode, resolve } from '../resolvers/podcast';

const KEY = 'test-listen-notes-key';

function htmlResponse(html: string) {
  return { ok: true, text: async () => html } as unknown as Response;
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as unknown as Response;
}

describe('cleanTitle', () => {
  it('strips platform suffixes', () => {
    expect(cleanTitle('Deep Dive - YouTube')).toBe('Deep Dive');
    expect(cleanTitle('Deep Dive | Podcast on Spotify')).toBe('Deep Dive');
    expect(cleanTitle('‎The Show: Deep Dive on Apple Podcasts')).toBe('The Show: Deep Dive');
  });

  it('leaves ordinary titles alone', () => {
    expect(cleanTitle('Why Rust - and what comes next')).toBe('Why Rust - and what comes next');
  });
});

describe('pickBestEpisode', () => {
  const episode = (title: string, podcast?: string) => ({
    audio: `https://cdn.example.com/${title}.mp3`,
    title_original: title,
    podcast: podcast ? { title_original: podcast } : undefined,
  });

  it('returns the closest title match', () => {
    const best = pickBestEpisode(
      [episode('Something entirely different here'), episode('Building better software systems')],
      'Building better software systems',
    );
    expect(best?.title_original).toBe('Building better software systems');
  });

  it('breaks ties with the show name', () => {
    const best = pickBestEpisode(
      [
        episode('Building better software systems', 'Some Other Programming Show'),
        episode('Building better software systems', 'Software Engineering Daily'),
      ],
      'Building better software systems',
      'Software Engineering Daily',
    );
    expect(best?.podcast?.title_original).toBe('Software Engineering Daily');
  });

  it('rejects weak matches', () => {
    expect(pickBestEpisode([episode('Completely unrelated episode title')], 'Building better software systems')).toBeNull();
  });

  it('ignores results without playable audio', () => {
    expect(
      pickBestEpisode(
        [{ title_original: 'Building better software systems' }],
        'Building better software systems',
      ),
    ).toBeNull();
  });
});

describe('findEpisode', () => {
  beforeEach(() => {
    process.env.LISTEN_NOTES_API_KEY = KEY;
  });

  afterEach(() => {
    delete process.env.LISTEN_NOTES_API_KEY;
    vi.unstubAllGlobals();
  });

  it('returns the matched episode audio', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          results: [
            {
              audio: 'https://cdn.example.com/ep.mp3',
              audio_length_sec: 3600,
              title_original: 'Building better software systems',
              podcast: { title_original: 'Software Engineering Daily' },
            },
          ],
        }),
      ),
    );

    const result = await findEpisode('Building better software systems');
    expect(result).toEqual({
      title: 'Building better software systems',
      publisher: 'Software Engineering Daily',
      audioURL: 'https://cdn.example.com/ep.mp3',
      durationSeconds: 3600,
    });
  });

  it('returns null without an API key', async () => {
    delete process.env.LISTEN_NOTES_API_KEY;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    expect(await findEpisode('Anything at all')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns null when the search call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await findEpisode('Building better software systems')).toBeNull();
  });
});

describe('resolve', () => {
  afterEach(() => {
    delete process.env.LISTEN_NOTES_API_KEY;
    vi.unstubAllGlobals();
  });

  // Regression: the old flat 400 KB cap sliced YouTube's <head> in half, so
  // og:title was never parsed and the item ended up titled by its raw URL.
  it('reads metadata out of a <head> far larger than a fixed byte cap', async () => {
    const filler = '<script>/*'.padEnd(900_000, 'x') + '*/</script>';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        htmlResponse(`<html><head>${filler}
            <meta property="og:title" content="Never Gonna Give You Up - YouTube">
            <link itemprop="name" content="Rick Astley">
          </head><body>${'y'.repeat(500_000)}</body></html>`),
      ),
    );

    const item = await resolve('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(item.title).toBe('Never Gonna Give You Up');
    expect(item.publisher).toBe('Rick Astley');
  });

  it('resolves a page whose title matches a Listen Notes episode', async () => {
    process.env.LISTEN_NOTES_API_KEY = KEY;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          htmlResponse(`
            <html><head>
              <meta property="og:title" content="Building better software systems | Podcast on Spotify">
              <meta property="og:description" content="Software Engineering Daily · Episode">
            </head></html>`),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            results: [
              {
                audio: 'https://cdn.example.com/ep.mp3',
                audio_length_sec: 1800,
                title_original: 'Building better software systems',
                podcast: { title_original: 'Software Engineering Daily' },
              },
            ],
          }),
        ),
    );

    const result = await resolve('https://open.spotify.com/episode/abc123');
    expect(result.audioURL).toBe('https://cdn.example.com/ep.mp3');
    expect(result.title).toBe('Building better software systems');
    expect(result.publisher).toBe('Software Engineering Daily');
  });

  it('falls back to a web item when no episode matches', async () => {
    process.env.LISTEN_NOTES_API_KEY = KEY;
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          htmlResponse(`
            <html><head>
              <meta property="og:title" content="An essay about nothing in particular">
              <meta property="og:site_name" content="Example Blog">
            </head></html>`),
        )
        .mockResolvedValueOnce(jsonResponse({ results: [] })),
    );

    const result = await resolve('https://example.com/essay');
    expect(result.audioURL).toBeUndefined();
    expect(result.title).toBe('An essay about nothing in particular');
    expect(result.publisher).toBe('Example Blog');
  });

  it('falls back to the URL itself when the page cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));
    const result = await resolve('https://example.com/unreachable');
    expect(result).toEqual({ title: 'https://example.com/unreachable' });
  });

  it('splits show and episode on Apple Podcasts titles', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        htmlResponse(
          '<html><head><meta property="og:title" content="‎The Daily: A very long day on Apple Podcasts"></head></html>',
        ),
      ),
    );

    const result = await resolve('https://podcasts.apple.com/us/podcast/the-daily/id1200361736?i=1');
    expect(result.title).toBe('A very long day');
    expect(result.publisher).toBe('The Daily');
  });
});
