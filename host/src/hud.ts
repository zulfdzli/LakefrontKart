/**
 * Per-player HUD (section 6.2): absolutely positioned DOM over one viewport, built from a template.
 * Ported from the prototype: place, lap, time, item roulette, minimap, drift bar, speed, centre messages,
 * countdown lights, wrong-way and slipstream tags, boost/hit screen-edge flash.
 * Split-screen additions (phase 6): player-colour border and name chip, a FINISHED banner, a reconnecting badge,
 * mirroring for right-hand views, and the shared minimap + standings panel (SharedPanel).
 */
import { MOVE_INFO, MOVE_OF, clamp, type GameState, type Kart, type Track } from '@tk/shared';
import { BRAWL_LIVES } from '@tk/shared';
import { DRIFT_COL } from './art/palette';
import { hexStr } from './art/geo';
import type { Rect } from './renderer';

const ICON: Record<string, string> = {
  turbo: '⚡',
  turbo3: '⚡',
  oil: '🛢️',
  orb: '🎯',
  bolt: '🥏',
  shield: '🛡️',
  rocket: '🚀',
  comet: '☄️',
};
const ROUL = ['⚡', '🛢️', '🎯', '🥏', '🛡️', '🚀', '☄️'];

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
      <div class="itembox"><span class="itemico"></span><b class="itemcnt"></b><b class="itemguard">GUARD</b><i class="movebar"><i class="movefill"></i></i><b class="moveico"></b></div>
    </div>
    <div class="mid">
      <div class="lap pill">LAP 1/3</div>
      <div class="time pill">0:00.00</div>
      <div class="lastlap"></div>
      <div class="split"></div>
    </div>
    <div class="rightCol"><canvas class="mini" width="236" height="236"></canvas><ol class="stand stand1"></ol></div>
  </div>
  <div class="who"><i></i><span class="whoName"></span></div>
  <div class="offline"><b>📵 Reconnecting…</b><span>the computer is driving</span></div>
  <div class="fin"><small>FINISHED</small><b class="finPlace"></b><span class="finTime"></span></div>
  <div class="delta outl"></div>
  <div class="lights"><i></i><i></i><i></i></div>
  <div class="hint">Press DRIFT right as the lights turn green for a rocket start!</div>
  <div class="draftTag">💨 SLIPSTREAM</div>
  <div class="msg"></div>
  <div class="wrong">⚠ WRONG WAY</div>
  <div class="threat">⚠ INCOMING!</div>
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
    const g = c.getContext('2d')!,
      u = size / 236;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    for (let i = 0; i <= T.N; i++) {
      const j = i % T.N;
      if (i) g.lineTo(this.mx(T.CX[j]!), this.mz(T.CZ[j]!));
      else g.moveTo(this.mx(T.CX[j]!), this.mz(T.CZ[j]!));
    }
    g.strokeStyle = '#1d1b2e';
    g.lineWidth = 14 * u;
    g.stroke();
    g.strokeStyle = '#fff';
    g.lineWidth = 9 * u;
    g.stroke();
    g.strokeStyle = '#6c7086';
    g.lineWidth = 5 * u;
    g.stroke();
    // shortcuts: a dashed brown path
    g.setLineDash([5 * u, 4 * u]);
    g.strokeStyle = '#a1887f';
    g.lineWidth = 4 * u;
    for (const sc of T.shortcuts) {
      g.beginPath();
      for (let i = 0; i < sc.pts.length; i += 2)
        if (i) g.lineTo(this.mx(sc.pts[i]!), this.mz(sc.pts[i + 1]!));
        else g.moveTo(this.mx(sc.pts[i]!), this.mz(sc.pts[i + 1]!));
      g.stroke();
    }
    g.setLineDash([]);
    g.save();
    g.translate(this.mx(T.CX[0]!), this.mz(T.CZ[0]!));
    g.rotate(Math.atan2(T.TZ[0]!, T.TX[0]!) + Math.PI / 2);
    g.fillStyle = '#fff';
    g.fillRect(-8 * u, -2.5 * u, 16 * u, 5 * u);
    g.restore();
  }

  /**
   * Draw karts on a target canvas. `me` is drawn as an arrow on top. Without `me` (the shared map), human karts
   * are drawn larger with a white ring, on top of the AI.
   */
  draw(g: CanvasRenderingContext2D, karts: readonly Kart[], colorOf: (k: Kart) => number, me: Kart | null): void {
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.drawImage(this.canvas, 0, 0);
    const u = this.canvas.width / 236;
    for (let pass = 0; pass < 2; pass++)
      for (const k of karts) {
        if (k === me) continue;
        const big = !me && k.slot !== null;
        if (big !== (pass === 1)) continue;
        g.fillStyle = hexStr(colorOf(k));
        g.strokeStyle = big ? '#fff' : '#1d1b2e';
        g.lineWidth = (big ? 3 : 2.5) * u;
        g.beginPath();
        g.arc(this.mx(k.x), this.mz(k.z), (big ? 8.5 : 6.5) * u, 0, Math.PI * 2);
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
  /** More than one viewport: no per-view minimap (the shared panel has it), border and name chip on. */
  private multi = false;
  private standT = 0;
  private standKey = '';

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

  /**
   * Fit the HUD to its viewport. `mirror` puts place and item on the right (outer) edge, for views right of the
   * screen centre, so the centre panel never covers them.
   */
  place(r: Rect, multi = false, mirror = false): void {
    this.multi = multi;
    this.root.classList.toggle('multi', multi);
    this.root.classList.toggle('mirror', mirror);
    const st = this.root.style;
    st.left = r.x + 'px';
    st.top = r.y + 'px';
    st.width = r.w + 'px';
    st.height = r.h + 'px';
    this.fx.width = Math.round(r.w);
    this.fx.height = Math.round(r.h);
    // scale the HUD down in small viewports, but not so far that it stops being readable from the sofa
    const scale = clamp(Math.min(r.w / 820, r.h / 520), 0.66, 1);
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

  setName(name: string): void {
    this.q('whoName').textContent = name;
  }

  /** The phone dropped: the kart is AI-driven until it reconnects (section 6.2). */
  setOffline(on: boolean): void {
    this.cls('offline', 'on', on);
  }

  /** Persistent banner once this player has finished (the camera switches to an orbit). */
  setFinished(place: number | null, time = 0, label = 'FINISHED'): void {
    if (place === null) {
      this.root.classList.remove('done');
      return;
    }
    this.q('fin').querySelector('small')!.textContent = label;
    this.q('finPlace').innerHTML = `${place}<sup>${ord(place)}</sup>`;
    this.q('finTime').textContent = fmtT(time);
    this.root.classList.add('done');
  }

  private splitTimer = 0;
  /** Sector split (section 11.1): the time for the sector just finished, and the change from this player's best. */
  split(n: number, t: number, best: number | null): void {
    const el = this.q('split');
    const d =
      best === null
        ? ''
        : ` <em class="${t <= best ? 'good' : 'bad'}">${t <= best ? '−' : '+'}${Math.abs(t - best).toFixed(2)}</em>`;
    el.innerHTML = `S${n} ${t.toFixed(2)}${d}`;
    el.classList.remove('on');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(this.splitTimer);
    this.splitTimer = window.setTimeout(() => el.classList.remove('on'), 2600);
  }

  setLastLap(t: number | null): void {
    this.q('lastlap').textContent = t === null ? '' : 'Last lap ' + fmtT(t);
  }

  reset(): void {
    this.lastRank = -1;
    this.cache.clear();
    this.clearMsg();
    this.setLastLap(null);
    this.setFinished(null);
    this.standKey = '';
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
    // D69: in a brawl the lap pill shows the kart's lives
    this.txt(
      'lap',
      s.mode === 'brawl'
        ? p.out
          ? 'OUT'
          : '♥'.repeat(p.lives) + '♡'.repeat(Math.max(0, BRAWL_LIVES - p.lives))
        : 'LAP ' + clamp(p.lap, 1, s.laps) + '/' + s.laps,
    );
    this.txt('time', fmtT(s.phase === 'countdown' || s.phase === 'grid' ? 0 : p.finished ? p.finishTime : s.raceTime));
    this.txt('spd', String(Math.round(Math.abs(p.sp) * 3.2)));
    let ico = '';
    if (p.roll > 0) ico = ROUL[Math.floor(s.time * 14) % ROUL.length]!;
    else if (p.item) ico = ICON[p.item] ?? '';
    this.txt('itemico', ico);
    this.cls('itembox', 'spin', p.roll > 0);
    const cnt = p.item === 'turbo3' ? '×' + p.itemUses : '';
    if (this.txt('itemcnt', cnt)) this.q('itemcnt').style.display = cnt ? 'block' : 'none';
    // D65 item guard: a held Oil Slick, Orb or Disc trails behind and blocks one Orb or Disc
    this.cls('itemguard', 'on', p.roll <= 0 && (p.item === 'oil' || p.item === 'orb' || p.item === 'bolt'));
    // D74: the signature move's meter under the item box, its icon lit when it is ready
    const mv = s.moves ? MOVE_OF[p.ch.id] : undefined;
    this.cls('movebar', 'on', !!mv);
    if (mv) {
      const pc = Math.round(p.meter * 50) * 2;
      if (this.txt('moveico', p.meter >= 1 ? MOVE_INFO[mv].icon : '')) this.cls('moveico', 'on', p.meter >= 1);
      if (this.cache.get('movefill') !== String(pc)) {
        this.cache.set('movefill', String(pc));
        this.q('movefill').style.width = pc + '%';
      }
    }
    // D76: a drift charges no boost any more, so its charge bar only shows when boosts are on
    this.cls('driftbar', 'on', p.drifting && s.handling.boosts);
    const bw = p.drifting ? (p.driftLevel >= 3 ? 100 : Math.round((p.driftT - Math.floor(p.driftT)) * 100)) : 0;
    const f = this.q('driftfill');
    f.style.width = bw + '%';
    f.style.background = hexStr(DRIFT_COL[p.drifting ? Math.min(3, p.driftLevel + 1) : 0]!);
    this.cls('wrong', 'on', p.wrongT > 1 && !p.finished && p.threat <= 0);
    this.cls('threat', 'on', p.threat > 0 && !p.finished);
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
    // D76: no rocket start without the boosts, so no hint for it
    this.cls('hint', 'on', s.phase === 'countdown' && s.handling.boosts);
    if (!this.multi) {
      this.minimap.draw(this.mini, s.karts, this.colorOf, p);
      // single player: a compact standings list under the corner minimap, refreshed at 5 Hz
      if (s.time - this.standT > 0.2 || s.time < this.standT) {
        this.standT = s.time;
        this.standKey = renderStandings(this.q('stand1'), s, this.colorOf, this.standKey, p);
      }
    }
  }

  dispose(): void {
    clearTimeout(this.msgTimer);
    this.root.remove();
  }
}

/** Fill an <ol> with the live order. Returns a key so callers can skip identical updates. */
export function renderStandings(
  ol: HTMLElement,
  s: Readonly<GameState>,
  colorOf: (k: Kart) => number,
  prevKey: string,
  me: Kart | null = null,
): string {
  const order = s.karts.slice().sort((a, b) => a.rank - b.rank);
  const rows = order.map((k) => ({
    k,
    right:
      s.mode === 'brawl' ? (k.out ? 'OUT' : '♥'.repeat(k.lives)) : k.finished ? '✓' : `L${clamp(k.lap, 1, s.laps)}`,
  }));
  const key = rows.map((r) => `${r.k.id}:${r.right}`).join('|');
  if (key === prevKey) return key;
  ol.innerHTML = rows
    .map(
      ({ k, right }) =>
        `<li class="${k.slot !== null ? 'h' : ''}${k === me ? ' me' : ''}" style="--c:${hexStr(colorOf(k))}">` +
        `<b>${k.rank + 1}</b><i></i><span>${escapeHtml(k.name)}</span><em>${right}</em></li>`,
    )
    .join('');
  return key;
}

const HTML_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (t: string): string => t.replace(/[&<>"']/g, (c) => HTML_ESC[c]!);

/**
 * The shared minimap and live standings for split-screen (section 6.2): in the spare gaps for 3 and 5 players
 * (map left, standings right), or one compact panel at the screen centre for 2 and 4 players.
 */
export class SharedPanel {
  readonly root = document.createElement('div');
  private readonly mapBox = document.createElement('div');
  private readonly standBox = document.createElement('div');
  private readonly map: MinimapBase;
  private readonly g: CanvasRenderingContext2D;
  private readonly ol = document.createElement('ol');
  private standT = -1;
  private key = '';
  private active = false;

  constructor(
    parent: HTMLElement,
    T: Track,
    private readonly colorOf: (k: Kart) => number,
  ) {
    this.root.className = 'shared';
    this.map = new MinimapBase(T, 320);
    const c = document.createElement('canvas');
    c.width = c.height = 320;
    this.g = c.getContext('2d')!;
    this.mapBox.className = 'sbox smap';
    this.mapBox.appendChild(c);
    this.standBox.className = 'sbox sstand';
    this.standBox.innerHTML = '<h4>STANDINGS</h4>';
    this.ol.className = 'stand';
    this.standBox.appendChild(this.ol);
    this.root.append(this.mapBox, this.standBox);
    parent.appendChild(this.root);
  }

  /** 'split': map in rect a, standings in rect b. 'centre': both in one panel at the screen centre. */
  place(mode: 'none' | 'split' | 'centre', a?: Rect, b?: Rect): void {
    this.active = mode !== 'none';
    const on = this.root.classList.contains('on');
    this.root.className = 'shared ' + mode + (on ? ' on' : '');
    const put = (el: HTMLElement, r: Rect): void => {
      const st = el.style;
      st.left = Math.round(r.x) + 'px';
      st.top = Math.round(r.y) + 'px';
      st.width = Math.round(r.w) + 'px';
      st.height = r.h ? Math.round(r.h) + 'px' : '';
    };
    if (mode === 'split' && a && b) {
      const m = Math.min(a.w - 28, a.h - 28, 340);
      put(this.mapBox, { x: a.x + (a.w - m) / 2, y: a.y + (a.h - m) / 2, w: m, h: m });
      const w = Math.min(b.w - 28, 300),
        h = Math.min(b.h - 28, 330);
      // the standings box fits its rows and is centred vertically in its gap (CSS translateY(-50%))
      put(this.standBox, { x: b.x + (b.w - w) / 2, y: b.y + b.h / 2, w, h: 0 });
      this.root.style.setProperty('--ps', String(clamp(Math.min(w / 300, h / 330), 0.7, 1.15)));
    } else if (mode === 'centre') {
      const W = window.innerWidth,
        H = window.innerHeight;
      const m = clamp(Math.min(W, H) * 0.2, 130, 210);
      put(this.mapBox, { x: W / 2 - m - 3, y: H / 2 - m / 2, w: m, h: m });
      put(this.standBox, { x: W / 2 + 3, y: H / 2, w: m * 1.05, h: 0 });
      this.root.style.setProperty('--ps', String(clamp(m / 250, 0.6, 0.85)));
    }
  }

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on && this.active);
  }

  update(s: Readonly<GameState>): void {
    if (!this.active) return;
    this.map.draw(this.g, s.karts, this.colorOf, null);
    if (s.time - this.standT > 0.2 || s.time < this.standT) {
      this.standT = s.time;
      this.key = renderStandings(this.ol, s, this.colorOf, this.key);
    }
  }

  reset(): void {
    this.key = '';
    this.standT = -1;
  }

  dispose(): void {
    this.root.remove();
  }
}
