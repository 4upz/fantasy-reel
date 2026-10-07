/**
 * Per-user throttles for the bot. Every command runs with the service role, so
 * nothing upstream limits a single Discord user; these keep one person (or a
 * script driving their account) from turning the bot into a request amplifier.
 * In-process and bounded, like `TtlCache` -- a restart simply forgets them.
 */

/** Sliding-window limiter: at most `limit` hits per key in any `windowMs`. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 1000
  ) {}

  /**
   * Records a hit for `key` when it is under the limit. Returns 0 when the hit
   * is allowed, or how many milliseconds until the oldest hit leaves the window.
   */
  consume(key: string): number {
    const now = Date.now()
    const recent = (this.hits.get(key) ?? []).filter((at) => at > now - this.windowMs)

    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return recent[0] + this.windowMs - now
    }

    recent.push(now)
    // Delete-then-set keeps Map order by last activity, so the eviction below
    // drops the quietest user rather than an active one.
    this.hits.delete(key)
    if (this.hits.size >= this.maxKeys) {
      const oldestKey = this.hits.keys().next().value
      if (oldestKey !== undefined) this.hits.delete(oldestKey)
    }
    this.hits.set(key, recent)
    return 0
  }

  clear(): void {
    this.hits.clear()
  }
}

/**
 * Latest-wins debounce per key. Discord sends an autocomplete interaction on
 * every keystroke; waiting briefly and answering only the newest one turns a
 * burst of typing into a single search. The wait must stay well inside
 * Discord's 3-second autocomplete deadline.
 */
export class Debouncer {
  private readonly latest = new Map<string, number>()
  private sequence = 0

  constructor(private readonly delayMs: number) {}

  /** Resolves true if no newer call for `key` arrived during the wait. */
  async settle(key: string): Promise<boolean> {
    const ticket = ++this.sequence
    this.latest.set(key, ticket)
    await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    if (this.latest.get(key) !== ticket) return false
    this.latest.delete(key)
    return true
  }
}

// 5 commands per 15s covers someone checking standings, roster and a movie in
// a row; only rapid-fire use hits it.
export const commandLimiter = new RateLimiter(5, 15_000)
// Applied after debouncing, so it only counts searches that would actually run.
export const autocompleteLimiter = new RateLimiter(20, 10_000)
export const autocompleteDebouncer = new Debouncer(300)
