import { APP_NAME, type RoomState } from '@inkling/shared';
import { Avatar } from './Avatar';
import { Board } from './canvas/Board';

interface GameProps {
  room: RoomState;
  myId: string;
  onLeave: () => void;
  onLobby: () => void;
}

/** The drawing studio: a slim player rail beside one big sheet of paper. */
export function Game({ room, myId, onLeave, onLobby }: GameProps) {
  const me = room.players.find((p) => p.id === myId);
  const drawer = room.players.find((p) => p.id === room.drawerId);
  const canDraw = room.drawerId === myId;

  return (
    <main className="studio">
      <header className="studio-bar">
        <h1>{APP_NAME}</h1>
        <span className="chip" aria-label={`Room ${room.code}`}>
          {room.code}
        </span>
        <span className="spacer" />
        {me?.isHost && (
          <button type="button" className="link" onClick={onLobby}>
            Back to lobby
          </button>
        )}
        <button type="button" className="link" onClick={onLeave}>
          Leave room
        </button>
      </header>

      <aside className="rail" aria-label="Players">
        <ul>
          {room.players.map((p) => (
            <li
              key={p.id}
              className="rail-player"
              data-drawing={p.id === room.drawerId}
              data-connected={p.connected}
            >
              <Avatar {...p.avatar} size={40} />
              <span className="player-name">{p.name}</span>
              <span className="rail-tags">
                {p.id === myId && <span className="badge">you</span>}
                {p.id === room.drawerId && <span className="badge pen">drawing</span>}
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <section className="stage" aria-label="Canvas">
        <Board canDraw={canDraw} drawerName={drawer?.name ?? 'Someone'} />
      </section>
    </main>
  );
}
