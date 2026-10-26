import { useState } from 'react';
import { APP_NAME, SETTINGS_LIMITS, type RoomSettings, type RoomState } from '@inkling/shared';
import { Avatar } from './Avatar';
import { inviteUrl } from './route';

interface LobbyProps {
  room: RoomState;
  myId: string;
  onLeave: () => void;
  onSettings: (patch: Partial<RoomSettings>) => void;
}

const SETTING_LABELS: Record<keyof RoomSettings, { label: string; unit: string }> = {
  rounds: { label: 'Rounds', unit: '' },
  drawTimeSec: { label: 'Draw time', unit: 's' },
  maxPlayers: { label: 'Max players', unit: '' },
};

export function Lobby({ room, myId, onLeave, onSettings }: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const me = room.players.find((p) => p.id === myId);
  const isHost = me?.isHost ?? false;
  const link = inviteUrl(room.code);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard needs a secure context; over plain LAN http the link is still shown to select.
    }
  };

  return (
    <main className="shell lobby">
      <header className="lobby-head">
        <h1>{APP_NAME}</h1>
        <button type="button" className="link" onClick={onLeave}>
          Leave room
        </button>
      </header>

      <section className="ticket" aria-label="Invite">
        <div className="ticket-main">
          <p className="eyebrow">Room code</p>
          <div className="code-tiles" aria-label={`Room code ${room.code}`} data-testid="room-code">
            {[...room.code].map((ch, i) => (
              <span key={i} className="tile">
                {ch}
              </span>
            ))}
          </div>
        </div>
        <div className="ticket-stub">
          <p className="eyebrow">Invite link</p>
          <input
            className="link-box"
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={(e) => e.target.select()}
          />
          <button type="button" className="btn" onClick={copy}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </section>

      <div className="lobby-grid">
        <section className="card" aria-label="Players">
          <h2>
            Players{' '}
            <span className="count">
              {room.players.length}/{room.settings.maxPlayers}
            </span>
          </h2>
          <ul className="roster">
            {room.players.map((p) => (
              <li key={p.id} className="player" data-connected={p.connected}>
                <Avatar {...p.avatar} size={44} />
                <span className="player-name">{p.name}</span>
                {p.id === myId && <span className="badge">you</span>}
                {p.isHost && <span className="badge host">host</span>}
                {!p.connected && <span className="badge away">reconnecting…</span>}
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-label="Game settings">
          <h2>Game settings</h2>
          {(Object.keys(SETTINGS_LIMITS) as (keyof RoomSettings)[]).map((key) => {
            const { min, max } = SETTINGS_LIMITS[key];
            const { label, unit } = SETTING_LABELS[key];
            const floor = key === 'maxPlayers' ? Math.max(min, room.players.length) : min;
            return (
              <label key={key} className="setting">
                <span>
                  {label}
                  <output>
                    {room.settings[key]}
                    {unit}
                  </output>
                </span>
                <input
                  type="range"
                  aria-label={label}
                  min={floor}
                  max={max}
                  step={key === 'drawTimeSec' ? 10 : 1}
                  value={room.settings[key]}
                  disabled={!isHost}
                  onChange={(e) => onSettings({ [key]: Number(e.target.value) })}
                />
              </label>
            );
          })}
          {!isHost && <p className="muted">Only the host can change these.</p>}
          <button
            type="button"
            className="btn"
            disabled
            title="Drawing rounds arrive in the next milestone"
          >
            Start game
          </button>
          <p className="muted">
            {room.players.length < 2
              ? 'Waiting for at least one more player…'
              : 'Everyone is in. Gameplay lands in the next update.'}
          </p>
        </section>
      </div>
    </main>
  );
}
