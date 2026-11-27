/** D83 fun zones: where they go, the slalom (gates, cones), the jump target, the draft tunnel, and exact replays. */
import { describe, expect, it } from 'vitest';
import {
  ARENA_IDS,
  ReplayLog,
  ReplaySim,
  SLALOM_HALF,
  STEP,
  TRACK_IDS,
  createGame,
  getTrack,
  planZones,
  posOnTrack,
  stepZones,
  type GameEvent,
  type GameOptions,
  type GameState,
  type Kart,
  type TrackId,
} from '@tk/shared';

const opts = (track: TrackId, extra: Partial<GameOptions> = {}): GameOptions => ({
  seed: 5,
  humans: [{ slot: 0, ci: 1 }],
  aiFill: false,
  laps: 2,
  difficulty: 'normal',
  itemsOn: true,
  moves: true,
  zones: true,
  track: getTrack(track),
  raceEndGrace: 1e9,
  ...extra,
});

/** A race state with one kart, racing, and a zone step that records its events and free items. */
function rig(track: TrackId = 'meadows', extra: Partial<GameOptions> = {}) {
  const g = createGame(opts(track, extra));
  const s = g.getSnapshot() as GameState;
  s.phase = 'race';
  const k = s.karts[0]!;
  const events: GameEvent[] = [];
  let items = 0;
  const hooks = { emit: (e: GameEvent) => events.push(e), giveItem: () => void items++ };
  /** Put the kart at a sample and lateral position, then run one zone step. */
  const at = (idx: number, lat: number, o: Partial<Kart> = {}): void => {
    const T = s.track,
      p = { x: 0, y: 0, z: 0 };
    k.idx = ((idx % T.N) + T.N) % T.N;
    k.lat = lat;
    posOnTrack(T, k.idx, lat, p);
    k.x = p.x;
    k.z = p.z;
    k.y = p.y;
    Object.assign(k, o);
    stepZones(s, STEP, hooks);
  };
  return { g, s, k, events, at, items: () => items };
}

describe('fun zones: placement', () => {
  it('every race track has a slalom, a jump target and a draft tunnel; arenas have none', () => {
    for (const id of TRACK_IDS) {
      const z = planZones(getTrack(id));
      expect(z?.slalom, id).toBeTruthy();
      expect(z?.target, id).toBeTruthy();
      expect(z?.tunnel, id).toBeTruthy();
    }
    for (const id of ARENA_IDS) expect(planZones(getTrack(id))).toBeNull();
  });

  it('they keep clear of the start, each other, the jumps (but the target) and the item rows (the slalom)', () => {
    for (const id of TRACK_IDS) {
      const T = getTrack(id),
        N = T.N,
        z = planZones(T)!;
      const sl = z.slalom!,
        tu = z.tunnel!,
        tg = z.target!;
      const span = (a: number, b: number): number[] => {
        const out: number[] = [];
        for (let i = a; i <= b; i++) out.push(((i % N) + N) % N);
        return out;
      };
      const slS = span(sl.gates[0]!.idx - 6, sl.gates[sl.gates.length - 1]!.idx + 4);
      const tuS = span(tu.i0, tu.i1);
      const tgS = span(tg.idx - 3, tg.idx + 3);
      for (const [a, b] of [
        [slS, tuS],
        [slS, tgS],
        [tuS, tgS],
      ] as const)
        expect(
          a.some((i) => b.includes(i)),
          id,
        ).toBe(false);
      for (const i of [...slS, ...tuS]) {
        const f = i / N;
        expect(f > 0.07 && f < 0.96, `${id} ${f}`).toBe(true);
        for (const r of T.ramps) expect((i - r.i0 + N) % N > (r.i1 - r.i0 + N) % N, `${id} ramp`).toBe(true);
      }
      for (const r of T.boxRows) expect(slS.includes(r), `${id} row`).toBe(false);
      // gates inside the road, alternating sides; the target past the launch ramp's lip
      sl.gates.forEach((g, j) => {
        expect(Math.abs(g.lat) + SLALOM_HALF).toBeLessThan(T.HW[g.idx]!);
        if (j) expect(Math.sign(g.lat)).toBe(-Math.sign(sl.gates[j - 1]!.lat));
      });
      const past = ((tg.idx - tg.lip + N) % N) * T.DS;
      expect(past, id).toBeGreaterThan(20);
      expect(past, id).toBeLessThan(70);
      expect(T.ramps.find((r) => r.i1 === tg.lip)?.kind).toBe('launch');
    }
  });

  it('are off unless asked for, and only in a race', () => {
    expect(createGame(opts('meadows', { zones: false })).getSnapshot().zones).toBeNull();
    expect(createGame(opts('arena-meadow', { mode: 'brawl', aiFill: true })).getSnapshot().zones).toBeNull();
    expect(createGame(opts('meadows')).getSnapshot().zones).not.toBeNull();
  });
});

