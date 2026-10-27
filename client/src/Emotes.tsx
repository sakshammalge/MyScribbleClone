import { EMOTES, type EmoteEvent } from '@inkling/shared';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { socket } from './socket';

const LIVE_MAX = 14;

/** Reactions drift up over the sheet for a moment, then are gone; nothing is stored. */
export function EmoteLayer() {
  const [live, setLive] = useState<EmoteEvent[]>([]);
  useEffect(() => {
    const onEmote = (event: EmoteEvent) => setLive((list) => [...list, event].slice(-LIVE_MAX));
    socket.on('emote:show', onEmote);
    return () => {
      socket.off('emote:show', onEmote);
    };
  }, []);
  const done = useCallback((id: number) => setLive((list) => list.filter((e) => e.id !== id)), []);
  return (
    <div className="emote-layer" aria-hidden="true" data-testid="emote-layer">
      {live.map((e) => (
        <span
          key={e.id}
          className="emote-float"
          data-testid="emote-float"
          style={
            {
              '--x': `${10 + ((e.id * 37) % 80)}%`,
              '--sway': `${((e.id * 53) % 7) - 3}rem`,
              '--tilt': `${((e.id * 29) % 31) - 15}deg`,
            } as CSSProperties
          }
          onAnimationEnd={() => done(e.id)}
        >
          <span className="emote-glyph">{EMOTES[e.emote]?.emoji}</span>
          <small>{e.name}</small>
        </span>
      ))}
    </div>
  );
}

/** One tap sends a reaction to the whole room. */
export function EmoteBar() {
  return (
    <div className="emote-bar" role="group" aria-label="Reactions">
      {EMOTES.map((emote, i) => (
        <button
          key={emote.emoji}
          type="button"
          className="emote-btn"
          aria-label={emote.label}
          onClick={() => socket.emit('emote:send', i)}
        >
          {emote.emoji}
        </button>
      ))}
    </div>
  );
}
