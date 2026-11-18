/**
 * Track data (section 11.2): a TrackDef is plain data. `buildTrackFromDef` turns it into the physics lookup
 * tables (Track); the host's track builder turns the same Track plus the def's theme and landmarks into meshes.
 *
 * Positions along the lap are fractions (0 = start line, 0.5 = halfway). Lateral positions are metres from the
 * centreline along (RX, RZ), which is the driver's right.
 */
import { clamp, wrapA } from '../constants';
import type { LatZone, Ramp, Shortcut, SurfaceId, Track } from '../track';

export type TrackId = 'meadows' | 'canyon' | 'frosty' | 'sepang';
export type ThemeId = 'meadows' | 'canyon' | 'frosty' | 'tropical';

export interface TrackPoint {
  x: number;
  z: number;
  /** Road height (m). Default 0. */
  h?: number;
  /** Road half-width (m). Default 13. */
  w?: number;
  /** Banking (degrees, positive raises the right-hand edge, for a left-hand corner). Default 0. */
  bank?: number;
}

export interface SectorDef {
  /** Start of the sector (lap fraction); the first sector starts at 0. */
  at: number;
  name: string;
  /** Signature feature, for the HUD and the scenery builder. */
  feature: string;
}

export interface LandmarkDef {
  kind: string;
  at: number;
  /** Which side of the road (1 = right, -1 = left, 0 = over the road). */
  side: -1 | 0 | 1;
  /** Distance from the centreline (m). */
  dist: number;
  /** Length along the road for things like tunnels (lap fraction). */
  len?: number;
}

export interface TrackDef {
  id: TrackId;
  name: string;
  theme: ThemeId;
  /** Closed loop in driving order; points[0] is on the start straight, at the start line. */
  points: TrackPoint[];
  /** Surface beyond the kerbs. */
  offroad: SurfaceId;
  /** 3 or 4 sectors, each with its own scenery and signature feature (section 11.1). */
  sectors: SectorDef[];
  /** Extra checkpoint gates (lap fractions) besides the sector starts. */
  gates?: number[];
  pads: { at: number; lat?: number }[];
  /** Jump ramps: the lip is at `at`; the road rises over `len` metres by `lift` metres before it. */
  ramps: { at: number; len: number; lift: number }[];
  /** Item box rows (lap fractions). Default: about every 400 m. */
  itemRows?: number[];
  /** Surface patches: [from, to] lap fractions, lateral range. */
  zones: { from: number; to: number; latMin: number; latMax: number; surface: SurfaceId }[];
  /** Shortcuts: leave the road at `from`, follow `via` (world points), rejoin at `to`. */
  shortcuts: { from: number; to: number; via: [number, number][]; half?: number; surface: SurfaceId }[];
  landmarks: LandmarkDef[];
  music: string;
  /** Traced from a real circuit's layout (D42): no invented shortcut, and its tight corners are kept. */
  traced?: boolean;
}

const DEFAULT_HW = 13;
/** Walls stand this far beyond the road edge. */
const WALL_GAP = 12;
/** Walls never come closer than this to the road edge (kerb plus a little run-off). */
const MIN_WALL_GAP = 3.8;
/** Inside tunnels the walls are this far beyond the road edge. */
const TUNNEL_GAP = 3.5;
/** Target spacing between samples (m), section 11.1. */
const SPACING = 3;

/** Catmull-Rom through closed control values. */
function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t,
    t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

