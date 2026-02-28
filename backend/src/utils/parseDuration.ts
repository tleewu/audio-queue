/**
 * Parse iTunes duration string (HH:MM:SS or MM:SS or raw seconds) → seconds.
 */
export function parseDuration(raw: string | number | undefined): number | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'number') return raw;

  const parts = String(raw).split(':').map(Number);
  if (parts.some(isNaN)) return undefined;

  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0];

  return undefined;
}
