export * from './canvas.ts';
import type { CanvasEvent, DrawOp } from './canvas.ts';

export const APP_NAME = 'Inkling';
export const DEFAULT_PORT = 3001;

/** Limits for host-editable room settings; enforced by the server, mirrored in the UI. */
export const SETTINGS_LIMITS = {
  rounds: { min: 2, max: 10, default: 3 },
  drawTimeSec: { min: 30, max: 180, default: 80 },
  maxPlayers: { min: 2, max: 12, default: 8 },
} as const;

/** Fixed pacing of a turn; the draw time itself is a room setting. */
export const TURN_TIMING = {
  chooseSec: 15,
  revealSec: 6,
  wordChoices: 3,
  /** Share of the draw time already gone when each hint appears. */
  hintAt: [0.4, 0.7],
} as const;

export const CUSTOM_WORDS = { maxWords: 300, minLength: 2, maxLength: 30 } as const;
export const CHAT_MAX_LENGTH = 80;

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
  score: number;
  /** Has found the word this turn (or, for the drawer, nobody else is guessing for them). */
  guessed: boolean;
}

/**
 * lobby: waiting for the host. choosing: the drawer is picking a word. drawing: the clock is
 * running. reveal: the word is shown with this turn's points. ended: the final standings.
 */
export type Phase = 'lobby' | 'choosing' | 'drawing' | 'reveal' | 'ended';

export interface TurnReveal {
  word: string;
  /** Points each player earned this turn, by player id. */
  gains: Record<string, number>;
}

export interface RoomState {
  code: string;
  phase: Phase;
  /** Who holds the pen this turn; null in the lobby and at the end of the game. */
  drawerId: string | null;
  /** 1-based round of the game in progress (0 in the lobby). */
  round: number;
  /** Counts up with every turn, so the client can tell one drawing from the next. */
  turn: number;
  /** Server clock (ms) when the current choosing/drawing/reveal countdown ends. */
  phaseEndsAt: number | null;
  /** Length of the current countdown in ms, for drawing a progress bar. */
  phaseMs: number;
  /** The word as underscores, with hints filled in; only while the phase is 'drawing'. */
  hint: string | null;
  /** Shown during 'reveal' and 'ended'; the word is never in the state before then. */
  reveal: TurnReveal | null;
  /** How many host-supplied words are in the pool (the words themselves stay secret). */
  customWordCount: number;
  customWordsOnly: boolean;
  players: PlayerInfo[];
  settings: RoomSettings;
}

/** What only one player may know: the drawer's word options and the chosen word. */
export interface PrivateState {
  choices: string[] | null;
  word: string | null;
}

export interface ChatMessage {
  id: number;
  /**
   * say: a guess or a remark. correct: someone found the word (the text is never the word).
   * close: shown only to the guesser who was nearly right. system: game announcements.
   */
  kind: 'say' | 'correct' | 'close' | 'system';
  name?: string;
  playerId?: string;
  text: string;
  /** Said among players who already know the word, so still-guessing players never see it. */
  insiders?: boolean;
}

export interface Profile {
  name: string;
  avatar: Avatar;
}

export type RoomError =
  | 'invalid-name'
  | 'name-taken'
  | 'room-not-found'
  | 'room-full'
  | 'not-in-room'
  | 'not-host'
  | 'need-players'
  | 'wrong-phase'
  | 'bad-choice';

export type JoinResult =
  { ok: true; playerId: string; token: string; room: RoomState } | { ok: false; error: RoomError };

export type ActionResult = { ok: true } | { ok: false; error: RoomError };
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
  /** One drawing change from the drawer, relayed to everyone else in the room. */
  'canvas:event': (event: CanvasEvent) => void;
  /** The whole drawing so far; replaces whatever the viewer had (join, refresh, reconnect). */
  'canvas:replay': (ops: DrawOp[]) => void;
  /** This player's secret view of the turn; sent after every change, null fields for guessers. */
  'game:private': (state: PrivateState) => void;
  'chat:message': (message: ChatMessage) => void;
  /** Everything this player may see so far; replaces the chat log (join, refresh, reconnect). */
  'chat:history': (messages: ChatMessage[]) => void;
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
  /** Host only: leave the lobby for the drawing board (needs two players). */
  'room:start': (ack: (result: ActionResult) => void) => void;
  /** Drawer only: pick one of the offered words by index, ending the choosing phase early. */
  'word:choose': (index: number, ack: (result: ActionResult) => void) => void;
  /** Host only: the custom words to mix into (or replace) the built-in list. */
  'room:words': (
    req: { words: string[]; only: boolean },
    ack: (result: ActionResult) => void,
  ) => void;
  /** A guess or a remark; the server decides which it is. */
  'chat:send': (text: string, ack?: (result: ActionResult) => void) => void;
  /** Ask for the private state again, e.g. right after mounting the game screen. */
  'game:sync': (ack: (state: PrivateState) => void) => void;
  /** Host only: back to the lobby, wiping the board and scores. */
  'room:lobby': (ack: (result: ActionResult) => void) => void;
  /** Drawer only. Strokes arrive in chunks; undo and clear apply to the whole drawing. */
  'canvas:event': (event: CanvasEvent) => void;
  /** Ask for the current drawing, e.g. right after mounting the board. */
  'canvas:sync': (ack: (ops: DrawOp[]) => void) => void;
}

export interface Ranked<T extends { score: number }> {
  player: T;
  /** 1-based standing; players on equal scores share one (1, 1, 3). */
  place: number;
}

/** Highest score first, ties sharing a place and keeping seating order among themselves. */
export function rankPlayers<T extends { score: number }>(players: readonly T[]): Ranked<T>[] {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  return sorted.map((player) => {
    const before = sorted.findIndex((p) => p.score === player.score);
    return { player, place: before + 1 };
  });
}
