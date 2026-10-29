import type { LeaderboardSort, PlayerStats } from '@inkling/shared';

/** What one device did in one finished game. */
export interface GameEntry {
  deviceId: string;
  name: string;
  score: number;
  /** 1-based; ties share a place. */
  place: number;
  /** Seats in the game, for deciding what counts as a podium. */
  players: number;
  correctGuesses: number;
  wordsDrawn: number;
  drawingsSolved: number;
}

export interface StatsRow extends PlayerStats {
  deviceId: string;
}

/** Where all-time stats live. Everything is keyed by the secret device id. */
export interface StatsStore {
  readonly kind: string;
  recordGame(entries: GameEntry[], at?: number): Promise<void>;
  /** Best first for the chosen ordering. */
  top(sort: LeaderboardSort, limit: number): Promise<StatsRow[]>;
  get(deviceId: string): Promise<PlayerStats | null>;
  close(): Promise<void>;
}

/** The row without the device id, which must never leave the server. */
export function withoutDevice(row: StatsRow): PlayerStats {
  const copy: Partial<StatsRow> = { ...row };
  delete copy.deviceId;
  return copy as PlayerStats;
}

export const wonGame = (e: GameEntry) => e.place === 1;
export const podiumFinish = (e: GameEntry) => e.players >= 3 && e.place <= 3;

/** Ordering shared by every store: the chosen column, then the usual tie-breakers. */
export function compareRows(sort: LeaderboardSort) {
  const keys: Record<LeaderboardSort, (keyof PlayerStats)[]> = {
    wins: ['wins', 'totalPoints', 'games'],
    points: ['totalPoints', 'wins', 'games'],
    games: ['games', 'wins', 'totalPoints'],
  };
  return (a: StatsRow, b: StatsRow) => {
    for (const k of keys[sort]) {
      const d = (b[k] as number) - (a[k] as number);
      if (d !== 0) return d;
    }
    return b.lastPlayed - a.lastPlayed;
  };
}

/** Keeps stats for the life of the process; the fallback when no database is configured. */
export class MemoryStats implements StatsStore {
  readonly kind = 'memory';
  private rows = new Map<string, StatsRow>();

  constructor(private maxPlayers = 5000) {}

  async recordGame(entries: GameEntry[], at = Date.now()): Promise<void> {
    for (const e of entries) {
      const row = this.rows.get(e.deviceId) ?? {
        deviceId: e.deviceId,
        name: e.name,
        games: 0,
        wins: 0,
        podiums: 0,
        totalPoints: 0,
        bestScore: 0,
        correctGuesses: 0,
        wordsDrawn: 0,
        drawingsSolved: 0,
        lastPlayed: at,
      };
      row.name = e.name;
      row.games += 1;
      row.wins += wonGame(e) ? 1 : 0;
      row.podiums += podiumFinish(e) ? 1 : 0;
      row.totalPoints += e.score;
      row.bestScore = Math.max(row.bestScore, e.score);
      row.correctGuesses += e.correctGuesses;
      row.wordsDrawn += e.wordsDrawn;
      row.drawingsSolved += e.drawingsSolved;
      row.lastPlayed = at;
      this.rows.set(e.deviceId, row);
    }
    // Bound memory: forget whoever played longest ago.
    if (this.rows.size > this.maxPlayers) {
      const stale = [...this.rows.values()].sort((a, b) => a.lastPlayed - b.lastPlayed);
      for (const r of stale.slice(0, this.rows.size - this.maxPlayers)) {
        this.rows.delete(r.deviceId);
      }
    }
  }

  async top(sort: LeaderboardSort, limit: number): Promise<StatsRow[]> {
    return [...this.rows.values()].sort(compareRows(sort)).slice(0, limit);
  }

  async get(deviceId: string): Promise<PlayerStats | null> {
    const row = this.rows.get(deviceId);
    return row ? withoutDevice(row) : null;
  }

  async close(): Promise<void> {}
}
