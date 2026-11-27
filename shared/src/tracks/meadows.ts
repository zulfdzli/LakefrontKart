/**
 * Sunny Meadows: the prototype's world grown to full length. Rolling farmland with a windmill, a river under a
 * stone bridge and a lake. Clockwise.
 */
import type { TrackDef, TrackPoint } from './def';

/** D65: 1.22 to 0.67, a lap about half as long. */
const S = 0.67;
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
    P(-150, -330, 0, 0, 10.5), // start line
    P(40, -330, 0, 0, 10.5),
    P(140, -306, 0.5, 3), // D64: esses instead of a long straight
    P(240, -352, 1, -3),
    P(340, -318, 1.5),
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
    P(-372, 165, 7.5, -3), // D64: an S-bend on the lakeside run
    P(-432, 75, 9, 3),
    P(-398, -20, 9),
    P(-390, -150, 7),
    P(-350, -280, 4, -6),
    P(-260, -330, 1, -2, 10.5),
  ],
  offroad: 'grass',
  sectors: [
    { at: 0, name: 'Windmill Sweepers', feature: 'fast sweeper' },
    { at: 0.271, name: 'Riverside Hairpin', feature: 'hairpin complex' },
    { at: 0.498, name: 'Orchard Climb', feature: 'bridge and elevation change' },
    { at: 0.725, name: 'Lakeside Run', feature: 'farm-track shortcut' },
  ],
  gates: [0.153, 0.4, 0.616, 0.902],
  pads: [{ at: 0.039 }, { at: 0.458 }, { at: 0.596 }, { at: 0.857 }],
  // D64 jumps: riverside whoops, a lane kicker after the bridge, a big launch off the lakeside boost pad
  ramps: [
    { at: 0.362, kind: 'whoops', count: 3, gap: 30 },
    { at: 0.625, kind: 'lane', lat: [1.5, 9] },
    { at: 0.866, kind: 'launch' },
  ],
  zones: [
    { from: 0.081, to: 0.133, latMin: -18, latMax: -11.7, surface: 'gravel' },
    { from: 0.379, to: 0.419, latMin: -18, latMax: -11.7, surface: 'gravel' },
  ],
  shortcuts: [{ from: 0.732, to: 0.808, via: [], half: 6, surface: 'dirt' }],
  landmarks: [
    { kind: 'windmill', at: 0.104, side: -1, dist: 45 },
    { kind: 'river', at: 0.596, side: 0, dist: 0 },
    { kind: 'barn', at: 0.774, side: 1, dist: 38 },
    { kind: 'lake', at: 0.921, side: 1, dist: 70 },
  ],
  music: 'meadows',
};
