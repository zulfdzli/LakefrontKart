/**
 * D68 race highlights. The simulation is deterministic (seeded RNG, fixed steps, no clocks), so a race can be
 * replayed exactly by re-running a fresh Game from the same options with the same calls at the same steps: the
 * phones' inputs, AI handovers (a phone dropping out) and the countdown start. ReplayLog records those calls;
 * ReplaySim plays them back. Moments (big air, hits, overtakes, a photo finish) are scored and picked here too.
 */
import { STEP } from './constants';
import { createGame, type Game, type GameEvent, type GameOptions } from './game';

type InputArg = Parameters<Game['setInput']>[1];
type Entry =
  | { n: number; t: 'in'; slot: number; inp: InputArg }
  | { n: number; t: 'ai'; slot: number; ai: boolean }
  | { n: number; t: 'cd' };

/** Records everything fed into a Game, against the step it came before. */
export class ReplayLog {
  /** Steps taken so far. */
  steps = 0;
  readonly entries: Entry[] = [];
  private readonly lastIn = new Map<number, string>();

  /** Wrap a game's input, AI-handover, countdown and step calls so they are recorded (and still run). */
  attach(g: Game): void {
    const step = g.step.bind(g),
      setInput = g.setInput.bind(g),
      setHumanAi = g.setHumanAi.bind(g),
      startCountdown = g.startCountdown.bind(g);
    g.step = (dt: number = STEP): void => {
      step(dt);
      this.steps++;
    };
    g.setInput = (slot, inp): void => {
      // the host re-sends unchanged input every frame; only changes (and every item press) matter
      const key = `${inp.steer}|${inp.throttle}|${inp.brake}|${inp.drift}`;
      if (inp.item || this.lastIn.get(slot) !== key) {
        this.lastIn.set(slot, key);
        this.entries.push({ n: this.steps, t: 'in', slot, inp: { ...inp } });
      }
      setInput(slot, inp);
    };
    g.setHumanAi = (slot, ai): void => {
      this.entries.push({ n: this.steps, t: 'ai', slot, ai });
      setHumanAi(slot, ai);
    };
    g.startCountdown = (): void => {
      this.entries.push({ n: this.steps, t: 'cd' });
      startCountdown();
    };
  }
}

/** A fresh copy of a recorded race, stepped forward with the recorded calls. */
export class ReplaySim {
  readonly game: Game;
  /** Steps taken. */
  step = 0;
  private i = 0;

  constructor(
    opts: GameOptions,
    private readonly log: ReplayLog,
  ) {
    this.game = createGame(opts);
  }

  /** One step (after applying the calls recorded before it); returns the step's events. */
  advance(): GameEvent[] {
    const E = this.log.entries,
      g = this.game;
    while (this.i < E.length && E[this.i]!.n <= this.step) {
      const e = E[this.i++]!;
      if (e.t === 'in') g.setInput(e.slot, e.inp);
      else if (e.t === 'ai') g.setHumanAi(e.slot, e.ai);
      else g.startCountdown();
    }
    g.step(STEP);
    this.step++;
    return g.drainEvents();
  }

  /** Fast-forward to a step (events dropped). */
  seek(target: number): void {
    while (this.step < target) this.advance();
  }
}

/** D74: 'move' is a signature move that paid off (a shove, a decoy taking a hit, a dodge). */
export type MomentKind = 'air' | 'hit' | 'ko' | 'pass' | 'photo' | 'finish' | 'move';

export interface Moment {
  kind: MomentKind;
  /** The key step (landing, hit, the pass, crossing the line). */
  step: number;
  /** The kart the camera follows, and the other one involved (passed, or second over the line). */
  kart: number;
  other?: number;
  /** A player's kart (moments with players rank higher). */
  human: boolean;
  /** Air time (s) for a jump. */
  air?: number;
  /** Track sample and lateral position at the key step (camera placement), and at take-off for a jump. */
  idx: number;
  lat: number;
  idx0?: number;
  /** Clip: steps [from, to), slow motion in [slowFrom, slowTo). */
  from: number;
  to: number;
  slowFrom: number;
  slowTo: number;
  score: number;
}

const S = (sec: number): number => Math.round(sec / STEP);

/** Fill in a moment's clip window and score from its kind and key step. */
export function frameMoment(
  m: Omit<Moment, 'from' | 'to' | 'slowFrom' | 'slowTo' | 'score'>,
  lastLap: boolean,
): Moment {
  const k = m.step;
  let from: number, to: number, slowFrom: number, slowTo: number, score: number;
  switch (m.kind) {
    case 'air': {
      const fly = S(m.air ?? 1);
      from = k - fly - S(1.3);
      to = k + S(1.1);
      slowFrom = k - fly - S(0.15);
      slowTo = k + S(0.25);
      score = 6 + (m.air ?? 1) * 6;
      break;
    }
    case 'ko':
      from = k - S(1.9);
      to = k + S(1.6);
      slowFrom = k - S(0.45);
      slowTo = k + S(0.7);
      score = 16;
      break;
    case 'hit':
      from = k - S(1.9);
      to = k + S(1.5);
      slowFrom = k - S(0.45);
      slowTo = k + S(0.6);
      score = 10;
      break;
    case 'move':
      from = k - S(1.8);
      to = k + S(1.4);
      slowFrom = k - S(0.4);
      slowTo = k + S(0.6);
      score = 9;
      break;
    case 'pass':
      from = k - S(2.1);
      to = k + S(1.3);
      slowFrom = k - S(0.55);
      slowTo = k + S(0.35);
      score = 8 + (lastLap ? 4 : 0);
      break;
    case 'photo':
      from = k - S(2.4);
      to = k + S(1.0);
      slowFrom = k - S(0.7);
      slowTo = k + S(0.3);
      score = 30;
      break;
    case 'finish':
      from = k - S(2.2);
      to = k + S(1.3);
      slowFrom = k - S(0.45);
      slowTo = k + S(0.35);
      score = 1;
      break;
  }
  return { ...m, from: Math.max(0, from), to, slowFrom, slowTo, score: score + (m.human ? 6 : 0) };
}

/**
 * The reel: the winner crossing the line closes it (unless there is a photo finish, which always makes it), and
 * the best other moments fill the rest: highest score first, no two clips overlapping (a second apart), at most
 * two of a kind so the reel has variety, at most `max` clips, then in race order.
 */
export function pickMoments(all: readonly Moment[], max = 3, winnerFinish?: Moment): Moment[] {
  const gap = S(1);
  const chosen: Moment[] = [];
  const free = (m: Moment): boolean => chosen.every((c) => m.to + gap <= c.from || m.from >= c.to + gap);
  if (winnerFinish && !all.some((m) => m.kind === 'photo')) chosen.push(winnerFinish);
  for (const m of [...all].sort((a, b) => b.score - a.score || a.step - b.step)) {
    if (chosen.length >= max) break;
    if (chosen.filter((c) => c.kind === m.kind).length >= 2) continue;
    if (free(m)) chosen.push(m);
  }
  return chosen.sort((a, b) => a.from - b.from);
}
