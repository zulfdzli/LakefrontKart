/** D73 living tracks: the plan, the spots, each event's timeline and effect, the AI's dodging, and exact replays. */
import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  HAZARD_OF,
  ROCKS_HALF,
  ReplayLog,
  ReplaySim,
  STEP,
  TRACK_IDS,
  createGame,
  getTrack,
  hazardSpot,
  planHazards,
  type Difficulty,
  type Game,
  type GameOptions,
  type GameState,
  type Hazard,
  type Kart,
  type TrackId,
} from '@tk/shared';

const opts = (track: TrackId, extra: Partial<GameOptions> = {}): GameOptions => ({
  seed: 9,
  humans: [{ slot: 0, ci: 1 }],
  aiFill: true,
  laps: 2,
  difficulty: 'normal',
  itemsOn: false,
  track: getTrack(track),
  events: true,
  raceEndGrace: 1e9,
  ...extra,
});

/** Run with every kart AI-driven until the first event reaches a phase; returns the game. */
function runTo(track: TrackId, phase: Hazard['phase'], extra: Partial<GameOptions> = {}): { g: Game; s: GameState } {
  const g = createGame(opts(track, extra));
  g.setHumanAi(0, true);
  g.startCountdown();
  const s = g.getSnapshot() as GameState;
  for (let n = 0; n < 60 * 300 && s.hazards[0]!.phase !== phase; n++) g.step(STEP);
  return { g, s };
}

/** Put a kart on the road at sample i, lateral lat, heading down the road at speed v. */
function place(s: GameState, k: Kart, i: number, lat: number, v: number): void {
  const T = s.track;
  k.x = k.px = T.CX[i]! + T.RX[i]! * lat;
  k.z = k.pz = T.CZ[i]! + T.RZ[i]! * lat;
  k.h = k.ph = T.ANG[i]!;
  k.vx = Math.sin(k.h) * v;
  k.vz = Math.cos(k.h) * v;
  k.idx = k.lastIdx = i;
  k.spin = k.invuln = k.shield = k.hazCool = 0;
}

