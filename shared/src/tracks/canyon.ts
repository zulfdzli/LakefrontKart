/**
 * Dusty Canyon: a long mesa straight, rock arches, a tunnel through a ridge, a jump over a ravine and a run of
 * switchbacks down into a dry riverbed. Clockwise.
 */
import type { TrackDef, TrackPoint } from './def';

const S = 1.14;
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
    P(-300, -200, 10, 0, 14), // start line
    P(-50, -210, 10, 0, 14),
    P(200, -220, 10),
    P(400, -230, 10), // mesa straight
    P(560, -190, 9, -5),
    P(640, -80, 7, -6),
    P(620, 40, 5),
    P(540, 90, 4, 4), // S-bend
    P(430, 70, 4, -3),
    P(330, 100, 5),
    P(240, 160, 6, 0, 11), // rock tunnel
    P(120, 170, 6, 0, 11),
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
    { at: 0, name: 'Mesa Straight', feature: 'long straight and rock arches' },
    { at: 0.3, name: 'Ridge Tunnel', feature: 'tunnel' },
    { at: 0.46, name: 'Ravine Jump', feature: 'jump ramp' },
    { at: 0.57, name: 'Switchbacks', feature: 'hairpin complex and riverbed shortcut' },
  ],
  gates: [0.15, 0.38, 0.53, 0.66, 0.8],
  pads: [{ at: 0.06 }, { at: 0.16 }, { at: 0.42 }, { at: 0.88 }],
  ramps: [{ at: 0.49, len: 14, lift: 1.8 }],
  zones: [
    { from: 0.22, to: 0.25, latMin: -26, latMax: -15.2, surface: 'gravel' },
    { from: 0.575, to: 0.61, latMin: 15.2, latMax: 26, surface: 'gravel' },
  ],
  shortcuts: [{ from: 0.678, to: 0.729, via: [], half: 6, surface: 'sand' }],
  landmarks: [
    { kind: 'arch', at: 0.05, side: 0, dist: 0 },
    { kind: 'arch', at: 0.12, side: 0, dist: 0 },
    { kind: 'tunnel', at: 0.385, side: 0, dist: 0, len: 0.035 },
    { kind: 'ravine', at: 0.5, side: 0, dist: 0 },
    { kind: 'mesa', at: 0.2, side: 1, dist: 160 },
  ],
  music: 'canyon',
};
