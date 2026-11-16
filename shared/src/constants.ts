/** Simulation and track constants, ported unchanged from the prototype (section 2.1). */

/** Fixed simulation step (60 Hz). */
export const STEP = 1 / 60;
/** Karts in a race when AI fill is on. */
export const NKARTS = 6;
/** Road half-width (m). */
export const ROAD_HALF = 13;
/** Kerb width beyond the road edge (m). */
export const KERB_W = 2.2;
/** Wall distance from the centreline (m). */
export const WALL = 25;
/** Kart collision radius (m). */
export const KART_R = 1.5;
/** Top speed while boosting (m/s). */
export const BOOSTSP = 52;
/** Spin-out duration after a hit (s). */
export const SPIN_T = 1.2;
/** Rescue drone duration (s). */
export const RESCUE_T = 1.6;
/** Boost time cap (s). */
export const MAX_BOOST = 3;
/** Countdown length from "start" to GO (s), as in the prototype. */
export const COUNTDOWN_T = 3.6;
/** Race ends this long after the first human finishes, if not all humans have (section 6.4). */
export const RACE_END_GRACE = 30;

export const TWO_PI = Math.PI * 2;

export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);

export const wrapA = (a: number): number => {
  while (a > Math.PI) a -= TWO_PI;
  while (a < -Math.PI) a += TWO_PI;
  return a;
};

export const smooth01 = (t: number): number => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
