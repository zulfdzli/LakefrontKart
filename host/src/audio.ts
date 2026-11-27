/**
 * Procedural WebAudio (prototype): the kart engine, tyre squeal, sound effects and the music. D75: two original
 * pieces, "Sunday Garage" in the menu and "Turbo Rush" in the race (it speeds up on the final lap). Browsers need a user gesture before audio can start: unlock() runs on the first key
 * press, click or tap anywhere (and on the game's own buttons). Everything goes through a master limiter so nothing
 * clips (D60). The engine fades out while the tab is hidden or unfocused. D64: the F1 V8 engine (D60-D62) is gone,
 * at the user's request; this is the original kart engine again.
 */
const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/* ---------------- D75 soundtrack: two original pieces, both made right here in WebAudio ---------------- */
type Chord = [number, number[]];
/** "Sunday Garage" (menu): a laid-back, swung lo-fi groove over Fmaj7, Em7, Dm7, Cmaj7. */
const MENU_BPM = 92;
const MENU_SWING = 0.2;
const MENU_CH: Chord[] = [
  [41, [65, 69, 72, 76]],
  [40, [64, 67, 71, 74]],
  [38, [62, 65, 69, 72]],
  [36, [60, 64, 67, 71]],
];
/** Bell melody over the four bars: [bar, step, note, length in steps]. */
const MENU_MEL: [number, number, number, number][] = [
  [0, 0, 81, 3],
  [0, 3, 79, 2],
  [0, 6, 77, 3],
  [0, 10, 76, 2],
  [0, 12, 72, 4],
  [1, 2, 79, 2],
  [1, 4, 76, 3],
  [1, 8, 74, 4],
  [1, 14, 71, 2],
  [2, 0, 77, 3],
  [2, 3, 76, 2],
  [2, 6, 74, 3],
  [2, 10, 72, 2],
  [2, 12, 69, 4],
  [3, 4, 72, 2],
  [3, 6, 74, 2],
  [3, 8, 76, 8],
];
/** "Turbo Rush" (race): driving synthwave over Am, F, C, G, with a breakdown and a lift across 16 bars. */
const RACE_BPM = 146;
const RACE_CH: Chord[] = [
  [45, [69, 72, 76]],
  [41, [69, 72, 77]],
  [48, [67, 72, 76]],
  [43, [67, 71, 74]],
];
const RACE_LEAD: [number, number, number, number][] = [
  [0, 0, 76, 2],
  [0, 2, 79, 2],
  [0, 4, 81, 4],
  [0, 8, 79, 2],
  [0, 10, 76, 2],
  [0, 12, 72, 4],
  [1, 0, 77, 2],
  [1, 2, 76, 2],
  [1, 4, 72, 4],
  [1, 8, 69, 4],
  [1, 12, 72, 4],
  [2, 0, 76, 2],
  [2, 2, 79, 2],
  [2, 4, 84, 4],
  [2, 8, 83, 2],
  [2, 10, 79, 2],
  [2, 12, 76, 4],
  [3, 0, 74, 4],
  [3, 4, 71, 2],
  [3, 6, 74, 2],
  [3, 8, 79, 8],
];
const ARP = [0, 1, 2, 1];

export type MusicMood = 'off' | 'menu' | 'race' | 'podium';

const GESTURES = ['pointerdown', 'keydown', 'touchend'] as const;

/**
 * Master safety limiter: a fast, hard compressor just under full scale, so engine, effects and music together
 * never clip harshly. Exported so offline renders use the same chain.
 */
