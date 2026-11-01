import { useState } from 'react';
import {
  APP_NAME,
  rankPlayers,
  type ChatMessage,
  type PlayerInfo,
  type PrivateState,
  type RoomState,
} from '@inkling/shared';
import { Avatar } from './Avatar';
import { Board } from './canvas/Board';
import { Chat } from './Chat';
import { useCountdown } from './clock';
import { Gallery } from './Gallery';
import { GameMenu } from './GameMenu';

interface GameProps {
  room: RoomState;
  myId: string;
  secrets: PrivateState;
  chat: ChatMessage[];
  onLeave: () => void;
  onLobby: () => void;
  onKick: (playerId: string) => void;
  onRematch: () => void;
  onChoose: (index: number) => void;
  onChat: (text: string) => void;
}

const PHASE_LABEL: Record<RoomState['phase'], string> = {
  lobby: '',
  choosing: 'Choosing a word',
  drawing: 'Draw and guess',
  reveal: 'Time to reveal',
  ended: 'Final scores',
};

const TIER_LABELS = ['easy', 'medium', 'hard'] as const;

/** The studio: one top bar, then players, the sheet with its pencil case, and the chat. */

export function Game({
  room,
  myId,
  secrets,
  chat,
  onLeave,
  onLobby,
  onKick,
  onRematch,
  onChoose,
  onChat,
}: GameProps) {
  const [endView, setEndView] = useState<'scores' | 'gallery'>('scores');
  const me = room.players.find((p) => p.id === myId);
  const drawer = room.players.find((p) => p.id === room.drawerId);
  const isDrawer = room.drawerId === myId;
  const canDraw = isDrawer && room.phase === 'drawing';
  const { seconds, fraction } = useCountdown(room.phaseEndsAt, room.phaseMs);
  const ranked = rankPlayers(room.players);
  const gains = room.phase === 'reveal' ? room.reveal?.gains : undefined;
  const drawerName = drawer?.name ?? 'Someone';

  const note =
    room.phase === 'drawing'
      ? `${drawerName} is drawing…`
      : room.phase === 'choosing'
        ? `${drawerName} is choosing a word…`
        : room.phase === 'reveal'
          ? 'Next up in a moment…'
          : 'Thanks for playing!';

  return (
    <main className="studio" data-phase={room.phase} data-role={isDrawer ? 'drawer' : 'guest'}>
      <header className="studio-bar" data-phase={room.phase}>
        <span className="logo">
          <img src="/logo.svg" alt="" width="24" height="24" />
          <h1>{APP_NAME}</h1>
        </span>
        <span className="chip" aria-label={`Room ${room.code}`}>
          {room.code}
        </span>
        {room.round > 0 && (
          <span className="round" data-testid="round">
            Round {room.round} of {room.settings.rounds}
          </span>
        )}
        <WordSlip room={room} word={secrets.word} isDrawer={isDrawer} />
        {room.phaseEndsAt !== null ? (
          <span className="timer" data-testid="timer" role="timer" aria-label="Seconds left">
            {seconds}
          </span>
        ) : (
          <span className="timer" aria-hidden="true" />
        )}
        <GameMenu isHost={!!me?.isHost} onLobby={onLobby} onLeave={onLeave} />
        <span className="ink-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${room.phaseEndsAt === null ? 0 : fraction})` }} />
        </span>
      </header>

      <aside className="rail" aria-label="Players">
        <div className="panel-head">
          <h2>Players</h2>
          <span className="count">
            {room.players.length} / {room.settings.maxPlayers}
          </span>
        </div>
        <ol>
          {ranked.map(({ player: p, place }) => {
            const kickable = !!me?.isHost && p.id !== myId && room.phase !== 'ended';
            const guessed = p.guessed && room.phase === 'drawing';
            const drawing = p.id === room.drawerId && room.phase !== 'ended';
            return (
              <li
                key={p.id}
                className="prow"
                title={p.name}
                data-drawing={drawing}
                data-guessed={guessed}
                data-connected={p.connected}
                data-me={p.id === myId}
                data-kickable={kickable}
              >
                <span className="rank">{place}</span>
                <Avatar {...p.avatar} size={28} />
                <span className="pname">
                  <span className="pname-text">{p.name}</span>
                  {p.id === myId && <span className="you"> (you)</span>}
                </span>
                {drawing && <PencilIcon />}
                {guessed && <CheckIcon />}
                <span className="score-cell">
                  {!!gains?.[p.id] && (
                    <span className="gain" data-testid={`gain-${p.name}`}>
                      +{gains[p.id]}
                    </span>
                  )}
                  <span className="score" data-testid={`score-${p.name}`}>
                    {p.score}
                  </span>
                </span>
                {kickable && (
                  <button
                    type="button"
                    className="kick"
                    aria-label={`Remove ${p.name}`}
                    onClick={() => onKick(p.id)}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </aside>

      <section className="stage" aria-label="Canvas">
        <Board
          key={room.turn}
          canDraw={canDraw}
          drawerName={drawerName}
          note={note}
          below={
            room.phase === 'ended' ? (
              <div className="view-tabs" role="tablist" aria-label="End of game">
                {(['scores', 'gallery'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    className="tab"
                    aria-selected={endView === view}
                    onClick={() => setEndView(view)}
                  >
                    {view === 'scores' ? 'Scores' : 'Gallery'}
                  </button>
                ))}
              </div>
            ) : undefined
          }
        >
          {room.phase === 'choosing' && (
            <div className="veil" data-testid="choosing">
              {isDrawer && secrets.choices ? (
                <div className="picker" role="group" aria-label="Choose a word">
                  <p>Pick something to draw</p>
                  {secrets.choices.map((word, i) => (
                    <button
                      key={word}
                      type="button"
                      className="btn"
                      data-tier={TIER_LABELS[secrets.tiers?.[i] ?? 1]}
                      onClick={() => onChoose(i)}
                    >
                      {word}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="veil-note">{drawerName} is choosing a word…</p>
              )}
            </div>
          )}
          {room.phase === 'reveal' && room.reveal && (
            <div className="veil" data-testid="reveal">
              <p className="veil-note">
                The word was <strong>{room.reveal.word}</strong>
              </p>
              <TurnResults room={room} reveal={room.reveal} />
            </div>
          )}
          {room.phase === 'ended' && endView === 'scores' && (
            <div className="veil" data-testid="standings">
              <p className="veil-note">Game over</p>
              <Podium ranked={ranked} myId={myId} />
              {me?.isHost ? (
                <div className="veil-actions">
                  <button type="button" className="btn" onClick={onRematch}>
                    Play again
                  </button>
                  <button type="button" className="link" onClick={onLobby}>
                    Back to lobby
                  </button>
                </div>
              ) : (
                <p className="muted">Waiting for the host…</p>
              )}
            </div>
          )}
          {room.phase === 'ended' && endView === 'gallery' && (
            <div className="veil veil-gallery">
              <Gallery />
            </div>
          )}
        </Board>
      </section>

      <Chat
        reactions
        messages={chat}
        onSend={onChat}
        placeholder={
          room.phase === 'drawing' && !isDrawer && !me?.guessed
            ? 'Type your guess…'
            : room.phase === 'drawing'
              ? 'Chat with insiders…'
              : 'Say something…'
        }
      />
    </main>
  );
}

function PencilIcon() {
  return (
    <svg className="status-ico" viewBox="0 0 24 24" role="img" aria-label="drawing">
      <path
        d="M4 20l1-5L16 4l4 4L9 19zM14 6l4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="status-ico" viewBox="0 0 24 24" role="img" aria-label="guessed it">
      <path
        d="M5 13l4 4L19 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The word as the viewer may know it: in full for the drawer, as blanks (plus hints) for others. */
function WordSlip({
  room,
  word,
  isDrawer,
}: {
  room: RoomState;
  word: string | null;
  isDrawer: boolean;
}) {
  if (room.phase !== 'drawing') {
    return <span className="phase">{PHASE_LABEL[room.phase]}</span>;
  }
  if (isDrawer && word) {
    return (
      <span className="slip" data-testid="secret-word">
        Draw: <strong>{word}</strong>
      </span>
    );
  }
  const hint = room.hint ?? '';
  const letters = [...hint].filter((c) => c !== ' ').length;
  return (
    <span className="slip" data-testid="hint" aria-label={`Hint: ${hint}, ${letters} letters`}>
      {[...hint].map((ch, i) => (
        <span key={i} className="blank" data-gap={ch === ' '} data-shown={ch !== '_' && ch !== ' '}>
          {ch === '_' ? '' : ch}
        </span>
      ))}
      <small>{letters}</small>
    </span>
  );
}

/** This turn's points, biggest first; the drawer is marked and a blank turn says so. */
function TurnResults({
  room,
  reveal,
}: {
  room: RoomState;
  reveal: NonNullable<RoomState['reveal']>;
}) {
  const rows = room.players
    .map((p) => ({ p, gain: reveal.gains[p.id] ?? 0 }))
    .sort((a, b) => b.gain - a.gain);
  const nobody = rows.every((r) => r.p.id === room.drawerId || r.gain === 0);
  return (
    <>
      {nobody && <p className="muted">Nobody found it this time.</p>}
      <ul className="gains">
        {rows.map(({ p, gain }) => (
          <li key={p.id} data-gained={gain > 0}>
            <Avatar {...p.avatar} size={28} />
            <span>
              {p.name}
              {p.id === room.drawerId && <em className="tag">drew it</em>}
            </span>
            <b>+{gain}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The top three on blocks (first in the middle), with everyone else listed below. */
function Podium({
  ranked,
  myId,
}: {
  ranked: { player: PlayerInfo; place: number }[];
  myId: string;
}) {
  const top = ranked.filter((r) => r.place <= 3);
  const rest = ranked.filter((r) => r.place > 3);
  // Middle block is the winner(s); silver sits to its left and bronze to its right.
  const order = [...top].sort((a, b) => a.place - b.place);
  const arranged =
    order.length >= 3 && order[0]!.place === 1 && order[1]!.place !== 1
      ? [order[1]!, order[0]!, ...order.slice(2)]
      : order;
  return (
    <>
      <ol className="podium" aria-label="Final standings">
        {arranged.map(({ player: p, place }) => (
          <li key={p.id} data-place={place} data-testid={`podium-${p.name}`}>
            <Avatar {...p.avatar} size={place === 1 ? 56 : 44} />
            <span className="player-name">
              {p.name}
              {p.id === myId && <em className="tag">you</em>}
            </span>
            <b>{p.score}</b>
            <span className="block" aria-hidden="true">
              {place}
            </span>
          </li>
        ))}
      </ol>
      {rest.length > 0 && (
        <ol className="runners" start={4}>
          {rest.map(({ player: p, place }) => (
            <li key={p.id}>
              <span className="place">#{place}</span>
              <span className="player-name">{p.name}</span>
              <b>{p.score}</b>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