describe('living tracks (D73)', () => {
  it('each track has its event: one on a 1-lap race, two when it passes (lasting ones once); off by default', () => {
    for (const id of TRACK_IDS) {
      const T = getTrack(id),
        kind = HAZARD_OF[id]!;
      expect(planHazards(T, 1, 1)).toHaveLength(1);
      const two = planHazards(T, 3, 3);
      const lasting = kind === 'rocks' || kind === 'squall';
      expect(two).toHaveLength(lasting ? 1 : 2);
      expect(two.every((h) => h.kind === kind && h.phase === 'idle')).toBe(true);
      if (lasting) expect(two[0]!.lap).toBeLessThan(2);
      expect(planHazards(T, 3, 3)).toEqual(two);
      // only when asked for, and never in a brawl
      expect(createGame({ ...opts(id), events: undefined }).getSnapshot().hazards).toEqual([]);
    }
    expect(planHazards(getTrack('arena-meadow'), 1, 1)).toEqual([]);
  });

  it('the spot is on the ground, with a run-up clear of crests and jumps', () => {
    for (const id of TRACK_IDS) {
      const T = getTrack(id),
        { idx } = hazardSpot(T, HAZARD_OF[id]!);
      expect(idx).toBeGreaterThan(T.N * 0.29);
      expect(idx).toBeLessThan(T.N * 0.86);
      for (let o = -Math.round(130 / T.DS); o <= 8; o++) expect(T.airZone[(idx + o + T.N) % T.N], id).toBe(false);
    }
  });

  it('the race RNG is untouched: with events off, a race runs exactly as before', () => {
    const a = createGame({ ...opts('canyon'), events: false }),
      b = createGame({ ...opts('canyon'), events: undefined });
    for (const g of [a, b]) {
      g.setHumanAi(0, true);
      g.startCountdown();
      for (let n = 0; n < 60 * 30; n++) g.step(STEP);
    }
    expect(a.getSnapshot().karts.map((k) => [k.x, k.z])).toEqual(b.getSnapshot().karts.map((k) => [k.x, k.z]));
  });

  it('a warning comes first, in front of the leader, then the event lands', () => {
    const { g, s } = runTo('meadows', 'warn');
    const h = s.hazards[0]!,
      T = s.track;
    const lead = Math.max(...s.karts.map((k) => k.prog));
    const ahead = ((h.lap + 1) * T.N + h.idx - lead) * T.DS;
    expect(ahead).toBeGreaterThan(200);
    expect(ahead).toBeLessThan(400);
    // the flock waits at the roadside while warned
    expect(h.sheep).toHaveLength(6);
    expect(h.sheep.every((sh) => Math.abs(sh.lat) > T.HW[h.idx]!)).toBe(true);
    for (let n = 0; n < 60 * 4 && h.phase === 'warn'; n++) g.step(STEP);
    expect(h.phase).toBe('active');
  });

  it('sheep: a soft bump (speed lost, no spin); the flock crosses and goes', () => {
    const { g, s } = runTo('meadows', 'active');
    const h = s.hazards[0]!,
      k = s.humans[0]!,
      T = s.track;
    g.setHumanAi(0, false);
    const sh = h.sheep[2]!;
    const i = (h.idx + Math.round(sh.along / T.DS) - Math.round(8 / T.DS) + T.N) % T.N;
    place(s, k, i, sh.lat, 25);
    g.setInput(0, { steer: 0, throttle: false, brake: false, drift: false, item: null });
    let baa = false;
    for (let n = 0; n < 40 && !baa; n++) {
      g.step(STEP);
      baa = g.drainEvents().some((e) => e.type === 'baa' && e.kart === k.id);
    }
    expect(baa).toBe(true);
    expect(k.spin).toBe(0);
    expect(Math.hypot(k.vx, k.vz)).toBeLessThan(20);
    for (let n = 0; n < 60 * 30 && h.phase === 'active'; n++) g.step(STEP);
    expect(h.phase).toBe('done');
  });

  it('rocks: driving into the rubble stops the kart hard and shoves it to the open side; it clears a lap later', () => {
    const { g, s } = runTo('canyon', 'active');
    const h = s.hazards[0]!,
      k = s.humans[0]!,
      T = s.track;
    g.setHumanAi(0, false);
    g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false, item: null });
    const i = (h.idx - Math.round((ROCKS_HALF + 6) / T.DS) + T.N) % T.N;
    place(s, k, i, h.side * 4, 40);
    let hit = false;
    for (let n = 0; n < 60 && !hit; n++) {
      g.step(STEP);
      hit = g.drainEvents().some((e) => e.type === 'rockhit' && e.kart === k.id);
    }
    expect(hit).toBe(true);
    expect(Math.hypot(k.vx, k.vz)).toBeLessThan(25);
    for (let n = 0; n < 60; n++) g.step(STEP);
    expect(k.lat * h.side).toBeLessThan(0);
    g.setHumanAi(0, true);
    for (let n = 0; n < 60 * 200 && h.phase === 'active'; n++) g.step(STEP);
    expect(h.phase).toBe('done');
  });

  it('snowball: rolling across the road, it flattens a kart in its path into a spin', () => {
    const { g, s } = runTo('frosty', 'active');
    const h = s.hazards[0]!,
      k = s.humans[0]!,
      T = s.track;
    g.setHumanAi(0, false);
    g.setInput(0, { steer: 0, throttle: false, brake: true, drift: false, item: null });
    // park on the ball's line, a little ahead of where it is rolling
    place(s, k, h.idx, h.ball!.lat + h.side * (BALL_R + 6), 0);
    let squash = false;
    for (let n = 0; n < 60 * 4 && !squash; n++) {
      g.step(STEP);
      squash = g.drainEvents().some((e) => e.type === 'squash' && e.kart === k.id);
    }
    expect(squash).toBe(true);
    expect(k.spin).toBeGreaterThan(0);
    void T;
  });

  it('squall: its stretch is soaked (puddles there) for a lap, then dries', () => {
    const { g, s } = runTo('sepang', 'active');
    const h = s.hazards[0]!,
      T = s.track;
    expect(s.puddles.length).toBeGreaterThan(0);
    expect(s.puddles.every((p) => (p.i - h.idx + T.N) % T.N <= h.len)).toBe(true);
    for (let n = 0; n < 60 * 200 && h.phase === 'active'; n++) g.step(STEP);
    expect(h.phase).toBe('done');
    expect(s.puddles).toEqual([]);
  });

  it('AI races with events finish everywhere; Hard dodges better than Easy', () => {
    const caught: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0 };
    for (const id of ['meadows', 'canyon', 'frosty'] as const)
      for (const diff of ['easy', 'hard'] as const)
        for (const seed of [1, 2, 3]) {
          const g = createGame({ ...opts(id), humans: [], seed, difficulty: diff });
          g.startCountdown();
          const s = g.getSnapshot();
          for (let n = 0; n < 60 * 300 && !s.karts.every((k) => k.finished); n++) {
            g.step(STEP);
            for (const e of g.drainEvents()) if (['baa', 'rockhit', 'squash'].includes(e.type)) caught[diff]++;
          }
          expect(
            s.karts.every((k) => k.finished),
            `${id} ${diff} ${seed}`,
          ).toBe(true);
          expect(
            s.hazards.every((h) => h.phase === 'done' || h.phase === 'active'),
            id,
          ).toBe(true);
        }
    expect(caught.hard).toBeLessThan(caught.easy);
  }, 120_000);

  it('a race with events replays exactly', () => {
    for (const id of ['canyon', 'frosty'] as const) {
      const o = { ...opts(id), difficulty: 'hard' as const, seed: 4 };
      const g = createGame(o);
      const log = new ReplayLog();
      log.attach(g);
      g.setHumanAi(0, true);
      g.startCountdown();
      for (let n = 0; n < 60 * 70; n++) g.step(STEP);
      const sim = new ReplaySim(o, log);
      sim.seek(log.steps);
      const r = sim.game.getSnapshot();
      expect(r.karts.map((k) => [k.x, k.z])).toEqual(g.getSnapshot().karts.map((k) => [k.x, k.z]));
      expect(JSON.stringify(r.hazards)).toBe(JSON.stringify(g.getSnapshot().hazards));
    }
  });
});
