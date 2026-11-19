/**
 * Procedural WebAudio (prototype): the kart engine, tyre squeal, sound effects and a step-sequencer music loop that
 * speeds up on the final lap. Browsers need a user gesture before audio can start: unlock() runs on the first key
 * press, click or tap anywhere (and on the game's own buttons). Everything goes through a master limiter so nothing
 * clips (D60). The engine fades out while the tab is hidden or unfocused. D64: the F1 V8 engine (D60-D62) is gone,
 * at the user's request; this is the original kart engine again.
 */
import { clamp } from '@tk/shared';

const midi = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
const PROG: [number, number[]][] = [
  [48, [60, 64, 67]],
  [43, [59, 62, 67]],
  [45, [57, 60, 64]],
  [41, [57, 60, 65]],
];
const MEL = (() => {
  const sc = [72, 74, 76, 79, 81, 84];
  let s = 11;
  const r = (): number => (s = (s * 16807) % 2147483647) / 2147483647;
  const out: number[] = [];
  let n = 2;
  for (let i = 0; i < 64; i++) {
    if (i % 16 === 15) {
      out.push(-1);
      continue;
    }
    if (i % 4 === 0 || r() < 0.45) {
      n = clamp(n + Math.floor(r() * 5) - 2, 0, sc.length - 1);
      out.push(sc[n]!);
    } else out.push(-1);
  }
  return out;
})();
const BASS_STEPS = [0, 3, 6, 8, 11, 14];

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
        engF.connect(this.engG);
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

  private schedMusic(): void {
    const ac = this.ctx;
    if (!ac) return;
    const want = this.mood !== 'off';
    this.music.gain.setTargetAtTime(want ? (this.mood === 'menu' ? 0.35 : 0.5) : 0, ac.currentTime, 0.3);
    if (!want) {
      this.next = ac.currentTime + 0.05;
      return;
    }
    const spb = 60 / (128 * this.tempo) / 4;
    if (this.next < ac.currentTime) this.next = ac.currentTime + 0.02;
    while (this.next < ac.currentTime + 0.12) {
      const st = this.step % 64,
        b = st % 16,
        ch = PROG[Math.floor(st / 16)]!,
        t = this.next,
        M = this.music;
      if (b % 4 === 0) this.tone(150, 0.14, 'sine', 0.5, 45, t, M);
      if (b === 4 || b === 12) this.noiseHit(0.13, 0.22, 1800, 'highpass', t, M);
      if (b % 2 === 1) this.noiseHit(0.04, 0.07, 7500, 'highpass', t, M);
      if (BASS_STEPS.includes(b)) this.tone(midi(ch[0]), spb * 1.7, 'triangle', 0.22, 0, t, M);
      if (b === 2 || b === 6 || b === 10 || b === 14)
        for (const m of ch[1]) this.tone(midi(m), spb * 0.9, 'square', 0.025, 0, t, M);
      const mel = MEL[st]!;
      if (mel > 0) this.tone(midi(mel), spb * 1.8, 'square', 0.045, 0, t, M);
      this.next += spb;
      this.step++;
    }
  }

  /** Engine and squeal follow one kart (player 1's, section 6.5). */
  engine(on: boolean, sp: number, boosting: boolean, squeal: boolean): void {
    const ac = this.ctx;
    if (!ac) return;
    const t = ac.currentTime,
      s = Math.abs(sp),
      gear = Math.min(4, Math.floor(s / 11));
    const f = 48 + gear * 10 + (s - gear * 11) * 4.2 + (boosting ? 30 : 0);
    this.eng.frequency.setTargetAtTime(f, t, 0.03);
    this.eng2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    const live = on && !this.muted;
    this.engG.gain.setTargetAtTime(live && this.focused ? 0.045 : 0, t, this.focused ? 0.08 : 0.05);
    this.sqG.gain.setTargetAtTime(live && squeal ? 0.04 : 0, t, 0.05);
  }

  dispose(): void {
    clearInterval(this.timer);
    void this.ctx?.close();
    this.ctx = null;
  }
}
