/**
 * fetch() wrapper with a configurable timeout.
 * Throws if the request takes longer than `ms` milliseconds.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  ms = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}
