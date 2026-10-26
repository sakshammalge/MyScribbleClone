import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STROKE_LIMITS, type StrokeOp } from '@inkling/shared';
import { clientIp, parseTrustProxy } from './abuse';
import { badPackets, connectionFlood, drawingFlood, roomFlood, syncFlood } from './attack';
import { createInklingServer, type InklingServer } from './app';
import { Board } from './canvas';
import { RoomManager } from './rooms';
import { WORD_BANK } from './wordlist';
import { hasProfanity } from '@inkling/shared';

const me = (name: string) => ({ name, avatar: { color: 0, face: 0 } });

describe('attack scenarios against a live server', () => {
  let server: InklingServer;
  let url: string;
  beforeEach(async () => {
    server = createInklingServer();
    await new Promise<void>((done) => server.http.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    await server.io.close();
  });

  it('survives packets with missing acks and junk arguments', async () => {
    const out = await badPackets(url);
    expect(out.ok, out.detail).toBe(true);
  });

  it('answers only a few of a flood of canvas:sync requests', async () => {
    const out = await syncFlood(url);
    expect(out.ok, out.detail).toBe(true);
  });

  it('keeps a never-ending drawing within the point cap', async () => {
    const out = await drawingFlood(url);
    expect(out.ok, out.detail).toBe(true);
  }, 30_000);

  it('stops one address from opening hundreds of sockets', async () => {
    const out = await connectionFlood(url);
    expect(out.ok, out.detail).toBe(true);
  }, 30_000);

  it('stops one address from opening dozens of rooms', async () => {
    const out = await roomFlood(url);
    expect(out.ok, out.detail).toBe(true);
    expect(server.rooms.roomCount()).toBeLessThanOrEqual(0 + 6);
  });

  it('negotiates websocket compression and hides the framework', async () => {
    const ws = new WebSocket(url.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket', {
      perMessageDeflate: true,
    });
    await new Promise((r) => ws.on('open', r));
    expect(ws.extensions).toContain('permessage-deflate');
    ws.close();
    const res = await fetch(`${url}/healthz`);
    expect(res.headers.get('x-powered-by')).toBeNull();
  });

  it('sends security headers', async () => {
    const res = await fetch(`${url}/healthz`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('referrer-policy')).toBeTruthy();
  });
});

