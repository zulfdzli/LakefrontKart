/**
 * D69 Bumper Brawl arenas: short, very wide rings around a central island, so the karts can drive either way,
 * circle and ambush each other while the race physics, walls and renderer stay exactly as on the tracks. Each ring
 * wobbles (three lobes) and rolls a little, with two kicker ramps, two boost pads and four item rows.
 */
import type { SurfaceId } from '../track';
import type { ThemeId, TrackDef, TrackPoint } from './def';

interface ArenaSpec {
  id: 'arena-meadow' | 'arena-canyon' | 'arena-ice';
  name: string;
  theme: ThemeId;
  offroad: SurfaceId;
  music: string;
  /** Ring radius (m), lobe depth (m), lobe phase (rad), height swell (m). */
  r: number;
  lobe: number;
  phase: number;
  swell: number;
}

/** Floor half-width (m). D70: 7% narrower (was 17); D78: 10% wider (was 15.8). */
const HALF = 17.4;

function ring(a: ArenaSpec): TrackPoint[] {
  const n = 18,
    pts: TrackPoint[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = a.r + a.lobe * Math.sin(3 * t + a.phase);
    pts.push({ x: Math.cos(t) * r, z: Math.sin(t) * r, h: a.swell * Math.sin(2 * t), w: HALF });
  }
  return pts;
}

function arena(a: ArenaSpec): TrackDef {
  return {
    id: a.id,
    name: a.name,
    theme: a.theme,
    points: ring(a),
    offroad: a.offroad,
    sectors: [
      { at: 0, name: 'North Ring', feature: 'kicker ramp' },
      { at: 0.34, name: 'East Ring', feature: 'boost pad' },
      { at: 0.67, name: 'West Ring', feature: 'kicker ramp' },
    ],
    pads: [{ at: 0.12 }, { at: 0.62 }],
    ramps: [
      { at: 0.3, kind: 'kicker' },
      { at: 0.8, kind: 'kicker' },
    ],
    itemRows: [0.05, 0.3 + 0.09, 0.55, 0.8 + 0.09],
    zones: [],
    shortcuts: [],
    landmarks: [],
    music: a.music,
    coaster: false,
    // the whole floor is road: walls just past the kerbs, bumper-car style (a run-off band slowed the fights and
    // the spray off it whited out the view)
    wallGap: 4,
  };
}

export const ARENA_DEFS: readonly TrackDef[] = [
  arena({
    id: 'arena-meadow',
    name: 'Meadow Fairground',
    theme: 'meadows',
    offroad: 'grass',
    music: 'meadows',
    r: 62,
    lobe: 5,
    phase: 0.4,
    swell: 1.2,
  }),
  arena({
    id: 'arena-canyon',
    name: 'Canyon Bowl',
    theme: 'canyon',
    offroad: 'sand',
    music: 'canyon',
    r: 66,
    lobe: 6,
    phase: 1.3,
    swell: 1.8,
  }),
  arena({
    id: 'arena-ice',
    name: 'Frozen Lake',
    theme: 'frosty',
    offroad: 'snow',
    music: 'frosty',
    r: 60,
    lobe: 4,
    phase: 2.2,
    swell: 0.8,
  }),
];
