import { existsSync } from 'node:fs';
import { createServer, type Server as HttpServer } from 'node:http';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import compression from 'compression';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@inkling/shared';
import { PerIpCounter, clientIp } from './abuse';
import { socketLimits } from './ratelimit';
import { RoomManager } from './rooms';

const VERSION = '0.1.0';
const clientDist = resolve(dirname(fileURLToPath(import.meta.url)), '../../client/dist');

/** True when the Vite build is present, so the server can serve the whole game itself. */
export const clientBuilt = existsSync(clientDist);

export interface InklingServer {
  http: HttpServer;
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
}

export interface ServerOptions {
  /** Multiplies the word-choice and reveal pauses; only end-to-end tests set this. */
  timeScale?: number;
  /** How many reverse proxies sit in front of us (0 for none); see `clientIp`. */
  trustProxy?: number;
  /** Sockets one address may hold open at once. */
  maxConnectionsPerIp?: number;
  /** Rooms one address may have open at once. */
  maxRoomsPerIp?: number;
  /** Rooms open across the whole server. */
  maxRooms?: number;
}

export const DEFAULT_LIMITS = {
  maxConnectionsPerIp: 30,
  maxRoomsPerIp: 6,
  maxRooms: 1000,
};

/** Hashed build output never changes under the same name, so browsers may keep it for a year. */
const ONE_YEAR = 60 * 60 * 24 * 365;

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  // Some browsers do not count ws/wss as 'self', so spell the sockets out.
  "connect-src 'self' ws: wss:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
].join('; ');