describe('fun zones: the slalom', () => {
  it('every gate in order, through the gap: a free item', () => {
    const r = rig();
    const sl = r.s.zones!.slalom!;
    for (const g of sl.gates) {
      r.at(g.idx - 2, g.lat);
      r.at(g.idx, g.lat);
    }
    expect(r.events.filter((e) => e.type === 'zone').map((e) => [e.n, e.lvl])).toEqual([[0, 1]]);
    expect(r.items()).toBe(1);
  });

  it('holding an item already: a lift on the MOVE meter instead', () => {
    const r = rig();
    r.k.item = 'oil';
    const sl = r.s.zones!.slalom!;
    for (const g of sl.gates) {
      r.at(g.idx - 2, g.lat);
      r.at(g.idx, g.lat);
    }
    expect(r.events.find((e) => e.type === 'zone')?.lvl).toBe(2);
    expect(r.k.meter).toBeGreaterThan(0.25);
    expect(r.items()).toBe(0);
  });

  it('a gate missed spoils the run (and says so)', () => {
    const r = rig();
    const sl = r.s.zones!.slalom!;
    sl.gates.forEach((g, j) => {
      const lat = j === 2 ? -g.lat : g.lat;
      r.at(g.idx - 2, lat);
      r.at(g.idx, lat);
    });
    expect(r.events.some((e) => e.type === 'zone')).toBe(false);
    expect(r.events.some((e) => e.type === 'zonemiss' && e.n === 0)).toBe(true);
  });

  it('a cone touched is knocked over (a little speed lost, the run spoilt) and stands up again', () => {
    const r = rig();
    const sl = r.s.zones!.slalom!;
    const g = sl.gates[1]!;
    r.at(sl.gates[0]!.idx - 2, sl.gates[0]!.lat);
    r.at(sl.gates[0]!.idx, sl.gates[0]!.lat);
    const c = sl.cones[2]!;
    r.k.vx = 0;
    r.k.vz = 30;
    r.at(c.idx - 1, c.lat, { vx: 0, vz: 30 });
    // straight onto the cone
    r.k.x = c.x;
    r.k.z = c.z;
    stepZones(r.s, STEP, { emit: (e) => r.events.push(e), giveItem: () => undefined });
    expect(c.down).toBeGreaterThanOrEqual(0);
    expect(r.k.vz).toBeLessThan(30);
    expect(r.events.some((e) => e.type === 'cone')).toBe(true);
    r.at(g.idx, g.lat);
    expect(r.k.zGate).toBe(1);
    for (let t = 0; t < 4 / STEP; t++) stepZones(r.s, STEP, { emit: () => undefined, giveItem: () => undefined });
    expect(c.down).toBe(-1);
  });
});

