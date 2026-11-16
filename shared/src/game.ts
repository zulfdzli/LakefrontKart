/**
 * Game state and simulation: kart physics, items, race rules and ranking.
 * Pure TypeScript: no DOM, no Three.js. The host runs it; tests run it headlessly.
 *
 * Ported from the prototype's //#LOGIC block. Floating-point expressions and the order of RNG draws
 * are kept identical on purpose, so tests/prototype-parity.test.ts can prove the port matches the
 * prototype exactly (1 human, same seed). Behaviour changes belong in later phases, behind that test.
 */
import {
  STEP, NKARTS, ROAD_HALF, KERB_W, WALL, KART_R, BOOSTSP, SPIN_T, RESCUE_T, MAX_BOOST,
  COUNTDOWN_T, RACE_END_GRACE, clamp, wrapA,
} from './constants';
import { CHARS, charParams, type Character, type CharacterParams } from './characters';
import { buildPrototypeTrack, locate, posOnTrack, type Track } from './track';
import { chooseItem, type ItemId } from './items';
import { Rng } from './rng';
import { aiInput, DIFF, HUMAN_AUTOPILOT, type AiConfig, type Difficulty } from './ai';

/* ---------------- types ---------------- */

export type GamePhase = 'grid' | 'countdown' | 'race' | 'finished';

export interface KartInput {
  /** -1 (left) to 1 (right). */
  steer: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  /** One-shot item press, consumed by the next simulation step. */
  item: boolean;
  /** Fire the item backwards. */
  itemBack: boolean;
}

export interface Kart {
  id: number;
  ci: number;
  ch: Character;
  P: CharacterParams;
  name: string;
  /** Player slot 0-4 for human karts, null for AI karts. */
  slot: number | null;
  /** True when the AI drives this kart: AI karts, and humans whose phone is disconnected. */
  ai: boolean;
  x: number; z: number; y: number; h: number;
  /** Previous-step transform, for render interpolation. */
  px: number; pz: number; py: number; ph: number;
  vx: number; vz: number; sp: number; kick: number; steerS: number;
  drifting: boolean; driftDir: number; driftT: number; driftLevel: number;
  boost: number; boostTier: number; spin: number; invuln: number; hop: number; padCool: number;
  item: ItemId | null; itemUses: number; roll: number; pending: ItemId | null; itemWait: number;
  shield: number; stall: number; draft: number; drafting: boolean;
  rescue: number; stuckT: number; wrongT: number; lostT: number; wall: boolean; slope: number; rbMul: number;
  idx: number; lastIdx: number; lat: number; frac: number;
  lap: number; lapStart: number; lapTimes: number[]; bestLap: number; prog: number;
  offroad: boolean; finished: boolean; finishTime: number; rank: number;
  startPress: number | null; startDone: boolean; prevDrift: boolean;
  input: KartInput;
  aiCfg: AiConfig;
}

export interface ItemBox { x: number; z: number; y: number; idx: number; lat: number; cool: number }
export interface BoostPad { x: number; z: number; y: number; idx: number }
export interface Slick { x: number; z: number; y: number; idx: number; lat: number; frac: number; age: number; owner: Kart; r: number }
export interface Orb { prog: number; lat: number; dir: number; owner: Kart; age: number; x: number; z: number; y: number; target: Kart | null }
export interface Bolt { x: number; z: number; y: number; vx: number; vz: number; idx: number; lat: number; frac: number; bounces: number; age: number; owner: Kart }

export type GameEventType =
  | 'cd' | 'go' | 'boost' | 'pad' | 'perfect' | 'stall' | 'pickup' | 'item'
  | 'useturbo' | 'useoil' | 'useorb' | 'usebolt' | 'useshield' | 'shieldpop'
  | 'hit' | 'orbhit' | 'bolthit' | 'orbpop' | 'boltbounce' | 'bump' | 'draft'
  | 'driftstart' | 'driftlevel' | 'rescue' | 'lap' | 'finish' | 'raceover';

/** Events drive the renderer, audio and phone feedback. `kart` is the kart id, or -1. */
export interface GameEvent {
  type: GameEventType;
  kart: number;
  other?: number;
  x?: number; y?: number; z?: number;
  /** Boost duration. */
  t?: number;
  src?: 'drift' | 'pad' | 'item' | 'start';
  lvl?: number;
  power?: number;
  box?: number;
  /** Countdown number. */
  n?: number;
}

export interface HumanSpec {
  slot: number;
  /** Index into CHARS. */
  ci: number;
  name?: string;
}

