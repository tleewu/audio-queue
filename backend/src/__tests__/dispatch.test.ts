import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all sub-resolvers and yt-dlp
vi.mock('../resolvers/podcastIndexResolver', () => ({
  resolvePodcastPlatform: vi.fn(),
  resolveYouTubeViaPodcastIndex: vi.fn(),
}));

vi.mock('../utils/ytdlp', () => ({
  extractYouTubeId: vi.fn(),
  execYtDlp: vi.fn(),
}));

vi.mock('../resolvers/rssResolver', () => ({
  resolveRSS: vi.fn(),
}));

import { dispatch } from '../resolvers/resolver';
import { resolvePodcastPlatform, resolveYouTubeViaPodcastIndex } from '../resolvers/podcastIndexResolver';
import { extractYouTubeId, execYtDlp } from '../utils/ytdlp';
import { resolveRSS } from '../resolvers/rssResolver';

describe('dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing is a YouTube URL
    vi.mocked(extractYouTubeId).mockReturnValue(null);
    // Mock global fetch for YouTube oEmbed (fetchYouTubeMeta)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
  });

  it('calls resolvePodcastPlatform for Spotify URL', async () => {
    vi.mocked(resolvePodcastPlatform).mockResolvedValue({
      sourceType: 'podcast',
      title: 'Spotify Episode',
      audioURL: 'https://cdn.example.com/ep.mp3',
      originalURL: 'https://open.spotify.com/episode/123',
    });

    const result = await dispatch('https://open.spotify.com/episode/123');

    expect(resolvePodcastPlatform).toHaveBeenCalledWith('https://open.spotify.com/episode/123');
    expect(result.sourceType).toBe('podcast');
    expect(result.title).toBe('Spotify Episode');
  });

  it('returns unsupported when podcast platform fails for Spotify', async () => {
    vi.mocked(resolvePodcastPlatform).mockResolvedValue(null);

    const result = await dispatch('https://open.spotify.com/episode/123');

    expect(result.sourceType).toBe('unsupported');
  });

  it('calls resolvePodcastPlatform for Apple Podcasts URL', async () => {
    vi.mocked(resolvePodcastPlatform).mockResolvedValue({
      sourceType: 'podcast',
      title: 'Apple Episode',
      audioURL: 'https://cdn.example.com/ep.mp3',
      originalURL: 'https://podcasts.apple.com/podcast/id123',
    });

    const result = await dispatch('https://podcasts.apple.com/podcast/id123');

    expect(resolvePodcastPlatform).toHaveBeenCalled();
    expect(result.sourceType).toBe('podcast');
  });

  it('tries PodcastIndex then falls back to oEmbed for YouTube', async () => {
    vi.mocked(extractYouTubeId).mockReturnValue('dQw4w9WgXcQ');
    vi.mocked(resolveYouTubeViaPodcastIndex).mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        title: 'YouTube Video',
        author_name: 'Channel',
        thumbnail_url: 'https://img.youtube.com/thumb.jpg',
      }),
    }));

    const result = await dispatch('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(resolveYouTubeViaPodcastIndex).toHaveBeenCalled();
    expect(result.sourceType).toBe('youtube');
    expect(result.title).toBe('YouTube Video');
    expect(result.audioURL).toBeUndefined();
  });

  it('returns PodcastIndex result for YouTube when match found', async () => {
    vi.mocked(extractYouTubeId).mockReturnValue('dQw4w9WgXcQ');
    vi.mocked(resolveYouTubeViaPodcastIndex).mockResolvedValue({
      sourceType: 'podcast',
      title: 'Podcast Version',
      audioURL: 'https://cdn.example.com/ep.mp3',
      originalURL: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    const result = await dispatch('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result.sourceType).toBe('podcast');
    expect(result.audioURL).toBe('https://cdn.example.com/ep.mp3');
  });

  it('tries yt-dlp for non-YouTube URLs', async () => {
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'SoundCloud Track',
      uploader: 'Artist',
      url: 'https://cdn.soundcloud.com/stream.mp3',
      duration: 240,
      thumbnail: 'https://cdn.soundcloud.com/thumb.jpg',
      extractor: 'soundcloud',
      webpage_url: 'https://soundcloud.com/artist/track',
    });

    const result = await dispatch('https://soundcloud.com/artist/track');

    expect(execYtDlp).toHaveBeenCalledWith('https://soundcloud.com/artist/track');
    expect(result.sourceType).toBe('soundcloud');
    expect(result.audioURL).toBe('https://cdn.soundcloud.com/stream.mp3');
  });

  it('falls through to RSS when yt-dlp fails', async () => {
    vi.mocked(execYtDlp).mockRejectedValue(new Error('Unsupported'));
    vi.mocked(resolveRSS).mockResolvedValue({
      sourceType: 'podcast',
      title: 'RSS Episode',
      audioURL: 'https://feeds.example.com/ep.mp3',
      originalURL: 'https://example.com/feed',
    });

    const result = await dispatch('https://example.com/feed');

    expect(result.sourceType).toBe('podcast');
    expect(result.audioURL).toBe('https://feeds.example.com/ep.mp3');
  });

  it('returns unsupported when all resolvers fail', async () => {
    vi.mocked(execYtDlp).mockRejectedValue(new Error('Unsupported'));
    vi.mocked(resolveRSS).mockRejectedValue(new Error('Not RSS'));

    const result = await dispatch('https://example.com/page');

    expect(result.sourceType).toBe('unsupported');
    expect(result.audioURL).toBeUndefined();
  });
});
