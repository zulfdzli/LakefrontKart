/**
 * Frosty Peaks: twilight in the mountains. Downhill sweepers, a frozen lake with icy patches, a hairpin climb up
 * the pass and a run through the village. Clockwise.
 */
import type { TrackDef, TrackPoint } from './def';

const S = 1.29;
const P = (x: number, z: number, h = 0, bank = 0, w?: number): TrackPoint => ({
  x: x * S,
  z: z * S,
  h,
  bank,
  ...(w ? { w } : {}),
});

export const FROSTY_DEF: TrackDef = {
  id: 'frosty',
  name: 'Frosty Peaks',
  theme: 'frosty',
  points: [
    P(0, -350, 20, 0, 14), // start line
    P(170, -352, 19.5, 0, 14),
    P(265, -388, 18.5, 3), // D64: esses down from the start
    P(365, -338, 17.5, -3),
    P(455, -322, 16),
    P(560, -250, 14, -6), // avalanche sweepers
    P(620, -120, 10, -5),
    P(600, 20, 6),
    P(520, 120, 4, 4),
    P(520, 240, 2),
    P(450, 330, 1, -5),
    P(300, 360, 0), // frozen lake
    P(150, 340, 0),
    P(40, 300, 0),
    P(-60, 330, 0.5, -4), // S-bend
    P(-160, 300, 1.5, 4),
    P(-240, 220, 3, 4),
    P(-245, 120, 6),
    P(-240, 50, 8, -4), // hairpin pass
    P(-220, 12, 9.5, -7),
    P(-178, 4, 10.5, -8),
    P(-152, 36, 11.5, -6),
    P(-148, 120, 12.5),
    P(-140, 200, 13.5, 4),
    P(-118, 238, 14, 7), // hairpin B
    P(-78, 242, 14.5, 8),
    P(-56, 206, 15, 6),
    P(-50, 110, 17),
    P(-10, 10, 19),
    P(40, -70, 20),
    P(20, -160, 21, 4),
    P(-100, -220, 21), // village
    P(-280, -240, 21),
    P(-380, -300, 21, -5),
    P(-330, -380, 20, -6),
    P(-215, -398, 20, -3, 14), // D64: a kink before the grid
    P(-100, -362, 20, 0, 14),
  ],
  offroad: 'snow',
  sectors: [
    { at: 0, name: 'Avalanche Sweepers', feature: 'fast downhill sweepers' },
    { at: 0.323, name: 'Frozen Lake', feature: 'icy patches' },
    { at: 0.522, name: 'Hairpin Pass', feature: 'double hairpin climb and snow-trail shortcut' },
    { at: 0.77, name: 'Village Run', feature: 'village straight' },
  ],
  gates: [0.155, 0.423, 0.661, 0.879],
  pads: [{ at: 0.049 }, { at: 0.224 }, { at: 0.701 }, { at: 0.82 }],
  // D64 jumps: a lane kicker after the start, snow moguls by the lake, a launch off the pass's boost pad and a
  // village tabletop off its boost pad
  ramps: [
    { at: 0.02, kind: 'lane', lat: [1.5, 13] },
    { at: 0.391, kind: 'whoops', count: 3, gap: 24 },
    { at: 0.712, kind: 'launch' },
    { at: 0.832, kind: 'table' },
  ],
  zones: [
    { from: 0.373, to: 0.388, latMin: -13, latMax: -2, surface: 'ice' },
    { from: 0.408, to: 0.423, latMin: 1, latMax: 13, surface: 'ice' },
    { from: 0.442, to: 0.457, latMin: -8, latMax: 6, surface: 'ice' },
    { from: 0.105, to: 0.144, latMin: -26, latMax: -15.2, surface: 'gravel' },
  ],
  shortcuts: [{ from: 0.558, to: 0.604, via: [], half: 6, surface: 'snow' }],
  landmarks: [
    { kind: 'lake', at: 0.333, side: -1, dist: 90 },
    { kind: 'village', at: 0.82, side: 1, dist: 60 },
    { kind: 'lodge', at: 0.601, side: -1, dist: 70 },
  ],
  music: 'frosty',
};
