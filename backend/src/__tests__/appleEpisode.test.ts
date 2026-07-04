import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/fetchWithTimeout', () => ({
  fetchWithTimeout: vi.fn(),
}));

vi.mock('../resolvers/rssResolver', () => ({
  resolveRSS: vi.fn(),
}));

vi.mock('../resolvers/listenNotesResolver', () => ({
  resolveEpisodeViaListenNotes: vi.fn().mockResolvedValue(null),
  isListenNotesConfigured: vi.fn().mockReturnValue(false),
}));

import { fetchWithTimeout } from '../utils/fetchWithTimeout';
import { resolveRSS } from '../resolvers/rssResolver';
import { resolvePodcastPlatform } from '../resolvers/podcastIndexResolver';

function jsonResponse(payload: unknown) {
  return { ok: true, json: () => Promise.resolve(payload) } as any;
}

describe('Apple Podcasts episode resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves the exact episode from an ?i= link via iTunes lookup', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      jsonResponse({
        results: [
          {
            wrapperType: 'track',
            kind: 'podcast',
            collectionName: 'The Great Show',
            feedUrl: 'https://feeds.example.com/greatshow',
          },
          {
            wrapperType: 'podcastEpisode',
            trackName: 'Episode 42: The Answer',
            collectionName: 'The Great Show',
            episodeUrl: 'https://cdn.example.com/ep42.mp3',
            artworkUrl600: 'https://cdn.example.com/art600.jpg',
            trackTimeMillis: 3_600_000,
            feedUrl: 'https://feeds.example.com/greatshow',
          },
        ],
      }),
    );

    const result = await resolvePodcastPlatform(
      'https://podcasts.apple.com/us/podcast/the-great-show/id123456789?i=1000999888777',
    );

    expect(result).not.toBeNull();
    expect(result!.title).toBe('Episode 42: The Answer');
    expect(result!.publisher).toBe('The Great Show');
    expect(result!.audioURL).toBe('https://cdn.example.com/ep42.mp3');
    expect(result!.durationSeconds).toBe(3600);
    expect(result!.playbackType).toBe('direct');
    // Looked up the episode ID, not the show ID
    expect(vi.mocked(fetchWithTimeout).mock.calls[0][0]).toContain('id=1000999888777');
    expect(vi.mocked(fetchWithTimeout).mock.calls[0][0]).toContain('entity=podcastEpisode');
    // Never needed the feed
    expect(resolveRSS).not.toHaveBeenCalled();
  });

  it('falls back to feed-level resolution for show links without ?i=', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      jsonResponse({ results: [{ feedUrl: 'https://feeds.example.com/greatshow' }] }),
    );
    vi.mocked(resolveRSS).mockResolvedValue({
      sourceType: 'podcast',
      playbackType: 'direct',
      title: 'Latest Episode',
      audioURL: 'https://cdn.example.com/latest.mp3',
      originalURL: 'https://feeds.example.com/greatshow',
    });

    const result = await resolvePodcastPlatform(
      'https://podcasts.apple.com/us/podcast/the-great-show/id123456789',
    );

    expect(result!.title).toBe('Latest Episode');
    expect(resolveRSS).toHaveBeenCalledWith('https://feeds.example.com/greatshow');
  });

  it('returns null when iTunes lookup finds nothing', async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse({ results: [] }));

    const result = await resolvePodcastPlatform(
      'https://podcasts.apple.com/us/podcast/whatever/id999000111',
    );

    expect(result).toBeNull();
  });
});
