import { describe, expect, it } from 'vitest';
import { STROKE_LIMITS, type CanvasEvent, type StrokeOp } from '@inkling/shared';
import { Board } from './canvas';

const stroke = (id: string, points: number[]): StrokeOp => ({
  t: 'stroke',
  id,
  tool: 'brush',
  color: 0,
  size: 1,
  points,
});

describe('Board', () => {
  it('merges chunks of one stroke and relays each chunk', () => {
    const board = new Board();
    expect(board.apply(stroke('a', [0.1, 0.1]))).toMatchObject({ points: [0.1, 0.1] });
    expect(board.apply(stroke('a', [0.2, 0.2, 0.3, 0.3]))).toMatchObject({ id: 'a' });
    board.apply(stroke('b', [0.5, 0.5]));
    expect(board.snapshot()).toMatchObject([
      { id: 'a', points: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3] },
      { id: 'b' },
    ]);
  });

  it('undo drops the last whole op and clear empties the board', () => {
    const board = new Board();
    board.apply(stroke('a', [0, 0]));
    board.apply({ t: 'fill', id: 'f', color: 2, x: 0.5, y: 0.5 });
    expect(board.apply({ t: 'undo' })).toEqual({ t: 'undo' });
    expect(board.snapshot().map((o) => o.id)).toEqual(['a']);
    expect(board.apply({ t: 'clear' })).toEqual({ t: 'clear' });
    expect(board.snapshot()).toEqual([]);
  });

  it('ignores no-op undo and clear so nothing is relayed', () => {
    const board = new Board();
    expect(board.apply({ t: 'undo' })).toBeNull();
    expect(board.apply({ t: 'clear' })).toBeNull();
  });

  it('enforces the op and stroke-size caps', () => {
    const board = new Board();
    for (let i = 0; i < STROKE_LIMITS.maxOps; i++) {
      board.apply({ t: 'fill', id: `f${i}`, color: 0, x: 0, y: 0 });
    }
    expect(board.apply({ t: 'fill', id: 'over', color: 0, x: 0, y: 0 })).toBeNull();
    expect(board.apply(stroke('over', [0, 0]))).toBeNull();

    const big = new Board();
    const chunk = new Array(STROKE_LIMITS.chunkPoints * 2).fill(0.5);
    let relayed: CanvasEvent | null = null;
    for (let i = 0; i < 40; i++) relayed = big.apply(stroke('s', chunk));
    expect(relayed).toBeNull();
    const [only] = big.snapshot();
    expect(only?.t === 'stroke' && only.points.length).toBe(STROKE_LIMITS.strokePoints * 2);
  });

  it('hands out copies so callers cannot mutate the board', () => {
    const board = new Board();
    board.apply(stroke('a', [0, 0]));
    const snap = board.snapshot();
    if (snap[0]?.t === 'stroke') snap[0].points.push(1, 1);
    const again = board.snapshot()[0];
    expect(again?.t === 'stroke' && again.points).toEqual([0, 0]);
  });
});
