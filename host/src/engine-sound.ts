/**
 * Procedural F1 V8 engine sound (D60): Web Audio nodes only, no samples. Driven by EngineModel (engine-model.ts).
 *
 * A 4-stroke V8 fires 4 times per crank turn, so the main tone is the firing frequency rpm / 15: about 270 Hz
 * at a 4,000 rpm idle and 1,200 Hz at the 18,000 redline, which is where the F1 scream lives. Layers:
 *
 *   firing    an exhaust-pulse waveform at the firing frequency (rich harmonics with two broad humps, not a
 *             plain sawtooth), with a little random pitch wander so no two cycles are identical
 *   half      the flat-plane V8's half order (each bank's exhaust fires at half the rate): the rasp
 *   cycle     the once-per-cycle order (rpm / 120) pulses the level: the lumpy idle; fades out with revs
 *   grit      band-passed noise amplitude-modulated by the firing wave: combustion roughness locked to the pulses
 *   body      the deep roar under the scream: the crank order (rpm / 60), the half and cycle orders and a rumble of
 *             noise locked to the crank, driven hard through its own clipper and low-passed (D61)
 *
 *   -> drive (more with load and revs) -> soft-clip waveshaper -> exhaust resonance peak -> brightness low-pass
 *   -> high-pass (rises off the throttle: the hollow overrun tone) -> idle pulse -> shift cut -> limiter cut
 *
 * Beside it: straight-cut gearbox whine (follows road speed, louder on the overrun), exhaust pops on upshifts and
 * downshifts, and random crackles on the overrun. A bus compressor keeps it even; Audio adds the master limiter.
 */
import { V8, type EngineEvent, type EngineModel } from './engine-model';

/** Depth of the body layer (D61): its level at no load and the extra at full load, and the rumble amount. */
const BODY = { base: 0.3, load: 0.25, rumble: 0.35 };

/** A small deterministic generator, so offline renders (tools/engine-render.ts) repeat exactly. */
class Lcg {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    this.s = (Math.imul(this.s, 1664525) + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
}

/** Exhaust-pulse spectrum: 1/n^0.8 roll-off with humps near the 3rd and 7th harmonic and fixed random phases. */
function pulseWave(ctx: BaseAudioContext, n: number, humps: [number, number, number][], seed: number): PeriodicWave {
  const re = new Float32Array(n + 1),
    im = new Float32Array(n + 1),
    r = new Lcg(seed);
  for (let k = 1; k <= n; k++) {
    let a = 1 / Math.pow(k, 0.8);
    for (const [c, w, g] of humps) a *= 1 + g * Math.exp(-((k - c) ** 2) / (2 * w * w));
    const ph = r.next() * Math.PI * 2;
    re[k] = a * Math.cos(ph);
    im[k] = a * Math.sin(ph);
  }
  return ctx.createPeriodicWave(re, im);
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 2048,
    c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    // slightly asymmetric: even harmonics give the metallic edge
    c[i] = Math.tanh(amount * (x + 0.12 * x * x)) / Math.tanh(amount * 1.12);
  }
  return c;
}

export function noiseBuffer(ctx: BaseAudioContext, seconds = 2, seed = 7): AudioBuffer {
  const b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate),
    d = b.getChannelData(0),
    r = new Lcg(seed);
  for (let i = 0; i < d.length; i++) d[i] = r.next() * 2 - 1;
  return b;
}

export interface EngineFrame {
  /** Sound on: racing and not paused. */
  on: boolean;
  /** Road speed (m/s) for the gearbox whine. */
  speed: number;
  /** Boosting: a touch more bite. */
  boost: boolean;
  /** Seconds since the last frame (for the crackle rate). */
  dt: number;
}

export class EngineSound {
  readonly out: GainNode;
  private readonly oscs: OscillatorNode[] = [];
  private readonly srcs: AudioBufferSourceNode[] = [];
  private readonly firing: OscillatorNode;
  private readonly half: OscillatorNode;
  private readonly cycle: OscillatorNode;
  private readonly body: OscillatorNode;
  private readonly bodyDrive: GainNode;
  private readonly bodyLow: BiquadFilterNode;
  private readonly gBody: GainNode;
  private readonly gRumble: GainNode;
  private readonly rumbleMod: GainNode;
  private readonly rumbleBand: BiquadFilterNode;
  private readonly shelf: BiquadFilterNode;
  private readonly whine: OscillatorNode;
  private readonly gHalf: GainNode;
  private readonly gGrit: GainNode;
  private readonly gritBand: BiquadFilterNode;
  private readonly gritMod: GainNode;
  private readonly drive: GainNode;
  private readonly makeup: GainNode;
  private readonly peak: BiquadFilterNode;
  private readonly low: BiquadFilterNode;
  private readonly high: BiquadFilterNode;
  private readonly lumpDepth: GainNode;
  private readonly shiftGain: GainNode;
  private readonly limDepth: GainNode;
  private readonly limPitch: GainNode;
  private readonly level: GainNode;
  private readonly gWhine: GainNode;
  private readonly popBus: GainNode;
  private readonly focus: GainNode;
  private readonly rng = new Lcg(0xf1);
  private lastOn = false;

