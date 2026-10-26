import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  AVATAR_COLORS,
  AVATAR_FACES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SETTINGS_LIMITS,
  cleanName,
  defaultSettings,
  normalizeCode,
  type Profile,
  type RoomError,
  type RoomSettings,
  type RoomState,
} from '@inkling/shared';

/** How long a dropped player keeps their seat before being removed. */
export const RECONNECT_GRACE_MS = 30_000;

interface Seat {
  id: string;
  token: string;
  name: string;
  avatar: Profile['avatar'];
  socketId: string | null;
  dropTimer: ReturnType<typeof setTimeout> | null;
}

interface Room {
  code: string;
  hostId: string;
  settings: RoomSettings;
  seats: Seat[];
}

export type Joined = { ok: true; room: RoomState; playerId: string; token: string };
export type Failed = { ok: false; error: RoomError };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));

function cleanAvatar(a: Profile['avatar'] | undefined): Profile['avatar'] {
  const pick = (v: unknown, size: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < size ? v : randomInt(size);
  return { color: pick(a?.color, AVATAR_COLORS), face: pick(a?.face, AVATAR_FACES) };
}

/**
 * Owns every room in memory. Calls report which room changed through `onChange`
 * so the transport layer can broadcast, keeping this class free of sockets.
 */
export class RoomManager {
  private rooms = new Map<string, Room>();
  /** socketId -> seat location, so a disconnect can find its room. */
  private bySocket = new Map<string, { code: string; playerId: string }>();

  constructor(
    private onChange: (room: RoomState | null, code: string) => void,
    private graceMs = RECONNECT_GRACE_MS,
  ) {}

  create(socketId: string, profile: Profile): Joined | Failed {
    this.leave(socketId);
    const name = cleanName(profile?.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    const room: Room = {
      code: this.freshCode(),
      hostId: '',
      settings: defaultSettings(),
      seats: [],
    };
    this.rooms.set(room.code, room);
    const seat = this.seat(room, socketId, name, profile.avatar);
    room.hostId = seat.id;
    this.changed(room);
    return { ok: true, room: this.snapshot(room), playerId: seat.id, token: seat.token };
  }

  join(socketId: string, rawCode: string, profile: Profile, token?: string): Joined | Failed {
    const room = this.rooms.get(normalizeCode(String(rawCode ?? '')));
    if (!room) return { ok: false, error: 'room-not-found' };

    const existing = token ? room.seats.find((s) => s.token === token) : undefined;
    if (existing) {
      // Reclaiming a seat: drop any stale binding for it first.
      if (existing.socketId) this.bySocket.delete(existing.socketId);
      this.leave(socketId);
      if (existing.dropTimer) clearTimeout(existing.dropTimer);
      existing.dropTimer = null;
      existing.socketId = socketId;
      this.bySocket.set(socketId, { code: room.code, playerId: existing.id });
      this.changed(room);
      return { ok: true, room: this.snapshot(room), playerId: existing.id, token: existing.token };
    }

    this.leave(socketId);
    const name = cleanName(profile?.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    if (room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: 'name-taken' };
    }
    if (room.seats.length >= room.settings.maxPlayers) return { ok: false, error: 'room-full' };
    const seat = this.seat(room, socketId, name, profile.avatar);
    this.changed(room);
    return { ok: true, room: this.snapshot(room), playerId: seat.id, token: seat.token };
  }

  updateSettings(socketId: string, patch: Partial<RoomSettings>): { ok: true } | Failed {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    if (!where || !room) return { ok: false, error: 'not-in-room' };
    if (room.hostId !== where.playerId) return { ok: false, error: 'not-host' };
    for (const key of Object.keys(SETTINGS_LIMITS) as (keyof RoomSettings)[]) {
      const value = patch?.[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const { min, max } = SETTINGS_LIMITS[key];
      // Never shrink below the people already seated.
      const floor = key === 'maxPlayers' ? Math.max(min, room.seats.length) : min;
      room.settings[key] = clamp(value, floor, max);
    }
    this.changed(room);
    return { ok: true };
  }

  /** Voluntary exit: the seat is freed immediately. */
  leave(socketId: string): void {
    const where = this.bySocket.get(socketId);
    if (!where) return;
    this.bySocket.delete(socketId);
    this.removeSeat(where.code, where.playerId);
  }

  /** Unexpected drop: keep the seat for a grace period so a refresh can reclaim it. */
  disconnect(socketId: string): void {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    const seat = room?.seats.find((s) => s.id === where?.playerId);
    if (!where || !room || !seat) return;
    this.bySocket.delete(socketId);
    seat.socketId = null;
    seat.dropTimer = setTimeout(() => this.removeSeat(room.code, seat.id), this.graceMs);
    seat.dropTimer.unref?.();
    this.changed(room);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  has(code: string): boolean {
    return this.rooms.has(normalizeCode(code));
  }

  private removeSeat(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const seat = room.seats.find((s) => s.id === playerId);
    if (seat?.dropTimer) clearTimeout(seat.dropTimer);
    room.seats = room.seats.filter((s) => s.id !== playerId);
    if (room.seats.length === 0) {
      this.rooms.delete(code);
      this.onChange(null, code);
      return;
    }
    if (room.hostId === playerId) {
      // Prefer a connected player as the new host.
      room.hostId = (room.seats.find((s) => s.socketId) ?? room.seats[0]!).id;
    }
    this.changed(room);
  }

  private seat(room: Room, socketId: string, name: string, avatar: Profile['avatar']): Seat {
    const seat: Seat = {
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      name,
      avatar: cleanAvatar(avatar),
      socketId,
      dropTimer: null,
    };
    room.seats.push(seat);
    this.bySocket.set(socketId, { code: room.code, playerId: seat.id });
    return seat;
  }

  private freshCode(): string {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private snapshot(room: Room): RoomState {
    return {
      code: room.code,
      phase: 'lobby',
      settings: { ...room.settings },
      players: room.seats.map((s) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        isHost: s.id === room.hostId,
        connected: s.socketId !== null,
      })),
    };
  }

  private changed(room: Room): void {
    this.onChange(this.snapshot(room), room.code);
  }
}
