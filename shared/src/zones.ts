/**
 * D83 fun zones: three marked stretches on every race track that reward skill (none of them is a speed boost).
 *
 * - Slalom gates: a run of cone gates, alternately left and right of the centre. Through every gate, in order and
 *   without knocking a cone, wins a free item (or, with your hands full, a lift on the MOVE meter).
 * - Jump target: a painted bullseye where the big launch ramp comes down. Land on it for the same reward. Where you
 *   land follows your speed off the lip and your line onto it.
 * - Draft tunnel: a covered stretch where the slipstream charges twice as fast, close racing (tucked in behind or
 *   side by side) charges the MOVE meter, and each place gained inside it is worth a little more meter.
 *
 * Placed by the track's own shape (clear of the start, jumps, shortcuts, tunnels and the track event), the same
 * every race. Deterministic, plain simulation: replays stay exact. The AI tries them by difficulty.
 */
import { posOnTrack, type Track } from './track';
import { TRACKS, isTrackId, speedProfile } from './tracks';
import type { GameEvent, GameState, Kart } from './game';
import type { Difficulty } from './ai';
import { HAZARD_OF, hazardSpot } from './hazards';

export type ZoneKind = 'slalom' | 'target' | 'tunnel';
/** Event `n` for each zone. */
export const ZONE_KINDS: readonly ZoneKind[] = ['slalom', 'target', 'tunnel'];
export const ZONE_NAME: Readonly<Record<ZoneKind, string>> = {
  slalom: 'SLALOM',
  target: 'JUMP TARGET',
  tunnel: 'DRAFT TUNNEL',
};

export interface Cone {
  idx: number;
  lat: number;
  x: number;
  y: number;
  z: number;
  /** Seconds since it was knocked over (-1: standing), and which way it went. */
  down: number;
  dx: number;
  dz: number;
}
export interface Slalom {
  /** Gate centres in driving order (road sample, metres across). */
  gates: { idx: number; lat: number }[];
  /** Two cones a gate, in gate order (left then right). */
  cones: Cone[];
}
export interface Target {
  /** The launch ramp's lip (road sample). */
  lip: number;
  /** The bullseye's centre (road sample, metres across, world) and radius (m). */
  idx: number;
  lat: number;
  x: number;
  y: number;
  z: number;
  r: number;
}
export interface Tunnel {
  /** Samples [i0, i1] (i1 may be past N: it wraps). */
  i0: number;
  i1: number;
}
export interface Zones {
  slalom: Slalom | null;
  target: Target | null;
  tunnel: Tunnel | null;
}

/** Slalom: gates, their spacing (m), the gate centre's offset from the middle (m) and half the gap (m). */
export const SLALOM_GATES = 4;
export const SLALOM_SPACING = 40;
export const SLALOM_OFF = 3.2;
export const SLALOM_HALF = 2.8;
/** A kart this close to a cone (m, centre to cone) knocks it over; it stands up again after CONE_BACK s. */
const CONE_HIT = 1.35;
const CONE_BACK = 3;
/** Jump target radius (m). */
export const TARGET_R = 3.5;
/** Draft tunnel length (m), how much faster the slipstream charges inside, and the meter close racing gives. */
export const TUNNEL_LEN = 180;
export const TUNNEL_DRAFT = 2;
const TUNNEL_METER = 0.035;
const PASS_METER = 0.12;
/** The meter a full-handed kart gets for a clean slalom or a bullseye. */
const ZONE_METER = 0.3;
/** Share of AI karts that go for a zone (each lap), by difficulty. */
const TRY: Readonly<Record<Difficulty, number>> = { easy: 0.35, normal: 0.65, hard: 0.9 };

/** Where a kart going `v` m/s comes down off a ramp (m past the lip): the jump physics of game.ts, on flat road. */
function flight(v: number, lift: number, pop: number): number {
  const vy = v * pop + 2,
    t = (vy + Math.sqrt(vy * vy + 60 * lift)) / 30;
  // measured against the AI's landings (D83): about 7% further than the bare ballistic arc
  return v * t * 1.07;
}

/**
 * The track's fun zones (null for an arena, or a track without room for them). `speedScale` is the game's speed
 * against the default handling's (where the karts come down off the launch ramp follows it).
 */