describe('proxy trust', () => {
  const req = (xff: string | undefined) => ({
    address: '::ffff:10.0.0.1',
    headers: xff ? { 'x-forwarded-for': xff } : {},
  });
  it('ignores the forwarding header unless a proxy is trusted', () => {
    expect(clientIp(req('6.6.6.6'), 0)).toBe('10.0.0.1');
  });
  it('reads the address the nearest trusted proxy appended, not what the client claimed', () => {
    expect(clientIp(req('6.6.6.6, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIp(req('6.6.6.6, 203.0.113.9, 10.9.9.9'), 2)).toBe('203.0.113.9');
    expect(clientIp(req(undefined), 1)).toBe('10.0.0.1');
  });
  it('parses the setting', () => {
    expect(parseTrustProxy('true')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('nope')).toBe(0);
    expect(parseTrustProxy(undefined)).toBe(0);
  });
});

describe('per-address caps through a proxy', () => {
  it('counts visitors by forwarded address', async () => {
    const server = createInklingServer({ trustProxy: 1, maxConnectionsPerIp: 2 });
    await new Promise<void>((done) => server.http.listen(0, '127.0.0.1', done));
    const base = `ws://127.0.0.1:${(server.http.address() as AddressInfo).port}/socket.io/?EIO=4&transport=websocket`;
    const connect = (ip: string) =>
      new Promise<boolean>((resolve) => {
        const ws = new WebSocket(base, { headers: { 'x-forwarded-for': `1.1.1.1, ${ip}` } });
        ws.on('message', (m) => {
          // Engine open packet "0{...}", then a namespace connect "40{...}" or error "44{...}".
          const text = String(m);
          if (text.startsWith('0')) ws.send('40');
          else if (text.startsWith('40')) resolve(true);
          else if (text.startsWith('44')) resolve(false);
        });
        ws.on('error', () => resolve(false));
      });
    const results = [await connect('9.9.9.1'), await connect('9.9.9.1'), await connect('9.9.9.1')];
    expect(results).toEqual([true, true, false]);
    expect(await connect('9.9.9.2')).toBe(true);
    await server.io.close();
  });
});

describe('drawing size cap', () => {
  const stroke = (id: string, n: number): StrokeOp => ({
    t: 'stroke',
    id,
    tool: 'brush',
    color: 0,
    size: 1,
    points: Array.from({ length: n * 2 }, () => 0.5),
  });

  it('stops growing at the total point cap and frees room on undo and clear', () => {
    const board = new Board();
    for (let i = 0; i < 400; i++) board.apply(stroke(`s${i}`, STROKE_LIMITS.chunkPoints));
    const held = () =>
      board.snapshot().reduce((n, op) => n + (op.t === 'stroke' ? op.points.length / 2 : 1), 0);
    expect(held()).toBe(STROKE_LIMITS.totalPoints);
    expect(board.apply(stroke('more', 5))).toBeNull();
    expect(board.apply({ t: 'fill', id: 'f', color: 1, x: 0, y: 0 })).toBeNull();
    expect(board.apply({ t: 'undo' })).toBeTruthy();
    expect(board.apply(stroke('again', 5))).toBeTruthy();
    board.apply({ t: 'clear' });
    expect(board.apply(stroke('fresh', 50))).toBeTruthy();
    expect(held()).toBe(50);
  });

  it('trims a chunk that crosses the cap to whole points', () => {
    const board = new Board();
    for (let i = 0; i < 149; i++) board.apply(stroke(`s${i}`, STROKE_LIMITS.chunkPoints));
    board.apply(stroke('tail', 150));
    const relayed = board.apply({ ...stroke('tail', 150) });
    expect(relayed).toMatchObject({ t: 'stroke' });
    const total = board
      .snapshot()
      .reduce((n, op) => n + (op.t === 'stroke' ? op.points.length : 1), 0);
    expect(total / 2).toBeLessThanOrEqual(STROKE_LIMITS.totalPoints);
  });
});

describe('RoomManager hardening', () => {
  let rooms: RoomManager;
  beforeEach(() => {
    vi.useFakeTimers();
    rooms = new RoomManager(() => {}, 1000, { roomsPerIp: 2, maxRooms: 3 });
  });
  afterEach(() => vi.useRealTimers());

  const created = (socket: string, name: string) => {
    const r = rooms.create(socket, me(name));
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it('limits rooms per address and returns the slot when a room closes', () => {
    rooms.attach('a1', '1.1.1.1');
    rooms.attach('a2', '1.1.1.1');
    rooms.attach('a3', '1.1.1.1');
    created('a1', 'One');
    created('a2', 'Two');
    expect(rooms.create('a3', me('Three'))).toEqual({ ok: false, error: 'too-many-rooms' });
    rooms.leave('a1');
    expect(rooms.create('a3', me('Three')).ok).toBe(true);
  });

  it('limits rooms on the whole server', () => {
    for (const [i, ip] of ['1.1.1.1', '2.2.2.2', '3.3.3.3', '4.4.4.4'].entries()) {
      rooms.attach(`s${i}`, ip);
    }
    created('s0', 'A');
    created('s1', 'B');
    created('s2', 'C');
    expect(rooms.create('s3', me('D'))).toEqual({ ok: false, error: 'server-full' });
  });

  it('keeps a kicked player out by token and address, even under a new name', () => {
    rooms.attach('host', '1.1.1.1');
    rooms.attach('bad', '2.2.2.2');
    rooms.attach('bad2', '2.2.2.2');
    rooms.attach('bad3', '3.3.3.3');
    const host = created('host', 'Host');
    const code = host.room.code;
    const bad = rooms.join('bad', code, me('Bad'));
    if (!bad.ok) throw new Error(bad.error);
    expect(rooms.kick('host', bad.playerId)).toMatchObject({ ok: true });
    // New socket, new name, same address.
    expect(rooms.join('bad2', code, me('Fresh'))).toEqual({ ok: false, error: 'kicked' });
    // Different address but the old token.
    expect(rooms.join('bad3', code, me('Other'), bad.token)).toEqual({
      ok: false,
      error: 'kicked',
    });
    // Different address, new name: a stranger is fine.
    expect(rooms.join('bad3', code, me('Other')).ok).toBe(true);
  });

  it('passes the host role to a connected player the moment the host drops', () => {
    const host = created('h', 'Host');
    const guest = rooms.join('g', host.room.code, me('Guest'));
    if (!guest.ok) throw new Error(guest.error);
    const seen: (string | undefined)[] = [];
    const watching = new RoomManager((room) => {
      seen.push(room?.players.find((p) => p.isHost)?.name);
    });
    const h = watching.create('h', me('Host'));
    if (!h.ok) throw new Error(h.error);
    watching.join('g', h.room.code, me('Guest'));
    watching.disconnect('h');
    expect(seen.at(-1)).toBe('Guest');
    // The old host coming back is an ordinary player now.
    watching.join('h2', h.room.code, me('Host'), h.token);
    expect(seen.at(-1)).toBe('Guest');
  });

  it('keeps the host when nobody else is connected, and gives it to the first one back', () => {
    const seen: (string | undefined)[] = [];
    const watching = new RoomManager((room) => {
      seen.push(room?.players.find((p) => p.isHost)?.name);
    });
    const h = watching.create('h', me('Host'));
    if (!h.ok) throw new Error(h.error);
    const g = watching.join('g', h.room.code, me('Guest'));
    if (!g.ok) throw new Error(g.error);
    watching.disconnect('g');
    watching.disconnect('h');
    expect(seen.at(-1)).toBe('Host');
    watching.join('g2', h.room.code, me('Guest'), g.token);
    expect(seen.at(-1)).toBe('Guest');
  });

  it('refuses unfriendly names and masks them in chat', () => {
    const heard: string[] = [];
    const r = new RoomManager(() => {}, 1000, {
      chat: (_ids, m) => heard.push(m.text),
    });
    expect(r.create('x', me('shit head'))).toEqual({ ok: false, error: 'name-not-allowed' });
    const h = r.create('h', me('Host'));
    if (!h.ok) throw new Error(h.error);
    expect(r.join('g', h.room.code, me('f.u.c.k'))).toEqual({
      ok: false,
      error: 'name-not-allowed',
    });
    r.chat('h', 'you are a fuck');
    expect(heard.at(-1)).toBe('you are a ****');
    r.setWords('h', { words: ['apple', 'shit', 'pear'], only: true });
    const snapshot = r.join('g', h.room.code, me('Guest'));
    expect(snapshot.ok && snapshot.room.customWordCount).toBe(2);
  });

  it('has no word in the built-in bank that the filter would mask', () => {
    expect(WORD_BANK.filter((w) => hasProfanity(w))).toEqual([]);
  });
});
