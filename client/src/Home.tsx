import { useState, type FormEvent } from 'react';
import {
  APP_NAME,
  NAME_MAX_LENGTH,
  ROOM_CODE_LENGTH,
  isValidCode,
  normalizeCode,
  type Profile,
} from '@inkling/shared';
import { AvatarEditor } from './AvatarEditor';
import { useTheme } from './useTheme';
import { ERROR_TEXT, type ClientError } from './useRoom';

interface HomeProps {
  profile: Profile;
  onProfile: (p: Profile) => void;
  /** Code from an invite link, when the visitor arrived through one. */
  inviteCode: string | null;
  busy: boolean;
  error: ClientError | null;
  connected: boolean;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onDeclineInvite: () => void;
  onLeaderboard: () => void;
}

export function Home({
  profile,
  onProfile,
  inviteCode,
  busy,
  error,
  connected,
  onCreate,
  onJoin,
  onDeclineInvite,
  onLeaderboard,
}: HomeProps) {
  const [typedCode, setTypedCode] = useState('');
  const { theme, toggle: toggleTheme } = useTheme();
  const nameOk = profile.name.trim().length > 0;
  const canAct = nameOk && connected && !busy;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canAct) return;
    if (inviteCode) onJoin(inviteCode);
    else if (isValidCode(normalizeCode(typedCode))) onJoin(normalizeCode(typedCode));
    else onCreate();
  };

  return (
    <main className="shell">
      <button
        type="button"
        className="theme-toggle"
        role="switch"
        aria-checked={theme === 'dark'}
        aria-label="Dark mode"
        onClick={toggleTheme}
      >
        <span aria-hidden="true">{theme === 'dark' ? '☀️' : '🌙'}</span>
        {theme === 'dark' ? 'Light mode' : 'Dark mode'}
      </button>
      <header className="brand">
        <img src="/logo.svg" alt="" />
        <div>
          <h1>{APP_NAME}</h1>
          <p>Draw it. Guess it. Heckle your friends.</p>
        </div>
      </header>

      <form className="card home" onSubmit={submit}>
        {inviteCode && (
          <div className="invite-banner" role="status">
            You have been invited to room <strong>{inviteCode}</strong>
          </div>
        )}

        <fieldset className="who">
          <legend>Who are you?</legend>
          <AvatarEditor
            avatar={profile.avatar}
            onChange={(avatar) => onProfile({ ...profile, avatar })}
          />
          <label className="field">
            <span>Your name</span>
            <input
              value={profile.name}
              maxLength={NAME_MAX_LENGTH}
              placeholder="e.g. Picasso"
              autoComplete="nickname"
              onChange={(e) => onProfile({ ...profile, name: e.target.value })}
            />
          </label>
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {ERROR_TEXT[error]}
          </p>
        )}

        {inviteCode ? (
          <div className="actions">
            <button className="btn" type="submit" disabled={!canAct}>
              Join room {inviteCode}
            </button>
            <button type="button" className="link" onClick={onDeclineInvite}>
              Start my own room instead
            </button>
          </div>
        ) : (
          <>
            <div className="actions">
              <button className="btn" type="submit" disabled={!canAct || typedCode.length > 0}>
                Create a private room
              </button>
            </div>
            <div className="divider">
              <span>or join friends</span>
            </div>
            <div className="join-row">
              <label className="field grow">
                <span>Room code</span>
                <input
                  className="code-input"
                  value={typedCode}
                  maxLength={ROOM_CODE_LENGTH}
                  placeholder="K7M2Q"
                  autoCapitalize="characters"
                  spellCheck={false}
                  onChange={(e) => setTypedCode(normalizeCode(e.target.value))}
                />
              </label>
              <button
                className="btn secondary"
                type="submit"
                disabled={!canAct || !isValidCode(typedCode)}
              >
                Join
              </button>
            </div>
          </>
        )}
        {!connected && <p className="muted">Connecting to the server…</p>}
      </form>
      <button type="button" className="link board-link" onClick={onLeaderboard}>
        🏆 Leaderboard &amp; my stats
      </button>
    </main>
  );
}
