/**
 * Game state and simulation: kart physics, items, race rules and ranking.
 * Pure TypeScript: no DOM, no Three.js. The host runs it; tests run it headlessly.
 *
 * Ported from the prototype's //#LOGIC block. Floating-point expressions and the order of RNG draws
 * are kept identical on purpose, so tests/prototype-parity.test.ts can prove the port matches the
 * prototype exactly (1 human, same seed). Behaviour changes belong in later phases, behind that test.
 */
import {
  STEP,
  NKARTS,
  KERB_W,
  KART_R,
  BOOSTSP,
  SPIN_T,
  RESCUE_T,
  MAX_BOOST,
  COUNTDOWN_T,
  RACE_END_GRACE,
  clamp,
  wrapA,
} from './constants';
import { CHARS, charParams, type Character, type CharacterParams } from './characters';
import {
  SURF,
  buildPrototypeTrack,
  locate,
  posOnTrack,
  shortcutAt,
  surfaceAt,
  type SurfaceId,
  type Track,
} from './track';
import { brawlItem, chooseItem, type ItemId } from './items';
import { Rng } from './rng';
import { aiInput, DIFF, HUMAN_AUTOPILOT, type AiConfig, type Difficulty } from './ai';
import { brawlAiInput } from './brawl-ai';
import { tunedCharacter, type Tune } from './garage';
import { SQUALL_GRIP, inSquall, planHazards, stepHazards, type Hazard } from './hazards';
import { EYES_GRIP, OVERCLOCK_ACC, decoyOf, stepMoves, type Decoy } from './moves';
import { TUNNEL_DRAFT, inTunnel, planZones, stepZones, type Zones } from './zones';
import { PUDDLE_GRIP, PUDDLE_WET, WEATHER_GRIP, puddlesFor, type Puddle, type Weather } from './weather';

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
  /** D74: one-shot signature-move press. */
  move?: boolean;
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
  x: number;
  z: number;
  y: number;
  h: number;
  /** Previous-step transform, for render interpolation. */
  px: number;
  pz: number;
  py: number;
  ph: number;
  vx: number;
  vz: number;
  sp: number;
  kick: number;
  steerS: number;
  drifting: boolean;
  driftDir: number;
  driftT: number;
  driftLevel: number;
  boost: number;
  boostTier: number;
  spin: number;
  invuln: number;
  hop: number;
  padCool: number;
  item: ItemId | null;
  itemUses: number;
  roll: number;
  pending: ItemId | null;
  itemWait: number;
  shield: number;
  stall: number;
  draft: number;
  drafting: boolean;
  rescue: number;
  stuckT: number;
  wrongT: number;
  lostT: number;
  wall: boolean;
  slope: number;
  rbMul: number;
  /** D71: seconds of puddle-wet tyres left, and the puddle the kart is in (-1 none). */
  wet: number;
  inPud: number;
  /** D73: seconds before a track event can hit this kart again. */
  hazCool: number;
  /** D74 signature move: the meter (full at 1), how long it has been full, and the effects running (s). */
  meter: number;
  moveHold: number;
  slideT: number;
  overT: number;
  eyesT: number;
  eyesDodge: boolean;
  decoy: Decoy | null;
  /**
   * D83 fun zones: the road sample at the last zone step, slalom gates cleared on this run (and whether the run is
   * spoilt), off the launch ramp for the target (and in the air last step), and the place on entering the tunnel.
   */
  zPrev: number;
  zGate: number;
  zFail: boolean;
  zAim: boolean;
  zAir: boolean;
  zTun: number;
  idx: number;
  lastIdx: number;
  lat: number;
  frac: number;
  lap: number;
  lapStart: number;
  lapTimes: number[];
  bestLap: number;
  prog: number;
  offroad: boolean;
  /** Surface under the kart (section 11.2). */
  surf: SurfaceId;
  /** Seconds left on an incoming-projectile warning (orb closing in, Seeker Comet). */
  threat: number;
  /** AI: index of the shortcut it is taking, or -1. */
  aiSc: number;
  /** Position at the last checkpoint test, so pushes from collisions between steps are counted too. */
  gpx: number;
  gpz: number;
  /** tan(banking) of the road under the kart (the renderer rolls the kart). */
  bank: number;
  /** Airborne after a jump ramp: height above the road and vertical speed. */
  air: boolean;
  alt: number;
  vy: number;
  /** Seconds in the air on the current jump (D64: bigger air, bigger landing boost). */
  airT: number;
  /** D65: absolute height of the kart while airborne (the road under it can rise and fall). */
  ay: number;
  /** D65: vertical load on the tyres (1 = flat road; more in a dip's compression, less over a crest). */
  load: number;
  /** Next checkpoint gate to pass (index into track.gates); a lap counts only when all are passed. */
  gate: number;
  /** Inside a shortcut corridor, off the road. */
  inSc: boolean;
  /** Seconds off the track (not in a shortcut); 4 s calls the rescue drone. */
  offT: number;
  /** Race time when the current sector started. */
  secStart: number;
  finished: boolean;
  finishTime: number;
  rank: number;
  startPress: number | null;
  startDone: boolean;
  prevDrift: boolean;
  input: KartInput;
  aiCfg: AiConfig;
  /** D69 Bumper Brawl: lives left (0 in a race), knocked out, and the arena AI's current target and retarget timer. */
  lives: number;
  out: boolean;
  /** D69: hits this kart has landed (the tie-break when the clock runs out). */
  hits: number;
  aiTgt: number;
  aiRe: number;
  /** D78 brawl AI: seconds locked nose to nose with its target (positive), or of backing off (negative). */
  aiStall: number;
}

export interface ItemBox {
  x: number;
  z: number;
  y: number;
  idx: number;
  lat: number;
  cool: number;
}
export interface BoostPad {
  x: number;
  z: number;
  y: number;
  idx: number;
}
export interface Slick {
  x: number;
  z: number;
  y: number;
  idx: number;
  lat: number;
  frac: number;
  age: number;
  owner: Kart;
  r: number;
}
export interface Orb {
  prog: number;
  lat: number;
  dir: number;
  owner: Kart;
  age: number;
  x: number;
  z: number;
  y: number;
  target: Kart | null;
}
/** Seeker Comet: flies over the field to the leader, striking when its warning runs out (D8). */
export interface Comet {
  owner: Kart;
  target: Kart;
  /** Seconds until it strikes. */
  t: number;
  t0: number;
  sx: number;
  sy: number;
  sz: number;
  x: number;
  y: number;
  z: number;
}
export interface Bolt {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  idx: number;
  lat: number;
  frac: number;
  bounces: number;
  age: number;
  owner: Kart;
}

export type GameEventType =
  | 'cd'
  | 'go'
  | 'boost'
  | 'pad'
  | 'perfect'
  | 'stall'
  | 'pickup'
  | 'item'
  | 'useturbo'
  | 'useoil'
  | 'useorb'
  | 'usebolt'
  | 'useshield'
  | 'shieldpop'
  | 'hit'
  | 'orbhit'
  | 'bolthit'
  | 'orbpop'
  | 'boltbounce'
  | 'bump'
  | 'draft'
  | 'driftstart'
  | 'driftlevel'
  | 'rescue'
  | 'lap'
  | 'sector'
  | 'jump'
  | 'land'
  | 'missedgate'
  | 'driftperfect'
  | 'userocket'
  | 'usecomet'
  | 'comethit'
  | 'cometmiss'
  | 'warn'
  | 'finish'
  | 'raceover'
  | 'slingshot'
  | 'guard'
  | 'float'
  /* D69 Bumper Brawl */
  | 'lifelost'
  | 'ko'
  | 'steal'
  | 'suddendeath'
  /* D71 weather */
  | 'splash'
  /* D73 living tracks */
  | 'hazardwarn'
  | 'hazard'
  | 'baa'
  | 'rockhit'
  | 'squash'
  /* D74 signature moves */
  | 'move'
  | 'shoved'
  | 'decoypop'
  | 'dodge'
  /* D83 fun zones */
  | 'zone'
  | 'zonemiss'
  | 'cone';

/** Events drive the renderer, audio and phone feedback. `kart` is the kart id, or -1. */
export interface GameEvent {
  type: GameEventType;
  kart: number;
  other?: number;
  x?: number;
  y?: number;
  z?: number;
  /** Boost duration. */
  t?: number;
  src?: 'drift' | 'pad' | 'item' | 'start' | 'jump' | 'draft' | 'move';
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
  /** D72: stat points moved in the phone garage (they add up to 0). */
  tune?: Tune;
}

export interface GameOptions {
  seed: number;
  /** D69: 'brawl' plays Bumper Brawl on an arena (default 'race'). */
  mode?: PlayMode;
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
  /** Handling tune. Default DEFAULT_HANDLING; the parity test uses PROTOTYPE_HANDLING. */
  handling?: Handling;
  /** D71: the sky the race runs under (default 'day'); rain and snow take a little grip, rain adds puddles. */
  weather?: Weather;
  /** D73: the track's living event (sheep, rockfall, snowball, squall); off unless asked for, races only. */
  events?: boolean;
  /** D74: signature moves (off unless asked for). */
  moves?: boolean;
  /** D83: the track's fun zones (slalom, jump target, draft tunnel). */
  zones?: boolean;
}

/**
 * Handling numbers that were retuned after hands-on play (D35). PROTOTYPE_HANDLING reproduces the prototype exactly.
 */
