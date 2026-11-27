/**
 * D65 mechanics: instant items, the item guard, the slipstream slingshot, BRAKE over a boost, grip at speed, and
 * the roller-coaster track data (crests that float, dips, banking). The pacing check is in tracks.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HANDLING,
  STEP,
  createGame,
  getTrack,
  wrapA,
  type GameOptions,
  type Handling,
  type Kart,
  type Track,
  TRACK_IDS,
} from '@tk/shared';

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
    track: getTrack('meadows'),
    raceEndGrace: 1e9,
    ...extra,
  });
  g.startCountdown();
  const s = g.getSnapshot();
  for (let i = 0; i < 60 * 4; i++) g.step(STEP);
  g.drainEvents();
  return { g, s };
}

/** The flattest, straightest stretch of road: the sample in the middle of it. */
function straightest(T: Track, len = 40): number {
  let best = 0,
    bv = 1e9;
  for (let i = 0; i < T.N; i++) {
    let v = 0;
    for (let o = 0; o < len; o++) {
      const j = (i + o) % T.N;
      v += Math.abs(T.CURV[j]!) + Math.abs(T.SL[j]!) * 2 + Math.abs(T.VC[j]!) * 50;
    }
    if (v < bv) {
      bv = v;
      best = i;
    }
  }
  return (best + (len >> 1)) % T.N;
}

/** Put a kart on the road at sample i, lateral lat, moving along it at speed v. */
function put(k: Kart, T: Track, i: number, lat: number, v: number): void {
  k.x = k.px = k.gpx = T.CX[i]! + T.RX[i]! * lat;
  k.z = k.pz = k.gpz = T.CZ[i]! + T.RZ[i]! * lat;
  k.idx = k.lastIdx = i;
  k.h = T.ANG[i]!;
  k.vx = Math.sin(k.h) * v;
  k.vz = Math.cos(k.h) * v;
  k.air = false;
  k.alt = 0;
  k.prog = k.lap * T.N + i;
}

describe('items (D65)', () => {
  it('an item is ready the moment the box is hit (no roulette)', () => {
    const { g, s } = race({ itemsOn: true });
    const k = s.humans[0]!;
    const b = s.boxes[0]!;
    k.item = null;
    k.x = b.x;
    k.z = b.z;
    g.step(STEP);
    const ev = g.drainEvents().map((e) => e.type);
    expect(ev).toContain('pickup');
    expect(ev).toContain('item');
    expect(k.item).not.toBeNull();
    expect(k.roll).toBe(0);
  });

  it('a held Oil Slick soaks up an orb from behind; with nothing held the kart spins', () => {
    for (const held of ['oil', null] as const) {
      const { g, s } = race();
      const [k, other] = s.humans as [Kart, Kart];
      const T = s.track,
        i = straightest(T);
      put(k, T, i, 0, 30);
      put(other, T, (i + 60) % T.N, 0, 30);
      k.item = held;
      k.itemUses = 1;
      k.invuln = 0;
      // an orb fired by the other kart, just behind this one
      s.orbs.push({ prog: k.prog - 1, lat: 0, dir: 1, owner: other, age: 2, x: k.x, z: k.z, y: k.y, target: null });
      g.step(STEP);
      const ev = g.drainEvents().map((e) => e.type);
      if (held) {
        expect(ev).toContain('guard');
        expect(k.item).toBeNull();
        expect(k.spin).toBe(0);
      } else {
        expect(ev).toContain('orbhit');
        expect(k.spin).toBeGreaterThan(0);
      }
    }
  });
});

