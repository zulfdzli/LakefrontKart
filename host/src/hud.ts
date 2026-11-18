/**
 * Per-player HUD (section 6.2): absolutely positioned DOM over one viewport, built from a template.
 * Ported from the prototype: place, lap, time, item roulette, minimap, drift bar, speed, centre messages,
 * countdown lights, wrong-way and slipstream tags, boost/hit screen-edge flash.
 */
import { clamp, type GameState, type Kart, type Track } from '@tk/shared';
import { DRIFT_COL } from './art/palette';
import { hexStr } from './art/geo';
import type { Rect } from './renderer';

const ICON: Record<string, string> = { turbo: '⚡', turbo3: '⚡', oil: '🛢️', orb: '🎯', bolt: '🥏', shield: '🛡️' };
const ROUL = ['⚡', '🛢️', '🎯', '🥏', '🛡️'];

export const ord = (n: number): string =>
  n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
export const fmtT = (t: number): string => {
  const m = Math.floor(t / 60),
    s = t - m * 60;
  return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
};

const TEMPLATE = /* html */ `
  <div class="flash"></div>
  <canvas class="fx"></canvas>
  <div class="top">
    <div class="leftCol">
      <div class="place outl"><span class="placeN">6</span><sup class="placeS">th</sup><small class="placeOf">/6</small></div>
      <div class="itembox"><span class="itemico"></span><b class="itemcnt"></b></div>
    </div>
    <div class="mid">
      <div class="lap pill">LAP 1/3</div>
      <div class="time pill">0:00.00</div>
      <div class="lastlap"></div>
    </div>
    <div class="rightCol"><canvas class="mini" width="236" height="236"></canvas></div>
  </div>
  <div class="delta outl"></div>
  <div class="lights"><i></i><i></i><i></i></div>
  <div class="hint">Press DRIFT right as the lights turn green for a rocket start!</div>
  <div class="draftTag">💨 SLIPSTREAM</div>
  <div class="msg"></div>
  <div class="wrong">⚠ WRONG WAY</div>
  <div class="bottom">
    <div class="driftbar"><i class="driftfill"></i></div>
    <div class="speed"><span class="spd">0</span> <small>km/h</small></div>
  </div>
`;

