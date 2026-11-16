import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import { CHARS, type Difficulty, type Kart } from '@tk/shared';
import { World } from './renderer';
import { RaceSession } from './session';
import { Audio } from './audio';
import { Keyboard } from './input-keyboard';
import { DebugOverlay } from './debug';
import { fmtT, ord } from './hud';

/*
 * Phase 4: single player on the keyboard, to check the port against the prototype.
 * Phase 5 replaces the title screen with the QR lobby and phone controllers.
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const world = new World($<HTMLCanvasElement>('c'));
const audio = new Audio();
const keyboard = new Keyboard();
const debug = new DebugOverlay(world, $('debug'));

const settings = {
  ci: Number(localStorage.getItem('tk_char') ?? 1) % CHARS.length,
  diff: (localStorage.getItem('tk_diff') as Difficulty | null) ?? 'normal',
  laps: 2,
  seed: Math.floor(Math.random() * 1e9),
};

let session: RaceSession | null = null;
let autopilot = false;

function fullRect() {
  return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
}

function newSession(): void {
  session?.dispose();
  const names = new Map<number, string>([[0, 'You']]);
  session = new RaceSession(
    { seed: settings.seed, humans: [{ slot: 0, ci: settings.ci, name: 'You' }], aiFill: true, laps: settings.laps, difficulty: settings.diff, itemsOn: true },
    world, audio, $('huds'), names,
  );
  session.layout([fullRect()]);
  session.onResults = showResults;
  if (autopilot) session.game.setHumanAi(0, true);
  updateTitle();
}

function startRace(): void {
  audio.unlock();
  audio.click();
  if (!session || session.stage !== 'preview') { settings.seed = Math.floor(Math.random() * 1e9); newSession(); }
  $('title').classList.add('hidden');
  $('results').classList.add('hidden');
  session!.start();
}

function toTitle(): void {
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  newSession();
  $('title').classList.remove('hidden');
}

function updateTitle(): void {
  const c = CHARS[settings.ci]!;
  $('charName').textContent = `${c.emoji} ${c.name}`;
  $('diffName').textContent = settings.diff[0]!.toUpperCase() + settings.diff.slice(1);
}

function showResults(order: Kart[]): void {
  const me = session!.players[0]!.kart;
  const place = me.rank + 1;
  $('resTitle').textContent = place === 1 ? '🏆 YOU WIN!' : `${place}${ord(place)} PLACE`;
  $('standings').innerHTML = order
    .map((k, i) => `<li class="${k === me ? 'me' : ''}"><span>${i + 1}. ${k.ch.emoji} ${k === me ? 'You' : k.name}</span><span>${k.finished ? fmtT(k.finishTime) : '—'}</span></li>`)
    .join('');
  $('resBest').textContent = me.bestLap ? `Your best lap: ${fmtT(me.bestLap)}` : '';
  $('results').classList.remove('hidden');
}

function setPaused(p: boolean): void {
  if (!session || session.stage !== 'racing') return;
  session.paused = p;
  $('pause').classList.toggle('hidden', !p);
}

/* ---------------- keys ---------------- */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const onTitle = !$('title').classList.contains('hidden');
  if (e.key === 'Enter') {
    if (onTitle || !$('results').classList.contains('hidden')) startRace();
  } else if (e.key === 'Escape') {
    if (session?.stage === 'racing' && !session.paused) setPaused(true);
    else toTitle();
  } else if (e.key === 'p' || e.key === 'P') setPaused(!session?.paused);
  else if (e.key === 'm' || e.key === 'M') { audio.unlock(); audio.setMuted(!audio.muted); }
  else if (e.key === 'f' || e.key === 'F') debug.toggleFps();
  else if (e.key === 'd' || e.key === 'D') debug.toggleFull();
  else if (onTitle && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
    settings.ci = (settings.ci + (e.key === 'ArrowRight' ? 1 : CHARS.length - 1)) % CHARS.length;
    localStorage.setItem('tk_char', String(settings.ci));
    audio.unlock(); audio.click();
    newSession();
  } else if (onTitle && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const order: Difficulty[] = ['easy', 'normal', 'hard'];
    settings.diff = order[(order.indexOf(settings.diff) + (e.key === 'ArrowUp' ? 1 : 2)) % 3]!;
    localStorage.setItem('tk_diff', settings.diff);
    audio.unlock(); audio.click();
    updateTitle();
  }
});
$('startBtn').addEventListener('click', startRace);
$('againBtn').addEventListener('click', startRace);
$('menuBtn').addEventListener('click', toTitle);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('quitBtn').addEventListener('click', toTitle);
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('resize', () => { world.resize(); session?.layout([fullRect()]); });

/* ---------------- loop ---------------- */
world.resize();
newSession();
let last = performance.now();
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  if (session) {
    if (session.stage === 'racing' && !autopilot && !session.paused) session.setInput(0, keyboard.read());
    session.frame(dt);
    world.render(session.views(), (v) => session!.focusOf(v));
  }
  debug.frame(dt, performance.now() - t0);
}
requestAnimationFrame(frame);

/* ---------------- automation hook (tools/capture.ts) ---------------- */
declare global {
  interface Window {
    __tk: {
      ready: boolean;
      race(opts: { seed?: number; ci?: number; diff?: Difficulty; laps?: number; autopilot?: boolean }): void;
      advance(seconds: number): void;
      state(): unknown;
      session(): RaceSession | null;
      info(): { calls: number; triangles: number; pixelRatio: number };
    };
  }
}
window.__tk = {
  ready: true,
  race(opts) {
    if (opts.seed !== undefined) settings.seed = opts.seed;
    if (opts.ci !== undefined) settings.ci = opts.ci;
    if (opts.diff) settings.diff = opts.diff;
    if (opts.laps) settings.laps = opts.laps;
    autopilot = !!opts.autopilot;
    newSession();
    $('title').classList.add('hidden');
    session!.start();
  },
  advance(seconds) {
    session?.advance(seconds);
  },
  state() {
    const s = session?.s;
    return s ? { phase: s.phase, raceTime: s.raceTime, stage: session!.stage } : null;
  },
  session: () => session,
  info: () => ({ calls: world.renderer.info.render.calls, triangles: world.renderer.info.render.triangles, pixelRatio: world.pixelRatio }),
};
