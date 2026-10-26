export const APP_NAME = 'Inkling';
export const DEFAULT_PORT = 3001;

/** Limits for host-editable room settings; enforced by the server, mirrored in the UI. */
export const SETTINGS_LIMITS = {
  rounds: { min: 2, max: 10, default: 3 },
  drawTimeSec: { min: 30, max: 180, default: 80 },
  maxPlayers: { min: 2, max: 12, default: 8 },
} as const;

export const NAME_MAX_LENGTH = 20;
export const ROOM_CODE_LENGTH = 5;
/** No 0/O/1/I/L so codes survive being read aloud across the office. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const AVATAR_COLORS = 8;
export const AVATAR_FACES = 6;

export type RoomSettings = {
  -readonly [K in keyof typeof SETTINGS_LIMITS]: number;
};

export interface Avatar {
  color: number;
  face: number;
}

export interface PlayerInfo {
  id: string;
  name: string;
  avatar: Avatar;
  isHost: boolean;
  connected: boolean;
}

export interface RoomState {
  code: string;
  phase: 'lobby';
  players: PlayerInfo[];
  settings: RoomSettings;
}

export interface Profile {
  name: string;
  avatar: Avatar;
}

export type RoomError =
  'invalid-name' | 'name-taken' | 'room-not-found' | 'room-full' | 'not-in-room' | 'not-host';

export type JoinResult =
  { ok: true; playerId: string; token: string; room: RoomState } | { ok: false; error: RoomError };

export type SettingsResult = { ok: true } | { ok: false; error: RoomError };

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function isValidCode(code: string): boolean {
  return code.length === ROOM_CODE_LENGTH && [...code].every((c) => ROOM_CODE_ALPHABET.includes(c));
}

export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  return name.length >= 1 && name.length <= NAME_MAX_LENGTH ? name : null;
}

export function defaultSettings(): RoomSettings {
  return {
    rounds: SETTINGS_LIMITS.rounds.default,
    drawTimeSec: SETTINGS_LIMITS.drawTimeSec.default,
    maxPlayers: SETTINGS_LIMITS.maxPlayers.default,
  };
}

export interface HelloPayload {
  serverTime: number;
  version: string;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  hello: (payload: HelloPayload) => void;
  /** Full room snapshot, sent to everyone in the room after any change. */
  'room:state': (room: RoomState) => void;
}

/** Events clients emit to the server. Acks carry the result. */
export interface ClientToServerEvents {
  ping: (ack: (serverTime: number) => void) => void;
  'room:create': (profile: Profile, ack: (result: JoinResult) => void) => void;
  /** Pass the token from an earlier join to reclaim the same seat after a disconnect. */
  'room:join': (
    req: { code: string; profile: Profile; token?: string },
    ack: (result: JoinResult) => void,
  ) => void;
  'room:settings': (patch: Partial<RoomSettings>, ack: (result: SettingsResult) => void) => void;
  'room:leave': () => void;
}
