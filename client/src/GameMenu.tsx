import { useEffect, useRef, useState } from 'react';
import { useTheme } from './useTheme';

interface GameMenuProps {
  isHost: boolean;
  onLobby: () => void;
  onLeave: () => void;
}

/** The ⋯ button in the top bar: back to lobby (host), dark mode, leave. Closes on outside click or Escape. */
export function GameMenu({ isHost, onLobby, onLeave }: GameMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const { theme, toggle } = useTheme();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dark = theme === 'dark';
  return (
    <div className="menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="menu-btn"
        aria-label="Menu"
        aria-expanded={open}
        aria-controls="game-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <circle cx="5" cy="12" r="2" fill="currentColor" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <circle cx="19" cy="12" r="2" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu-panel" id="game-menu">
          {isHost && (
            <button
              type="button"
              className="menu-item"
              onClick={() => {
                setOpen(false);
                onLobby();
              }}
            >
              Back to lobby
            </button>
          )}
          <button
            type="button"
            className="menu-item"
            role="switch"
            aria-checked={dark}
            aria-label="Dark mode"
            onClick={toggle}
          >
            <span aria-hidden="true">Dark mode</span>
            <span className="switch" aria-hidden="true" data-on={dark} />
          </button>
          <button
            type="button"
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              onLeave();
            }}
          >
            Leave room
          </button>
        </div>
      )}
    </div>
  );
}
