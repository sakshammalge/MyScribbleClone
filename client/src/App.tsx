import { useEffect, useState } from 'react';
import { Home } from './Home';
import { Lobby } from './Lobby';
import { codeFromPath, invitePath, usePath } from './route';
import { loadProfile } from './session';
import { useConnection } from './useConnection';
import { useRoom } from './useRoom';

export function App() {
  const { state } = useConnection();
  const { path, go } = usePath();
  const [profile, setProfile] = useState(loadProfile);
  const { room, myId, error, busy, create, join, leave, updateSettings, clearError } =
    useRoom(profile);
  const inviteCode = codeFromPath(path);
  const roomCode = room?.code;

  // The address bar always names the current room, so it can be shared as-is.
  useEffect(() => {
    if (roomCode) go(invitePath(roomCode));
  }, [roomCode, go]);

  const goHome = () => {
    clearError();
    go('/');
  };

  if (room && myId) {
    return (
      <Lobby
        room={room}
        myId={myId}
        onLeave={() => {
          leave();
          goHome();
        }}
        onSettings={updateSettings}
      />
    );
  }

  return (
    <Home
      profile={profile}
      onProfile={setProfile}
      inviteCode={inviteCode}
      busy={busy}
      error={error}
      connected={state === 'connected'}
      onCreate={() => create({ ...profile, name: profile.name.trim() })}
      onJoin={(code) => join(code, { ...profile, name: profile.name.trim() })}
      onDeclineInvite={goHome}
    />
  );
}
