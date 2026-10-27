import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { PerIpCounter } from './abuse';
import { Board } from './canvas';
import {
  cleanWords,
  drawerPoints,
  guessPoints,
  hintOrder,
  isClose,
  isCorrect,
  maskWord,
  wordChoices,
  type WordChoice,
} from './game';
import { WORD_TIERS } from './wordlist';
import {
  AVATAR_COLORS,
  AVATAR_FACES,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  CHAT_MAX_LENGTH,
  EMOTES,
  type EmoteEvent,
  SETTINGS_LIMITS,
  TURN_TIMING,
  badName,
  cleanName,
  defaultSettings,
  hasProfanity,
  maskProfanity,
  normalizeCode,
  parseCanvasEvent,
  rankPlayers,
  type ActionResult,
  type CanvasEvent,
  type ChatMessage,
  type DrawOp,
  type PrivateState,
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
  score: number;
  /** Address the seat last connected from, for binding kicks to more than a name. */
  ip: string | null;
}

/** Where the server sends things that are not part of the shared room snapshot. */
export interface RoomHooks {
  chat?: (socketIds: string[], message: ChatMessage) => void;
  emote?: (socketIds: string[], event: EmoteEvent) => void;
  private?: (socketId: string, state: PrivateState) => void;
  /** Multiplies the word-choice and reveal pauses; the draw time is always as configured. */
  timeScale?: number;
  /** Open rooms one address may have started at once. */
  roomsPerIp?: number;
  /** Open rooms across the whole server. */
  maxRooms?: number;
}

interface Logged {
  message: ChatMessage;
  /** Player ids allowed to see it, or null for everyone. */
  to: string[] | null;
}

interface Room {
  code: string;
  hostId: string;
  settings: RoomSettings;
  seats: Seat[];
  phase: RoomState['phase'];
  drawerId: string | null;
  board: Board;
  round: number;
  turn: number;
  /** Players still to draw this round, in order. */
  queue: string[];
  choices: WordChoice[] | null;
  word: string | null;
  wordTier: number;
  hintOrder: number[];
  revealed: Set<number>;
  phaseEndsAt: number | null;
  phaseMs: number;
  timers: ReturnType<typeof setTimeout>[];
  /** Points each correct guesser took this turn, in the order they guessed. */
  guessed: Map<string, number>;
  reveal: RoomState['reveal'];
  customWords: string[];
  customOnly: boolean;
  used: Set<string>;
  chat: Logged[];
  chatSeq: number;
  /** The address that started the room, so its slot is returned when the room closes. */
  ownerIp: string | null;
  /** What a kicked player may not come back with: a name alone is too easy to change. */
  banned: { names: Set<string>; tokens: Set<string>; ips: Set<string> };
}

