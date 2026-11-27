/**
 * D72 phone garage: each player styles their kart (paint, accent, livery, number, sticker, rims) and tunes it.
 * Tuning moves up to two of the character's stat points between top speed, acceleration and handling: every point
 * added is taken from another, so a setup changes how the kart drives, not how fast it is overall (the same budget
 * the characters are balanced on, section 2.1). The phone keeps the setup; the server checks it; the host draws it.
 */
import { SLOT_COLORS } from './protocol';
import type { Character } from './characters';

/** Body and accent colours. No orange: that is the AI karts' colour (D11). */
export const PAINTS = [
  '#e53935',
  '#1e88e5',
  '#fdd835',
  '#43a047',
  '#8e24aa',
  '#00bcd4',
  '#ec407a',
  '#c6ff00',
  '#00897b',
  '#283593',
  '#263238',
  '#eceff1',
] as const;
export const LIVERIES = ['neon', 'stripes', 'flames', 'checker', 'camo', 'pinstripe'] as const;
export type Livery = (typeof LIVERIES)[number];
export const LIVERY_NAME: Readonly<Record<Livery, string>> = {
  neon: 'Neon',
  stripes: 'Stripes',
  flames: 'Flames',
  checker: 'Checker',
  camo: 'Camo',
  pinstripe: 'Pinstripe',
};
export const STICKERS = ['none', 'star', 'bolt', 'skull', 'heart', 'crown', 'paw'] as const;
export type Sticker = (typeof STICKERS)[number];
export const STICKER_GLYPH: Readonly<Record<Sticker, string>> = {
  none: '',
  star: '⭐',
  bolt: '⚡',
  skull: '💀',
  heart: '❤️',
  crown: '👑',
  paw: '🐾',
};
/** Rim colours: dark (standard), silver, gold, red, white. */
export const RIMS = ['#2e3036', '#cfd8dc', '#ffc107', '#e53935', '#f5f5f5'] as const;

/** Stat points moved: each −2..+2, adding up to 0. */
export interface Tune {
  speed: number;
  accel: number;
  handling: number;
}
export const TUNE_KEYS = ['speed', 'accel', 'handling'] as const;
export const TUNE_MAX = 2;
export const TUNE_NAME: Readonly<Record<keyof Tune, string>> = {
  speed: 'Top speed',
  accel: 'Acceleration',
  handling: 'Handling',
};

export interface KartSetup {
  /** Index into PAINTS. */
  paint: number;
  accent: number;
  livery: Livery;
  /** Race number, 0 to 99. */
  num: number;
  sticker: Sticker;
  /** Index into RIMS. */
  rims: number;
  tune: Tune;
}

const NEUTRAL_TUNE: Tune = { speed: 0, accel: 0, handling: 0 };

/** A player's setup before they open the garage: their slot colour, the neon livery and their slot number. */
export function defaultSetup(slot: number): KartSetup {
  const c = SLOT_COLORS[slot] ?? SLOT_COLORS[0];
  const paint = Math.max(0, (PAINTS as readonly string[]).indexOf(c));
  return {
    paint,
    accent: PAINTS.indexOf('#eceff1'),
    livery: 'neon',
    num: slot + 1,
    sticker: 'none',
    rims: 0,
    tune: { ...NEUTRAL_TUNE },
  };
}

const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

/** A setup from the network or storage, or null if it is not a valid one. */
export function cleanSetup(raw: unknown): KartSetup | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const paint = int(o.paint, 0, PAINTS.length - 1),
    accent = int(o.accent, 0, PAINTS.length - 1),
    num = int(o.num, 0, 99),
    rims = int(o.rims, 0, RIMS.length - 1);
  const livery = (LIVERIES as readonly unknown[]).includes(o.livery) ? (o.livery as Livery) : null;
  const sticker = (STICKERS as readonly unknown[]).includes(o.sticker) ? (o.sticker as Sticker) : null;
  const t = (typeof o.tune === 'object' && o.tune !== null ? o.tune : {}) as Record<string, unknown>;
  const tune: Tune = { speed: 0, accel: 0, handling: 0 };
  for (const k of TUNE_KEYS) {
    const v = int(t[k], -TUNE_MAX, TUNE_MAX);
    if (v === null) return null;
    tune[k] = v;
  }
  if (tune.speed + tune.accel + tune.handling !== 0) return null;
  if (paint === null || accent === null || num === null || rims === null || !livery || !sticker) return null;
  return { paint, accent, livery, num, sticker, rims, tune };
}

/** Points still to place (positive) or over-spent (negative): a valid tune has 0. */
export const tuneBalance = (t: Tune): number => -(t.speed + t.accel + t.handling);

/**
 * How many character stat points one tuning point moves, per stat. D76: with no boosts, cornering decides a lap, so a
 * handling point was worth far more than the others (a tune trading handling away lost up to 4.4%); weighting the
 * points keeps every tune within the 4% spread again.
 */
export const TUNE_WEIGHT: Readonly<Record<keyof Tune, number>> = { speed: 1, accel: 1.5, handling: 0.4 };

/** The character with its stats shifted by the tune (a new object; the character list is untouched). */
export function tunedCharacter(ch: Character, t: Tune | undefined): Character {
  if (!t || (t.speed === 0 && t.accel === 0 && t.handling === 0)) return ch;
  const s = ch.stats,
    W = TUNE_WEIGHT;
  return {
    ...ch,
    stats: {
      ...s,
      speed: Math.max(0, s.speed + t.speed * W.speed),
      accel: Math.max(0, s.accel + t.accel * W.accel),
      handling: Math.max(0, s.handling + t.handling * W.handling),
    },
  };
}
