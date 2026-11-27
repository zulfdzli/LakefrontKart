/** D74 signature moves: the meter, each character's move, the off switch, phone input and exact replays. */
import { describe, expect, it } from 'vitest';
import {
  CHARS,
  EYES_T,
  MOVE_OF,
  OVERCLOCK_T,
  ReplayLog,
  ReplaySim,
  STEP,
  createGame,
  getTrack,
  sanitizeInput,
  type Game,
  type GameOptions,
  type GameState,
  type Kart,
} from '@tk/shared';

const ci = (id: string): number => CHARS.findIndex((c) => c.id === id);

/** Two players on Canyon (the mover and a second kart), racing, both left to the test. */
function race(
  mover: string,
  other = 'pip',
  extra: Partial<GameOptions> = {},
): { g: Game; s: GameState; k: Kart; o: Kart } {
  const g = createGame({
    seed: 3,
    humans: [
      { slot: 0, ci: ci(mover) },
      { slot: 1, ci: ci(other === mover ? 'gus' : other) },
    ],
    aiFill: false,
    laps: 2,
    difficulty: 'normal',
    itemsOn: true,
    track: getTrack('canyon'),
    moves: true,
    ...extra,
  });
  g.startCountdown();
  const s = g.getSnapshot() as GameState;
  for (let n = 0; n < 60 * 4; n++) g.step(STEP);
  g.drainEvents();
  return { g, s, k: s.humans[0]!, o: s.humans[1]! };
}
const idle = { steer: 0, throttle: false, brake: false, drift: false, item: null };
/** Put a kart on the road at sample i, lateral lat, heading down it at speed v. */
function place(s: GameState, k: Kart, i: number, lat: number, v: number): void {
  const T = s.track;
  k.x = k.px = T.CX[i]! + T.RX[i]! * lat;
  k.z = k.pz = T.CZ[i]! + T.RZ[i]! * lat;
  k.h = k.ph = T.ANG[i]!;
  k.vx = Math.sin(k.h) * v;
  k.vz = Math.cos(k.h) * v;
  k.idx = k.lastIdx = i;
  k.lat = lat;
  k.frac = 0;
  k.prog = k.lap * T.N + i;
}
/** Fill the meter and press MOVE (through the phone path); returns the step's events. */
function fire(g: Game, s: GameState, k: Kart): string[] {
  k.meter = 1;
  g.setInput(k.slot!, { ...idle, throttle: true, move: true });
  g.step(STEP);
  return g.drainEvents().map((e) => e.type);
}

