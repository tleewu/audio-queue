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
  isDirectAudioURL: vi.fn().mockReturnValue(false),
}));

import { dispatch, looksLikeFeed } from '../resolvers/resolver';
import { resolvePodcastPlatform, resolveYouTubeViaPodcastIndex } from '../resolvers/podcastIndexResolver';
import { extractYouTubeId, execYtDlp } from '../utils/ytdlp';
import { resolveRSS, isDirectAudioURL } from '../resolvers/rssResolver';

describe('dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing is a YouTube URL
    vi.mocked(extractYouTubeId).mockReturnValue(null);
    // Default: not a direct audio URL
    vi.mocked(isDirectAudioURL).mockReturnValue(false);
    // Default: RSS fails (not a feed)
    vi.mocked(resolveRSS).mockRejectedValue(new Error('Not RSS'));
    // Default: yt-dlp fails
    vi.mocked(execYtDlp).mockRejectedValue(new Error('Unsupported'));
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

  it('prefers RSS podcast metadata for feed-like URLs over yt-dlp', async () => {
    vi.mocked(resolveRSS).mockResolvedValue({
      sourceType: 'podcast',
      title: 'Podcast Episode Title',
      publisher: 'Podcast Author',
      audioURL: 'https://feeds.example.com/ep.mp3',
      originalURL: 'https://example.com/feed',
    });
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'Generic Page Title',
      uploader: 'Website Name',
      url: 'https://cdn.example.com/stream.mp3',
      duration: 240,
      thumbnail: 'https://cdn.example.com/thumb.jpg',
      extractor: 'generic',
      webpage_url: 'https://example.com/feed',
    });

    const result = await dispatch('https://example.com/feed');

    expect(resolveRSS).toHaveBeenCalledWith('https://example.com/feed');
    expect(execYtDlp).not.toHaveBeenCalled();
    expect(result.sourceType).toBe('podcast');
    expect(result.title).toBe('Podcast Episode Title');
    expect(result.publisher).toBe('Podcast Author');
  });

  it('prefers RSS for direct audio URLs', async () => {
    vi.mocked(isDirectAudioURL).mockReturnValue(true);
    vi.mocked(resolveRSS).mockResolvedValue({
      sourceType: 'other',
      title: 'episode.mp3',
      audioURL: 'https://example.com/episode.mp3',
      originalURL: 'https://example.com/episode.mp3',
    });

    const result = await dispatch('https://example.com/episode.mp3');

    expect(resolveRSS).toHaveBeenCalled();
    expect(execYtDlp).not.toHaveBeenCalled();
    expect(result.title).toBe('episode.mp3');
  });

  it('skips RSS for non-feed URLs and uses yt-dlp directly', async () => {
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

    // RSS should NOT be attempted before yt-dlp for non-feed URLs
    expect(resolveRSS).not.toHaveBeenCalled();
    expect(execYtDlp).toHaveBeenCalledWith('https://soundcloud.com/artist/track');
    expect(result.sourceType).toBe('soundcloud');
    expect(result.audioURL).toBe('https://cdn.soundcloud.com/stream.mp3');
  });

  it('falls back to RSS when yt-dlp fails for non-feed URLs', async () => {
    vi.mocked(resolveRSS).mockResolvedValue({
      sourceType: 'podcast',
      title: 'RSS Episode',
      audioURL: 'https://feeds.example.com/ep.mp3',
      originalURL: 'https://example.com/page',
    });

    const result = await dispatch('https://example.com/page');

    // yt-dlp tried first (fails by default), then RSS as fallback
    expect(execYtDlp).toHaveBeenCalled();
    expect(resolveRSS).toHaveBeenCalled();
    expect(result.sourceType).toBe('podcast');
  });

  it('does not try RSS for x.com/twitter URLs before yt-dlp', async () => {
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'Tweet with video',
      uploader: 'User',
      url: 'https://video.twimg.com/stream.mp4',
      duration: 30,
      thumbnail: 'https://pbs.twimg.com/thumb.jpg',
      extractor: 'twitter',
      webpage_url: 'https://x.com/user/status/123',
    });

    const result = await dispatch('https://x.com/user/status/123');

    expect(resolveRSS).not.toHaveBeenCalled();
    expect(result.title).toBe('Tweet with video');
  });

  it('returns unsupported when all resolvers fail', async () => {
    const result = await dispatch('https://example.com/page');

    expect(result.sourceType).toBe('unsupported');
    expect(result.audioURL).toBeUndefined();
  });
});

describe('looksLikeFeed', () => {
  it('matches /feed paths', () => {
    expect(looksLikeFeed('https://example.com/feed')).toBe(true);
    expect(looksLikeFeed('https://example.com/feed/')).toBe(true);
    expect(looksLikeFeed('https://example.com/feed?format=xml')).toBe(true);
  });

  it('matches /rss paths', () => {
    expect(looksLikeFeed('https://example.com/rss')).toBe(true);
    expect(looksLikeFeed('https://anchor.fm/s/123/podcast/rss')).toBe(true);
  });

  it('matches .xml extensions', () => {
    expect(looksLikeFeed('https://example.com/podcast.xml')).toBe(true);
    expect(looksLikeFeed('https://example.com/podcast.xml?v=2')).toBe(true);
  });

  it('matches substack.com URLs', () => {
    expect(looksLikeFeed('https://newsletter.substack.com/p/episode-1')).toBe(true);
  });

  it('does not match regular web pages', () => {
    expect(looksLikeFeed('https://x.com/user/status/123')).toBe(false);
    expect(looksLikeFeed('https://soundcloud.com/artist/track')).toBe(false);
    expect(looksLikeFeed('https://example.com/page')).toBe(false);
  });
});
