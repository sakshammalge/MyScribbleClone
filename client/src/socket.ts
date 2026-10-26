import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@inkling/shared';

export type InklingSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same-origin: the Vite dev server proxies /socket.io, and in production the game server serves us.
export const socket: InklingSocket = io({ autoConnect: false });
