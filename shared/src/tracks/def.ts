/**
 * Track data (section 11.2): a TrackDef is plain data. `buildTrackFromDef` turns it into the physics lookup
 * tables (Track); the host's track builder turns the same Track plus the def's theme and landmarks into meshes.
 *
 * Positions along the lap are fractions (0 = start line, 0.5 = halfway). Lateral positions are metres from the
 * centreline along (RX, RZ), which is the driver's right.
 */
import { clamp, wrapA } from '../constants';
import {
  rampRise,
  verticalCurvature,
  type LatZone,
  type Ramp,
  type RampKind,
  type Shortcut,
  type SurfaceId,
  type Track,
} from '../track';
import { bumpShape, planCoaster } from './coaster';

/** Race tracks, then (D69) the Bumper Brawl arenas. */
export type TrackId = 'meadows' | 'canyon' | 'frosty' | 'sepang' | 'arena-meadow' | 'arena-canyon' | 'arena-ice';
export type ThemeId = 'meadows' | 'canyon' | 'frosty' | 'tropical';

export interface TrackPoint {
  x: number;
  z: number;
  /** Road height (m). Default 0. */
  h?: number;
  /** Road half-width (m). Default 9.5 (D65: was 13). */
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
  ramps: RampDef[];
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
  /** D65: fill the lap with roller-coaster crests, dips and jumps (default on). */
  coaster?: boolean | 'ramps';
  /** D69: walls this far beyond the road edge (default WALL_GAP; arenas keep theirs just past the kerbs). */
  wallGap?: number;
}

/**
 * A jump (D64). Kind defaults: len (m), lift (m), pop (launch vertical speed per m/s of speed). `whoops` makes a
 * rhythm run of `count` small bumps `gap` metres apart, the first lip at `at`. `lat` is a lane ramp's lateral
 * range (m, the driver's right is positive).
 */
export interface RampDef {
  at: number;
  kind?: RampKind | 'whoops';
  len?: number;
  lift?: number;
  pop?: number;
  lat?: [number, number];
  count?: number;
  gap?: number;
}
/** D67: pops 1.4x (more airtime off every ramp); were 0.13, 0.21, 0.16, 0.075, 0.16. */
export const RAMP_KINDS: Readonly<Record<RampKind, { len: number; lift: number; pop: number }>> = {
  kicker: { len: 9, lift: 1.1, pop: 0.18 },
  launch: { len: 20, lift: 2.4, pop: 0.29 },
  table: { len: 26, lift: 1.9, pop: 0.22 },
  whoop: { len: 6, lift: 0.7, pop: 0.105 },
  lane: { len: 10, lift: 1.3, pop: 0.22 },
};

/**
 * D67: every layout 5% longer and its road 5% wider. Lap features are lap fractions, so checkpoints, pads, ramps
 * and item rows keep their places; everything given in metres across the road (surface zones, lane ramps, pad
 * lanes, landmark distances, shortcut corridors) grows with it, so it stays lined up with the road edge.
 */
export function growDef(def: TrackDef, s: number, ws = s): TrackDef {
  // s: the layout (length); ws: the road width, and everything placed across it relative to its edge (D70)
  return {
    ...def,
    points: def.points.map((p) => ({ ...p, x: p.x * s, z: p.z * s, w: (p.w ?? DEFAULT_HW) * ws })),
    pads: def.pads.map((p) => (p.lat === undefined ? p : { ...p, lat: p.lat * ws })),
    ramps: def.ramps.map((r) => (r.lat ? { ...r, lat: [r.lat[0] * ws, r.lat[1] * ws] as [number, number] } : r)),
    zones: def.zones.map((z) => ({ ...z, latMin: z.latMin * ws, latMax: z.latMax * ws })),
    shortcuts: def.shortcuts.map((c) => ({
      ...c,
      via: c.via.map(([x, z]) => [x * s, z * s] as [number, number]),
      ...(c.half === undefined ? {} : { half: c.half * s }),
    })),
    landmarks: def.landmarks.map((l) => ({ ...l, dist: l.dist * s })),
  };
}