export function planZones(T: Track, speedScale = 1): Zones | null {
  if (!isTrackId(T.id) || T.id.startsWith('arena')) return null;
  const N = T.N,
    DS = T.DS;
  const busy = new Array<boolean>(N).fill(false);
  const mark = (a: number, b: number): void => {
    for (let i = a; i <= b; i++) busy[((i % N) + N) % N] = true;
  };
  // the start (grid and line), the jumps (run-up and landing), the shortcuts' mouths, tunnels and arches
  mark(Math.round(-0.05 * N), Math.round(0.08 * N));
  for (let i = 0; i < N; i++) if (T.airZone[i]) busy[i] = true;
  for (const r of T.ramps) mark(r.i0 - 8, ((r.i1 - r.i0 + N) % N) + r.i0 + Math.round(70 / DS));
  for (const sc of T.shortcuts) mark(sc.i0 - 10, ((sc.i1 - sc.i0 + N) % N) + sc.i0 + 10);
  for (const l of TRACKS[T.id].landmarks)
    if (l.side === 0) mark(Math.round((l.at - 0.012) * N), Math.round((l.at + (l.len ?? 0) + 0.012) * N));
  const hz = HAZARD_OF[T.id];
  if (hz) {
    const h = hazardSpot(T, hz);
    // its run-up, and past it (the rockfall's rubble reaches 15 m on)
    mark(h.idx - Math.round(140 / DS), h.idx + Math.round(20 / DS));
  }
  const free = (a: number, b: number): boolean => {
    for (let i = a; i <= b; i++) if (busy[((i % N) + N) % N]) return false;
    return true;
  };
  const bend = (a: number, b: number): number => {
    let c = 0;
    for (let i = a; i <= b; i++) c += Math.abs(T.CURV[((i % N) + N) % N]!);
    return c / (b - a + 1);
  };

  // the jump target: where the launch ramp comes down
  let target: Target | null = null;
  const lr = T.ramps.find((r) => r.kind === 'launch');
  if (lr) {
    const v = speedProfile(N, DS, T.ANG)[lr.i1]! * 0.92 * speedScale;
    const idx = (lr.i1 + Math.round(flight(v, lr.lift, lr.pop) / DS)) % N;
    // off the racing line (the side it does not take there), so going for it costs the line: a choice
    const lat = (T.RLINE[lr.i1]! >= 0 ? -1 : 1) * Math.min(5, T.HW[idx]! * 0.45);
    const p = { x: 0, y: 0, z: 0 };
    posOnTrack(T, idx, lat, p);
    target = { lip: lr.i1, idx, lat, x: p.x, y: p.y, z: p.z, r: TARGET_R };
    mark(idx - 12, idx + 12);
  }

  // the slalom (before the tunnel: it needs the most room): a straight between two item rows, clear of the rest
  const gs = Math.round(SLALOM_SPACING / DS),
    span = gs * (SLALOM_GATES - 1);
  const pre = Math.round(20 / DS),
    runUp = Math.round(45 / DS),
    post = Math.round(12 / DS);
  const rowIn = (a: number, b: number): boolean =>
    T.boxRows.some((r) => {
      const d = (r - a + N) % N;
      return d <= b - a;
    });
  let slalom: Slalom | null = null,
    sb = Infinity;
  for (let i = 0; i < N; i += 2) {
    // the gates and a straight run-up (an item row may sit in the run-up, not among the gates)
    if (!free(i - runUp, i + span + post) || rowIn(i - pre, i + span + post)) continue;
    if (Math.min(...Array.from({ length: span + 1 }, (_, o) => T.HW[(i + o) % N]!)) < SLALOM_OFF + SLALOM_HALF + 1.5)
      continue;
    const b = bend(i - runUp, i + span);
    if (b < sb) {
      sb = b;
      // the first gate on the side the racing line comes in on
      const first = T.RLINE[(i - pre + N) % N]! < 0 ? -1 : 1;
      const gates = Array.from({ length: SLALOM_GATES }, (_, g) => ({
        idx: (i + g * gs) % N,
        lat: (g % 2 ? -first : first) * SLALOM_OFF,
      }));
      slalom = { gates, cones: [] };
    }
  }
  if (slalom) mark(slalom.gates[0]!.idx - runUp, slalom.gates[slalom.gates.length - 1]!.idx + post + 10);

  // the draft tunnel: the straightest free stretch of its length
  const tl = Math.round(TUNNEL_LEN / DS);
  let tunnel: Tunnel | null = null,
    tb = Infinity;
  for (let i = 0; i < N; i += 3)
    if (free(i - 4, i + tl + 4)) {
      const b = bend(i, i + tl);
      if (b < tb) {
        tb = b;
        tunnel = { i0: i, i1: i + tl };
      }
    }
  if (tunnel) mark(tunnel.i0 - 20, tunnel.i1 + 20);

  if (slalom) {
    const p = { x: 0, y: 0, z: 0 };
    for (const g of slalom.gates)
      for (const sd of [-1, 1]) {
        const lat = g.lat + sd * SLALOM_HALF;
        posOnTrack(T, g.idx, lat, p);
        slalom.cones.push({ idx: g.idx, lat, x: p.x, y: p.y, z: p.z, down: -1, dx: 0, dz: 0 });
      }
  }
  return slalom || target || tunnel ? { slalom, target, tunnel } : null;
}

