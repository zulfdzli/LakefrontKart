/**
 * D73 living tracks: each race track has one signature event that happens once or twice a race, telegraphed a few
 * seconds before it lands in front of the leader.
 *
 * - Sunny Meadows, a flock of sheep wandering across a corner: touching one is a soft bump (speed lost, no spin).
 * - Dusty Canyon, a rockfall on a straight: rubble blocks one half of the road until the leader's next lap.
 * - Frosty Peaks, a giant snowball rolling down the mountainside and across the road: it flattens you into a spin.
 * - Sepang, a monsoon squall: one sector is soaked for a lap (less grip, puddles).
 *
 * Deterministic: the plan comes from its own seeded RNG (the race's other draws are untouched) and everything after
 * is plain simulation, so replays stay exact. The AI reacts by difficulty (Hard always, Easy about half the time).
 */
import { clamp } from './constants';
import { Rng } from './rng';
import { posOnTrack, type Track } from './track';
import type { Difficulty } from './ai';
import type { GameEvent, GameState, Kart } from './game';
import { puddlesFor, type Puddle } from './weather';

export type HazardKind = 'sheep' | 'rocks' | 'snowball' | 'squall';
export const HAZARD_OF: Readonly<Record<string, HazardKind>> = {
  meadows: 'sheep',
  canyon: 'rocks',
  frosty: 'snowball',
  sepang: 'squall',
};
export const HAZARD_NAME: Readonly<Record<HazardKind, string>> = {
  sheep: 'SHEEP ON THE TRACK',
  rocks: 'ROCKFALL',
  snowball: 'GIANT SNOWBALL',
  squall: 'MONSOON SQUALL',
};

export interface Sheep {
  /** Along the road from the spot (m), across it (m), walking speed across (m/s), bump wobble (s). */
  along: number;
  lat: number;
  v: number;
  bump: number;
}

export interface Hazard {
  kind: HazardKind;
  /** The spot (road sample); for a squall, the start of the soaked stretch, `len` samples long. */
  idx: number;
  len: number;
  /** The leader's lap (0-based) on which it happens. */
  lap: number;
  phase: 'idle' | 'warn' | 'active' | 'done';
  /** Seconds in the current phase. */
  t: number;
  /** Rocks: the blocked half (+1 right); sheep and snowball: the way they cross. */
  side: 1 | -1;
  sheep: Sheep[];
  /** Snowball: across the road (m), and its height above the road (m, hopping the walls). */
  ball: { lat: number; y: number } | null;
}

/** How long the warning runs before it lands (s), and how far ahead of the leader it lands (m). */
export const HAZARD_WARN: Readonly<Record<HazardKind, number>> = { sheep: 3, rocks: 2.5, snowball: 3, squall: 4 };
const LEAD: Readonly<Record<HazardKind, number>> = { sheep: 330, rocks: 260, snowball: 250, squall: 340 };
/** Rubble half-length (m), the snowball's radius (m) and speed across (m/s), a sheep's radius (m). */
export const ROCKS_HALF = 15;
export const BALL_R = 3.4;
const BALL_V = 10;
const SHEEP_R = 1.1;
/** Grip on the squall's soaked stretch. */
export const SQUALL_GRIP = 0.94;
/** Share of AI karts that see it coming, by difficulty. */
const REACT: Readonly<Record<Difficulty, number>> = { easy: 0.45, normal: 0.75, hard: 1 };

