import pg from 'pg';
import type { LeaderboardSort, PlayerStats } from '@inkling/shared';
import {
  podiumFinish,
  withoutDevice,
  wonGame,
  type GameEntry,
  type StatsRow,
  type StatsStore,
} from './stats';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS player_stats (
  device_id       text PRIMARY KEY,
  name            text NOT NULL,
  games           integer NOT NULL DEFAULT 0,
  wins            integer NOT NULL DEFAULT 0,
  podiums         integer NOT NULL DEFAULT 0,
  total_points    bigint NOT NULL DEFAULT 0,
  best_score      integer NOT NULL DEFAULT 0,
  correct_guesses integer NOT NULL DEFAULT 0,
  words_drawn     integer NOT NULL DEFAULT 0,
  drawings_solved integer NOT NULL DEFAULT 0,
  last_played     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_stats_wins ON player_stats (wins DESC, total_points DESC);
CREATE INDEX IF NOT EXISTS player_stats_points ON player_stats (total_points DESC);
`;

const ORDER: Record<LeaderboardSort, string> = {
  wins: 'wins DESC, total_points DESC, games DESC, last_played DESC',
  points: 'total_points DESC, wins DESC, games DESC, last_played DESC',
  games: 'games DESC, wins DESC, total_points DESC, last_played DESC',
};

const COLUMNS = `device_id, name, games, wins, podiums, total_points, best_score,
  correct_guesses, words_drawn, drawings_solved, (extract(epoch from last_played) * 1000)::bigint AS played_ms`;

interface Row {
  device_id: string;
  name: string;
  games: number;
  wins: number;
  podiums: number;
  total_points: string;
  best_score: number;
  correct_guesses: number;
  words_drawn: number;
  drawings_solved: number;
  played_ms: string;
}

const toRow = (r: Row): StatsRow => ({
  deviceId: r.device_id,
  name: r.name,
  games: r.games,
  wins: r.wins,
  podiums: r.podiums,
  totalPoints: Number(r.total_points),
  bestScore: r.best_score,
  correctGuesses: r.correct_guesses,
  wordsDrawn: r.words_drawn,
  drawingsSolved: r.drawings_solved,
  lastPlayed: Number(r.played_ms),
});

/** Stats in Postgres (Render's managed database), so they survive restarts and deploys. */
export class PgStats implements StatsStore {
  readonly kind = 'postgres';

  private constructor(private pool: pg.Pool) {}

  /** Connects and creates the table if it is missing; throws when the database is unreachable. */
  static async connect(url: string, ssl: boolean): Promise<PgStats> {
    const pool = new pg.Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 5000,
      ssl: ssl ? { rejectUnauthorized: false } : undefined,
    });
    // An idle connection dropped by the server must not crash the process.
    pool.on('error', (err) => console.error('Stats database error:', err.message));
    try {
      await pool.query(SCHEMA);
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
    return new PgStats(pool);
  }

  async recordGame(entries: GameEntry[], at = Date.now()): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const e of entries) {
        await client.query(
          `INSERT INTO player_stats AS p (device_id, name, games, wins, podiums, total_points,
             best_score, correct_guesses, words_drawn, drawings_solved, last_played)
           VALUES ($1, $2, 1, $3, $4, $5::bigint, $5::int, $6, $7, $8, to_timestamp($9 / 1000.0))
           ON CONFLICT (device_id) DO UPDATE SET
             name = EXCLUDED.name,
             games = p.games + 1,
             wins = p.wins + EXCLUDED.wins,
             podiums = p.podiums + EXCLUDED.podiums,
             total_points = p.total_points + EXCLUDED.total_points,
             best_score = GREATEST(p.best_score, EXCLUDED.best_score),
             correct_guesses = p.correct_guesses + EXCLUDED.correct_guesses,
             words_drawn = p.words_drawn + EXCLUDED.words_drawn,
             drawings_solved = p.drawings_solved + EXCLUDED.drawings_solved,
             last_played = EXCLUDED.last_played`,
          [
            e.deviceId,
            e.name,
            wonGame(e) ? 1 : 0,
            podiumFinish(e) ? 1 : 0,
            e.score,
            e.correctGuesses,
            e.wordsDrawn,
            e.drawingsSolved,
            at,
          ],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async top(sort: LeaderboardSort, limit: number): Promise<StatsRow[]> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM player_stats ORDER BY ${ORDER[sort]} LIMIT $1`,
      [limit],
    );
    return rows.map(toRow);
  }

  async get(deviceId: string): Promise<PlayerStats | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM player_stats WHERE device_id = $1`,
      [deviceId],
    );
    return rows[0] ? withoutDevice(toRow(rows[0])) : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
