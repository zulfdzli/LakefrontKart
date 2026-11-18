/** The six original characters. Every character has 15 stat points (section 2.1). */

export type CharacterKind = 'bear' | 'penguin' | 'robot' | 'fox' | 'frog' | 'owl';

export interface CharacterStats {
  speed: number;
  accel: number;
  handling: number;
  weight: number;
  drift: number;
}

export interface Character {
  id: string;
  name: string;
  kind: CharacterKind;
  emoji: string;
  /** Prototype kart colour. Karts are painted in the slot colour instead (D11); this stays as the character's theme colour. */
  kart: number;
  accent: number;
  fur: number;
  belly: number;
  stats: CharacterStats;
}

export const CHARS: readonly Character[] = [
  {
    id: 'bruno',
    name: 'Bruno',
    kind: 'bear',
    emoji: '🐻',
    kart: 0xe53935,
    accent: 0xffca28,
    fur: 0x9a6340,
    belly: 0xe8c39e,
    stats: { speed: 4, accel: 2, handling: 2, weight: 5, drift: 2 },
  },
  {
    id: 'pip',
    name: 'Pip',
    kind: 'penguin',
    emoji: '🐧',
    kart: 0x1e88e5,
    accent: 0xffffff,
    fur: 0x2b3245,
    belly: 0xffffff,
    stats: { speed: 3, accel: 3, handling: 3, weight: 3, drift: 3 },
  },
  {
    id: 'zed',
    name: 'Zed',
    kind: 'robot',
    emoji: '🤖',
    kart: 0xfdd835,
    accent: 0x37474f,
    fur: 0xb0bec5,
    belly: 0x78909c,
    stats: { speed: 5, accel: 2, handling: 2, weight: 4, drift: 2 },
  },
  {
    id: 'mochi',
    name: 'Mochi',
    kind: 'fox',
    emoji: '🦊',
    kart: 0x8e24aa,
    accent: 0xffffff,
    fur: 0xf57c00,
    belly: 0xfff3e0,
    stats: { speed: 2, accel: 3, handling: 5, weight: 2, drift: 3 },
  },
  {
    id: 'gus',
    name: 'Gus',
    kind: 'frog',
    emoji: '🐸',
    kart: 0x00acc1,
    accent: 0xffeb3b,
    fur: 0x7cb342,
    belly: 0xdcedc8,
    stats: { speed: 2, accel: 5, handling: 3, weight: 2, drift: 3 },
  },
  {
    id: 'luna',
    name: 'Luna',
    kind: 'owl',
    emoji: '🦉',
    kart: 0xec407a,
    accent: 0xfff59d,
    fur: 0x7e57c2,
    belly: 0xd1c4e9,
    stats: { speed: 3, accel: 3, handling: 3, weight: 1, drift: 5 },
  },
];

export interface CharacterParams {
  /** Top speed (m/s). */
  top: number;
  /** Acceleration (m/s²) at standstill. */
  acc: number;
  /** Turn-rate multiplier. */
  turn: number;
  /** Collision mass. */
  mass: number;
  /** Drift charge-rate multiplier. */
  driftRate: number;
}

export function charParams(c: Character): CharacterParams {
  const s = c.stats;
  return {
    top: 35.4 + s.speed * 0.8,
    acc: 19 + s.accel * 3.2,
    turn: 0.86 + s.handling * 0.055,
    mass: 0.7 + s.weight * 0.12,
    driftRate: 0.82 + s.drift * 0.08,
  };
}

export function charIndex(id: string): number {
  return CHARS.findIndex((c) => c.id === id);
}
