/**
 * Track geometry: a closed Catmull-Rom spline resampled to evenly spaced points,
 * plus elevation, slope, curvature and a smoothed racing line. Ported from the prototype.
 *
 * Phase 8: a Track also carries per-sample road width, wall distance and banking, surface zones, checkpoint
 * gates, sectors, pads, item rows, jump ramps and shortcut corridors. Real tracks come from TrackDef data
 * (shared/src/tracks/); the prototype track keeps its exact original numbers (parity test).
 */
import { KERB_W, ROAD_HALF, TWO_PI, WALL, clamp, wrapA } from './constants';

/* ---------------- surfaces (section 11.2) ---------------- */

export type SurfaceId = 'asphalt' | 'kerb' | 'ice' | 'grass' | 'dirt' | 'gravel' | 'sand' | 'snow';

export interface SurfaceParams {
  /** Sideways grip (1/s) when not drifting. */
  grip: number;
  /** Top speed on this surface (m/s, before the game speed multiplier), or null for the kart's own top speed. */
  cap: number | null;
  /** Extra speed bleed (1/s). */
  drag: number;
  /** Off the road: slower, no drift-free grip, counts towards the off-track rescue. */
  off: boolean;
  /** Low grip that also limits drift grip (ice). */
  slick?: boolean;
}

/** Grass keeps the prototype's exact off-road numbers (cap 15, drag 0.8, grip 4). */
export const SURF: Readonly<Record<SurfaceId, Readonly<SurfaceParams>>> = {
  asphalt: { grip: 9, cap: null, drag: 0, off: false },
  kerb: { grip: 9, cap: null, drag: 0, off: false },
  ice: { grip: 1.7, cap: null, drag: 0, off: false, slick: true },
  grass: { grip: 4, cap: 15, drag: 0.8, off: true },
  dirt: { grip: 5.5, cap: 26, drag: 0.3, off: true },
  gravel: { grip: 3.2, cap: 11, drag: 1.6, off: true },
  sand: { grip: 3.8, cap: 14, drag: 1, off: true },
  snow: { grip: 4.2, cap: 16, drag: 0.7, off: true },
};

/** A surface patch: samples [i0, i1] (inclusive, may wrap), lateral range in metres. */
export interface LatZone {
  latMin: number;
  latMax: number;
  surface: SurfaceId;
}

/** A jump ramp: the road rises over samples [i0, i1] by `lift` metres, then drops back; crossing i1 launches. */
export interface Ramp {
  i0: number;
  i1: number;
  lift: number;
}

/**
 * A risk/reward shortcut: a corridor (polyline, half-width) that leaves the road and rejoins it further on.
 * Inside it there are no road walls; its own edges act as walls.
 */
export interface Shortcut {
  /** Polyline points [x0, z0, x1, z1, ...]. */
  pts: number[];
  half: number;
  surface: SurfaceId;
  /** Road samples where it leaves and rejoins. */
  i0: number;
  i1: number;
}

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
  /** Track id ('proto' for the prototype track). */
  id: string;
  /** Road half-width per sample (m). */
  HW: number[];
  /** Wall distance from the centreline per sample (m). */
  WALLD: number[];
  /** Half the distance to the nearest unrelated part of the road (m): roadside art must stay inside it. */
  CLEAR: number[];
  /** tan(banking) per sample: the road surface height changes by lat * BT. */
  BT: number[];
  /** Surface beyond the kerbs when no zone says otherwise. */
  offroad: SurfaceId;
  /** Surface patches per sample, or null. */
  zones: (LatZone[] | null)[];
  /** Ordered checkpoint gates (sample indices, ascending, excluding the start line at 0). */
  gates: number[];
  /** Sector start samples (the first is 0). Each later one is also a gate. */
  sectors: number[];
  /** Boost pads. */
  pads: { idx: number; lat: number }[];
  /** Item box rows (sample indices). */
  boxRows: number[];
  ramps: Ramp[];
  shortcuts: Shortcut[];
}

/** Defaults that reproduce the prototype exactly (constant width, no banking, no gates). */
export function prototypeExtras(
  N: number,
): Omit<Track, 'N' | 'DS' | 'LEN' | 'CX' | 'CZ' | 'TX' | 'TZ' | 'RX' | 'RZ' | 'ANG' | 'H' | 'SL' | 'CURV' | 'RLINE'> {
  return {
    id: 'proto',
    HW: new Array<number>(N).fill(ROAD_HALF),
    WALLD: new Array<number>(N).fill(WALL),
    CLEAR: new Array<number>(N).fill(1e9),
    BT: new Array<number>(N).fill(0),
    offroad: 'grass',
    zones: new Array<LatZone[] | null>(N).fill(null),
    gates: [],
    sectors: [0],
    pads: [0.13, 0.4, 0.68, 0.93].map((f) => ({ idx: Math.floor(f * N), lat: 0 })),
    boxRows: [0.07, 0.2, 0.33, 0.47, 0.6, 0.75, 0.9].map((f) => Math.floor(f * N)),
    ramps: [],
    shortcuts: [],
  };
}

/** The surface under a track-relative point. */
export function surfaceAt(T: Track, idx: number, lat: number): SurfaceId {
  const a = Math.abs(lat),
    hw = T.HW[idx]!;
  const zs = T.zones[idx];
  if (zs) for (const z of zs) if (lat >= z.latMin && lat <= z.latMax) return z.surface;
  if (a <= hw) return 'asphalt';
  if (a <= hw + KERB_W) return 'kerb';
  return T.offroad;
}

/** Closest point on a shortcut corridor, or null when no corridor is within `margin` of its edge. */
export function shortcutAt(
  T: Track,
  x: number,
  z: number,
  margin = 0,
): { sc: Shortcut; d: number; cx: number; cz: number } | null {
  let best: { sc: Shortcut; d: number; cx: number; cz: number } | null = null;
  for (const sc of T.shortcuts) {
    const p = sc.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i]!,
        az = p[i + 1]!,
        bx = p[i + 2]!,
        bz = p[i + 3]!;
      const ex = bx - ax,
        ez = bz - az,
        l2 = ex * ex + ez * ez || 1;
      const t = clamp(((x - ax) * ex + (z - az) * ez) / l2, 0, 1);
      const cx = ax + ex * t,
        cz = az + ez * t,
        d = Math.hypot(x - cx, z - cz);
      if (d <= sc.half + margin && (!best || d < best.d)) best = { sc, d, cx, cz };
    }
  }
  return best;
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
  return { N: count, DS, LEN, CX, CZ, TX, TZ, RX, RZ, ANG, H, SL, CURV, RLINE: line, ...prototypeExtras(count) };
}

/** The prototype's track (about 1.28 km). Replaced by full-length TrackDefs in phase 8. */
export const PROTO_TRACK_SCALE = 0.8;
export const PROTO_CTRL: readonly (readonly [number, number])[] = (
  [
    [0, -220],
    [140, -210],
    [230, -120],
    [210, 0],
    [120, 60],
    [150, 150],
    [60, 230],
    [-60, 200],
    [-120, 110],
    [-220, 130],
    [-270, 20],
    [-200, -90],
    [-90, -110],
    [-60, -190],
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
  k.y = H[best]! + (H[j]! - H[best]!) * Math.abs(k.frac) + k.lat * T.BT[best]!;
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
  out.y = H[i]! + (H[j]! - H[i]!) * f + lat * T.BT[i]!;
}
