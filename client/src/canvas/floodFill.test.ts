import { describe, expect, it } from 'vitest';
import { floodFill } from './floodFill';

function grid(rows: string[]) {
  const h = rows.length;
  const w = rows[0]!.length;
  const data = new Uint8ClampedArray(w * h * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const v = ch === '#' ? 0 : 255;
      data.set([v, v, v, 255], (y * w + x) * 4);
    }),
  );
  return { data, w, h };
}

const red = (data: Uint8ClampedArray, w: number, x: number, y: number) =>
  data[(y * w + x) * 4] === 255 && data[(y * w + x) * 4 + 1] === 0;

describe('floodFill', () => {
  it('fills only the enclosed area', () => {
    const { data, w, h } = grid(['.....', '.###.', '.#.#.', '.###.', '.....']);
    const painted = floodFill(data, w, h, 2, 2, [255, 0, 0]);
    expect(painted).toBe(1);
    expect(red(data, w, 2, 2)).toBe(true);
    expect(red(data, w, 0, 0)).toBe(false);
  });

  it('fills the outside up to the wall', () => {
    const { data, w, h } = grid(['.....', '.###.', '.#.#.', '.###.', '.....']);
    expect(floodFill(data, w, h, 0, 0, [255, 0, 0])).toBe(25 - 8 - 1);
    expect(red(data, w, 2, 2)).toBe(false);
  });

  it('does nothing when the area already has that colour', () => {
    const { data, w, h } = grid(['...', '...']);
    floodFill(data, w, h, 0, 0, [255, 0, 0]);
    expect(floodFill(data, w, h, 1, 1, [255, 0, 0])).toBe(0);
  });

  it('swallows near-white anti-alias fringe', () => {
    const { data, w, h } = grid(['...', '...']);
    data.set([240, 240, 240, 255], 4);
    floodFill(data, w, h, 0, 0, [255, 0, 0]);
    expect(red(data, w, 1, 0)).toBe(true);
  });
});
