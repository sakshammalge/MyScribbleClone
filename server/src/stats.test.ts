import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_TIMING, type PrivateState, type RoomState } from '@inkling/shared';
import { RoomManager } from './rooms';
import { MemoryStats, type GameEntry } from './stats';

const dev = (n: number) => n.toString(16).padStart(32, '0');
const me = (name: string, n?: number) => ({
  name,
  avatar: { color: 0, face: 0 },
  deviceId: n === undefined ? undefined : dev(n),
});

const entry = (n: number, over: Partial<GameEntry> = {}): GameEntry => ({
  deviceId: dev(n),
  name: `P${n}`,
  score: 100,
  place: 2,
  players: 3,
  correctGuesses: 1,
  wordsDrawn: 1,
  drawingsSolved: 1,
  ...over,
});

describe('MemoryStats', () => {
  it('adds games up and keeps the latest name', async () => {
    const stats = new MemoryStats();
    await stats.recordGame([entry(1, { place: 1, score: 300 }), entry(2, { place: 3 })], 1000);
    await stats.recordGame([entry(1, { name: 'Renamed', place: 2, score: 100 })], 2000);
    expect(await stats.get(dev(1))).toEqual({
      name: 'Renamed',
      games: 2,
      wins: 1,
      podiums: 2,
      totalPoints: 400,
      bestScore: 300,
      correctGuesses: 2,
      wordsDrawn: 2,
      drawingsSolved: 2,
      lastPlayed: 2000,
    });
    expect(await stats.get(dev(9))).toBeNull();
  });

  it('does not call a two-player runner-up a podium finish', async () => {
    const stats = new MemoryStats();
    await stats.recordGame([entry(1, { place: 2, players: 2 })]);
    expect((await stats.get(dev(1)))!.podiums).toBe(0);
  });

  it('ranks by the chosen column and never hands out device ids in stats', async () => {
    const stats = new MemoryStats();
    await stats.recordGame([entry(1, { place: 1, score: 50 }), entry(2, { score: 900 })]);
    await stats.recordGame([entry(2, { score: 900 })]);
    expect((await stats.top('wins', 5)).map((r) => r.name)).toEqual(['P1', 'P2']);
    expect((await stats.top('points', 5)).map((r) => r.name)).toEqual(['P2', 'P1']);
    expect((await stats.top('games', 1)).map((r) => r.name)).toEqual(['P2']);
    expect(JSON.stringify(await stats.get(dev(1)))).not.toContain(dev(1));
  });

  it('forgets the longest-idle players beyond its cap', async () => {
    const stats = new MemoryStats(2);
    await stats.recordGame([entry(1)], 1);
    await stats.recordGame([entry(2)], 2);
    await stats.recordGame([entry(3)], 3);
    expect(await stats.get(dev(1))).toBeNull();
    expect(await stats.get(dev(3))).not.toBeNull();
  });
});

