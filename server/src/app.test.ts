import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  ClientToServerEvents,
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
