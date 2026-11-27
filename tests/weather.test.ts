/** D71 weather: the roll, puddle placement, rain and snow grip, puddle splashes, and replays in the rain. */
import { describe, expect, it } from 'vitest';
import {
  ARENA_IDS,
  PUDDLE_WET,
  ReplayLog,
  ReplaySim,
  STEP,
  TRACKS,
  TRACK_IDS,
  WEATHERS,
  createGame,
  getTrack,
  puddlesFor,
  rollWeather,
  weatherAllowed,
  type GameOptions,
  type TrackId,
  type Weather,
} from '@tk/shared';

const ALL = Object.keys(TRACKS) as TrackId[];

function race(
  track: TrackId,
  weather: Weather,
  seed: number,
  laps = 1,
): { time: number; unfinished: number; splashes: number } {
  const g = createGame({
    seed,
    humans: [],
    aiFill: true,
    laps,
    difficulty: 'normal',
    itemsOn: false,
    track: getTrack(track),
    weather,
    raceEndGrace: 1e9,
  });
  g.startCountdown();
  const s = g.getSnapshot();
  let splashes = 0;
  for (let n = 0; n < 60 * 240 && !s.karts.every((k) => k.finished); n++) {
    g.step(STEP);
    for (const e of g.drainEvents()) if (e.type === 'splash') splashes++;
  }
  const done = s.karts.filter((k) => k.finished);
  return {
    time: done.reduce((a, k) => a + k.finishTime, 0) / Math.max(1, done.length),
    unfinished: s.karts.length - done.length,
    splashes,
  };
}

