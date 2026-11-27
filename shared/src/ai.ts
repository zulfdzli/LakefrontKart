/**
 * AI driver: follows the racing line with a personal lane offset, avoids oil, overtakes,
 * slows for corners, drifts and uses items. Ported from the prototype; rubber-banding now
 * compares against the average progress of the human players (section 8.4).
 */
import { clamp, wrapA, BOOSTSP } from './constants';
import { SURF } from './track';
import type { GameState, Kart } from './game';
import { WEATHER_GRIP } from './weather';
import { SQUALL_GRIP, hazardBrake, hazardLane, inSquall } from './hazards';
import { zoneLane } from './zones';
import { aiMove } from './moves';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AiConfig {
  /** Fraction of top speed the AI aims for. */
  skill: number;
  /** Personal lateral offset from the racing line (m, scaled by 0.35). */
  lane: number;
  /** Phase of the lane weave. */
  ph: number;
  drifts: boolean;
  /** Corner-speed caution multiplier (higher = slower in corners). */
  corner: number;
}

export interface DifficultyTable {
  skill: readonly number[];
  drift: readonly number[];
  corner: number;
  /** Chance of a rocket start. */
  start: number;
  /** Item-use eagerness (divides the wait before using an item). */
  items: number;
  /** Rubber-band top-speed multipliers: [when far ahead of the humans, when far behind]. */
  rb: readonly [number, number];
  /** v2 (D46): a driving mistake (late turn-in, running wide) every `period` s, lasting `dur` s. */
  mistake: readonly [number, number];
  /** v2: chance that an AI takes a worthwhile shortcut. */
  shortcut: number;
  /** v2 corner caution and pace (skill multiplier): these set the 3% gaps between levels (D9, D46). */
  cornerV2: number;
  pace: number;
}

export const DIFF: Record<Difficulty, DifficultyTable> = {
  easy: {
    skill: [0.85, 0.835, 0.825, 0.815, 0.8],
    drift: [1, 0, 1, 0, 0],
    corner: 1.15,
    start: 0.1,
    items: 0.6,
    rb: [0.93, 1.03],
    mistake: [13, 1.6],
    shortcut: 0,
    // D65: corner caution 1.15 to 1.4 (pace stays 1): on the short, busy coaster tracks Easy kept within 2% of Normal
    cornerV2: 1.4,
    pace: 1,
  },
  normal: {
    skill: [0.96, 0.945, 0.935, 0.92, 0.905],
    drift: [1, 1, 1, 0, 1],
    corner: 1.0,
    start: 0.35,
    items: 1.0,
    rb: [0.95, 1.04],
    mistake: [28, 1.0],
    shortcut: 0.45,
    cornerV2: 1.0,
    pace: 0.985,
  },
  hard: {
    skill: [1.0, 0.995, 0.985, 0.975, 0.965],
    drift: [1, 1, 1, 1, 1],
    corner: 0.9,
    start: 0.65,
    items: 1.4,
    rb: [0.97, 1.05],
    mistake: [70, 0.6],
    shortcut: 0.85,
    cornerV2: 0.76, // D70: was 0.78 (the narrower road squeezed Normal→Hard on Sepang under 3%)
    pace: 1,
  },
};

/** The prototype player's autopilot: drives a human kart when its phone is disconnected or after it finishes. */
export const HUMAN_AUTOPILOT: Readonly<AiConfig> = { skill: 0.95, lane: 0, ph: 0, drifts: true, corner: 1 };

/** Rubber-band reference: average progress of the humans still racing, or null when none are. */
function humanReference(s: GameState): number | null {
  let sum = 0,
    n = 0;
  for (const h of s.humans) {
    if (h.finished) continue;
    sum += h.prog;
    n++;
  }
  return n ? sum / n : null;
}

