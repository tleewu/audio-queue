/**
 * Minimal in-process TTL cache with a size cap.
 * Used to avoid hammering external APIs (Podcast Index, iTunes, Listen Notes)
 * for repeated lookups of the same URL.
 */
export class TTLCache<V> {
  private store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private ttlMs: number = 60 * 60 * 1000,
    private maxEntries: number = 2000,
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) {
      // Evict oldest insertion (Map preserves insertion order)
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}
