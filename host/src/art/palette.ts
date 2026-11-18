/**
 * Every colour the art uses, by name (section 10.1). One Theme per track (phase 8); the art pass (phase 10)
 * refines them.
 */
import { AI_COLOR, SLOT_COLORS } from '@tk/shared';

const hex = (s: string): number => parseInt(s.slice(1), 16);

export const SLOT_HEX: readonly number[] = SLOT_COLORS.map(hex);
export const AI_HEX = hex(AI_COLOR);

/** Kart body paint: slot colour for humans, orange for AI (D11). */
export const kartPaint = (slot: number | null): number => (slot === null ? AI_HEX : (SLOT_HEX[slot] ?? AI_HEX));

export const INK = 0x1d1b2e;
export const DARK = 0x2b2d42;
export const METAL = 0xcfd8dc;
export const WHITE = 0xffffff;

/** Per-track look (phase 8): sky, light, ground and props. Meadows keeps the prototype's colours exactly. */
export interface Theme {
  id: 'meadows' | 'canyon' | 'frosty';
  horizon: number;
  zenith: number;
  sunLight: number;
  hemiSky: number;
  hemiGround: number;
  sunGlow: readonly [number, number, number];
  /** Light intensities before the legacy π scale. */
  sun: number;
  hemi: number;
  /** Direction towards the sun (normalised by the renderer). */
  sunDir: readonly [number, number, number];
  road: string;
  kerbRed: string;
  kerbWhite: string;
  wallA: string;
  wallB: string;
  grassA: string;
  grassB: string;
  grassTerrain: readonly number[];
  sandWet: number;
  sandDry: number;
  snow: number;
  rock: readonly number[];
  water: number;
  waterOpacity: number;
  mountain: readonly number[];
  mountainMid: number;
  mountainSnow: number;
  /** Mountain silhouettes: pointed peaks or flat-topped mesas. */
  mountains: 'peak' | 'mesa';
  /** Surface patch colours (gravel traps, shortcuts, ice). */
  surf: Readonly<Record<'gravel' | 'dirt' | 'sand' | 'ice' | 'snow' | 'grass', number>>;
  boostPad: string;
  boostPadDark: string;
}

export const MEADOWS: Theme = {
  id: 'meadows',
  horizon: 0xcdeeff,
  zenith: 0x4ea7ea,
  sunLight: 0xfff1d6,
  hemiSky: 0xeaf6ff,
  hemiGround: 0x7da35c,
  sunGlow: [1.0, 0.95, 0.78],
  sun: 0.82,
  hemi: 0.62,
  sunDir: [0.42, 0.78, 0.46],
  road: '#585d6b',
  kerbRed: '#ef3b3b',
  kerbWhite: '#fafafa',
  wallA: '#fafafa',
  wallB: '#ef3b3b',
  grassA: '#7ccb4f',
  grassB: '#70bf45',
  grassTerrain: [0x82d055, 0x78c74c, 0x8dd860, 0x70bd45, 0x67b33f],
  sandWet: 0xcdb97c,
  sandDry: 0xead89c,
  snow: 0xf3f6ff,
  rock: [0xa293b5, 0x9284a6, 0xad9fc0],
  water: 0x4fc3f7,
  waterOpacity: 0.88,
  mountain: [0x9a8db0, 0x8f82a6, 0xa497b9],
  mountainMid: 0xb2a7c6,
  mountainSnow: 0xf5f7ff,
  mountains: 'peak',
  surf: { gravel: 0xc9bfae, dirt: 0xa77b52, sand: 0xe6cf98, ice: 0xcfeeff, snow: 0xf3f6ff, grass: 0x7ccb4f },
  boostPad: '#00e5ff',
  boostPadDark: '#00838f',
};

/** Dusty Canyon: warm sand, red rock and flat-topped mesas under a hazy sky. */
export const CANYON: Theme = {
  ...MEADOWS,
  id: 'canyon',
  horizon: 0xf7dfbd,
  zenith: 0x4f95d6,
  sunLight: 0xffe3bd,
  hemiSky: 0xfff1de,
  hemiGround: 0xc8915c,
  sunGlow: [1.0, 0.9, 0.7],
  sun: 0.86,
  hemi: 0.6,
  sunDir: [0.5, 0.72, 0.3],
  road: '#6a6362',
  wallA: '#f4e6d0',
  wallB: '#c0552f',
  grassA: '#dcaa70',
  grassB: '#d29e64',
  grassTerrain: [0xe2ae70, 0xd9a266, 0xe9ba7c, 0xd0975b, 0xc88e52],
  sandWet: 0xb98552,
  sandDry: 0xebc690,
  snow: 0xe7b47c,
  rock: [0xb9673f, 0xad5d39, 0xc4724a],
  water: 0x3aa6b9,
  mountain: [0xc06e40, 0xb3643a, 0xcb7a4a],
  mountainMid: 0xd88f5a,
  mountainSnow: 0xe9b47d,
  mountains: 'mesa',
  surf: { gravel: 0xcdb8a0, dirt: 0xa7703f, sand: 0xe9c48c, ice: 0xcfeeff, snow: 0xf3f6ff, grass: 0xb5b061 },
};

/** Frosty Peaks: twilight snow, blue shadows, a frozen lake and pink sky. */
export const FROSTY: Theme = {
  ...MEADOWS,
  id: 'frosty',
  horizon: 0xf3c0b4,
  zenith: 0x2c3577,
  sunLight: 0xffc8a0,
  hemiSky: 0xa8b8ec,
  hemiGround: 0xc5d2ee,
  sunGlow: [1.0, 0.72, 0.52],
  sun: 0.62,
  hemi: 0.62,
  sunDir: [-0.55, 0.32, 0.62],
  road: '#5b6070',
  wallA: '#f4f7ff',
  wallB: '#3f6fd8',
  grassA: '#eef3fb',
  grassB: '#e3e9f6',
  grassTerrain: [0xf2f6fd, 0xe7eef9, 0xf8fafe, 0xdee7f5, 0xd4def0],
  sandWet: 0xa9c2e2,
  sandDry: 0xe1eaf7,
  snow: 0xffffff,
  rock: [0x7d88a8, 0x717c9c, 0x8a95b5],
  water: 0xcbe9f7,
  waterOpacity: 1,
  mountain: [0x6d78a2, 0x646f99, 0x7883ab],
  mountainMid: 0x98a3c9,
  mountainSnow: 0xffffff,
  mountains: 'peak',
  surf: { gravel: 0xb8bfcc, dirt: 0x8a7a70, sand: 0xd8d0c0, ice: 0xbfe6fb, snow: 0xffffff, grass: 0xc9d9c0 },
};

export const THEMES = { meadows: MEADOWS, canyon: CANYON, frosty: FROSTY } as const;

/** Drift spark colours per tier (0 = not charged yet). */
export const DRIFT_COL = [0xfff3b0, 0x4fc3f7, 0xffa726, 0xe040fb] as const;
export const CONFETTI = [0xff5252, 0xffeb3b, 0x40c4ff, 0x69f0ae, 0xe040fb] as const;
