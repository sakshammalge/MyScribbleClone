import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientToServerEvents, ServerToClientEvents } from '@inkling/shared';
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