export interface GameOptions {
  seed: number;
  humans: HumanSpec[];
  /** Fill the field with AI karts up to `totalKarts`. */
  aiFill: boolean;
  totalKarts?: number;
  laps: number;
  difficulty: Difficulty;
  itemsOn: boolean;
  track?: Track;
  /**
   * Grid position (0 = pole, then alternating columns) for each kart in kart order (humans first, then AI).
   * Default: humans at the back in join order, AI in front (see DEFAULT_GRID).
   */
  grid?: number[];
  /** Seconds after the first human finishes before the race is closed. */
  raceEndGrace?: number;
}

export interface GameState {
  phase: GamePhase;
  time: number;
  raceTime: number;
  cd: number;
  lastCd: number;
  laps: number;
  diff: Difficulty;
  itemsOn: boolean;
  track: Track;
  karts: Kart[];
  humans: Kart[];
  boxes: ItemBox[];
  pads: BoostPad[];
  slicks: Slick[];
  orbs: Orb[];
  bolts: Bolt[];
  events: GameEvent[];
  rng: Rng;
  seed: number;
  /** Race time when the first human finished, or null. */
  firstHumanFinish: number | null;
  raceEndGrace: number;
  /** Final order once phase is 'finished'. */
  standings: Kart[] | null;
}

/* ---------------- setup ---------------- */

export const NEUTRAL: Readonly<KartInput> = { steer: 0, throttle: false, brake: false, drift: false, item: false, itemBack: false };
const PAD_FRACS = [0.13, 0.4, 0.68, 0.93];
const BOX_FRACS = [0.07, 0.2, 0.33, 0.47, 0.6, 0.75, 0.9];
const AI_LANES = [-6, 6, -3, 3, 0];

/** The prototype's grid: the single player started 5th (grid 4), AI filled the rest. */
export const PROTOTYPE_GRID = [4, 0, 1, 2, 3, 5];

/** Humans start at the back in join order (P1 the frontmost of them), AI karts in front. */
export function defaultGrid(humanCount: number, total: number): number[] {
  const aiCount = total - humanCount;
  const grid: number[] = [];
  for (let h = 0; h < humanCount; h++) grid.push(aiCount + h);
  for (let a = 0; a < aiCount; a++) grid.push(a);
  return grid;
}

function makeKart(T: Track, i: number, gridPos: number, ci: number, slot: number | null, aiCfg: AiConfig): Kart {
  const { N, CX, CZ, RX, RZ, ANG } = T;
  const row = gridPos >> 1,
    col = gridPos & 1;
  const gi = (N - 3 - row * 3 + N) % N,
    lat = col ? 5.5 : -5.5;
  const ch = CHARS[ci]!;
  const k: Kart = {
    id: i, ci, ch, P: charParams(ch), name: ch.name, slot, ai: slot === null,
    x: CX[gi]! + RX[gi]! * lat, z: CZ[gi]! + RZ[gi]! * lat, y: 0, h: ANG[gi]!, px: 0, pz: 0, py: 0, ph: 0,
    vx: 0, vz: 0, sp: 0, kick: 0, steerS: 0,
    drifting: false, driftDir: 0, driftT: 0, driftLevel: 0,
    boost: 0, boostTier: 1, spin: 0, invuln: 0, hop: 0, padCool: 0,
    item: null, itemUses: 0, roll: 0, pending: null, itemWait: 0,
    shield: 0, stall: 0, draft: 0, drafting: false, rescue: 0, stuckT: 0, wrongT: 0, lostT: 0, wall: false, slope: 0, rbMul: 1,
    idx: gi, lastIdx: gi, lat, frac: 0, lap: 0, lapStart: 0, lapTimes: [], bestLap: 0, prog: 0,
    offroad: false, finished: false, finishTime: 0, rank: i,
    startPress: null, startDone: false, prevDrift: false,
    input: { steer: 0, throttle: false, brake: false, drift: false, item: false, itemBack: false },
    aiCfg,
  };
  locate(T, k, true);
  k.lastIdx = k.idx;
  k.prog = k.lap * N + k.idx + k.frac;
  k.px = k.x; k.pz = k.z; k.py = k.y; k.ph = k.h;
  return k;
}

/* ---------------- the game ---------------- */

/** Pending phone input per slot (latest wins). */
interface SlotInput extends KartInput {
  itemPending: boolean;
}

export class Game {
  readonly s: GameState;
  private readonly slotInputs = new Map<number, SlotInput>();

