/**
 * AI driver: follows the racing line with a personal lane offset, avoids oil, overtakes,
 * slows for corners, drifts and uses items. Ported from the prototype; rubber-banding now
 * compares against the average progress of the human players (section 8.4).
 */
import { clamp, wrapA, BOOSTSP } from './constants';
import type { GameState, Kart } from './game';

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
}

export const DIFF: Record<Difficulty, DifficultyTable> = {
  easy: {
    skill: [0.85, 0.835, 0.825, 0.815, 0.8],
    drift: [1, 0, 1, 0, 0],
    corner: 1.15,
    start: 0.1,
    items: 0.6,
    rb: [0.93, 1.03],
  },
  normal: {
    skill: [0.96, 0.945, 0.935, 0.92, 0.905],
    drift: [1, 1, 1, 0, 1],
    corner: 1.0,
    start: 0.35,
    items: 1.0,
    rb: [0.95, 1.04],
  },
  hard: {
    skill: [1.0, 0.995, 0.985, 0.975, 0.965],
    drift: [1, 1, 1, 1, 1],
    corner: 0.9,
    start: 0.65,
    items: 1.4,
    rb: [0.97, 1.05],
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
  for (const c of s.karts) {
    if (c === k || c.rescue > 0) continue;
    const d = c.prog - k.prog;
    if (d > 0.3 && d < 4.5 && Math.abs(c.lat - lane) < 3 && c.sp < sp + 1) {
      lane = c.lat + (lane >= c.lat ? 4.5 : -4.5);
      break;
    }
  }
  lane = clamp(lane, -10, 10);
  const tx = CX[j]! + RX[j]! * lane,
    tz = CZ[j]! + RZ[j]! * lane;
  const diff = wrapA(Math.atan2(tx - k.x, tz - k.z) - k.h);
  inp.steer = clamp(-diff * 2.6, -1, 1);

  const ahead = Math.round((8 + Math.max(0, sp) * 1.0) / DS);
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
  target = Math.min(target, Math.max(17 * s.handling.speedMul, k.P.top - turnAng * 38 * a.corner));
  if (k.boost > 0) target = BOOSTSP * s.handling.speedMul;
  if (Math.abs(diff) > 1.0) target = Math.min(target, 9); // target far off the nose: slow down so the turn tightens
  inp.throttle = sp < target;
  inp.brake = sp > target + 5;
  const Hd = s.handling;
  if (a.drifts)
    inp.drift = k.drifting ? turnAng > Hd.aiDriftHold : turnAng > Hd.aiDriftIn && sp > 22 && Math.abs(inp.steer) > 0.5;
  else inp.drift = false;

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
    }
    if (use) {
      inp.item = true;
      inp.itemBack = back;
    }
  }
}