const CHAT_LOG_SIZE = 100;
const MIN_PHASE_MS = 150;

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
  /** socketId -> network address, for the sockets the transport has told us about. */
  private ips = new Map<string, string>();
  private roomsByIp: PerIpCounter;

  constructor(
    private onChange: (room: RoomState | null, code: string) => void,
    private graceMs = RECONNECT_GRACE_MS,
    private hooks: RoomHooks = {},
  ) {
    this.roomsByIp = new PerIpCounter(hooks.roomsPerIp ?? Infinity);
  }

  private emoteSeq = 0;

  /** Remembers where a socket connected from; kicks and room limits are tied to it. */
  attach(socketId: string, ip: string): void {
    this.ips.set(socketId, ip);
  }

  create(socketId: string, profile: Profile): Joined | Failed {
    this.leave(socketId);
    const name = cleanName(profile?.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    if (badName(name)) return { ok: false, error: 'name-not-allowed' };
    if (this.rooms.size >= (this.hooks.maxRooms ?? Infinity)) {
      return { ok: false, error: 'server-full' };
    }
    const ip = this.ips.get(socketId);
    if (ip && !this.roomsByIp.acquire(ip)) return { ok: false, error: 'too-many-rooms' };
    const room: Room = {
      code: this.freshCode(),
      hostId: '',
      settings: defaultSettings(),
      seats: [],
      phase: 'lobby',
      drawerId: null,
      board: new Board(),
      round: 0,
      turn: 0,
      queue: [],
      choices: null,
      wordTier: 1,
      word: null,
      hintOrder: [],
      revealed: new Set(),
      phaseEndsAt: null,
      phaseMs: 0,
      timers: [],
      guessed: new Map(),
      reveal: null,
      customWords: [],
      customOnly: false,
      used: new Set(),
      chat: [],
      chatSeq: 0,
      ownerIp: this.ips.get(socketId) ?? null,
      banned: { names: new Set(), tokens: new Set(), ips: new Set() },
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
    const ip = this.ips.get(socketId);
    if (
      (ip && room.banned.ips.has(ip)) ||
      (typeof token === 'string' && room.banned.tokens.has(token))
    ) {
      return { ok: false, error: 'kicked' };
    }

    const existing = token ? room.seats.find((s) => s.token === token) : undefined;
    if (existing) {
      // Reclaiming a seat: drop any stale binding for it first.
      if (existing.socketId) this.bySocket.delete(existing.socketId);
      this.leave(socketId);
      if (existing.dropTimer) clearTimeout(existing.dropTimer);
      existing.dropTimer = null;
      existing.socketId = socketId;
      existing.ip = ip ?? existing.ip;
      this.bySocket.set(socketId, { code: room.code, playerId: existing.id });
      this.ensureHost(room);
      this.changed(room);
      return { ok: true, room: this.snapshot(room), playerId: existing.id, token: existing.token };
    }

    this.leave(socketId);
    const name = cleanName(profile?.name);
    if (!name) return { ok: false, error: 'invalid-name' };
    if (badName(name)) return { ok: false, error: 'name-not-allowed' };
    if (room.banned.names.has(name.toLowerCase())) return { ok: false, error: 'kicked' };
    if (room.seats.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
      return { ok: false, error: 'name-taken' };
    }
    if (room.seats.length >= room.settings.maxPlayers) return { ok: false, error: 'room-full' };
    const seat = this.seat(room, socketId, name, profile.avatar);
    this.ensureHost(room);
    this.changed(room);
    return { ok: true, room: this.snapshot(room), playerId: seat.id, token: seat.token };
  }

  updateSettings(socketId: string, patch: Partial<RoomSettings>): { ok: true } | Failed {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    if (!where || !room) return { ok: false, error: 'not-in-room' };
    if (room.hostId !== where.playerId) return { ok: false, error: 'not-host' };
    if (room.phase !== 'lobby') return { ok: false, error: 'wrong-phase' };
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

  /** Host adds their own words to the pool, or swaps the built-in list out for them. */
  setWords(socketId: string, req: { words: string[]; only: boolean }): ActionResult {
    const found = this.hostRoom(socketId);
    if (!found.ok) return found;
    const { room } = found;
    if (room.phase !== 'lobby') return { ok: false, error: 'wrong-phase' };
    room.customWords = cleanWords(req?.words).filter((w) => !hasProfanity(w));
    room.customOnly = Boolean(req?.only) && room.customWords.length > 0;
    this.changed(room);
    return { ok: true };
  }

  /** Host starts the game (from the lobby, or straight from the final standings): round one. */
  start(socketId: string): ActionResult {
    const found = this.hostRoom(socketId);
    if (!found.ok) return found;
    const { room } = found;
    if (room.phase !== 'lobby' && room.phase !== 'ended')
      return { ok: false, error: 'wrong-phase' };
    if (room.seats.length < 2) return { ok: false, error: 'need-players' };
    this.resetGame(room);
    this.say(room, { kind: 'system', text: 'The game has started. Good luck!' });
    this.nextTurn(room);
    return { ok: true };
  }

  backToLobby(socketId: string): ActionResult {
    const found = this.hostRoom(socketId);
    if (!found.ok) return found;
    const { room } = found;
    this.resetGame(room);
    this.changed(room);
    return { ok: true };
  }

  /** The drawer picks one of the offered words (by index) and the clock starts. */
  chooseWord(socketId: string, index: unknown): ActionResult {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    if (!where || !room) return { ok: false, error: 'not-in-room' };
    if (room.phase !== 'choosing' || room.drawerId !== where.playerId || !room.choices) {
      return { ok: false, error: 'wrong-phase' };
    }
    if (typeof index !== 'number' || !Number.isInteger(index) || !room.choices[index]) {
      return { ok: false, error: 'bad-choice' };
    }
    this.beginDrawing(room, room.choices[index]!);
    return { ok: true };
  }

  /** A quick reaction, shown to everyone in the room for a moment and never stored. */
  emote(socketId: string, index: unknown): ActionResult {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    const seat = room?.seats.find((s) => s.id === where?.playerId);
    if (!where || !room || !seat) return { ok: false, error: 'not-in-room' };
    if (typeof index !== 'number' || !Number.isInteger(index) || !EMOTES[index]) {
      return { ok: false, error: 'bad-choice' };
    }
    const ids = room.seats.flatMap((s) => (s.socketId ? [s.socketId] : []));
    this.hooks.emote?.(ids, {
      id: ++this.emoteSeq,
      playerId: seat.id,
      name: seat.name,
      emote: index,
    });
    return { ok: true };
  }

  /**
   * A line typed into the chat. Guessers' lines are checked against the word on the server;
   * players who already know it only talk to each other, so nothing leaks to those still guessing.
   */
  chat(socketId: string, raw: unknown): ActionResult {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    const seat = room?.seats.find((s) => s.id === where?.playerId);
    if (!where || !room || !seat) return { ok: false, error: 'not-in-room' };
    const text = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
    if (!text) return { ok: true };
    const line = text.slice(0, CHAT_MAX_LENGTH);
    // Guesses are judged on what was typed; only what other people read is masked.
    const shown = maskProfanity(line);
    const base = { name: seat.name, playerId: seat.id, text: shown };

    if (room.phase !== 'drawing' || !room.word) {
      this.say(room, { kind: 'say', ...base });
      return { ok: true };
    }
    const knows = seat.id === room.drawerId || room.guessed.has(seat.id);
    if (knows) {
      const insiders = room.seats.filter((s) => s.id === room.drawerId || room.guessed.has(s.id));
      this.say(room, { kind: 'say', insiders: true, ...base }, insiders);
      return { ok: true };
    }
    if (isCorrect(line, room.word)) {
      const remaining = (room.phaseEndsAt ?? 0) - Date.now();
      const points = guessPoints(
        remaining / room.phaseMs,
        room.guessed.size,
        room.wordTier,
        room.revealed.size,
      );
      room.guessed.set(seat.id, points);
      seat.score += points;
      this.say(room, {
        kind: 'correct',
        name: seat.name,
        playerId: seat.id,
        text: 'found the word!',
      });
      if (this.everyoneGuessed(room)) this.endTurn(room);
      else this.changed(room);
      return { ok: true };
    }
    this.say(room, { kind: 'say', ...base });
    if (isClose(line, room.word)) {
      this.say(room, { kind: 'close', text: `"${shown}" is so close!` }, [seat]);
    }
    return { ok: true };
  }

  /** What this player alone is allowed to know about the turn. */
  privateState(socketId: string): PrivateState {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    return room && where
      ? this.privateFor(room, where.playerId)
      : { choices: null, tiers: null, word: null };
  }

  /** Chat lines this player is allowed to see, oldest first. */
  chatHistory(socketId: string): ChatMessage[] {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    if (!where || !room) return [];
    return room.chat
      .filter((l) => l.to === null || l.to.includes(where.playerId))
      .map((l) => l.message);
  }

  /**
   * Validates and records a drawing change from a socket. Returns the code and the event to
   * relay to the others, or null when it must be ignored (not the drawer, malformed, no-op).
   */
  canvasEvent(socketId: string, raw: unknown): { code: string; event: CanvasEvent } | null {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    if (!where || !room || room.phase !== 'drawing' || room.drawerId !== where.playerId) {
      return null;
    }
    const parsed = parseCanvasEvent(raw);
    const event = parsed && room.board.apply(parsed);
    return event ? { code: room.code, event } : null;
  }

  /** The drawing to show a viewer: live while drawing, kept on screen during the reveal. */
  canvasOps(socketId: string): DrawOp[] {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    return room && (room.phase === 'drawing' || room.phase === 'reveal')
      ? room.board.snapshot()
      : [];
  }

  /**
   * Host only: take another player's seat away and bar their name from the room. Returns the
   * kicked player's socket so the transport can tell them and pull them out of the broadcast room.
   */
  kick(socketId: string, targetId: unknown): { ok: true; socketId: string | null } | Failed {
    const host = this.hostRoom(socketId);
    if (!host.ok) return host;
    const target = host.room.seats.find((s) => s.id === targetId);
    if (!target || target.id === host.playerId) return { ok: false, error: 'bad-target' };
    const kickedSocket = target.socketId;
    if (kickedSocket) this.bySocket.delete(kickedSocket);
    host.room.banned.names.add(target.name.toLowerCase());
    host.room.banned.tokens.add(target.token);
    if (target.ip) host.room.banned.ips.add(target.ip);
    this.removeSeat(host.room.code, target.id);
    return { ok: true, socketId: kickedSocket };
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
    this.ips.delete(socketId);
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    const seat = room?.seats.find((s) => s.id === where?.playerId);
    if (!where || !room || !seat) return;
    this.bySocket.delete(socketId);
    seat.socketId = null;
    seat.dropTimer = setTimeout(() => this.removeSeat(room.code, seat.id), this.graceMs);
    seat.dropTimer.unref?.();
    // A dropped connection is often just a refresh, so the turn waits for the grace period, but
    // the room should not sit without a host who can act.
    this.ensureHost(room);
    this.changed(room);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  has(code: string): boolean {
    return this.rooms.has(normalizeCode(code));
  }

  private hostRoom(socketId: string): { ok: true; room: Room; playerId: string } | Failed {
    const where = this.bySocket.get(socketId);
    const room = where && this.rooms.get(where.code);
    if (!where || !room) return { ok: false, error: 'not-in-room' };
    if (room.hostId !== where.playerId) return { ok: false, error: 'not-host' };
    return { ok: true, room, playerId: where.playerId };
  }

  /** Hands the host role to a connected player when the current host has dropped. */
  private ensureHost(room: Room): void {
    const host = room.seats.find((s) => s.id === room.hostId);
    if (host?.socketId) return;
    const next = room.seats.find((s) => s.socketId);
    if (next) room.hostId = next.id;
  }

  private removeSeat(code: string, playerId: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    const seat = room.seats.find((s) => s.id === playerId);
    if (seat?.dropTimer) clearTimeout(seat.dropTimer);
    room.seats = room.seats.filter((s) => s.id !== playerId);
    if (room.seats.length === 0) {
      this.rooms.delete(code);
      if (room.ownerIp) this.roomsByIp.release(room.ownerIp);
      this.onChange(null, code);
      return;
    }
    if (room.hostId === playerId) {
      // Prefer a connected player as the new host.
      room.hostId = (room.seats.find((s) => s.socketId) ?? room.seats[0]!).id;
    } else {
      this.ensureHost(room);
    }
    room.queue = room.queue.filter((id) => id !== playerId);
    room.guessed.delete(playerId);
    const playing =
      room.phase === 'choosing' || room.phase === 'drawing' || room.phase === 'reveal';
    if (playing && room.seats.length < 2) {
      this.endGame(room);
    } else if (
      room.drawerId === playerId &&
      (room.phase === 'choosing' || room.phase === 'drawing')
    ) {
      this.say(room, { kind: 'system', text: `${seat?.name ?? 'The drawer'} left the room.` });
      this.endTurn(room);
    } else if (room.phase === 'drawing' && this.everyoneGuessed(room)) {
      this.endTurn(room);
    } else {
      this.changed(room);
    }
  }

  private resetGame(room: Room): void {
    this.clearTimers(room);
    room.phase = 'lobby';
    room.drawerId = null;
    room.round = 0;
    room.turn = 0;
    room.queue = [];
    room.choices = null;
    room.word = null;
    room.reveal = null;
    room.phaseEndsAt = null;
    room.guessed.clear();
    room.revealed.clear();
    room.used.clear();
    room.board.clear();
    for (const s of room.seats) s.score = 0;
  }

  /** Hands the pen to the next player, rolling over into the next round or the final standings. */
  private nextTurn(room: Room): void {
    for (let guard = 0; guard < 2; guard++) {
      while (room.queue.length) {
        const id = room.queue.shift();
        const seat = room.seats.find((s) => s.id === id);
        if (seat?.socketId) return this.startTurn(room, seat);
      }
      if (room.round >= room.settings.rounds) break;
      room.round++;
      room.queue = room.seats.filter((s) => s.socketId).map((s) => s.id);
    }
    this.endGame(room);
  }

  private startTurn(room: Room, drawer: Seat): void {
    room.turn++;
    room.drawerId = drawer.id;
    room.word = null;
    room.reveal = null;
    room.guessed.clear();
    room.revealed.clear();
    room.board.clear();
    room.choices = wordChoices(
      {
        tiers: WORD_TIERS,
        custom: room.customWords,
        customOnly: room.customOnly,
        used: room.used,
      },
      TURN_TIMING.wordChoices,
    );
    room.phase = 'choosing';
    this.run(room, TURN_TIMING.chooseSec, () => {
      // Too slow: the pen picks for them.
      const picks = room.choices ?? [];
      if (picks.length) this.beginDrawing(room, picks[Math.floor(Math.random() * picks.length)]!);
    });
    this.changed(room);
  }

  private beginDrawing(room: Room, choice: WordChoice): void {
    const word = choice.word;
    room.used.add(word);
    room.word = word;
    room.wordTier = choice.tier;
    room.choices = null;
    room.hintOrder = hintOrder(word, TURN_TIMING.hintAt.length);
    room.revealed = new Set();
    room.phase = 'drawing';
    const drawMs = this.run(room, room.settings.drawTimeSec, () => this.endTurn(room), false);
    room.hintOrder.forEach((position, i) => {
      this.later(room, drawMs * TURN_TIMING.hintAt[i]!, () => {
        room.revealed.add(position);
        this.changed(room);
      });
    });
    this.changed(room);
  }

  /** Scores the drawer, shows the word and the points, then moves on. */
  private endTurn(room: Room): void {
    if (room.phase === 'choosing' || !room.word) {
      // The drawer vanished before picking anything: nothing to reveal.
      this.nextTurn(room);
      return;
    }
    const drawer = room.seats.find((s) => s.id === room.drawerId);
    const guessers = room.seats.filter((s) => s.id !== room.drawerId).length;
    const gains: Record<string, number> = Object.fromEntries(room.guessed);
    if (drawer) {
      const bonus = drawerPoints([...room.guessed.values()], guessers);
      drawer.score += bonus;
      gains[drawer.id] = bonus;
    }
    room.reveal = { word: room.word, gains };
    room.phase = 'reveal';
    this.say(room, {
      kind: 'system',
      text:
        room.guessed.size === 0
          ? `Nobody got it. The word was "${room.word}".`
          : `The word was "${room.word}".`,
    });
    this.run(room, TURN_TIMING.revealSec, () => this.nextTurn(room));
    this.changed(room);
  }

  private endGame(room: Room): void {
    this.clearTimers(room);
    room.phase = 'ended';
    room.drawerId = null;
    room.word = null;
    room.choices = null;
    room.reveal = null;
    room.phaseEndsAt = null;
    const winners = rankPlayers(room.seats.map((s) => ({ name: s.name, score: s.score })))
      .filter((r) => r.place === 1)
      .map((r) => r.player);
    if (winners.length) {
      const names = winners.map((w) => w.name).join(' and ');
      const verdict = winners.length > 1 ? `${names} tie` : `${names} wins`;
      this.say(room, {
        kind: 'system',
        text: `Game over! ${verdict} with ${winners[0]!.score}.`,
      });
    }
    this.changed(room);
  }

  private everyoneGuessed(room: Room): boolean {
    const guessers = room.seats.filter((s) => s.id !== room.drawerId && s.socketId);
    return guessers.length > 0 && guessers.every((s) => room.guessed.has(s.id));
  }

  /** Starts the one countdown the current phase runs on; returns its real length in ms. */
  private run(room: Room, seconds: number, then: () => void, scaled = true): number {
    this.clearTimers(room);
    const ms = Math.max(MIN_PHASE_MS, seconds * 1000 * (scaled ? (this.hooks.timeScale ?? 1) : 1));
    room.phaseMs = ms;
    room.phaseEndsAt = Date.now() + ms;
    this.later(room, ms, then);
    return ms;
  }

  private later(room: Room, ms: number, fn: () => void): void {
    const t = setTimeout(fn, ms);
    t.unref?.();
    room.timers.push(t);
  }

  private clearTimers(room: Room): void {
    for (const t of room.timers) clearTimeout(t);
    room.timers = [];
  }

  /** Records a chat line and sends it to everyone, or to just the listed seats. */
  private say(room: Room, message: Omit<ChatMessage, 'id'>, to: Seat[] | null = null): void {
    const full: ChatMessage = { id: ++room.chatSeq, ...message };
    room.chat.push({ message: full, to: to && to.map((s) => s.id) });
    if (room.chat.length > CHAT_LOG_SIZE) room.chat.shift();
    const ids = (to ?? room.seats).flatMap((s) => (s.socketId ? [s.socketId] : []));
    this.hooks.chat?.(ids, full);
  }

  private privateFor(room: Room, playerId: string): PrivateState {
    if (room.drawerId !== playerId) return { choices: null, tiers: null, word: null };
    const offered = room.phase === 'choosing' ? room.choices : null;
    return {
      choices: offered && offered.map((c) => c.word),
      tiers: offered && offered.map((c) => c.tier),
      word: room.phase === 'drawing' ? room.word : null,
    };
  }

  private seat(room: Room, socketId: string, name: string, avatar: Profile['avatar']): Seat {
    const seat: Seat = {
      id: randomUUID(),
      token: randomBytes(16).toString('hex'),
      name,
      avatar: cleanAvatar(avatar),
      socketId,
      dropTimer: null,
      score: 0,
      ip: this.ips.get(socketId) ?? null,
    };
    room.seats.push(seat);
    // Someone arriving mid-round gets a turn at the end of it.
    if (room.phase === 'choosing' || room.phase === 'drawing' || room.phase === 'reveal') {
      room.queue.push(seat.id);
    }
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
      phase: room.phase,
      drawerId: room.drawerId,
      round: room.round,
      turn: room.turn,
      phaseEndsAt: room.phaseEndsAt,
      phaseMs: room.phaseMs,
      hint: room.phase === 'drawing' && room.word ? maskWord(room.word, room.revealed) : null,
      reveal: room.reveal,
      customWordCount: room.customWords.length,
      customWordsOnly: room.customOnly,
      settings: { ...room.settings },
      players: room.seats.map((s) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        isHost: s.id === room.hostId,
        connected: s.socketId !== null,
        score: s.score,
        guessed: room.guessed.has(s.id),
      })),
    };
  }

  private changed(room: Room): void {
    this.onChange(this.snapshot(room), room.code);
    for (const s of room.seats) {
      if (s.socketId) this.hooks.private?.(s.socketId, this.privateFor(room, s.id));
    }
  }
}