describe('weather (D71)', () => {
  it('a fixed sky is kept; snow only falls on the frosty themes (rain elsewhere); Random follows the seed', () => {
    expect(rollWeather('night', 'meadows', 1)).toBe('night');
    expect(rollWeather('snow', 'frosty', 1)).toBe('snow');
    expect(rollWeather('snow', 'arena-ice', 1)).toBe('snow');
    expect(rollWeather('snow', 'sepang', 1)).toBe('rain');
    for (const id of ALL) {
      const seen = new Set<Weather>();
      for (let seed = 0; seed < 300; seed++) {
        const w = rollWeather('random', id, seed);
        expect(w).toBe(rollWeather('random', id, seed));
        expect(weatherAllowed(id, w)).toBe(true);
        seen.add(w);
      }
      // every allowed sky comes up
      expect(seen.size, id).toBe(WEATHERS.filter((w) => weatherAllowed(id, w)).length);
    }
  });

  it('puddles sit on the road, clear of the start, jumps and crests, the same every time', () => {
    for (const id of ALL) {
      const T = getTrack(id),
        P = puddlesFor(T);
      expect(P.length, id).toBeGreaterThanOrEqual(4);
      expect(puddlesFor(T)).toEqual(P);
      for (const p of P) {
        expect(Math.abs(p.lat) + p.r, id).toBeLessThanOrEqual(T.HW[p.i]!);
        expect(T.airZone[p.i], id).toBe(false);
        if (!(ARENA_IDS as readonly string[]).includes(id)) expect(p.i).toBeGreaterThanOrEqual(50);
      }
    }
    // only a rainy race has them
    const opts = (weather: Weather): GameOptions => ({
      seed: 1,
      humans: [],
      aiFill: true,
      laps: 1,
      difficulty: 'normal',
      itemsOn: false,
      track: getTrack('meadows'),
      weather,
    });
    expect(createGame(opts('rain')).getSnapshot().puddles.length).toBeGreaterThan(0);
    expect(createGame(opts('day')).getSnapshot().puddles).toEqual([]);
    expect(createGame(opts('snow')).getSnapshot().puddles).toEqual([]);
  });

  it('driving through a puddle splashes, wets the tyres and nudges the kart sideways', () => {
    const g = createGame({
      seed: 3,
      humans: [{ slot: 0, ci: 0 }],
      aiFill: false,
      laps: 1,
      difficulty: 'normal',
      itemsOn: false,
      track: getTrack('meadows'),
      weather: 'rain',
    });
    g.startCountdown();
    const s = g.getSnapshot(),
      T = s.track,
      k = s.humans[0]!,
      p = s.puddles[0]!;
    for (let i = 0; i < 60 * 4; i++) g.step(STEP);
    g.drainEvents();
    // line the kart up 12 m before the puddle's centre, straight down the road at speed
    const i0 = (p.i - Math.round(12 / T.DS) + T.N) % T.N;
    k.x = k.px = T.CX[i0]! + T.RX[i0]! * p.lat;
    k.z = k.pz = T.CZ[i0]! + T.RZ[i0]! * p.lat;
    k.h = k.ph = T.ANG[i0]!;
    k.vx = Math.sin(k.h) * 35;
    k.vz = Math.cos(k.h) * 35;
    k.idx = k.lastIdx = i0;
    k.input = { steer: 0, throttle: true, brake: false, drift: false, item: false, itemBack: false };
    let splash = false,
      wetSeen = 0;
    for (let n = 0; n < 40 && !splash; n++) {
      g.step(STEP);
      splash = g.drainEvents().some((e) => e.type === 'splash' && e.kart === k.id);
      wetSeen = Math.max(wetSeen, k.wet);
    }
    expect(splash).toBe(true);
    expect(wetSeen).toBeGreaterThan(PUDDLE_WET - 0.05);
    // the nudge: the kart now slides sideways a little
    const lat = Math.abs(k.vx * T.RX[k.idx]! + k.vz * T.RZ[k.idx]!);
    expect(lat).toBeGreaterThan(0.3);
    // and it dries off
    for (let n = 0; n < 60; n++) g.step(STEP);
    expect(k.wet).toBeLessThanOrEqual(0);
  });

  it('AI races in rain and snow finish everywhere, a little slower than in the dry, never far slower', () => {
    const avg = (id: TrackId, w: Weather): { time: number; unfinished: number; splashes: number } => {
      const r = [4, 5, 6].map((seed) => race(id, w, seed));
      return {
        time: r.reduce((a, x) => a + x.time, 0) / r.length,
        unfinished: r.reduce((a, x) => a + x.unfinished, 0),
        splashes: r.reduce((a, x) => a + x.splashes, 0),
      };
    };
    for (const id of TRACK_IDS) {
      const dry = avg(id, 'day'),
        wet = avg(id, 'rain');
      expect(wet.unfinished, id).toBe(0);
      expect(wet.splashes, id).toBeGreaterThan(0);
      // about the same lap (grip, puddles, against the traffic noise of three races), never more than 6% slower
      expect(wet.time / dry.time, id).toBeLessThan(1.06);
      expect(wet.time / dry.time, id).toBeGreaterThan(0.98);
    }
    const snow = race('frosty', 'snow', 4);
    expect(snow.unfinished).toBe(0);
    expect(snow.splashes).toBe(0);
  }, 120_000);

  it('a rainy race replays exactly (puddle twitches included)', () => {
    const o: GameOptions = {
      seed: 21,
      humans: [{ slot: 0, ci: 2 }],
      aiFill: true,
      laps: 1,
      difficulty: 'hard',
      itemsOn: true,
      track: getTrack('sepang'),
      weather: 'rain',
      raceEndGrace: 1e9,
    };
    const g = createGame(o);
    const log = new ReplayLog();
    log.attach(g);
    g.setHumanAi(0, true);
    g.startCountdown();
    const s = g.getSnapshot();
    for (let n = 0; n < 60 * 50; n++) g.step(STEP);
    const sim = new ReplaySim(o, log);
    sim.seek(log.steps);
    const r = sim.game.getSnapshot();
    for (const k of s.karts) {
      const q = r.karts[k.id]!;
      expect([q.x, q.z, q.wet]).toEqual([k.x, k.z, k.wet]);
    }
  });
});