  constructor(opts: GameOptions) {
    const track = opts.track ?? buildPrototypeTrack();
    const rng = new Rng(opts.seed);
    const s: GameState = {
      phase: 'grid', time: 0, raceTime: 0, cd: 0, lastCd: 4, laps: opts.laps, diff: opts.difficulty, itemsOn: opts.itemsOn,
      track, karts: [], humans: [], boxes: [], pads: [], slicks: [], orbs: [], bolts: [], events: [],
      rng, seed: opts.seed, firstHumanFinish: null, raceEndGrace: opts.raceEndGrace ?? RACE_END_GRACE, standings: null,
    };
    this.s = s;

    const total = opts.aiFill ? Math.max(opts.totalKarts ?? NKARTS, opts.humans.length) : opts.humans.length;
    const grid = opts.grid ?? defaultGrid(opts.humans.length, total);
    if (grid.length < total) throw new Error(`grid has ${grid.length} positions for ${total} karts`);
    const used = new Set(opts.humans.map((h) => h.ci));
    if (used.size !== opts.humans.length) throw new Error('every human needs a unique character');
    const aiChars: number[] = [];
    for (let c = 0; c < CHARS.length; c++) if (!used.has(c)) aiChars.push(c);
    const D = DIFF[s.diff];

    // humans first (join order), then AI. RNG draw order matches the prototype: one draw per AI kart, in order.
    let i = 0;
    for (const h of opts.humans) {
      const k = makeKart(track, i, grid[i]!, h.ci, h.slot, { ...HUMAN_AUTOPILOT });
      if (h.name) k.name = h.name;
      s.karts.push(k);
      s.humans.push(k);
      i++;
    }
    for (let a = 0; i < total; a++, i++) {
      const ci = aiChars[a % aiChars.length]!;
      const cfg: AiConfig = {
        skill: D.skill[a % D.skill.length]!, lane: AI_LANES[a % AI_LANES.length]!, ph: rng.range(0, 6),
        drifts: !!D.drift[a % D.drift.length], corner: D.corner,
      };
      s.karts.push(makeKart(track, i, grid[i]!, ci, null, cfg));
    }

    const { N, CX, CZ, RX, RZ, H } = track;
    if (opts.itemsOn) {
      for (const f of BOX_FRACS) {
        const bi = Math.floor(f * N);
        for (const lat of [-9, -3, 3, 9]) s.boxes.push({ x: CX[bi]! + RX[bi]! * lat, z: CZ[bi]! + RZ[bi]! * lat, y: H[bi]!, idx: bi, lat, cool: 0 });
      }
    }
    for (const f of PAD_FRACS) {
      const pi = Math.floor(f * N);
      s.pads.push({ x: CX[pi]!, z: CZ[pi]!, y: H[pi]!, idx: pi });
    }
    this.updateRanks();
  }

  /* ---- public API ---- */

  /** Start the 3-2-1-GO countdown. */
  startCountdown(): void {
    if (this.s.phase !== 'grid') return;
    this.s.phase = 'countdown';
    this.s.cd = COUNTDOWN_T;
    this.s.lastCd = 4;
  }

  /** Latest controller input for a slot. `item` is a one-shot press that is held until the next step consumes it. */
  setInput(slot: number, inp: { steer: number; throttle: boolean; brake: boolean; drift: boolean; item?: 'forward' | 'back' | null }): void {
    let si = this.slotInputs.get(slot);
    if (!si) {
      si = { steer: 0, throttle: false, brake: false, drift: false, item: false, itemBack: false, itemPending: false };
      this.slotInputs.set(slot, si);
    }
    si.steer = clamp(Number.isFinite(inp.steer) ? inp.steer : 0, -1, 1);
    si.throttle = inp.throttle;
    si.brake = inp.brake;
    si.drift = inp.drift;
    if (inp.item) {
      si.itemPending = true;
      si.itemBack = inp.item === 'back';
    }
  }

  /** Hand a human's kart to the AI (phone disconnected) or back to the phone. */
  setHumanAi(slot: number, ai: boolean): void {
    const k = this.s.humans.find((h) => h.slot === slot);
    if (k) k.ai = ai;
  }

  /** Advance exactly one fixed step. */
  step(dt: number = STEP): void {
    this.applySlotInputs();
    this.stepWorld(dt);
  }

  /** Take (and clear) the events produced since the last call. */
  drainEvents(): GameEvent[] {
    const ev = this.s.events;
    this.s.events = [];
    return ev;
  }

  /** Read-only view of the state, for the renderer and HUD. */
  getSnapshot(): Readonly<GameState> {
    return this.s;
  }

  /* ---- internals ---- */

  private applySlotInputs(): void {
    const s = this.s;
    if (s.phase !== 'countdown' && s.phase !== 'race' && s.phase !== 'finished') return;
    for (const k of s.humans) {
      if (k.ai || k.finished || k.slot === null) continue;
      const si = this.slotInputs.get(k.slot);
      if (!si) continue;
      const inp = k.input;
      inp.steer = si.steer;
      inp.throttle = si.throttle;
      inp.brake = si.brake;
      inp.drift = si.drift;
      if (si.itemPending) {
        inp.item = true;
        inp.itemBack = si.itemBack;
        si.itemPending = false;
      }
    }
  }

