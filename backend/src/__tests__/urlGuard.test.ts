import { describe, it, expect } from 'vitest';
import { assertPublicHttpUrl, isPrivateAddress } from '../utils/urlGuard';

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // cloud metadata endpoint
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::',
    'fe80::1',
    'fd12:3456::1',
    '::ffff:192.168.0.1',
  ])('flags %s as private', (addr) => {
    expect(isPrivateAddress(addr)).toBe(true);
  });

  it.each(['8.8.8.8', '172.32.0.1', '104.16.0.1', '2606:4700::6810:1'])(
    'allows public address %s',
    (addr) => {
      expect(isPrivateAddress(addr)).toBe(false);
    },
  );
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http schemes', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow();
    await expect(assertPublicHttpUrl('ftp://example.com/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('javascript:alert(1)')).rejects.toThrow();
  });

  it('rejects garbage', async () => {
    await expect(assertPublicHttpUrl('not a url')).rejects.toThrow('Invalid URL');
  });

  it('rejects localhost and internal hostnames without DNS', async () => {
    await expect(assertPublicHttpUrl('http://localhost:8080/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://foo.localhost/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://db.internal/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://printer.local/x')).rejects.toThrow();
  });

  it('rejects literal private IPs', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1/x')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://[::1]/x')).rejects.toThrow();
  });

  it('accepts literal public IPs', async () => {
    await expect(assertPublicHttpUrl('http://8.8.8.8/x')).resolves.toBeUndefined();
  });
});
