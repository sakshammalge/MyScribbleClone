import { useState } from 'react';
import {
  APP_NAME,
  CUSTOM_WORDS,
  SETTINGS_LIMITS,
  type ChatMessage,
  type RoomSettings,
  type RoomState,
} from '@inkling/shared';
import { Avatar } from './Avatar';
import { Chat } from './Chat';
import { inviteUrl } from './route';

interface LobbyProps {
  room: RoomState;
  myId: string;
  onLeave: () => void;
  onKick: (playerId: string) => void;
  chat: ChatMessage[];
  onSettings: (patch: Partial<RoomSettings>) => void;
  onWords: (words: string[], only: boolean) => void;
  onChat: (text: string) => void;
  onStart: () => void;
}

const SETTING_LABELS: Record<keyof RoomSettings, { label: string; unit: string }> = {
  rounds: { label: 'Rounds', unit: '' },
  drawTimeSec: { label: 'Draw time', unit: 's' },
  maxPlayers: { label: 'Max players', unit: '' },
};

export function Lobby({
  room,
  myId,
  chat,
  onLeave,
  onKick,
  onSettings,
  onWords,
  onChat,
  onStart,
}: LobbyProps) {
  const [copied, setCopied] = useState(false);
  const [draft, setDraft] = useState('');
  const [only, setOnly] = useState(false);
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

  const saveWords = () => {
    onWords(draft.split(/[\n,]/), only);
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
                {isHost && p.id !== myId && (
                  <button
                    type="button"
                    className="kick"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => onKick(p.id)}
                  >
                    Remove
                  </button>
                )}
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
            disabled={!isHost || room.players.length < 2}
            onClick={onStart}
          >
            Start game
          </button>
          <p className="muted">
            {room.players.length < 2
              ? 'Waiting for at least one more player…'
              : isHost
                ? 'Everyone is in. Start when you are ready.'
                : 'Waiting for the host to start.'}
          </p>
        </section>

        <section className="card" aria-label="Custom words">
          <h2>
            Your own words{' '}
            <span className="count" data-testid="custom-count">
              {room.customWordCount}
            </span>
          </h2>
          {isHost ? (
            <>
              <label className="field">
                One per line, or separated by commas
                <textarea
                  aria-label="Custom words"
                  rows={4}
                  value={draft}
                  maxLength={CUSTOM_WORDS.maxWords * (CUSTOM_WORDS.maxLength + 1)}
                  placeholder={'inside joke\nour office dog\nthat one meeting'}
                  onChange={(e) => setDraft(e.target.value)}
                />
              </label>
              <label className="check">
                <input type="checkbox" checked={only} onChange={(e) => setOnly(e.target.checked)} />
                Use only my words
              </label>
              <button type="button" className="btn secondary" onClick={saveWords}>
                Save words
              </button>
              <p className="muted">
                Mixed in with the built-in list unless you tick the box. Players never see them
                until they come up.
              </p>
            </>
          ) : (
            <p className="muted">
              {room.customWordCount === 0
                ? 'The host has not added any words of their own.'
                : room.customWordsOnly
                  ? `The game will use only the host’s ${room.customWordCount} words.`
                  : `${room.customWordCount} of the host’s words are mixed in.`}
            </p>
          )}
        </section>

        <div className="lobby-chat">
          <Chat messages={chat} onSend={onChat} placeholder="Say hello…" />
        </div>
      </div>
    </main>
  );
}
