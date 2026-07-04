import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock all sub-resolvers and yt-dlp
vi.mock('../resolvers/podcastIndexResolver', () => ({
  resolvePodcastPlatform: vi.fn(),
  resolveYouTubeViaPodcastIndex: vi.fn(),
}));

vi.mock('../utils/ytdlp', () => ({
  extractYouTubeId: vi.fn(),
  isTwitterUrl: vi.fn(),
  execYtDlp: vi.fn(),
}));

vi.mock('../resolvers/rssResolver', () => ({
  resolveRSS: vi.fn(),
}));

import { dispatch } from '../resolvers/resolver';
import { resolvePodcastPlatform, resolveYouTubeViaPodcastIndex } from '../resolvers/podcastIndexResolver';
import { extractYouTubeId, isTwitterUrl, execYtDlp } from '../utils/ytdlp';
import { resolveRSS } from '../resolvers/rssResolver';

describe('dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: nothing is a YouTube or X URL
    vi.mocked(extractYouTubeId).mockReturnValue(null);
    vi.mocked(isTwitterUrl).mockReturnValue(false);
    // Default: yt-dlp cannot extract
    vi.mocked(execYtDlp).mockRejectedValue(new Error('Unsupported'));
    // Default: RSS fails (not a feed)
    vi.mocked(resolveRSS).mockRejectedValue(new Error('Not RSS'));
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

  it('tries PodcastIndex, then yt-dlp, then falls back to oEmbed external for YouTube', async () => {
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
    expect(execYtDlp).toHaveBeenCalled();
    expect(result.sourceType).toBe('youtube');
    expect(result.playbackType).toBe('external');
    expect(result.title).toBe('YouTube Video');
    expect(result.audioURL).toBeUndefined();
  });

  it('plays YouTube in-app via the stream proxy when yt-dlp extracts audio', async () => {
    vi.mocked(extractYouTubeId).mockReturnValue('dQw4w9WgXcQ');
    vi.mocked(resolveYouTubeViaPodcastIndex).mockResolvedValue(null);
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'YouTube Video',
      uploader: 'Channel',
      url: 'https://rr1---sn.googlevideo.com/audio.m4a',
      duration: 600,
      extractor: 'youtube',
      webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });

    const result = await dispatch('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    expect(result.sourceType).toBe('youtube');
    expect(result.playbackType).toBe('proxy');
    expect(result.audioURL).toBe('https://rr1---sn.googlevideo.com/audio.m4a');
  });

  it('resolves X video via yt-dlp as proxy playback', async () => {
    vi.mocked(isTwitterUrl).mockReturnValue(true);
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'Interesting talk',
      uploader: 'someuser',
      url: 'https://video.twimg.com/vid.mp4',
      duration: 120,
      extractor: 'twitter',
      webpage_url: 'https://x.com/someuser/status/123',
    });

    const result = await dispatch('https://x.com/someuser/status/123');

    expect(result.sourceType).toBe('x');
    expect(result.playbackType).toBe('proxy');
    expect(result.audioURL).toBe('https://video.twimg.com/vid.mp4');
  });

  it('marks X video external when yt-dlp fails', async () => {
    vi.mocked(isTwitterUrl).mockReturnValue(true);

    const result = await dispatch('https://x.com/someuser/status/123');

    expect(result.sourceType).toBe('x');
    expect(result.playbackType).toBe('external');
    expect(result.audioURL).toBeUndefined();
  });

  it('returns HLS yt-dlp results as direct playback', async () => {
    vi.mocked(execYtDlp).mockResolvedValue({
      title: 'SoundCloud Track',
      uploader: 'Artist',
      url: 'https://cf-hls-media.sndcdn.com/playlist.m3u8?token=abc',
      duration: 240,
      extractor: 'soundcloud',
      webpage_url: 'https://soundcloud.com/artist/track',
    });

    const result = await dispatch('https://soundcloud.com/artist/track');

    expect(result.playbackType).toBe('direct');
    expect(result.audioURL).toContain('.m3u8');
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

  it('prefers RSS podcast metadata over yt-dlp meta tags', async () => {
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

  it('tries yt-dlp when RSS fails for non-YouTube URLs', async () => {
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

    expect(resolveRSS).toHaveBeenCalledWith('https://soundcloud.com/artist/track');
    expect(execYtDlp).toHaveBeenCalledWith('https://soundcloud.com/artist/track');
    expect(result.sourceType).toBe('soundcloud');
    expect(result.playbackType).toBe('proxy');
    expect(result.audioURL).toBe('https://cdn.soundcloud.com/stream.mp3');
  });

  it('returns unsupported when all resolvers fail', async () => {
    const result = await dispatch('https://example.com/page');

    expect(result.sourceType).toBe('unsupported');
    expect(result.playbackType).toBe('external');
    expect(result.audioURL).toBeUndefined();
  });
});