export function createInklingServer(options: ServerOptions = {}): InklingServer {
  const trustProxy = options.trustProxy ?? 0;
  const connections = new PerIpCounter(
    options.maxConnectionsPerIp ?? DEFAULT_LIMITS.maxConnectionsPerIp,
  );

  const app = express();
  app.disable('x-powered-by');
  if (trustProxy > 0) app.set('trust proxy', trustProxy);
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    // Only meaningful (and only honoured) over https, i.e. when a trusted proxy terminated TLS.
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });
  app.use(compression());
  app.get('/healthz', (_req, res) => {
    res.json({ ok: true, version: VERSION });
  });

  // In production the built client is served from the same origin as the sockets.
  if (clientBuilt) {
    app.use(
      express.static(clientDist, {
        index: false,
        setHeaders: (res, path) => {
          if (path.includes(`${sep}assets${sep}`)) {
            res.setHeader('Cache-Control', `public, max-age=${ONE_YEAR}, immutable`);
          } else {
            res.setHeader('Cache-Control', 'public, max-age=3600');
          }
        },
      }),
    );
    // The page itself names the hashed assets, so it must always be revalidated.
    app.get('*', (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(resolve(clientDist, 'index.html'));
    });
  }

  const http = createServer(app);
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    // A drawing chunk is a few KB; nothing legitimate needs the 1 MB default.
    maxHttpBufferSize: 64 * 1024,
    // Drawing chunks are long runs of similar numbers and shrink a lot.
    perMessageDeflate: { threshold: 512, zlibDeflateOptions: { level: 3, memLevel: 7 } },
  });

  // Cap sockets per address before they cost us a handler, a limiter and a seat.
  io.use((socket, next) => {
    const ip = clientIp(socket.handshake, trustProxy);
    if (!connections.acquire(ip)) return next(new Error('too-many-connections'));
    socket.data.ip = ip;
    socket.on('disconnect', () => connections.release(ip));
    next();
  });

  const rooms = new RoomManager(
    (room, code) => {
      // A null room means it was deleted; nobody is left to notify.
      if (room) io.to(code).emit('room:state', room);
    },
    undefined,
    {
      timeScale: options.timeScale,
      roomsPerIp: options.maxRoomsPerIp ?? DEFAULT_LIMITS.maxRoomsPerIp,
      maxRooms: options.maxRooms ?? DEFAULT_LIMITS.maxRooms,
      chat: (socketIds, message) => {
        for (const id of socketIds) io.to(id).emit('chat:message', message);
      },
      emote: (socketIds, event) => {
        for (const id of socketIds) io.to(id).emit('emote:show', event);
      },
      private: (socketId, state) => {
        io.to(socketId).emit('game:private', state);
      },
    },
  );

  io.on('connection', (socket) => {
    const ip = socket.data.ip as string;
    rooms.attach(socket.id, ip);
    socket.emit('hello', { serverTime: Date.now(), version: VERSION });

    const limits = socketLimits();
    type Bucket = keyof typeof limits;

    /**
     * Wraps a handler so that a flooding socket is told to slow down instead of being served, and
     * so that a malformed packet (a missing or wrong-typed ack, junk arguments) can only ever fail
     * that one call: it must never throw out of the socket and take the process with it.
     * `quiet` handlers answer with data, so on failure they stay silent rather than send a result
     * of the wrong shape.
     */
    const guarded =
      <A extends unknown[]>(bucket: Bucket | null, handler: (...args: A) => void, quiet = false) =>
      (...args: A) => {
        const ack = args[args.length - 1];
        const reply = (error: 'rate-limited' | 'bad-request') => {
          if (quiet || typeof ack !== 'function') return;
          try {
            ack({ ok: false, error });
          } catch {
            // The client's ack itself is broken; nothing more to tell them.
          }
        };
        try {
          if (bucket && !limits[bucket].take()) return reply('rate-limited');
          handler(...args);
        } catch (err) {
          console.error(`Handler failed: ${err instanceof Error ? err.message : String(err)}`);
          reply('bad-request');
        }
      };
    const limited = <A extends unknown[]>(bucket: Bucket, handler: (...args: A) => void) =>
      guarded(bucket, handler);

    socket.on(
      'ping',
      guarded(
        'ping',
        (ack) => {
          if (typeof ack === 'function') ack(Date.now());
        },
        true,
      ),
    );

    // Socket.IO rooms mirror game rooms so broadcasts are one call.
    const enter = (code: string) => {
      for (const r of socket.rooms) if (r !== socket.id) void socket.leave(r);
      void socket.join(code);
    };

    socket.on(
      'room:create',
      limited('actions', (profile, ack) => {
        const result = rooms.create(socket.id, profile);
        if (result.ok) enter(result.room.code);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'room:join',
      limited('actions', (req, ack) => {
        const result = rooms.join(socket.id, req?.code, req?.profile, req?.token);
        if (result.ok) {
          enter(result.room.code);
          // Rejoining mid-drawing (refresh, reconnect): hand over the picture so far.
          socket.emit('canvas:replay', rooms.canvasOps(socket.id));
          socket.emit('chat:history', rooms.chatHistory(socket.id));
          socket.emit('game:private', rooms.privateState(socket.id));
        }
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'room:settings',
      limited('actions', (patch, ack) => {
        const result = rooms.updateSettings(socket.id, patch);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'room:start',
      limited('actions', (ack) => {
        const result = rooms.start(socket.id);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'room:words',
      limited('actions', (req, ack) => {
        const result = rooms.setWords(socket.id, req);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'word:choose',
      limited('actions', (index, ack) => {
        const result = rooms.chooseWord(socket.id, index);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'chat:send',
      limited('chat', (text, ack) => {
        const result = rooms.chat(socket.id, text);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'emote:send',
      limited('emote', (index, ack) => {
        const result = rooms.emote(socket.id, index);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'game:sync',
      guarded(
        'sync',
        (ack) => {
          if (typeof ack === 'function') ack(rooms.privateState(socket.id));
        },
        true,
      ),
    );
    socket.on(
      'room:lobby',
      limited('actions', (ack) => {
        const result = rooms.backToLobby(socket.id);
        if (typeof ack === 'function') ack(result);
      }),
    );
    socket.on(
      'canvas:event',
      limited('canvas', (raw) => {
        const relay = rooms.canvasEvent(socket.id, raw);
        if (relay) socket.to(relay.code).emit('canvas:event', relay.event);
      }),
    );
    socket.on(
      'canvas:sync',
      guarded(
        'sync',
        (ack) => {
          if (typeof ack === 'function') ack(rooms.canvasOps(socket.id));
        },
        true,
      ),
    );
    socket.on(
      'gallery:sync',
      guarded(
        'sync',
        (ack) => {
          if (typeof ack === 'function') ack(rooms.galleryFor(socket.id));
        },
        true,
      ),
    );
    socket.on(
      'room:kick',
      limited('actions', (playerId, ack) => {
        const result = rooms.kick(socket.id, playerId);
        if (result.ok && result.socketId) {
          const kicked = io.sockets.sockets.get(result.socketId);
          kicked?.emit('room:kicked');
          for (const r of kicked?.rooms ?? []) if (r !== result.socketId) void kicked?.leave(r);
        }
        if (typeof ack === 'function') ack(result.ok ? { ok: true } : result);
      }),
    );
    socket.on(
      'room:leave',
      guarded(null, () => {
        // Leave the socket room first so the leaver is not sent the update about their own exit.
        for (const r of socket.rooms) if (r !== socket.id) void socket.leave(r);
        rooms.leave(socket.id);
      }),
    );
    socket.on(
      'disconnect',
      guarded(null, () => rooms.disconnect(socket.id)),
    );
  });

  return { http, io, rooms };
}