/** Static minimap base (track outline), shared by every HUD for the same track. */
export class MinimapBase {
  readonly canvas = document.createElement('canvas');
  readonly mx: (x: number) => number;
  readonly mz: (z: number) => number;
  constructor(T: Track, size = 236) {
    const c = this.canvas;
    c.width = size;
    c.height = size;
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (let i = 0; i < T.N; i++) {
      x0 = Math.min(x0, T.CX[i]!);
      x1 = Math.max(x1, T.CX[i]!);
      z0 = Math.min(z0, T.CZ[i]!);
      z1 = Math.max(z1, T.CZ[i]!);
    }
    const sc = (size - 34) / Math.max(x1 - x0, z1 - z0);
    this.mx = (x) => 17 + (x - x0) * sc + (size - 34 - (x1 - x0) * sc) / 2;
    this.mz = (z) => 17 + (z - z0) * sc + (size - 34 - (z1 - z0) * sc) / 2;
    const g = c.getContext('2d')!;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= T.N; i++) {
      const j = i % T.N;
      if (i) g.lineTo(this.mx(T.CX[j]!), this.mz(T.CZ[j]!));
      else g.moveTo(this.mx(T.CX[j]!), this.mz(T.CZ[j]!));
    }
    g.strokeStyle = '#1d1b2e';
    g.lineWidth = 14;
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 9;
    g.stroke();
    g.strokeStyle = '#6c7086';
    g.lineWidth = 5;
    g.stroke();
    g.save();
    g.translate(this.mx(T.CX[0]!), this.mz(T.CZ[0]!));
    g.rotate(Math.atan2(T.TZ[0]!, T.TX[0]!) + Math.PI / 2);
    g.fillStyle = '#fff';
    g.fillRect(-8, -2.5, 16, 5);
    g.restore();
  }

  /** Draw karts on a target canvas. `me` is drawn as an arrow on top. */
  draw(g: CanvasRenderingContext2D, karts: readonly Kart[], colorOf: (k: Kart) => number, me: Kart | null): void {
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.drawImage(this.canvas, 0, 0);
    for (const k of karts) {
      if (k === me) continue;
      g.fillStyle = hexStr(colorOf(k));
      g.strokeStyle = '#1d1b2e';
      g.lineWidth = 2.5;
      g.beginPath();
      g.arc(this.mx(k.x), this.mz(k.z), 6.5, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (me) {
      const a = Math.atan2(Math.cos(me.h), Math.sin(me.h));
      g.save();
      g.translate(this.mx(me.x), this.mz(me.z));
      g.rotate(a);
      g.fillStyle = hexStr(colorOf(me));
      g.strokeStyle = '#fff';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(12, 0);
      g.lineTo(-8, 8);
      g.lineTo(-4, 0);
      g.lineTo(-8, -8);
      g.closePath();
      g.fill();
      g.stroke();
      g.restore();
    }
  }
}

export class PlayerHud {
  readonly root = document.createElement('div');
  private readonly q = <T extends HTMLElement = HTMLElement>(cls: string): T => this.root.querySelector<T>('.' + cls)!;
  private readonly cache = new Map<string, string | boolean>();
  private readonly mini: CanvasRenderingContext2D;
  readonly fx: HTMLCanvasElement;
  private lastRank = -1;
  private msgTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly minimap: MinimapBase,
    private readonly colorOf: (k: Kart) => number,
    accent: string,
  ) {
    this.root.className = 'phud';
    this.root.innerHTML = TEMPLATE;
    this.root.style.setProperty('--accent', accent);
    parent.appendChild(this.root);
    this.mini = this.q<HTMLCanvasElement>('mini').getContext('2d')!;
    this.fx = this.q<HTMLCanvasElement>('fx');
  }

  place(r: Rect): void {
    const st = this.root.style;
    st.left = r.x + 'px';
    st.top = r.y + 'px';
    st.width = r.w + 'px';
    st.height = r.h + 'px';
    this.fx.width = Math.round(r.w);
    this.fx.height = Math.round(r.h);
    // scale the HUD down in small viewports so it stays readable without covering the road
    const scale = clamp(Math.min(r.w / 900, r.h / 560), 0.55, 1);
    st.setProperty('--s', String(scale));
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  private txt(cls: string, v: string): boolean {
    if (this.cache.get(cls) === v) return false;
    this.cache.set(cls, v);
    this.q(cls).textContent = v;
    return true;
  }

  private cls(cls: string, name: string, on: boolean): void {
    const key = cls + '.' + name;
    if (this.cache.get(key) === on) return;
    this.cache.set(key, on);
    this.q(cls).classList.toggle(name, on);
  }

  say(text: string, ms: number, extra = ''): void {
    const m = this.q('msg');
    m.textContent = text;
    m.className = 'msg show' + (extra ? ' ' + extra : '');
    m.style.animation = 'none';
    void m.offsetWidth;
    m.style.animation = '';
    clearTimeout(this.msgTimer);
    if (ms) this.msgTimer = window.setTimeout(() => (m.className = 'msg'), ms);
  }

  clearMsg(): void {
    this.q('msg').className = 'msg';
  }

  flash(kind: 'boost' | 'hit'): void {
    const f = this.q('flash');
    f.className = 'flash ' + (kind === 'boost' ? 'boost ' : '') + 'on';
    requestAnimationFrame(() =>
      requestAnimationFrame(() => (f.className = 'flash' + (kind === 'boost' ? ' boost' : ''))),
    );
  }

  setLastLap(t: number | null): void {
    this.q('lastlap').textContent = t === null ? '' : 'Last lap ' + fmtT(t);
  }

  reset(): void {
    this.lastRank = -1;
    this.cache.clear();
    this.clearMsg();
    this.setLastLap(null);
  }

  update(s: Readonly<GameState>, p: Kart): void {
    const rk = p.rank + 1;
    this.txt('placeOf', '/' + s.karts.length);
    if (this.txt('placeN', String(rk))) {
      this.q('placeS').textContent = ord(rk);
      const el = this.q('place');
      el.classList.remove('pop');
      void el.offsetWidth;
      el.classList.add('pop');
    }
    if (this.lastRank >= 0 && rk !== this.lastRank && s.phase === 'race' && s.raceTime > 1.5) {
      const d = this.q('delta');
      d.className = 'delta outl';
      void d.offsetWidth;
      d.className = 'delta outl ' + (rk < this.lastRank ? 'up' : 'down');
      d.textContent = rk < this.lastRank ? '▲' : '▼';
    }
    this.lastRank = rk;
    this.txt('lap', 'LAP ' + clamp(p.lap, 1, s.laps) + '/' + s.laps);
    this.txt('time', fmtT(s.phase === 'countdown' || s.phase === 'grid' ? 0 : p.finished ? p.finishTime : s.raceTime));
    this.txt('spd', String(Math.round(Math.abs(p.sp) * 3.2)));
    let ico = '';
    if (p.roll > 0) ico = ROUL[Math.floor(s.time * 14) % ROUL.length]!;
    else if (p.item) ico = ICON[p.item] ?? '';
    this.txt('itemico', ico);
    this.cls('itembox', 'spin', p.roll > 0);
    const cnt = p.item === 'turbo3' ? '×' + p.itemUses : '';
    if (this.txt('itemcnt', cnt)) this.q('itemcnt').style.display = cnt ? 'block' : 'none';
    this.cls('driftbar', 'on', p.drifting);
    const bw = p.drifting ? (p.driftLevel >= 3 ? 100 : Math.round((p.driftT - Math.floor(p.driftT)) * 100)) : 0;
    const f = this.q('driftfill');
    f.style.width = bw + '%';
    f.style.background = hexStr(DRIFT_COL[p.drifting ? Math.min(3, p.driftLevel + 1) : 0]!);
    this.cls('wrong', 'on', p.wrongT > 1 && !p.finished);
    this.cls('draftTag', 'on', p.drafting && p.boost <= 0);
    // countdown lights
    const L = this.q('lights'),
      cd = s.phase === 'countdown' ? s.cd : -1,
      li = L.children;
    const n = cd > 3 ? 0 : cd > 2 ? 1 : cd > 1 ? 2 : cd > 0 ? 3 : 0;
    const goOn = s.phase === 'race' && s.raceTime < 1.2;
    this.cls('lights', 'on', s.phase === 'countdown' || goOn);
    for (let i = 0; i < 3; i++) {
      const c = goOn ? 'g' : i < n ? 'r' : '';
      if (li[i]!.className !== c) li[i]!.className = c;
    }
    this.cls('hint', 'on', s.phase === 'countdown');
    this.minimap.draw(this.mini, s.karts, this.colorOf, p);
  }

  dispose(): void {
    clearTimeout(this.msgTimer);
    this.root.remove();
  }
}
