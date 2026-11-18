/** Split-screen layouts (section 6.2 table and section 15 check 3). */
import { describe, expect, it } from 'vitest';
import { GUTTER, splitLayout } from '../host/src/layout';
import type { Rect } from '../host/src/renderer';

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (r: Rect, W: number, H: number): boolean => r.x >= 0 && r.y >= 0 && r.x + r.w <= W && r.y + r.h <= H;

describe('splitLayout', () => {
  for (const [W, H] of [
    [1920, 1080],
    [1600, 900],
    [1366, 768],
  ] as const) {
    it(`${W}x${H}: every count fits the screen, without overlaps, with equal-size views`, () => {
      for (let n = 1; n <= 5; n++) {
        const L = splitLayout(n, W, H);
        expect(L.views).toHaveLength(n);
        const all = [...L.views, ...L.spare];
        for (const r of all) expect(inside(r, W, H)).toBe(true);
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++) expect(overlaps(all[i]!, all[j]!)).toBe(false);
        // every view in a layout has the same size (to the pixel), so no player gets a stretched or smaller view
        for (const r of L.views) {
          expect(Math.abs(r.w - L.views[0]!.w)).toBeLessThanOrEqual(1);
          expect(Math.abs(r.h - L.views[0]!.h)).toBeLessThanOrEqual(1);
        }
      }
    });
  }

  it('matches the section 6.2 table at 1920x1080', () => {
    const W = 1920,
      H = 1080;
    expect(splitLayout(1, W, H).views[0]).toEqual({ x: 0, y: 0, w: W, h: H });
    // 2: side by side, full height
    const two = splitLayout(2, W, H).views;
    expect(two.every((r) => r.h === H && r.y === 0)).toBe(true);
    expect(two[1]!.x - (two[0]!.x + two[0]!.w)).toBe(GUTTER);
    // 3: two on top, one centred below at the same size; the gaps hold the shared panel
    const three = splitLayout(3, W, H);
    expect(three.views[2]!.x + three.views[2]!.w / 2).toBeCloseTo(W / 2, 0);
    expect(three.spare).toHaveLength(2);
    // 4: 2 x 2
    const four = splitLayout(4, W, H).views;
    expect(new Set(four.map((r) => r.x)).size).toBe(2);
    expect(new Set(four.map((r) => r.y)).size).toBe(2);
    // 5: three on top, two centred below; the gaps hold the shared panel
    const five = splitLayout(5, W, H);
    expect(five.views.slice(0, 3).every((r) => r.y === 0)).toBe(true);
    const b = five.views.slice(3);
    expect((b[0]!.x + b[1]!.x + b[1]!.w) / 2).toBeCloseTo(W / 2, 0);
    expect(five.spare).toHaveLength(2);
    expect(five.spare.every((r) => r.w > 250)).toBe(true);
  });
});