  constructor(
    private readonly ctx: BaseAudioContext,
    dest: AudioNode,
    private readonly noise: AudioBuffer = noiseBuffer(ctx),
  ) {
    const c = ctx;
    const osc = (type: OscillatorType | PeriodicWave, f: number): OscillatorNode => {
      const o = c.createOscillator();
      if (type instanceof PeriodicWave) o.setPeriodicWave(type);
      else o.type = type;
      o.frequency.value = f;
      this.oscs.push(o);
      return o;
    };
    const gain = (v: number): GainNode => {
      const g = c.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q = 0.7, g = 0): BiquadFilterNode => {
      const b = c.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      b.gain.value = g;
      return b;
    };
    const f0 = V8.idle / 15;

    // ---- sources ----
    this.firing = osc(
      pulseWave(
        c,
        40,
        [
          [3, 1.2, 1.3],
          [7, 2.5, 0.9],
        ],
        11,
      ),
      f0,
    );
    this.half = osc(
      pulseWave(
        c,
        24,
        [
          [3, 1, 0.8],
          [5, 1.5, 0.5],
        ],
        23,
      ),
      f0 / 2,
    );
    this.cycle = osc('sine', f0 / 8);
    // the crank order: once per crank turn, fat low harmonics (fundamental and 2nd strongest)
    this.body = osc(pulseWave(c, 16, [[2, 0.8, 0.9]], 37), f0 / 4);
    const sum = gain(1);
    const gFiring = gain(0.62);
    this.gHalf = gain(0.3);
    this.firing.connect(gFiring).connect(sum);
    this.half.connect(this.gHalf).connect(sum);

    // pitch wander (slow random detune) on the firing and half orders
    const wander = c.createBufferSource();
    wander.buffer = noise;
    wander.loop = true;
    wander.playbackRate.value = 0.004;
    const wanderLp = filter('lowpass', 12);
    const wanderDepth = gain(28);
    wander.connect(wanderLp).connect(wanderDepth);
    wanderDepth.connect(this.firing.detune);
    wanderDepth.connect(this.half.detune);
    wanderDepth.connect(this.body.detune);
    this.srcs.push(wander);

    // combustion grit: noise, band-passed above the firing tone, ring/amplitude-modulated by the firing wave
    const grit = c.createBufferSource();
    grit.buffer = noise;
    grit.loop = true;
    this.srcs.push(grit);
    this.gritBand = filter('bandpass', f0 * 3, 1.6);
    this.gGrit = gain(0.1);
    this.gritMod = gain(0.1);
    this.firing.connect(this.gritMod).connect(this.gGrit.gain);
    grit.connect(this.gritBand).connect(this.gGrit).connect(sum);

    // body: crank order + half order + a crank-locked noise rumble, saturated on their own and kept low
    const bodySum = gain(1);
    this.body.connect(gain(0.7)).connect(bodySum);
    this.half.connect(gain(0.45)).connect(bodySum);
    this.cycle.connect(gain(0.4)).connect(bodySum); // the sub: once per engine cycle
    const rumble = c.createBufferSource();
    rumble.buffer = noise;
    rumble.loop = true;
    this.srcs.push(rumble);
    this.rumbleBand = filter('bandpass', f0 * 0.7, 0.7);
    this.gRumble = gain(0);
    this.rumbleMod = gain(0);
    this.body.connect(this.rumbleMod).connect(this.gRumble.gain);
    rumble.connect(this.rumbleBand).connect(this.gRumble).connect(bodySum);
    this.bodyDrive = gain(2);
    const bodyShaper = c.createWaveShaper();
    bodyShaper.curve = softClip(2.2);
    bodyShaper.oversample = '4x';
    this.bodyLow = filter('lowpass', 300, 0.9);
    this.gBody = gain(0);

    // ---- shaping ----
    this.drive = gain(1.5);
    const shaper = c.createWaveShaper();
    shaper.curve = softClip(1.6);
    shaper.oversample = '4x';
    this.makeup = gain(0.6);
    this.peak = filter('peaking', 900, 1.3, 7);
    this.shelf = filter('lowshelf', 260, 0.7, 3);
    this.low = filter('lowpass', 2500, 0.8);
    this.high = filter('highpass', 70, 0.7);
    const lump = gain(1);
    this.lumpDepth = gain(0.3);
    this.cycle.connect(this.lumpDepth).connect(lump.gain);
    this.shiftGain = gain(1);
    // limiter: a 22 Hz square (softened so the cuts do not click) swings the gain between 1 - depth and 1 + depth
    const limGain = gain(1);
    const limLfo = osc('square', V8.limiterHz);
    const limSoft = filter('lowpass', 160);
    this.limDepth = gain(0);
    this.limPitch = gain(0);
    limLfo.connect(limSoft);
    limSoft.connect(this.limDepth).connect(limGain.gain);
    limSoft.connect(this.limPitch);
    this.limPitch.connect(this.firing.detune);
    this.limPitch.connect(this.half.detune);
    this.limPitch.connect(this.body.detune);
    this.level = gain(0);
    sum.connect(this.drive).connect(shaper).connect(this.makeup).connect(this.peak).connect(this.shelf);
    this.shelf.connect(this.low);
    this.low.connect(this.high).connect(lump).connect(this.shiftGain).connect(limGain).connect(this.level);
    // the body joins after the overrun high-pass (it has its own overrun fade) and goes through the cuts with it
    bodySum.connect(this.bodyDrive).connect(bodyShaper).connect(this.bodyLow).connect(this.gBody).connect(lump);

    // gearbox whine
    this.whine = osc('triangle', 400);
    this.gWhine = gain(0);
    this.whine.connect(this.gWhine);

    // pops and crackles
    this.popBus = gain(1);

    // ---- bus: glue compressor, focus fade, out ----
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.12;
    this.focus = gain(1);
    // mix level: the scream sits about 12 dB under the effects and music, the idle well below it
    this.out = gain(0.17);
    this.level.connect(comp);
    this.gWhine.connect(comp);
    this.popBus.connect(comp);
    comp.connect(this.focus).connect(this.out).connect(dest);

    for (const o of this.oscs) o.start();
    for (const s of this.srcs) s.start(0, this.rng.next());
  }

