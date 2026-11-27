/** Phase 11 mechanics (section 12, D46): items, the Seeker Comet, tyre grip, car collisions, drift bonus, AI gaps. */
import { describe, expect, it } from 'vitest';
import { Rng, STEP, chooseItem, createGame, getTrack, type Difficulty, type GameOptions } from '@tk/shared';

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

describe('item roll (section 12.3, D8)', () => {
  it('Rocket Booster only for the last two places; Seeker Comet only 4th and below, never on lap 1', () => {
    const rng = new Rng(9);
    const seen = (rank: number, lap: number): Set<string> => {
      const out = new Set<string>();
      for (let i = 0; i < 4000; i++) out.add(chooseItem(rank, rng, { total: 6, lap, cometActive: false }));
      return out;
    };
    for (const r of [0, 1, 2, 3]) expect(seen(r, 2).has('rocket')).toBe(false);
    for (const r of [4, 5]) expect(seen(r, 2).has('rocket')).toBe(true);
    for (const r of [0, 1, 2]) expect(seen(r, 2).has('comet')).toBe(false);
    for (const r of [3, 4, 5]) expect(seen(r, 2).has('comet')).toBe(true);
    for (const r of [3, 4, 5]) expect(seen(r, 1).has('comet')).toBe(false);
    const busy = new Set<string>();
    for (let i = 0; i < 4000; i++) busy.add(chooseItem(5, rng, { total: 6, lap: 2, cometActive: true }));
    expect(busy.has('comet')).toBe(false);
  });

  it('without a context the roll is the prototype six (parity)', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 3000; i++) expect(['rocket', 'comet']).not.toContain(chooseItem(5, rng));
  });
});

function race(extra: Partial<GameOptions> = {}) {
  const g = createGame({
    seed: 4,
    humans: [
      { slot: 0, ci: 0 },
      { slot: 1, ci: 1 },
    ],
    aiFill: false,
    laps: 3,
    difficulty: 'normal',
    itemsOn: false,
    track: getTrack('canyon'),
    raceEndGrace: 1e9,
    ...extra,
  });
  g.startCountdown();
  const s = g.getSnapshot();
  for (let i = 0; i < 60 * 5; i++) g.step(STEP);
  g.drainEvents();
  return { g, s };
}

describe('Seeker Comet', () => {
  it('warns the leader, strikes after the warning, and a boost dodges it', () => {
    for (const dodge of [false, true]) {
      const { g, s } = race();
      const [a, b] = s.humans as [(typeof s.humans)[0], (typeof s.humans)[0]];
      g.updateRanks();
      const leader = a.rank === 0 ? a : b,
        back = leader === a ? b : a;
      back.item = 'comet';
      back.itemUses = 1;
      back.input.item = true;
      g.step(STEP);
      let warned = false,
        result = '';
      for (let i = 0; i < 60 * 4 && !result; i++) {
        if (dodge) leader.boost = 1;
        g.step(STEP);
        for (const e of g.drainEvents()) {
          if (e.type === 'warn' && e.kart === leader.id) warned = true;
          if ((e.type === 'comethit' || e.type === 'cometmiss') && e.kart === leader.id) result = e.type;
        }
      }
      expect(warned).toBe(true);
      expect(result).toBe(dodge ? 'cometmiss' : 'comethit');
    }
  });
});

describe('handling (section 12.2)', () => {
  it('tyre model: a big slide saturates the grip and recovers within about a second', () => {
    const { g, s } = race();
    const k = s.humans[0]!;
    g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
    // throw the car sideways at speed: 30 m/s forward, 18 m/s sideways
    const fx = Math.sin(k.h),
      fz = Math.cos(k.h);
    k.vx = fx * 30 - fz * 18;
    k.vz = fz * 30 + fx * 18;
    const lat = (): number => Math.abs(k.vx * -fz + k.vz * fx);
    g.step(STEP);
    const after1 = lat();
    // grip is capped near the peak: one step removes well under the old exponential's 14%
    expect(18 - after1).toBeLessThan(18 * 0.1);
    for (let i = 0; i < 60; i++) g.step(STEP);
    expect(lat()).toBeLessThan(3);
  });

  it('the long race car collides nose-to-tail at 5 m (one centre circle would miss)', () => {
    const { g, s } = race();
    const [a, b] = s.humans as [(typeof s.humans)[0], (typeof s.humans)[0]];
    const fx = Math.sin(a.h),
      fz = Math.cos(a.h);
    b.x = a.x + fx * 5;
    b.z = a.z + fz * 5;
    b.h = a.h;
    a.vx = fx * 20;
    a.vz = fz * 20;
    b.vx = b.vz = 0;
    g.step(STEP);
    expect(Math.hypot(b.vx, b.vz)).toBeGreaterThan(1);
  });

  it('releasing a drift gives no boost any more (D76), even right as a tier is reached', () => {
    const { g, s } = race();
    const k = s.humans[0]!;
    k.drifting = true;
    k.driftDir = 1;
    k.driftLevel = 2;
    k.driftT = 2.05;
    g.setInput(0, { steer: 1, throttle: true, brake: false, drift: false });
    g.step(STEP);
    const ev = g.drainEvents();
    expect(ev.some((e) => e.type === 'driftperfect' || e.type === 'boost')).toBe(false);
    expect(k.boost).toBe(0);
    expect(k.drifting).toBe(false);
  });
});

describe('AI difficulty (section 12.5)', () => {
  it('on Sepang, Hard < Normal < Easy with at least 3% between levels', () => {
    const lap = (diff: Difficulty): number => {
      const laps: number[] = [];
      for (const seed of [1, 2, 3]) {
        const g = createGame({
          seed,
          humans: [],
          aiFill: true,
          laps: 2,
          difficulty: diff,
          itemsOn: false,
          track: getTrack('sepang'),
          raceEndGrace: 1e9,
        });
        g.startCountdown();
        const s = g.getSnapshot();
        for (let i = 0; i < 60 * 400 && !s.karts.every((k) => k.finished); i++) g.step(STEP);
        for (const k of s.karts) laps.push(...k.lapTimes);
      }
      return median(laps);
    };
    const e = lap('easy'),
      n = lap('normal'),
      h = lap('hard');
    expect(e / n - 1).toBeGreaterThan(0.03);
    expect(n / h - 1).toBeGreaterThan(0.03);
  }, 120000);
});
