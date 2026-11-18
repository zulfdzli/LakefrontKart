/** Phase 8: the three tracks (section 11) and the race rules that depend on them (section 12.4, section 15). */
import { describe, expect, it } from 'vitest';
import {
  TRACK_IDS,
  TRACKS,
  STEP,
  SURF,
  createGame,
  getTrack,
  trackStats,
  type Difficulty,
  type GameOptions,
  type TrackId,
} from '@tk/shared';

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

function aiRace(id: TrackId, seed: number, laps: number, diff: Difficulty = 'normal', itemsOn = false) {
  const opts: GameOptions = {
    seed,
    humans: [],
    aiFill: true,
    laps,
    difficulty: diff,
    itemsOn,
    track: getTrack(id),
    raceEndGrace: 1e9,
  };
  const g = createGame(opts);
  g.startCountdown();
  const s = g.getSnapshot();
  let maxStill = 0,
    rescues = 0;
  const still = new Map<number, number>();
  for (let i = 0; i < 60 * 60 * 12 && !s.karts.every((k) => k.finished); i++) {
    g.step(STEP);
    for (const e of g.drainEvents()) if (e.type === 'rescue') rescues++;
    if (s.phase !== 'race') continue;
    for (const k of s.karts) {
      if (k.finished || k.rescue > 0) continue;
      // "circles or is pinned": no forward progress for a while
      const t = Math.abs(k.sp) < 3 ? (still.get(k.id) ?? 0) + STEP : 0;
      still.set(k.id, t);
      maxStill = Math.max(maxStill, t);
    }
  }
  return { s, maxStill, rescues };
}

describe('track layouts', () => {
  for (const id of TRACK_IDS) {
    it(`${id}: sensible layout (length, corners, separation, sectors, features)`, () => {
      const def = TRACKS[id],
        T = getTrack(id),
        st = trackStats(T);
      expect(st.len).toBeGreaterThan(3200);
      expect(st.len).toBeLessThan(4500);
      // the inside road edge never folds over; invented tracks keep wide corners (traced ones keep the real ones)
      const hwAt = T.HW[Math.round(st.minRadiusAt * T.N) % T.N]!;
      expect(st.minRadius).toBeGreaterThan(def.traced ? hwAt + 2 : 25);
      // unrelated road sections keep their walls apart (walls close in where the road runs close by)
      expect(st.minSep).toBeGreaterThan(def.traced ? 30 : 55);
      for (let i = 0; i < T.N; i++) expect(T.WALLD[i]!).toBeGreaterThan(T.HW[i]! + 3);
      expect(def.sectors.length).toBeGreaterThanOrEqual(3);
      expect(def.sectors.length).toBeLessThanOrEqual(4);
      // section 11.2: a risk/reward shortcut on every invented track (a traced circuit has none)
      if (!def.traced) expect(T.shortcuts.length).toBeGreaterThanOrEqual(1);
      expect(T.pads.length).toBeGreaterThanOrEqual(1);
      // a hairpin: somewhere the road turns through at least 160° within 200 m
      let hair = 0;
      const w = Math.round(200 / T.DS);
      for (let i = 0; i < T.N; i += 3) {
        let turn = 0;
        for (let k = 0; k < w; k++) turn += T.CURV[(i + k) % T.N]! / 12;
        hair = Math.max(hair, Math.abs(turn));
      }
      expect(hair).toBeGreaterThan((160 * Math.PI) / 180);
      // no gate inside a shortcut's skipped stretch, or the shortcut could never count
      for (const sc of T.shortcuts) for (const g of T.gates) expect(g > sc.i0 && g < sc.i1).toBe(false);
      // item rows every 350-450 m on average
      expect(T.LEN / T.boxRows.length).toBeGreaterThan(300);
      expect(T.LEN / T.boxRows.length).toBeLessThan(500);
    });
  }
});

describe('lap length (section 11.1)', () => {
  for (const id of TRACK_IDS) {
    it(`${id}: Normal AI median lap is 115-125 s and every kart finishes`, () => {
      const laps: number[] = [];
      for (const seed of [1, 2]) {
        const { s, maxStill } = aiRace(id, seed, 2);
        expect(s.karts.every((k) => k.finished)).toBe(true);
        expect(maxStill).toBeLessThan(10);
        for (const k of s.karts) laps.push(...k.lapTimes);
      }
      expect(laps.length).toBeGreaterThanOrEqual(10);
      const m = median(laps);
      expect(m).toBeGreaterThan(115);
      expect(m).toBeLessThan(125);
    }, 60000);
  }
});

describe('robustness (section 15)', () => {
  // section 15 asks for 150 seeded races per track; ROBUST_RACES=150 runs the full set, the default keeps CI quick
  const RACES = Number(process.env.ROBUST_RACES ?? 12);
  for (const id of TRACK_IDS) {
    it(`${id}: ${RACES} seeded races with items: everyone finishes, nobody pinned for 5 s`, () => {
      for (let seed = 100; seed < 100 + RACES; seed++) {
        const diff: Difficulty = (['easy', 'normal', 'hard'] as const)[seed % 3]!;
        const { s, maxStill } = aiRace(id, seed, 1, diff, true);
        expect(
          s.karts.every((k) => k.finished),
          `seed ${seed}`,
        ).toBe(true);
        expect(maxStill, `seed ${seed}`).toBeLessThan(5);
      }
    }, 600000);
  }
});