export function buildTrackFromDef(def: TrackDef): Track {
  const P = def.points,
    n = P.length,
    per = 80;
  // dense spline of every per-point channel
  const ch = (p: TrackPoint): number[] => [p.x, p.z, p.h ?? 0, p.w ?? DEFAULT_HW, p.bank ?? 0];
  const dense: number[][] = [];
  for (let i = 0; i < n; i++) {
    const a = ch(P[(i - 1 + n) % n]!),
      b = ch(P[i]!),
      c = ch(P[(i + 1) % n]!),
      d = ch(P[(i + 2) % n]!);
    for (let s = 0; s < per; s++) dense.push(a.map((_, k) => cr(a[k]!, b[k]!, c[k]!, d[k]!, s / per)));
  }
  const M = dense.length,
    cum = [0];
  for (let i = 1; i <= M; i++) {
    const a = dense[i - 1]!,
      b = dense[i % M]!;
    cum.push(cum[i - 1]! + Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!));
  }
  const LEN = cum[M]!,
    N = Math.round(LEN / SPACING),
    DS = LEN / N;
  const CX: number[] = [],
    CZ: number[] = [],
    H: number[] = [],
    HW: number[] = [],
    BT: number[] = [];
  let j = 0;
  for (let i = 0; i < N; i++) {
    const target = i * DS;
    while (j < M - 1 && cum[j + 1]! < target) j++;
    const a = dense[j]!,
      b = dense[(j + 1) % M]!,
      f = (target - cum[j]!) / Math.max(1e-6, cum[j + 1]! - cum[j]!);
    const v = a.map((x, k) => x + (b[k]! - x) * f);
    CX.push(v[0]!);
    CZ.push(v[1]!);
    H.push(v[2]!);
    HW.push(clamp(v[3]!, 9, 18));
    BT.push(Math.tan((clamp(v[4]!, -14, 14) * Math.PI) / 180));
  }
  const TX: number[] = [],
    TZ: number[] = [],
    RX: number[] = [],
    RZ: number[] = [],
    ANG: number[] = [];
  for (let i = 0; i < N; i++) {
    let dx = CX[(i + 1) % N]! - CX[(i - 1 + N) % N]!,
      dz = CZ[(i + 1) % N]! - CZ[(i - 1 + N) % N]!;
    const l = Math.hypot(dx, dz);
    dx /= l;
    dz /= l;
    TX.push(dx);
    TZ.push(dz);
    RX.push(-dz);
    RZ.push(dx);
    ANG.push(Math.atan2(dx, dz));
  }
  const idxOf = (f: number): number => ((Math.round(f * N) % N) + N) % N;

  // jump ramps raise the road before the lip; the road after the lip stays at its base height
  const ramps: Ramp[] = def.ramps.map((r) => {
    const i1 = idxOf(r.at),
      len = Math.max(2, Math.round(r.len / DS)),
      i0 = (i1 - len + N) % N;
    for (let k = 0; k <= len; k++) {
      const p = k / len;
      H[(i0 + k) % N]! += r.lift * Math.pow(p, 1.6);
    }
    return { i0, i1, lift: r.lift };
  });

  const SL: number[] = [],
    CURV: number[] = [];
  for (let i = 0; i < N; i++) SL.push((H[(i + 1) % N]! - H[(i - 1 + N) % N]!) / (2 * DS));
  for (let i = 0; i < N; i++) CURV.push(wrapA(ANG[(i + 6) % N]! - ANG[(i - 6 + N) % N]!));
  // racing line, as the prototype: toward the inside of each corner, smoothed so the AI moves over early
  let line = CURV.map((c, i) => clamp(-c * 14, -(HW[i]! - 4.5), HW[i]! - 4.5));
  for (let pass = 0; pass < 3; pass++) {
    const nl: number[] = [];
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -10; o <= 10; o++) s += line[(i + o + N) % N]!;
      nl.push(s / 21);
    }
    line = nl;
  }

  const zones: (LatZone[] | null)[] = new Array<LatZone[] | null>(N).fill(null);
  const span = (from: number, to: number): number[] => {
    const a = idxOf(from),
      b = idxOf(to),
      out: number[] = [];
    for (let i = a; ; i = (i + 1) % N) {
      out.push(i);
      if (i === b) break;
    }
    return out;
  };
  for (const z of def.zones)
    for (const i of span(z.from, z.to))
      (zones[i] ??= []).push({ latMin: z.latMin, latMax: z.latMax, surface: z.surface });

  const shortcuts: Shortcut[] = def.shortcuts.map((s) => {
    const i0 = idxOf(s.from),
      i1 = idxOf(s.to);
    const pts = [CX[i0]!, CZ[i0]!, ...s.via.flat(), CX[i1]!, CZ[i1]!];
    return { pts, half: s.half ?? 7, surface: s.surface, i0, i1 };
  });

  // walls stand WALL_GAP beyond the road edge, but close in inside tunnels, where another part of the road
  // runs close by (each side's walls stop halfway), and on the inside of very tight corners (no folded walls)
  const WALLD = HW.map((w) => w + WALL_GAP);
  const CLEAR = new Array<number>(N).fill(1e9);
  for (const l of def.landmarks)
    if (l.kind === 'tunnel' && l.len) for (const i of span(l.at, l.at + l.len)) WALLD[i] = HW[i]! + TUNNEL_GAP;
  {
    const skip = Math.ceil(120 / DS);
    for (let i = 0; i < N; i++) {
      let d2 = 1e18;
      for (let j = 0; j < N; j++) {
        const di = Math.min(Math.abs(i - j), N - Math.abs(i - j));
        if (di < skip) continue;
        const dx = CX[i]! - CX[j]!,
          dz = CZ[i]! - CZ[j]!;
        d2 = Math.min(d2, dx * dx + dz * dz);
      }
      const da = Math.abs(wrapA(ANG[(i + 4) % N]! - ANG[(i - 4 + N) % N]!));
      const radius = da > 1e-6 ? (8 * DS) / da : 1e9;
      CLEAR[i] = Math.sqrt(d2) / 2;
      const room = Math.min(CLEAR[i]! - 1.5, radius - 2.5);
      WALLD[i] = clamp(Math.min(WALLD[i]!, room), HW[i]! + MIN_WALL_GAP, WALLD[i]!);
    }
  }

  const sectors = def.sectors.map((s) => idxOf(s.at));
  sectors[0] = 0;
  const gates = [...new Set([...sectors.slice(1), ...(def.gates ?? []).map(idxOf)])]
    .filter((g) => g > 0)
    .sort((a, b) => a - b);

  // item rows: given, or about every 400 m from 150 m after the line
  const LAPF = (m: number): number => m / LEN;
  const rows =
    def.itemRows ??
    Array.from(
      { length: Math.max(3, Math.round((LEN - 150) / 400)) },
      (_, k) => LAPF(150) + (k * (1 - LAPF(250))) / Math.max(3, Math.round((LEN - 150) / 400)),
    );
  const boxRows = rows.map(idxOf);

  return {
    N,
    DS,
    LEN,
    CX,
    CZ,
    TX,
    TZ,
    RX,
    RZ,
    ANG,
    H,
    SL,
    CURV,
    RLINE: line,
    id: def.id,
    HW,
    WALLD,
    CLEAR,
    BT,
    offroad: def.offroad,
    zones,
    gates,
    sectors,
    pads: def.pads.map((p) => ({ idx: idxOf(p.at), lat: p.lat ?? 0 })),
    boxRows,
    ramps,
    shortcuts,
  };
}

