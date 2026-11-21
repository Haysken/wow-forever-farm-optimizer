interface CacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

/**
 * Bounded in-memory TTL cache used to avoid redundant PostgreSQL aggregation
 * work within the same hourly market snapshot window.
 */
export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 200
  ) {}

  get(key: string, nowMs = Date.now()): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (nowMs >= entry.expiresAtMs) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs, nowMs = Date.now()): void {
    if (this.store.size >= this.maxEntries && !this.store.has(key)) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, {
      value,
      expiresAtMs: nowMs + Math.max(1, ttlMs),
    });
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

export function truncateError(error: unknown, maxLen = 400): string {
  const msg = error instanceof Error ? error.message : String(error);
  return msg.length > maxLen ? `${msg.slice(0, maxLen)}...` : msg;
}