  private emit(e: GameEvent): void {
    this.s.events.push(e);
  }

  updateRanks(): Kart[] {
    const o = this.s.karts
      .slice()
      .sort((a, b) => Number(b.finished) - Number(a.finished) || (a.finished && b.finished ? a.finishTime - b.finishTime : b.prog - a.prog));
    o.forEach((k, i) => (k.rank = i));
    return o;
  }

  private giveBoost(k: Kart, t: number, src: GameEvent['src']): void {
    k.boost = Math.min(MAX_BOOST, Math.max(k.boost, t));
    k.boostTier = t >= 1.8 ? 3 : t >= 1.15 ? 2 : 1;
    k.kick += 4;
    this.emit({ type: 'boost', kart: k.id, t, src });
  }

  private endDrift(k: Kart): void {
    if (k.drifting && k.driftLevel > 0) this.giveBoost(k, [0, 0.7, 1.2, 1.9][k.driftLevel]!, 'drift');
    k.drifting = false; k.driftT = 0; k.driftLevel = 0;
  }

  spinOut(k: Kart): boolean {
    if (k.spin > 0 || k.invuln > 0 || k.rescue > 0) return false;
    if (k.shield > 0) {
      k.shield = 0; k.invuln = 0.6;
      this.emit({ type: 'shieldpop', kart: k.id });
      return false;
    }
    k.spin = SPIN_T; k.boost = 0; k.drifting = false; k.driftT = 0; k.driftLevel = 0;
    k.vx *= 0.35; k.vz *= 0.35;
    this.emit({ type: 'hit', kart: k.id });
    return true;
  }

  private startRescue(k: Kart): void {
    if (k.rescue > 0) return;
    k.rescue = RESCUE_T; k.drifting = false; k.driftT = 0; k.driftLevel = 0; k.boost = 0; k.spin = 0;
    k.stuckT = 0; k.wrongT = 0; k.lostT = 0; k.vx = 0; k.vz = 0; k.sp = 0;
    this.emit({ type: 'rescue', kart: k.id });
  }

  private stepRescue(k: Kart, dt: number): void {
    const T = this.s.track;
    const before = k.rescue;
    k.rescue -= dt; k.vx = 0; k.vz = 0; k.sp = 0;
    if (before > RESCUE_T / 2 && k.rescue <= RESCUE_T / 2) {
      const i = k.idx;
      k.x = T.CX[i]!; k.z = T.CZ[i]!; k.h = T.ANG[i]!; locate(T, k, false);
      k.px = k.x; k.pz = k.z; k.py = k.y; k.ph = k.h; k.lastIdx = k.idx; k.prog = k.lap * T.N + k.idx + k.frac;
    }
    if (k.rescue <= 0) {
      k.rescue = 0; k.invuln = 1.5; k.vx = Math.sin(k.h) * 10; k.vz = Math.cos(k.h) * 10; k.sp = 10;
    }
  }

  /** Is this kart driven by the AI right now? AI karts, disconnected humans and finished humans. */
  static autoDriven(k: Kart): boolean {
    return k.ai || k.finished;
  }