/** Where on a track its event happens: fixed per track, away from the start, jumps and crests. */
export function hazardSpot(T: Track, kind: HazardKind): { idx: number; len: number } {
  const N = T.N;
  // clear of crests and jumps from well before the spot (the run-up, where you brake or pick a line) to past it
  const clear = (i: number, span: number): boolean => {
    for (let o = -Math.round(130 / T.DS); o <= span; o++) {
      const j = (i + o + N) % N;
      if (T.airZone[j]) return false;
      for (const r of T.ramps) if ((j - r.i0 + N) % N <= ((r.i1 - r.i0 + N) % N) + 10) return false;
    }
    return true;
  };
  let best = -1,
    score = -Infinity;
  const span = Math.round(25 / T.DS);
  for (let i = Math.floor(N * 0.3); i < Math.floor(N * 0.85); i += 2) {
    if (!clear(i, span)) continue;
    const c = Math.abs(T.CURV[i]!);
    // sheep wander into a bend (the karts are slower there); rocks and the snowball land on a straight
    const sc = kind === 'sheep' ? -Math.abs(c - 0.35) : -c;
    if (sc > score) {
      score = sc;
      best = i;
    }
  }
  if (best < 0) best = Math.floor(N * 0.55);
  return { idx: best, len: kind === 'squall' ? Math.round(420 / T.DS) : 0 };
}

/** The race's events: one on a 1-lap race, two on longer ones (rocks and squall last a lap, so they come once). */
export function planHazards(T: Track, seed: number, laps: number): Hazard[] {
  const kind = HAZARD_OF[T.id];
  if (!kind) return [];
  const rng = new Rng((seed ^ 0x4a2a7d) >>> 0);
  const { idx, len } = hazardSpot(T, kind);
  const lasting = kind === 'rocks' || kind === 'squall';
  const count = laps >= 2 && !lasting ? 2 : 1;
  const lapsOrder = Array.from({ length: laps }, (_, i) => i);
  for (let i = lapsOrder.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [lapsOrder[i], lapsOrder[j]] = [lapsOrder[j]!, lapsOrder[i]!];
  }
  // a lasting event starts no later than the second-to-last lap, so the field gets to see it more than once
  const pool = lasting && laps >= 2 ? lapsOrder.filter((l) => l < laps - 1) : lapsOrder;
  return pool
    .slice(0, count)
    .sort((a, b) => a - b)
    .map((lap) => ({
      kind,
      idx,
      len,
      lap,
      phase: 'idle' as const,
      t: 0,
      side: rng.chance(0.5) ? 1 : -1,
      sheep: [],
      ball: null,
    }));
}

/** What the hazard step needs from the game. */
export interface HazardHooks {
  emit(e: GameEvent): void;
  spinOut(k: Kart): boolean;
}

const tmp = { x: 0, y: 0, z: 0 };
/** Along-track distance (m) from sample a forward to the kart, wrapped to ±half a lap. */
function alongTo(T: Track, i: number, k: Kart): number {
  let d = (k.idx - i) % T.N;
  if (d > T.N / 2) d -= T.N;
  if (d < -T.N / 2) d += T.N;
  return (d + k.frac) * T.DS;
}
export function inSquall(T: Track, h: Hazard, i: number): boolean {
  return h.kind === 'squall' && h.phase === 'active' && (i - h.idx + T.N) % T.N <= h.len;
}

