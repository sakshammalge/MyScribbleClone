/** Drawing protocol shared by the drawer's client, the server and every viewer. */

/** Fixed backing resolution; strokes travel as 0..1 fractions of it so any screen size works. */
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 720;
export const CANVAS_BACKGROUND = '#ffffff';

/** 20 colours; ops carry the index so payloads stay tiny and the server can validate them. */
export const PALETTE = [
  '#000000', // black
  '#808080', // gray
  '#c0c0c0', // silver
  '#ffffff', // white
  '#a52a2a', // brown
  '#ff0000', // red
  '#ffa500', // orange
  '#d2b48c', // tan
  '#ffff00', // yellow
  '#00ff00', // lime
  '#008000', // green
  '#00ffff', // cyan
  '#0000ff', // blue
  '#000080', // navy
  '#ff00ff', // magenta
  '#ffc0cb', // pink
  '#800000', // maroon
  '#808000', // olive
  '#008080', // teal
  '#800080', // purple
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
  /** Points kept across the whole drawing (a fill counts as one); bounds memory and rejoin traffic. */
  totalPoints: 30_000,
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

export const SHAPE_KINDS = ['line', 'rect', 'ellipse'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/**
 * A line, rectangle or ellipse dragged from (x0, y0) to (x1, y1), as 0..1 fractions. While the
 * drawer is still dragging, the same `id` is sent again and replaces the shape held so far.
 */
export interface ShapeOp {
  t: 'shape';
  id: string;
  kind: ShapeKind;
  filled: boolean;
  color: number;
  size: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type DrawOp = StrokeOp | FillOp | ShapeOp;
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
  if (e.t === 'shape') {
    if (!SHAPE_KINDS.includes(e.kind as ShapeKind) || typeof e.filled !== 'boolean') return null;
    if (!isIndex(e.size, BRUSH_SIZES.length)) return null;
    if (![e.x0, e.y0, e.x1, e.y1].every(isUnit)) return null;
    return {
      t: 'shape',
      id: e.id,
      kind: e.kind as ShapeKind,
      filled: e.filled,
      color: e.color,
      size: e.size,
      x0: e.x0 as number,
      y0: e.y0 as number,
      x1: e.x1 as number,
      y1: e.y1 as number,
    };
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
