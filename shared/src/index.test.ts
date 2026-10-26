import { describe, expect, it } from 'vitest';
import { PALETTE, SETTINGS_LIMITS, STROKE_LIMITS, parseCanvasEvent, rankPlayers } from './index';

describe('SETTINGS_LIMITS', () => {
  it('keeps defaults inside their ranges', () => {
    for (const { min, max, default: def } of Object.values(SETTINGS_LIMITS)) {
      expect(def).toBeGreaterThanOrEqual(min);
      expect(def).toBeLessThanOrEqual(max);
    }
  });
});

describe('parseCanvasEvent', () => {
  const stroke = {
    t: 'stroke',
    id: 'a1',
    tool: 'brush',
    color: 3,
    size: 2,
    points: [0, 0.5, 1, 1],
  };

  it('accepts well-formed events and returns a clean copy', () => {
    expect(parseCanvasEvent({ ...stroke, junk: true })).toEqual(stroke);
    expect(parseCanvasEvent({ t: 'fill', id: 'f', color: 0, x: 0.2, y: 0.9 })).toMatchObject({
      t: 'fill',
    });
    expect(parseCanvasEvent({ t: 'undo' })).toEqual({ t: 'undo' });
    expect(parseCanvasEvent({ t: 'clear' })).toEqual({ t: 'clear' });
  });

  it('rejects out-of-range or malformed input', () => {
    const bad = [
      null,
      'x',
      { t: 'nope' },
      { ...stroke, id: 'has space' },
      { ...stroke, color: PALETTE.length },
      { ...stroke, size: -1 },
      { ...stroke, tool: 'laser' },
      { ...stroke, points: [] },
      { ...stroke, points: [0.1] },
      { ...stroke, points: [0.1, 1.5] },
      { ...stroke, points: [0.1, Number.NaN] },
      { ...stroke, points: new Array(STROKE_LIMITS.chunkPoints * 2 + 2).fill(0.5) },
      { t: 'fill', id: 'f', color: 0, x: 2, y: 0 },
    ];
    for (const b of bad) expect(parseCanvasEvent(b)).toBeNull();
  });
});

describe('rankPlayers', () => {
  it('orders by score and lets equal scores share a place', () => {
    const ranked = rankPlayers([
      { name: 'a', score: 100 },
      { name: 'b', score: 300 },
      { name: 'c', score: 300 },
      { name: 'd', score: 0 },
    ]);
    expect(ranked.map((r) => [r.player.name, r.place])).toEqual([
      ['b', 1],
      ['c', 1],
      ['a', 3],
      ['d', 4],
    ]);
  });

  it('copes with an empty room', () => {
    expect(rankPlayers([])).toEqual([]);
  });
});
