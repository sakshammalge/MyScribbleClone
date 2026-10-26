/** Drawing protocol shared by the drawer's client, the server and every viewer. */

/** Fixed backing resolution; strokes travel as 0..1 fractions of it so any screen size works. */
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 720;
export const CANVAS_BACKGROUND = '#ffffff';

/** 20 colours; ops carry the index so payloads stay tiny and the server can validate them. */
export const PALETTE = [
  '#1e1a42',
  '#6b6b7a',
  '#b9b9c4',
  '#ffffff',
  '#7a4a2b',
  '#d6455d',
  '#ff6b3d',
  '#f0a35c',
  '#ffd23f',
  '#8bd45a',
  '#1f9d8a',
  '#3cc7b0',
  '#6c8cff',
  '#2a4fd6',
  '#c779ff',
  '#ff7aa8',
  '#8f2f6b',
  '#e8c9a0',
  '#0f5c3a',
  '#5b2a86',
] as const;

/** Brush diameters in canvas pixels, smallest first. */
export const BRUSH_SIZES = [4, 8, 14, 24, 40] as const;

export const STROKE_LIMITS = {
  /** Points accepted in one network chunk. */
  chunkPoints: 200,
  /** Points a single stroke may accumulate. */
  strokePoints: 6000,
  /** Operations kept per drawing; further ones are refused until undo or clear. */
  maxOps: 1500,
} as const;

export type Tool = 'brush' | 'eraser';

/**
 * A pen stroke. `points` is a flat [x0, y0, x1, y1, …] list of 0..1 fractions.
 * On the wire a stroke is sent in chunks sharing one `id`; receivers append.
 */
export interface StrokeOp {
  t: 'stroke';
  id: string;
  tool: Tool;
  color: number;
  size: number;
  points: number[];
}

/** Flood fill from a point; replayed deterministically on a canvas of the fixed resolution. */
export interface FillOp {
  t: 'fill';
  id: string;
  color: number;
  x: number;
  y: number;
}

export type DrawOp = StrokeOp | FillOp;
export type CanvasEvent = DrawOp | { t: 'undo' } | { t: 'clear' };

const OP_ID = /^[A-Za-z0-9_-]{1,40}$/;
const isIndex = (v: unknown, size: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < size;
const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;

/** Returns a clean copy of an untrusted event, or null if it is malformed. */
export function parseCanvasEvent(raw: unknown): CanvasEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  if (e.t === 'undo') return { t: 'undo' };
  if (e.t === 'clear') return { t: 'clear' };
  if (typeof e.id !== 'string' || !OP_ID.test(e.id)) return null;
  if (!isIndex(e.color, PALETTE.length)) return null;
  if (e.t === 'fill') {
    if (!isUnit(e.x) || !isUnit(e.y)) return null;
    return { t: 'fill', id: e.id, color: e.color, x: e.x, y: e.y };
  }
  if (e.t === 'stroke') {
    if (e.tool !== 'brush' && e.tool !== 'eraser') return null;
    if (!isIndex(e.size, BRUSH_SIZES.length)) return null;
    const pts = e.points;
    if (!Array.isArray(pts) || pts.length === 0 || pts.length % 2 !== 0) return null;
    if (pts.length > STROKE_LIMITS.chunkPoints * 2 || !pts.every(isUnit)) return null;
    return {
      t: 'stroke',
      id: e.id,
      tool: e.tool,
      color: e.color,
      size: e.size,
      points: [...(pts as number[])],
    };
  }
  return null;
}
