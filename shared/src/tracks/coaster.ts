/**
 * D65 roller-coaster pass: fills a track with crests (hills that float the kart off the top), dips (drops into a
 * compression, banked through corners) and extra jumps, so that something happens every few seconds.
 *
 * It estimates how fast a kart drives each part of the lap (corner radius, braking and acceleration), places the
 * def's own jumps, pads and item rows on that timeline, then fills every gap longer than BIG_SPACING seconds
 * between "big" moments (a jump, a crest or a dip) with new ones. The kind follows the road: jumps and crests on
 * straights (a jump needs a straight landing), dips anywhere, banked when they fall in a corner.
 *
 * Plain arrays in, plain data out: buildTrackFromDef applies the height bumps, the banking and the ramps.
 */
import { clamp, wrapA } from '../constants';
import type { BeatKind, RampKind } from '../track';
import type { RampDef } from './def';

/** Target time between big moments (s, estimated). The sim check allows 4 s, the estimate is a little rough. */
const BIG_SPACING = 2.1;
/** Game gravity (m/s², as the jump physics). */
const G = 30;
/**
 * Speed estimate, shaped like the Normal AI (ai.ts): its pace on a straight (m/s) minus CORNER_K times the heading
 * change over the next 8 m + speed, never under V_MIN; then braking and acceleration limits. The constants are a
 * least-squares fit to the Normal AI's measured speed on all four tracks (D65): laps within 3%.
 */
/**
 * D67: karts are 5% slower (speedMul 1.45 to 1.3775), so the whole estimate is too. D76: with no boosts (and D75's 4%
 * slower karts) the field is about 16% slower round a lap, so the crests are re-shaped for that pace: they float the
 * karts again, and the big moments come every few seconds of the slower lap.
 */
const PACE = 0.81;
const V_TOP = 59 * PACE;
/** Lower than the fit's 36: hairpins are where the estimate errs, and erring slow places more, not fewer. */
const V_MIN = 26 * PACE;
const CORNER_K = 30 * PACE;
const A_BRAKE = 30 * PACE;
const A_ACC = 12 * PACE;

export interface CoasterInput {
  N: number;
  DS: number;
  ANG: readonly number[];
  HW: readonly number[];
  /** Samples where nothing may be placed (grid, bridges, shortcut mouths). */
  blocked: readonly boolean[];
  /** Samples where only a dip may go (tunnels, arches: a dip only adds headroom). */
  dipOnly: readonly boolean[];
  /** Landmarks counted as moments (tunnel and arch entries, bridges, shortcut mouths). */
  marks: readonly number[];
  /** The def's own jumps: lip sample and the samples they cover (run-up to landing). */
  ramps: readonly { i1: number; from: number; to: number }[];
  pads: readonly number[];
  rows: readonly number[];
  /**
   * D81: 'ramps' places single jumps only (no crests, dips or runs of whoops: the road stays flat between them),
   * `spacing` seconds apart at most (default BIG_SPACING).
   */
  only?: 'ramps';
  spacing?: number;
}

export interface Bump {
  /** Centre sample. */
  idx: number;
  /** Height (m): positive for a crest, negative for a dip. */
  amp: number;
  /** Gaussian width (m). */
  sigma: number;
  /** Extra banking at the centre (degrees, positive raises the right-hand edge). */
  bank: number;
}

export interface CoasterPlan {
  bumps: Bump[];
  ramps: RampDef[];
  beats: { idx: number; kind: BeatKind }[];
  /** Samples over the crests, where a kart may float (Track.airZone). */
  airZone: boolean[];
  /** Estimated seconds to each sample from the line (for reports). */
  time: number[];
}

/** Gaussian height profile truncated at ±3σ (0 at the ends, 1 at the centre). */
export function bumpShape(s: number, sigma: number): number {
  const g3 = Math.exp(-4.5);
  if (Math.abs(s) >= 3 * sigma) return 0;
  return (Math.exp(-(s * s) / (2 * sigma * sigma)) - g3) / (1 - g3);
}

