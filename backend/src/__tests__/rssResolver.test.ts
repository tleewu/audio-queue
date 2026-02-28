import { describe, it, expect } from 'vitest';
import { isDirectAudioURL, titleFromAudioURL } from '../resolvers/rssResolver';

describe('isDirectAudioURL', () => {
  it('detects .mp3', () => {
    expect(isDirectAudioURL('https://example.com/episode.mp3')).toBe(true);
  });

  it('detects .m4a', () => {
    expect(isDirectAudioURL('https://example.com/episode.m4a')).toBe(true);
  });

  it('detects .ogg with query params', () => {
    expect(isDirectAudioURL('https://example.com/episode.ogg?token=x')).toBe(true);
  });

  it('detects .opus', () => {
    expect(isDirectAudioURL('https://example.com/ep.opus')).toBe(true);
  });

  it('detects .aac', () => {
    expect(isDirectAudioURL('https://example.com/ep.aac')).toBe(true);
  });

  it('detects .flac', () => {
    expect(isDirectAudioURL('https://example.com/ep.flac')).toBe(true);
  });

  it('detects .wav', () => {
    expect(isDirectAudioURL('https://example.com/ep.wav')).toBe(true);
  });

  it('rejects .html', () => {
    expect(isDirectAudioURL('https://example.com/page.html')).toBe(false);
  });

  it('rejects .xml', () => {
    expect(isDirectAudioURL('https://example.com/feed.xml')).toBe(false);
  });

  it('rejects URLs with no extension', () => {
    expect(isDirectAudioURL('https://example.com/stream')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isDirectAudioURL('https://example.com/episode.MP3')).toBe(true);
  });
});

describe('titleFromAudioURL', () => {
  it('extracts filename from URL', () => {
    expect(titleFromAudioURL('https://example.com/my-episode.mp3')).toBe('my-episode.mp3');
  });

  it('strips query params', () => {
    expect(titleFromAudioURL('https://example.com/episode.mp3?token=abc')).toBe('episode.mp3');
  });

  it('URL-decodes the filename', () => {
    expect(titleFromAudioURL('https://example.com/my%20cool%20episode.mp3')).toBe('my cool episode.mp3');
  });

  it('handles deeply nested paths', () => {
    expect(titleFromAudioURL('https://cdn.example.com/a/b/c/file.m4a')).toBe('file.m4a');
  });
});
