import {
  BRUSH_SIZES,
  CANVAS_BACKGROUND,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  PALETTE,
  type CanvasEvent,
  type DrawOp,
  type ShapeOp,
  type StrokeOp,
} from '@inkling/shared';
import { floodFill } from './floodFill';

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const inkOf = (op: StrokeOp) => (op.tool === 'eraser' ? CANVAS_BACKGROUND : PALETTE[op.color]!);

/**
 * One drawing on one <canvas>. It keeps the ordered ops so undo is "drop the last and repaint",
 * and so the drawer, a live viewer and a late joiner all end up with the same pixels.
 */
export class Surface {
  private ctx: CanvasRenderingContext2D;
  private ops: DrawOp[] = [];

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.paintBlank();
  }

  /** Replace everything with a full list of ops (join, refresh, reconnect). */
  reset(ops: DrawOp[]): void {
    this.ops = ops.map((op) => (op.t === 'stroke' ? { ...op, points: [...op.points] } : { ...op }));
    this.repaint();
  }

  /** Apply one change; strokes may be chunks of the stroke already on the last op. */
  apply(event: CanvasEvent): void {
    switch (event.t) {
      case 'clear':
        this.ops = [];
        this.paintBlank();
        return;
      case 'undo':
        if (this.ops.pop()) this.repaint();
        return;
      case 'fill':
        this.ops.push({ ...event });
        this.paintFill(event);
        return;
      case 'shape': {
        const last = this.ops[this.ops.length - 1];
        if (last?.t === 'shape' && last.id === event.id) {
          this.ops[this.ops.length - 1] = { ...event };
          this.repaint();
        } else {
          this.ops.push({ ...event });
          this.paintShape(event);
        }
        return;
      }
      case 'stroke': {
        const last = this.ops[this.ops.length - 1];
        if (last?.t === 'stroke' && last.id === event.id) {
          const from = last.points.slice(-2);
          last.points.push(...event.points);
          this.paintSegments(last, [...from, ...event.points], false);
        } else {
          const op = { ...event, points: [...event.points] };
          this.ops.push(op);
          this.paintSegments(op, op.points, true);
        }
        return;
      }
    }
  }

  get opCount(): number {
    return this.ops.length;
  }

  private paintBlank(): void {
    this.ctx.fillStyle = CANVAS_BACKGROUND;
    this.ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  private repaint(): void {
    this.paintBlank();
    for (const op of this.ops) {
      if (op.t === 'fill') this.paintFill(op);
      else if (op.t === 'shape') this.paintShape(op);
      else this.paintSegments(op, op.points, true);
    }
  }

  /**
   * Draw `pts` (a flat point list) as separate round-capped segments. `fromStart` also stamps a
   * dot at the first point so a click leaves a mark. Painting every segment on its own, in order,
   * makes a stroke arrive-in-chunks pixel-identical to the same stroke repainted in one go.
   */
  private paintSegments(op: StrokeOp, pts: number[], fromStart: boolean): void {
    const { ctx } = this;
    const size = BRUSH_SIZES[op.size]!;
    const px = (i: number) => pts[i]! * CANVAS_WIDTH;
    const py = (i: number) => pts[i + 1]! * CANVAS_HEIGHT;
    ctx.fillStyle = ctx.strokeStyle = inkOf(op);
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    if (fromStart) {
      ctx.beginPath();
      ctx.arc(px(0), py(0), size / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 2; i < pts.length; i += 2) {
      ctx.beginPath();
      ctx.moveTo(px(i - 2), py(i - 2));
      ctx.lineTo(px(i), py(i));
      ctx.stroke();
    }
  }

  private paintShape(op: ShapeOp): void {
    const { ctx } = this;
    const x0 = op.x0 * CANVAS_WIDTH;
    const y0 = op.y0 * CANVAS_HEIGHT;
    const x1 = op.x1 * CANVAS_WIDTH;
    const y1 = op.y1 * CANVAS_HEIGHT;
    ctx.fillStyle = ctx.strokeStyle = PALETTE[op.color]!;
    ctx.lineWidth = BRUSH_SIZES[op.size]!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (op.kind === 'line') {
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
    } else if (op.kind === 'rect') {
      ctx.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    } else {
      ctx.ellipse(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2,
        Math.abs(y1 - y0) / 2,
        0,
        0,
        Math.PI * 2,
      );
    }
    if (op.filled && op.kind !== 'line') ctx.fill();
    else ctx.stroke();
  }

  private paintFill(op: { color: number; x: number; y: number }): void {
    const image = this.ctx.getImageData(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    const painted = floodFill(
      image.data,
      CANVAS_WIDTH,
      CANVAS_HEIGHT,
      op.x * CANVAS_WIDTH,
      op.y * CANVAS_HEIGHT,
      rgb(PALETTE[op.color]!),
    );
    if (painted > 0) this.ctx.putImageData(image, 0, 0);
  }
}
