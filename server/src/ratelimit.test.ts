import { describe, expect, it } from 'vitest';
import { RateLimit } from './ratelimit';

describe('RateLimit', () => {
  it('allows a burst, then refuses until tokens refill', () => {
    let now = 0;
    const limit = new RateLimit(3, 1, () => now);
    expect([limit.take(), limit.take(), limit.take(), limit.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 1000;
    expect(limit.take()).toBe(true);
    expect(limit.take()).toBe(false);
  });

  it('never stores more than the burst', () => {
    let now = 0;
    const limit = new RateLimit(2, 10, () => now);
    now = 60_000;
    expect([limit.take(), limit.take(), limit.take()]).toEqual([true, true, false]);
  });
});
