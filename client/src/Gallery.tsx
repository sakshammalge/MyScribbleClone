import { useEffect, useRef, useState } from 'react';
import type { GalleryDrawing } from '@inkling/shared';
import { Surface } from './canvas/surface';
import { socket } from './socket';

interface Shot extends GalleryDrawing {
  png: string;
  saved: string;
}

/** The caption strip baked under a saved PNG. */
const CAPTION_HEIGHT = 64;

/** Paints a finished drawing on an offscreen canvas and returns it as a PNG data URL. */
function render(drawing: GalleryDrawing): string {
  const canvas = document.createElement('canvas');
  new Surface(canvas).reset(drawing.ops);
  return canvas.toDataURL('image/png');
}

/** The same drawing with the word and the drawer's name printed under it, for Save PNG. */
function renderLabelled(drawing: GalleryDrawing): string {
  const art = document.createElement('canvas');
  new Surface(art).reset(drawing.ops);
  const out = document.createElement('canvas');
  out.width = art.width;
  out.height = art.height + CAPTION_HEIGHT;
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(art, 0, 0);
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, art.height, out.width, 2);
  ctx.textBaseline = 'middle';
  const y = art.height + CAPTION_HEIGHT / 2 + 1;
  ctx.textAlign = 'left';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(drawing.word, 20, y, out.width * 0.55);
  ctx.textAlign = 'right';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(`drawn by ${drawing.drawer}`, out.width - 20, y, out.width * 0.4);
  return out.toDataURL('image/png');
}

/** "Giraffe Neck!" becomes "inkling-giraffe-neck". */
export function fileName(word: string): string {
  const slug = word
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return `inkling-${slug || 'drawing'}.png`;
}

const SPEED = 30; // px per second

/** Every drawing of the match in a slow carousel; it holds still while hovered, touched or focused. */
export function Gallery() {
  const [shots, setShots] = useState<Shot[] | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const paused = useRef(false);

  // Fetched on mount and after every reconnect, so late joiners and refreshes see all of them.
  useEffect(() => {
    const load = () =>
      socket.emit('gallery:sync', (list) =>
        setShots(list.map((d) => ({ ...d, png: render(d), saved: renderLabelled(d) }))),
      );
    socket.on('connect', load);
    if (socket.connected) load();
    return () => {
      socket.off('connect', load);
    };
  }, []);

  useEffect(() => {
    const el = track.current;
    if (!el || !shots?.length) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let last = performance.now();
    let dir = 1;
    let pos = el.scrollLeft;
    const tick = (now: number) => {
      const dt = Math.min(now - last, 100) / 1000;
      last = now;
      const max = el.scrollWidth - el.clientWidth;
      if (!paused.current && max > 0) {
        // Follow manual scrolling instead of fighting it.
        if (Math.abs(el.scrollLeft - pos) > 2) pos = el.scrollLeft;
        pos += dir * SPEED * dt;
        if (pos >= max) {
          pos = max;
          dir = -1;
        } else if (pos <= 0) {
          pos = 0;
          dir = 1;
        }
        el.scrollLeft = pos;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [shots]);

  if (!shots?.length) return null;
  const hold = (on: boolean) => () => {
    paused.current = on;
  };
  return (
    <section className="gallery" aria-label="Drawings from this game" data-testid="gallery">
      <h2>The gallery</h2>
      <div
        className="gallery-track"
        ref={track}
        tabIndex={0}
        onMouseEnter={hold(true)}
        onMouseLeave={hold(false)}
        onTouchStart={hold(true)}
        onTouchEnd={hold(false)}
        onTouchCancel={hold(false)}
        onFocus={hold(true)}
        onBlur={hold(false)}
      >
        {shots.map((s) => (
          <figure key={s.turn} className="gallery-card" data-testid="gallery-card">
            <img src={s.png} alt={`Drawing of ${s.word} by ${s.drawer}`} />
            <figcaption>
              <strong>{s.word}</strong>
              <span>drawn by {s.drawer}</span>
            </figcaption>
            <a className="link" href={s.saved} download={fileName(s.word)}>
              Save PNG
            </a>
          </figure>
        ))}
      </div>
    </section>
  );
}