  private stepKart(k: Kart, dt: number): void {
    const s = this.s, T = s.track;
    const { N, TX, TZ, RX, RZ, ANG } = T;
    const racing = s.phase === 'race' || s.phase === 'finished';
    if (k.rescue > 0) { this.stepRescue(k, dt); return; }
    let inp: Readonly<KartInput> = racing ? k.input : NEUTRAL;
    if (k.spin > 0) { k.spin -= dt; if (k.spin <= 0) { k.spin = 0; k.invuln = 2; } inp = NEUTRAL; }
    if (k.invuln > 0) k.invuln -= dt;
    if (k.boost > 0) { k.boost -= dt; if (k.boost < 0) k.boost = 0; }
    if (k.hop > 0) k.hop -= dt;
    if (k.padCool > 0) k.padCool -= dt;
    if (k.shield > 0) k.shield -= dt;
    if (k.stall > 0) k.stall -= dt;
    const P = k.P, thr = inp.throttle && k.stall <= 0;

    const dS = inp.steer - k.steerS, mr = 7 * dt;
    k.steerS += Math.abs(dS) < mr ? dS : Math.sign(dS) * mr;
    const steer = k.steerS;

    let fx = Math.sin(k.h), fz = Math.cos(k.h), rx = -fz, rz = fx;
    let sp = k.vx * fx + k.vz * fz, lat = k.vx * rx + k.vz * rz;
    if (k.kick) { sp += k.kick; k.kick = 0; }
    const off = k.offroad;
    const top = k.boost > 0 ? (off ? 32 : BOOSTSP) : (off ? 15 : P.top * k.rbMul + (k.drafting ? 4 : 0));

    if (thr) { if (sp < top) sp = Math.min(top, sp + (k.boost > 0 ? 70 : Math.max(5, (P.acc + (k.drafting ? 6 : 0)) * (1 - Math.max(0, sp) / top))) * dt); }
    else if (k.spin <= 0) { const d = 7 * dt; sp = Math.abs(sp) <= d ? 0 : sp - Math.sign(sp) * d; }
    if (inp.brake) sp = sp > 0 ? Math.max(0, sp - 48 * dt) : Math.max(-10, sp - 16 * dt);
    if (racing) sp -= k.slope * 9 * dt;
    if (sp > top) sp -= (sp - top) * Math.min(1, 2.2 * dt);
    if (off) sp *= Math.exp(-0.8 * dt);
    if (k.spin > 0) { sp *= Math.exp(-2.5 * dt); lat *= Math.exp(-2.5 * dt); }

    if (!k.drifting && inp.drift && Math.abs(steer) > 0.3 && sp > 17 && k.spin <= 0) {
      k.drifting = true; k.driftDir = steer > 0 ? 1 : -1; k.driftT = 0; k.driftLevel = 0; k.hop = 0.25;
      this.emit({ type: 'driftstart', kart: k.id });
    }
    let turn = steer;
    if (k.drifting) {
      if (!inp.drift || sp < 11 || k.spin > 0) this.endDrift(k);
      else {
        turn = k.driftDir * (0.7 + 0.55 * steer * k.driftDir);
        k.driftT += dt * P.driftRate * (0.8 + 0.5 * Math.max(0, steer * k.driftDir));
        const lv = k.driftT >= 3 ? 3 : k.driftT >= 2 ? 2 : k.driftT >= 1 ? 1 : 0;
        if (lv > k.driftLevel) { k.driftLevel = lv; this.emit({ type: 'driftlevel', kart: k.id, lvl: lv }); }
      }
    }

    const spAbs = Math.abs(sp), sf = Math.min(1, spAbs / 7);
    let rate = 1.8 * sf * (1 - 0.3 * Math.min(1, spAbs / 40)) * P.turn;
    if (k.drifting) rate *= 1.3;
    if (k.spin > 0) rate = 0;
    const vx = fx * sp + rx * lat, vz = fz * sp + rz * lat;
    k.h = wrapA(k.h - turn * rate * (sp >= 0 ? 1 : -1) * dt);
    fx = Math.sin(k.h); fz = Math.cos(k.h); rx = -fz; rz = fx;
    sp = vx * fx + vz * fz; lat = vx * rx + vz * rz;
    {
      // sideways grip turns the slide back into forward motion instead of bleeding speed away
      const newLat = lat * Math.exp(-(k.drifting ? 4.5 : (off ? 4 : 9)) * dt);
      const v2 = (sp * sp + lat * lat) * Math.exp(-(k.drifting ? 0.3 : 0.1) * dt);
      sp = (sp >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, v2 - newLat * newLat));
      lat = newLat;
    }
    k.vx = fx * sp + rx * lat; k.vz = fz * sp + rz * lat; k.sp = sp;
    k.x += k.vx * dt; k.z += k.vz * dt;

    locate(T, k, false);
    k.wall = false;
    if (Math.abs(k.lat) > WALL) {
      // walls: slide along with friction that depends on the impact angle
      const sgn = k.lat > 0 ? 1 : -1, over = Math.abs(k.lat) - WALL, i = k.idx;
      k.x -= RX[i]! * sgn * over; k.z -= RZ[i]! * sgn * over;
      const vo = (k.vx * RX[i]! + k.vz * RZ[i]!) * sgn;
      if (vo > 0) {
        const vmag = Math.hypot(k.vx, k.vz) + 1e-6, impact = vo / vmag;
        k.vx -= RX[i]! * sgn * vo * 1.25; k.vz -= RZ[i]! * sgn * vo * 1.25;
        // friction along the wall scales with how hard the kart hits it
        const vt = k.vx * TX[i]! + k.vz * TZ[i]!, fr = Math.min(Math.abs(vt), vo * 0.5) * Math.sign(vt);
        k.vx -= fr * TX[i]!; k.vz -= fr * TZ[i]!;
        if (vo > 9) this.emit({ type: 'bump', kart: k.id, power: impact });
      }
      // nosing into the wall: steer the kart to slide along it instead of pinning
      const into = (Math.sin(k.h) * RX[i]! + Math.cos(k.h) * RZ[i]!) * sgn;
      if (into > 0.05) {
        const fdir = (Math.sin(k.h) * TX[i]! + Math.cos(k.h) * TZ[i]!) >= 0 ? 1 : -1;
        const tgt = Math.atan2(TX[i]! * fdir, TZ[i]! * fdir);
        k.h = wrapA(k.h + clamp(wrapA(tgt - k.h), -2.4 * dt, 2.4 * dt));
      }
      k.wall = true; k.lat = sgn * WALL;
    }
    k.offroad = Math.abs(k.lat) > ROAD_HALF + KERB_W;

