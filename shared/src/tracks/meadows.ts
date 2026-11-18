/**
 * Sunny Meadows: the prototype's world grown to full length. Rolling farmland with a windmill, a river under a
 * stone bridge and a lake. Clockwise.
 */
import type { TrackDef, TrackPoint } from './def';

const S = 1.12;
const P = (x: number, z: number, h = 0, bank = 0, w?: number): TrackPoint => ({
  x: x * S,
  z: z * S,
  h,
  bank,
  ...(w ? { w } : {}),
});

export const MEADOWS_DEF: TrackDef = {
  id: 'meadows',
  name: 'Sunny Meadows',
  theme: 'meadows',
  points: [
    P(-150, -330, 0, 0, 14), // start line
    P(100, -330, 0, 0, 14),
    P(330, -320, 1),
    P(480, -260, 3, -6), // windmill sweeper
    P(560, -140, 5, -5),
    P(570, 0, 6),
    P(520, 100, 4, 4), // S-bend
    P(560, 200, 3, -4),
    P(550, 320, 2),
    P(480, 410, 1, -5),
    P(330, 430, 0),
    P(180, 430, 0),
    P(120, 418, 0, -3), // riverside hairpin
    P(68, 408, 0, -6),
    P(50, 372, 0, -8),
    P(68, 336, 0.3, -6),
    P(120, 326, 0.6, -3),
    P(180, 320, 1.5),
    P(270, 300, 3),
    P(310, 240, 5, 4),
    P(310, 160, 8),
    P(270, 105, 9, 4),
    P(150, 90, 7),
    P(0, 90, 4), // river bridge
    P(-120, 110, 5, -4),
    P(-170, 190, 6),
    P(-175, 300, 5),
    P(-210, 400, 3, -4),
    P(-300, 430, 2),
    P(-380, 380, 3, -5),
    P(-410, 250, 6),
    P(-400, 50, 9),
    P(-390, -150, 7),
    P(-350, -280, 4, -6),
    P(-260, -330, 1, -2, 14),
  ],
  offroad: 'grass',
  sectors: [
    { at: 0, name: 'Windmill Sweepers', feature: 'fast sweeper' },
    { at: 0.27, name: 'Riverside Hairpin', feature: 'hairpin complex' },
    { at: 0.5, name: 'Orchard Climb', feature: 'bridge and elevation change' },
    { at: 0.73, name: 'Lakeside Run', feature: 'farm-track shortcut' },
  ],
  gates: [0.15, 0.4, 0.62, 0.9],
  pads: [{ at: 0.04 }, { at: 0.46 }, { at: 0.6 }, { at: 0.86 }],
  ramps: [],
  zones: [
    { from: 0.08, to: 0.13, latMin: -25, latMax: -15.2, surface: 'gravel' },
    { from: 0.38, to: 0.42, latMin: -25, latMax: -15.2, surface: 'gravel' },
  ],
  shortcuts: [{ from: 0.737, to: 0.814, via: [], half: 6, surface: 'dirt' }],
  landmarks: [
    { kind: 'windmill', at: 0.1, side: -1, dist: 70 },
    { kind: 'river', at: 0.6, side: 0, dist: 0 },
    { kind: 'barn', at: 0.78, side: 1, dist: 60 },
    { kind: 'lake', at: 0.92, side: 1, dist: 110 },
  ],
  music: 'meadows',
};
