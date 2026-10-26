import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ROOM_CODE_LENGTH,
  SETTINGS_LIMITS,
  type ChatMessage,
  type PrivateState,
  type RoomState,
} from '@inkling/shared';
import { RoomManager } from './rooms';

const me = (name: string) => ({ name, avatar: { color: 0, face: 0 } });

describe('RoomManager', () => {
  let changes: (RoomState | null)[];
  let rooms: RoomManager;
  /** What each socket has been told privately, and the chat lines each was sent. */
  let secrets: Record<string, PrivateState>;
  let heard: Record<string, ChatMessage[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    changes = [];
    secrets = {};
    heard = {};
    rooms = new RoomManager((room) => changes.push(room), 1000, {
      private: (socket, state) => (secrets[socket] = state),
      chat: (sockets, message) => {
        for (const id of sockets) (heard[id] ??= []).push(message);
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  const create = (socket: string, name: string) => {
    const r = rooms.create(socket, me(name));
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it('creates a room with the creator as host', () => {
    const r = create('a', 'Ada');
    expect(r.room.code).toHaveLength(ROOM_CODE_LENGTH);
    expect(r.room.players).toMatchObject([{ name: 'Ada', isHost: true, connected: true }]);
  });

  it('rejects empty and oversized names', () => {
    expect(rooms.create('a', me('   '))).toEqual({ ok: false, error: 'invalid-name' });
    expect(rooms.create('a', me('x'.repeat(21)))).toEqual({ ok: false, error: 'invalid-name' });
  });

  it('joins by code, case-insensitively, and rejects duplicate names', () => {
    const { room } = create('a', 'Ada');
    expect(rooms.join('b', room.code.toLowerCase(), me('Bo'))).toMatchObject({ ok: true });
    expect(rooms.join('c', room.code, me('ada'))).toEqual({ ok: false, error: 'name-taken' });
    expect(rooms.join('c', 'ZZZZZ', me('Cy'))).toEqual({ ok: false, error: 'room-not-found' });
  });

  it('enforces max players', () => {
    const { room } = create('a', 'Ada');
    rooms.updateSettings('a', { maxPlayers: 2 });
    rooms.join('b', room.code, me('Bo'));
    expect(rooms.join('c', room.code, me('Cy'))).toEqual({ ok: false, error: 'room-full' });
  });

  it('lets only the host change settings, clamped to limits', () => {
    const { room } = create('a', 'Ada');
    rooms.join('b', room.code, me('Bo'));
    expect(rooms.updateSettings('b', { rounds: 5 })).toEqual({ ok: false, error: 'not-host' });
    rooms.updateSettings('a', { rounds: 999, drawTimeSec: -5, maxPlayers: 1 });
    const last = changes.at(-1)!;
    expect(last.settings.rounds).toBe(SETTINGS_LIMITS.rounds.max);
    expect(last.settings.drawTimeSec).toBe(SETTINGS_LIMITS.drawTimeSec.min);
    expect(last.settings.maxPlayers).toBe(2); // cannot drop below seated players
  });

  it('hands the host role over when the host leaves, and deletes empty rooms', () => {
    const { room } = create('a', 'Ada');
    rooms.join('b', room.code, me('Bo'));
    rooms.leave('a');
    expect(changes.at(-1)!.players).toMatchObject([{ name: 'Bo', isHost: true }]);
    rooms.leave('b');
    expect(changes.at(-1)).toBeNull();
    expect(rooms.roomCount()).toBe(0);
  });

  it('keeps a dropped seat during the grace period and lets the token reclaim it', () => {
    const { room } = create('a', 'Ada');
    const bo = rooms.join('b', room.code, me('Bo'));
    if (!bo.ok) throw new Error();
    rooms.disconnect('b');
    expect(changes.at(-1)!.players[1]).toMatchObject({ name: 'Bo', connected: false });
    const back = rooms.join('b2', room.code, me('ignored'), bo.token);
    expect(back).toMatchObject({ ok: true, playerId: bo.playerId });
    vi.advanceTimersByTime(5000);
    expect(changes.at(-1)!.players).toHaveLength(2);
  });

  it('removes a dropped seat after the grace period', () => {
    const { room } = create('a', 'Ada');
    rooms.join('b', room.code, me('Bo'));
    rooms.disconnect('b');
    vi.advanceTimersByTime(1500);
    expect(changes.at(-1)!.players.map((p) => p.name)).toEqual(['Ada']);
  });

  describe('drawing', () => {
    const dot = { t: 'stroke', id: 's1', tool: 'brush', color: 1, size: 1, points: [0.5, 0.5] };

    const started = () => {
      const { room } = create('a', 'Ada');
      rooms.join('b', room.code, me('Bo'));
      expect(rooms.start('a')).toEqual({ ok: true });
      // The host draws first; take the first word offered.
      expect(rooms.chooseWord('a', 0)).toEqual({ ok: true });
      return room.code;
    };

    it('only the host can start, and only with two players', () => {
      const { room } = create('a', 'Ada');
      expect(rooms.start('a')).toEqual({ ok: false, error: 'need-players' });
      rooms.join('b', room.code, me('Bo'));
      expect(rooms.start('b')).toEqual({ ok: false, error: 'not-host' });
      expect(rooms.start('a')).toEqual({ ok: true });
      expect(changes.at(-1)).toMatchObject({ phase: 'choosing', round: 1 });
      expect(rooms.start('a')).toEqual({ ok: false, error: 'wrong-phase' });
    });

    it('lets only the drawer change the canvas', () => {
      const code = started();
      expect(rooms.canvasEvent('a', dot)).toEqual({ code, event: dot });
      expect(rooms.canvasEvent('b', dot)).toBeNull();
      expect(rooms.canvasEvent('a', { t: 'stroke', id: 'bad id' })).toBeNull();
      expect(rooms.canvasOps('b')).toHaveLength(1);
    });

    it('ignores drawing in the lobby and wipes the board on the way back', () => {
      const { room } = create('a', 'Ada');
      rooms.join('b', room.code, me('Bo'));
      expect(rooms.canvasEvent('a', dot)).toBeNull();
      rooms.start('a');
      rooms.chooseWord('a', 0);
      rooms.canvasEvent('a', dot);
      expect(rooms.backToLobby('b')).toEqual({ ok: false, error: 'not-host' });
      expect(rooms.backToLobby('a')).toEqual({ ok: true });
      expect(rooms.canvasOps('a')).toEqual([]);
      rooms.start('a');
      rooms.chooseWord('a', 0);
      expect(rooms.canvasOps('a')).toEqual([]);
    });
  });
});
