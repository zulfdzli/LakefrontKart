/** The tracks: the three originals (D7 order: Meadows, Canyon, Frosty), then Sepang Circuit (D42). */
import type { Track } from '../track';
import { buildTrackFromDef, type TrackDef, type TrackId } from './def';
import { MEADOWS_DEF } from './meadows';
import { CANYON_DEF } from './canyon';
import { FROSTY_DEF } from './frosty';
import { SEPANG_DEF } from './sepang';

export * from './def';

export const TRACKS: Readonly<Record<TrackId, TrackDef>> = {
  meadows: MEADOWS_DEF,
  canyon: CANYON_DEF,
  frosty: FROSTY_DEF,
  sepang: SEPANG_DEF,
};
export const TRACK_IDS: readonly TrackId[] = ['meadows', 'canyon', 'frosty', 'sepang'];

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
