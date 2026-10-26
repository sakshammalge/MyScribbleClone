/** Largest per-channel difference from the clicked colour that still counts as "the same area". */
const TOLERANCE = 36;

/**
 * Scanline flood fill over RGBA pixels, in place. The tolerance swallows the soft anti-aliased
 * edge of a pen line so fills do not leave a halo. Returns how many pixels were painted.
 */
export function floodFill(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  startX: number,
  startY: number,
  [fr, fg, fb]: [number, number, number],
): number {
  const sx = Math.min(width - 1, Math.max(0, Math.floor(startX)));
  const sy = Math.min(height - 1, Math.max(0, Math.floor(startY)));
  const at = (x: number, y: number) => (y * width + x) * 4;
  const seed = at(sx, sy);
  const tr = data[seed]!;
  const tg = data[seed + 1]!;
  const tb = data[seed + 2]!;
  if (tr === fr && tg === fg && tb === fb) return 0;

  const near = (i: number) =>
    Math.abs(data[i]! - tr) <= TOLERANCE &&
    Math.abs(data[i + 1]! - tg) <= TOLERANCE &&
    Math.abs(data[i + 2]! - tb) <= TOLERANCE;

  const seen = new Uint8Array(width * height);
  const stack: number[] = [sx, sy];
  let painted = 0;

  while (stack.length) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    while (x >= 0 && !seen[y * width + x] && near(at(x, y))) x--;
    x++;
    let above = false;
    let below = false;
    while (x < width && !seen[y * width + x] && near(at(x, y))) {
      seen[y * width + x] = 1;
      const i = at(x, y);
      data[i] = fr;
      data[i + 1] = fg;
      data[i + 2] = fb;
      data[i + 3] = 255;
      painted++;
      if (y > 0) {
        const open = !seen[(y - 1) * width + x] && near(at(x, y - 1));
        if (open && !above) stack.push(x, y - 1);
        above = open;
      }
      if (y < height - 1) {
        const open = !seen[(y + 1) * width + x] && near(at(x, y + 1));
        if (open && !below) stack.push(x, y + 1);
        below = open;
      }
      x++;
    }
  }
  return painted;
}
