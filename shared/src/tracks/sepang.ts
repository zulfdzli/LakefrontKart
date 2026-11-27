/**
 * Sepang Circuit: the layout of the Sepang circuit in Malaysia, traced turn by turn from the reference map
 * (15 turns, clockwise): the main straight into the Turn 1-2 hairpin complex, the long left Turn 3, the Turn 4
 * right-hander, the Turn 5-6 esses, the Turn 7-8 double right, the Turn 9 hairpin, Turns 10-13, the Turn 14
 * hairpin, the back straight and the Turn 15 hairpin onto the main straight. Tropical theme.
 *
 * Coordinates are the reference map's pixels (x right, y down), scaled to metres by S.
 */
import type { TrackDef, TrackPoint } from './def';

/** Metres per map pixel: chosen so the Normal AI laps in about 2 minutes (section 11.1); D64: 0.98 to 1.01, since
 * the new jumps' landing boosts made it the quickest track. */
const S = 0.66; // D65: 1.01 to 0.66, a lap about half as long
const OX = 945,
  OY = 576;
/** Road half-width (m): a little narrower than the other tracks, so the tight Turns 1, 2 and 9 keep their shape. */
const W = 8.5; // D65: was 12
/** D65: the hairpins (Turns 1, 2, 9, 14 and 15) stay wider, so the tight corners keep room to turn. */
const HAIRPIN_W = 9;
const P = (x: number, y: number, h = 0, bank = 0, w = W): TrackPoint => ({
  x: (x - OX) * S,
  z: (y - OY) * S,
  h,
  bank,
  w,
});

export const SEPANG_DEF: TrackDef = {
  id: 'sepang',
  name: 'Sepang Circuit',
  theme: 'tropical',
  points: [
    // main straight, heading west from the start line
    P(945, 576, 2, 0, 9.5),
    P(800, 587, 2, 0, 9.5),
    P(650, 597, 2),
    P(565, 604, 2),
    // Turn 1: tight right-hand hairpin
    P(528, 604, 2, -4, HAIRPIN_W),
    P(507, 588, 2, -6, HAIRPIN_W),
    P(506, 562, 2, -6, HAIRPIN_W),
    P(527, 545, 2, -4, HAIRPIN_W),
    // Turn 2: sharp left onto the climb
    P(560, 548, 2.5, HAIRPIN_W),
    P(588, 559, 3, 4, HAIRPIN_W),
    P(604, 541, 3.5, 6, HAIRPIN_W),
    P(596, 513, 4, 4),
    P(572, 482, 5),
    // up the left side into the long left Turn 3
    P(553, 440, 6),
    P(549, 395, 7, 3),
    P(560, 345, 8, 5),
    P(592, 303, 8, 5),
    P(650, 268, 8, 2),
    // towards Turn 4
    P(740, 236, 9),
    P(840, 200, 9),
    P(910, 168, 9),
    P(965, 145, 9, -4),
    // Turn 4: right-hander, then downhill
    P(986, 158, 9, -7),
    P(994, 200, 8, -3),
    P(1004, 270, 6),
    P(1018, 340, 4),
    // Turns 5-6: the esses
    P(1045, 392, 3, 4),
    P(1085, 428, 2, 5),
    P(1135, 430, 2, 2),
    P(1180, 410, 2, -3),
    P(1215, 378, 2, -5),
    P(1265, 352, 2, -5),
    P(1312, 366, 2, -3),
    // fast run to Turn 7
    P(1360, 412, 2),
    P(1430, 494, 2),
    P(1482, 555, 2, -5),
    // Turns 7-8: double right
    P(1502, 582, 2, -7),
    P(1488, 620, 2, -5),
    P(1466, 657, 2, -6),
    P(1430, 668, 2, -3),
    // towards the Turn 9 hairpin
    P(1300, 673, 1.5),
    P(1170, 684, 1),
    P(1080, 696, 1, 4),
    // Turn 9: left hairpin
    P(1050, 704, 1, 7, HAIRPIN_W),
    P(1038, 725, 1, 7, HAIRPIN_W),
    P(1058, 743, 1, 5, HAIRPIN_W),
    P(1095, 756, 1, 3),
    // Turn 10 and the long right Turn 11
    P(1128, 778, 1, -3),
    P(1146, 830, 1, -4),
    P(1140, 890, 1, -5),
    P(1115, 942, 1, -6),
    P(1082, 966, 1, -7),
    P(1052, 955, 1, -4),
    // Turns 12-13
    P(995, 906, 1),
    P(935, 856, 1, -3),
    P(880, 806, 1, -4),
    P(845, 795, 1),
    P(790, 815, 1, 3),
    P(720, 842, 1, 3),
    P(660, 840, 1, -2),
    // Turn 14: right hairpin onto the back straight
    P(615, 808, 1, -6, HAIRPIN_W),
    P(600, 768, 1, -7, HAIRPIN_W),
    P(625, 738, 1, -5, HAIRPIN_W),
    // back straight
    P(720, 718, 1.5),
    P(900, 683, 1.5),
    P(1100, 646, 2),
    P(1280, 614, 2),
    // Turn 15: left hairpin onto the main straight
    P(1340, 603, 2, 5, HAIRPIN_W),
    P(1366, 578, 2, 7, HAIRPIN_W),
    P(1352, 551, 2, 6, HAIRPIN_W),
    P(1320, 545, 2, 3, 9.5),
    P(1140, 558, 2, 0, 9.5),
  ],
  offroad: 'grass',
  sectors: [
    { at: 0, name: 'Turns 1-3', feature: 'hairpin complex and long left' },
    { at: 0.27, name: 'Turns 4-6', feature: 'downhill and the esses' },
    { at: 0.5, name: 'Turns 7-11', feature: 'double right and the Turn 9 hairpin' },
    { at: 0.75, name: 'Turns 12-15', feature: 'Turn 14 hairpin, back straight with a boost pad' },
  ],
  gates: [0.13, 0.4, 0.62, 0.88],
  pads: [{ at: 0.04 }, { at: 0.83 }, { at: 0.58 }],
  // D64: the layout stays traced, but its long straights get jumps: whoops into Turn 7, a tabletop before Turn 9,
  // a launch off the back-straight boost pad and a lane kicker on the main straight
  ramps: [
    { at: 0.395, kind: 'whoops', count: 3, gap: 28 },
    { at: 0.5, kind: 'table' },
    { at: 0.84, kind: 'launch' },
    { at: 0.95, kind: 'lane', lat: [-8, -1.5] },
  ],
  zones: [],
  shortcuts: [],
  landmarks: [
    { kind: 'grandstand', at: 0.97, side: 1, dist: 26 },
    { kind: 'grandstand', at: 0.83, side: -1, dist: 26 },
  ],
  music: 'sepang',
  traced: true,
};
