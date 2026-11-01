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
import { GameMenu } from './GameMenu';
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
  wordChoices: { label: 'Word choices', unit: '' },
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
  // The host's words box starts folded on short desktop windows, where there is no room for it.
  const [wordsOpen, setWordsOpen] = useState(
    () => !(isHost && window.matchMedia('(min-width: 1024px) and (max-height: 740px)').matches),
  );
  const link = inviteUrl(room.code);
  const hostName = room.players.find((p) => p.isHost)?.name ?? 'the host';
  const { maxPlayers } = room.settings;
  const openSeats = Math.max(0, maxPlayers - room.players.length);

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
    <main className="lobby">
      <header className="studio-bar lobby-bar">
        <span className="logo">
          <img src="/logo.svg" alt="" width="24" height="24" />
          <h1>{APP_NAME}</h1>
        </span>
        <span className="chip" aria-label={`Room ${room.code}`}>
          {room.code}
        </span>
        <span className="lobby-bar-fill" />
        <GameMenu isHost={isHost} onLeave={onLeave} />
      </header>

      <div className="lobby-body">
        <section className="invite" aria-label="Invite">
          <div className="invite-code">
            <p className="eyebrow">Room code</p>
            <div
              className="code-tiles"
              role="img"
              aria-label={`Room code ${room.code}`}
              data-testid="room-code"
            >
              {[...room.code].map((ch, i) => (
                <span key={i} className="tile">
                  {ch}
                </span>
              ))}
            </div>
          </div>
          <div className="invite-link">
            <p className="eyebrow">Invite link</p>
            <div className="invite-row">
              <input
                className="link-box"
                readOnly
                aria-readonly="true"
                value={link}
                aria-label="Invite link"
                onFocus={(e) => e.target.select()}
              />
              <button type="button" className="btn" onClick={copy}>
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>
          </div>
        </section>

        <div className="main-col">
          <section className="panel players" aria-label="Players">
            <div className="panel-title">
              <h2>Players</h2>
              <span className="count">
                {room.players.length} / {maxPlayers}
              </span>
            </div>
            <div className="seats">
              <ul className="seat-list">
                {room.players.map((p) => (
                  <li
                    key={p.id}
                    className="seat"
                    data-testid="seat"
                    data-connected={p.connected}
                    data-me={p.id === myId}
                  >
                    <Avatar {...p.avatar} size={36} />
                    <span className="seat-text">
                      <span className="player-name">{p.name}</span>
                      <span className="seat-tags">
                        {p.id === myId && <span className="badge">you</span>}
                        {p.isHost && <span className="badge host">host</span>}
                        {!p.connected && <span className="badge away">reconnecting…</span>}
                      </span>
                    </span>
                    {isHost && p.id !== myId && (
                      <button
                        type="button"
                        className="kick"
                        aria-label={`Remove ${p.name}`}
                        title="Remove"
                        onClick={() => onKick(p.id)}
                      >
                        ✕
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {Array.from({ length: openSeats }, (_, i) => (
                <div key={i} className="seat open" data-testid="seat" aria-hidden="true">
                  <span className="seat-plus">+</span>
                  <span className="seat-text">Open seat</span>
                </div>
              ))}
              {openSeats > 0 && (
                <p className="seats-more" aria-hidden="true">
                  +{openSeats} open {openSeats === 1 ? 'seat' : 'seats'}
                </p>
              )}
            </div>
          </section>

          <div className="panel chat-panel">
            <div className="panel-title">
              <h2>Chat</h2>
            </div>
            <Chat messages={chat} onSend={onChat} placeholder="Say hello…" />
          </div>
        </div>

        <aside className="side">
          <section className="panel settings" aria-label="Game settings">
            <div className="panel-title">
              <h2>Game settings</h2>
            </div>
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
          </section>

          <section className="panel words" aria-label="Custom words" data-open={wordsOpen}>
            <button
              type="button"
              className="panel-title fold"
              aria-expanded={wordsOpen}
              aria-controls="words-body"
              onClick={() => setWordsOpen((v) => !v)}
            >
              <h2>Your own words</h2>
              <span className="count" data-testid="custom-count">
                {room.customWordCount}
              </span>
              <svg className="chev" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <div className="words-body" id="words-body" hidden={!wordsOpen}>
              {isHost ? (
                <>
                  <label className="field">
                    One per line, or separated by commas
                    <textarea
                      aria-label="Custom words"
                      rows={3}
                      value={draft}
                      maxLength={CUSTOM_WORDS.maxWords * (CUSTOM_WORDS.maxLength + 1)}
                      placeholder={'inside joke\nour office dog\nthat one meeting'}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                  </label>
                  <div className="words-actions">
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={only}
                        onChange={(e) => setOnly(e.target.checked)}
                      />
                      Use only my words
                    </label>
                    <button type="button" className="btn secondary" onClick={saveWords}>
                      Save words
                    </button>
                  </div>
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
            </div>
          </section>

          <div className="start">
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
                  : `Waiting for ${hostName} to start…`}
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
