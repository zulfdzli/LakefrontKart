/** D69 Bumper Brawl: lives, knockouts, rams, sudden death, round end, and AI rounds in every arena. */
import { describe, expect, it } from 'vitest';
import {
  ARENA_IDS,
  BRAWL_LIVES,
  BRAWL_LIMIT,
  BRAWL_SUDDEN,
  STEP,
  createGame,
  getTrack,
  type GameOptions,
  type Kart,
} from '@tk/shared';

function brawl(extra: Partial<GameOptions> = {}) {
  const g = createGame({
    seed: 3,
    mode: 'brawl',
    humans: [
      { slot: 0, ci: 0 },
      { slot: 1, ci: 1 },
    ],
    aiFill: true,
    laps: 1,
    difficulty: 'normal',
    itemsOn: true,
    track: getTrack('arena-meadow'),
    ...extra,
  });
  g.startCountdown();
  const s = g.getSnapshot();
  for (let i = 0; i < 60 * 4; i++) g.step(STEP);
  g.drainEvents();
  return { g, s };
}
const clear = (k: Kart): void => {
  k.invuln = 0;
  k.spin = 0;
  k.shield = 0;
};

describe('Bumper Brawl (D69)', () => {
  it('every kart starts with its lives, spread round the arena; hits cost lives and the last one knocks out', () => {
    const { g, s } = brawl();
    expect(s.karts.every((k) => k.lives === BRAWL_LIVES)).toBe(true);
    const idx = new Set(s.karts.map((k) => Math.round(k.idx / 10)));
    expect(idx.size).toBe(s.karts.length);
    const k = s.humans[0]!;
    for (let n = 0; n < BRAWL_LIVES; n++) {
      clear(k);
      expect(g.spinOut(k)).toBe(true);
    }
    expect(k.lives).toBe(0);
    expect(k.out).toBe(true);
    expect(k.finished).toBe(true);
    const ev = g.drainEvents().map((e) => e.type);
    expect(ev.filter((t) => t === 'lifelost')).toHaveLength(BRAWL_LIVES);
    expect(ev).toContain('ko');
    // out of the round: frozen in place, and nothing can hit it any more
    const x = k.x;
    for (let i = 0; i < 30; i++) g.step(STEP);
    expect(k.x).toBe(x);
    clear(k);
    expect(g.spinOut(k)).toBe(false);
    expect(g.updateRanks().at(-1)).toBe(k);
  });

  it('a boosted ram knocks a life off the rammed kart and steals it', () => {
    const { g, s } = brawl();
    const [a, b] = s.humans as [Kart, Kart];
    const T = s.track,
      i = 20;
    a.lives = 2;
    for (const [k, lat, v] of [
      [a, 0, 30],
      [b, 0, 0],
    ] as const) {
      clear(k);
      k.x = k.px = T.CX[(i + (k === b ? 2 : 0)) % T.N]! + T.RX[i]! * lat;
      k.z = k.pz = T.CZ[(i + (k === b ? 2 : 0)) % T.N]! + T.RZ[i]! * lat;
      k.h = T.ANG[i]!;
      k.vx = Math.sin(k.h) * v;
      k.vz = Math.cos(k.h) * v;
    }
    a.boost = 1;
    b.boost = 0;
    const types: string[] = [];
    for (let n = 0; n < 20 && !types.includes('steal'); n++) {
      g.step(STEP);
      types.push(...g.drainEvents().map((e) => e.type));
    }
    expect(types).toContain('steal');
    expect(b.lives).toBe(BRAWL_LIVES - 1);
    expect(a.lives).toBe(3);
  });

  it('sudden death drops everyone to one life; the round ends when the players are out, with ranks by survival', () => {
    const { g, s } = brawl();
    // fast-forward the clock to sudden death
    (s as { raceTime: number }).raceTime = BRAWL_SUDDEN;
    g.step(STEP);
    expect(s.suddenDeath).toBe(true);
    expect(s.karts.every((k) => k.out || k.lives === 1)).toBe(true);
    for (const h of s.humans) {
      clear(h);
      g.spinOut(h);
    }
    g.step(STEP);
    expect(s.phase).toBe('finished');
    const order = s.standings!;
    // AI karts still in rank above the knocked-out players
    expect(order.slice(0, order.length - 2).every((k) => !k.out)).toBe(true);
  });

  it('the last kart standing cannot be knocked out (two going down at once leaves a winner) (D80)', () => {
    const { g, s } = brawl();
    const [a, b] = s.humans as [Kart, Kart];
    for (const k of s.karts)
      if (k !== a && k !== b) {
        k.out = true;
        k.finished = true;
      }
    a.lives = b.lives = 1;
    clear(a);
    clear(b);
    expect(g.spinOut(a)).toBe(true);
    expect(a.out).toBe(true);
    clear(b);
    g.spinOut(b);
    expect(b.out).toBe(false);
    expect(b.lives).toBe(1);
  });

  it('AI brawls play out in every arena: knockouts, a result inside the time limit, no karts stuck', () => {
    for (const id of ARENA_IDS) {
      for (const seed of [1, 2]) {
        const g = createGame({
          seed,
          mode: 'brawl',
          humans: [],
          aiFill: true,
          laps: 1,
          difficulty: 'normal',
          itemsOn: true,
          track: getTrack(id),
        });
        g.startCountdown();
        const s = g.getSnapshot();
        let rescues = 0,
          kos = 0;
        for (let n = 0; n < 60 * (BRAWL_LIMIT + 10) && s.phase !== 'finished'; n++) {
          g.step(STEP);
          for (const e of g.drainEvents()) {
            if (e.type === 'rescue') rescues++;
            if (e.type === 'ko') kos++;
          }
        }
        expect(s.phase, id).toBe('finished');
        expect(s.raceTime).toBeLessThanOrEqual(BRAWL_LIMIT + 0.1);
        expect(kos, id).toBeGreaterThanOrEqual(2);
        expect(rescues, id).toBeLessThanOrEqual(3);
      }
    }
  });
});
