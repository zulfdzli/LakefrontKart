/**
 * Item definitions and the position-weighted item roll (section 12.3, D8).
 *
 * The prototype's 6 items keep their exact weights and roll order when no context is given (the parity test).
 * With a context (phase 11), two catch-up items join: Rocket Booster (only the last 2 positions) and Seeker Comet
 * (rare, 4th place and below, never on lap 1, at most one in flight).
 *
 * Fairness: the roll depends only on race position and lap, never on whether the kart is AI or human, so the AI
 * never gets better items than a human in the same position.
 */
import type { Rng } from './rng';

export type ItemId = 'turbo' | 'turbo3' | 'oil' | 'orb' | 'bolt' | 'shield' | 'rocket' | 'comet';

/** Roll order matters for determinism: keep it identical to the prototype. */
export const ITEMS = ['turbo', 'turbo3', 'oil', 'orb', 'bolt', 'shield'] as const satisfies readonly ItemId[];

export const ITEM_NAMES: Record<ItemId, string> = {
  turbo: 'Turbo',
  turbo3: 'Triple Turbo',
  oil: 'Oil Slick',
  orb: 'Homing Orb',
  bolt: 'Bounce Disc',
  shield: 'Shield',
  rocket: 'Rocket Booster',
  comet: 'Seeker Comet',
};

/** Weights per race position (index 0 = 1st). */
const WEIGHTS: Record<(typeof ITEMS)[number], readonly number[]> = {
  oil: [40, 30, 20, 12, 8, 5],
  turbo: [20, 25, 25, 25, 20, 15],
  turbo3: [0, 5, 10, 15, 22, 30],
  orb: [5, 15, 20, 25, 25, 25],
  bolt: [20, 15, 15, 13, 12, 10],
  shield: [15, 10, 10, 10, 13, 15],
};

/** Extra context for the full 8-item roll. */
export interface ItemContext {
  /** Karts in the race. */
  total: number;
  /** The kart's current lap (1 = first lap). */
  lap: number;
  /** A Seeker Comet is already in flight (only one at a time). */
  cometActive: boolean;
}

export function chooseItem(rank: number, rng: Rng, ctx?: ItemContext): ItemId {
  const r6 = Math.min(5, Math.max(0, rank));
  const extra: [ItemId, number][] = [];
  if (ctx) {
    const fromLast = ctx.total - 1 - rank; // 0 = last place
    if (fromLast <= 1 && ctx.total >= 3) extra.push(['rocket', fromLast === 0 ? 22 : 14]);
    if (rank >= 3 && ctx.lap >= 2 && !ctx.cometActive) extra.push(['comet', rank >= 5 ? 7 : 4]);
  }
  let tot = 0;
  for (const it of ITEMS) tot += WEIGHTS[it][r6]!;
  for (const [, w] of extra) tot += w;
  let r = rng.next() * tot;
  for (const it of ITEMS) {
    if ((r -= WEIGHTS[it][r6]!) < 0) return it;
  }
  for (const [it, w] of extra) if ((r -= w) < 0) return it;
  return 'turbo';
}
