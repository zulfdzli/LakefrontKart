import { describe, expect, it } from 'vitest';
import { createGame, DEFAULT_HANDLING, Game, STEP, type GameOptions, type GameEvent } from '@tk/shared';

const base = (o: Partial<GameOptions> = {}): GameOptions => ({
  seed: 7,
  humans: [],
  aiFill: true,
  laps: 3,
  difficulty: 'normal',
  itemsOn: true,
  ...o,
});

/** Step until the predicate holds or the time budget runs out. Returns collected events. */
function runUntil(g: Game, pred: () => boolean, maxSeconds: number, each?: (stepNo: number) => void): GameEvent[] {
  const events: GameEvent[] = [];
  for (let i = 0; i < maxSeconds * 60; i++) {
    each?.(i);
    g.step(STEP);
    events.push(...g.drainEvents());
    if (pred()) break;
  }
  return events;
}

const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

describe('race setup', () => {
  it('fills to 6 karts with AI, humans first in join order with their own characters', () => {
    const g = createGame(
      base({
        humans: [
          { slot: 2, ci: 4 },
          { slot: 0, ci: 1 },
        ],
      }),
    );
    const s = g.getSnapshot();
    expect(s.karts).toHaveLength(6);
    expect(s.humans.map((h) => h.slot)).toEqual([2, 0]);
    expect(s.humans.map((h) => h.ci)).toEqual([4, 1]);
    expect(new Set(s.karts.map((k) => k.ci)).size).toBe(6);
    expect(s.karts.slice(2).every((k) => k.slot === null && k.ai)).toBe(true);
  });

  it('races only the humans when AI fill is off', () => {
    const g = createGame(
      base({
        aiFill: false,
        humans: [
          { slot: 0, ci: 0 },
          { slot: 1, ci: 1 },
        ],
      }),
    );
    expect(g.getSnapshot().karts).toHaveLength(2);
  });

  it('rejects two humans with the same character', () => {
    expect(() =>
      createGame(
        base({
          humans: [
            { slot: 0, ci: 1 },
            { slot: 1, ci: 1 },
          ],
        }),
      ),
    ).toThrow();
  });

  it('starts humans at the back of the grid by default, P1 frontmost of them', () => {
    const g = createGame(
      base({
        humans: [
          { slot: 0, ci: 0 },
          { slot: 1, ci: 1 },
        ],
      }),
    );
    const [p1, p2, ...ai] = g.getSnapshot().karts;
    expect(p1!.prog).toBeGreaterThan(p2!.prog - 1e-9); // same row or ahead
    for (const a of ai) expect(a.prog).toBeGreaterThan(p1!.prog - 1e-9);
  });
});

describe('determinism', () => {
  const script = (g: Game) => (i: number) => {
    // two humans with scripted, time-varying inputs
    g.setInput(0, {
      steer: Math.sin(i / 50),
      throttle: true,
      brake: i % 400 < 20,
      drift: i % 300 > 200,
      item: i % 500 === 0 ? 'forward' : null,
    });
    g.setInput(1, {
      steer: Math.cos(i / 70),
      throttle: i % 900 > 30,
      brake: false,
      drift: false,
      item: i % 777 === 0 ? 'back' : null,
    });
  };
  const run = (seed: number) => {
    const g = createGame(
      base({
        seed,
        humans: [
          { slot: 0, ci: 0 },
          { slot: 1, ci: 3 },
        ],
      }),
    );
    g.startCountdown();
    runUntil(g, () => false, 60, script(g));
    return g.getSnapshot().karts.map((k) => [k.x, k.z, k.h, k.sp, k.lap, k.item, k.rank]);
  };

  it('same seed and same inputs give identical results', () => {
    expect(run(11)).toEqual(run(11));
  });
  it('a different seed gives a different race', () => {
    expect(run(11)).not.toEqual(run(12));
  });
});