export function masterLimiter(ac: BaseAudioContext): DynamicsCompressorNode {
  const l = ac.createDynamicsCompressor();
  l.threshold.value = -6;
  l.knee.value = 4;
  l.ratio.value = 20;
  l.attack.value = 0.002;
  l.release.value = 0.15;
  return l;
}

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private noise!: AudioBuffer;
  private eng!: OscillatorNode;
  private eng2!: OscillatorNode;
  private engG!: GainNode;
  /** The page is visible and focused: the engine plays only then. */
  private focused = true;
  private sqG!: GainNode;
  /** D81: the gear change (a short dip in the engine), the crowd bed and its level. */
  private shiftG!: GainNode;
  private crowdG!: GainNode;
  private gear = 0;
  private lastCheer = 0;
  private step = 0;
  private next = 0;
  tempo = 1;
  mood: MusicMood = 'menu';
  muted: boolean;
  private timer = 0;

  constructor() {
    this.muted = localStorage.getItem('tk_muted') === '1';
    // autoplay rules: start on the first gesture anywhere on the page
    const first = (): void => {
      this.unlock();
      if (this.ready) for (const e of GESTURES) window.removeEventListener(e, first, true);
    };
    for (const e of GESTURES) window.addEventListener(e, first, true);
    // tab hidden: fade the engine and suspend the context (no CPU in the background); unfocused: fade the engine
    document.addEventListener('visibilitychange', () => this.onFocus());
    window.addEventListener('blur', () => this.onFocus());
    window.addEventListener('focus', () => this.onFocus());
  }

  private onFocus(): void {
    const ac = this.ctx;
    if (!ac) return;
    const visible = !document.hidden,
      focused = visible && document.hasFocus();
    this.focused = focused;
    if (!visible) {
      window.clearTimeout(this.suspendTimer);
      this.suspendTimer = window.setTimeout(() => {
        if (document.hidden) void ac.suspend();
      }, 250);
    } else if (ac.state === 'suspended') void ac.resume();
  }
  private suspendTimer = 0;

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a user gesture (click or key). */
  unlock(): void {
    try {
      if (!this.ctx) {
        const ac = (this.ctx = new AudioContext({ latencyHint: 'interactive' }));
        this.master = ac.createGain();
        this.master.gain.value = this.muted ? 0 : 0.9;
        this.master.connect(masterLimiter(ac)).connect(ac.destination);
        this.sfx = ac.createGain();
        this.sfx.connect(this.master);
        this.music = ac.createGain();
        this.music.gain.value = 0;
        this.music.connect(this.master);
        const buf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate),
          d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        this.noise = buf;
        this.focused = !document.hidden && document.hasFocus();
        this.eng = ac.createOscillator();
        this.eng.type = 'sawtooth';
        this.eng2 = ac.createOscillator();
        this.eng2.type = 'square';
        const engF = ac.createBiquadFilter();
        engF.type = 'lowpass';
        engF.frequency.value = 650;
        this.engG = ac.createGain();
        this.engG.gain.value = 0;
        const g2 = ac.createGain();
        g2.gain.value = 0.45;
        this.eng.connect(engF);
        this.eng2.connect(g2);
        g2.connect(engF);
        this.shiftG = ac.createGain();
        engF.connect(this.shiftG).connect(this.engG);
        this.engG.connect(this.sfx);
        this.eng.start();
        this.eng2.start();
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const bp = ac.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 2300;
        bp.Q.value = 5;
        this.sqG = ac.createGain();
        this.sqG.gain.value = 0;
        src.connect(bp);
        bp.connect(this.sqG);
        this.sqG.connect(this.sfx);
        src.start();
        // D81: the crowd: a murmur of band-passed noise that swells and settles on a slow wobble
        const crowdSrc = ac.createBufferSource();
        crowdSrc.buffer = buf;
        crowdSrc.loop = true;
        crowdSrc.playbackRate.value = 0.73;
        const cb1 = ac.createBiquadFilter();
        cb1.type = 'bandpass';
        cb1.frequency.value = 620;
        cb1.Q.value = 0.7;
        const cb2 = ac.createBiquadFilter();
        cb2.type = 'lowpass';
        cb2.frequency.value = 2400;
        const wob = ac.createGain();
        wob.gain.value = 1;
        const lfo = ac.createOscillator();
        lfo.frequency.value = 0.13;
        const lfoG = ac.createGain();
        lfoG.gain.value = 0.3;
        lfo.connect(lfoG).connect(wob.gain);
        this.crowdG = ac.createGain();
        this.crowdG.gain.value = 0;
        crowdSrc.connect(cb1).connect(cb2).connect(wob).connect(this.crowdG).connect(this.sfx);
        crowdSrc.start();
        lfo.start();
        this.next = ac.currentTime + 0.1;
        this.timer = window.setInterval(() => this.schedMusic(), 25);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem('tk_muted', m ? '1' : '0');
    if (this.ctx) this.master.gain.value = m ? 0 : 0.9;
  }

  tone(f: number, d: number, type: OscillatorType = 'square', vol = 0.1, f2 = 0, when = 0, dest?: AudioNode): void {
    const ac = this.ctx;
    if (!ac) return;
    const t = when || ac.currentTime,
      o = ac.createOscillator(),
      g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + d);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g);
    g.connect(dest ?? this.sfx);
    o.start(t);
    o.stop(t + d + 0.03);
  }

  noiseHit(d: number, vol: number, freq = 1200, type: BiquadFilterType = 'bandpass', when = 0, dest?: AudioNode): void {
    const ac = this.ctx;
    if (!ac) return;
    const t = when || ac.currentTime,
      s = ac.createBufferSource(),
      f = ac.createBiquadFilter(),
      g = ac.createGain();
    s.buffer = this.noise;
    f.type = type;
    f.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    s.connect(f);
    f.connect(g);
    g.connect(dest ?? this.sfx);
    s.start(t, Math.random() * 0.5);
    s.stop(t + d + 0.03);
  }

  /** Seconds from now on the audio clock (for little jingles). */
  at(dt: number): number {
    return this.ctx ? this.ctx.currentTime + dt : 0;
  }

  click(): void {
    this.tone(880, 0.06, 'triangle', 0.06);
  }

  /** A plucked synth note: a filter that closes as the note decays (bass, arp, pad and lead). */
  private pluck(f: number, d: number, vol: number, t: number, type: OscillatorType, cutoff: number): void {
    const ac = this.ctx;
    if (!ac) return;
    const o = ac.createOscillator(),
      fl = ac.createBiquadFilter(),
      g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    fl.type = 'lowpass';
    fl.Q.value = 2;
    fl.frequency.setValueAtTime(cutoff, t);
    fl.frequency.exponentialRampToValueAtTime(Math.max(90, cutoff * 0.18), t + d);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(fl).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + d + 0.03);
  }

  private mood0: MusicMood = 'off';

  private schedMusic(): void {
    const ac = this.ctx;
    if (!ac) return;
    const want = this.mood !== 'off';
    // D75: the menu tune up front; in a race the music sits well back so the engine comes through
    const level = this.mood === 'race' ? 0.2 : this.mood === 'menu' ? 0.75 : want ? 0.42 : 0;
    this.music.gain.setTargetAtTime(level, ac.currentTime, 0.3);
    if (this.mood !== this.mood0) {
      // a new piece starts from its first bar
      this.mood0 = this.mood;
      this.step = 0;
    }
    if (!want) {
      this.next = ac.currentTime + 0.05;
      return;
    }
    const menu = this.mood === 'menu';
    const spb = 60 / ((menu ? MENU_BPM : RACE_BPM) * this.tempo) / 4;
    if (this.next < ac.currentTime) this.next = ac.currentTime + 0.02;
    while (this.next < ac.currentTime + 0.12) {
      if (menu) this.menuStep(this.step, this.next, spb);
      else this.raceStep(this.step, this.next, spb);
      this.next += spb;
      this.step++;
    }
  }

  /** "Sunday Garage": swung hats, a soft kick and rim, electric-piano chords, a walking bass and a bell tune. */
  private menuStep(step: number, t0: number, spb: number): void {
    const M = this.music,
      st = step % 128,
      bar = Math.floor(st / 16) % 4,
      b = st % 16,
      [root, ch] = MENU_CH[bar]!;
    // swing: the second 16th of each 8th lands late
    const t = t0 + (b % 2 === 1 ? spb * MENU_SWING : 0);
    if (b === 0 || b === 11) this.tone(110, 0.22, 'sine', 0.42, 42, t, M);
    if (b === 4 || b === 12) {
      this.noiseHit(0.09, 0.12, 1900, 'bandpass', t, M);
      this.tone(190, 0.07, 'triangle', 0.05, 130, t, M);
    }
    if (b % 2 === 0) this.noiseHit(0.035, 0.035, 8200, 'highpass', t, M);
    // electric piano: the chord on the one, a lighter stab on the "and" of three
    if (b === 0)
      for (const n of ch) {
        this.tone(midi(n), spb * 7, 'sine', 0.03, 0, t, M);
        this.tone(midi(n + 12), spb * 3, 'sine', 0.007, 0, t, M);
      }
    if (b === 10) for (const n of ch.slice(1)) this.tone(midi(n), spb * 3, 'sine', 0.02, 0, t, M);
    // walking bass: root, fifth, octave, and a step towards the next chord
    const nextRoot = MENU_CH[(bar + 1) % 4]![0];
    const bass = b === 0 ? root : b === 6 ? root + 7 : b === 8 ? root + 12 : b === 14 ? nextRoot + 1 : 0;
    if (bass) this.tone(midi(bass), spb * (b === 0 ? 5 : 2), 'triangle', 0.2, 0, t, M);
    // the bell tune: all of it in the first four bars, the first half of each bar in the next four
    const half = st >= 64;
    for (const [mb, ms, n, len] of MENU_MEL)
      if (mb === bar && ms === b && (!half || ms < 8)) {
        this.tone(midi(n), spb * len * 1.6, 'sine', 0.05, 0, t, M);
        this.tone(midi(n + 12), spb * len, 'triangle', 0.01, 0, t, M);
      }
  }

  /** "Turbo Rush": four on the floor, a rolling bass, a 16th arp, a pad and the lead hook. */
  private raceStep(step: number, t: number, spb: number): void {
    const M = this.music,
      st = step % 256,
      sec = Math.floor(st / 16),
      bar = sec % 4,
      b = st % 16,
      [root, ch] = RACE_CH[bar]!;
    const breakdown = sec === 8 || sec === 9;
    if (b === 0 && (sec === 0 || sec === 10)) this.noiseHit(1.1, 0.1, 5200, 'highpass', t, M);
    if (b % 4 === 0 && (!breakdown || b % 8 === 0)) this.tone(140, 0.16, 'sine', 0.55, 40, t, M);
    if (!breakdown && (b === 4 || b === 12)) {
      this.noiseHit(0.14, 0.24, 2000, 'bandpass', t, M);
      this.tone(230, 0.09, 'triangle', 0.08, 140, t, M);
    }
    if (b % 4 === 2) this.noiseHit(0.09, 0.07, 7000, 'highpass', t, M);
    else if (b % 2 === 1) this.noiseHit(0.03, 0.025, 9000, 'highpass', t, M);
    // rolling bass in 8ths, the octave on the off-beat
    if (b % 2 === 0 && !breakdown) this.pluck(midi(root + (b % 4 === 2 ? 12 : 0)), spb * 1.6, 0.15, t, 'sawtooth', 900);
    // the arp runs all the way through (it carries the breakdown)
    this.pluck(midi(ch[ARP[b % 4]!]! + 12), spb * 0.9, 0.022, t, 'square', 2600);
    // a soft pad under each bar
    if (b === 0) for (const n of ch) this.pluck(midi(n - 12), spb * 15, 0.012, t, 'sawtooth', 1400);
    // the hook: out for the breakdown and the build, an octave up for the lift at the end
    if (sec >= 8 && sec <= 11) return;
    const up = sec >= 12 ? 12 : 0;
    for (const [lb, ls, n, len] of RACE_LEAD)
      if (lb === bar && ls === b) this.pluck(midi(n + up), spb * len * 1.3, 0.05, t, 'sawtooth', 3200);
  }

  /** Engine and squeal follow one kart (player 1's, section 6.5). */
  engine(on: boolean, sp: number, boosting: boolean, squeal: boolean): void {
    const ac = this.ctx;
    if (!ac) return;
    const t = ac.currentTime,
      s = Math.abs(sp),
      gear = Math.min(4, Math.floor(s / 11));
    const f = 48 + gear * 10 + (s - gear * 11) * 4.2 + (boosting ? 30 : 0);
    const live = on && !this.muted;
    // D81: a gear change: up, the revs drop with a short cut in the drive and a clunk; down, a quick rev blip
    if (gear !== this.gear && live && this.focused && s > 3) {
      const up = gear > this.gear,
        G = this.shiftG.gain;
      G.cancelScheduledValues(t);
      G.setValueAtTime(1, t);
      G.linearRampToValueAtTime(up ? 0.3 : 0.75, t + 0.035);
      G.linearRampToValueAtTime(1, t + (up ? 0.17 : 0.1));
      this.noiseHit(up ? 0.07 : 0.05, up ? 0.16 : 0.09, 420, 'lowpass');
      this.tone(up ? 150 : 110, 0.05, 'square', 0.035, up ? 85 : 170);
      if (!up) this.eng.frequency.setValueAtTime(f * 1.35, t);
    }
    this.gear = gear;
    this.eng.frequency.setTargetAtTime(f, t, 0.03);
    this.eng2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    // D75: louder than the race music; D81: louder again
    this.engG.gain.setTargetAtTime(live && this.focused ? 0.13 : 0, t, this.focused ? 0.08 : 0.05);
    this.sqG.gain.setTargetAtTime(live && squeal ? 0.04 : 0, t, 0.05);
  }

  /** D81: the crowd's murmur level (0 off, 1 a full grandstand). */
  crowd(level: number): void {
    const ac = this.ctx;
    if (!ac) return;
    this.crowdG.gain.setTargetAtTime(this.muted ? 0 : level * 0.09, ac.currentTime, 0.6);
  }

  /** D81: the crowd cheers (power 0 to 1): a swell of voices with a few whistles. Cheers are at most every 2 s. */
  cheer(power = 0.7): void {
    const ac = this.ctx;
    if (!ac || this.muted || ac.currentTime - this.lastCheer < 2) return;
    this.lastCheer = ac.currentTime;
    const t = ac.currentTime,
      d = 1.2 + power * 1.4;
    for (const [fc, q, v] of [
      [850, 1.2, 0.55],
      [1350, 1.6, 0.4],
      [2300, 2.2, 0.22],
    ] as const) {
      const s = ac.createBufferSource(),
        bp = ac.createBiquadFilter(),
        g = ac.createGain();
      s.buffer = this.noise;
      s.loop = true;
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(fc * 0.85, t);
      bp.frequency.linearRampToValueAtTime(fc * 1.1, t + d * 0.4);
      bp.frequency.linearRampToValueAtTime(fc, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(v * power * 0.32, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      s.connect(bp).connect(g).connect(this.sfx);
      s.start(t, Math.random());
      s.stop(t + d + 0.05);
    }
    // a whistle or two from the stands
    for (let i = 0; i < Math.round(1 + power * 2); i++) {
      const w = t + 0.2 + Math.random() * d * 0.5,
        f0 = 1700 + Math.random() * 600;
      this.tone(f0, 0.35, 'sine', 0.018 * power, f0 * 1.45, w);
    }
  }

  /** D81: the crowd gasps ("ooh!") at a crash. */
  gasp(): void {
    const ac = this.ctx;
    if (!ac || this.muted || ac.currentTime - this.lastCheer < 1.2) return;
    this.lastCheer = ac.currentTime;
    const t = ac.currentTime,
      s = ac.createBufferSource(),
      bp = ac.createBiquadFilter(),
      g = ac.createGain();
    s.buffer = this.noise;
    s.loop = true;
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(520, t);
    bp.frequency.linearRampToValueAtTime(380, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    s.connect(bp).connect(g).connect(this.sfx);
    s.start(t, Math.random());
    s.stop(t + 1.05);
  }

  dispose(): void {
    clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
