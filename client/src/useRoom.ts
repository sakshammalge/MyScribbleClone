import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChatMessage,
  JoinResult,
  PrivateState,
  Profile,
  RoomError,
  RoomSettings,
  RoomState,
} from '@inkling/shared';
import { loadSeat, saveProfile, saveSeat } from './session';
import { socket } from './socket';

/** Errors the client raises itself, beyond what the server reports. */
export type ClientError = RoomError | 'room-lost';

export const ERROR_TEXT: Record<ClientError, string> = {
  'room-lost':
    'The server restarted and the room is gone, so the game ended. Create a new room to play again.',
  'invalid-name': 'Pick a name between 1 and 20 characters.',
  'name-not-allowed': 'Please pick a friendlier name.',
  'name-taken': 'Someone in that room already has this name. Try another.',
  'room-not-found': 'That room does not exist (or everyone already left).',
  'room-full': 'That room is full.',
  'not-in-room': 'You are not in a room.',
  'not-host': 'Only the host can do that.',
  'need-players': 'You need at least two players to start.',
  'wrong-phase': 'That is not possible right now.',
  'bad-choice': 'That word is not on offer.',
  kicked: 'The host removed you from that room.',
  'rate-limited': 'Slow down a little.',
  'bad-target': 'That player is not in the room.',
  'too-many-rooms':
    'Too many rooms were started from your network. Join one instead, or try later.',
  'server-full': 'The server is full right now. Try again in a few minutes.',
  'bad-request': 'Something went wrong. Try again.',
};

const NO_SECRETS: PrivateState = { choices: null, tiers: null, word: null };
const CHAT_KEPT = 200;

/** Room membership: create, join, leave, host settings, and seat recovery after a dropped connection. */
export function useRoom(profile: Profile) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [error, setError] = useState<ClientError | null>(null);
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<PrivateState>(NO_SECRETS);
  const [chat, setChat] = useState<ChatMessage[]>([]);
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
        (result) => {
          // Rooms live in server memory, so a missing room on reconnect means the server restarted.
          if (!result.ok && result.error === 'room-not-found') {
            saveSeat(null);
            setRoom(null);
            setMyId(null);
            setSecrets(NO_SECRETS);
            setChat([]);
            setBusy(false);
            setError('room-lost');
            return;
          }
          adopt(result);
        },
      );
    };
    const onSecrets = (state: PrivateState) => setSecrets(state);
    const onLine = (line: ChatMessage) =>
      setChat((log) =>
        log.some((m) => m.id === line.id) ? log : [...log, line].slice(-CHAT_KEPT),
      );
    const onHistory = (log: ChatMessage[]) => setChat(log);
    const onKicked = () => {
      saveSeat(null);
      setRoom(null);
      setMyId(null);
      setSecrets(NO_SECRETS);
      setChat([]);
      setError('kicked');
    };
    socket.on('room:state', onState);
    socket.on('connect', onConnect);
    socket.on('game:private', onSecrets);
    socket.on('chat:message', onLine);
    socket.on('chat:history', onHistory);
    socket.on('room:kicked', onKicked);
    if (socket.connected) onConnect();
    return () => {
      socket.off('room:state', onState);
      socket.off('connect', onConnect);
      socket.off('game:private', onSecrets);
      socket.off('chat:message', onLine);
      socket.off('chat:history', onHistory);
      socket.off('room:kicked', onKicked);
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
    setSecrets(NO_SECRETS);
    setChat([]);
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

  const kick = useCallback((playerId: string) => {
    socket.emit('room:kick', playerId, (res) => {
      if (!res.ok) setError(res.error);
    });
  }, []);

  const chooseWord = useCallback((index: number) => {
    socket.emit('word:choose', index, (res) => {
      if (!res.ok) setError(res.error);
    });
  }, []);

  const sendChat = useCallback((text: string) => {
    socket.emit('chat:send', text);
  }, []);

  const setWords = useCallback((words: string[], only: boolean) => {
    socket.emit('room:words', { words, only }, (res) => {
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
    kick,
    chooseWord,
    sendChat,
    setWords,
    secrets,
    chat,
    clearError,
  };
}
