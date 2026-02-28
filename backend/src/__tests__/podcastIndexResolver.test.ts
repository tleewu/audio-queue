import { describe, it, expect } from 'vitest';
import { wordOverlapScore } from '../resolvers/podcastIndexResolver';

describe('wordOverlapScore', () => {
  it('returns 1.0 for identical strings', () => {
    expect(wordOverlapScore('hello world again', 'hello world again')).toBe(1.0);
  });

  it('returns 0 for no overlap', () => {
    expect(wordOverlapScore('alpha bravo charlie', 'delta foxtrot gamma')).toBe(0);
  });

  it('returns value between 0 and 1 for partial overlap', () => {
    const score = wordOverlapScore('the great podcast episode today', 'great episode from yesterday');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('ignores short words (<=3 chars)', () => {
    // "the" and "a" are <=3 chars, so only "word" counts
    expect(wordOverlapScore('the a word', 'the a other')).toBe(0);
  });

  it('returns 0 for two empty strings', () => {
    expect(wordOverlapScore('', '')).toBe(0);
  });

  it('returns 0 when one string is empty', () => {
    expect(wordOverlapScore('hello world test', '')).toBe(0);
  });

  it('returns 0 when both strings have only short words', () => {
    expect(wordOverlapScore('a the is', 'a the is')).toBe(0);
  });

  it('handles case-sensitive comparison (words must match exactly)', () => {
    // wordOverlapScore uses exact Set matching — caller normalizes
    expect(wordOverlapScore('Hello World', 'hello world')).toBe(0);
  });
});
