import { useEffect, useState } from 'react';
import {
  APP_NAME,
  DEVICE_ID_HEADER,
  type LeaderboardEntry,
  type LeaderboardSort,
  type PlayerStats,
} from '@inkling/shared';
import { getDeviceId } from './session';

const TABS: { sort: LeaderboardSort; label: string }[] = [
  { sort: 'wins', label: 'Wins' },
  { sort: 'points', label: 'Points' },
  { sort: 'games', label: 'Games played' },
];

type Load<T> = { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: T };

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { [DEVICE_ID_HEADER]: getDeviceId() } });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

const average = (s: PlayerStats) => (s.games ? Math.round(s.totalPoints / s.games) : 0);
const fmt = new Intl.NumberFormat('en');

function MyStats({ load }: { load: Load<PlayerStats | null> }) {
  if (load.status === 'loading') return <p className="muted">Loading your stats…</p>;
  if (load.status === 'error')
    return <p className="muted">Your stats are unavailable right now.</p>;
  const s = load.data;
  if (!s) {
    return (
      <p className="muted" data-testid="my-stats-empty">
        No finished games on this device yet. Finish a full game with friends and your stats show up
        here.
      </p>
    );
  }
  const items: [string, string | number][] = [
    ['Games played', s.games],
    ['Wins', s.wins],
    ['Podium finishes', s.podiums],
    ['Total points', fmt.format(s.totalPoints)],
    ['Average points', fmt.format(average(s))],
    ['Best game', fmt.format(s.bestScore)],
    ['Correct guesses', s.correctGuesses],
    ['Words drawn', s.wordsDrawn],
    ['Drawings guessed', s.drawingsSolved],
  ];
  return (
    <dl className="stat-grid" data-testid="my-stats">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Leaderboard({ onBack }: { onBack: () => void }) {
  const [sort, setSort] = useState<LeaderboardSort>('wins');
  const [board, setBoard] = useState<Load<LeaderboardEntry[]>>({ status: 'loading' });
  const [mine, setMine] = useState<Load<PlayerStats | null>>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    getJson<{ stats: PlayerStats | null }>('/api/stats/me')
      .then((r) => live && setMine({ status: 'ok', data: r.stats }))
      .catch(() => live && setMine({ status: 'error' }));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    let live = true;
    setBoard({ status: 'loading' });
    getJson<{ entries: LeaderboardEntry[] }>(`/api/leaderboard?sort=${sort}`)
      .then((r) => live && setBoard({ status: 'ok', data: r.entries }))
      .catch(() => live && setBoard({ status: 'error' }));
    return () => {
      live = false;
    };
  }, [sort]);

  return (
    <main className="shell">
      <header className="brand">
        <img src="/logo.svg" alt="" />
        <div>
          <h1>{APP_NAME}</h1>
          <p>All-time leaderboard</p>
        </div>
      </header>

      <section className="card" aria-labelledby="my-stats-title">
        <h2 id="my-stats-title">My stats</h2>
        <MyStats load={mine} />
        <p className="muted">
          Stats follow this browser, not your name, so you can rename yourself freely. Clearing site
          data or switching browser starts a new player.
        </p>
      </section>

      <section className="card" aria-labelledby="board-title">
        <h2 id="board-title">Top players</h2>
        <div className="tabs" role="tablist" aria-label="Rank by">
          {TABS.map((t) => (
            <button
              key={t.sort}
              type="button"
              role="tab"
              aria-selected={sort === t.sort}
              className="tab"
              onClick={() => setSort(t.sort)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {board.status === 'loading' && <p className="muted">Loading…</p>}
        {board.status === 'error' && (
          <p className="error" role="alert">
            The leaderboard could not be loaded. Try again in a moment.
          </p>
        )}
        {board.status === 'ok' && board.data.length === 0 && (
          <p className="muted" data-testid="board-empty">
            Nobody has finished a game yet. Be the first!
          </p>
        )}
        {board.status === 'ok' && board.data.length > 0 && (
          <div className="table-wrap">
            <table className="rank-table" data-testid="leaderboard">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Player</th>
                  <th scope="col">Wins</th>
                  <th scope="col">Games</th>
                  <th scope="col">Points</th>
                  <th scope="col">Avg</th>
                </tr>
              </thead>
              <tbody>
                {board.data.map((e) => (
                  <tr key={e.rank} data-you={e.isYou}>
                    <td>{e.rank}</td>
                    <th scope="row">
                      {e.name}
                      {e.isYou && <span className="you-tag">you</span>}
                    </th>
                    <td>{e.wins}</td>
                    <td>{e.games}</td>
                    <td>{fmt.format(e.totalPoints)}</td>
                    <td>{fmt.format(average(e))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <button type="button" className="link board-link" onClick={onBack}>
        ← Back to the game
      </button>
    </main>
  );
}