/** Is road sample i inside the draft tunnel? */
export function inTunnel(T: Track, t: Tunnel | null, i: number): boolean {
  return !!t && (i - t.i0 + T.N) % T.N <= t.i1 - t.i0;
}

/** What the zone step needs from the game. */
export interface ZoneHooks {
  emit(e: GameEvent): void;
  /** Hand the kart an item from the boxes' pool. */
  giveItem(k: Kart): void;
}

/** Did the kart cross road sample g this step (from `prev` to its sample now)? */
function crossed(T: Track, prev: number, now: number, g: number): boolean {
  const N = T.N,
    a = (prev - g + N) % N,
    b = (now - g + N) % N;
  return a > N / 2 && b < 30;
}

/** A clean slalom or a bullseye: an item if the kart's hands are free, else a lift on the MOVE meter. */
function reward(s: GameState, k: Kart, n: number, hooks: ZoneHooks): void {
  let lvl = 0;
  if (s.itemsOn && !k.item && k.roll <= 0) {
    hooks.giveItem(k);
    lvl = 1;
  } else if (s.moves && k.meter < 1) {
    k.meter = Math.min(1, k.meter + ZONE_METER);
    lvl = 2;
  }
  hooks.emit({ type: 'zone', kart: k.id, n, lvl });
}

/** One step of the fun zones: the gates, the cones, the target and the tunnel, for every kart. */
export function stepZones(s: GameState, dt: number, hooks: ZoneHooks): void {
  const Z = s.zones;
  if (!Z) return;
  const T = s.track,
    N = T.N;
  if (Z.slalom)
    for (const c of Z.slalom.cones) {
      if (c.down < 0) continue;
      c.down += dt;
      if (c.down > CONE_BACK) c.down = -1;
    }
  const racing = s.phase === 'race';
  for (const k of s.karts) {
    const prev = k.zPrev;
    k.zPrev = k.idx;
    if (!racing || k.out || k.finished) {
      k.zAir = k.air;
      continue;
    }
    if (k.rescue > 0 || k.inSc) {
      k.zFail = true;
      k.zAim = false;
      k.zTun = -1;
      k.zAir = k.air;
      continue;
    }

    // slalom: every gate in order, through the gap
    const sl = Z.slalom;
    if (sl) {
      sl.gates.forEach((g, j) => {
        if (!crossed(T, prev, k.idx, g.idx)) return;
        if (j === 0) {
          k.zGate = 0;
          k.zFail = false;
        }
        if (k.zFail || k.zGate !== j) return;
        if (Math.abs(k.lat - g.lat) <= SLALOM_HALF && !k.air) {
          k.zGate++;
          if (k.zGate === sl.gates.length) {
            k.zFail = true;
            reward(s, k, 0, hooks);
          }
        } else {
          k.zFail = true;
          if (j > 0) hooks.emit({ type: 'zonemiss', kart: k.id, n: 0 });
        }
      });
      // the cones: knocked over by a kart that touches one (a little speed lost, and the run with it)
      const first = sl.gates[0]!.idx;
      const rel = (k.idx - first + N) % N;
      if (rel < ((sl.gates[sl.gates.length - 1]!.idx - first + N) % N) + 4 || rel > N - 4)
        sl.cones.forEach((c, ci) => {
          if (c.down >= 0 || k.air) return;
          const dx = c.x - k.x,
            dz = c.z - k.z;
          if (dx * dx + dz * dz > CONE_HIT * CONE_HIT) return;
          const v = Math.hypot(k.vx, k.vz) || 1;
          c.down = 0;
          c.dx = k.vx / v;
          c.dz = k.vz / v;
          k.vx *= 0.94;
          k.vz *= 0.94;
          if (!k.zFail && k.zGate > 0) hooks.emit({ type: 'zonemiss', kart: k.id, n: 0 });
          k.zFail = true;
          hooks.emit({ type: 'cone', kart: k.id, n: ci, x: c.x, y: c.y, z: c.z });
        });
    }

    // jump target: off the launch ramp's lip, onto the bullseye
    const tg = Z.target;
    if (tg) {
      if (k.air && !k.zAir) k.zAim = (k.idx - tg.lip + N) % N < 8;
      if (!k.air && k.zAir && k.zAim) {
        k.zAim = false;
        const d = Math.hypot(k.x - tg.x, k.z - tg.z);
        if (d <= tg.r) reward(s, k, 1, hooks);
        else if (d <= tg.r * 2.5) hooks.emit({ type: 'zonemiss', kart: k.id, n: 1 });
      }
    }
    k.zAir = k.air;

    // draft tunnel: close racing charges the meter, and every place gained inside it is worth a little more
    const tu = Z.tunnel;
    if (tu) {
      const inside = inTunnel(T, tu, k.idx);
      if (inside && k.zTun < 0 && crossed(T, prev, k.idx, tu.i0)) k.zTun = k.rank;
      if (inside && k.zTun >= 0 && s.moves && k.meter < 1 && k.spin <= 0) {
        const close =
          k.drafting ||
          s.karts.some((c) => c !== k && !c.out && Math.abs(c.prog - k.prog) < 1.6 && Math.abs(c.lat - k.lat) < 6.5);
        if (close) k.meter = Math.min(1, k.meter + dt * TUNNEL_METER);
      }
      if (!inside && k.zTun >= 0) {
        const gained = k.zTun - k.rank;
        k.zTun = -1;
        if (gained > 0) {
          let lvl = 0;
          if (s.moves && k.meter < 1) {
            k.meter = Math.min(1, k.meter + Math.min(0.3, PASS_METER * gained));
            lvl = 2;
          }
          hooks.emit({ type: 'zone', kart: k.id, n: 2, lvl, power: gained });
        }
      }
    }
  }
}