    if (k.lastIdx > N * 0.75 && k.idx < N * 0.25) {
      k.lap++;
      if (k.lap >= 2) { const lt = s.raceTime - k.lapStart; k.lapTimes.push(lt); if (!k.bestLap || lt < k.bestLap) k.bestLap = lt; }
      k.lapStart = s.raceTime;
      this.emit({ type: 'lap', kart: k.id });
      if (k.lap > s.laps && !k.finished) {
        k.finished = true; k.finishTime = s.raceTime;
        this.emit({ type: 'finish', kart: k.id });
      }
    } else if (k.lastIdx < N * 0.25 && k.idx > N * 0.75) k.lap--;
    k.lastIdx = k.idx;
    k.prog = k.lap * N + k.idx + k.frac;

    if (racing) {
      const fd = fx * TX[k.idx]! + fz * TZ[k.idx]!;
      if (fd < -0.25 && Math.abs(sp) > 2) k.wrongT += dt; else k.wrongT = Math.max(0, k.wrongT - dt * 2);
      if (thr && k.spin <= 0 && Math.abs(sp) < 3) k.stuckT += dt; else k.stuckT = Math.max(0, k.stuckT - dt);
      const bot = Game.autoDriven(k);
      if (bot && k.spin <= 0 && Math.abs(wrapA(k.h - ANG[k.idx]!)) > 1.4) k.lostT += dt; else k.lostT = 0;
      if (k.stuckT > 2.5 || (bot && (k.wrongT > 2.5 || k.lostT > 3))) this.startRescue(k);
    }