/** Layout checks for the design tool and the tests: tightest radius, closest approach of unrelated road. */
export function trackStats(T: Track): {
  len: number;
  minRadius: number;
  minRadiusAt: number;
  minSep: number;
  minSepAt: [number, number];
} {
  let minR = 1e9,
    minRAt = 0;
  for (let i = 0; i < T.N; i++) {
    // radius from the heading change over ±4 samples
    const da = Math.abs(wrapA(T.ANG[(i + 4) % T.N]! - T.ANG[(i - 4 + T.N) % T.N]!));
    const r = da > 1e-6 ? (8 * T.DS) / da : 1e9;
    if (r < minR) {
      minR = r;
      minRAt = i;
    }
  }
  let minSep = 1e9,
    at: [number, number] = [0, 0];
  const skip = Math.ceil(120 / T.DS);
  for (let i = 0; i < T.N; i += 2)
    for (let j = i + skip; j < T.N; j += 2) {
      if (T.N - (j - i) < skip) continue;
      const d = Math.hypot(T.CX[i]! - T.CX[j]!, T.CZ[i]! - T.CZ[j]!);
      if (d < minSep) {
        minSep = d;
        at = [i, j];
      }
    }
  return { len: T.LEN, minRadius: minR, minRadiusAt: minRAt / T.N, minSep, minSepAt: [at[0] / T.N, at[1] / T.N] };
}
