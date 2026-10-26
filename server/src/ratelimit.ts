/** Token bucket: `burst` actions at once, refilled at `perSec` tokens a second. */
export class RateLimit {
  private tokens: number;
  private last: number;

  constructor(
    private burst: number,
    private perSec: number,
    private now: () => number = Date.now,
  ) {
    this.tokens = burst;
    this.last = now();
  }

  /** Spends a token and returns true, or returns false when the bucket is empty. */
  take(): boolean {
    const t = this.now();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.last) / 1000) * this.perSec);
    this.last = t;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-connection ceilings; generous for people, tight for scripts. */
export function socketLimits() {
  return {
    // Chat: a short burst, then about two lines a second.
    chat: new RateLimit(5, 2),
    // Drawing batches go out roughly every 30 ms, so this allows a fast scribble but not a flood.
    canvas: new RateLimit(120, 60),
    // Everything else (join, settings, start, kick...): real clicks, never a loop.
    actions: new RateLimit(10, 3),
  };
}
