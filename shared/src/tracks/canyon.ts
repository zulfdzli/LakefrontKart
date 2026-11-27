/**
 * Dusty Canyon: esses along the mesa under rock arches (a long straight until D64), a tunnel through a ridge, a
 * jump over a ravine and a run of switchbacks down into a dry riverbed, with whoops, a tabletop and a lane kicker
 * (D64). Clockwise.
 */
import type { TrackDef, TrackPoint } from './def';

/** D65: 1.25 to 0.69, a lap about half as long. */
const S = 0.69;
const P = (x: number, z: number, h = 0, bank = 0, w?: number): TrackPoint => ({
  x: x * S,
  z: z * S,
  h,
  bank,
  ...(w ? { w } : {}),
});

export const CANYON_DEF: TrackDef = {
  id: 'canyon',
  name: 'Dusty Canyon',
  theme: 'canyon',
  points: [
    P(-300, -200, 10, 0, 10.5), // start line
    P(-120, -205, 10, 0, 10.5),
    P(-10, -190, 10, -3), // D64: mesa esses instead of a 900 m straight
    P(90, -236, 10, 4),
    P(200, -194, 10, -4),
    P(300, -240, 10, 3),
    P(420, -224, 10),
    P(560, -190, 9, -5),
    P(640, -80, 7, -6),
    P(620, 40, 5),
    P(540, 90, 4, 4), // S-bend
    P(430, 70, 4, -3),
    P(330, 100, 5),
    P(240, 160, 6, 0, 8.5), // rock tunnel
    P(120, 170, 6, 0, 8.5),
    P(0, 130, 5),
    P(-90, 55, 6), // ravine jump
    P(-200, 52, 3),
    P(-310, 60, 2),
    P(-400, 125, 1, 4),
    P(-480, 140, 0.5, 7), // switchback 1
    P(-515, 195, 0, 8),
    P(-470, 250, 0, 6),
    P(-330, 245, 0),
    P(-200, 248, 0, -3),
    P(-140, 256, 0, -6), // switchback 2
    P(-118, 298, 0, -8),
    P(-140, 340, 0, -6),
    P(-200, 350, 0, -3),
    P(-320, 350, 1),
    P(-490, 340, 2, -4),
    P(-600, 250, 4, -5),
    P(-610, 60, 6),
    P(-570, -100, 8),
    P(-450, -180, 10, -5),
  ],
  offroad: 'sand',
  sectors: [
    { at: 0, name: 'Mesa Esses', feature: 'esses under the rock arches' },
    { at: 0.306, name: 'Ridge Tunnel', feature: 'tunnel' },
    { at: 0.464, name: 'Ravine Jump', feature: 'jump ramp' },
    { at: 0.574, name: 'Switchbacks', feature: 'hairpin complex and riverbed shortcut' },
  ],
  gates: [0.156, 0.385, 0.534, 0.663, 0.802],
  pads: [{ at: 0.059 }, { at: 0.167 }, { at: 0.424 }, { at: 0.881 }],
  // the ravine jump; D64 adds whoops after switchback 1, a riverbed tabletop and a lane kicker on the west run
  ramps: [
    { at: 0.494, kind: 'launch', len: 14, lift: 1.8, pop: 0.17 },
    { at: 0.649, kind: 'whoops', count: 3, gap: 24 },
    { at: 0.762, kind: 'table' },
    { at: 0.872, kind: 'lane', lat: [-9, -1.5] },
  ],
  zones: [
    { from: 0.227, to: 0.256, latMin: -18, latMax: -11.7, surface: 'gravel' },
    { from: 0.578, to: 0.613, latMin: 11.7, latMax: 18, surface: 'gravel' },
  ],
  shortcuts: [{ from: 0.681, to: 0.731, via: [], half: 5, surface: 'sand' }],
  landmarks: [
    { kind: 'arch', at: 0.05, side: 0, dist: 0 },
    { kind: 'arch', at: 0.122, side: 0, dist: 0 },
    { kind: 'tunnel', at: 0.39, side: 0, dist: 0, len: 0.034 },
    { kind: 'ravine', at: 0.504, side: 0, dist: 0 },
    { kind: 'mesa', at: 0.207, side: 1, dist: 90 },
  ],
  music: 'canyon',
};
