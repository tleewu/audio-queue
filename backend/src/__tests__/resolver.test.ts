import { describe, it, expect } from 'vitest';
import { classifyExtractor } from '../resolvers/resolver';

describe('classifyExtractor', () => {
  it('returns soundcloud for soundcloud extractor', () => {
    expect(classifyExtractor('https://soundcloud.com/track', 'soundcloud')).toBe('soundcloud');
  });

  it('returns soundcloud for SoundCloud extractor (case insensitive)', () => {
    expect(classifyExtractor('https://example.com', 'SoundCloud')).toBe('soundcloud');
  });

  it('returns substack for substack URL', () => {
    expect(classifyExtractor('https://example.substack.com/p/post', 'generic')).toBe('substack');
  });

  it('returns substack for substack extractor', () => {
    expect(classifyExtractor('https://example.com', 'substack')).toBe('substack');
  });

  it('returns other for unknown extractor', () => {
    expect(classifyExtractor('https://example.com', 'vimeo')).toBe('other');
  });

  it('returns other for empty extractor', () => {
    expect(classifyExtractor('https://example.com', '')).toBe('other');
  });
});