export interface Handling {
  /** Sideways grip while drifting (1/s): lower lets the kart slide out. */
  driftLatGrip: number;
  /** Speed bleed while drifting (1/s). */
  driftDrag: number;
  /** Sideways velocity added outwards when a drift starts (m/s): the tail kicks out instead of a hop. */
  driftKick: number;
  /** Hop timer on drift start (s); the host draws it. */
  driftHop: number;
  /** Scales every kart's top speed and acceleration, the boost and off-road speed caps (D36). */
  speedMul: number;
  /** Base turn rate (rad/s at full lock and low speed). */
  turnRate: number;
  /** Share of the turn rate lost at 40 m/s and above. */
  turnFalloff: number;
  /** AI starts a drift when the road ahead turns more than this (rad), and holds it above aiDriftHold. */
  aiDriftIn: number;
  aiDriftHold: number;
  /**
   * Phase 11 mechanics (D46): tyre slip-angle grip, drift-release bonus, car-shaped collisions, the 8-item roll,
   * stat balance and the v2 AI. Off in PROTOTYPE_HANDLING, so the parity test still reproduces the prototype.
   */
  v2: boolean;
  /** Tyre model: the most sideways deceleration the tyres give (m/s²) at the peak slip angle. */
  tyrePeak: number;
  /** Tyre model: share of the peak grip left deep in a slide (the soft fall-off). */
  tyreFall: number;
  /** How strongly the speed stat changes top speed (1 = prototype). */
  statSpeed: number;
  /** D65: how strongly the acceleration stat changes acceleration (1 = prototype); the hairpin-heavy short tracks
   * made it decisive. */
  statAccel: number;
  /** Extra boost (s) for releasing a drift right as a tier is reached. */
  driftBonus: number;
  /**
   * D65: the most sideways acceleration steering may ask for outside a drift (m/s²; 0 = no limit). At speed the
   * turn rate is capped at yawGrip / speed, so the car never turns in harder than its tyres hold: it grips
   * instead of stepping out, and full lock at 180 km/h is as controllable as at 60.
   */
  yawGrip: number;
  /** D65: steering expo for human drivers (0 = linear): small inputs turn gently, full lock is unchanged. */
  steerExpo: number;
  /** D65: how strongly slopes speed the kart up and slow it down (m/s² per unit slope; 9 = prototype). */
  slopeG: number;
  /** D65: item roulette time (s) after a pickup (1 = prototype; 0 = the item is ready at once). */
  itemRoll: number;
  /**
   * D65 roller coaster: karts float off crests, tyre grip follows the vertical load (more in a dip's compression,
   * less over a crest), banked turns grip harder, and air time follows the real road height under the kart.
   */
  coaster: boolean;
  /** Slipstream: reach behind a kart (samples), lateral tolerance (m), charge rate (1/s), extra top speed and acceleration. */
  draftReach: number;
  draftLat: number;
  draftCharge: number;
  draftTop: number;
  draftAcc: number;
  /** D65: boost (s) for pulling out of a charged slipstream (the slingshot); 0 = none. */
  slingshot: number;
  /** Kart-to-kart bump restitution (1.35 = prototype). */
  bumpRest: number;
  /** D65: a held (unused) Oil Slick, Homing Orb or Bounce Disc soaks up one Orb or Disc hit from behind. */
  itemGuard: boolean;
  /**
   * D76: the driving boosts: a drift's release, a jump's landing, the rocket start, and the boost items (Turbo,
   * Triple Turbo, Rocket) in the item boxes. Off at the user's request; the prototype keeps them.
   */
  boosts: boolean;
  /** D78: item boxes per row (4 = prototype; 2 since D78, at the user's request). */
  boxesPerRow: number;
}
export const PROTOTYPE_HANDLING: Readonly<Handling> = {
  driftLatGrip: 4.5,
  driftDrag: 0.3,
  driftKick: 0,
  driftHop: 0.25,
  speedMul: 1,
  turnRate: 1.8,
  turnFalloff: 0.3,
  aiDriftIn: 0.55,
  aiDriftHold: 0.22,
  v2: false,
  tyrePeak: 0,
  tyreFall: 1,
  statSpeed: 1,
  statAccel: 1,
  driftBonus: 0,
  yawGrip: 0,
  steerExpo: 0,
  slopeG: 9,
  itemRoll: 1,
  coaster: false,
  draftReach: 5,
  draftLat: 2.6,
  draftCharge: 1,
  draftTop: 4,
  draftAcc: 6,
  slingshot: 0,
  bumpRest: 1.35,
  itemGuard: false,
  boosts: true,
  boxesPerRow: 4,
};
export const DEFAULT_HANDLING: Readonly<Handling> = {
  driftLatGrip: 4.2, // D65: was 3.1 (D64: was 2.4)
  driftDrag: 0.22,
  driftKick: 1.4, // D65: was 2.5 (D64: was 3.2)
  driftHop: 0.16,
  speedMul: 1.2683, // D81: 3% faster (D78: 1.2314; D77: 1.2827; D75: 1.3224; D67: 1.3775; D62: 1.45, was 1.3)
  turnRate: 2.15,
  turnFalloff: 0.22,
  aiDriftIn: 0.32,
  aiDriftHold: 0.14,
  v2: true,
  tyrePeak: 80, // D65: was 52 (D64: was 34)
  tyreFall: 0.94, // D65: was 0.88 (D64: was 0.72)
  statSpeed: 0.45,
  statAccel: 0.6,
  driftBonus: 0.35,
  yawGrip: 74, // just under the tyre peak: the car turns as hard as it grips, never harder
  steerExpo: 0.45,
  slopeG: 15,
  itemRoll: 0,
  coaster: true,
  draftReach: 10,
  draftLat: 3.6,
  draftCharge: 1.8,
  draftTop: 7,
  draftAcc: 10,
  slingshot: 0, // D76: no slingshot (the slipstream's tow stays)
  bumpRest: 1.12,
  itemGuard: true,
  boosts: false, // D76: no drift, landing or start boosts, no boost items
  boxesPerRow: 2, // D78: two boxes a row (was 4)
};

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
  comets: Comet[];
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
  handling: Readonly<Handling>;
  /** D69: a race, or a Bumper Brawl (last kart standing in an arena). */
  mode: PlayMode;
  /** D69: sudden death has started (every kart down to its last life). */
  suddenDeath: boolean;
  /** D71: the weather, and the puddles on the road (rain only). */
  weather: Weather;
  puddles: Puddle[];
  /** D73: the race's track events. */
  hazards: Hazard[];
  /** D74: signature moves are on. */
  moves: boolean;
  /** D83: the track's fun zones (slalom, jump target, draft tunnel), or null. */
  zones: Zones | null;
}

export type PlayMode = 'race' | 'brawl';
/** D69 Bumper Brawl: lives per kart, when sudden death starts, and the hard time limit (s). */
export const BRAWL_LIVES = 3;
export const BRAWL_SUDDEN = 90;
export const BRAWL_LIMIT = 150;

/* ---------------- setup ---------------- */

export const NEUTRAL: Readonly<KartInput> = {
  steer: 0,
  throttle: false,
  brake: false,
  drift: false,
  item: false,
  itemBack: false,
};
/** Phase 11: half the distance between a car's front and rear collision circles (m). */
const CAR_HALF = 1.75;
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

function makeKart(
  T: Track,
  i: number,
  gridPos: number,
  ci: number,
  slot: number | null,
  aiCfg: AiConfig,
  tune?: Tune,
): Kart {
  const { N, CX, CZ, RX, RZ, ANG } = T;
  const row = gridPos >> 1,
    col = gridPos & 1;
  const gi = (N - 3 - row * 3 + N) % N,
    lat = col ? 5.5 : -5.5;
  const ch = tunedCharacter(CHARS[ci]!, tune);
  const k: Kart = {
    id: i,
    ci,
    ch,
    P: charParams(ch),
    name: ch.name,
    slot,
    ai: slot === null,
    x: CX[gi]! + RX[gi]! * lat,
    z: CZ[gi]! + RZ[gi]! * lat,
    y: 0,
    h: ANG[gi]!,
    px: 0,
    pz: 0,
    py: 0,
    ph: 0,
    vx: 0,
    vz: 0,
    sp: 0,
    kick: 0,
    steerS: 0,
    drifting: false,
    driftDir: 0,
    driftT: 0,
    driftLevel: 0,
    boost: 0,
    boostTier: 1,
    spin: 0,
    invuln: 0,
    hop: 0,
    padCool: 0,
    item: null,
    itemUses: 0,
    roll: 0,
    pending: null,
    itemWait: 0,
    shield: 0,
    stall: 0,
    draft: 0,
    wet: 0,
    inPud: -1,
    hazCool: 0,
    meter: 0,
    moveHold: 0,
    slideT: 0,
    overT: 0,
    eyesT: 0,
    eyesDodge: false,
    decoy: null,
    zPrev: gi,
    zGate: 0,
    zFail: true,
    zAim: false,
    zAir: false,
    zTun: -1,
    drafting: false,
    rescue: 0,
    stuckT: 0,
    wrongT: 0,
    lostT: 0,
    wall: false,
    slope: 0,
    rbMul: 1,
    idx: gi,
    lastIdx: gi,
    lat,
    frac: 0,
    lap: 0,
    lapStart: 0,
    lapTimes: [],
    bestLap: 0,
    prog: 0,
    offroad: false,
    surf: 'asphalt',
    threat: 0,
    gpx: 0,
    gpz: 0,
    aiSc: -1,
    bank: 0,
    air: false,
    alt: 0,
    vy: 0,
    airT: 0,
    ay: 0,
    load: 1,
    gate: T.gates.length,
    inSc: false,
    offT: 0,
    secStart: 0,
    finished: false,
    finishTime: 0,
    rank: i,
    startPress: null,
    startDone: false,
    prevDrift: false,
    input: { steer: 0, throttle: false, brake: false, drift: false, item: false, itemBack: false },
    aiCfg,
    lives: 0,
    out: false,
    hits: 0,
    aiTgt: -1,
    aiRe: 0,
    aiStall: 0,
  };
  locate(T, k, true);
  k.gpx = k.x;
  k.gpz = k.z;
  k.lastIdx = k.idx;
  k.prog = k.lap * N + k.idx + k.frac;
  k.px = k.x;
  k.pz = k.z;
  k.py = k.y;
  k.ph = k.h;
  return k;
}

