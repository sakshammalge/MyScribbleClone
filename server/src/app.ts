import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@inkling/shared';

const VERSION = '0.1.0';
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export interface InklingServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
}

export function createInklingServer(): InklingServer {
  const app = express();
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  // In production the built client is served from the same origin as the sockets.
  if (existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get('*', (_req, res) => res.sendFile(resolve(clientDist, 'index.html')));
  }

  const http = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http);

  io.on('connection', (socket) => {
    socket.emit('hello', { serverTime: Date.now(), version: VERSION });
    socket.on('ping', (ack) => ack(Date.now()));
  });

  return { http, io };
}
