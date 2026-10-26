/**
 * Abuse scenarios against a running Inkling server: the bad packets and floods a hostile visitor
 * could send. The tests run them in-process; point the CLI at a deployment to check it:
 *   npm run attack -- https://your-game.example.com
 */
import { pathToFileURL } from 'node:url';
import { io as connect, type Socket } from 'socket.io-client';
import {
  STROKE_LIMITS,
  type ClientToServerEvents,
  type DrawOp,
  type JoinResult,
  type ServerToClientEvents,
} from '@inkling/shared';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
export interface Outcome {
  name: string;
  ok: boolean;
  detail: string;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const profile = (name: string) => ({ name, avatar: { color: 1, face: 1 } });

function open(url: string): Promise<Client | null> {
  return new Promise((resolve) => {
    const s: Client = connect(url, {
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
    });
    s.on('connect', () => resolve(s));
    s.on('connect_error', () => {
      s.close();
      resolve(null);
    });
  });
}

const call = <T>(s: Client, event: string, ...args: unknown[]) =>
  new Promise<T>((resolve) => (s as Socket).emit(event, ...args, resolve));

/** Packets that used to throw inside a handler; the server must shrug them all off. */
export async function badPackets(url: string): Promise<Outcome> {
  const s = (await open(url))!;
  const raw = s as Socket;
  raw.emit('ping');
  raw.emit('ping', 'not a function');
  raw.emit('room:create');
  raw.emit('room:create', null, 5);
  raw.emit('room:join', 'ABCDE');
  raw.emit('room:settings', null);
  raw.emit('chat:send', { not: 'text' });
  raw.emit('canvas:event', null);
  raw.emit('canvas:event', { t: 'stroke', points: 'lots' });
  raw.emit('canvas:sync');
  raw.emit('game:sync', 42);
  raw.emit('room:kick', {}, () => {});
  raw.emit('word:choose', 'zero');
  raw.emit('room:words', { words: 'nope' });
  await pause(300);
  const alive = await Promise.race([call<number>(s, 'ping'), pause(2000).then(() => 0)]);
  s.close();
  return { name: 'bad packets', ok: alive > 0, detail: alive > 0 ? 'still answering' : 'no reply' };
}

/** A two-player game with the first socket drawing. */
async function startGame(url: string) {
  const host = (await open(url))!;
  const guest = (await open(url))!;
  const made = await call<JoinResult>(host, 'room:create', profile('Host'));
  if (!made.ok) throw new Error(`create failed: ${made.error}`);
  await call(guest, 'room:join', { code: made.room.code, profile: profile('Guest') });
  await call(host, 'room:start');
  let found: Client | null = null;
  for (let tries = 0; tries < 20 && !found; tries++) {
    for (const who of [host, guest]) {
      const state = await call<{ choices: string[] | null }>(who, 'game:sync');
      if (state.choices) found = who;
    }
    if (!found) await pause(250);
  }
  const drawer = found as Client | null;
  if (!drawer) throw new Error('nobody was offered words');
  await call(drawer, 'word:choose', 0);
  const viewer = drawer === host ? guest : host;
  return { host, guest, drawer, viewer };
}

/** One drawing that never stops: the board must stay bounded and replays must stay small. */
export async function drawingFlood(url: string): Promise<Outcome> {
  const { host, guest, drawer, viewer } = await startGame(url);
  const chunk = Array.from({ length: STROKE_LIMITS.chunkPoints * 2 }, (_, i) => (i % 100) / 100);
  for (let i = 0; i < 260; i++) {
    drawer.emit('canvas:event', {
      t: 'stroke',
      id: `s${Math.floor(i / 25)}`,
      tool: 'brush',
      color: 0,
      size: 1,
      points: chunk,
    });
    if (i % 100 === 99) await pause(1200); // stay inside the per-socket rate limit
  }
  await pause(300);
  const ops = await call<DrawOp[]>(viewer, 'canvas:sync');
  const points = ops.reduce((n, op) => n + (op.t === 'stroke' ? op.points.length / 2 : 1), 0);
  host.close();
  guest.close();
  return {
    name: 'drawing flood',
    ok: points <= STROKE_LIMITS.totalPoints,
    detail: `${points} points kept (cap ${STROKE_LIMITS.totalPoints})`,
  };
}

/** Re-requesting the whole drawing in a loop: only a few answers may come back. */
export async function syncFlood(url: string): Promise<Outcome> {
  const { host, guest, drawer, viewer } = await startGame(url);
  drawer.emit('canvas:event', {
    t: 'stroke',
    id: 'a',
    tool: 'brush',
    color: 0,
    size: 1,
    points: [0.1, 0.1, 0.2, 0.2],
  });
  let answers = 0;
  for (let i = 0; i < 50; i++) (viewer as Socket).emit('canvas:sync', () => answers++);
  await pause(800);
  host.close();
  guest.close();
  return { name: 'sync flood', ok: answers <= 6, detail: `${answers} of 50 syncs answered` };
}

/** Hundreds of sockets from one address: the cap must stop most of them. */
export async function connectionFlood(url: string, attempts = 500): Promise<Outcome> {
  const sockets = await Promise.all(Array.from({ length: attempts }, () => open(url)));
  const held = sockets.filter((s): s is Client => s !== null);
  held.forEach((s) => s.close());
  return {
    name: 'connection flood',
    ok: held.length < attempts / 4,
    detail: `${held.length} of ${attempts} sockets accepted`,
  };
}

/** Many sockets each opening a room: one address may only hold a handful. */
export async function roomFlood(url: string, attempts = 25): Promise<Outcome> {
  const sockets = (await Promise.all(Array.from({ length: attempts }, () => open(url)))).filter(
    (s): s is Client => s !== null,
  );
  const results = await Promise.all(
    sockets.map((s, i) => call<JoinResult>(s, 'room:create', profile(`P${i}`))),
  );
  const made = results.filter((r) => r.ok).length;
  sockets.forEach((s) => s.close());
  return {
    name: 'room flood',
    ok: made <= 10,
    detail: `${made} rooms from ${sockets.length} sockets`,
  };
}

export async function runAttacks(url: string): Promise<Outcome[]> {
  const out: Outcome[] = [];
  // Sequential: the floods share the same address budget.
  for (const scenario of [badPackets, syncFlood, drawingFlood, roomFlood, connectionFlood]) {
    out.push(await scenario(url));
    await pause(1500);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2] ?? 'http://localhost:3001';
  console.log(`Attacking ${url}`);
  const results = await runAttacks(url);
  for (const r of results) console.log(`${r.ok ? 'held ' : 'BROKE'}  ${r.name}: ${r.detail}`);
  process.exit(results.every((r) => r.ok) ? 0 : 1);
}
