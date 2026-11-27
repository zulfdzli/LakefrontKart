/** The tracks: the three originals (D7 order: Meadows, Canyon, Frosty), then Sepang Circuit (D42). */
import type { Track } from '../track';
import { buildTrackFromDef, growDef, type TrackDef, type TrackId } from './def';
import { MEADOWS_DEF } from './meadows';
import { CANYON_DEF } from './canyon';
import { FROSTY_DEF } from './frosty';
import { SEPANG_DEF } from './sepang';
import { ARENA_DEFS } from './arenas';

export * from './def';

/** D67: each track 5% longer than its def (see growDef). D70: the road 7% narrower than D67's (×1.05 × 0.93). */
const GROW = 1.05;
/** Road width: D70 7% narrower, D77 10% wider again, D78 10% wider still. */
const ROAD = 1.05 * 0.93 * 1.1 * 1.1;
/** D76: no boost pads on any track or arena. */
const noPads = (d: TrackDef): TrackDef => ({ ...d, pads: [] });
/**
 * D80: flat tracks, at the user's request: every point at height 0 (no hills), no roller-coaster pass (no crests,
 * dips or extra jumps) and no whoops (a run of bumps). The designed single jumps (launch, table-top, kicker, lane
 * ramp) stay; banking in the corners stays too.
 */
const flat = (d: TrackDef): TrackDef => ({
  ...d,
  points: d.points.map((p) => ({ ...p, h: 0 })),
  // D81: and more jumps: single ones only, placed between the designed ones (the road stays flat around them)
  coaster: 'ramps',
  ramps: d.ramps.filter((r) => r.kind !== 'whoops'),
});

export const TRACKS: Readonly<Record<TrackId, TrackDef>> = {
  meadows: flat(noPads(growDef(MEADOWS_DEF, GROW, ROAD))),
  canyon: flat(noPads(growDef(CANYON_DEF, GROW, ROAD))),
  frosty: flat(noPads(growDef(FROSTY_DEF, GROW, ROAD))),
  sepang: flat(noPads(growDef(SEPANG_DEF, GROW, ROAD))),
  'arena-meadow': noPads(ARENA_DEFS[0]!),
  'arena-canyon': noPads(ARENA_DEFS[1]!),
  'arena-ice': noPads(ARENA_DEFS[2]!),
};
/** The race tracks (Grand Prix order). */
export const TRACK_IDS: readonly TrackId[] = ['meadows', 'canyon', 'frosty', 'sepang'];
/** D69: the Bumper Brawl arenas. */
export const ARENA_IDS: readonly TrackId[] = ['arena-meadow', 'arena-canyon', 'arena-ice'];
export const isArenaId = (v: unknown): boolean => typeof v === 'string' && (ARENA_IDS as readonly string[]).includes(v);

export const isTrackId = (v: unknown): v is TrackId => typeof v === 'string' && v in TRACKS;

const cache = new Map<TrackId, Track>();
/** Build (once) and return a track's lookup tables. Tracks are read-only after building. */
export function getTrack(id: TrackId): Track {
  let t = cache.get(id);
  if (!t) {
    t = buildTrackFromDef(TRACKS[id]);
    cache.set(id, t);
  }
  return t;
}
export { planCoaster, speedProfile, bumpShape } from './coaster';
