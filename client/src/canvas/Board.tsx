import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import {
  BRUSH_SIZES,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  STROKE_LIMITS,
  type CanvasEvent,
} from '@inkling/shared';
import { socket } from '../socket';
import { Toolbar, type ToolChoice } from './Toolbar';
import { Surface } from './surface';

/** Send pen movement to the server in bursts rather than one message per pointer event. */
const FLUSH_MS = 30;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

interface BoardProps {
  /** True for the one player holding the pen; everyone else just watches. */
  canDraw: boolean;
  drawerName: string;
}

export function Board({ canDraw, drawerName }: BoardProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const surface = useRef<Surface | null>(null);
  const [tool, setTool] = useState<ToolChoice>('brush');
  const [color, setColor] = useState(0);
  const [size, setSize] = useState(2);
  const [ops, setOps] = useState(0);

  // The pointer handlers read the toolbar through refs so a mid-stroke re-render cannot change them.
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  toolRef.current = tool;
  colorRef.current = color;
  sizeRef.current = size;

  // The pen stroke being drawn: its id and the points not yet sent.
  const pen = useRef<{ id: string; pending: number[]; last: [number, number] } | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mirror the room's drawing onto the canvas, and ask for the current picture on mount.
  useEffect(() => {
    const s = new Surface(canvasRef.current!);
    surface.current = s;
    const sync = () => setOps(s.opCount);
    const onEvent = (event: CanvasEvent) => {
      s.apply(event);
      sync();
    };
    const onReplay = (list: Parameters<Surface['reset']>[0]) => {
      s.reset(list);
      sync();
    };
    socket.on('canvas:event', onEvent);
    socket.on('canvas:replay', onReplay);
    socket.emit('canvas:sync', onReplay);
    return () => {
      socket.off('canvas:event', onEvent);
      socket.off('canvas:replay', onReplay);
      surface.current = null;
    };
  }, []);

  const send = useCallback((event: CanvasEvent) => {
    surface.current?.apply(event);
    setOps(surface.current?.opCount ?? 0);
    socket.emit('canvas:event', event);
  }, []);

  const flush = useCallback(() => {
    const p = pen.current;
    if (!p || p.pending.length === 0) return;
    const per = STROKE_LIMITS.chunkPoints * 2;
    while (p.pending.length) {
      const points = p.pending.splice(0, per);
      send({
        t: 'stroke',
        id: p.id,
        tool: toolRef.current === 'eraser' ? 'eraser' : 'brush',
        color: colorRef.current,
        size: sizeRef.current,
        points,
      });
    }
  }, [send]);

  const stopPen = useCallback(() => {
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = null;
    flush();
    pen.current = null;
  }, [flush]);

  useEffect(() => stopPen, [stopPen]);

  const pointOf = (e: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return [
      clamp((e.clientX - rect.left) / rect.width),
      clamp((e.clientY - rect.top) / rect.height),
    ];
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!canDraw || e.button !== 0) return;
    const [x, y] = pointOf(e);
    if (tool === 'fill') {
      send({ t: 'fill', id: newId(), color, x, y });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    pen.current = { id: newId(), pending: [x, y], last: [x, y] };
    flush();
    flushTimer.current = setInterval(flush, FLUSH_MS);
  };

  const moveCursor = (e: PointerEvent<HTMLCanvasElement>) => {
    const ring = cursorRef.current;
    if (!ring || !canDraw) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const d = BRUSH_SIZES[size]! * (rect.width / CANVAS_WIDTH);
    ring.style.width = ring.style.height = `${Math.max(d, 6)}px`;
    ring.style.transform = `translate(${e.clientX - rect.left - d / 2}px, ${e.clientY - rect.top - d / 2}px)`;
    ring.hidden = tool === 'fill';
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    moveCursor(e);
    const p = pen.current;
    if (!p) return;
    const samples = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const s of samples.length ? samples : [e.nativeEvent]) {
      const pt = pointOf(s);
      if (pt[0] === p.last[0] && pt[1] === p.last[1]) continue;
      p.last = pt;
      p.pending.push(pt[0], pt[1]);
    }
  };

  const hideCursor = () => {
    if (cursorRef.current) cursorRef.current.hidden = true;
  };

  // Keyboard shortcuts for the drawer: B brush, E eraser, F fill, Ctrl/Cmd+Z undo.
  useEffect(() => {
    if (!canDraw) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, [contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        send({ t: 'undo' });
      } else if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        const next = { b: 'brush', e: 'eraser', f: 'fill' }[e.key.toLowerCase()] as
          ToolChoice | undefined;
        if (next) setTool(next);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canDraw, send]);

  return (
    <div className="board">
      <div className="sheet" data-can-draw={canDraw}>
        <canvas
          ref={canvasRef}
          className="paper"
          data-testid="drawing-canvas"
          data-ops={ops}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          aria-label={canDraw ? 'Drawing canvas' : `${drawerName}'s drawing`}
          role="img"
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={stopPen}
          onPointerCancel={stopPen}
          onPointerLeave={hideCursor}
        />
        {canDraw && <div ref={cursorRef} className="brush-ring" data-tool={tool} hidden />}
      </div>
      {canDraw ? (
        <Toolbar
          tool={tool}
          color={color}
          size={size}
          canUndo={ops > 0}
          onTool={setTool}
          onColor={(c) => {
            setColor(c);
            if (tool === 'eraser') setTool('brush');
          }}
          onSize={setSize}
          onUndo={() => send({ t: 'undo' })}
          onClear={() => send({ t: 'clear' })}
        />
      ) : (
        <p className="watching" role="status">
          <span className="pencil" aria-hidden="true">
            ✎
          </span>
          {drawerName} is drawing…
        </p>
      )}
    </div>
  );
}