describe('overtaking (D65)', () => {
  it('a slipstream charges in about half a second; pulling out of it no longer fires a slingshot (D76)', () => {
    const { g, s } = race();
    const [a, b] = s.humans as [Kart, Kart];
    const T = s.track,
      i = straightest(T, 60);
    put(b, T, i, 0, 40);
    put(a, T, (i - 4 + T.N) % T.N, 0, 40);
    for (const sl of [0, 1]) g.setInput(sl, { steer: 0, throttle: true, brake: false, drift: false });
    let t = 0;
    for (; t < 60 && !a.drafting; t++) g.step(STEP);
    expect(a.drafting).toBe(true);
    expect(t * STEP).toBeLessThan(0.8);
    g.drainEvents();
    // pull out: a lane over
    put(a, T, a.idx, 5, Math.hypot(a.vx, a.vz));
    g.step(STEP);
    const ev = g.drainEvents();
    // D76: the user removed the slingshot boost; the tow (more top speed in the wake) stays
    expect(ev.some((e) => e.type === 'slingshot' && e.kart === a.id)).toBe(false);
    expect(ev.some((e) => e.type === 'boost' && e.kart === a.id)).toBe(false);
    expect(a.boost).toBe(0);
  });

  it('a rescue clears the slipstream charge: no slingshot from a standstill on the drop', () => {
    for (const how of ['rescue'] as const) {
      const { g, s } = race();
      const [a, b] = s.humans as [Kart, Kart];
      const T = s.track,
        i = straightest(T, 60);
      put(b, T, i, 0, 40);
      put(a, T, (i - 4 + T.N) % T.N, 0, 40);
      for (const sl of [0, 1]) g.setInput(sl, { steer: 0, throttle: true, brake: false, drift: false });
      for (let t = 0; t < 60 && !a.drafting; t++) g.step(STEP);
      expect(a.drafting).toBe(true);
      if (how === 'rescue') (g as unknown as { startRescue(k: Kart): void }).startRescue(a);
      const types: string[] = [];
      for (let n = 0; n < 60 * 3; n++) {
        g.step(STEP);
        for (const e of g.drainEvents()) if (e.kart === a.id) types.push(e.type);
      }
      expect(types, how).not.toContain('slingshot');
    }
  });
});

describe('handling (D65)', () => {
  it('BRAKE slows a boosting kart (the automatic throttle no longer outpulls it)', () => {
    const { g, s } = race();
    const k = s.humans[0]!;
    const T = s.track;
    put(k, T, straightest(T, 60), 0, 50);
    k.boost = 2;
    g.setInput(0, { steer: 0, throttle: true, brake: true, drift: false });
    for (let n = 0; n < 30; n++) g.step(STEP);
    expect(k.sp).toBeLessThan(40);
  });

  it('full lock at 180 km/h grips: under half the slide of the D64 handling, turning as far', () => {
    const fullLock = (handling?: Partial<Handling>): { worst: number; turned: number } => {
      const { g, s } = race(handling ? { handling: { ...DEFAULT_HANDLING, ...handling } } : {});
      const k = s.humans[0]!;
      const T = s.track;
      put(k, T, straightest(T, 60), 0, 50);
      g.setInput(0, { steer: 1, throttle: true, brake: false, drift: false });
      let worst = 0;
      const h0 = k.h;
      for (let n = 0; n < 40; n++) {
        g.step(STEP);
        worst = Math.max(worst, Math.abs(wrapA(Math.atan2(k.vx, k.vz) - k.h)));
      }
      return { worst, turned: Math.abs(wrapA(k.h - h0)) };
    };
    const now = fullLock(),
      d64 = fullLock({ yawGrip: 0, tyrePeak: 52, tyreFall: 0.88, steerExpo: 0 });
    expect(now.turned).toBeGreaterThan(0.8); // it really turns (about 50 degrees in 2/3 s)
    expect(now.turned).toBeGreaterThan(d64.turned * 0.85);
    expect(now.worst).toBeLessThan(0.2); // the tyres' own slip angle, not a slide
    expect(now.worst).toBeLessThan(d64.worst * 0.5);
  });
});

describe('flat tracks (D80)', () => {
  it('every race track is flat: no crests, dips or floats, and the road is level except on the designed jumps', () => {
    for (const id of TRACK_IDS) {
      const T = getTrack(id);
      expect(
        T.beats.some((b) => b.kind === 'crest' || b.kind === 'dip'),
        id,
      ).toBe(false);
      expect(T.airZone.some(Boolean), id).toBe(false);
      // off the jumps' run-ups the road sits at height 0
      const onRamp = (i: number): boolean =>
        T.ramps.some((r) => (i - r.i0 + T.N) % T.N <= ((r.i1 - r.i0 + T.N) % T.N) + 2);
      let maxH = 0;
      for (let i = 0; i < T.N; i++) if (!onRamp(i)) maxH = Math.max(maxH, Math.abs(T.H[i]!));
      expect(maxH, id).toBeLessThan(0.01);
      // no whoops (runs of bumps) either
      expect(T.ramps.filter((r) => r.kind === 'whoop').length, id).toBe(0);
      // D81: and plenty of jumps and item rows round the lap
      expect(T.ramps.length, id).toBeGreaterThanOrEqual(7);
      expect(T.boxRows.length, id).toBeGreaterThanOrEqual(15);
    }
  });
});
