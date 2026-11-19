/**
 * Virtual F1 V8 drivetrain for the engine sound (D60). The game's physics only know the kart's speed, so this
 * derives what a 2.4 L naturally aspirated V8 with a 7-speed seamless-shift gearbox would be doing at that speed:
 * engine rpm (4,000 idle to an 18,000 redline), the gear, engine load, shifts, overrun and the rev limiter.
 *
 * It only reads the kart; it never feeds back into the simulation. No Web Audio here, so it is unit-tested in
 * Node (tests/engine-model.test.ts) and engine-sound.ts turns its state into sound.
 */

export const V8 = {
  idle: 4000,
  redline: 18000,
  /** Upshift point on throttle (just under the limiter, as in the V8 era). */
  upshift: 17300,
  /** Braking / overrun: drop a gear once the lower gear would sit under this, so the engine keeps screaming. */
  downshiftOverrun: 16000,
  /** On throttle: drop a gear when the revs fall below this (after a hit or a slow corner)... */
  downshiftPower: 10500,
  /** ...and only if the lower gear lands under this. */
  downshiftPowerCeil: 16800,
  /** Speed (m/s) at the redline in each gear, 1st to 7th, at the game's base speed (multiplied by the game's
   * speed setting, EngineInput.scale). Every character's normal top speed (36-39.5 m/s) sits mid-band in 6th at
   * about 14,700-16,200 rpm, never hovering at a shift point; a boost (52 m/s) pulls 7th to about 17,300. */
  gearTop: [11, 16.5, 22, 28, 34, 44, 54] as const,
  /** Short-shift: on the gas but no longer gaining speed (below this, m/s²) high in a gear: take the next one. */
  shortShiftAccel: 0.8,
  shortShiftRpm: 16300,
  /** Clutch slip from a standstill on throttle. */
  launchSlip: 8800,
  /** Grid revs while the driver holds DRIFT during the countdown. */
  gridRevs: 13000,
  /** Ignition cut during an upshift (s). */
  shiftCut: 0.045,
  /** Throttle blip on a downshift (s), and its overshoot (rpm). */
  blipTime: 0.085,
  blipRpm: 900,
  /** Shortest time between two shifts (s). */
  minShiftGap: 0.13,
  /** Free-revving rates (rpm/s) with the wheels off the ground or the clutch open: F1 engines rev very fast. */
  freeRise: 30000,
  freeFall: 16000,
  /** Rev limiter bounce rate (Hz). */
  limiterHz: 22,
} as const;

export const GEARS = V8.gearTop.length;

export interface EngineInput {
  /** Forward speed, m/s (the sign is ignored). */
  speed: number;
  /** The driver is on the gas (not braking, not spinning, not stalled). */
  throttle: boolean;
  /** Boost pad, drift boost, turbo item. */
  boost: boolean;
  /** Wheels off the ground (jumps). */
  air: boolean;
  /** On the grid before GO: the kart is held. */
  grid: boolean;
  /** Revving on the grid (DRIFT held during the countdown). */
  launch: boolean;
  /** The game's speed multiplier (handling.speedMul); the gear speeds scale with it. Default 1. */
  scale?: number;
}

export type EngineEvent = 'upshift' | 'downshift' | null;

/** rpm the wheels would turn the engine at, in a gear (1-based), at a game speed multiplier. */
export function wheelRpm(speed: number, gear: number, scale = 1): number {
  return (V8.redline * Math.abs(speed)) / (V8.gearTop[gear - 1]! * scale);
}

const approach = (v: number, target: number, rise: number, fall: number, dt: number): number =>
  target > v ? Math.min(target, v + rise * dt) : Math.max(target, v - fall * dt);

export class EngineModel {
  rpm: number = V8.idle;
  gear = 1;
  /** 0 (closed throttle or ignition cut) to 1 (full load), smoothed. */
  load = 0;
  /** True while bouncing off the rev limiter. */
  limiter = false;
  /** Seconds spent off the throttle at speed (overrun), 0 otherwise. */
  overrunT = 0;
  /** Seconds left of the upshift ignition cut. */
  cutT = 0;
  /** Seconds left of the downshift throttle blip. */
  blipT = 0;
  private sinceShift = 1;
  private lastSpeed = 0;
  /** Smoothed acceleration (m/s², at base speed). */
  private accel = 0;
  private limPh = 0;
  private idlePh = 0;