    if (inp.item && k.item && k.spin <= 0 && k.roll <= 0 && k.rescue <= 0) this.useItem(k, inp.itemBack);
    k.input.item = false;
  }

  private useItem(k: Kart, back: boolean): void {
    const s = this.s, T = s.track;
    const it = k.item;
    const fx = Math.sin(k.h), fz = Math.cos(k.h);
    if (it === 'turbo3') {
      this.giveBoost(k, 1.0, 'item'); k.itemUses--; if (k.itemUses <= 0) k.item = null;
      this.emit({ type: 'useturbo', kart: k.id });
      return;
    }
    k.item = null;
    if (it === 'turbo') { this.giveBoost(k, 1.6, 'item'); this.emit({ type: 'useturbo', kart: k.id }); }
    else if (it === 'oil') {
      const sl: Slick = { x: k.x - fx * 4.5, z: k.z - fz * 4.5, age: 0, owner: k, r: 3.2, idx: k.idx, lat: 0, frac: 0, y: k.y };
      locate(T, sl, false);
      s.slicks.push(sl); this.emit({ type: 'useoil', kart: k.id });
    } else if (it === 'orb') {
      const dir = back ? -1 : 1;
      s.orbs.push({ prog: k.prog + dir * 1.2, lat: k.lat, dir, owner: k, age: 0, x: k.x, z: k.z, y: k.y, target: null });
      this.emit({ type: 'useorb', kart: k.id });
    } else if (it === 'bolt') {
      const dir = back ? -1 : 1, spd = 74;
      const b: Bolt = {
        x: k.x + fx * 3.2 * dir, z: k.z + fz * 3.2 * dir, vx: fx * spd * dir + (dir > 0 ? k.vx * 0.3 : 0), vz: fz * spd * dir + (dir > 0 ? k.vz * 0.3 : 0),
        idx: k.idx, lat: 0, frac: 0, y: k.y, bounces: 0, age: 0, owner: k,
      };
      locate(T, b, false);
      s.bolts.push(b); this.emit({ type: 'usebolt', kart: k.id });
    } else if (it === 'shield') { k.shield = 10; this.emit({ type: 'useshield', kart: k.id }); }
  }

  private stepOrbs(dt: number): void {
    const s = this.s, T = s.track;
    for (let n = s.orbs.length - 1; n >= 0; n--) {
      const o = s.orbs[n]!;
      o.age += dt;
      let tgt: Kart | null = null, bd = 1e9;
      for (const c of s.karts) {
        if (c === o.owner || c.finished || c.rescue > 0) continue;
        const d = (c.prog - o.prog) * o.dir;
        if (d > -0.5 && d < T.N * 0.45 && d < bd) { bd = d; tgt = c; }
      }
      o.target = tgt;
      o.prog += o.dir * 80 * dt / T.DS;
      if (tgt) o.lat += (tgt.lat - o.lat) * Math.min(1, 5 * dt);
      posOnTrack(T, o.prog, o.lat, o);
      let dead = o.age > 7;
      for (const c of s.karts) {
        if (dead) break;
        if (c === o.owner && o.age < 1) continue;
        if (c.invuln > 0 || c.spin > 0 || c.rescue > 0) continue;
        const dx = c.x - o.x, dz = c.z - o.z;
        if (dx * dx + dz * dz < 3.4 * 3.4) {
          dead = true;
          if (this.spinOut(c)) this.emit({ type: 'orbhit', kart: c.id, x: o.x, z: o.z, y: o.y });
          else this.emit({ type: 'orbpop', kart: -1, x: o.x, z: o.z, y: o.y });
        }
      }
      if (dead) s.orbs.splice(n, 1);
    }
  }

  private stepBolts(dt: number): void {
    const s = this.s, T = s.track;
    for (let n = s.bolts.length - 1; n >= 0; n--) {
      const b = s.bolts[n]!;
      b.age += dt; b.x += b.vx * dt; b.z += b.vz * dt;
      locate(T, b, false);
      const LIM = WALL + 0.8;
      if (Math.abs(b.lat) > LIM) {
        const sgn = b.lat > 0 ? 1 : -1, i = b.idx, vl = b.vx * T.RX[i]! + b.vz * T.RZ[i]!;
        b.vx -= 2 * vl * T.RX[i]!; b.vz -= 2 * vl * T.RZ[i]!;
        const over = Math.abs(b.lat) - LIM; b.x -= T.RX[i]! * sgn * over; b.z -= T.RZ[i]! * sgn * over;
        b.bounces++; this.emit({ type: 'boltbounce', kart: -1, x: b.x, z: b.z, y: b.y });
      }
      let dead = b.bounces > 3 || b.age > 5;
      for (const c of s.karts) {
        if (dead) break;
        if (c === b.owner && b.age < 0.35) continue;
        if (c.invuln > 0 || c.spin > 0 || c.rescue > 0) continue;
        const dx = c.x - b.x, dz = c.z - b.z;
        if (dx * dx + dz * dz < 2.7 * 2.7) { dead = true; if (this.spinOut(c)) this.emit({ type: 'bolthit', kart: c.id, x: b.x, z: b.z, y: b.y }); }
      }
      if (dead) s.bolts.splice(n, 1);
    }
  }

  private stepSlicks(dt: number): void {
    const s = this.s;
    for (let n = s.slicks.length - 1; n >= 0; n--) {
      const sl = s.slicks[n]!;
      sl.age += dt;
      let dead = sl.age > 40;
      for (const c of s.karts) {
        if (dead) break;
        if (c === sl.owner && sl.age < 0.8) continue;
        const dx = c.x - sl.x, dz = c.z - sl.z;
        if (dx * dx + dz * dz < sl.r * sl.r && this.spinOut(c)) dead = true;
      }
      if (dead) s.slicks.splice(n, 1);
    }
  }

  private rocketStart(k: Kart, t: number): void {
    this.giveBoost(k, t, 'start'); k.kick += 8; k.startDone = true;
    this.emit({ type: 'perfect', kart: k.id });
  }

  private stepWorld(dt: number): void {
    const s = this.s;
    s.time += dt;
    for (const k of s.karts) { k.px = k.x; k.pz = k.z; k.py = k.y; k.ph = k.h; }
    if (s.phase === 'grid') return;
    if (s.phase === 'countdown') {
      s.cd -= dt;
      for (const k of s.humans) {
        const d = k.input.drift;
        if (d && !k.prevDrift && k.startPress === null) k.startPress = Math.max(0, s.cd);
        k.prevDrift = d;
      }
      const c = Math.ceil(s.cd);
      if (c !== s.lastCd && c >= 1 && c <= 3) { s.lastCd = c; this.emit({ type: 'cd', kart: -1, n: c }); }
      if (s.cd <= 0) {
        s.phase = 'race'; s.raceTime = 0; this.emit({ type: 'go', kart: -1 });
        const D = DIFF[s.diff];
        for (const k of s.karts) {
          if (k.slot !== null && !Game.autoDriven(k)) {
            const sp = k.startPress;
            if (sp !== null) {
              k.startDone = true;
              if (sp <= 0.35) this.rocketStart(k, 1.3);
              else if (sp > 0.9) { k.stall = 0.7; this.emit({ type: 'stall', kart: k.id }); }
            }
          } else if (s.rng.next() < D.start) this.rocketStart(k, 1.2);
        }
      }
      return;
    }
    s.raceTime += dt;
    // late rocket start: DRIFT pressed within 0.25 s after GO
    for (const P of s.humans) {
      if (!P.startDone && P.startPress === null && s.raceTime < 0.25 && P.input.drift && !P.prevDrift) this.rocketStart(P, 1.1);
      if (s.raceTime >= 0.25) P.startDone = true;
      P.prevDrift = P.input.drift;
    }

    for (const k of s.karts) {
      if (Game.autoDriven(k)) aiInput(s, k, dt);
      this.stepKart(k, dt);
    }
    const karts = s.karts;
    for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
      const a = karts[i]!, b = karts[j]!;
      if (a.rescue > 0 || b.rescue > 0) continue;
      let dx = a.x - b.x, dz = a.z - b.z;
      const d2 = dx * dx + dz * dz, R = KART_R * 2;
      if (d2 < R * R) {
        const d = Math.sqrt(d2) || 0.001; dx /= d; dz /= d;
        const ma = a.P.mass, mb = b.P.mass, tot = ma + mb, pen = R - d;
        a.x += dx * pen * mb / tot; a.z += dz * pen * mb / tot; b.x -= dx * pen * ma / tot; b.z -= dz * pen * ma / tot;
        const rv = (a.vx - b.vx) * dx + (a.vz - b.vz) * dz;
        if (rv < 0) {
          const jimp = -1.35 * rv / (1 / ma + 1 / mb);
          a.vx += dx * jimp / ma; a.vz += dz * jimp / ma; b.vx -= dx * jimp / mb; b.vz -= dz * jimp / mb;
          if (-rv > 6) this.emit({ type: 'bump', kart: a.id, other: b.id, power: Math.min(1, -rv / 20) });
        }
      }
    }
    for (const k of karts) {
      if (k.roll > 0) {
        k.roll -= dt;
        if (k.roll <= 0) {
          k.roll = 0; k.item = k.pending; k.pending = null; k.itemUses = k.item === 'turbo3' ? 3 : 1;
          k.itemWait = s.rng.range(1.5, 4) / (k.slot !== null ? 1 : DIFF[s.diff].items);
          this.emit({ type: 'item', kart: k.id });
        }
      }
      if (k.rescue > 0) continue;
      for (let bi = 0; bi < s.boxes.length; bi++) {
        const b = s.boxes[bi]!;
        if (b.cool > 0 || k.item || k.roll > 0 || k.finished) continue;
        const dx = k.x - b.x, dz = k.z - b.z;
        if (dx * dx + dz * dz < 3.8 * 3.8) { b.cool = 4; k.roll = 1.0; k.pending = chooseItem(k.rank, s.rng); this.emit({ type: 'pickup', kart: k.id, box: bi }); }
      }
      for (const p of s.pads) {
        if (k.padCool > 0) continue;
        const dx = k.x - p.x, dz = k.z - p.z;
        if (dx * dx + dz * dz < 5.5 * 5.5) { this.giveBoost(k, 1.1, 'pad'); k.padCool = 1.5; this.emit({ type: 'pad', kart: k.id }); }
      }
      // slipstream: tuck in right behind another kart
      let behind = false;
      if (k.sp > 24 && k.boost <= 0) {
        for (const c of karts) {
          if (c === k || c.rescue > 0) continue;
          const d = c.prog - k.prog;
          if (d > 0.6 && d < 5 && Math.abs(c.lat - k.lat) < 2.6) { behind = true; break; }
        }
      }
      k.draft = behind ? Math.min(1.6, k.draft + dt) : Math.max(0, k.draft - dt * 1.5);
      if (k.draft >= 1 && !k.drafting) { k.drafting = true; this.emit({ type: 'draft', kart: k.id }); }
      if (k.draft < 0.5) k.drafting = false;
    }
    for (const b of s.boxes) if (b.cool > 0) b.cool -= dt;
    this.stepOrbs(dt); this.stepBolts(dt); this.stepSlicks(dt);
    const order = this.updateRanks();
    if (s.phase === 'race') this.checkRaceEnd(order);
  }

  /** Section 6.4: the race ends when all humans have finished, or RACE_END_GRACE s after the first human finishes. */
  private checkRaceEnd(order: Kart[]): void {
    const s = this.s;
    const humans = s.humans;
    let over: boolean;
    if (humans.length === 0) over = s.karts.every((k) => k.finished);
    else {
      if (s.firstHumanFinish === null) {
        const f = humans.find((h) => h.finished);
        if (f) s.firstHumanFinish = s.raceTime;
      }
      over = humans.every((h) => h.finished) || (s.firstHumanFinish !== null && s.raceTime - s.firstHumanFinish >= s.raceEndGrace);
    }
    if (over) {
      s.phase = 'finished';
      s.standings = order;
      this.emit({ type: 'raceover', kart: -1 });
    }
  }
}

export function createGame(opts: GameOptions): Game {
  return new Game(opts);
}
