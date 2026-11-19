import { describe, expect, it } from 'vitest';
import { EngineModel, V8, wheelRpm, type EngineInput } from '../host/src/engine-model';

const DT = 1 / 60;
const inp = (o: Partial<EngineInput>): EngineInput => ({
  speed: 0,
  throttle: false,
  boost: false,
  air: false,
  grid: false,
  launch: false,
  ...o,
});

/** Accelerate like the game does (sp += max(5, acc (1 - sp / top)) dt) and record what the engine does. */
function accelerate(m: EngineModel, from: number, top: number, secs: number, acc = 28) {
  let sp = from;
  const ev: string[] = [];
  let maxRpm = 0,
    minRpm = Infinity;
  for (let t = 0; t < secs; t += DT) {
    if (sp < top) sp = Math.min(top, sp + Math.max(5, acc * (1 - sp / top)) * DT);
    const e = m.update(DT, inp({ speed: sp, throttle: true }));
    if (e) ev.push(`${e}@${m.gear}`);
    maxRpm = Math.max(maxRpm, m.rpm);
    if (t > 0.5) minRpm = Math.min(minRpm, m.rpm);
  }
  return { sp, ev, maxRpm, minRpm };
}

describe('virtual F1 V8 drivetrain (D60)', () => {
  it('idles around 4,000 rpm in 1st when stopped, with a small hunting wobble', () => {
    const m = new EngineModel();
    const seen: number[] = [];
    for (let i = 0; i < 120; i++) {
      m.update(DT, inp({}));
      seen.push(m.rpm);
    }
    expect(m.gear).toBe(1);
    expect(Math.min(...seen)).toBeGreaterThan(V8.idle - 260);
    expect(Math.max(...seen)).toBeLessThan(V8.idle + 260);
    expect(Math.max(...seen) - Math.min(...seen)).toBeGreaterThan(40);
    expect(m.load).toBeLessThan(0.05);
  });

  it('revs on the grid while DRIFT is held, and drops back to idle when released', () => {
    const m = new EngineModel();
    for (let i = 0; i < 60; i++) m.update(DT, inp({ grid: true, launch: true }));
    expect(m.rpm).toBeGreaterThan(12000);
    for (let i = 0; i < 90; i++) m.update(DT, inp({ grid: true }));
    expect(m.rpm).toBeLessThan(V8.idle + 300);
  });

  it('upshifts through the gears near the redline from a standing start to top speed', () => {
    const m = new EngineModel();
    const r = accelerate(m, 0, 38, 12);
    expect(r.ev.every((e) => e.startsWith('upshift'))).toBe(true);
    expect(m.gear).toBe(6); // normal top speed cruises in 6th
    expect(m.rpm).toBeGreaterThan(14500);
    expect(m.rpm).toBeLessThan(V8.redline);
    expect(r.maxRpm).toBeLessThanOrEqual(V8.redline);
    expect(r.minRpm).toBeGreaterThan(8000); // clutch slip at the start, never bogs down
    expect(m.limiter).toBe(false);
  });

  it('a boost pulls 7th gear high but stays off the limiter', () => {
    const m = new EngineModel();
    accelerate(m, 0, 38, 12);
    const r = accelerate(m, 38, 52, 2, 70);
    expect(r.ev).toContain('upshift@7');
    expect(m.rpm).toBeGreaterThan(16500);
    expect(m.limiter).toBe(false);
  });

  it('bounces off the rev limiter in the air on the gas', () => {
    const m = new EngineModel();
    accelerate(m, 0, 38, 12);
    const rpms: number[] = [];
    for (let i = 0; i < 45; i++) {
      m.update(DT, inp({ speed: 38, throttle: true, air: true }));
      if (i > 15) rpms.push(m.rpm);
    }
    expect(m.limiter).toBe(true);
    expect(Math.max(...rpms)).toBeLessThanOrEqual(V8.redline);
    expect(Math.max(...rpms) - Math.min(...rpms)).toBeGreaterThan(150); // it bounces
    // landing reconnects the wheels: back below the limiter
    for (let i = 0; i < 20; i++) m.update(DT, inp({ speed: 38, throttle: true }));
    expect(m.limiter).toBe(false);
  });

  it('downshifts with a blip under braking, keeping the revs high, and runs the overrun', () => {
    const m = new EngineModel();
    accelerate(m, 0, 38, 12);
    let sp = 38;
    const ev: string[] = [];
    let blips = 0,
      overrun = 0;
    for (let t = 0; t < 1.2; t += DT) {
      sp = Math.max(6, sp - 30 * DT);
      const e = m.update(DT, inp({ speed: sp }));
      if (e) ev.push(e);
      if (e === 'downshift' && m.blipT > 0) blips++;
      overrun = Math.max(overrun, m.overrunT);
      if (t > 0.3) expect(m.rpm).toBeGreaterThan(8500);
    }
    expect(ev.length).toBeGreaterThanOrEqual(3);
    expect(ev.every((e) => e === 'downshift')).toBe(true);
    expect(blips).toBe(ev.length);
    expect(overrun).toBeGreaterThan(0.9);
    expect(m.load).toBeLessThan(0.1);
  });

  it('cuts the ignition (load to zero) briefly on each upshift', () => {
    const m = new EngineModel();
    let sp = 11;
    let sawCut = false;
    for (let t = 0; t < 1; t += DT) {
      sp += 20 * DT;
      const e = m.update(DT, inp({ speed: sp, throttle: true }));
      if (e === 'upshift') {
        expect(m.cutT).toBeGreaterThan(0);
        m.update(DT, inp({ speed: sp, throttle: true }));
        expect(m.load).toBeLessThan(0.7);
        sawCut = true;
        break;
      }
    }
    expect(sawCut).toBe(true);
  });

  it("scales the gears with the game's speed setting (default handling: speedMul 1.3)", () => {
    const m = new EngineModel();
    let sp = 0;
    for (let t = 0; t < 12; t += DT) {
      sp = Math.min(49, sp + Math.max(5, 36 * (1 - sp / 49)) * DT);
      m.update(DT, inp({ speed: sp, throttle: true, scale: 1.3 }));
    }
    expect(m.gear).toBe(6);
    expect(m.rpm).toBeGreaterThan(14500);
    for (let t = 0; t < 2; t += DT) {
      sp = Math.min(67.6, sp + 70 * 1.3 * DT);
      m.update(DT, inp({ speed: sp, throttle: true, boost: true, scale: 1.3 }));
    }
    expect(m.gear).toBe(7);
    expect(m.limiter).toBe(false);
  });

  it('never hovers at the shift point when the speed levels off high in a gear (short-shifts instead)', () => {
    for (const top of [30.5, 31, 33, 36, 38, 39.5]) {
      const m = new EngineModel();
      accelerate(m, 0, top, 14);
      expect(m.rpm, `top ${top} m/s, gear ${m.gear}`).toBeLessThan(16400);
      expect(m.rpm, `top ${top} m/s, gear ${m.gear}`).toBeGreaterThan(11000);
    }
  });

  it('wheel rpm hits the redline at each gear top speed', () => {
    V8.gearTop.forEach((top, i) => expect(wheelRpm(top, i + 1)).toBeCloseTo(V8.redline));
  });
});
