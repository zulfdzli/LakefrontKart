/** D72 phone garage: setups are validated, tuning moves stat points (never adds any), and no tune is faster overall. */
import { describe, expect, it } from 'vitest';
import {
  CHARS,
  PAINTS,
  SLOT_COLORS,
  STEP,
  TUNE_WEIGHT,
  cleanSetup,
  createGame,
  defaultSetup,
  getTrack,
  tunedCharacter,
  type KartSetup,
  type TrackId,
  type Tune,
} from '@tk/shared';
import { RoomManager } from '../server/src/rooms';

const good = (): KartSetup => ({
  paint: 3,
  accent: 11,
  livery: 'flames',
  num: 42,
  sticker: 'bolt',
  rims: 2,
  tune: { speed: 2, accel: 0, handling: -2 },
});

describe('phone garage (D72)', () => {
  it('a player starts in their slot colour with the standard tune', () => {
    for (let slot = 0; slot < 5; slot++) {
      const d = defaultSetup(slot);
      expect(PAINTS[d.paint]).toBe(SLOT_COLORS[slot]);
      expect(d.num).toBe(slot + 1);
      expect(d.tune).toEqual({ speed: 0, accel: 0, handling: 0 });
      expect(cleanSetup(d)).toEqual(d);
    }
  });

  it('only a valid setup gets through: known values, tuning within ±2 that adds up to 0', () => {
    expect(cleanSetup(good())).toEqual(good());
    const bad: unknown[] = [
      null,
      'x',
      { ...good(), paint: 12 },
      { ...good(), paint: 1.5 },
      { ...good(), livery: 'zebra' },
      { ...good(), sticker: 'gun' },
      { ...good(), num: 100 },
      { ...good(), rims: -1 },
      { ...good(), tune: { speed: 1, accel: 0, handling: 0 } },
      { ...good(), tune: { speed: 3, accel: -3, handling: 0 } },
      { ...good(), tune: { speed: 2, accel: 0 } },
      { ...good(), tune: 'fast' },
    ];
    for (const b of bad) expect(cleanSetup(b), JSON.stringify(b)).toBeNull();
  });

  it('tuning moves stat points on a copy of the character; the kart drives with them', () => {
    const bruno = CHARS[0]!;
    const before = JSON.stringify(CHARS);
    const t = tunedCharacter(bruno, { speed: 2, accel: 0, handling: -2 });
    // D76: each tuning point moves a weighted share of a stat point (handling counts for less without boosts)
    expect(t.stats.speed).toBeCloseTo(bruno.stats.speed + 2 * TUNE_WEIGHT.speed);
    expect(t.stats.handling).toBeCloseTo(bruno.stats.handling - 2 * TUNE_WEIGHT.handling);
    expect(t.id).toBe(bruno.id);
    expect(JSON.stringify(CHARS)).toBe(before);
    expect(tunedCharacter(bruno, { speed: 0, accel: 0, handling: 0 })).toBe(bruno);
    const g = createGame({
      seed: 1,
      humans: [
        { slot: 0, ci: 0, tune: { speed: 2, accel: 0, handling: -2 } },
        { slot: 1, ci: 1 },
      ],
      aiFill: false,
      laps: 1,
      difficulty: 'normal',
      itemsOn: false,
    });
    const ref = createGame({
      seed: 1,
      humans: [
        { slot: 0, ci: 0 },
        { slot: 1, ci: 1 },
      ],
      aiFill: false,
      laps: 1,
      difficulty: 'normal',
      itemsOn: false,
    });
    const [a, b] = [g.getSnapshot().humans[0]!, ref.getSnapshot().humans[0]!];
    expect(a.P.top).toBeGreaterThan(b.P.top);
    expect(a.P.turn).toBeLessThan(b.P.turn);
    expect(a.P.acc).toBe(b.P.acc);
  });

  it('no tune is faster overall: the extremes stay within 4% of the standard kart', () => {
    const lap = (track: TrackId, tune: Tune): number => {
      const laps: number[] = [];
      for (const ci of [0, 3])
        for (const seed of [1, 2, 3]) {
          const g = createGame({
            seed,
            humans: [{ slot: 0, ci, tune }],
            aiFill: true,
            laps: 2,
            difficulty: 'normal',
            itemsOn: false,
            raceEndGrace: 1e9,
            track: getTrack(track),
          });
          g.setHumanAi(0, true);
          const k = g.getSnapshot().humans[0]!;
          k.aiCfg.skill = 0.93;
          g.startCountdown();
          for (let n = 0; n < 60 * 400 && !k.finished; n++) g.step(STEP);
          laps.push(...k.lapTimes);
        }
      // the median lap: one bad tangle in traffic does not swing it
      return laps.sort((x, y) => x - y)[laps.length >> 1]!;
    };
    for (const track of ['canyon', 'sepang'] as const) {
      const base = lap(track, { speed: 0, accel: 0, handling: 0 });
      for (const t of [
        { speed: 2, accel: 0, handling: -2 },
        { speed: -2, accel: 0, handling: 2 },
        { speed: 0, accel: -2, handling: 2 },
      ])
        expect(Math.abs(lap(track, t) / base - 1), `${track} ${JSON.stringify(t)}`).toBeLessThan(0.04);
    }
  }, 120_000);

  it('the server keeps a valid setup from the lobby only, and shows it to everyone', () => {
    const rm = new RoomManager(() => 1_000_000);
    const room = rm.createRoom('h');
    const j = rm.join(room.code, 'Ana', undefined, 's');
    if (!j.ok) throw new Error('join');
    const p = j.player;
    expect(rm.lobbyUpdate(room).players[0]!.setup).toEqual(defaultSetup(0));
    expect(rm.setSetup(room, p, good())).toBe(true);
    expect(rm.lobbyUpdate(room).players[0]!.setup).toEqual(good());
    expect(rm.setSetup(room, p, { ...good(), tune: { speed: 2, accel: 0, handling: 0 } })).toBe(false);
    rm.setPhase(room, 'race');
    expect(rm.setSetup(room, p, defaultSetup(0))).toBe(false);
    expect(p.setup).toEqual(good());
  });
});