/* ---------------- the game ---------------- */

/** Pending phone input per slot (latest wins). */
interface SlotInput extends KartInput {
  itemPending: boolean;
  movePending?: boolean;
}

export class Game {
  readonly s: GameState;
  readonly handling: Readonly<Handling>;
  private readonly slotInputs = new Map<number, SlotInput>();

  constructor(opts: GameOptions) {
    const track = opts.track ?? buildPrototypeTrack();
    const rng = new Rng(opts.seed);
    const s: GameState = {
      phase: 'grid',
      time: 0,
      raceTime: 0,
      cd: 0,
      lastCd: 4,
      laps: opts.laps,
      diff: opts.difficulty,
      itemsOn: opts.itemsOn,
      track,
      karts: [],
      humans: [],
      boxes: [],
      pads: [],
      slicks: [],
      comets: [],
      orbs: [],
      bolts: [],
      events: [],
      rng,
      seed: opts.seed,
      firstHumanFinish: null,
      raceEndGrace: opts.raceEndGrace ?? RACE_END_GRACE,
      standings: null,
      handling: opts.handling ?? DEFAULT_HANDLING,
      mode: opts.mode ?? 'race',
      suddenDeath: false,
      weather: opts.weather ?? 'day',
      puddles: opts.weather === 'rain' ? puddlesFor(track) : [],
      hazards: opts.events && (opts.mode ?? 'race') === 'race' ? planHazards(track, opts.seed, opts.laps) : [],
      moves: !!opts.moves,
      zones: null,
    };
    this.s = s;
    this.handling = s.handling;

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
      const k = makeKart(track, i, grid[i]!, h.ci, h.slot, { ...HUMAN_AUTOPILOT }, h.tune);
      if (h.name) k.name = h.name;
      s.karts.push(k);
      s.humans.push(k);
      i++;
    }
    for (let a = 0; i < total; a++, i++) {
      const ci = aiChars[a % aiChars.length]!;
      const cfg: AiConfig = {
        skill: D.skill[a % D.skill.length]! * (s.handling.v2 ? D.pace : 1),
        lane: AI_LANES[a % AI_LANES.length]!,
        ph: rng.range(0, 6),
        drifts: !!D.drift[a % D.drift.length],
        corner: s.handling.v2 ? D.cornerV2 : D.corner,
      };
      s.karts.push(makeKart(track, i, grid[i]!, ci, null, cfg));
    }

    const { CX, CZ, RX, RZ, H } = track;
    // D36: a faster game, scaled evenly for every kart so the field and the AI stay balanced
    const m = s.handling.speedMul;
    // D46: the speed stat matters less on these long, fast tracks, so every character stays within 4%
    if (s.handling.v2)
      for (const k of s.karts)
        k.P = {
          ...k.P,
          top: k.P.top - (k.ch.stats.speed - 3) * 0.8 * (1 - s.handling.statSpeed),
          // D65: likewise acceleration (3.2 per accel point) on the short, hairpin-heavy tracks
          acc: k.P.acc - (k.ch.stats.accel - 3) * 3.2 * (1 - s.handling.statAccel),
        };
    if (m !== 1) for (const k of s.karts) k.P = { ...k.P, top: k.P.top * m, acc: k.P.acc * m };

