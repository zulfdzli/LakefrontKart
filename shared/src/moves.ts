/**
 * D74 signature moves: each character has one move of its own, charged by driving well (drifting, airtime and
 * slipstreaming, with a trickle besides) and fired with the MOVE button when the meter is full. Each is worth about
 * one item and charges in about a lap of good driving; the headless races keep the characters within the 4% spread.
 *
 * - Bruno, Shoulder Charge: a short lunge (a mini boost) that shoves a kart beside him off its line.
 * - Pip, Belly Slide: a low, slippery dash: a boost, and oil slicks slide off him for a moment.
 * - Zed, Overclock: for a few seconds his engine pulls 60% harder (top speed unchanged): out of every corner first.
 *   (D76: it used to double his drift charge; with no drift boosts that would do nothing.)
 * - Mochi, Mirage: vanishes in a puff (a short boost), leaving a decoy where she was; the next homing item after
 *   her (or a Disc that runs into it) takes the decoy.
 * - Gus, Hop: a big jump on demand: over oil, rubble or a sheep, with a landing boost if he lands straight.
 * - Luna, Night Eyes: for a few seconds the best line shows, her tyres hold a little better, and the first Orb or
 *   Disc that would hit her is dodged.
 */
import { wrapA } from './constants';
import type { Difficulty } from './ai';
import type { GameEvent, GameState, Kart } from './game';

export type MoveId = 'charge' | 'slide' | 'overclock' | 'mirage' | 'hop' | 'nighteyes';
export const MOVE_OF: Readonly<Record<string, MoveId>> = {
  bruno: 'charge',
  pip: 'slide',
  zed: 'overclock',
  mochi: 'mirage',
  gus: 'hop',
  luna: 'nighteyes',
};
export const MOVE_INFO: Readonly<Record<MoveId, { name: string; icon: string }>> = {
  charge: { name: 'Shoulder Charge', icon: '💥' },
  slide: { name: 'Belly Slide', icon: '🛷' },
  overclock: { name: 'Overclock', icon: '⚡' },
  mirage: { name: 'Mirage', icon: '👻' },
  hop: { name: 'Hop', icon: '🦘' },
  nighteyes: { name: 'Night Eyes', icon: '👁️' },
};

/** Meter gained per second: drifting, in the air, in a slipstream, and always. Full is 1. */
export const MOVE_CHARGE = { drift: 0.026, air: 0.055, draft: 0.04, base: 0.0035 } as const;
/** Effect lengths (s), and their strengths. */
export const SLIDE_T = 2.2;
export const OVERCLOCK_T = 6;
/** D76: Overclock's pull (acceleration multiplier). */
export const OVERCLOCK_ACC = 1.6;
export const MIRAGE_T = 7;
export const EYES_T = 6;
export const EYES_GRIP = 1.05;
const CHARGE_BOOST = 0.45;
/** Mochi vanishes in a puff: a short boost (so the move is worth something in a race without items too). */
const MIRAGE_BOOST = 0.5;
const SLIDE_BOOST = 1.1;
const HOP_VY = 11;
/** How long an AI holds a full meter before it looks for a chance to use it, by difficulty. */
const PATIENCE: Readonly<Record<Difficulty, number>> = { easy: 6, normal: 2, hard: 0 };

export interface Decoy {
  idx: number;
  lat: number;
  x: number;
  y: number;
  z: number;
  /** Seconds left. */
  t: number;
}

export interface MoveHooks {
  emit(e: GameEvent): void;
  giveBoost(k: Kart, t: number): void;
}

/** The kart beside this one that a Shoulder Charge would hit (nearest, roughly level and to one side), or null. */
export function chargeTarget(s: GameState, k: Kart): Kart | null {
  const fx = Math.sin(k.h),
    fz = Math.cos(k.h);
  let best: Kart | null = null,
    bd = 1e9;
  for (const c of s.karts) {
    if (c === k || c.out || c.rescue > 0 || Math.abs(c.y - k.y) > 1.6) continue;
    const dx = c.x - k.x,
      dz = c.z - k.z;
    const along = dx * fx + dz * fz,
      side = dx * fz - dz * fx;
    if (Math.abs(along) > 4.5 || Math.abs(side) < 1.2 || Math.abs(side) > 7.5) continue;
    const d = Math.hypot(dx, dz);
    if (d < bd) {
      bd = d;
      best = c;
    }
  }
  return best;
}