/** Deterministic per-kart, per-lap hash in [0, 1). */
function h01(a: number, b: number): number {
  let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 7, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** v2: steer target inside a shortcut corridor, 14 m further along its polyline; or null when not taking one. */
function shortcutTarget(s: GameState, k: Kart): { x: number; z: number } | null {
  const T = s.track,
    N = T.N;
  if (k.slot !== null || !s.handling.v2 || !T.shortcuts.length) {
    k.aiSc = -1;
    return null;
  }
  if (k.aiSc < 0) {
    T.shortcuts.forEach((sc, si) => {
      const ahead = ((sc.i0 - k.idx + N) % N) * T.DS;
      if (ahead > 15 && ahead < 45 && k.aiSc < 0) {
        // only where it pays: braking for the turn-in costs more than the distance saved, unless the AI holds a
        // boost to fire inside (a fast surface needs one turbo; a slow sand or snow trail needs the long rocket)
        const fast = (SURF[sc.surface].cap ?? 99) * s.handling.speedMul >= 24;
        const worth = k.item === 'rocket' || k.boost > 2 || (fast && (k.item === 'turbo' || k.item === 'turbo3'));
        if (worth && h01(k.id * 31 + si, k.lap) < DIFF[s.diff].shortcut) k.aiSc = si;
      }
    });
    if (k.aiSc < 0) return null;
  }
  const sc = T.shortcuts[k.aiSc]!;
  // done once back on the road past the exit, or abandoned when far from the corridor
  const pastExit = ((k.idx - sc.i1 + N) % N) * T.DS;
  if (!k.inSc && pastExit > 0 && pastExit < 60 && (k.idx - sc.i0 + N) % N > (sc.i1 - sc.i0 + N) % N) {
    k.aiSc = -1;
    return null;
  }
  const p = sc.pts;
  let best = 1e18,
    bs = 0,
    bt = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i]!,
      az = p[i + 1]!,
      ex = p[i + 2]! - ax,
      ez = p[i + 3]! - az,
      l2 = ex * ex + ez * ez || 1;
    const t = clamp(((k.x - ax) * ex + (k.z - az) * ez) / l2, 0, 1);
    const d = (k.x - ax - ex * t) ** 2 + (k.z - az - ez * t) ** 2;
    if (d < best) {
      best = d;
      bs = i;
      bt = t;
    }
  }
  if (best > 60 * 60) {
    k.aiSc = -1;
    return null;
  }
  // walk 14 m along the polyline from the closest point
  let rem = k.inSc ? 14 : 9,
    i = bs,
    t = bt;
  for (;;) {
    const ax = p[i]!,
      az = p[i + 1]!,
      ex = p[i + 2]! - ax,
      ez = p[i + 3]! - az,
      L = Math.hypot(ex, ez);
    const left = (1 - t) * L;
    if (rem <= left || i + 5 >= p.length) {
      const tt = Math.min(1, t + rem / (L || 1));
      return { x: ax + ex * tt, z: az + ez * tt };
    }
    rem -= left;
    i += 2;
    t = 0;
  }
}