describe('crediting finished games', () => {
  let state: RoomState;
  let secrets: Record<string, PrivateState>;
  let recorded: GameEntry[][];
  let rooms: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    secrets = {};
    recorded = [];
    rooms = new RoomManager((room) => room && (state = room), 1000, {
      private: (socket, s) => (secrets[socket] = s),
      recordGame: (entries) => recorded.push(entries),
    });
  });
  afterEach(() => vi.useRealTimers());

  const idOf = (name: string) => state.players.find((p) => p.name === name)!.id;

  const lobby = (players: [string, number | undefined][]) => {
    const [first, ...rest] = players;
    const created = rooms.create('s-' + first![0], me(first![0], first![1]));
    if (!created.ok) throw new Error(created.error);
    for (const [n, d] of rest) rooms.join('s-' + n, created.room.code, me(n, d));
    rooms.updateSettings('s-' + first![0], { rounds: 2, drawTimeSec: 40 });
  };

  /** Plays turn after turn: the guessers all find the word, unless `solve` is false. */
  const playOut = (solve = true) => {
    for (let guard = 0; guard < 50 && state.phase !== 'ended'; guard++) {
      if (state.phase === 'choosing') {
        const drawer = state.players.find((p) => p.id === state.drawerId)!;
        const word = secrets['s-' + drawer.name]!.choices![0]!;
        rooms.chooseWord('s-' + drawer.name, 0);
        if (solve) {
          for (const p of state.players)
            if (p.id !== state.drawerId) rooms.chat('s-' + p.name, word);
        }
      }
      // Solved turns end at once and only the reveal pause is left; otherwise let the clock run out.
      vi.advanceTimersByTime(solve ? TURN_TIMING.revealSec * 1000 + 1 : 60_000);
    }
    expect(state.phase).toBe('ended');
  };

  it('records every device of a game that ran to the end, from server-side scoring', () => {
    lobby([
      ['Ada', 1],
      ['Bo', 2],
      ['Cy', 3],
    ]);
    rooms.start('s-Ada');
    playOut();
    expect(recorded).toHaveLength(1);
    const byName = Object.fromEntries(recorded[0]!.map((e) => [e.name, e]));
    expect(Object.keys(byName).sort()).toEqual(['Ada', 'Bo', 'Cy']);
    for (const name of ['Ada', 'Bo', 'Cy']) {
      const e = byName[name]!;
      expect(e.score).toBe(state.players.find((p) => p.name === name)!.score);
      expect(e.players).toBe(3);
      // Two rounds of three: each draws twice and finds the other four words.
      expect(e.wordsDrawn).toBe(2);
      expect(e.drawingsSolved).toBe(2);
      expect(e.correctGuesses).toBe(4);
    }
    expect(recorded[0]!.filter((e) => e.place === 1).length).toBeGreaterThan(0);
    expect(idOf('Ada')).toBeTruthy();
  });

  it('counts a game once, even if the standings are looked at again', () => {
    lobby([
      ['Ada', 1],
      ['Bo', 2],
    ]);
    rooms.start('s-Ada');
    playOut();
    rooms.backToLobby('s-Ada');
    expect(recorded).toHaveLength(1);
    rooms.start('s-Ada');
    playOut();
    expect(recorded).toHaveLength(2);
  });

  it('ignores games nobody played: no guess was ever correct', () => {
    lobby([
      ['Ada', 1],
      ['Bo', 2],
    ]);
    rooms.start('s-Ada');
    playOut(false);
    expect(recorded).toHaveLength(0);
  });

  it('ignores a game that was abandoned before the last round', () => {
    lobby([
      ['Ada', 1],
      ['Bo', 2],
    ]);
    rooms.start('s-Ada');
    const word = secrets['s-Ada']!.choices![0]!;
    rooms.chooseWord('s-Ada', 0);
    rooms.chat('s-Bo', word);
    rooms.leave('s-Bo');
    expect(state.phase).toBe('ended');
    expect(recorded).toHaveLength(0);
  });

  it('skips seats without a valid device id and needs two real devices', () => {
    lobby([
      ['Ada', 1],
      ['Bo', undefined],
    ]);
    rooms.start('s-Ada');
    playOut();
    expect(recorded).toHaveLength(0);

    rooms.backToLobby('s-Ada');
    const code = state.code;
    rooms.join('s-Cy', code, { ...me('Cy'), deviceId: 'not-a-device-id' });
    rooms.join('s-Di', code, me('Di', 4));
    rooms.start('s-Ada');
    playOut();
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.map((e) => e.name).sort()).toEqual(['Ada', 'Di']);
  });

  it('gives one device a single seat in a room, so a second tab earns nothing', () => {
    lobby([
      ['Ada', 1],
      ['Ada2', 1],
      ['Bo', 2],
    ]);
    rooms.start('s-Ada');
    playOut();
    expect(recorded[0]!.map((e) => e.name).sort()).toEqual(['Ada', 'Bo']);
  });
});