function activate(s: GameState, k: Kart, hooks: MoveHooks): void {
  const m = MOVE_OF[k.ch.id];
  if (!m) return;
  k.meter = 0;
  k.moveHold = 0;
  hooks.emit({ type: 'move', kart: k.id, n: Object.keys(MOVE_INFO).indexOf(m) });
  switch (m) {
    case 'charge': {
      hooks.giveBoost(k, CHARGE_BOOST);
      const c = chargeTarget(s, k);
      if (!c || c.invuln > 0 || c.spin > 0) break;
      if (c.shield > 0) {
        c.shield = 0;
        c.invuln = 0.6;
        hooks.emit({ type: 'shieldpop', kart: c.id });
        break;
      }
      // shoved sideways, away from Bruno, losing a little speed and any drift
      const dx = c.x - k.x,
        dz = c.z - k.z;
      const fx = Math.sin(k.h),
        fz = Math.cos(k.h);
      const sgn = dx * fz - dz * fx > 0 ? 1 : -1;
      const rx = fz * sgn,
        rz = -fx * sgn;
      c.vx = c.vx * 0.8 + rx * 10;
      c.vz = c.vz * 0.8 + rz * 10;
      c.drifting = false;
      c.driftT = 0;
      c.driftLevel = 0;
      hooks.emit({ type: 'shoved', kart: c.id, other: k.id, x: c.x, y: c.y, z: c.z });
      break;
    }
    case 'slide':
      hooks.giveBoost(k, SLIDE_BOOST);
      k.slideT = SLIDE_T;
      break;
    case 'overclock':
      k.overT = OVERCLOCK_T;
      break;
    case 'mirage':
      k.decoy = { idx: k.idx, lat: k.lat, x: k.x, y: k.y, z: k.z, t: MIRAGE_T };
      hooks.giveBoost(k, MIRAGE_BOOST);
      break;
    case 'hop':
      if (k.air) break;
      k.air = true;
      k.ay = k.y + 0.05;
      k.alt = 0.05;
      k.vy = HOP_VY;
      k.airT = 0;
      break;
    case 'nighteyes':
      k.eyesT = EYES_T;
      k.eyesDodge = true;
      break;
  }
}

/** One step of every kart's move: the meter, the effects running down, and a MOVE press. */
export function stepMoves(s: GameState, dt: number, hooks: MoveHooks): void {
  const racing = s.phase === 'race';
  for (const k of s.karts) {
    if (k.slideT > 0) k.slideT -= dt;
    if (k.overT > 0) k.overT -= dt;
    if (k.eyesT > 0) k.eyesT -= dt;
    if (k.decoy && (k.decoy.t -= dt) <= 0) k.decoy = null;
    const press = !!k.input.move;
    k.input.move = false;
    if (!racing || k.out || k.finished) continue;
    if (k.spin <= 0 && k.rescue <= 0 && k.meter < 1) {
      const C = MOVE_CHARGE;
      k.meter = Math.min(
        1,
        k.meter + dt * (C.base + (k.drifting ? C.drift : 0) + (k.air ? C.air : 0) + (k.drafting ? C.draft : 0)),
      );
    }
    k.moveHold = k.meter >= 1 ? k.moveHold + dt : 0;
    if (press && k.meter >= 1 && k.spin <= 0 && k.rescue <= 0) activate(s, k, hooks);
  }
}

/** The AI's MOVE press: once its patience is up, when the moment suits its move. */
export function aiMove(s: GameState, k: Kart): boolean {
  if (k.meter < 1) return false;
  const m = MOVE_OF[k.ch.id];
  if (!m) return false;
  const wait = k.slot !== null ? 0 : PATIENCE[s.diff];
  const held = k.moveHold - wait;
  if (held < 0) return false;
  const T = s.track,
    N = T.N;
  const turnAhead = (m: number): number => Math.abs(wrapA(T.ANG[(k.idx + Math.round(m / T.DS)) % N]! - T.ANG[k.idx]!));
  const slickAhead = (dist: number): boolean =>
    s.slicks.some((sl) => {
      const d = ((sl.idx - k.idx + N) % N) * T.DS;
      return d > 3 && d < dist && Math.abs(sl.lat - k.lat) < 4;
    });
  const hazardAhead = (dist: number): boolean =>
    s.hazards.some((h) => {
      if (h.phase !== 'active' || (h.kind !== 'rocks' && h.kind !== 'sheep')) return false;
      const d = ((h.idx - k.idx + N) % N) * T.DS;
      return d > 4 && d < dist;
    });
  switch (m) {
    case 'charge':
      return chargeTarget(s, k) !== null || held > 10;
    case 'slide':
      return slickAhead(40) || (held > 3 && turnAhead(70) < 0.25);
    case 'overclock':
      // coming out of a corner, or slowed by a hit or a bump
      return (turnAhead(30) < 0.25 && k.sp < k.P.top * 0.8) || held > 6;
    case 'mirage':
      return k.threat > 0 || held > 8;
    case 'hop':
      if (k.air || turnAhead(50) > 0.3) return false;
      return slickAhead(28) || hazardAhead(26) || held > 4;
    case 'nighteyes':
      return k.threat > 0 || turnAhead(60) > 0.5 || held > 5;
  }
  return false;
}

/** Does a homing item aimed at this kart go for its decoy instead (the decoy is between it and the kart)? */
export const decoyOf = (k: Kart | null): Decoy | null => (k && k.decoy && k.decoy.t > 0 ? k.decoy : null);
