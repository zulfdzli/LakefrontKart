/**
 * The driving remote (D14). Multi-touch safe: Pointer Events with setPointerCapture on every control,
 * and every held state is released on pointercancel, blur and visibilitychange (section 7.2).
 * Press feedback (animation + haptic tick) happens locally, before any network round trip (section 12.1).
 */
import { SLOT_COLORS, type HudUpdate, type SteeringScheme } from '@tk/shared';
import { haptic } from './haptics';
import type { InputState } from './net';

const ICON: Record<string, string> = {
  turbo: '⚡',
  turbo3: '⚡',
  oil: '🛢️',
  orb: '🎯',
  bolt: '🥏',
  shield: '🛡️',
  roll: '🎲',
};
const ord = (n: number): string =>
  n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
const DRIFT_COL = ['#fff3b0', '#4fc3f7', '#ffa726', '#e040fb'];
/** Swipe distance (CSS px) on ITEM that fires it backwards. */
const SWIPE_BACK_PX = 26;

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export class Remote {
  readonly state: InputState = { steer: 0, throttle: true, brake: false, drift: false, item: null };
  scheme: SteeringScheme = (localStorage.getItem('tk_steer') as SteeringScheme | null) ?? 'buttons';
  sensitivity = Number(localStorage.getItem('tk_sens') ?? '1') || 1;
  assist = localStorage.getItem('tk_assist') === '1';
  onItem: ((dir: 'forward' | 'back') => void) | null = null;
  onSettings: (() => void) | null = null;
  onLeave: (() => void) | null = null;
  onSchemeChange: (() => void) | null = null;
  private steerRaw = 0;
  private readonly emptyItemIcon = $('itemIc').innerHTML;
  private readonly releasers: (() => void)[] = [];
  private toastTimer = 0;

  constructor() {
    this.buildGrille();
    this.bindSteer();
    this.bindHold('brakeBtn', (on) => {
      this.state.brake = on;
      this.state.throttle = !on;
    });
    this.bindHold('driftBtn', (on) => {
      this.state.drift = on;
    });
    this.bindItem();
    this.bindTap('minusBtn', () => this.nudgeSensitivity(-0.1));
    this.bindTap('plusBtn', () => this.nudgeSensitivity(0.1));
    this.bindTap('menuBtn', () => this.onSettings?.());
    this.bindTap('powerBtn', () => this.onLeave?.());
    const releaseAll = (): void => this.releaseAll();
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });
    this.applyScheme();
  }

  private buildGrille(): void {
    const g = $('grille');
    for (let i = 0; i < 15; i++) g.appendChild(document.createElement('i'));
  }

  setScheme(s: SteeringScheme): void {
    this.scheme = s;
    localStorage.setItem('tk_steer', s);
    this.applyScheme();
    this.onSchemeChange?.();
  }

  setAssist(on: boolean): void {
    this.assist = on;
    localStorage.setItem('tk_assist', on ? '1' : '0');
    this.onSchemeChange?.();
  }

  private applyScheme(): void {
    $('dpad').hidden = this.scheme !== 'buttons';
    $('slider').hidden = this.scheme !== 'slider';
    this.setSteer(0);
  }

  private nudgeSensitivity(d: number): void {
    this.sensitivity = Math.round(Math.max(0.6, Math.min(1.4, this.sensitivity + d)) * 10) / 10;
    localStorage.setItem('tk_sens', String(this.sensitivity));
    this.toast(
      `Steering ${this.sensitivity < 1 ? 'gentler' : this.sensitivity > 1 ? 'sharper' : 'normal'} · ${this.sensitivity.toFixed(1)}`,
    );
    this.setSteer(this.steerRaw);
    this.onSchemeChange?.();
  }

  /** Map the raw touch value (-1..1) through dead zone, response curve and sensitivity (section 12.1). */
  private setSteer(raw: number): void {
    this.steerRaw = raw;
    let v: number;
    if (this.scheme === 'buttons') v = Math.sign(raw) * Math.min(1, 0.6 + 0.4 * this.sensitivity);
    else {
      const dz = 0.08,
        a = Math.abs(raw);
      v = a <= dz ? 0 : Math.sign(raw) * Math.pow((a - dz) / (1 - dz), 1.5) * this.sensitivity;
    }
    this.state.steer = Math.max(-1, Math.min(1, v));
    const dp = $('dpad');
    dp.classList.toggle('left', raw < 0);
    dp.classList.toggle('right', raw > 0);
    $('knob').style.setProperty('--x', String(Math.max(-1, Math.min(1, raw))));
  }

  private bindSteer(): void {
    const zone = $('steerZone');
    let pid: number | null = null;
    const read = (e: PointerEvent): void => {
      const target = this.scheme === 'buttons' ? $('dpad') : $('slider');
      const r = target.getBoundingClientRect();
      const cx = r.left + r.width / 2,
        half = r.width / 2;
      const x = (e.clientX - cx) / half;
      if (this.scheme === 'buttons') {
        const dz = 0.12;
        this.setSteer(x < -dz ? -1 : x > dz ? 1 : 0);
      } else this.setSteer(Math.max(-1, Math.min(1, x)));
    };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      read(e);
      haptic('tap');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      const before = Math.sign(this.steerRaw);
      read(e);
      if (this.scheme === 'buttons' && Math.sign(this.steerRaw) !== before && this.steerRaw !== 0) haptic('tap');
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      pid = null;
      this.setSteer(0);
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) zone.addEventListener(ev, end);
    this.releasers.push(() => {
      pid = null;
      this.setSteer(0);
    });
  }

  private bindHold(id: string, set: (on: boolean) => void): void {
    const el = $(id);
    let pid: number | null = null;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.classList.add('on');
      set(true);
      haptic('tap');
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId !== pid) return;
      pid = null;
      el.classList.remove('on');
      set(false);
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) el.addEventListener(ev, end);
    this.releasers.push(() => {
      pid = null;
      el.classList.remove('on');
      set(false);
    });
  }

  private bindTap(id: string, fn: () => void): void {
    const el = $(id);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.classList.add('on');
      haptic('tap');
    });
    const up = (): void => el.classList.remove('on');
    el.addEventListener('pointerup', (e) => {
      if (el.classList.contains('on')) {
        up();
        e.preventDefault();
        fn();
      }
    });
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  /** ITEM: tap fires forward (backward while BRAKE is held); swiping down on it fires backward (section 12.3). */
  private bindItem(): void {
    const el = $('itemBtn');
    let pid: number | null = null,
      y0 = 0,
      used = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (pid !== null) return;
      pid = e.pointerId;
      y0 = e.clientY;
      used = false;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      el.classList.add('on');
      haptic('tap');
    });
    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid || used) return;
      if (e.clientY - y0 > SWIPE_BACK_PX) {
        used = true;
        el.classList.add('back');
        this.onItem?.('back');
      }
    });
    const end = (e: PointerEvent, fire: boolean): void => {
      if (e.pointerId !== pid) return;
      pid = null;
      el.classList.remove('on', 'back');
      if (fire && !used) this.onItem?.(this.state.brake ? 'back' : 'forward');
    };
    el.addEventListener('pointerup', (e) => end(e, true));
    el.addEventListener('pointercancel', (e) => end(e, false));
    this.releasers.push(() => {
      pid = null;
      el.classList.remove('on', 'back');
    });
  }

  releaseAll(): void {
    for (const r of this.releasers) r();
    this.state.steer = 0;
    this.state.brake = false;
    this.state.throttle = true;
    this.state.drift = false;
  }

  /* ---------------- display ---------------- */

  setPlayer(slot: number, name: string): void {
    const color = SLOT_COLORS[slot] ?? '#888';
    document.documentElement.style.setProperty('--me', color);
    $('sName').textContent = name;
    document.querySelectorAll('.leds').forEach((l) => {
      Array.from(l.children).forEach((d, i) => d.classList.toggle('lit', i === slot));
    });
  }

  setPing(ms: number | null): void {
    $('sPing').textContent = ms === null ? '– ms' : `${ms} ms`;
    $('sPing').classList.toggle('bad', ms !== null && ms > 80);
  }

  setHud(h: HudUpdate): void {
    $('sPlace').innerHTML = `${h.place}<sup>${ord(h.place)}</sup><small>/${h.totalRacers}</small>`;
    $('sLap').textContent = h.finished ? 'FINISHED' : `LAP ${h.lap}/${h.laps}`;
    const ic = h.item ? (ICON[h.item] ?? '🎁') : '';
    $('sItem').textContent = ic + (h.item === 'turbo3' && h.itemUses > 1 ? `×${h.itemUses}` : '');
    const itemIc = $('itemIc');
    if (ic) itemIc.textContent = ic;
    else if (!itemIc.querySelector('svg')) itemIc.innerHTML = this.emptyItemIcon;
    $('itemBtn').classList.toggle('has', !!h.item && h.item !== 'roll');
    $('itemBtn').classList.toggle('rolling', h.item === 'roll');
    const fill = $('chargeFill');
    fill.style.width = h.drifting ? `${Math.min(100, 34 + h.driftLevel * 22)}%` : '0%';
    fill.style.background = DRIFT_COL[Math.min(3, h.drifting ? h.driftLevel + 1 : 0)]!;
    $('driftBtn').dataset.lvl = h.drifting ? String(h.driftLevel) : '';
    document.getElementById('drive')!.classList.toggle('boosting', h.boosting);
  }

  /** Screen-edge flash: player colour on boost, red on a hit (section 7.2). Pulses the grille too. */
  flash(kind: 'boost' | 'hit'): void {
    const e = $('edge');
    e.className = 'edge ' + kind;
    void e.offsetWidth;
    e.className = 'edge ' + kind + ' on';
    const g = $('grille');
    g.classList.remove('pulse');
    void g.offsetWidth;
    g.classList.add('pulse');
  }

  toast(text: string): void {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('on');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('on'), 1400);
  }
}