export function aiInput(s: GameState, k: Kart, dt: number): void {
  const T = s.track;
  const { N, DS, CX, CZ, RX, RZ, ANG, RLINE } = T;
  const inp = k.input,
    a = k.aiCfg,
    sp = k.sp;
  if (k.itemWait > -20) k.itemWait -= dt;
  const look = 9 + Math.max(0, sp) * 0.45;
  const j = (k.idx + Math.round(look / DS)) % N;
  let lane = RLINE[j]! + a.lane * 0.35 + Math.sin(s.time * 0.4 + a.ph) * 1.5;
  for (const sl of s.slicks) {
    const di = (sl.idx - k.idx + N) % N;
    if (di < 14 && Math.abs(sl.lat - lane) < 5.5) lane = sl.lat + (sl.lat > 0 ? -7 : 7);
  }
  // D73: round the rubble or through the flock
  if (s.hazards.length) lane = hazardLane(s, k, lane);
  for (const c of s.karts) {
    if (c === k || c.rescue > 0) continue;
    const d = c.prog - k.prog;
    if (d > 0.3 && d < 4.5 && Math.abs(c.lat - lane) < 3 && c.sp < sp + 1) {
      lane = c.lat + (lane >= c.lat ? 4.5 : -4.5);
      break;
    }
  }
  // D83: through the slalom gates, onto the jump target (over overtaking: a kart going for it commits)
  const zl = s.zones ? zoneLane(s, k, j) : null;
  if (zl !== null) lane = zl.lane;
  const v2 = s.handling.v2;
  lane = v2 ? clamp(lane, -(T.HW[j]! - 3), T.HW[j]! - 3) : clamp(lane, -10, 10);
  let tx = CX[j]! + RX[j]! * lane,
    tz = CZ[j]! + RZ[j]! * lane;
  const sct = shortcutTarget(s, k);
  if (sct) {
    tx = sct.x;
    tz = sct.z;
  }
  const diff = wrapA(Math.atan2(tx - k.x, tz - k.z) - k.h);
  // v2 mistakes (D46): now and then the AI turns in late and runs wide; more often on Easy
  const mk = DIFF[s.diff].mistake;
  const mistake = v2 && k.slot === null && (s.time + a.ph * 9.7) % mk[0] < mk[1] && s.phase === 'race' && !sct;
  inp.steer = clamp(-diff * (mistake ? 1.3 : 2.6), -1, 1);

  let ahead = Math.round((8 + Math.max(0, sp) * 1.0) / DS);
  // D65: a jump or crest coming up: there is no braking in the air, so judge the corner beyond the landing too
  if (s.handling.coaster && !k.air) {
    let jump = false;
    for (let o = 0; o < ahead && !jump; o += 2) if (T.airZone[(k.idx + o) % N]) jump = true;
    for (const r of T.ramps) if (!jump && (r.i1 - k.idx + N) % N < ahead) jump = true;
    if (jump) ahead += Math.round((Math.max(0, sp) * 0.8) / DS);
  }
  const turnAng = Math.abs(wrapA(ANG[(k.idx + ahead) % N]! - ANG[k.idx]!));
  // humans never rubber-band; AI compares with the humans' average progress
  if (k.slot === null && s.humans.length) {
    const D = DIFF[s.diff],
      ref = humanReference(s);
    if (ref === null) k.rbMul = 1;
    else {
      const dd = (k.prog - ref) * DS;
      k.rbMul = dd > 110 ? D.rb[0] : dd < -110 ? D.rb[1] : 1;
    }
  }
  let target = k.P.top * k.rbMul * a.skill;
  // v2: better handling carries more speed through corners (balances the speed stat); mistakes brake late
  // D62: the corner penalty was tuned at speedMul 1.3, but grip does not scale with speed, so above that the AI
  // brakes harder (squared: the grip a corner needs grows with speed squared); exactly 1 at 1.3 and in the prototype
  // D71: on a wet or snowy road the tyres hold a little less, so the AI brakes a little earlier
  const cornerScale =
    ((v2 ? (s.handling.speedMul / 1.3) ** 2 : 1) / WEATHER_GRIP[s.weather]) *
    (s.hazards.some((h) => inSquall(T, h, j)) ? 1 / SQUALL_GRIP : 1);
  const cornerK = (v2 ? (38 * a.corner) / k.P.turn : 38 * a.corner) * cornerScale;
  // D65: the floor is lower on the coaster tracks (their hairpins are tighter): 14 m/s × speedMul instead of 17
  const floorV = (s.handling.coaster ? 14 : 17) * s.handling.speedMul;
  target = Math.min(target, Math.max(floorV, k.P.top - turnAng * cornerK * (mistake ? 0.75 : 1)));
  // a boost is used flat out, except (D65, the shorter coaster tracks) where a corner needs a lift
  if (k.boost > 0)
    target = s.handling.coaster && turnAng > 0.35 ? Math.max(target, k.P.top) : BOOSTSP * s.handling.speedMul;
  if (Math.abs(diff) > 1.0) target = Math.min(target, 9); // target far off the nose: slow down so the turn tightens
  // v2: brake for a shortcut's turn-in, harder the sharper it leaves the road, so the car stays inside the corridor
  if (sct && !k.inSc) target = Math.min(target, Math.max(12, 30 - Math.abs(diff) * 28));
  // D83: easing off through the slalom, so the weave makes every gate
  if (zl?.weave) target = Math.min(target, k.P.top * 0.7);
  inp.throttle = sp < target;
  inp.brake = sp > target + 5;
  // D74: the signature move, when the moment suits it
  if (s.moves && aiMove(s, k)) inp.move = true;
  // D73: let the snowball roll past
  if (s.hazards.length && hazardBrake(s, k)) {
    inp.throttle = false;
    inp.brake = true;
  }
  const Hd = s.handling;
  if (a.drifts)
    inp.drift = k.drifting ? turnAng > Hd.aiDriftHold : turnAng > Hd.aiDriftIn && sp > 22 && Math.abs(inp.steer) > 0.5;
  else inp.drift = false;
  // D83: no drifting through the slalom or onto the jump target
  if (zl !== null) inp.drift = false;
  // D62: a drift that slides off onto sand or grass is let go, so the tyres grip and the car steers back to the road
  if (v2 && k.offroad && !k.inSc) inp.drift = false;
  // D65: on the narrower road, let go of a drift when steering hard against it (it wants out) or when it is sliding
  // towards the road edge within 1.5 m of it
  if (s.handling.coaster && k.drifting && !k.inSc) {
    const towardEdge = (k.vx * RX[k.idx]! + k.vz * RZ[k.idx]!) * k.lat > 0;
    if (inp.steer * k.driftDir < -0.6 || (towardEdge && Math.abs(k.lat) > T.HW[k.idx]! - 1.5)) inp.drift = false;
  }

  if (k.item && k.roll <= 0 && k.itemWait <= 0) {
    let use = false,
      back = false;
    const near = (lo: number, hi: number, latTol?: number): boolean =>
      s.karts.some(
        (c) =>
          c !== k &&
          c.rescue <= 0 &&
          c.prog - k.prog > lo &&
          c.prog - k.prog < hi &&
          (latTol ? Math.abs(c.lat - k.lat) < latTol : true),
      );
    switch (k.item) {
      case 'turbo':
      case 'turbo3':
        use = turnAng < 0.25 || k.itemWait < -6;
        break;
      case 'oil':
        use = near(-14, 0) || k.itemWait < -8;
        break;
      case 'orb':
        if (near(0, 30)) use = true;
        else if (near(-10, 0)) {
          use = true;
          back = true;
        } else use = k.itemWait < -8;
        break;
      case 'bolt':
        if (turnAng < 0.3 && near(0, 10, 4)) use = true;
        else if (near(-6, 0, 3)) {
          use = true;
          back = true;
        } else use = k.itemWait < -8;
        break;
      case 'shield':
        use = k.shield <= 0;
        break;
      case 'rocket':
        use = turnAng < 0.35 || k.aiSc >= 0 || k.itemWait < -4;
        break;
      case 'comet':
        use = true;
        break;
    }
    // turbos fire on entering a shortcut, where the boost pays most
    if ((k.item === 'turbo' || k.item === 'turbo3') && k.inSc) use = true;
    if (use) {
      inp.item = true;
      inp.itemBack = back;
    }
  }
}