describe('input routing', () => {
  it('each slot drives only its own kart', () => {
    const g = createGame(
      base({
        itemsOn: false,
        humans: [
          { slot: 0, ci: 0 },
          { slot: 3, ci: 1 },
          { slot: 4, ci: 2 },
        ],
      }),
    );
    g.startCountdown();
    const s = g.getSnapshot();
    const start = s.humans.map((h) => h.prog);
    runUntil(
      g,
      () => false,
      15,
      () => {
        g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
        g.setInput(3, { steer: 0, throttle: false, brake: false, drift: false }); // stays put
        g.setInput(4, { steer: 0, throttle: true, brake: false, drift: false });
      },
    );
    expect(s.humans[0]!.prog - start[0]!).toBeGreaterThan(20);
    expect(Math.abs(s.humans[1]!.prog - start[1]!)).toBeLessThan(0.5);
    expect(s.humans[2]!.prog - start[2]!).toBeGreaterThan(20);
  });

  it('an item press is used exactly once', () => {
    const g = createGame(base({ humans: [{ slot: 0, ci: 0 }] }));
    g.startCountdown();
    const k = g.getSnapshot().humans[0]!;
    runUntil(g, () => g.getSnapshot().phase === 'race', 10);
    k.item = 'turbo3';
    k.itemUses = 3;
    g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false, item: 'forward' });
    const ev = runUntil(g, () => false, 1);
    expect(ev.filter((e) => e.type === 'useturbo')).toHaveLength(1);
    expect(k.itemUses).toBe(2);
  });
});

describe('AI takeover', () => {
  it('a disconnected human is driven by the AI and finishes', () => {
    const g = createGame(base({ laps: 1, itemsOn: false, humans: [{ slot: 0, ci: 0 }] }));
    g.startCountdown();
    const k = g.getSnapshot().humans[0]!;
    runUntil(g, () => false, 10); // no input: sits on the grid
    expect(k.lap).toBe(0);
    g.setHumanAi(0, true);
    runUntil(g, () => k.finished, 120);
    expect(k.finished).toBe(true);
  });
});

describe('race end rules (section 6.4)', () => {
  it('ends when every human has finished', () => {
    const g = createGame(base({ laps: 1, humans: [{ slot: 0, ci: 0 }] }));
    g.setHumanAi(0, true);
    g.startCountdown();
    const s = g.getSnapshot();
    const ev = runUntil(g, () => s.phase === 'finished', 200);
    expect(s.phase).toBe('finished');
    expect(s.humans[0]!.finished).toBe(true);
    expect(s.raceTime).toBeCloseTo(s.humans[0]!.finishTime, 5);
    expect(ev.some((e) => e.type === 'raceover')).toBe(true);
    expect(s.standings).toHaveLength(6);
  });

  it('ends 30 s after the first human finishes when another human is still racing', () => {
    const g = createGame(
      base({
        laps: 1,
        humans: [
          { slot: 0, ci: 0 },
          { slot: 1, ci: 1 },
        ],
      }),
    );
    g.setHumanAi(0, true); // slot 1 never presses anything
    g.startCountdown();
    const s = g.getSnapshot();
    runUntil(g, () => s.phase === 'finished', 300);
    expect(s.phase).toBe('finished');
    expect(s.humans[1]!.finished).toBe(false);
    expect(s.raceTime - s.humans[0]!.finishTime).toBeCloseTo(30, 1);
    // unfinished karts are ranked by progress, after every finisher
    const st = s.standings!;
    const firstUnfinished = st.findIndex((k) => !k.finished);
    expect(st.slice(firstUnfinished).every((k) => !k.finished)).toBe(true);
  });
});

