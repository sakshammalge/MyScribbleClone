import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CanvasEvent,
  ClientToServerEvents,
  DrawOp,
  JoinResult,
  RoomState,
  ServerToClientEvents,
} from '@inkling/shared';
import { createInklingServer, type InklingServer } from './app';

describe('inkling server', () => {
  let server: InklingServer;
  let client: Socket<ServerToClientEvents, ClientToServerEvents>;
  let url: string;

  beforeEach(async () => {
    server = createInklingServer();
    await new Promise<void>((done) => server.http.listen(0, '127.0.0.1', done));
    url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    client?.close();
    await server.io.close();
  });

  it('greets a new socket with hello', async () => {
    client = connect(url);
    const hello = await new Promise((resolve) => client.on('hello', resolve));
    expect(hello).toMatchObject({ version: expect.any(String) });
  });

  it('acks ping with the server time', async () => {
    client = connect(url);
    const time = await new Promise<number>((resolve) =>
      client.on('connect', () => client.emit('ping', resolve)),
    );
    expect(time).toBeGreaterThan(0);
  });

  it('answers the health check', async () => {
    const res = await fetch(`${url}/healthz`);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});

describe('room events over sockets', () => {
  it('broadcasts roster changes to everyone in the room', async () => {
    const server = createInklingServer();
    await new Promise<void>((done) => server.http.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const a = connect(url);
    const b = connect(url);
    const profile = (name: string) => ({ name, avatar: { color: 1, face: 1 } });
    const created = await new Promise<JoinResult>((r) => a.emit('room:create', profile('Ada'), r));
    if (!created.ok) throw new Error(created.error);
    const seen = new Promise<RoomState>((resolve) =>
      a.on('room:state', (s) => s.players.length === 2 && resolve(s)),
    );
    const joined = await new Promise<JoinResult>((r) =>
      b.emit('room:join', { code: created.room.code, profile: profile('Bo') }, r),
    );
    expect(joined.ok).toBe(true);
    expect((await seen).players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
    a.close();
    b.close();
    await server.io.close();
  });
});

describe('canvas events over sockets', () => {
  it('relays the drawer to viewers and replays the picture to a late joiner', async () => {
    const server = createInklingServer();
    await new Promise<void>((done) => server.http.listen(0, '127.0.0.1', done));
    const url = `http://127.0.0.1:${(server.http.address() as AddressInfo).port}`;
    const profile = (name: string) => ({ name, avatar: { color: 1, face: 1 } });
    const [a, b, c] = [connect(url), connect(url), connect(url)];

    const created = await new Promise<JoinResult>((r) => a.emit('room:create', profile('Ada'), r));
    if (!created.ok) throw new Error(created.error);
    const code = created.room.code;
    await new Promise<JoinResult>((r) => b.emit('room:join', { code, profile: profile('Bo') }, r));
    await new Promise((r) => a.emit('room:start', r));

    const seen: CanvasEvent[] = [];
    b.on('canvas:event', (e) => seen.push(e));
    const echoed: CanvasEvent[] = [];
    a.on('canvas:event', (e) => echoed.push(e));
    const dot: CanvasEvent = {
      t: 'stroke',
      id: 'x1',
      tool: 'brush',
      color: 2,
      size: 0,
      points: [0.1, 0.2],
    };
    a.emit('canvas:event', dot);
    // A viewer trying to draw is ignored.
    b.emit('canvas:event', { ...dot, id: 'x2' });
    await vi.waitFor(() => expect(seen).toEqual([dot]));
    expect(echoed).toEqual([]);

    const replay = new Promise<DrawOp[]>((r) => c.on('canvas:replay', r));
    await new Promise<JoinResult>((r) => c.emit('room:join', { code, profile: profile('Cy') }, r));
    expect(await replay).toEqual([dot]);
    const synced = await new Promise<DrawOp[]>((r) => b.emit('canvas:sync', r));
    expect(synced).toEqual([dot]);

    [a, b, c].forEach((s) => s.close());
    await server.io.close();
  });
});