/** One step of every event: its timeline, what it does to the karts, and the puddles a squall brings. */
export function stepHazards(s: GameState, dt: number, hooks: HazardHooks): void {
  if (!s.hazards.length || s.phase !== 'race') return;
  const T = s.track,
    N = T.N;
  let lead = -Infinity;
  for (const k of s.karts) if (!k.finished) lead = Math.max(lead, k.prog);
  if (lead === -Infinity) return;
  for (const k of s.karts) if (k.hazCool > 0) k.hazCool -= dt;

  s.hazards.forEach((h, hi) => {
    // karts start on lap 0 behind the line and are on lap 1 once over it: race lap L at the spot is (L + 1) laps in
    const spot = (h.lap + 1) * N + h.idx;
    h.t += dt;
    if (h.phase === 'idle') {
      if (lead < spot - LEAD[h.kind] / T.DS) return;
      h.phase = 'warn';
      h.t = 0;
      // what is coming shows during the warning, still: the flock grazing by the road, the ball up on the slope
      if (h.kind === 'sheep') {
        // a little flock, staggered along and across, ambling over from one side
        const rng = new Rng((s.seed + hi * 977) >>> 0);
        const hw = T.HW[h.idx]!;
        for (let i = 0; i < 6; i++)
          h.sheep.push({
            along: -16 + i * 6.4 + rng.range(-1.5, 1.5),
            lat: -h.side * Math.min(hw + 3 + rng.range(0, 7), T.WALLD[h.idx]! - 1.5),
            v: h.side * rng.range(1.6, 2.4),
            bump: 0,
          });
      }
      if (h.kind === 'snowball') h.ball = { lat: -h.side * (T.WALLD[h.idx]! + 12), y: 8 };
      hooks.emit({ type: 'hazardwarn', kart: -1, n: hi });
      return;
    }
    if (h.phase === 'warn') {
      if (h.t < HAZARD_WARN[h.kind]) return;
      h.phase = 'active';
      h.t = 0;
      if (h.kind === 'squall' && s.weather !== 'rain') {
        const extra: Puddle[] = puddlesFor(T).filter((p) => (p.i - h.idx + N) % N <= h.len);
        // a squall over a dry track: its own puddles, more of them than a rainy race spreads over this stretch
        for (const p of extra) s.puddles.push(p);
      }
      hooks.emit({ type: 'hazard', kart: -1, n: hi });
      return;
    }
    if (h.phase !== 'active') return;

    if (h.kind === 'sheep') {
      const hw = T.HW[h.idx]!;
      for (const sh of h.sheep) {
        sh.lat += sh.v * dt;
        if (sh.bump > 0) sh.bump -= dt;
      }
      if (h.sheep.every((sh) => sh.lat * h.side > hw + 4)) end(h);
      for (const k of s.karts) {
        if (k.air || k.rescue > 0 || k.out || k.hazCool > 0) continue;
        for (const sh of h.sheep) {
          posOnTrack(T, h.idx + sh.along / T.DS, sh.lat, tmp);
          const dx = k.x - tmp.x,
            dz = k.z - tmp.z;
          if (dx * dx + dz * dz > (SHEEP_R + 1.6) ** 2) continue;
          // a soft bump: the kart loses speed and is nudged aside, the sheep shuffles out of the way
          const d = Math.hypot(dx, dz) || 1;
          k.vx = k.vx * 0.55 + (dx / d) * 4;
          k.vz = k.vz * 0.55 + (dz / d) * 4;
          k.drifting = false;
          k.hazCool = 0.7;
          sh.lat += k.lat > sh.lat ? -1.6 : 1.6;
          sh.bump = 0.6;
          hooks.emit({ type: 'baa', kart: k.id, x: tmp.x, y: tmp.y, z: tmp.z });
          break;
        }
      }
    } else if (h.kind === 'rocks') {
      if (lead >= spot + N) {
        end(h);
        return;
      }
      for (const k of s.karts) {
        if (k.air || k.rescue > 0 || k.out) continue;
        const a = alongTo(T, h.idx, k);
        if (Math.abs(a) > ROCKS_HALF || k.lat * h.side < -1) continue;
        // into the rubble: a hard stop the first time, then shoved out towards the open half
        const rx = T.RX[k.idx]!,
          rz = T.RZ[k.idx]!;
        if (k.hazCool <= 0) {
          k.vx *= 0.4;
          k.vz *= 0.4;
          k.drifting = false;
          k.boost = 0;
          hooks.emit({ type: 'rockhit', kart: k.id, x: k.x, y: k.y, z: k.z });
        }
        k.hazCool = 0.4;
        // grinding through the rubble drags the kart down, and it is shoved out (moved, not just pushed: the tyres
        // would cancel a sideways push) towards the open half
        const drag = Math.exp(-3 * dt);
        k.vx *= drag;
        k.vz *= drag;
        k.x -= rx * h.side * 8 * dt;
        k.z -= rz * h.side * 8 * dt;
      }
    } else if (h.kind === 'snowball' && h.ball) {
      const b = h.ball,
        hw = T.HW[h.idx]!,
        wd = T.WALLD[h.idx]!;
      b.lat += h.side * BALL_V * dt;
      // rolling down the slope, hopping each wall, along the road between them
      const out = Math.abs(b.lat);
      b.y = out > wd ? Math.min(8, (out - wd) * 0.6) + 1.2 : out > hw ? Math.max(0, 1.2 - (wd - out) * 0.4) : 0;
      if (b.lat * h.side > wd + 14) end(h);
      posOnTrack(T, h.idx, b.lat, tmp);
      for (const k of s.karts) {
        if (k.rescue > 0 || k.out || k.y > tmp.y + b.y + BALL_R * 2) continue;
        const dx = k.x - tmp.x,
          dz = k.z - tmp.z;
        if (dx * dx + dz * dz < (BALL_R + 1.4) ** 2 && hooks.spinOut(k))
          hooks.emit({ type: 'squash', kart: k.id, x: k.x, y: k.y, z: k.z });
      }
    } else if (h.kind === 'squall') {
      if (lead >= spot + N + h.len) {
        end(h);
        if (s.weather !== 'rain') s.puddles = s.puddles.filter((p) => (p.i - h.idx + N) % N > h.len);
      }
    }
  });

  function end(h: Hazard): void {
    h.phase = 'done';
    h.t = 0;
    h.sheep = [];
    h.ball = null;
  }
}

