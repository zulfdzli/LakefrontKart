/** Item definitions and the position-weighted item roll. Ported from the prototype; phase 11 adds the two new items. */
import type { Rng } from './rng';

export type ItemId = 'turbo' | 'turbo3' | 'oil' | 'orb' | 'bolt' | 'shield';

/** Roll order matters for determinism: keep it identical to the prototype. */
export const ITEMS: readonly ItemId[] = ['turbo', 'turbo3', 'oil', 'orb', 'bolt', 'shield'];

export const ITEM_NAMES: Record<ItemId, string> = {
  turbo: 'Turbo',
  turbo3: 'Triple Turbo',
  oil: 'Oil Slick',
  orb: 'Homing Orb',
  bolt: 'Bounce Disc',
  shield: 'Shield',
};

/** Weights per race position (index 0 = 1st). */
const WEIGHTS: Record<ItemId, readonly number[]> = {
  oil: [40, 30, 20, 12, 8, 5],
  turbo: [20, 25, 25, 25, 20, 15],
  turbo3: [0, 5, 10, 15, 22, 30],
  orb: [5, 15, 20, 25, 25, 25],
  bolt: [20, 15, 15, 13, 12, 10],
  shield: [15, 10, 10, 10, 13, 15],
};

export function chooseItem(rank: number, rng: Rng): ItemId {
  const r6 = Math.min(5, Math.max(0, rank));
  let tot = 0;
  for (const it of ITEMS) tot += WEIGHTS[it][r6]!;
  let r = rng.next() * tot;
  for (const it of ITEMS) {
    if ((r -= WEIGHTS[it][r6]!) < 0) return it;
  }
  return 'turbo';
}