/** Does this AI kart go for this zone on this lap? Fixed per kart, zone and lap; a player's autopilot always does. */
function tries(s: GameState, k: Kart, zi: number): boolean {
  if (k.slot !== null) return true;
  let x = Math.imul(k.id + 17, 2654435761) ^ Math.imul(zi + 3, 40503) ^ Math.imul(k.lap + 7, 97);
  x = Math.imul(x ^ (x >>> 15), 2246822507);
  return ((x ^ (x >>> 13)) >>> 0) / 4294967296 < TRY[s.diff];
}

/** The AI's weave (m either side): a little wider than the gate centres, as its line cuts each swing short. */
const AI_WEAVE = 4.1;
/**
 * The AI's lane at road sample `j` (the point it steers for) through the fun zones, or null when it is not going for
 * one: a smooth weave through the gates (each gate's centre, eased in between; `weave` set), round the outside of
 * the cones, or lined up with the bullseye.
 */
export function zoneLane(s: GameState, k: Kart, j: number): { lane: number; weave: boolean } | null {
  const Z = s.zones;
  if (!Z || k.finished || k.inSc) return null;
  const T = s.track,
    N = T.N;
  const sl = Z.slalom;
  if (sl) {
    const g0 = sl.gates[0]!.idx,
      gs = (sl.gates[1]!.idx - g0 + N) % N,
      last = gs * (sl.gates.length - 1);
    const me = (k.idx - g0 + N) % N;
    const before = me > N - Math.round(110 / T.DS);
    const go = tries(s, k, 0);
    // not going for it: round the outside of the cones, on the side it is on
    if (k.slot === null && !go && (before || me <= last + 3)) {
      const p = (j - g0 + N) % N;
      if (p <= last + 3 || p > N - Math.round(25 / T.DS))
        return { lane: (k.lat >= 0 ? 1 : -1) * Math.min(SLALOM_OFF + SLALOM_HALF + 1.7, T.HW[j]! - 3), weave: false };
    }
    // going for it: before the first gate and on through them (a spoilt run keeps the weave, clear of the cones)
    if (go && (before || me <= last)) {
      let p = (j - g0 + N) % N;
      if (p > N / 2) p = 0;
      const w = (g: number): number => Math.sign(sl.gates[g]!.lat) * AI_WEAVE;
      if (p >= last) return { lane: w(sl.gates.length - 1), weave: true };
      const m = Math.floor(p / gs),
        t = (p - m * gs) / gs;
      const a = w(m),
        b = w(m + 1);
      return { lane: a + (b - a) * (1 - Math.cos(Math.PI * t)) * 0.5, weave: true };
    }
  }
  const tg = Z.target;
  if (tg && tries(s, k, 1)) {
    const a = ((tg.lip - k.idx + N) % N) * T.DS;
    if (a < 160 || (k.air && k.zAim)) return { lane: tg.lat, weave: false };
  }
  return null;
}
