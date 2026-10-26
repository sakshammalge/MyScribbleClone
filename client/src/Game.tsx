import { APP_NAME, type ChatMessage, type PrivateState, type RoomState } from '@inkling/shared';
import { Avatar } from './Avatar';
import { Board } from './canvas/Board';
import { Chat } from './Chat';
import { useCountdown } from './clock';

interface GameProps {
  room: RoomState;
  myId: string;
  secrets: PrivateState;
  chat: ChatMessage[];
  onLeave: () => void;
  onLobby: () => void;
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

/** The studio: players on the left, the sheet in the middle, margin notes on the right. */
export function Game({ room, myId, secrets, chat, onLeave, onLobby, onChoose, onChat }: GameProps) {
  const me = room.players.find((p) => p.id === myId);
  const drawer = room.players.find((p) => p.id === room.drawerId);
  const isDrawer = room.drawerId === myId;
  const canDraw = isDrawer && room.phase === 'drawing';
  const { seconds, fraction } = useCountdown(room.phaseEndsAt, room.phaseMs);
  const ranked = [...room.players].sort((a, b) => b.score - a.score);
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
    <main className="studio">
      <header className="studio-bar">
        <h1>{APP_NAME}</h1>
        <span className="chip" aria-label={`Room ${room.code}`}>
          {room.code}
        </span>
        {room.round > 0 && (
          <span className="round" data-testid="round">
            Round {room.round} of {room.settings.rounds}
          </span>
        )}
        <span className="spacer" />
        {me?.isHost && (
          <button type="button" className="link" onClick={onLobby}>
            {room.phase === 'ended' ? 'Play again' : 'Back to lobby'}
          </button>
        )}
        <button type="button" className="link" onClick={onLeave}>
          Leave room
        </button>
      </header>

      <aside className="rail" aria-label="Players">
        <ol>
          {ranked.map((p, i) => (
            <li
              key={p.id}
              className="rail-player"
              data-drawing={p.id === room.drawerId}
              data-guessed={p.guessed}
              data-connected={p.connected}
            >
              <Avatar {...p.avatar} size={40} />
              <span className="player-name">{p.name}</span>
              <span className="score" data-testid={`score-${p.name}`}>
                {p.score}
              </span>
              <span className="rail-tags">
                <span className="place">#{i + 1}</span>
                {p.id === myId && <span className="badge">you</span>}
                {p.id === room.drawerId && room.phase !== 'ended' && (
                  <span className="badge pen">drawing</span>
                )}
                {p.guessed && room.phase === 'drawing' && <span className="badge ok">got it</span>}
              </span>
            </li>
          ))}
        </ol>
      </aside>

      <section className="stage" aria-label="Canvas">
        <div className="clockbar" data-phase={room.phase}>
          <span className="phase">{PHASE_LABEL[room.phase]}</span>
          <WordSlip room={room} word={secrets.word} isDrawer={isDrawer} />
          {room.phaseEndsAt !== null && (
            <span className="timer" data-testid="timer" role="timer" aria-label="Seconds left">
              {seconds}
            </span>
          )}
          <span className="ink-meter" aria-hidden="true">
            <span style={{ transform: `scaleX(${room.phaseEndsAt === null ? 0 : fraction})` }} />
          </span>
        </div>

        <Board key={room.turn} canDraw={canDraw} drawerName={drawerName} note={note}>
          {room.phase === 'choosing' && (
            <div className="veil" data-testid="choosing">
              {isDrawer && secrets.choices ? (
                <div className="picker" role="group" aria-label="Choose a word">
                  <p>Pick something to draw</p>
                  {secrets.choices.map((word, i) => (
                    <button key={word} type="button" className="btn" onClick={() => onChoose(i)}>
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
              <ul className="gains">
                {room.players.map((p) => (
                  <li key={p.id} data-gained={(room.reveal!.gains[p.id] ?? 0) > 0}>
                    <span>{p.name}</span>
                    <b>+{room.reveal!.gains[p.id] ?? 0}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {room.phase === 'ended' && (
            <div className="veil" data-testid="standings">
              <p className="veil-note">Game over</p>
              <ol className="podium">
                {ranked.map((p, i) => (
                  <li key={p.id} data-place={i + 1}>
                    <Avatar {...p.avatar} size={44} />
                    <span className="player-name">{p.name}</span>
                    <b>{p.score}</b>
                  </li>
                ))}
              </ol>
              <p className="muted">
                {me?.isHost ? 'Press “Play again” for another game.' : 'Waiting for the host…'}
              </p>
            </div>
          )}
        </Board>
      </section>

      <aside className="margin">
        <Chat
          messages={chat}
          onSend={onChat}
          placeholder={
            room.phase === 'drawing' && !isDrawer && !me?.guessed
              ? 'Type your guess…'
              : room.phase === 'drawing'
                ? 'Chat with others who know…'
                : 'Say something…'
          }
        />
      </aside>
    </main>
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
  if (room.phase !== 'drawing') return <span className="slip-gap" />;
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
