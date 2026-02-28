import { describe, it, expect } from 'vitest';
import { extractYouTubeId } from '../utils/ytdlp';

describe('extractYouTubeId', () => {
  it('extracts from watch?v= URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from watch?v= with extra params', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?t=10&v=dQw4w9WgXcQ&list=PL123')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from youtu.be/ short URL', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from youtu.be/ with params', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from shorts/ URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from embed/ URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('extracts from v/ URL', () => {
    expect(extractYouTubeId('https://www.youtube.com/v/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('returns null for non-YouTube URL', () => {
    expect(extractYouTubeId('https://example.com/video')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractYouTubeId('')).toBeNull();
  });

  it('returns null for YouTube URL with short ID', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=abc')).toBeNull();
  });

  it('handles IDs with hyphens and underscores', () => {
    expect(extractYouTubeId('https://youtu.be/a-B_c1d2e3f')).toBe('a-B_c1d2e3f');
  });
});
