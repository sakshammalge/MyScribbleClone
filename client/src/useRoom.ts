import { useCallback, useEffect, useRef, useState } from 'react';
import type { JoinResult, Profile, RoomError, RoomSettings, RoomState } from '@inkling/shared';
import { loadSeat, saveProfile, saveSeat } from './session';
import { socket } from './socket';

export const ERROR_TEXT: Record<RoomError, string> = {
  'invalid-name': 'Pick a name between 1 and 20 characters.',
  'name-taken': 'Someone in that room already has this name. Try another.',
  'room-not-found': 'That room does not exist (or everyone already left).',
  'room-full': 'That room is full.',
  'not-in-room': 'You are not in a room.',
  'not-host': 'Only the host can do that.',
  'need-players': 'You need at least two players to start.',
  'wrong-phase': 'The game is already underway.',
};

/** Room membership: create, join, leave, host settings, and seat recovery after a dropped connection. */
export function useRoom(profile: Profile) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [busy, setBusy] = useState(false);
  // Latest profile for the reconnect handler without re-subscribing it.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const adopt = useCallback((result: JoinResult) => {
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      if (result.error === 'room-not-found') saveSeat(null);
      return false;
    }
    setError(null);
    setRoom(result.room);
    setMyId(result.playerId);
    saveSeat({ code: result.room.code, token: result.token });
    return true;
  }, []);

  useEffect(() => {
    // Ignore stray snapshots once this tab has left (no seat saved).
    const onState = (next: RoomState) => {
      if (loadSeat()) setRoom(next);
    };
    // After any (re)connect, reclaim the seat this tab held.
    const onConnect = () => {
      const seat = loadSeat();
      if (!seat) return;
      socket.emit(
        'room:join',
        { code: seat.code, profile: profileRef.current, token: seat.token },
        adopt,
      );
    };
    socket.on('room:state', onState);
    socket.on('connect', onConnect);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:state', onState);
      socket.off('connect', onConnect);
    };
  }, [adopt]);

  const create = useCallback(
    (p: Profile) => {
      saveProfile(p);
      setBusy(true);
      socket.emit('room:create', p, adopt);
    },
    [adopt],
  );

  const join = useCallback(
    (code: string, p: Profile) => {
      saveProfile(p);
      setBusy(true);
      socket.emit('room:join', { code, profile: p }, adopt);
    },
    [adopt],
  );

  const leave = useCallback(() => {
    socket.emit('room:leave');
    saveSeat(null);
    setRoom(null);
    setMyId(null);
    setError(null);
  }, []);

  const updateSettings = useCallback((patch: Partial<RoomSettings>) => {
    socket.emit('room:settings', patch, (res) => {
      if (!res.ok) setError(res.error);
    });
  }, []);

  const startGame = useCallback(() => {
    socket.emit('room:start', (res) => {
      if (!res.ok) setError(res.error);
    });
  }, []);

  const backToLobby = useCallback(() => {
    socket.emit('room:lobby', (res) => {
      if (!res.ok) setError(res.error);
    });
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return {
    room,
    myId,
    error,
    busy,
    create,
    join,
    leave,
    updateSettings,
    startGame,
    backToLobby,
    clearError,
  };
}
