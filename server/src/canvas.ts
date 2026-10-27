import { STROKE_LIMITS, type CanvasEvent, type DrawOp } from '@inkling/shared';

const cost = (op: DrawOp) => (op.t === 'stroke' ? op.points.length / 2 : 1);

/** The server's copy of one drawing: the ordered operations that late joiners replay. */
export class Board {
  private ops: DrawOp[] = [];
  /** Points held across every operation (a fill counts as one), capped by STROKE_LIMITS.totalPoints. */
  private used = 0;

  /**
   * Applies an already-parsed event. Returns the event to relay to viewers, or null when it
   * changed nothing (over a limit, nothing to undo) and should be dropped.
   */
  apply(event: CanvasEvent): CanvasEvent | null {
    switch (event.t) {
      case 'clear':
        if (this.ops.length === 0) return null;
        this.clear();
        return event;
      case 'undo': {
        const popped = this.ops.pop();
        if (popped) this.used -= cost(popped);
        return popped ? event : null;
      }
      case 'fill':
        if (this.ops.length >= STROKE_LIMITS.maxOps || this.used >= STROKE_LIMITS.totalPoints) {
          return null;
        }
        this.ops.push({ ...event });
        this.used += 1;
        return event;
      case 'shape': {
        const last = this.ops[this.ops.length - 1];
        if (last?.t === 'shape' && last.id === event.id) {
          // The drawer is still dragging: the newest corners replace the shape we hold.
          this.ops[this.ops.length - 1] = { ...event };
          return event;
        }
        if (this.ops.length >= STROKE_LIMITS.maxOps || this.used >= STROKE_LIMITS.totalPoints) {
          return null;
        }
        this.ops.push({ ...event });
        this.used += 1;
        return event;
      }
      case 'stroke': {
        const last = this.ops[this.ops.length - 1];
        if (last?.t === 'stroke' && last.id === event.id) {
          // Same pen-down: append the chunk to the stroke we already hold.
          const room = Math.min(
            STROKE_LIMITS.strokePoints * 2 - last.points.length,
            (STROKE_LIMITS.totalPoints - this.used) * 2,
          );
          if (room <= 0) return null;
          // Keep whole x,y pairs when a limit cuts the chunk short.
          const points = event.points.slice(0, room - (room % 2));
          if (points.length === 0) return null;
          last.points.push(...points);
          this.used += points.length / 2;
          return { ...event, points };
        }
        const left = STROKE_LIMITS.totalPoints - this.used;
        if (this.ops.length >= STROKE_LIMITS.maxOps || left <= 0) return null;
        const points = event.points.slice(0, left * 2);
        this.ops.push({ ...event, points: [...points] });
        this.used += points.length / 2;
        return points.length === event.points.length ? event : { ...event, points };
      }
    }
  }

  snapshot(): DrawOp[] {
    return this.ops.map((op) =>
      op.t === 'stroke' ? { ...op, points: [...op.points] } : { ...op },
    );
  }

  clear(): void {
    this.ops = [];
    this.used = 0;
  }
}