/** One human kart (manual input) on a track, after the countdown. */
function manual(id: TrackId) {
  const g = createGame({
    seed: 5,
    humans: [{ slot: 0, ci: 0 }],
    aiFill: false,
    laps: 3,
    difficulty: 'normal',
    itemsOn: false,
    track: getTrack(id),
    raceEndGrace: 1e9,
  });
  g.startCountdown();
  const s = g.getSnapshot();
  g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
  for (let i = 0; i < 60 * 5; i++) g.step(STEP);
  return { g, s, k: s.humans[0]!, T: s.track };
}

/** Teleport a kart onto the centreline at sample i, facing along the track (dir 1) or backwards (-1). */
function place(
  k: { x: number; z: number; h: number; vx: number; vz: number; px: number; pz: number; idx: number; lastIdx: number },
  T: ReturnType<typeof getTrack>,
  i: number,
  dir = 1,
): void {
  k.x = k.px = T.CX[i]!;
  k.z = k.pz = T.CZ[i]!;
  k.idx = k.lastIdx = i;
  k.h = dir > 0 ? T.ANG[i]! : T.ANG[i]! + Math.PI;
  k.vx = Math.sin(k.h) * 20;
  k.vz = Math.cos(k.h) * 20;
}

describe('race rules on gated tracks (section 12.4)', () => {
  it('a lap counts only after every checkpoint gate; skipping one does not count', () => {
    const { g, s, k, T } = manual('meadows');
    g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
    expect(k.lap).toBe(1); // crossed the line from the grid
    // jump past every gate (as if cutting across) to just before the line, then cross it
    place(k, T, T.N - 8);
    for (let i = 0; i < 60 && k.idx > T.N / 2; i++) g.step(STEP);
    expect(k.lap).toBe(1);
    expect(g.drainEvents().some((e) => e.type === 'missedgate')).toBe(true);
    // now drive the gates in order (teleport just before each, step through it), then cross the line
    k.gate = 0;
    for (const gi of T.gates) {
      place(k, T, (gi - 4 + T.N) % T.N);
      for (let i = 0; i < 40 && k.gate < T.gates.length && T.gates[k.gate] === gi; i++) g.step(STEP);
    }
    expect(k.gate).toBe(T.gates.length);
    place(k, T, T.N - 8);
    for (let i = 0; i < 60 && k.lap === 1; i++) g.step(STEP);
    expect(k.lap).toBe(2);
    expect(s.phase).toBe('race');
  });

  it('driving backwards over the line takes the lap back, and forwards again restores it', () => {
    const { g, k, T } = manual('canyon');
    g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
    expect(k.lap).toBe(1);
    place(k, T, 6, -1);
    for (let i = 0; i < 60 && k.lap === 1; i++) g.step(STEP);
    expect(k.lap).toBe(0);
    place(k, T, T.N - 6, 1);
    for (let i = 0; i < 60 && k.lap === 0; i++) g.step(STEP);
    expect(k.lap).toBe(1);
  });

  it('a kart off the track for 4 s is rescued to a valid on-track position', () => {
    const { g, k, T } = manual('frosty');
    g.setInput(0, { steer: 0, throttle: false, brake: false, drift: false });
    // park it on the snow beyond the kerb, at a straight
    const i = Math.round(T.N * 0.05);
    k.x = k.px = T.CX[i]! + T.RX[i]! * (T.HW[i]! + 6);
    k.z = k.pz = T.CZ[i]! + T.RZ[i]! * (T.HW[i]! + 6);
    k.vx = k.vz = 0;
    let rescued = false;
    for (let n = 0; n < 60 * 7 && !rescued; n++) {
      g.step(STEP);
      rescued = g.drainEvents().some((e) => e.type === 'rescue');
    }
    expect(rescued).toBe(true);
    for (let n = 0; n < 60 * 2; n++) g.step(STEP);
    expect(Math.abs(k.lat)).toBeLessThan(T.HW[k.idx]!);
    expect(SURF[k.surf].off).toBe(false);
  });

  it('the canyon ramp launches karts into the air; a straight landing gives a small boost', () => {
    const { g, k, T } = manual('canyon');
    g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
    const r = T.ramps[0]!;
    g.setHumanAi(0, true); // let the autopilot steer along the road; the ramp is what is under test
    place(k, T, (r.i0 - 20 + T.N) % T.N);
    k.vx = Math.sin(k.h) * 34;
    k.vz = Math.cos(k.h) * 34;
    let jumped = false,
      landed = false,
      boosted = false;
    for (let n = 0; n < 60 * 4 && !landed; n++) {
      g.step(STEP);
      for (const e of g.drainEvents()) {
        if (e.type === 'jump') jumped = true;
        if (e.type === 'land') landed = true;
        if (e.type === 'boost' && e.src === 'jump') boosted = true;
      }
      if (jumped && !landed) expect(k.alt).toBeGreaterThanOrEqual(0);
    }
    expect(jumped).toBe(true);
    expect(landed).toBe(true);
    expect(boosted).toBe(true);
  });
});
