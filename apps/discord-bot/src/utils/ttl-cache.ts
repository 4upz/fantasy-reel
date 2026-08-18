/**
 * Small in-process TTL cache. Map-based, no dependencies. Entries expire after
 * `ttlMs` and the cache evicts its oldest entry once `maxSize` is reached, so
 * memory stays bounded for a long-running bot process without any background
 * sweep.
 */

interface CacheEntry<V> {
  value: V
  expiresAt: number
}

export class TtlCache<K, V> {
  private readonly store = new Map<K, CacheEntry<V>>()
  private readonly pending = new Map<K, Promise<V>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxSize = 200
  ) {}

  get(key: K): V | undefined {
    const entry = this.store.get(key)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: K, value: V): void {
    // Delete-then-set so an overwritten key moves to the back of Map's
    // insertion order -- otherwise a frequently-refreshed key would look
    // "oldest" and get evicted first even though it's the most current.
    this.store.delete(key)
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value
      if (oldestKey !== undefined) this.store.delete(oldestKey)
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }

  clear(): void {
    this.store.clear()
    this.pending.clear()
  }

  /**
   * Returns the cached value for `key` if present and unexpired. Otherwise
   * calls `factory()` and caches its result -- concurrent calls for the same
   * key while a fetch is in flight share that one promise instead of firing
   * duplicate requests. Pass `shouldCache` to skip caching results that
   * represent a failure (e.g. an error payload that resolved rather than
   * threw); rejected factory calls are never cached.
   */
  async getOrFetch(key: K, factory: () => Promise<V>, shouldCache: (value: V) => boolean = () => true): Promise<V> {
    const cached = this.get(key)
    if (cached !== undefined) return cached

    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const promise = factory()
    this.pending.set(key, promise)
    try {
      const value = await promise
      if (shouldCache(value)) this.set(key, value)
      return value
    } finally {
      this.pending.delete(key)
    }
  }
}
