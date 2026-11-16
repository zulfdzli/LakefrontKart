/**
 * Track geometry: a closed Catmull-Rom spline resampled to evenly spaced points,
 * plus elevation, slope, curvature and a smoothed racing line. Ported from the prototype.
 * Phase 8 replaces the hard-coded control points with TrackDef data.
 */
import { TWO_PI, clamp, wrapA } from './constants';

export interface Track {
  /** Number of samples. */
  N: number;
  /** Spacing between samples (m). */
  DS: number;
  /** Centreline length (m). */
  LEN: number;
  CX: number[];
  CZ: number[];
  /** Unit tangent. */
  TX: number[];
  TZ: number[];
  /** Unit right vector. */
  RX: number[];
  RZ: number[];
  /** Heading (atan2(tx, tz)). */
  ANG: number[];
  /** Height (m). */
  H: number[];
  /** Slope (dH / ds). */
  SL: number[];
  /** Heading change over ±6 samples. */
  CURV: number[];
  /** Racing-line lateral offset (m). */
  RLINE: number[];
}

export function buildTrack(ctrl: readonly (readonly [number, number])[], count: number, startOffset: number): Track {
  const n = ctrl.length,
    per = 60,
    dense: number[][] = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n]!,
      p1 = ctrl[i]!,
      p2 = ctrl[(i + 1) % n]!,
      p3 = ctrl[(i + 2) % n]!;
    for (let s = 0; s < per; s++) {
      const t = s / per,
        t2 = t * t,
        t3 = t2 * t,
        pt = [0, 0];
      for (let a = 0; a < 2; a++)
        pt[a] =
          0.5 *
          (2 * p1[a]! +
            (-p0[a]! + p2[a]!) * t +
            (2 * p0[a]! - 5 * p1[a]! + 4 * p2[a]! - p3[a]!) * t2 +
            (-p0[a]! + 3 * p1[a]! - 3 * p2[a]! + p3[a]!) * t3);
      dense.push(pt);
    }
  }
  const M = dense.length,
    cum = [0];
  for (let i = 1; i <= M; i++) {
    const a = dense[(i - 1 + startOffset) % M]!,
      b = dense[(i + startOffset) % M]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!));
  }
  const LEN = cum[M]!,
    DS = LEN / count,
    CX: number[] = [],
    CZ: number[] = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const target = i * DS;
    while (j < M - 1 && cum[j + 1]! < target) j++;
    const a = dense[(j + startOffset) % M]!,
      b = dense[(j + 1 + startOffset) % M]!;
    const f = (target - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!);
    CX.push(a[0]! + (b[0]! - a[0]!) * f);
    CZ.push(a[1]! + (b[1]! - a[1]!) * f);
  }
  const TX: number[] = [],
    TZ: number[] = [],
    RX: number[] = [],
    RZ: number[] = [],
    ANG: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i - 1 + count) % count,
      b = (i + 1) % count;
    let dx = CX[b]! - CX[a]!,
      dz = CZ[b]! - CZ[a]!;
    const l = Math.hypot(dx, dz);
    dx /= l;
    dz /= l;
    TX.push(dx);
    TZ.push(dz);
    RX.push(-dz);
    RZ.push(dx);
    ANG.push(Math.atan2(dx, dz));
  }
  const H: number[] = [],
    SL: number[] = [],
    CURV: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = (i / count) * TWO_PI;
    H.push(5.5 * Math.sin(2 * u + 0.6) + 3 * Math.sin(3 * u + 2.2) + 1.5 * Math.sin(5 * u + 0.3));
  }
  for (let i = 0; i < count; i++) SL.push((H[(i + 1) % count]! - H[(i - 1 + count) % count]!) / (2 * DS));
  for (let i = 0; i < count; i++) CURV.push(wrapA(ANG[(i + 6) % count]! - ANG[(i - 6 + count) % count]!));
  // racing line: lateral offset toward the inside of each corner, smoothed so the AI moves over early
  let line = CURV.map((c) => clamp(-c * 14, -8.5, 8.5));
  for (let pass = 0; pass < 3; pass++) {
    const nl: number[] = [];
    for (let i = 0; i < count; i++) {
      let s = 0;
      for (let o = -10; o <= 10; o++) s += line[(i + o + count) % count]!;
      nl.push(s / 21);
    }
    line = nl;
  }
  return { N: count, DS, LEN, CX, CZ, TX, TZ, RX, RZ, ANG, H, SL, CURV, RLINE: line };
}

/** The prototype's track (about 1.28 km). Replaced by full-length TrackDefs in phase 8. */
export const PROTO_TRACK_SCALE = 0.8;
export const PROTO_CTRL: readonly (readonly [number, number])[] = (
  [
    [0, -220], [140, -210], [230, -120], [210, 0], [120, 60], [150, 150], [60, 230],
    [-60, 200], [-120, 110], [-220, 130], [-270, 20], [-200, -90], [-90, -110], [-60, -190],
  ] as const
).map((p) => [p[0] * PROTO_TRACK_SCALE, p[1] * PROTO_TRACK_SCALE] as const);

export function buildPrototypeTrack(): Track {
  return buildTrack(PROTO_CTRL, 400, 30);
}

/** Anything that sits on the track and needs its track-relative position updated. */
export interface Locatable {
  x: number;
  z: number;
  y: number;
  idx: number;
  lat: number;
  frac: number;
  slope?: number;
}

/** Find the nearest centreline sample (local search near the last one, or a global search) and update lat/frac/height. */
export function locate(T: Track, k: Locatable, glob: boolean): void {
  const { N, CX, CZ, RX, RZ, TX, TZ, DS, H, SL } = T;
  let best = k.idx,
    bd = 1e18;
  if (glob) {
    for (let i = 0; i < N; i++) {
      const dx = k.x - CX[i]!,
        dz = k.z - CZ[i]!,
        d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  } else {
    for (let o = -8; o <= 8; o++) {
      const i = (k.idx + o + N) % N,
        dx = k.x - CX[i]!,
        dz = k.z - CZ[i]!,
        d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
  }
  const dx = k.x - CX[best]!,
    dz = k.z - CZ[best]!;
  k.idx = best;
  k.lat = dx * RX[best]! + dz * RZ[best]!;
  k.frac = clamp((dx * TX[best]! + dz * TZ[best]!) / DS, -0.5, 0.5);
  const j = k.frac >= 0 ? (best + 1) % N : (best - 1 + N) % N;
  k.y = H[best]! + (H[j]! - H[best]!) * Math.abs(k.frac);
  k.slope = SL[best]!;
}

/** World position of a track-relative point (progress in samples, lateral offset in m). */
export function posOnTrack(T: Track, prog: number, lat: number, out: { x: number; y: number; z: number }): void {
  const { N, CX, CZ, RX, RZ, H } = T;
  const tt = ((prog % N) + N) % N,
    i = Math.floor(tt),
    f = tt - i,
    j = (i + 1) % N;
  out.x = CX[i]! + (CX[j]! - CX[i]!) * f + RX[i]! * lat;
  out.z = CZ[i]! + (CZ[j]! - CZ[i]!) * f + RZ[i]! * lat;
  out.y = H[i]! + (H[j]! - H[i]!) * f;
}