/** Estimated race speed per sample (m/s): corner limits, then braking into and accelerating out of them. */
export function speedProfile(N: number, DS: number, ANG: readonly number[]): number[] {
  const v: number[] = new Array<number>(N).fill(40);
  for (let it = 0; it < 3; it++)
    for (let i = 0; i < N; i++) {
      const ahead = Math.round((8 + v[i]!) / DS);
      const turn = Math.abs(wrapA(ANG[(i + ahead) % N]! - ANG[i]!));
      v[i] = clamp(V_TOP - turn * CORNER_K, V_MIN, V_TOP);
    }
  for (let pass = 0; pass < 2; pass++) {
    for (let k = 2 * N; k > 0; k--) {
      const i = k % N,
        j = (i + 1) % N;
      v[i] = Math.min(v[i]!, Math.sqrt(v[j]! ** 2 + 2 * A_BRAKE * DS));
    }
    for (let k = 1; k <= 2 * N; k++) {
      const i = k % N,
        j = (i - 1 + N) % N;
      v[i] = Math.min(v[i]!, Math.sqrt(v[j]! ** 2 + 2 * A_ACC * DS));
    }
  }
  return v;
}

const RAMP_CYCLE: readonly (RampKind | 'whoops')[] = ['kicker', 'table', 'whoops', 'lane', 'launch'];
/** Rough air time per jump kind (s), for the landing room it needs. */
const AIR: Record<RampKind | 'whoops', number> = {
  // D67: about a quarter more with the stronger pops
  kicker: 0.7,
  table: 1.0,
  whoop: 0.5,
  whoops: 0.5,
  lane: 0.75,
  launch: 1.35,
};
const RUN: Record<RampKind | 'whoops', number> = { kicker: 9, table: 26, whoop: 6, whoops: 6, lane: 10, launch: 20 };
/** Tightest bend (radius, m) each jump's run-up and landing may have: the kart flies straight while the road bends. */
const RAMP_R: Record<RampKind | 'whoops', number> = {
  kicker: 75,
  table: 110,
  whoop: 65,
  whoops: 65,
  lane: 85,
  launch: 150,
};
/** A crest's float is short: a gentle bend under it is fine, and so is a little braking after it. */
const CREST_R = 60;
/**
 * D77: gentler hills: a dip compresses at 1.1 g (was 1.45), at most 4 m. D78: at most two crests a track, soft ones:
 * shaped for 0.9 g at the estimated speed (the kart stays on the road over the top) and at most 3 m high.
 */
const CREST_G = 0.9;
const CREST_MAX = 3;
const MAX_CRESTS = 2;
const DIP_G = 1.1;
const BUMP_MAX = 4;
const CREST_PACE = 0.6;