    if (opts.itemsOn) {
      for (const bi of track.boxRows) {
        const sc = track.HW[bi]! / 13;
        // D78: two boxes a row in a race; a brawl's arena keeps four (its fights run on items)
        for (const l of s.handling.boxesPerRow === 2 && s.mode === 'race' ? [-4.5, 4.5] : [-9, -3, 3, 9]) {
          const lat = l * sc;
          s.boxes.push({ x: CX[bi]! + RX[bi]! * lat, z: CZ[bi]! + RZ[bi]! * lat, y: H[bi]!, idx: bi, lat, cool: 0 });
        }
      }
    }
    for (const p of track.pads) {
      const pi = p.idx;
      s.pads.push({ x: CX[pi]! + RX[pi]! * p.lat, z: CZ[pi]! + RZ[pi]! * p.lat, y: H[pi]!, idx: pi });
    }
    // D83: the fun zones (a race only; where the launch ramp comes down follows the game's speed)
    if (opts.zones && s.mode === 'race') s.zones = planZones(track, s.handling.speedMul / DEFAULT_HANDLING.speedMul);
    if (s.mode === 'brawl') this.brawlStart();
    this.updateRanks();
    for (const k of s.karts) k.zPrev = k.idx;
  }

  /**
   * D69: Bumper Brawl start: every kart gets its lives and a spot spread evenly round the arena ring, every other
   * one facing the other way, so the round opens with karts driving at each other.
   */
  private brawlStart(): void {
    const s = this.s,
      T = s.track,
      n = s.karts.length;
    s.karts.forEach((k, i) => {
      k.lives = BRAWL_LIVES;
      const idx = (Math.round((i * T.N) / n) + 4) % T.N,
        lat = (i % 3) - 1;
      k.x = k.px = k.gpx = T.CX[idx]! + T.RX[idx]! * lat * 6;
      k.z = k.pz = k.gpz = T.CZ[idx]! + T.RZ[idx]! * lat * 6;
      k.h = k.ph = wrapA(T.ANG[idx]! + (i % 2 ? Math.PI : 0));
      locate(T, k, true);
      k.py = k.y;
      k.lastIdx = k.idx;
      k.lap = 1;
      k.prog = k.lap * T.N + k.idx + k.frac;
    });
  }

  /** D69: a hit costs a life in a brawl; the last one knocks the kart out of the round. */
  private loseLife(k: Kart): void {
    if (this.s.mode !== 'brawl' || k.out) return;
    k.lives = Math.max(0, k.lives - 1);
    // D80: the last kart standing cannot be knocked out (when the last two go down in the same moment, the second
    // keeps one life and wins, instead of a round with nobody left)
    if (k.lives <= 0 && !this.s.karts.some((c) => c !== k && !c.out)) k.lives = 1;
    this.emit({ type: 'lifelost', kart: k.id, n: k.lives });
    if (k.lives <= 0) {
      const s = this.s;
      k.out = true;
      k.finished = true;
      k.finishTime = s.raceTime;
      k.spin = 0;
      k.boost = 0;
      k.vx = k.vz = k.sp = 0;
      k.item = null;
      k.roll = 0;
      k.drifting = false;
      this.emit({ type: 'ko', kart: k.id, x: k.x, y: k.y, z: k.z });
    }
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
  setInput(
    slot: number,
    inp: {
      steer: number;
      throttle: boolean;
      brake: boolean;
      drift: boolean;
      item?: 'forward' | 'back' | null;
      move?: boolean;
    },
  ): void {
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
    if (inp.move) si.movePending = true;
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
      if (si.movePending) {
        inp.move = true;
        si.movePending = false;
      }
    }
  }

  private emit(e: GameEvent): void {
    this.s.events.push(e);
  }

  updateRanks(): Kart[] {
    if (this.s.mode === 'brawl') {
      // D69: still in the round first (most lives), then the knocked-out karts, the last one out best
      const o = this.s.karts
        .slice()
        .sort(
          (a, b) =>
            Number(a.out) - Number(b.out) ||
            (a.out && b.out ? b.finishTime - a.finishTime : b.lives - a.lives || b.hits - a.hits) ||
            a.id - b.id,
        );
      o.forEach((k, i) => (k.rank = i));
      return o;
    }
    const o = this.s.karts
      .slice()
      .sort(
        (a, b) =>
          Number(b.finished) - Number(a.finished) ||
          (a.finished && b.finished ? a.finishTime - b.finishTime : b.prog - a.prog),
      );
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
    if (k.drifting && k.driftLevel > 0 && this.handling.boosts) {
      // D46: releasing within a moment of reaching a tier earns a little extra
      const perfect = this.handling.driftBonus > 0 && k.driftT - k.driftLevel < 0.2;
      this.giveBoost(k, [0, 0.7, 1.2, 1.9][k.driftLevel]! + (perfect ? this.handling.driftBonus : 0), 'drift');
      if (perfect) this.emit({ type: 'driftperfect', kart: k.id, lvl: k.driftLevel });
    }
    k.drifting = false;
    k.driftT = 0;
    k.driftLevel = 0;
  }

  spinOut(k: Kart, by?: Kart): boolean {
    if (k.spin > 0 || k.invuln > 0 || k.rescue > 0 || k.out) return false;
    if (k.shield > 0) {
      k.shield = 0;
      k.invuln = 0.6;
      this.emit({ type: 'shieldpop', kart: k.id });
      return false;
    }
    k.spin = SPIN_T;
    k.boost = 0;
    k.drifting = false;
    k.driftT = 0;
    k.driftLevel = 0;
    k.vx *= 0.35;
    k.vz *= 0.35;
    this.emit({ type: 'hit', kart: k.id });
    if (by && by !== k && this.s.mode === 'brawl') by.hits++;
    this.loseLife(k);
    return true;
  }

  /** Which way (if any) a kart's step from (ox, oz) to (x, z) crossed gate sample g: 1 forward, -1 back, 0 not. */
  private crossGate(g: number, ox: number, oz: number, x: number, z: number): number {
    const T = this.s.track,
      w = T.WALLD[g]! + 2;
    const ax = T.CX[g]! - T.RX[g]! * w,
      az = T.CZ[g]! - T.RZ[g]! * w;
    const d1x = x - ox,
      d1z = z - oz,
      d2x = T.RX[g]! * 2 * w,
      d2z = T.RZ[g]! * 2 * w;
    const den = d1x * d2z - d1z * d2x;
    if (Math.abs(den) < 1e-9) return 0;
    const t = ((ax - ox) * d2z - (az - oz) * d2x) / den,
      u = ((ax - ox) * d1z - (az - oz) * d1x) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return 0;
    return d1x * T.TX[g]! + d1z * T.TZ[g]! > 0 ? 1 : -1;
  }

  /** A sector was completed; `entered` is the sector the kart is now in (0 after the line). */
  private sectorDone(k: Kart, entered: number): void {
    const s = this.s;
    const t = s.raceTime - k.secStart;
    k.secStart = s.raceTime;
    const n = entered === 0 ? s.track.sectors.length : entered;
    this.emit({ type: 'sector', kart: k.id, n, t });
  }

  /**
   * D65: tyre grip multiplier from the road's shape: the vertical load (a dip's compression presses the tyres down,
   * a crest lightens them) and banking into the corner. 1 with the coaster mechanics off.
   */
  private gripBoost(k: Kart): number {
    if (!this.handling.coaster) return 1;
    const c = this.s.track.CURV[k.idx]!;
    const bank = c === 0 ? 0 : Math.max(0, k.bank * Math.sign(c));
    return k.load * (1 + 1.4 * bank);
  }

  /** D71: tyre grip from the weather, and less again while the tyres are wet from a puddle. */
  private wxGrip(k: Kart): number {
    let g = WEATHER_GRIP[this.s.weather] * (k.wet > 0 ? PUDDLE_GRIP : 1);
    // D73: a squall's soaked stretch
    for (const h of this.s.hazards) if (inSquall(this.s.track, h, k.idx)) g *= SQUALL_GRIP;
    // D74: Luna's Night Eyes
    if (k.eyesT > 0) g *= EYES_GRIP;
    return g;
  }

  /** D74: Luna's Night Eyes sees the first Orb or Disc coming and slips it. */
  private dodged(k: Kart, x: number, y: number, z: number): boolean {
    if (k.eyesT <= 0 || !k.eyesDodge) return false;
    k.eyesDodge = false;
    this.emit({ type: 'dodge', kart: k.id, x, y, z });
    return true;
  }

  /** Is sample i on (or just past) a full-width jump ramp, whose lip launches karts by itself? */
  private onRamp(i: number): boolean {
    const T = this.s.track;
    for (const r of T.ramps) {
      if (r.kind === 'lane') continue;
      if ((i - r.i0 + T.N) % T.N <= ((r.i1 - r.i0 + T.N) % T.N) + 5) return true;
    }
    return false;
  }

  /**
   * Jump ramps (section 11.2, D64 kinds): launch off the lip, fly ballistically, land. Landing straight gives a
   * boost that grows with the time in the air (0.6 s for a hop, up to 1.4 s for big air).
   * D65 roller coaster: a crest that falls away faster than gravity floats the kart off the road too, and in the
   * air the kart's own height is followed, so the road can drop away under it (or rise to meet it).
   */
  private stepAir(k: Kart, dt: number, sp: number): void {
    const T = this.s.track,
      coaster = this.handling.coaster;
    const GRAV = 30;
    if (k.air) {
      k.vy -= GRAV * dt;
      k.airT += dt;
      if (coaster) {
        k.ay += k.vy * dt;
        k.alt = k.ay - k.y;
      } else k.alt += k.vy * dt;
      if (k.alt <= 0) {
        k.air = false;
        k.alt = 0;
        k.vy = 0;
        const slip = Math.abs(wrapA(Math.atan2(k.vx, k.vz) - k.h));
        // D65: a quick float over a crest (under 0.3 s) is a thrill, not a jump: no landing boost
        const straight = slip < 0.22 && k.spin <= 0 && (!coaster || k.airT >= 0.3);
        if (straight && this.handling.boosts) this.giveBoost(k, 0.6 + clamp((k.airT - 0.45) * 1.1, 0, 0.8), 'jump');
        this.emit({ type: 'land', kart: k.id, power: straight ? 1 : 0, t: k.airT });
        k.airT = 0;
      }
    } else {
      if (T.ramps.length && sp > 10) {
        for (const r of T.ramps) {
          const before = (r.i1 - k.lastIdx + T.N) % T.N,
            after = (k.idx - r.i1 + T.N) % T.N;
          if (
            before <= 3 &&
            after >= 1 &&
            after <= 4 &&
            Math.abs(k.lat) <= T.HW[r.i1]! + KERB_W &&
            k.lat >= r.latMin &&
            k.lat <= r.latMax
          ) {
            k.air = true;
            k.alt = r.lift;
            k.ay = k.y + r.lift;
            // D67: a stronger pop off every ramp, for more airtime (was + 1.5)
            k.vy = sp * r.pop + 2;
            k.airT = 0;
            this.emit({ type: 'jump', kart: k.id, lvl: r.kind === 'launch' || r.kind === 'table' ? 2 : 1 });
            break;
          }
        }
      }
      if (coaster && !k.air) {
        // the vertical acceleration the road asks for at this speed: past gravity over a crest, the kart floats
        const acc = T.VC[k.idx]! * sp * sp;
        // lighter over a rim or crest (at most 15% less grip, so a dip exit into a corner stays controllable),
        // heavier in a compression
        k.load = clamp(1 + acc / GRAV, 0.85, 1.5);
        if (acc < -GRAV && sp > 15 && k.spin <= 0 && !k.inSc && T.airZone[k.idx] && !this.onRamp(k.idx)) {
          k.air = true;
          k.alt = 0;
          k.ay = k.y;
          // a floater, not a launch: capped so a boosted kart over a crest still lands on the road beyond it
          k.vy = Math.min(T.SL[k.idx]! * sp, 3.5);
          k.airT = 0;
          k.load = 1;
          this.emit({ type: 'float', kart: k.id });
        }
      }
    }
    if (k.alt > 0) k.y += k.alt;
  }

  private startRescue(k: Kart): void {
    if (k.rescue > 0) return;
    k.rescue = RESCUE_T;
    k.air = false;
    k.alt = 0;
    k.vy = 0;
    k.airT = 0;
    k.load = 1;
    k.offT = 0;
    k.inSc = false;
    k.drifting = false;
    k.driftT = 0;
    k.driftLevel = 0;
    k.boost = 0;
    k.spin = 0;
    k.stuckT = 0;
    k.wrongT = 0;
    k.lostT = 0;
    // a slipstream charge does not survive the drone: it fired a slingshot from a standstill on the drop
    k.draft = 0;
    k.drafting = false;
    k.vx = 0;
    k.vz = 0;
    k.sp = 0;
    this.emit({ type: 'rescue', kart: k.id });
  }

  private stepRescue(k: Kart, dt: number): void {
    const T = this.s.track;
    const before = k.rescue;
    k.rescue -= dt;
    k.vx = 0;
    k.vz = 0;
    k.sp = 0;
    if (before > RESCUE_T / 2 && k.rescue <= RESCUE_T / 2) {
      const i = k.idx;
      k.x = T.CX[i]!;
      k.z = T.CZ[i]!;
      k.h = T.ANG[i]!;
      locate(T, k, false);
      k.px = k.x;
      k.pz = k.z;
      k.py = k.y;
      k.ph = k.h;
      k.lastIdx = k.idx;
      k.prog = k.lap * T.N + k.idx + k.frac;
      k.gpx = k.x;
      k.gpz = k.z;
      // a rescue is a legitimate recovery: count the gates behind the drop point (never fewer than before)
      if (T.gates.length) {
        let g = 0;
        while (g < T.gates.length && T.gates[g]! <= k.idx) g++;
        if (k.gate < T.gates.length && g > k.gate && k.idx < T.N * 0.75) k.gate = g;
      }
    }
    if (k.rescue <= 0) {
      k.rescue = 0;
      k.invuln = 1.5;
      k.vx = Math.sin(k.h) * 10;
      k.vz = Math.cos(k.h) * 10;
      k.sp = 10;
    }
  }

  /**
   * D71 rain: driving into a puddle wets the tyres for a moment (less grip) and twitches the kart sideways a little,
   * more at speed. The twitch side is fixed per kart and puddle, so a race replays exactly.
   */
  private puddle(k: Kart, dt: number): void {
    if (k.wet > 0) k.wet -= dt;
    if (k.air) return;
    const T = this.s.track,
      N = T.N;
    let hit = -1;
    this.s.puddles.forEach((p, j) => {
      let di = (k.idx - p.i) % N;
      if (di > N / 2) di -= N;
      if (di < -N / 2) di += N;
      const a = (di + k.frac) * T.DS,
        l = k.lat - p.lat;
      if (a * a + l * l < p.r * p.r) hit = j;
    });
    if (hit >= 0 && hit !== k.inPud && Math.abs(k.sp) > 12) {
      k.wet = PUDDLE_WET;
      const side = (k.id * 7 + hit * 3) % 2 ? 1 : -1,
        tw = side * Math.min(1.8, Math.abs(k.sp) * 0.045);
      k.vx += T.RX[k.idx]! * tw;
      k.vz += T.RZ[k.idx]! * tw;
      this.emit({ type: 'splash', kart: k.id, x: k.x, y: k.y, z: k.z });
    }
    k.inPud = hit;
  }

  /** Is this kart driven by the AI right now? AI karts, disconnected humans and finished humans. */
  static autoDriven(k: Kart): boolean {
    return k.ai || k.finished;
  }

  private stepKart(k: Kart, dt: number): void {
    const s = this.s,
      T = s.track;
    const { N, TX, TZ, RX, RZ, ANG } = T;
    const racing = s.phase === 'race' || s.phase === 'finished';
    if (k.rescue > 0) {
      this.stepRescue(k, dt);
      return;
    }
    let inp: Readonly<KartInput> = racing ? k.input : NEUTRAL;
    if (k.spin > 0) {
      k.spin -= dt;
      if (k.spin <= 0) {
        k.spin = 0;
        k.invuln = 2;
      }
      inp = NEUTRAL;
    }
    if (k.invuln > 0) k.invuln -= dt;
    if (k.boost > 0) {
      k.boost -= dt;
      if (k.boost < 0) k.boost = 0;
    }
    if (k.hop > 0) k.hop -= dt;
    if (k.padCool > 0) k.padCool -= dt;
    if (k.threat > 0) k.threat = Math.max(0, k.threat - dt);
    if (k.shield > 0) k.shield -= dt;
    if (k.stall > 0) k.stall -= dt;
    const P = k.P,
      // D65: BRAKE always wins over the (automatic) throttle, so a boosted kart can still slow for a corner
      thr = inp.throttle && k.stall <= 0 && !(this.handling.coaster && inp.brake);

    const Hd = this.handling;
    // D65: a little expo on human steering, so small corrections on the phone are gentle and full lock is unchanged
    const want =
      Hd.steerExpo > 0 && !Game.autoDriven(k)
        ? inp.steer * (1 - Hd.steerExpo + Hd.steerExpo * Math.abs(inp.steer))
        : inp.steer;
    const dS = want - k.steerS,
      mr = 7 * dt;
    k.steerS += Math.abs(dS) < mr ? dS : Math.sign(dS) * mr;
    const steer = k.steerS;

    let fx = Math.sin(k.h),
      fz = Math.cos(k.h),
      rx = -fz,
      rz = fx;
    let sp = k.vx * fx + k.vz * fz,
      lat = k.vx * rx + k.vz * rz;
    if (k.kick) {
      sp += k.kick;
      k.kick = 0;
    }
    const S = SURF[k.surf],
      off = S.off,
      air = k.air;
    const m = this.handling.speedMul;
    const top =
      k.boost > 0
        ? off
          ? 32 * m
          : BOOSTSP * m
        : off
          ? (S.cap ?? 15) * m
          : P.top * k.rbMul + (k.drafting ? Hd.draftTop : 0);

    if (air) {
      // airborne: no drive, no brakes; the kart carries its speed until it lands
    } else if (thr) {
      if (sp < top)
        sp = Math.min(
          top,
          sp +
            (k.boost > 0
              ? 70 * m
              : Math.max(
                  5,
                  (P.acc * (k.overT > 0 ? OVERCLOCK_ACC : 1) + (k.drafting ? Hd.draftAcc : 0)) *
                    (1 - Math.max(0, sp) / top),
                )) *
              dt,
        );
    } else if (k.spin <= 0) {
      const d = 7 * dt;
      sp = Math.abs(sp) <= d ? 0 : sp - Math.sign(sp) * d;
    }
    if (inp.brake && !air) sp = sp > 0 ? Math.max(0, sp - 48 * dt) : Math.max(-10, sp - 16 * dt);
    if (racing && !air) sp -= k.slope * Hd.slopeG * dt;
    if (sp > top && !air) sp -= (sp - top) * Math.min(1, 2.2 * dt);
    if (off && !air) sp *= Math.exp(-S.drag * dt);
    if (k.spin > 0) {
      sp *= Math.exp(-2.5 * dt);
      lat *= Math.exp(-2.5 * dt);
    }

    if (!k.drifting && inp.drift && Math.abs(steer) > 0.3 && sp > 17 && k.spin <= 0 && !air) {
      k.drifting = true;
      k.driftDir = steer > 0 ? 1 : -1;
      k.driftT = 0;
      k.driftLevel = 0;
      k.hop = this.handling.driftHop;
      if (this.handling.driftKick) lat -= k.driftDir * this.handling.driftKick;
      this.emit({ type: 'driftstart', kart: k.id });
    }
    let turn = steer;
    if (k.drifting) {
      if (!inp.drift || sp < 11 || k.spin > 0) this.endDrift(k);
      else {
        turn = k.driftDir * (0.7 + 0.55 * steer * k.driftDir);
        k.driftT += dt * P.driftRate * (0.8 + 0.5 * Math.max(0, steer * k.driftDir));
        const lv = k.driftT >= 3 ? 3 : k.driftT >= 2 ? 2 : k.driftT >= 1 ? 1 : 0;
        if (lv > k.driftLevel) {
          k.driftLevel = lv;
          this.emit({ type: 'driftlevel', kart: k.id, lvl: lv });
        }
      }
    }

    const spAbs = Math.abs(sp),
      sf = Math.min(1, spAbs / 7);
    let rate = this.handling.turnRate * sf * (1 - this.handling.turnFalloff * Math.min(1, spAbs / 40)) * P.turn;
    if (k.drifting) rate *= 1.3;
    // D65: never turn in harder than the tyres hold (a drift may ask a third more, it is meant to slide); the
    // handling stat counts by its square root here, or the best-handling kart outcornered the rest by 17%
    if (Hd.yawGrip > 0 && spAbs > 1)
      rate = Math.min(
        rate,
        (Hd.yawGrip * Math.sqrt(P.turn) * (k.drifting ? 1.35 : 1) * this.gripBoost(k) * this.wxGrip(k)) / spAbs,
      );
    if (k.spin > 0) rate = 0;
    if (air) rate *= 0.25;
    const vx = fx * sp + rx * lat,
      vz = fz * sp + rz * lat;
    k.h = wrapA(k.h - turn * rate * (sp >= 0 ? 1 : -1) * dt);
    fx = Math.sin(k.h);
    fz = Math.cos(k.h);
    rx = -fz;
    rz = fx;
    // D65 air steering: in the air the velocity turns with the car (an arcade jump), so steering mid-air lines the
    // car up for the landing instead of setting up a slide
    if (!(air && Hd.coaster)) {
      sp = vx * fx + vz * fz;
      lat = vx * rx + vz * rz;
    }
    {
      // sideways grip turns the slide back into forward motion instead of bleeding speed away
      const H = this.handling;
      // ice limits drift grip too; in the air there is no grip at all
      const wg = this.wxGrip(k);
      const grip = (k.drifting ? (S.slick ? Math.min(H.driftLatGrip, S.grip) : H.driftLatGrip) : S.grip) * wg;
      let newLat = air ? lat : lat * Math.exp(-grip * dt);
      if (H.v2 && !air && !k.drifting) {
        // D46 tyre model: grip follows the slip angle, rising to a peak and then falling off softly, so a big
        // slide saturates and recovers predictably instead of snapping straight
        const alpha = Math.atan2(Math.abs(lat), Math.max(1, Math.abs(sp)));
        const f = alpha < 0.12 ? 1 : H.tyreFall + (1 - H.tyreFall) * Math.exp(-(alpha - 0.12) / 0.35);
        const maxDrop = H.tyrePeak * f * (S.grip / 9) * this.gripBoost(k) * wg * dt;
        const drop = Math.abs(lat - newLat);
        if (drop > maxDrop) newLat = lat - Math.sign(lat) * maxDrop;
      }
      const v2 = (sp * sp + lat * lat) * Math.exp(-(k.drifting ? H.driftDrag : 0.1) * dt);
      sp = (sp >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, v2 - newLat * newLat));
      lat = newLat;
    }
    k.vx = fx * sp + rx * lat;
    k.vz = fz * sp + rz * lat;
    k.sp = sp;
    k.x += k.vx * dt;
    k.z += k.vz * dt;

    // inside a shortcut corridor the nearest road sample can jump, so search the whole track
    locate(T, k, k.inSc);
    k.wall = false;
    const sc = T.shortcuts.length ? shortcutAt(T, k.x, k.z, 4) : null;
    const inCorr = !!sc && sc.d <= sc.sc.half;
    const wl = T.WALLD[k.idx]!;
    if (sc && k.inSc && !inCorr && Math.abs(k.lat) > wl) {
      // the corridor's edges are walls
      const nx = (k.x - sc.cx) / (sc.d || 1),
        nz = (k.z - sc.cz) / (sc.d || 1);
      k.x = sc.cx + nx * sc.sc.half;
      k.z = sc.cz + nz * sc.sc.half;
      const vo = k.vx * nx + k.vz * nz;
      if (vo > 0) {
        k.vx -= nx * vo * 1.25;
        k.vz -= nz * vo * 1.25;
        if (vo > 9) this.emit({ type: 'bump', kart: k.id, power: vo / (Math.hypot(k.vx, k.vz) + 1e-6) });
      }
      k.wall = true;
      locate(T, k, true);
    } else if (Math.abs(k.lat) > wl && !inCorr) {
      // walls: slide along with friction that depends on the impact angle
      const sgn = k.lat > 0 ? 1 : -1,
        over = Math.abs(k.lat) - wl,
        i = k.idx;
      k.x -= RX[i]! * sgn * over;
      k.z -= RZ[i]! * sgn * over;
      const vo = (k.vx * RX[i]! + k.vz * RZ[i]!) * sgn;
      if (vo > 0) {
        const vmag = Math.hypot(k.vx, k.vz) + 1e-6,
          impact = vo / vmag;
        k.vx -= RX[i]! * sgn * vo * 1.25;
        k.vz -= RZ[i]! * sgn * vo * 1.25;
        // friction along the wall scales with how hard the kart hits it
        const vt = k.vx * TX[i]! + k.vz * TZ[i]!,
          fr = Math.min(Math.abs(vt), vo * 0.5) * Math.sign(vt);
        k.vx -= fr * TX[i]!;
        k.vz -= fr * TZ[i]!;
        if (vo > 9) this.emit({ type: 'bump', kart: k.id, power: impact });
      }
      // nosing into the wall: steer the kart to slide along it instead of pinning
      const into = (Math.sin(k.h) * RX[i]! + Math.cos(k.h) * RZ[i]!) * sgn;
      if (into > 0.05) {
        const fdir = Math.sin(k.h) * TX[i]! + Math.cos(k.h) * TZ[i]! >= 0 ? 1 : -1;
        const tgt = Math.atan2(TX[i]! * fdir, TZ[i]! * fdir);
        k.h = wrapA(k.h + clamp(wrapA(tgt - k.h), -2.4 * dt, 2.4 * dt));
      }
      k.wall = true;
      k.lat = sgn * wl;
    }
    k.inSc = inCorr && Math.abs(k.lat) > T.HW[k.idx]! + KERB_W;
    k.surf = k.inSc ? sc!.sc.surface : surfaceAt(T, k.idx, k.lat);
    k.offroad = SURF[k.surf].off;
    k.bank = T.BT[k.idx]!;
    if (s.puddles.length) this.puddle(k, dt);
    this.stepAir(k, dt, sp);

    const G = s.mode === 'brawl' ? [] : T.gates;
    if (G.length) {
      // ordered checkpoint gates (section 12.4): a lap counts only after passing every gate in order
      if (k.gate < G.length && this.crossGate(G[k.gate]!, k.gpx, k.gpz, k.x, k.z) === 1) {
        k.gate++;
        const sn = T.sectors.indexOf(G[k.gate - 1]!);
        if (sn > 0) this.sectorDone(k, sn);
      } else if (k.gate > 0 && this.crossGate(G[k.gate - 1]!, k.gpx, k.gpz, k.x, k.z) === -1) k.gate--;
      k.gpx = k.x;
      k.gpz = k.z;
    }
    const lineFwd = k.lastIdx > N * 0.75 && k.idx < N * 0.25;
    if (lineFwd && G.length && k.gate < G.length) {
      this.emit({ type: 'missedgate', kart: k.id });
    } else if (lineFwd && s.mode === 'brawl') {
      k.lap++; // D69: an arena has no laps; the count only keeps prog continuous round the ring
    } else if (lineFwd) {
      if (G.length) {
        k.gate = 0;
        if (k.lap >= 1) this.sectorDone(k, 0);
        else k.secStart = s.raceTime;
      }
      k.lap++;
      if (k.lap >= 2) {
        const lt = s.raceTime - k.lapStart;
        k.lapTimes.push(lt);
        if (!k.bestLap || lt < k.bestLap) k.bestLap = lt;
      }
      k.lapStart = s.raceTime;
      this.emit({ type: 'lap', kart: k.id });
      if (k.lap > s.laps && !k.finished) {
        k.finished = true;
        k.finishTime = s.raceTime;
        this.emit({ type: 'finish', kart: k.id });
      }
    } else if (k.lastIdx < N * 0.25 && k.idx > N * 0.75) {
      k.lap--;
      if (G.length) k.gate = G.length;
    }
    k.lastIdx = k.idx;
    k.prog = k.lap * N + k.idx + k.frac;

    if (racing) {
      const fd = fx * TX[k.idx]! + fz * TZ[k.idx]!;
      if (s.mode === 'brawl')
        k.wrongT = 0; // D69: either way round the arena is fine
      else if (fd < -0.25 && Math.abs(sp) > 2) k.wrongT += dt;
      else k.wrongT = Math.max(0, k.wrongT - dt * 2);
      // wants to go (throttle held, not stalled) but cannot move; D65: braking does not hide it
      if (inp.throttle && k.stall <= 0 && k.spin <= 0 && Math.abs(sp) < 3) k.stuckT += dt;
      else k.stuckT = Math.max(0, k.stuckT - dt);
      // an AI on a shortcut points away from the road it skips: that is not being lost
      const bot = Game.autoDriven(k) && k.aiSc < 0 && !k.inSc;
      if (bot && s.mode !== 'brawl' && k.spin <= 0 && Math.abs(wrapA(k.h - ANG[k.idx]!)) > 1.4) k.lostT += dt;
      else k.lostT = 0;
      // off the track for 4 s (not in a shortcut) also calls the drone; the prototype track keeps its own rules
      // D69: in an arena the run-off is part of the battlefield, so only a stuck kart calls the drone
      if (T.id !== 'proto' && s.mode !== 'brawl') {
        if (k.offroad && !k.inSc && !k.air) k.offT += dt;
        else k.offT = 0;
      }
      if (k.stuckT > 2.5 || k.offT > 4 || (bot && (k.wrongT > 2.5 || k.lostT > 3))) this.startRescue(k);
    }

    if (inp.item && k.item && k.spin <= 0 && k.roll <= 0 && k.rescue <= 0) this.useItem(k, inp.itemBack);
    k.input.item = false;
  }

  private useItem(k: Kart, back: boolean): void {
    const s = this.s,
      T = s.track;
    const it = k.item;
    const fx = Math.sin(k.h),
      fz = Math.cos(k.h);
    if (it === 'turbo3') {
      this.giveBoost(k, 1.0, 'item');
      k.itemUses--;
      if (k.itemUses <= 0) k.item = null;
      this.emit({ type: 'useturbo', kart: k.id });
      return;
    }
    k.item = null;
    if (it === 'turbo') {
      this.giveBoost(k, 1.6, 'item');
      this.emit({ type: 'useturbo', kart: k.id });
    } else if (it === 'oil') {
      const sl: Slick = {
        x: k.x - fx * 4.5,
        z: k.z - fz * 4.5,
        age: 0,
        owner: k,
        r: 3.2,
        idx: k.idx,
        lat: 0,
        frac: 0,
        y: k.y,
      };
      locate(T, sl, false);
      s.slicks.push(sl);
      this.emit({ type: 'useoil', kart: k.id });
    } else if (it === 'orb') {
      // orbs run along the road; in a brawl karts drive either way, so "forward" is the way this kart faces
      const facing = s.mode === 'brawl' && fx * T.TX[k.idx]! + fz * T.TZ[k.idx]! < 0 ? -1 : 1;
      const dir = (back ? -1 : 1) * facing;
      s.orbs.push({
        prog: k.prog + dir * 1.2,
        lat: k.lat,
        dir,
        owner: k,
        age: 0,
        x: k.x,
        z: k.z,
        y: k.y,
        target: null,
      });
      this.emit({ type: 'useorb', kart: k.id });
    } else if (it === 'bolt') {
      const dir = back ? -1 : 1,
        spd = 74;
      const b: Bolt = {
        x: k.x + fx * 3.2 * dir,
        z: k.z + fz * 3.2 * dir,
        vx: fx * spd * dir + (dir > 0 ? k.vx * 0.3 : 0),
        vz: fz * spd * dir + (dir > 0 ? k.vz * 0.3 : 0),
        idx: k.idx,
        lat: 0,
        frac: 0,
        y: k.y,
        bounces: 0,
        age: 0,
        owner: k,
      };
      locate(T, b, false);
      s.bolts.push(b);
      this.emit({ type: 'usebolt', kart: k.id });
    } else if (it === 'shield') {
      k.shield = 10;
      this.emit({ type: 'useshield', kart: k.id });
    } else if (it === 'rocket') {
      // a long boost that also ploughs through hazards
      this.giveBoost(k, MAX_BOOST, 'item');
      k.boostTier = 3;
      k.invuln = Math.max(k.invuln, MAX_BOOST);
      this.emit({ type: 'userocket', kart: k.id });
    } else if (it === 'comet') {
      let tgt: Kart | null = null;
      for (const c of s.karts) if (c !== k && !c.finished && c.rescue <= 0 && (!tgt || c.rank < tgt.rank)) tgt = c;
      if (tgt) {
        const T0 = 2.4;
        s.comets.push({
          owner: k,
          target: tgt,
          t: T0,
          t0: T0,
          sx: k.x,
          sy: k.y + 30,
          sz: k.z,
          x: k.x,
          y: k.y + 30,
          z: k.z,
        });
        this.threaten(tgt, T0);
        this.emit({ type: 'usecomet', kart: k.id, other: tgt.id });
      }
    }
  }

  /**
   * D65 item guard: a kart holding an Oil Slick, Homing Orb or Bounce Disc (not using it) trails it behind, and it
   * soaks up one Orb or Disc that hits from behind or the side. Holding an item is a choice: defence or attack.
   */
  private guarded(c: Kart, px: number, pz: number): boolean {
    if (!this.handling.itemGuard || c.roll > 0 || c.shield > 0) return false;
    if (c.item !== 'oil' && c.item !== 'orb' && c.item !== 'bolt') return false;
    const ahead = (px - c.x) * Math.sin(c.h) + (pz - c.z) * Math.cos(c.h);
    if (ahead > 1.2) return false;
    c.item = null;
    c.invuln = Math.max(c.invuln, 0.5);
    this.emit({ type: 'guard', kart: c.id, x: px, z: pz, y: c.y });
    return true;
  }

  /** Start (or extend) an incoming-projectile warning; the first moment emits a 'warn' event for the phone and HUD. */
  private threaten(k: Kart, t: number): void {
    if (k.threat <= 0) this.emit({ type: 'warn', kart: k.id });
    k.threat = Math.max(k.threat, t);
  }

  /** Seeker Comets arc over the field and strike the leader; a boost dodges, a shield blocks (D8). */
  private stepComets(dt: number): void {
    const s = this.s;
    for (let n = s.comets.length - 1; n >= 0; n--) {
      const c = s.comets[n]!,
        g = c.target;
      c.t -= dt;
      const u = 1 - Math.max(0, c.t) / c.t0,
        e = u * u * (3 - 2 * u);
      c.x = c.sx + (g.x - c.sx) * e;
      c.z = c.sz + (g.z - c.sz) * e;
      c.y = c.sy + (g.y + 1 - c.sy) * e + Math.sin(u * Math.PI) * 40;
      if (g.finished || g.rescue > 0) {
        s.comets.splice(n, 1);
        continue;
      }
      g.threat = Math.max(g.threat, 0.1);
      if (c.t > 0) continue;
      s.comets.splice(n, 1);
      if (g.decoy) {
        // D74: the comet strikes the Mirage decoy instead
        this.emit({ type: 'decoypop', kart: g.id, x: g.decoy.x, y: g.decoy.y, z: g.decoy.z });
        g.decoy = null;
      } else if (g.boost > 0) this.emit({ type: 'cometmiss', kart: g.id, x: g.x, y: g.y, z: g.z });
      else {
        const hit = this.spinOut(g);
        if (hit) {
          g.vx *= 0.4;
          g.vz *= 0.4;
        }
        this.emit({ type: hit ? 'comethit' : 'cometmiss', kart: g.id, x: g.x, y: g.y, z: g.z });
      }
    }
  }

  private stepOrbs(dt: number): void {
    const s = this.s,
      T = s.track;
    for (let n = s.orbs.length - 1; n >= 0; n--) {
      const o = s.orbs[n]!;
      o.age += dt;
      let tgt: Kart | null = null,
        bd = 1e9;
      for (const c of s.karts) {
        if (c === o.owner || c.finished || c.rescue > 0) continue;
        const d = (c.prog - o.prog) * o.dir;
        if (d > -0.5 && d < T.N * 0.45 && d < bd) {
          bd = d;
          tgt = c;
        }
      }
      o.target = tgt;
      // warn the target once the orb is close behind it (section 12.3 fairness)
      if (tgt && this.handling.v2 && (tgt.prog - o.prog) * o.dir * T.DS < 70) this.threaten(tgt, 0.25);
      o.prog += (o.dir * 80 * dt) / T.DS;
      // D74: Mochi's Mirage: an orb after her goes for her decoy while it is still ahead of the orb
      const dc = decoyOf(tgt);
      const toDecoy = dc && (((dc.idx - o.prog) % T.N) + T.N) % T.N < T.N / 2 ? dc : null;
      if (toDecoy) o.lat += (toDecoy.lat - o.lat) * Math.min(1, 5 * dt);
      else if (tgt) o.lat += (tgt.lat - o.lat) * Math.min(1, 5 * dt);
      posOnTrack(T, o.prog, o.lat, o);
      let dead = o.age > 7;
      if (toDecoy && tgt && Math.hypot(toDecoy.x - o.x, toDecoy.z - o.z) < 3.4) {
        dead = true;
        tgt.decoy = null;
        this.emit({ type: 'decoypop', kart: tgt.id, x: o.x, y: o.y, z: o.z });
      }
      for (const c of s.karts) {
        if (dead) break;
        if (c === o.owner && o.age < 1) continue;
        if (c.invuln > 0 || c.spin > 0 || c.rescue > 0 || c.out) continue;
        const dx = c.x - o.x,
          dz = c.z - o.z;
        if (dx * dx + dz * dz < 3.4 * 3.4) {
          dead = true;
          if (this.guarded(c, o.x, o.z) || this.dodged(c, o.x, o.y, o.z)) continue;
          if (this.spinOut(c, o.owner)) this.emit({ type: 'orbhit', kart: c.id, x: o.x, z: o.z, y: o.y });
          else this.emit({ type: 'orbpop', kart: -1, x: o.x, z: o.z, y: o.y });
        }
      }
      if (dead) s.orbs.splice(n, 1);
    }
  }

  private stepBolts(dt: number): void {
    const s = this.s,
      T = s.track;
    for (let n = s.bolts.length - 1; n >= 0; n--) {
      const b = s.bolts[n]!;
      b.age += dt;
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      locate(T, b, false);
      const LIM = T.WALLD[b.idx]! + 0.8;
      if (Math.abs(b.lat) > LIM) {
        const sgn = b.lat > 0 ? 1 : -1,
          i = b.idx,
          vl = b.vx * T.RX[i]! + b.vz * T.RZ[i]!;
        b.vx -= 2 * vl * T.RX[i]!;
        b.vz -= 2 * vl * T.RZ[i]!;
        const over = Math.abs(b.lat) - LIM;
        b.x -= T.RX[i]! * sgn * over;
        b.z -= T.RZ[i]! * sgn * over;
        b.bounces++;
        this.emit({ type: 'boltbounce', kart: -1, x: b.x, z: b.z, y: b.y });
      }
      let dead = b.bounces > 3 || b.age > 5;
      // D74: a Disc runs into a Mirage decoy and is spent on it
      for (const c of s.karts) {
        if (dead || !c.decoy || c === b.owner) continue;
        if (Math.hypot(c.decoy.x - b.x, c.decoy.z - b.z) < 2.7) {
          dead = true;
          c.decoy = null;
          this.emit({ type: 'decoypop', kart: c.id, x: b.x, y: b.y, z: b.z });
        }
      }
      for (const c of s.karts) {
        if (dead) break;
        if (c === b.owner && b.age < 0.35) continue;
        if (c.invuln > 0 || c.spin > 0 || c.rescue > 0 || c.out) continue;
        const dx = c.x - b.x,
          dz = c.z - b.z;
        if (dx * dx + dz * dz < 2.7 * 2.7) {
          dead = true;
          if (this.guarded(c, b.x, b.z) || this.dodged(c, b.x, b.y, b.z)) continue;
          if (this.spinOut(c, b.owner)) this.emit({ type: 'bolthit', kart: c.id, x: b.x, z: b.z, y: b.y });
        }
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
        // D74: Pip's Belly Slide slides over oil; a kart high in the air (Gus's Hop) passes over it
        if (c.slideT > 0 || (c.air && c.alt > 0.5)) continue;
        const dx = c.x - sl.x,
          dz = c.z - sl.z;
        if (dx * dx + dz * dz < sl.r * sl.r && this.spinOut(c, sl.owner)) dead = true;
      }
      if (dead) s.slicks.splice(n, 1);
    }
  }

  /** A race item from the boxes' pool, by the kart's place. */
  private rollItem(k: Kart): ItemId {
    const s = this.s,
      H = this.handling;
    return chooseItem(
      k.rank,
      s.rng,
      H.v2 ? { total: s.karts.length, lap: k.lap, cometActive: s.comets.length > 0, boosts: H.boosts } : undefined,
    );
  }

  /** D83: a fun zone's free item, as if from a box. */
  private zoneItem(k: Kart): void {
    k.roll = this.handling.itemRoll;
    k.pending = this.rollItem(k);
    if (k.roll <= 0) this.grantItem(k);
  }

  /** The item roulette is done: the kart holds its item. */
  private grantItem(k: Kart): void {
    const s = this.s;
    k.roll = 0;
    k.item = k.pending;
    k.pending = null;
    k.itemUses = k.item === 'turbo3' ? 3 : 1;
    k.itemWait = s.rng.range(1.5, 4) / (k.slot !== null ? 1 : DIFF[s.diff].items);
    this.emit({ type: 'item', kart: k.id });
  }

  private rocketStart(k: Kart, t: number): void {
    // D76: no rocket start (and no early-press stall either) without the boosts
    if (!this.handling.boosts) return;
    this.giveBoost(k, t, 'start');
    k.kick += 8;
    k.startDone = true;
    this.emit({ type: 'perfect', kart: k.id });
  }

  private stepWorld(dt: number): void {
    const s = this.s;
    s.time += dt;
    for (const k of s.karts) {
      k.px = k.x;
      k.pz = k.z;
      k.py = k.y;
      k.ph = k.h;
    }
    if (s.phase === 'grid') return;
    if (s.phase === 'countdown') {
      s.cd -= dt;
      for (const k of s.humans) {
        const d = k.input.drift;
        if (d && !k.prevDrift && k.startPress === null) k.startPress = Math.max(0, s.cd);
        k.prevDrift = d;
      }
      const c = Math.ceil(s.cd);
      if (c !== s.lastCd && c >= 1 && c <= 3) {
        s.lastCd = c;
        this.emit({ type: 'cd', kart: -1, n: c });
      }
      if (s.cd <= 0) {
        s.phase = 'race';
        s.raceTime = 0;
        this.emit({ type: 'go', kart: -1 });
        const D = DIFF[s.diff];
        for (const k of s.karts) {
          if (k.slot !== null && !Game.autoDriven(k)) {
            const sp = k.startPress;
            if (sp !== null) {
              k.startDone = true;
              if (sp <= 0.35) this.rocketStart(k, 1.3);
              else if (sp > 0.9 && this.handling.boosts) {
                k.stall = 0.7;
                this.emit({ type: 'stall', kart: k.id });
              }
            }
          } else if (s.rng.next() < D.start) this.rocketStart(k, 1.2);
        }
      }
      return;
    }
    s.raceTime += dt;
    // late rocket start: DRIFT pressed within 0.25 s after GO
    for (const P of s.humans) {
      if (!P.startDone && P.startPress === null && s.raceTime < 0.25 && P.input.drift && !P.prevDrift)
        this.rocketStart(P, 1.1);
      if (s.raceTime >= 0.25) P.startDone = true;
      P.prevDrift = P.input.drift;
    }

    const brawl = s.mode === 'brawl';
    for (const k of s.karts) {
      if (k.out) continue;
      if (Game.autoDriven(k)) (brawl ? brawlAiInput : aiInput)(s, k, dt);
      this.stepKart(k, dt);
    }
    // D73: the track's living event
    stepHazards(s, dt, { emit: (e) => this.emit(e), spinOut: (k) => this.spinOut(k) });
    // D83: the fun zones
    if (s.zones) stepZones(s, dt, { emit: (e) => this.emit(e), giveItem: (k) => this.zoneItem(k) });
    // D74: signature moves
    if (s.moves) stepMoves(s, dt, { emit: (e) => this.emit(e), giveBoost: (k, t) => this.giveBoost(k, t, 'move') });
    const karts = s.karts;
    for (let i = 0; i < karts.length; i++)
      for (let j = i + 1; j < karts.length; j++) {
        const a = karts[i]!,
          b = karts[j]!;
        if (a.rescue > 0 || b.rescue > 0 || a.out || b.out || Math.abs(a.y - b.y) > 1.6) continue;
        let dx = a.x - b.x,
          dz = a.z - b.z;
        let d2 = dx * dx + dz * dz;
        const R = KART_R * 2;
        if (this.handling.v2 && d2 < 64) {
          // D46: the race car is long; collide its front and rear circles instead of one centre circle
          const fa = [Math.sin(a.h) * CAR_HALF, Math.cos(a.h) * CAR_HALF],
            fb = [Math.sin(b.h) * CAR_HALF, Math.cos(b.h) * CAR_HALF];
          let best = 1e9;
          for (const sa of [-1, 1])
            for (const sb of [-1, 1]) {
              const ex = a.x + fa[0]! * sa - (b.x + fb[0]! * sb),
                ez = a.z + fa[1]! * sa - (b.z + fb[1]! * sb),
                e2 = ex * ex + ez * ez;
              if (e2 < best) {
                best = e2;
                dx = ex;
                dz = ez;
              }
            }
          d2 = best;
        }
        if (d2 < R * R) {
          const d = Math.sqrt(d2) || 0.001;
          dx /= d;
          dz /= d;
          const ma = a.P.mass,
            mb = b.P.mass,
            tot = ma + mb,
            pen = R - d;
          a.x += (dx * pen * mb) / tot;
          a.z += (dz * pen * mb) / tot;
          b.x -= (dx * pen * ma) / tot;
          b.z -= (dz * pen * ma) / tot;
          const rv = (a.vx - b.vx) * dx + (a.vz - b.vz) * dz;
          if (rv < 0) {
            const jimp = (-this.handling.bumpRest * rv) / (1 / ma + 1 / mb);
            a.vx += (dx * jimp) / ma;
            a.vz += (dz * jimp) / ma;
            b.vx -= (dx * jimp) / mb;
            b.vz -= (dz * jimp) / mb;
            if (-rv > 6) this.emit({ type: 'bump', kart: a.id, other: b.id, power: Math.min(1, -rv / 20) });
            // D69 brawl: a boosting kart that rams one that is not knocks off a life and takes it
            if (brawl && -rv > 7) {
              if (a.boost > 0 && b.boost <= 0) this.ram(a, b);
              else if (b.boost > 0 && a.boost <= 0) this.ram(b, a);
            }
          }
        }
      }
    const H = this.handling;
    for (const k of karts) {
      if (k.out) continue;
      if (k.roll > 0) {
        k.roll -= dt;
        if (k.roll <= 0) this.grantItem(k);
      }
      if (k.rescue > 0) continue;
      for (let bi = 0; bi < s.boxes.length; bi++) {
        const b = s.boxes[bi]!;
        if (b.cool > 0 || k.item || k.roll > 0 || k.finished) continue;
        const dx = k.x - b.x,
          dz = k.z - b.z;
        if (dx * dx + dz * dz < 3.8 * 3.8) {
          // D69: arena boxes come back faster, and only hold fighting items
          b.cool = brawl ? 2.5 : 4;
          k.roll = H.itemRoll;
          k.pending = brawl ? brawlItem(s.rng, H.boosts) : this.rollItem(k);
          this.emit({ type: 'pickup', kart: k.id, box: bi });
          // D65: no roulette, the item is ready the moment the box is hit
          if (k.roll <= 0) this.grantItem(k);
        }
      }
      for (const p of s.pads) {
        if (k.padCool > 0) continue;
        const dx = k.x - p.x,
          dz = k.z - p.z;
        if (dx * dx + dz * dz < 5.5 * 5.5) {
          this.giveBoost(k, 1.1, 'pad');
          k.padCool = 1.5;
          this.emit({ type: 'pad', kart: k.id });
        }
      }
      // slipstream: tuck in right behind another kart (D65: a longer, wider wake that charges faster)
      let behind = false;
      if (k.sp > 24 && k.boost <= 0) {
        for (const c of karts) {
          if (c === k || c.rescue > 0 || c.out) continue;
          const d = c.prog - k.prog;
          if (d > 0.6 && d < H.draftReach && Math.abs(c.lat - k.lat) < H.draftLat) {
            behind = true;
            break;
          }
        }
      }
      // D65 slingshot: pulling out of a charged slipstream fires a short boost, to get past
      if (H.slingshot > 0 && !behind && k.drafting && k.boost <= 0 && k.spin <= 0 && !k.air) {
        this.giveBoost(k, H.slingshot, 'draft');
        this.emit({ type: 'slingshot', kart: k.id });
        k.drafting = false;
        k.draft = 0;
      }
      // D83: the draft tunnel charges the slipstream twice as fast
      const tow = s.zones && inTunnel(s.track, s.zones.tunnel, k.idx) ? TUNNEL_DRAFT : 1;
      k.draft = behind ? Math.min(1.6, k.draft + dt * H.draftCharge * tow) : Math.max(0, k.draft - dt * 1.5);
      if (k.draft >= 1 && !k.drafting) {
        k.drafting = true;
        this.emit({ type: 'draft', kart: k.id });
      }
      if (k.draft < 0.5) k.drafting = false;
    }
    for (const b of s.boxes) if (b.cool > 0) b.cool -= dt;
    this.stepOrbs(dt);
    this.stepComets(dt);
    this.stepBolts(dt);
    this.stepSlicks(dt);
    const order = this.updateRanks();
    if (s.phase === 'race') {
      if (brawl) this.checkBrawlEnd();
      else this.checkRaceEnd(order);
    }
  }

  /** D69: a boosted ram knocks a life off the rammed kart and gives it to the rammer (up to the starting lives). */
  private ram(att: Kart, vic: Kart): void {
    if (!this.spinOut(vic, att)) return;
    if (att.lives < BRAWL_LIVES) {
      att.lives++;
      this.emit({ type: 'steal', kart: att.id, other: vic.id });
    }
  }

  /**
   * D69: the round ends with one kart left, when every player is out, or at the time limit (most lives wins).
   * Sudden death first: at BRAWL_SUDDEN s every kart still in drops to its last life.
   */
  private checkBrawlEnd(): void {
    const s = this.s;
    const alive = s.karts.filter((k) => !k.out);
    if (!s.suddenDeath && s.raceTime >= BRAWL_SUDDEN && alive.length > 1) {
      s.suddenDeath = true;
      for (const k of alive) k.lives = Math.min(k.lives, 1);
      this.emit({ type: 'suddendeath', kart: -1 });
    }
    const humansOut = s.humans.length > 0 && s.humans.every((h) => h.out);
    if (alive.length <= 1 || humansOut || s.raceTime >= BRAWL_LIMIT) {
      for (const k of alive) {
        k.finished = true;
        k.finishTime = s.raceTime;
      }
      s.phase = 'finished';
      // D80: rank again now: the order passed in was taken before this step's last hits, so a kart knocked out in
      // this very step could still have stood first
      const final = this.updateRanks();
      s.standings = final;
      if (alive[0]) this.emit({ type: 'finish', kart: final[0]!.id });
      this.emit({ type: 'raceover', kart: -1 });
    }
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
      over =
        humans.every((h) => h.finished) ||
        (s.firstHumanFinish !== null && s.raceTime - s.firstHumanFinish >= s.raceEndGrace);
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