describe('fun zones: the jump target', () => {
  it('off the launch ramp and onto the bullseye: a free item; wide of it: so close', () => {
    for (const [lat, won] of [
      [0, true],
      [6, false],
    ] as const) {
      const r = rig('canyon');
      const tg = r.s.zones!.target!;
      r.at(tg.lip - 1, tg.lat, { air: false });
      r.at(tg.lip + 2, tg.lat, { air: true });
      r.at(tg.idx, tg.lat + lat, { air: false });
      expect(r.events.some((e) => e.type === 'zone' && e.n === 1)).toBe(won);
      expect(r.events.some((e) => e.type === 'zonemiss' && e.n === 1)).toBe(!won);
    }
  });

  it('a jump from anywhere else does not count', () => {
    const r = rig('canyon');
    const tg = r.s.zones!.target!;
    r.at(tg.lip - 40, tg.lat, { air: false });
    r.at(tg.lip - 39, tg.lat, { air: true });
    r.at(tg.idx, tg.lat, { air: false });
    expect(r.events.some((e) => e.type === 'zone')).toBe(false);
  });
});

describe('fun zones: the draft tunnel', () => {
  it('places gained inside it are worth MOVE meter', () => {
    const r = rig('frosty');
    const tu = r.s.zones!.tunnel!;
    r.k.rank = 4;
    r.at(tu.i0 - 1, 0);
    r.at(tu.i0 + 1, 0);
    r.k.rank = 2;
    r.k.meter = 0;
    r.at(tu.i1 - 1, 0);
    r.at(tu.i1 + 2, 0);
    const e = r.events.find((x) => x.type === 'zone');
    expect([e?.n, e?.power, e?.lvl]).toEqual([2, 2, 2]);
    expect(r.k.meter).toBeGreaterThan(0.2);
  });

  it('the slipstream charges twice as fast inside it', () => {
    const charge = (inside: boolean): number => {
      const g = createGame(
        opts('frosty', {
          humans: [
            { slot: 0, ci: 1 },
            { slot: 1, ci: 2 },
          ],
        }),
      );
      const s = g.getSnapshot() as GameState;
      const tu = s.zones!.tunnel!;
      const T = s.track;
      const base = inside ? tu.i0 + 10 : tu.i0 - 80;
      s.phase = 'race';
      const p = { x: 0, y: 0, z: 0 };
      s.karts.forEach((k, i) => {
        const at = (base + (i ? 0 : 2)) % T.N;
        posOnTrack(T, at, 0, p);
        Object.assign(k, { x: p.x, z: p.z, y: p.y, h: T.ANG[at]!, idx: at, lastIdx: at, zPrev: at, lat: 0, frac: 0 });
        k.prog = k.lap * T.N + at;
        k.vx = Math.sin(k.h) * 30;
        k.vz = Math.cos(k.h) * 30;
        k.input = { ...k.input, throttle: true };
      });
      for (let n = 0; n < 20; n++) g.step(STEP);
      return s.karts[1]!.draft;
    };
    expect(charge(true)).toBeGreaterThan(charge(false) * 1.6);
  });
});

describe('fun zones: the race', () => {
  it('the AI does them in a full race, and the replay is exact', () => {
    const o = opts('canyon', { aiFill: true, seed: 3 });
    const g = createGame(o);
    const log = new ReplayLog();
    log.attach(g);
    g.setHumanAi(0, true);
    g.startCountdown();
    const got = new Set<number>();
    for (let n = 0; n < 60 * 200; n++) {
      g.step(STEP);
      for (const e of g.drainEvents()) if (e.type === 'zone') got.add(e.n ?? -1);
    }
    expect([...got].sort()).toEqual([0, 1, 2]);
    const sim = new ReplaySim(o, log);
    sim.seek(log.steps);
    const r = sim.game.getSnapshot();
    expect(r.karts.map((k) => [k.x, k.z, k.item, k.meter])).toEqual(
      g.getSnapshot().karts.map((k) => [k.x, k.z, k.item, k.meter]),
    );
    expect(JSON.stringify(r.zones)).toBe(JSON.stringify(g.getSnapshot().zones));
  });
});
