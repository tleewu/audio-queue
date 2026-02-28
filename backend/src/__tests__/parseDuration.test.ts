import { describe, it, expect } from 'vitest';
import { parseDuration } from '../utils/parseDuration';

describe('parseDuration', () => {
  it('parses HH:MM:SS', () => {
    expect(parseDuration('1:23:45')).toBe(5025);
  });

  it('parses MM:SS', () => {
    expect(parseDuration('2:30')).toBe(150);
  });

  it('parses raw seconds as string', () => {
    expect(parseDuration('42')).toBe(42);
  });

  it('passes through number directly', () => {
    expect(parseDuration(42)).toBe(42);
  });

  it('returns undefined for undefined', () => {
    expect(parseDuration(undefined)).toBeUndefined();
  });

  it('returns undefined for null', () => {
    expect(parseDuration(null as any)).toBeUndefined();
  });

  it('returns undefined for non-numeric string', () => {
    expect(parseDuration('1:xx')).toBeUndefined();
  });

  it('returns undefined for totally invalid string', () => {
    expect(parseDuration('abc')).toBeUndefined();
  });

  it('parses 0:00', () => {
    expect(parseDuration('0:00')).toBe(0);
  });

  it('parses large values', () => {
    expect(parseDuration('10:00:00')).toBe(36000);
  });
});
