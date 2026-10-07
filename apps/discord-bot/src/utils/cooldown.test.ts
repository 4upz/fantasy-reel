import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Debouncer, RateLimiter } from './cooldown.js'

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('allows hits up to the limit, then reports the wait', () => {
    const limiter = new RateLimiter(2, 1000)

    expect(limiter.consume('a')).toBe(0)
    vi.advanceTimersByTime(100)
    expect(limiter.consume('a')).toBe(0)
    expect(limiter.consume('a')).toBe(900)
  })

  it('allows a hit again once the oldest one leaves the window', () => {
    const limiter = new RateLimiter(1, 1000)
    limiter.consume('a')

    vi.advanceTimersByTime(1000)

    expect(limiter.consume('a')).toBe(0)
  })

  it('does not count refused hits against the user', () => {
    const limiter = new RateLimiter(1, 1000)
    limiter.consume('a')
    vi.advanceTimersByTime(500)
    limiter.consume('a')

    vi.advanceTimersByTime(500)

    expect(limiter.consume('a')).toBe(0)
  })

  it('tracks each key separately', () => {
    const limiter = new RateLimiter(1, 1000)
    limiter.consume('a')

    expect(limiter.consume('b')).toBe(0)
  })

  it('stays bounded by evicting the least recently active key', () => {
    const limiter = new RateLimiter(1, 1000, 2)
    limiter.consume('a')
    limiter.consume('b')
    limiter.consume('c')

    // 'a' was evicted, so it starts fresh; 'c' is still limited.
    expect(limiter.consume('a')).toBe(0)
    expect(limiter.consume('c')).toBeGreaterThan(0)
  })
})

describe('Debouncer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('settles a lone call after the delay', async () => {
    const debouncer = new Debouncer(300)
    const result = debouncer.settle('a')

    await vi.advanceTimersByTimeAsync(300)

    await expect(result).resolves.toBe(true)
  })

  it('drops a call superseded by a newer one for the same key', async () => {
    const debouncer = new Debouncer(300)
    const first = debouncer.settle('a')
    await vi.advanceTimersByTimeAsync(100)
    const second = debouncer.settle('a')

    await vi.advanceTimersByTimeAsync(300)

    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
  })

  it('does not let one key supersede another', async () => {
    const debouncer = new Debouncer(300)
    const a = debouncer.settle('a')
    const b = debouncer.settle('b')

    await vi.advanceTimersByTimeAsync(300)

    await expect(a).resolves.toBe(true)
    await expect(b).resolves.toBe(true)
  })
})
