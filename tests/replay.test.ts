/** D68 highlight replay: a recorded race re-simulates exactly, and the reel picks the right moments. */
import { describe, expect, it } from 'vitest';
import {
  ReplayLog,
  ReplaySim,
  Rng,
  STEP,
  createGame,
  frameMoment,
  getTrack,
  pickMoments,
  type GameOptions,
  type Moment,
} from '@tk/shared';

const opts = (): GameOptions => ({
  seed: 77,
  humans: [
    { slot: 0, ci: 0 },
    { slot: 2, ci: 3 },
  ],
  aiFill: true,
  laps: 2,
  difficulty: 'hard',
  itemsOn: true,
  track: getTrack('canyon'),
  raceEndGrace: 1e9,
});

describe('replay (D68)', () => {
  it('re-simulates a recorded race exactly: phone inputs, items, a dropped phone and an intro before the countdown', () => {
    const o = opts();
    const g = createGame(o);
    const log = new ReplayLog();
    log.attach(g);
    const s = g.getSnapshot();
    const r = new Rng(5);
    // intro: the grid ticks along before the countdown starts
    for (let i = 0; i < 90; i++) g.step(STEP);
    g.startCountdown();
    let n = 0;
    while (n < 60 * 150) {
      // a weaving, drifting, item-firing player; the other phone drops out for a while mid-race
      if (n % 7 === 0)
        g.setInput(0, {
          steer: Math.sin(n * 0.013) * 0.8 + (r.next() - 0.5) * 0.3,
          throttle: true,
          brake: r.next() < 0.03,
          drift: Math.sin(n * 0.005) > 0.6,
          item: r.next() < 0.02 ? (r.next() < 0.7 ? 'forward' : 'back') : null,
        });
      if (n === 1200) g.setHumanAi(2, true);
      if (n === 2400) g.setHumanAi(2, false);
      if (n === 1200 || n === 2400) g.setInput(2, { steer: 0.2, throttle: true, brake: false, drift: false });
      g.step(STEP);
      g.drainEvents();
      n++;
    }
    expect(s.raceTime).toBeGreaterThan(100);
    const live = s.karts.map((k) => [k.x, k.z, k.h, k.sp, k.lap, k.finishTime, k.rank]);

    const rs = new ReplaySim(o, log);
    rs.seek(log.steps);
    const again = rs.game.getSnapshot().karts.map((k) => [k.x, k.z, k.h, k.sp, k.lap, k.finishTime, k.rank]);
    expect(again).toEqual(live);
  });

  it('picks the best non-overlapping moments in race order, two of a kind at most, a photo finish or the winner last', () => {
    const base = { kart: 0, human: true, idx: 0, lat: 0 };
    const at = (kind: Moment['kind'], sec: number, extra: Partial<Moment> = {}): Moment =>
      frameMoment({ ...base, kind, step: Math.round(sec / STEP), ...extra }, false);
    const air = at('air', 20, { air: 1.6 }),
      airSmall = at('air', 21, { air: 1.0 }), // overlaps the big one: dropped
      hit = at('hit', 40),
      pass = at('pass', 60, { human: false }),
      photo = at('photo', 120);
    const reel = pickMoments([pass, airSmall, hit, air, photo], 3);
    expect(reel.map((m) => m.kind)).toEqual(['air', 'hit', 'photo']);
    expect(reel[0]!.air).toBe(1.6);
    // without a photo finish the winner crossing the line closes the reel, in place of the weakest pick
    const fin = at('finish', 118);
    const reel2 = pickMoments([pass, air, hit], 3, fin);
    expect(reel2.map((m) => m.kind)).toEqual(['air', 'hit', 'finish']);
    // at most two of a kind: three big jumps leave room for the hit
    const airs = [at('air', 10, { air: 1.7 }), at('air', 30, { air: 1.6 }), at('air', 50, { air: 1.5 })];
    expect(pickMoments([...airs, at('hit', 70)], 3).map((m) => m.kind)).toEqual(['air', 'air', 'hit']);
    // a quiet race still gets the finish
    expect(pickMoments([], 3, fin).map((m) => m.kind)).toEqual(['finish']);
  });
});
