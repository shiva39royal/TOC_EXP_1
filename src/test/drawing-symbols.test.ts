import { describe, expect, it } from 'vitest';
import { analyzeTileSymbols } from '@/engine/drawingSymbols';

function blank(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const set = (x: number, y: number, rgb: [number, number, number]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = (Math.round(y) * width + Math.round(x)) * 4;
    data[p] = rgb[0]; data[p + 1] = rgb[1]; data[p + 2] = rgb[2];
  };
  return { image: { width, height, data }, set };
}

describe('drawing symbol detection', () => {
  it('finds a thick running line and a row of two signal-head circles', () => {
    const { image, set } = blank(600, 300);
    for (let y = 200; y < 210; y += 1) for (let x = 20; x < 580; x += 1) set(x, y, [240, 140, 30]);
    for (const cx of [300, 330]) {
      for (let a = 0; a < 720; a += 1) {
        const t = (a / 720) * Math.PI * 2;
        set(cx + 14 * Math.cos(t), 100 + 14 * Math.sin(t), [0, 0, 0]);
        set(cx + 15 * Math.cos(t), 100 + 15 * Math.sin(t), [0, 0, 0]);
      }
    }
    const { bands, chains } = analyzeTileSymbols(image, 24);
    expect(bands.some((band) => Math.abs(band.y - 204.5) < 2 && band.x1 - band.x0 > 500)).toBe(true);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.rings).toHaveLength(2);
  });

  it('does not report circles on a plain line drawing', () => {
    const { image, set } = blank(400, 200);
    for (let x = 10; x < 390; x += 1) set(x, 100, [0, 0, 0]);
    for (let y = 20; y < 180; y += 1) set(200, y, [0, 0, 0]);
    expect(analyzeTileSymbols(image, 24).chains).toEqual([]);
  });
});