describe('lap counting', () => {
  it('counts forwards and un-counts backwards across the line', () => {
    const g = createGame(base({ itemsOn: false, humans: [{ slot: 0, ci: 0 }] }));
    g.startCountdown();
    const s = g.getSnapshot();
    const k = s.humans[0]!;
    runUntil(g, () => s.phase === 'race', 10);
    const forward = () => g.setInput(0, { steer: 0, throttle: true, brake: false, drift: false });
    runUntil(g, () => k.lap === 1, 10, forward); // grid is just behind the line
    expect(k.lap).toBe(1);
    // reverse back over the line
    runUntil(
      g,
      () => k.lap === 0,
      30,
      () => g.setInput(0, { steer: 0, throttle: false, brake: true, drift: false }),
    );
    expect(k.lap).toBe(0);
  });
});

describe('rocket start', () => {
  const at = (pressAtCd: number) => {
    const g = createGame(base({ humans: [{ slot: 0, ci: 0 }] }));
    g.startCountdown();
    const s = g.getSnapshot();
    return runUntil(
      g,
      () => s.raceTime > 0.5,
      10,
      () =>
        g.setInput(0, { steer: 0, throttle: true, brake: false, drift: s.phase === 'countdown' && s.cd <= pressAtCd }),
    );
  };
  // D76: the user removed the start boost: pressing DRIFT at the lights does nothing either way
  it('pressing DRIFT just before GO no longer gives a rocket start (D76)', () => {
    const ev = at(0.2);
    expect(ev.some((e) => e.type === 'perfect' && e.kart === 0)).toBe(false);
    expect(ev.some((e) => e.type === 'boost' && e.kart === 0)).toBe(false);
  });
  it('pressing too early no longer stalls (D76)', () => {
    expect(at(1.5).some((e) => e.type === 'stall' && e.kart === 0)).toBe(false);
  });
});

describe('AI bots (D82)', () => {
  it('a race of 8 karts (1 player, 7 AI, characters repeating) runs and finishes', () => {
    const g = createGame(base({ itemsOn: true, humans: [{ slot: 0, ci: 0 }], totalKarts: 8 }));
    g.setHumanAi(0, true);
    g.startCountdown();
    const s = g.getSnapshot();
    expect(s.karts).toHaveLength(8);
    runUntil(g, () => s.karts.every((k) => k.finished), 400);
    expect(s.karts.every((k) => k.finished)).toBe(true);
  });
});

describe('rescue', () => {
  it('a stuck kart is rescued back onto the centreline', () => {
    const g = createGame(base({ itemsOn: false, humans: [{ slot: 0, ci: 0 }] }));
    g.startCountdown();
    const k = g.getSnapshot().humans[0]!;
    // throttle and brake together: wants to go, cannot move
    const ev = runUntil(
      g,
      () => k.rescue <= 0 && k.invuln > 0,
      20,
      () => g.setInput(0, { steer: 0, throttle: true, brake: true, drift: false }),
    );
    expect(ev.some((e) => e.type === 'rescue' && e.kart === 0)).toBe(true);
    expect(Math.abs(k.lat)).toBeLessThan(1);
  });
});

describe('headless race (prototype track)', () => {
  // 37-43 s at speedMul 1.3 (D36, D43); laps shorten in proportion when D62 raises the speed. D65's grip, steeper
  // slope pull and slingshot make this hilly test track about 5% quicker again, so the lower bound is 33 (was 36)
  const r = 1.3 / DEFAULT_HANDLING.speedMul;
  it(`6 AI karts all finish with laps of about ${(34 * r).toFixed(0)}-${(43 * r).toFixed(0)} s (D36, D43, D62, D65)`, () => {
    const laps: number[] = [];
    for (const seed of [1, 2, 3]) {
      const g = createGame(base({ seed, itemsOn: false }));
      g.startCountdown();
      const s = g.getSnapshot();
      runUntil(g, () => s.phase === 'finished', 400);
      expect(s.karts.every((k) => k.finished)).toBe(true);
      for (const k of s.karts) laps.push(...k.lapTimes);
    }
    expect(median(laps)).toBeGreaterThan(33 * r);
    expect(median(laps)).toBeLessThan(44 * r);
  });
});
