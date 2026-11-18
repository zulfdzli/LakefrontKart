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
  id: 'meadows' | 'canyon' | 'frosty' | 'tropical';
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
  /** D45 cinematic look: post-processing fog, flare and grade (host/src/post.ts). */
  look: ThemeLook;
}

/** Plain-number version of PostLook, so palettes stay data. */
export interface ThemeLook {
  exposure: number;
  fogColor: number;
  fogDensity: number;
  fogFalloff: number;
  fogBase: number;
  mist: number;
  sunColor: number;
  scatter: number;
  flare: number;
  lift: readonly [number, number, number];
  gamma: readonly [number, number, number];
  gain: readonly [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  grain: number;
  bloom: number;
}

export const MEADOWS: Theme = {
  id: 'meadows',
  // golden late afternoon: a low warm sun, long shadows, a hazy warm horizon
  horizon: 0xf3e2c4,
  zenith: 0x3f8edc,
  sunLight: 0xffd29a,
  hemiSky: 0xcfe4ff,
  hemiGround: 0x6f8f4a,
  sunGlow: [1.0, 0.86, 0.6],
  sun: 1.15,
  hemi: 0.5,
  sunDir: [0.62, 0.36, 0.7],
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
  look: {
    exposure: 1.05,
    fogColor: 0xe9dcc4,
    fogDensity: 0.0005,
    fogFalloff: 0.011,
    fogBase: 0,
    mist: 0.002,
    sunColor: 0xffc27a,
    scatter: 0.6,
    flare: 0.55,
    lift: [0.006, 0.01, 0.022],
    gamma: [1.0, 1.0, 0.98],
    gain: [1.06, 1.0, 0.92],
    saturation: 1.18,
    contrast: 1.1,
    vignette: 0.3,
    grain: 0.028,
    bloom: 0.42,
  },
};

/** Dusty Canyon: warm sand, red rock and flat-topped mesas under a hazy sky. */
export const CANYON: Theme = {
  ...MEADOWS,
  id: 'canyon',
  // blazing high-desert sun with lens flare, dusty orange haze low down
  horizon: 0xf6dcb4,
  zenith: 0x3a86d4,
  sunLight: 0xfff0d8,
  hemiSky: 0xd9ecff,
  hemiGround: 0xc0804a,
  sunGlow: [1.0, 0.95, 0.85],
  sun: 1.3,
  hemi: 0.5,
  sunDir: [0.55, 0.52, -0.66],
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
  look: {
    exposure: 1.0,
    fogColor: 0xe6c49a,
    fogDensity: 0.0006,
    fogFalloff: 0.02,
    fogBase: 0,
    mist: 0.004,
    sunColor: 0xfff1d0,
    scatter: 1.1,
    flare: 1.0,
    lift: [0.02, 0.012, 0.004],
    gamma: [1.0, 1.0, 0.97],
    gain: [1.08, 1.0, 0.88],
    saturation: 1.2,
    contrast: 1.12,
    vignette: 0.32,
    grain: 0.03,
    bloom: 0.45,
  },
};

/** Frosty Peaks: twilight snow, blue shadows, a frozen lake and pink sky. */
export const FROSTY: Theme = {
  ...MEADOWS,
  id: 'frosty',
  // misty sunset twilight: a low pink-orange sun, blue snow shadows, glowing wet asphalt
  horizon: 0xf6b9a2,
  zenith: 0x2a3474,
  sunLight: 0xffb486,
  hemiSky: 0x9fb2ea,
  hemiGround: 0xc9d5f0,
  sunGlow: [1.0, 0.68, 0.45],
  sun: 0.95,
  hemi: 0.62,
  sunDir: [-0.55, 0.2, 0.74],
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
  look: {
    exposure: 1.05,
    fogColor: 0xd9b8c4,
    fogDensity: 0.0008,
    fogFalloff: 0.014,
    fogBase: 0,
    mist: 0.006,
    sunColor: 0xffa678,
    scatter: 1.25,
    flare: 0.75,
    lift: [0.012, 0.014, 0.04],
    gamma: [1.0, 0.99, 1.0],
    gain: [1.05, 0.98, 1.0],
    saturation: 1.1,
    contrast: 1.08,
    vignette: 0.34,
    grain: 0.03,
    bloom: 0.5,
  },
};

/** Sepang Circuit: humid tropical afternoon, lush grass, palm trees, hazy hills. */
export const TROPICAL: Theme = {
  ...MEADOWS,
  id: 'tropical',
  // fog-kissed rolling hills: soft humid light, mist pooling in the valleys
  horizon: 0xe2ece8,
  zenith: 0x5a9ad6,
  sunLight: 0xfff0d4,
  hemiSky: 0xe4f0ee,
  hemiGround: 0x4f8a3e,
  sunGlow: [1.0, 0.95, 0.82],
  sun: 1.0,
  hemi: 0.58,
  sunDir: [0.4, 0.62, 0.62],
  road: '#4f535c',
  wallA: '#f5f5f5',
  wallB: '#1e88e5',
  grassA: '#5fbf44',
  grassB: '#55b33c',
  grassTerrain: [0x5cba42, 0x52af3a, 0x66c44b, 0x4aa634, 0x43992f],
  // no snow in the tropics: the highest ground stays green, rock is a mossy grey
  snow: 0x4f9a52,
  rock: [0x6f8a66, 0x657f5d, 0x7a9670],
  mountain: [0x5d8a6a, 0x557f62, 0x679574],
  mountainMid: 0x76a283,
  mountainSnow: 0x8fb89a,
  surf: { gravel: 0xd6c9b0, dirt: 0x9a6b45, sand: 0xe8d6a8, ice: 0xcfeeff, snow: 0xf3f6ff, grass: 0x5fbf44 },
  look: {
    exposure: 1.05,
    fogColor: 0xdfe7e4,
    fogDensity: 0.0009,
    fogFalloff: 0.01,
    fogBase: 0,
    mist: 0.008,
    sunColor: 0xfff0cc,
    scatter: 0.6,
    flare: 0.35,
    lift: [0.004, 0.012, 0.012],
    gamma: [1.0, 1.02, 1.0],
    gain: [1.0, 1.03, 0.97],
    saturation: 1.14,
    contrast: 1.07,
    vignette: 0.3,
    grain: 0.026,
    bloom: 0.4,
  },
};

export const THEMES = { meadows: MEADOWS, canyon: CANYON, frosty: FROSTY, tropical: TROPICAL } as const;

/** Drift spark colours per tier (0 = not charged yet). */
export const DRIFT_COL = [0xfff3b0, 0x4fc3f7, 0xffa726, 0xe040fb] as const;
export const CONFETTI = [0xff5252, 0xffeb3b, 0x40c4ff, 0x69f0ae, 0xe040fb] as const;
