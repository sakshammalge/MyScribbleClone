import { STROKE_LIMITS, type CanvasEvent, type DrawOp } from '@inkling/shared';

/** The server's copy of one drawing: the ordered operations that late joiners replay. */
export class Board {
  private ops: DrawOp[] = [];

  /**
   * Applies an already-parsed event. Returns the event to relay to viewers, or null when it
   * changed nothing (over a limit, nothing to undo) and should be dropped.
   */
  apply(event: CanvasEvent): CanvasEvent | null {
    switch (event.t) {
      case 'clear':
        if (this.ops.length === 0) return null;
        this.ops = [];
        return event;
      case 'undo':
        return this.ops.pop() ? event : null;
      case 'fill':
        if (this.ops.length >= STROKE_LIMITS.maxOps) return null;
        this.ops.push({ ...event });
        return event;
      case 'stroke': {
        const last = this.ops[this.ops.length - 1];
        if (last?.t === 'stroke' && last.id === event.id) {
          // Same pen-down: append the chunk to the stroke we already hold.
          const room = STROKE_LIMITS.strokePoints * 2 - last.points.length;
          if (room <= 0) return null;
          const points = event.points.slice(0, room);
          last.points.push(...points);
          return { ...event, points };
        }
        if (this.ops.length >= STROKE_LIMITS.maxOps) return null;
        this.ops.push({ ...event, points: [...event.points] });
        return event;
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
  }
}
