import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import {
  resolveEpisodeViaListenNotes,
  pickBestEpisode,
  isListenNotesConfigured,
} from '../resolvers/listenNotesResolver';

describe('listenNotesResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LISTEN_NOTES_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.LISTEN_NOTES_API_KEY;
  });

  it('is skipped entirely when no API key is configured', async () => {
    delete process.env.LISTEN_NOTES_API_KEY;
    expect(isListenNotesConfigured()).toBe(false);

    const result = await resolveEpisodeViaListenNotes('Some Episode');

    expect(result).toBeNull();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('resolves an episode with direct audio from search results', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              audio: 'https://cdn.example.com/ep.mp3',
              audio_length_sec: 1800,
              title_original: 'How To Build Great Products',
              image: 'https://cdn.example.com/art.jpg',
              podcast: { title_original: 'The Product Show' },
            },
          ],
        }),
    } as any);

    const result = await resolveEpisodeViaListenNotes(
      'How to Build Great Products',
      'The Product Show',
    );

    expect(result).not.toBeNull();
    expect(result!.audioURL).toBe('https://cdn.example.com/ep.mp3');
    expect(result!.durationSeconds).toBe(1800);
    expect(result!.publisher).toBe('The Product Show');
    expect(result!.playbackType).toBe('direct');
    // Sent the API key header
    const [, opts] = vi.mocked(fetchWithTimeout).mock.calls[0];
    expect((opts as any).headers['X-ListenAPI-Key']).toBe('test-key');
  });

  it('returns null when nothing matches well enough', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          results: [
            {
              audio: 'https://cdn.example.com/other.mp3',
              title_original: 'Completely Different Topic Entirely',
              podcast: { title_original: 'Another Show' },
            },
          ],
        }),
    } as any);

    const result = await resolveEpisodeViaListenNotes('How to Build Great Products');

    expect(result).toBeNull();
  });
});

describe('pickBestEpisode', () => {
  const target = 'The Future of AI with Jane Doe';

  it('prefers the episode whose show name also matches', () => {
    const episodes = [
      {
        audio: 'https://a.example.com/1.mp3',
        title_original: 'The Future of AI with Jane Doe',
        podcast: { title_original: 'Random Clips Channel' },
      },
      {
        audio: 'https://a.example.com/2.mp3',
        title_original: 'The Future of AI with Jane Doe',
        podcast: { title_original: 'The Tech Interview Show' },
      },
    ];

    const best = pickBestEpisode(episodes, target, 'Tech Interview Show');
    expect(best?.audio).toBe('https://a.example.com/2.mp3');
  });

  it('skips episodes without audio', () => {
    const episodes = [
      { title_original: 'The Future of AI with Jane Doe' },
      { audio: 'https://a.example.com/2.mp3', title_original: 'The Future of AI with Jane Doe' },
    ];

    const best = pickBestEpisode(episodes, target);
    expect(best?.audio).toBe('https://a.example.com/2.mp3');
  });

  it('returns null for weak matches', () => {
    const episodes = [
      { audio: 'https://a.example.com/1.mp3', title_original: 'Cooking Pasta Basics' },
    ];
    expect(pickBestEpisode(episodes, target)).toBeNull();
  });
});