  /** Back to idle in 1st (a new race). */
  reset(): void {
    this.rpm = V8.idle;
    this.gear = 1;
    this.load = 0;
    this.limiter = false;
    this.overrunT = this.cutT = this.blipT = 0;
    this.sinceShift = 1;
    this.lastSpeed = this.accel = 0;
  }

  /** 0 at idle, 1 at the redline. */
  get norm(): number {
    return Math.min(1, Math.max(0, (this.rpm - V8.idle) / (V8.redline - V8.idle)));
  }

  update(dt: number, inp: EngineInput): EngineEvent {
    dt = Math.min(0.1, Math.max(0, dt));
    if (dt === 0) return null;
    const speed = Math.abs(inp.speed) / (inp.scale ?? 1);
    this.sinceShift += dt;
    this.accel += ((speed - this.lastSpeed) / dt - this.accel) * Math.min(1, dt / 0.3);
    this.lastSpeed = speed;
    this.cutT = Math.max(0, this.cutT - dt);
    this.blipT = Math.max(0, this.blipT - dt);
    let ev: EngineEvent = null;
    let target: number;
    let coupled = false;
    const thr = inp.throttle && !inp.grid;

    if (inp.grid) {
      // held on the grid in 1st with the clutch in: idle, or the driver's launch revs
      this.gear = 1;
      target = inp.launch ? V8.gridRevs : V8.idle;
    } else if (inp.air) {
      // wheels in the air: on the gas the engine flies up to the limiter, off it the revs fall away
      target = thr ? V8.redline + 400 : Math.max(V8.idle, wheelRpm(speed, this.gear) * 0.85);
    } else {
      ev = this.shift(speed, thr);
      coupled = true;
      // clutch slip from a standstill on the gas, idle when rolling slowly off it
      target = Math.max(wheelRpm(speed, this.gear), thr ? V8.launchSlip : V8.idle);
      if (this.blipT > 0) target += V8.blipRpm * (this.blipT / V8.blipTime);
    }

    if (coupled && target > V8.launchSlip - 1) {
      // in gear the engine is tied to the wheels: follow quickly (a shift settles in about 50 ms)
      this.rpm += (target - this.rpm) * Math.min(1, dt / 0.03);
    } else this.rpm = approach(this.rpm, target, V8.freeRise, V8.freeFall, dt);

    // idle hunting: a small, quick wander so the idle pulses rather than drones
    if (this.rpm < V8.idle + 600 && !thr) {
      this.idlePh += dt;
      this.rpm += Math.sin(this.idlePh * 9.3) * 60 + Math.sin(this.idlePh * 2.1) * 90;
    }

    // rev limiter: ignition cuts at about 22 Hz, the revs bounce a few hundred rpm under the redline
    this.limiter = (thr || (inp.grid && inp.launch)) && target >= V8.redline - 50;
    if (this.limiter) {
      this.limPh = (this.limPh + dt * V8.limiterHz) % 1;
      this.rpm = V8.redline - 380 * this.limPh;
    } else {
      this.limPh = 0;
      this.rpm = Math.min(this.rpm, V8.redline);
    }
    this.rpm = Math.max(V8.idle - 250, this.rpm);

    // engine load: full on the gas (and through a blip), zero off it or while the ignition is cut
    const wantLoad =
      this.cutT > 0 ? 0 : this.blipT > 0 ? 1 : thr ? 1 : inp.grid && inp.launch ? 0.7 : inp.grid ? 0.15 : 0;
    this.load += (wantLoad - this.load) * Math.min(1, dt / 0.035);

    this.overrunT = !thr && !inp.grid && speed > 8 ? this.overrunT + dt : 0;
    return ev;
  }

  /** The automatic gearbox: upshift near the redline on the gas, downshift with a blip when slowing. */
  private shift(speed: number, thr: boolean): EngineEvent {
    if (this.sinceShift < V8.minShiftGap) return null;
    const now = wheelRpm(speed, this.gear);
    const flat = this.accel < V8.shortShiftAccel && now > V8.shortShiftRpm && this.sinceShift > 0.6;
    if (thr && this.gear < GEARS && (now > V8.upshift || flat)) {
      this.gear++;
      this.sinceShift = 0;
      this.cutT = V8.shiftCut;
      return 'upshift';
    }
    if (this.gear > 1) {
      const lower = wheelRpm(speed, this.gear - 1);
      const down = thr ? now < V8.downshiftPower && lower < V8.downshiftPowerCeil : lower < V8.downshiftOverrun;
      if (down) {
        this.gear--;
        this.sinceShift = 0;
        this.blipT = V8.blipTime;
        return 'downshift';
      }
    }
    return null;
  }
}
