/**
 * Split-screen layouts for a landscape host display (section 6.2), as rectangles in CSS pixels with a
 * top-left origin. A 4 px gutter separates viewports.
 *
 * For 3 and 5 players the bottom row is centred, which leaves a gap on each side: `spare[0]` (left) holds the
 * shared minimap and `spare[1]` (right) the live standings. Together they are the "empty quarter" of the table.
 */
import type { Rect } from './renderer';

export const GUTTER = 4;

export interface SplitLayout {
  views: Rect[];
  /** [left gap, right gap] for 3 and 5 players; empty otherwise. */
  spare: Rect[];
}

export function splitLayout(players: number, W: number, H: number): SplitLayout {
  const g = GUTTER,
    half = g / 2;
  const cell = (x: number, y: number, w: number, h: number): Rect => ({
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  });
  const gaps = (rowY: number, rowH: number, left: number, right: number): Rect[] => [
    cell(0, rowY, left - g, rowH),
    cell(right + g, rowY, W - right - g, rowH),
  ];
  switch (players) {
    case 0:
    case 1:
      return { views: [cell(0, 0, W, H)], spare: [] };
    case 2: {
      const w = W / 2 - half;
      return { views: [cell(0, 0, w, H), cell(W / 2 + half, 0, w, H)], spare: [] };
    }
    case 3: {
      const w = W / 2 - half,
        h = H / 2 - half,
        y = H / 2 + half;
      const bx = (W - w) / 2;
      return {
        views: [cell(0, 0, w, h), cell(W / 2 + half, 0, w, h), cell(bx, y, w, h)],
        spare: gaps(y, h, bx, bx + w),
      };
    }
    case 4: {
      const w = W / 2 - half,
        h = H / 2 - half;
      return {
        views: [
          cell(0, 0, w, h),
          cell(W / 2 + half, 0, w, h),
          cell(0, H / 2 + half, w, h),
          cell(W / 2 + half, H / 2 + half, w, h),
        ],
        spare: [],
      };
    }
    default: {
      const w = (W - 2 * g) / 3,
        h = H / 2 - half,
        y = H / 2 + half;
      const bx = (W - (2 * w + g)) / 2;
      return {
        views: [
          cell(0, 0, w, h),
          cell(w + g, 0, w, h),
          cell(2 * (w + g), 0, w, h),
          cell(bx, y, w, h),
          cell(bx + w + g, y, w, h),
        ],
        spare: gaps(y, h, bx, bx + 2 * w + g),
      };
    }
  }
}
