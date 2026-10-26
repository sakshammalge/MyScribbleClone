import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@inkling/shared';
import { RoomManager } from './rooms';

const VERSION = '0.1.0';
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

export interface InklingServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
}

export interface ServerOptions {
  /** Multiplies the word-choice and reveal pauses; only end-to-end tests set this. */
  timeScale?: number;
}

export function createInklingServer(options: ServerOptions = {}): InklingServer {
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

  const rooms = new RoomManager(
    (room, code) => {
      // A null room means it was deleted; nobody is left to notify.
      if (room) io.to(code).emit('room:state', room);
    },
    undefined,
    {
      timeScale: options.timeScale,
      chat: (socketIds, message) => {
        for (const id of socketIds) io.to(id).emit('chat:message', message);
      },
      private: (socketId, state) => {
        io.to(socketId).emit('game:private', state);
      },
    },
  );

  io.on('connection', (socket) => {
    socket.emit('hello', { serverTime: Date.now(), version: VERSION });
    socket.on('ping', (ack) => ack(Date.now()));

    // Socket.IO rooms mirror game rooms so broadcasts are one call.
    const enter = (code: string) => {
      for (const r of socket.rooms) if (r !== socket.id) void socket.leave(r);
      void socket.join(code);
    };

    socket.on('room:create', (profile, ack) => {
      const result = rooms.create(socket.id, profile);
      if (result.ok) enter(result.room.code);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('room:join', (req, ack) => {
      const result = rooms.join(socket.id, req?.code, req?.profile, req?.token);
      if (result.ok) {
        enter(result.room.code);
        // Rejoining mid-drawing (refresh, reconnect): hand over the picture so far.
        socket.emit('canvas:replay', rooms.canvasOps(socket.id));
        socket.emit('chat:history', rooms.chatHistory(socket.id));
        socket.emit('game:private', rooms.privateState(socket.id));
      }
      if (typeof ack === 'function') ack(result);
    });
    socket.on('room:settings', (patch, ack) => {
      const result = rooms.updateSettings(socket.id, patch);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('room:start', (ack) => {
      const result = rooms.start(socket.id);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('room:words', (req, ack) => {
      const result = rooms.setWords(socket.id, req);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('word:choose', (index, ack) => {
      const result = rooms.chooseWord(socket.id, index);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('chat:send', (text, ack) => {
      const result = rooms.chat(socket.id, text);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('game:sync', (ack) => {
      if (typeof ack === 'function') ack(rooms.privateState(socket.id));
    });
    socket.on('room:lobby', (ack) => {
      const result = rooms.backToLobby(socket.id);
      if (typeof ack === 'function') ack(result);
    });
    socket.on('canvas:event', (raw) => {
      const relay = rooms.canvasEvent(socket.id, raw);
      if (relay) socket.to(relay.code).emit('canvas:event', relay.event);
    });
    socket.on('canvas:sync', (ack) => {
      if (typeof ack === 'function') ack(rooms.canvasOps(socket.id));
    });
    socket.on('room:leave', () => {
      // Leave the socket room first so the leaver is not sent the update about their own exit.
      for (const r of socket.rooms) if (r !== socket.id) void socket.leave(r);
      rooms.leave(socket.id);
    });
    socket.on('disconnect', () => rooms.disconnect(socket.id));
  });

  return { http, io, rooms };
}
