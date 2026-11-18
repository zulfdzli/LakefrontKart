/**
 * Grand Prix (section 12.6, D48): the tracks in order, 15/12/10/8/6/4 points by finishing place, totals carried
 * between races. Pure data, so it can be tested headlessly; the host runs it.
 *
 * A racer is identified across races by its slot (players) or its character (AI, which keeps its character as
 * long as the players keep theirs).
 */
import type { Standing } from './protocol';

export const GP_POINTS: readonly number[] = [15, 12, 10, 8, 6, 4];

export interface GpEntry {
  key: string;
  slot: number | null;
  name: string;
  color: string;
  characterId: string;
  points: number;
  /** Points from the latest race. */
  last: number;
  /** Best finish this Grand Prix, for tie-breaks (lower is better). */
  bestPlace: number;
}

export interface GpState {
  order: string[];
  /** Index of the current (or just finished) race. */
  race: number;
  entries: Map<string, GpEntry>;
  /** The last race has been scored. */
  done: boolean;
}

export const gpKey = (s: Pick<Standing, 'slot' | 'characterId'>): string =>
  s.slot !== null ? `s${s.slot}` : `c${s.characterId}`;

export function newGp(order: readonly string[]): GpState {
  return { order: [...order], race: 0, entries: new Map(), done: false };
}

/** Score a finished race (standings in finishing order). Returns the race standings with points filled in. */
export function scoreRace(gp: GpState, standings: readonly Standing[]): Standing[] {
  const out = standings.map((s, i) => ({ ...s, points: GP_POINTS[i] ?? 0 }));
  for (const e of gp.entries.values()) e.last = 0;
  out.forEach((s, i) => {
    const key = gpKey(s);
    const e = gp.entries.get(key) ?? {
      key,
      slot: s.slot,
      name: s.name,
      color: s.color,
      characterId: s.characterId,
      points: 0,
      last: 0,
      bestPlace: 99,
    };
    e.name = s.name;
    e.color = s.color;
    e.characterId = s.characterId;
    e.points += s.points;
    e.last = s.points;
    e.bestPlace = Math.min(e.bestPlace, i + 1);
    gp.entries.set(key, e);
  });
  if (gp.race >= gp.order.length - 1) gp.done = true;
  return out;
}

/** Totals, best first: points, then best finish, then the latest race's points. */
export function gpTable(gp: GpState): GpEntry[] {
  return [...gp.entries.values()].sort((a, b) => b.points - a.points || a.bestPlace - b.bestPlace || b.last - a.last);
}

/** The table as protocol standings (points = total), for the phones. */
export function gpStandings(gp: GpState): Standing[] {
  return gpTable(gp).map((e) => ({
    slot: e.slot,
    name: e.name,
    color: e.color,
    characterId: e.characterId,
    time: null,
    bestLap: null,
    points: e.points,
  }));
}
