/**
 * Every colour the art uses, by name (section 10.1). Phase 4 holds the prototype's Sunny Meadows look;
 * the art pass (phase 10) adds a swatch set per theme.
 */
import { AI_COLOR, SLOT_COLORS } from '@tk/shared';

const hex = (s: string): number => parseInt(s.slice(1), 16);

export const SLOT_HEX: readonly number[] = SLOT_COLORS.map(hex);
export const AI_HEX = hex(AI_COLOR);

/** Kart body paint: slot colour for humans, orange for AI (D11). */
export const kartPaint = (slot: number | null): number => (slot === null ? AI_HEX : SLOT_HEX[slot] ?? AI_HEX);

export const INK = 0x1d1b2e;
export const DARK = 0x2b2d42;
export const METAL = 0xcfd8dc;
export const WHITE = 0xffffff;

export const MEADOWS = {
  horizon: 0xcdeeff,
  zenith: 0x4ea7ea,
  sunLight: 0xfff1d6,
  hemiSky: 0xeaf6ff,
  hemiGround: 0x7da35c,
  sunGlow: [1.0, 0.95, 0.78] as const,
  road: '#585d6b',
  kerbRed: '#ef3b3b',
  kerbWhite: '#fafafa',
  grassA: '#7ccb4f',
  grassB: '#70bf45',
  grassTerrain: [0x82d055, 0x78c74c, 0x8dd860, 0x70bd45, 0x67b33f],
  sandWet: 0xcdb97c,
  sandDry: 0xead89c,
  snow: 0xf3f6ff,
  rock: [0xa293b5, 0x9284a6, 0xad9fc0],
  water: 0x4fc3f7,
  mountain: [0x9a8db0, 0x8f82a6, 0xa497b9],
  mountainMid: 0xb2a7c6,
  mountainSnow: 0xf5f7ff,
  boostPad: '#00e5ff',
  boostPadDark: '#00838f',
};

/** Drift spark colours per tier (0 = not charged yet). */
export const DRIFT_COL = [0xfff3b0, 0x4fc3f7, 0xffa726, 0xe040fb] as const;
export const CONFETTI = [0xff5252, 0xffeb3b, 0x40c4ff, 0x69f0ae, 0xe040fb] as const;
