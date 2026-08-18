import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TtlCache } from './ttl-cache.js'

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns a value that was just set', () => {
    const cache = new TtlCache<string, number>(1000)
    cache.set('a', 1)

    expect(cache.get('a')).toBe(1)
  })

  it('returns undefined for a key that was never set', () => {
    const cache = new TtlCache<string, number>(1000)

    expect(cache.get('missing')).toBeUndefined()
  })

  it('expires an entry once its TTL has passed', () => {
    const cache = new TtlCache<string, number>(1000)
    cache.set('a', 1)

    vi.advanceTimersByTime(999)
    expect(cache.get('a')).toBe(1)

    vi.advanceTimersByTime(1)
    expect(cache.get('a')).toBeUndefined()
  })

  it('evicts the oldest entry once maxSize is reached', () => {
    const cache = new TtlCache<string, number>(1000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
  })

  it('treats a refreshed key as newest so it is not the next eviction target', () => {
    const cache = new TtlCache<string, number>(1000, 2)
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('a', 10) // 'a' is now newer than 'b'
    cache.set('c', 3) // should evict 'b', not 'a'

    expect(cache.get('a')).toBe(10)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
  })

  it('clear() removes all entries', () => {
    const cache = new TtlCache<string, number>(1000)
    cache.set('a', 1)
    cache.set('b', 2)

    cache.clear()

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBeUndefined()
  })

  describe('getOrFetch', () => {
    it('calls the factory once and caches the result', async () => {
      const cache = new TtlCache<string, number>(1000)
      const factory = vi.fn().mockResolvedValue(42)

      const first = await cache.getOrFetch('a', factory)
      const second = await cache.getOrFetch('a', factory)

      expect(first).toBe(42)
      expect(second).toBe(42)
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('shares one in-flight promise across concurrent calls for the same key', async () => {
      const cache = new TtlCache<string, number>(1000)
      let resolveFactory!: (value: number) => void
      const factory = vi.fn(
        () =>
          new Promise<number>((resolve) => {
            resolveFactory = resolve
          })
      )

      const first = cache.getOrFetch('a', factory)
      const second = cache.getOrFetch('a', factory)
      resolveFactory(7)

      expect(await first).toBe(7)
      expect(await second).toBe(7)
      expect(factory).toHaveBeenCalledTimes(1)
    })

    it('re-fetches after the cached entry expires', async () => {
      const cache = new TtlCache<string, number>(1000)
      const factory = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

      await cache.getOrFetch('a', factory)
      vi.advanceTimersByTime(1001)
      const second = await cache.getOrFetch('a', factory)

      expect(second).toBe(2)
      expect(factory).toHaveBeenCalledTimes(2)
    })

    it('does not cache a result when shouldCache rejects it', async () => {
      const cache = new TtlCache<string, { ok: boolean }>(1000)
      const factory = vi.fn().mockResolvedValue({ ok: false })

      await cache.getOrFetch('a', factory, (value) => value.ok)
      await cache.getOrFetch('a', factory, (value) => value.ok)

      expect(factory).toHaveBeenCalledTimes(2)
    })

    it('does not cache a rejected factory call, and lets the caller retry', async () => {
      const cache = new TtlCache<string, number>(1000)
      const factory = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(5)

      await expect(cache.getOrFetch('a', factory)).rejects.toThrow('boom')
      const value = await cache.getOrFetch('a', factory)

      expect(value).toBe(5)
      expect(factory).toHaveBeenCalledTimes(2)
    })
  })
})
