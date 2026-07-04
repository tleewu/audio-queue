import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * SSRF guard for user-supplied URLs. The resolver pipeline fetches whatever
 * URL the user saves, so before touching it we require:
 *   - http/https scheme
 *   - a public hostname (not localhost, not link-local, not RFC1918/ULA ranges)
 *
 * Throws with a user-safe message when the URL is rejected.
 */
export async function assertPublicHttpUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http(s) URLs are supported');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('URL host is not allowed');
  }

  // Literal IP in the URL
  if (isIP(stripBrackets(hostname))) {
    if (isPrivateAddress(stripBrackets(hostname))) {
      throw new Error('URL host is not allowed');
    }
    return;
  }

  // Resolve DNS and check every returned address
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new Error('URL host could not be resolved');
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new Error('URL host is not allowed');
    }
  }
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    const [a, b] = octets;
    if (a === 10 || a === 127 || a === 0) return true;             // 10/8, loopback, "this"
    if (a === 172 && b >= 16 && b <= 31) return true;              // 172.16/12
    if (a === 192 && b === 168) return true;                       // 192.168/16
    if (a === 169 && b === 254) return true;                       // link-local / cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true;             // CGNAT 100.64/10
    return false;
  }

  // IPv6
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;              // unspecified, loopback
  if (lower.startsWith('fe80:')) return true;                      // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA fc00::/7
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6
    const v4 = lower.split(':').pop() ?? '';
    if (isIP(v4) === 4) return isPrivateAddress(v4);
    return true;
  }
  return false;
}