describe('signature moves (D74)', () => {
  it('every character has one; the meter charges faster drifting, in the air and in a slipstream', () => {
    for (const c of CHARS) expect(MOVE_OF[c.id], c.id).toBeDefined();
    const { g, s, k } = race('bruno');
    g.setInput(0, { ...idle, throttle: true });
    k.meter = 0;
    for (let n = 0; n < 60; n++) g.step(STEP);
    const base = k.meter;
    expect(base).toBeGreaterThan(0);
    k.meter = 0;
    for (let n = 0; n < 60; n++) {
      k.drafting = true;
      k.drifting = true;
      g.step(STEP);
    }
    expect(k.meter).toBeGreaterThan(base * 5);
    void s;
  });

  it('MOVE does nothing until the meter is full; firing empties it', () => {
    const { g, k } = race('pip');
    k.meter = 0.9;
    g.setInput(0, { ...idle, throttle: true, move: true });
    g.step(STEP);
    expect(g.drainEvents().some((e) => e.type === 'move')).toBe(false);
    expect(k.slideT).toBe(0);
    const ev = fire(g, g.getSnapshot() as GameState, k);
    expect(ev).toContain('move');
    expect(k.meter).toBeLessThan(0.01);
  });

  it('off unless switched on: no meter, no move', () => {
    const { g, k } = race('pip', 'gus', { moves: false });
    for (let n = 0; n < 120; n++) g.step(STEP);
    expect(k.meter).toBe(0);
    k.meter = 1;
    g.setInput(0, { ...idle, move: true });
    g.step(STEP);
    expect(g.drainEvents().some((e) => e.type === 'move')).toBe(false);
  });

  it('Bruno: Shoulder Charge shoves the kart beside him off its line (a shield pops instead)', () => {
    const { g, s, k, o } = race('bruno', 'pip');
    const i = 200;
    place(s, k, i, -2, 30);
    place(s, o, i, 2.5, 30);
    g.setInput(1, { ...idle, throttle: true });
    const ev = fire(g, s, k);
    expect(ev).toContain('shoved');
    const T = s.track;
    const lat = o.vx * T.RX[o.idx]! + o.vz * T.RZ[o.idx]!;
    expect(lat).toBeGreaterThan(5);
    // again, at a shielded kart
    place(s, k, i + 50, -2, 30);
    place(s, o, i + 50, 2.5, 30);
    o.shield = 5;
    o.invuln = 0;
    expect(fire(g, s, k)).toContain('shieldpop');
  });

  it('Pip: Belly Slide boosts and slides over oil', () => {
    const { g, s, k, o } = race('pip', 'gus');
    const i = 220;
    place(s, k, i, 0, 30);
    expect(fire(g, s, k)).toContain('boost');
    // an oil slick right ahead
    const T = s.track,
      j = i + Math.round(10 / T.DS);
    s.slicks.push({ x: T.CX[j]!, z: T.CZ[j]!, y: T.H[j]!, idx: j, lat: 0, frac: 0, age: 5, owner: o, r: 3.2 });
    for (let n = 0; n < 40; n++) g.step(STEP);
    expect(k.spin).toBe(0);
  });

  it('Zed: Overclock makes the engine pull harder (D76), with the same top speed', () => {
    const run = (over: boolean): number => {
      const { g, s, k } = race('zed', 'pip');
      place(s, k, 300, 0, 8);
      if (over) fire(g, s, k);
      expect(k.overT > 0).toBe(over);
      g.setInput(0, { ...idle, throttle: true });
      for (let n = 0; n < 30; n++) g.step(STEP);
      return k.sp;
    };
    // from 8 m/s, half a second of full throttle
    expect(run(true) - 8).toBeGreaterThan((run(false) - 8) * 1.35);
    expect(OVERCLOCK_T).toBeGreaterThan(3);
  });

  it('Mochi: Mirage leaves a decoy that takes the orb meant for her', () => {
    const { g, s, k, o } = race('mochi', 'pip');
    const T = s.track,
      i = 260;
    place(s, k, i, 0, 0);
    fire(g, s, k);
    expect(k.decoy).not.toBeNull();
    // she drives on; an orb comes from behind
    place(s, k, i + Math.round(40 / T.DS), 0, 20);
    place(s, o, i - Math.round(60 / T.DS), 0, 20);
    s.orbs.push({ prog: o.prog + 1, lat: 0, dir: 1, owner: o, age: 1.5, x: o.x, z: o.z, y: o.y, target: null });
    const types: string[] = [];
    for (let n = 0; n < 90; n++) {
      g.step(STEP);
      types.push(...g.drainEvents().map((e) => e.type));
    }
    expect(types).toContain('decoypop');
    expect(types).not.toContain('orbhit');
    expect(k.decoy).toBeNull();
  });

  it('Gus: Hop jumps on demand, over oil, and lands with a boost', () => {
    const { g, s, k, o } = race('gus', 'pip');
    const T = s.track,
      i = 320;
    place(s, k, i, 0, 30);
    fire(g, s, k);
    expect(k.air).toBe(true);
    const j = i + Math.round(8 / T.DS);
    s.slicks.push({ x: T.CX[j]!, z: T.CZ[j]!, y: T.H[j]!, idx: j, lat: 0, frac: 0, age: 5, owner: o, r: 3.2 });
    const types: string[] = [];
    for (let n = 0; n < 60 && k.air; n++) {
      g.step(STEP);
      types.push(...g.drainEvents().map((e) => e.type));
    }
    expect(k.spin).toBe(0);
    expect(types).toContain('land');
  });

  it('Luna: Night Eyes dodges the first orb', () => {
    const { g, s, k, o } = race('luna', 'pip');
    const T = s.track,
      i = 360;
    place(s, k, i, 0, 20);
    fire(g, s, k);
    expect(k.eyesT).toBeGreaterThan(EYES_T - 0.1);
    place(s, o, i - Math.round(50 / T.DS), 0, 20);
    s.orbs.push({ prog: o.prog + 1, lat: 0, dir: 1, owner: o, age: 1.5, x: o.x, z: o.z, y: o.y, target: null });
    const types: string[] = [];
    for (let n = 0; n < 90; n++) {
      g.step(STEP);
      types.push(...g.drainEvents().map((e) => e.type));
    }
    expect(types).toContain('dodge');
    expect(k.spin).toBe(0);
  });

  it('the phone sends MOVE as a one-shot that the server passes on', () => {
    const base = { seq: 1, steer: 0, throttle: true, brake: false, drift: false, item: null, t: 0 };
    expect(sanitizeInput({ ...base, move: true })?.move).toBe(true);
    expect(sanitizeInput({ ...base, move: 'yes' })?.move).toBeUndefined();
    expect(sanitizeInput(base)?.move).toBeUndefined();
  });

  it('AI races with moves: everyone finishes, every character uses its move, and it replays exactly', () => {
    const o: GameOptions = {
      seed: 8,
      humans: [{ slot: 0, ci: 0 }],
      aiFill: true,
      laps: 2,
      difficulty: 'hard',
      itemsOn: true,
      track: getTrack('frosty'),
      moves: true,
      raceEndGrace: 1e9,
    };
    const g = createGame(o);
    const log = new ReplayLog();
    log.attach(g);
    g.setHumanAi(0, true);
    g.startCountdown();
    const s = g.getSnapshot();
    const used = new Set<string>();
    for (let n = 0; n < 60 * 300 && !s.karts.every((k) => k.finished); n++) {
      g.step(STEP);
      for (const e of g.drainEvents()) if (e.type === 'move') used.add(s.karts[e.kart]!.ch.id);
    }
    expect(s.karts.every((k) => k.finished)).toBe(true);
    expect(used.size).toBe(6);
    const sim = new ReplaySim(o, log);
    sim.seek(log.steps);
    expect(sim.game.getSnapshot().karts.map((k) => [k.x, k.z, k.meter])).toEqual(
      s.karts.map((k) => [k.x, k.z, k.meter]),
    );
  }, 60_000);
});