  /** Fade the engine out when the tab is hidden or loses focus, back in when it returns. */
  setFocus(on: boolean): void {
    this.focus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, on ? 0.15 : 0.05);
  }

  /** Follow the model. Call once per frame, after EngineModel.update(). */
  update(m: EngineModel, ev: EngineEvent, f: EngineFrame, when = this.ctx.currentTime): void {
    const t = when,
      k = 0.012; // parameter smoothing (s)
    const rpm = m.rpm,
      n = m.norm,
      load = m.load,
      over = m.overrunT > 0 ? Math.min(1, m.overrunT / 0.25) : 0;
    const fire = rpm / 15;

    // pitch
    this.firing.frequency.setTargetAtTime(fire, t, k);
    this.half.frequency.setTargetAtTime(fire / 2, t, k);
    this.cycle.frequency.setTargetAtTime(fire / 8, t, k);
    this.body.frequency.setTargetAtTime(fire / 4, t, k);
    this.rumbleBand.frequency.setTargetAtTime(Math.min(1200, Math.max(80, fire * 0.7)), t, k);
    this.gritBand.frequency.setTargetAtTime(Math.min(9000, fire * 3.2), t, k);

    // the mix of orders: lumpy and pulsing at idle, the clean firing scream at the top
    this.gHalf.gain.setTargetAtTime(0.34 - 0.2 * n, t, 0.03);
    this.lumpDepth.gain.setTargetAtTime(0.42 * (1 - n) ** 3, t, 0.03);
    const grit = 0.05 + 0.2 * load * (0.3 + 0.7 * n) + 0.05 * over;
    this.gGrit.gain.setTargetAtTime(grit * 0.5, t, 0.02);
    this.gritMod.gain.setTargetAtTime(grit * 0.5, t, 0.02);

    // body: the roar grows with load, thins (but stays) on the overrun
    this.bodyDrive.gain.setTargetAtTime(1.6 + 2.6 * load, t, 0.02);
    this.bodyLow.frequency.setTargetAtTime(Math.min(1400, 160 + fire * 0.85), t, k);
    this.gBody.gain.setTargetAtTime((BODY.base + BODY.load * load) * (1 - 0.55 * over), t, 0.03);
    const rum = BODY.rumble * (0.25 + 0.75 * load);
    this.gRumble.gain.setTargetAtTime(rum, t, 0.02);
    this.rumbleMod.gain.setTargetAtTime(rum, t, 0.02);

    // drive and tone: harder and brighter with load and revs; boosts add a little more
    const drv = 1.1 + 3.4 * load * n ** 1.2 + (f.boost ? 0.6 : 0);
    this.drive.gain.setTargetAtTime(drv, t, 0.02);
    this.makeup.gain.setTargetAtTime(0.95 / Math.sqrt(drv), t, 0.02);
    this.peak.frequency.setTargetAtTime(Math.min(4200, fire * 2.1), t, k);
    this.peak.gain.setTargetAtTime(4 + 5 * load, t, 0.03);
    const bright = (1100 + 9500 * n ** 1.35) * (0.42 + 0.58 * load) * (1 - 0.25 * over);
    this.low.frequency.setTargetAtTime(Math.min(16000, bright), t, 0.02);
    // overrun: the bottom drops out (hollow) and what is left is a thinner, descending whine
    this.high.frequency.setTargetAtTime(60 + over * fire * 0.9, t, 0.04);

    // limiter bounce
    const lim = m.limiter ? 1 : 0;
    this.limDepth.gain.setTargetAtTime(0.78 * lim, t, 0.01);
    this.limPitch.gain.setTargetAtTime(35 * lim, t, 0.01);

    // overall level: idle quiet, the scream loud; off the throttle a bit quieter
    const lvl = f.on ? (0.2 + 0.55 * n ** 1.1) * (0.6 + 0.4 * load) * (1 - 0.3 * over) * (lim ? 0.6 : 1) : 0;
    this.level.gain.setTargetAtTime(lvl, t, f.on === this.lastOn ? 0.03 : 0.12);

    // straight-cut gearbox whine: tied to road speed, mostly heard on the overrun
    const sp = Math.abs(f.speed);
    this.whine.frequency.setTargetAtTime(220 + sp * 52, t, 0.03);
    this.gWhine.gain.setTargetAtTime(f.on ? Math.min(1, sp / 40) * (0.006 + 0.03 * over) : 0, t, 0.06);

    if (f.on) {
      if (ev === 'upshift') {
        // ignition cut: a quick dip, then a crisp pop as the next gear bites
        this.shiftGain.gain.cancelScheduledValues(t);
        this.shiftGain.gain.setTargetAtTime(0.2, t, 0.005);
        this.shiftGain.gain.setTargetAtTime(1, t + V8.shiftCut, 0.012);
        this.pop(t + 0.012, 0.32 + 0.15 * n, 1);
      } else if (ev === 'downshift') {
        // the blip itself comes from the model (revs and load spike); add a small bark
        this.shiftGain.gain.cancelScheduledValues(t);
        this.shiftGain.gain.setTargetAtTime(1.25, t, 0.008);
        this.shiftGain.gain.setTargetAtTime(1, t + V8.blipTime, 0.03);
        if (this.rng.next() < 0.7) this.pop(t + 0.02, 0.18 + 0.12 * this.rng.next(), 0.7);
      }
      // overrun crackles: a burst when lifting, then occasional pops
      if (over > 0) {
        const rate = 11 * Math.exp(-m.overrunT / 0.9) + 2.2 * n;
        if (this.rng.next() < rate * f.dt) this.pop(t, 0.08 + 0.2 * this.rng.next() * (0.4 + 0.6 * n), 0.4);
      }
    }
    this.lastOn = f.on;
  }

  /** One exhaust pop: a band-passed noise crack and a short low thump. */
  private pop(t: number, vol: number, bright: number): void {
    const c = this.ctx;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + (1200 + 1600 * this.rng.next()) * bright;
    bp.Q.value = 0.9;
    const g = c.createGain();
    const d = 0.018 + 0.035 * this.rng.next();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(bp).connect(g).connect(this.popBus);
    s.start(t, this.rng.next() * 1.5);
    s.stop(t + d + 0.02);
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95 + 60 * this.rng.next(), t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.05);
    const og = c.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(vol * 0.9, t + 0.002);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(og).connect(this.popBus);
    o.start(t);
    o.stop(t + 0.08);
  }

  dispose(): void {
    for (const o of this.oscs) o.stop();
    for (const s of this.srcs) s.stop();
    this.out.disconnect();
  }
}