export function planCoaster(inp: CoasterInput): CoasterPlan {
  const { N, DS, ANG, HW, blocked } = inp;
  const SPACING = inp.spacing ?? BIG_SPACING;
  const v = speedProfile(N, DS, ANG);
  const time: number[] = [0];
  for (let i = 1; i <= N; i++) time.push(time[i - 1]! + DS / v[i - 1]!);
  const LAP = time[N]!;
  // heading change per metre, and the worst of it over a span of samples
  const kap: number[] = [];
  for (let i = 0; i < N; i++) kap.push(wrapA(ANG[(i + 1) % N]! - ANG[(i - 1 + N) % N]!) / (2 * DS));
  const used = blocked.slice();
  const free = (a: number, b: number, dip = false): boolean => {
    for (let k = a; k <= b; k++) {
      const i = ((k % N) + N) % N;
      if (used[i] || (!dip && inp.dipOnly[i])) return false;
    }
    return true;
  };
  const straight = (a: number, b: number, maxK: number): boolean => {
    for (let k = a; k <= b; k++) if (Math.abs(kap[((k % N) + N) % N]!) > maxK) return false;
    return true;
  };
  /**
   * Full pace from the run-up a to 50 m past the landing b: a kart cannot brake in the air, so a jump or crest never
   * lands into a braking zone.
   */
  const noBrake = (a: number, b: number, pace = 0.72): boolean => {
    for (let k = a; k <= b + m(50); k++) if (v[((k % N) + N) % N]! < V_TOP * pace) return false;
    return true;
  };
  const take = (a: number, b: number): void => {
    for (let k = a; k <= b; k++) used[((k % N) + N) % N] = true;
  };
  const m = (metres: number): number => Math.round(metres / DS);

  const beats: { idx: number; kind: BeatKind }[] = [];
  const bigAt: number[] = [];
  for (const r of inp.ramps) {
    take(r.from, r.to);
    beats.push({ idx: r.i1, kind: 'ramp' });
    bigAt.push(r.i1);
  }
  for (const p of inp.pads) beats.push({ idx: p, kind: 'pad' });
  for (const r of inp.rows) beats.push({ idx: r, kind: 'items' });
  for (const l of inp.marks) beats.push({ idx: l, kind: 'landmark' });
  // sharp corners are slide moments (a drift): the apex of every stretch turning over 40° within 60 m
  {
    const w = m(30),
      turn = (i: number): number => Math.abs(wrapA(ANG[(i + w) % N]! - ANG[(i - w + N) % N]!));
    const TH = (40 * Math.PI) / 180;
    for (let i = 0; i < N; i++) {
      const t = turn(i);
      if (t < TH) continue;
      let peak = true;
      for (let o = -w; o <= w && peak; o++) if (o && turn((i + o + N) % N) > t) peak = false;
      if (peak) {
        beats.push({ idx: i, kind: 'corner' });
        bigAt.push(i);
      }
    }
  }

  const bumps: Bump[] = [];
  const ramps: RampDef[] = [];
  const airZone = new Array<boolean>(N).fill(false);
  let kindTurn = 0,
    rampTurn = 0,
    laneSide = 1,
    crests = 0;

  /** Try to place one big moment at sample c; returns the kind placed, or null. */
  const tryAt = (c: number): BeatKind | null => {
    const vc = v[c]!;
    for (let t = 0; t < 3; t++) {
      const want = inp.only === 'ramps' ? 'ramp' : (['crest', 'ramp', 'dip'] as const)[(kindTurn + t) % 3]!;
      // D78: two crests a track at most; the rest of the moments are jumps and dips
      if (want === 'crest' && crests >= MAX_CRESTS) continue;
      if (want === 'ramp') {
        // the next jump kind in the cycle that fits here
        let rk: RampKind | 'whoops' | null = null,
          a = 0,
          b = 0;
        const count = (k: RampKind | 'whoops'): number => (k === 'whoops' ? 3 : 1),
          gap = 26;
        for (let q = 0; q < RAMP_CYCLE.length && !rk; q++) {
          const k = RAMP_CYCLE[(rampTurn + q) % RAMP_CYCLE.length]!;
          if (inp.only === 'ramps' && k === 'whoops') continue;
          const ka = c - m(RUN[k] + 8),
            kb = c + m(vc * AIR[k] + 18 + (count(k) - 1) * gap);
          if (vc >= 30 && free(ka, kb) && straight(ka, kb, 1 / RAMP_R[k]) && noBrake(ka, kb)) {
            rk = k;
            a = ka;
            b = kb;
            rampTurn += q;
          }
        }
        if (!rk) continue;
        take(a - m(10), b + m(6));
        const def: RampDef = { at: c / N, kind: rk };
        if (rk === 'whoops') {
          def.count = count(rk);
          def.gap = gap;
        }
        if (rk === 'lane') {
          const w = HW[c]! - 0.5;
          def.lat = laneSide > 0 ? [1.5, w] : [-w, -1.5];
          laneSide = -laneSide;
        }
        ramps.push(def);
        rampTurn++;
        kindTurn = (kindTurn + t + 1) % 3;
        return 'ramp';
      }
      for (const sigma of want === 'crest' ? [15, 12, 10] : [16, 13, 10, 8]) {
        const a = c - m(3 * sigma),
          b = c + m(3 * sigma) + (want === 'crest' ? m(25) : 0);
        if (!free(a, b, want === 'dip')) continue;
        if (want === 'crest') {
          // a crest that floats the kart (D77: just past gravity at the estimated speed, and at most 4 m high: a gentle
          // lift, not a launch; it was a quarter past gravity and up to 6 m), on a straight
          if (vc < 30 || !straight(a, b, 1 / CREST_R) || !noBrake(a, b, CREST_PACE)) continue;
          const amp = clamp((CREST_G * G * sigma * sigma) / (vc * vc), 1.2, CREST_MAX);
          take(a - m(6), b + m(6));
          bumps.push({ idx: c, amp, sigma, bank: 0 });
          crests++;
          for (let o = -m(1.6 * sigma); o <= m(1.6 * sigma); o++) airZone[(c + o + N) % N] = true;
        } else {
          // a dip: the compression at the bottom stays under about 1.5 g and its rim never floats the kart; in a
          // corner it banks into the turn like a coaster's valley turn
          const amp = -clamp((DIP_G * G * sigma * sigma) / (vc * vc), 1.6, BUMP_MAX);
          let k = 0;
          for (let o = -m(sigma); o <= m(sigma); o++) k += kap[(c + o + N) % N]!;
          k /= 2 * m(sigma) + 1;
          const bank = clamp(k * 1500, -12, 12);
          take(a - m(6), b + m(6));
          bumps.push({ idx: c, amp, sigma, bank: Math.abs(bank) > 2 ? bank : 0 });
        }
        kindTurn = (kindTurn + t + 1) % 3;
        return want;
      }
    }
    return null;
  };

  // fill every long gap between big moments, walking the lap in time order
  const sortedBig = (): number[] => [...bigAt].sort((x, y) => time[x]! - time[y]!);
  let guard = 0;
  for (;;) {
    if (++guard > 400) break;
    const S = sortedBig();
    let worst = -1,
      wGap = 0;
    if (!S.length) {
      worst = 0;
      wGap = LAP;
    } else
      for (let n = 0; n < S.length; n++) {
        const a = S[n]!,
          b = S[(n + 1) % S.length]!;
        const g = S.length === 1 ? LAP : (time[b]! - time[a]! + LAP) % LAP;
        if (g > wGap) {
          wGap = g;
          worst = n;
        }
      }
    if (wGap <= SPACING) break;
    const a = S.length ? S[worst]! : 0;
    // place the next moment BIG_SPACING after a (or as near to it as the road allows: search back towards a first,
    // so the gap shrinks, then forward)
    const tA = time[a]!;
    const atTime = (t: number): number => {
      const tt = ((t % LAP) + LAP) % LAP;
      let lo = 0,
        hi = N - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (time[mid]! < tt) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const target = atTime(tA + Math.min(SPACING, wGap / 2 + 0.4));
    let placed: number | null = null;
    for (let d = 0; d < m(120) && placed === null; d++)
      for (const c of [target - d, target + d]) {
        const ci = ((c % N) + N) % N;
        if ((time[ci]! - tA + LAP) % LAP < 0.9) continue; // too close to the moment before
        const kind = tryAt(ci);
        if (kind) {
          placed = ci;
          beats.push({ idx: ci, kind });
          bigAt.push(ci);
          break;
        }
      }
    if (placed === null) {
      // nothing fits in this gap (a tunnel, a long hairpin complex): mark it done so the loop moves on
      bigAt.push(target);
    }
  }
  beats.sort((x, y) => x.idx - y.idx);
  return { bumps, ramps, beats, airZone, time: time.slice(0, N) };
}