/** D65: a narrower road (was 13 m) for closer racing on the shorter tracks. */
const DEFAULT_HW = 9.5;
/** Walls stand this far beyond the road edge: the road is narrower (D65), the grass run-off is not. */
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

/** D81: on the flat tracks ('ramps' mode), a jump at least every this many seconds (estimated). */
const RAMP_SPACING = 6;

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
    HW.push(clamp(v[3]!, 7, 18));
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

  // item rows: given, or about every 260 m from 150 m after the line (D65: was 400 m)
  const LAPF = (m: number): number => m / LEN;
  // D81: item rows every 170 m or so (was 260): more mystery boxes round the lap
  const nRows = Math.max(3, Math.round((LEN - 150) / 170));
  const rows = def.itemRows ?? Array.from({ length: nRows }, (_, k) => LAPF(150) + (k * (1 - LAPF(250))) / nRows);
  const boxRows = rows.map(idxOf);

  // D65 roller coaster: crests, dips and extra jumps between the def's own features
  const defRampKind = (r: RampDef): RampKind => (r.kind === 'whoops' ? 'whoop' : (r.kind ?? 'kicker'));
  const extraRamps: RampDef[] = [];
  let beats: Track['beats'];
  let airZone = new Array<boolean>(N).fill(false);
  {
    const blocked = new Array<boolean>(N).fill(false),
      dipOnly = new Array<boolean>(N).fill(false),
      marks: number[] = [];
    const block = (from: number, to: number, arr = blocked): void => {
      for (const i of span(from, to)) arr[i] = true;
    };
    const mf = (m: number): number => m / LEN;
    block(-mf(32), mf(18)); // the grid (three rows, up to 27 m back) and the start line
    marks.push(0); // crossing the line: the lap counter, the split
    for (const l of def.landmarks) {
      if (l.kind === 'tunnel' && l.len) {
        block(l.at - mf(15), l.at + l.len + mf(15), dipOnly);
        marks.push(idxOf(l.at), idxOf(l.at + l.len));
      }
      if (l.kind === 'river' || l.kind === 'bridge') {
        block(l.at - mf(28), l.at + mf(28));
        marks.push(idxOf(l.at));
      }
      if (l.kind === 'arch') {
        block(l.at - mf(25), l.at + mf(25), dipOnly);
        marks.push(idxOf(l.at));
      }
    }
    for (const sc of def.shortcuts) {
      block(sc.from - mf(18), sc.from + mf(12));
      block(sc.to - mf(12), sc.to + mf(18));
      marks.push(idxOf(sc.from), idxOf(sc.to));
    }
    const fixed = def.ramps.map((r) => {
      const k = defRampKind(r),
        d = RAMP_KINDS[k],
        n = r.kind === 'whoops' ? (r.count ?? 3) : 1;
      const i1 = idxOf(r.at);
      return {
        i1,
        from: (i1 - Math.round(((r.len ?? d.len) + 10) / DS) + N) % N,
        to: i1 + Math.round(((n - 1) * (r.gap ?? 28) + 45) / DS),
      };
    });
    if (def.coaster !== false) {
      const plan = planCoaster({
        N,
        DS,
        ANG,
        HW,
        blocked,
        dipOnly,
        marks,
        ramps: fixed,
        pads: def.pads.map((p) => idxOf(p.at)),
        rows: boxRows,
        ...(def.coaster === 'ramps' ? { only: 'ramps' as const, spacing: RAMP_SPACING } : {}),
      });
      for (const b of plan.bumps) {
        const reach = Math.ceil((3 * b.sigma) / DS);
        for (let o = -reach; o <= reach; o++) {
          const i = (b.idx + o + N) % N,
            w = bumpShape(o * DS, b.sigma);
          H[i]! += b.amp * w;
          if (b.bank) BT[i] = clamp(BT[i]! + Math.tan((b.bank * w * Math.PI) / 180), -0.45, 0.45);
        }
      }
      extraRamps.push(...plan.ramps);
      beats = plan.beats;
      airZone = plan.airZone;
    } else {
      beats = [
        ...fixed.map((r) => ({ idx: r.i1, kind: 'ramp' as const })),
        ...def.pads.map((p) => ({ idx: idxOf(p.at), kind: 'pad' as const })),
        ...boxRows.map((idx) => ({ idx, kind: 'items' as const })),
      ].sort((a, b) => a.idx - b.idx);
    }
  }

  // jump ramps raise the road before the lip; the road after the lip stays at its base height (a lane ramp only
  // covers its lane, so it is not part of the road height: see laneLift)
  const ramps: Ramp[] = [...def.ramps, ...extraRamps].flatMap((r) => {
    const kind: RampKind = defRampKind(r);
    const d = RAMP_KINDS[kind];
    const n = r.kind === 'whoops' ? (r.count ?? 3) : 1;
    return Array.from({ length: n }, (_, w): Ramp => {
      const i1 = idxOf(r.at + (w * (r.gap ?? 28)) / LEN),
        lift = r.lift ?? d.lift,
        len = Math.max(2, Math.round((r.len ?? d.len) / DS)),
        i0 = (i1 - len + N) % N;
      const lane = kind === 'lane';
      if (!lane) for (let k = 0; k <= len; k++) H[(i0 + k) % N]! += lift * rampRise(kind, k / len);
      return {
        i0,
        i1,
        lift,
        kind,
        pop: r.pop ?? d.pop,
        latMin: lane ? (r.lat?.[0] ?? 2) : -1e9,
        latMax: lane ? (r.lat?.[1] ?? 12) : 1e9,
      };
    });
  });

  const SL: number[] = [],
    CURV: number[] = [];
  for (let i = 0; i < N; i++) SL.push((H[(i + 1) % N]! - H[(i - 1 + N) % N]!) / (2 * DS));
  for (let i = 0; i < N; i++) CURV.push(wrapA(ANG[(i + 6) % N]! - ANG[(i - 6 + N) % N]!));
  const VC = verticalCurvature(H, DS);
  // racing line, as the prototype: toward the inside of each corner, smoothed so the AI moves over early
  // D65: 3.5 m inside the edges (was 4.5) on the narrower road
  const LINE_IN = 3.5;
  let line = CURV.map((c, i) => clamp(-c * 14, -(HW[i]! - LINE_IN), HW[i]! - LINE_IN));
  for (let pass = 0; pass < 3; pass++) {
    const nl: number[] = [];
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let o = -10; o <= 10; o++) s += line[(i + o + N) % N]!;
      nl.push(s / 21);
    }
    line = nl;
  }
  // D46: precomputed racing line. Relax the path towards the straightest line through the corridor (each point
  // moves towards the midpoint of its neighbours, kept 4.5 m inside the road edges): outside-inside-outside
  // through the corners, with the least curvature the road allows.
  {
    const m = Math.max(3, Math.round(14 / DS));
    for (let it = 0; it < 260; it++) {
      const nl = line.slice();
      for (let i = 0; i < N; i++) {
        const a = (i - m + N) % N,
          b = (i + m) % N;
        const mx = (CX[a]! + RX[a]! * line[a]! + CX[b]! + RX[b]! * line[b]!) / 2,
          mz = (CZ[a]! + RZ[a]! * line[a]! + CZ[b]! + RZ[b]! * line[b]!) / 2;
        const target = (mx - CX[i]!) * RX[i]! + (mz - CZ[i]!) * RZ[i]!;
        const lim = HW[i]! - LINE_IN;
        nl[i] = clamp(line[i]! * 0.5 + target * 0.5, -lim, lim);
      }
      line = nl;
    }
  }

  const zones: (LatZone[] | null)[] = new Array<LatZone[] | null>(N).fill(null);
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
  const WALLD = HW.map((w) => w + (def.wallGap ?? WALL_GAP));
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
    VC,
    beats,
    airZone,
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
