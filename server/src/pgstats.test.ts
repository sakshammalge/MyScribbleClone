import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PgStats } from './pgstats';
import type { GameEntry } from './stats';

// Runs against a real Postgres when TEST_DATABASE_URL is set (CI provides one); skipped otherwise.
const url = process.env.TEST_DATABASE_URL;
const dev = (n: number) => `ab${n.toString(16).padStart(30, '0')}`;
const entry = (n: number, over: Partial<GameEntry> = {}): GameEntry => ({
  deviceId: dev(n),
  name: `P${n}`,
  score: 100,
  place: 2,
  players: 3,
  correctGuesses: 2,
  wordsDrawn: 1,
  drawingsSolved: 1,
  ...over,
});

describe.skipIf(!url)('PgStats', () => {
  let stats: PgStats;

  beforeAll(async () => {
    stats = await PgStats.connect(url!, false);
    // Reconnecting is how every restart goes: the table already exists.
    await (await PgStats.connect(url!, false)).close();
  });
  afterAll(() => stats.close());

  it('accumulates totals across games and keeps the latest name', async () => {
    await stats.recordGame([entry(1, { place: 1, score: 300 }), entry(2)], 1_700_000_000_000);
    await stats.recordGame([entry(1, { name: 'Renamed', score: 50 })], 1_700_000_100_000);
    const mine = await stats.get(dev(1));
    expect(mine).toEqual({
      name: 'Renamed',
      games: 2,
      wins: 1,
      podiums: 2,
      totalPoints: 350,
      bestScore: 300,
      correctGuesses: 4,
      wordsDrawn: 2,
      drawingsSolved: 2,
      lastPlayed: 1_700_000_100_000,
    });
    expect(await stats.get(dev(99))).toBeNull();
  });

  it('orders the leaderboard and never exposes the device id in stats', async () => {
    const byWins = await stats.top('wins', 100);
    const ours = byWins.filter((r) => [dev(1), dev(2)].includes(r.deviceId));
    expect(ours.map((r) => r.deviceId)).toEqual([dev(1), dev(2)]);
    expect(JSON.stringify(await stats.get(dev(1)))).not.toContain(dev(1));
    expect((await stats.top('games', 1)).length).toBe(1);
  });
});