/** Does this AI kart see this event coming? Fixed per kart and event, more often on harder difficulties. */
function reacts(s: GameState, k: Kart, hi: number): boolean {
  if (k.slot !== null) return true;
  let x = Math.imul(k.id + 11, 2654435761) ^ Math.imul(hi + 5, 40503);
  x = Math.imul(x ^ (x >>> 15), 2246822507);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296 < REACT[s.diff];
}

/** The AI's lane (m from the centre) around what is on the road ahead: the open half, or a gap in the flock. */
export function hazardLane(s: GameState, k: Kart, lane: number): number {
  const T = s.track,
    N = T.N;
  s.hazards.forEach((h, hi) => {
    if ((h.phase !== 'active' && h.phase !== 'warn') || !reacts(s, k, hi)) return;
    const ahead = ((h.idx - k.idx + N) % N) * T.DS;
    if (h.kind === 'rocks' && (ahead < 170 || ahead > T.LEN - ROCKS_HALF - 4))
      lane = -h.side * clamp(T.HW[h.idx]! * 0.5, 2.5, 6);
    if (h.kind === 'sheep' && h.phase === 'active' && ahead < 80) {
      // where each sheep will be when the kart gets there; take the lane furthest from all of them
      const tA = ahead / Math.max(8, k.sp),
        hw = T.HW[h.idx]! - 2;
      const room = (l: number): number =>
        Math.min(...h.sheep.map((sh) => Math.abs(sh.lat + sh.v * tA - l))) - Math.abs(l - lane) * 0.08;
      if (room(lane) < 3.4) {
        let best = lane;
        for (let l = -hw; l <= hw; l += 1) if (room(l) > room(best)) best = l;
        lane = best;
      }
    }
  });
  return lane;
}

/** Should the AI lift and brake to let the snowball roll past? */
export function hazardBrake(s: GameState, k: Kart): boolean {
  const T = s.track,
    N = T.N;
  let brake = false;
  s.hazards.forEach((h, hi) => {
    if (h.kind !== 'snowball' || !h.ball || h.phase !== 'active' || !reacts(s, k, hi)) return;
    const ahead = ((h.idx - k.idx + N) % N) * T.DS;
    if (ahead > 130) return;
    // when the ball is over this kart's line, and when the kart would reach the edge of its path: brake (in time
    // to stop short of it) if they would meet there
    const m = BALL_R + 2.6;
    const tIn = ((k.lat - h.ball.lat) * h.side - m) / BALL_V,
      tOut = ((k.lat - h.ball.lat) * h.side + m) / BALL_V;
    if (tOut <= 0) return;
    const v = Math.max(1, k.sp),
      edge = ahead - (BALL_R + 3.5),
      tA = Math.max(0, edge) / v;
    const stop = (v * v) / (2 * 40) + 6;
    // already at the path: never stop in it (drive on through)
    if (edge < 0.5) return;
    if ((tA < tOut + 0.4 && tA > tIn - 0.8 && edge < stop + 20) || (edge < 10 && tIn < 1.2)) brake = true;
  });
  return brake;
}
