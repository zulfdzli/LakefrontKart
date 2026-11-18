import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import {
  buildPrototypeTrack,
  charIndex,
  SLOT_COLORS,
  AI_COLOR,
  type Difficulty,
  type HumanSpec,
  type Kart,
  type LobbyUpdate,
  type Phase,
  type Standing,
} from '@tk/shared';
import { World } from './renderer';
import { RaceSession } from './session';
import { Audio } from './audio';
import { Keyboard } from './input-keyboard';
import { DebugOverlay } from './debug';
import { fmtT, ord } from './hud';
import { HostNet } from './net';
import { Lobby } from './lobby';
import { splitLayout } from './layout';

/*
 * Host screen: the lobby (QR, slots) with a 3D preview, races driven by phones, results and rematch.
 * ?keyboard=1 lets the host keyboard drive slot 0 without a phone (development).
 */

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const KEYBOARD = params.has('keyboard');
/** Section 5.4: no input for this long means steer 0, no drift or brake, but keep the throttle on. */
const INPUT_STALE_MS = 500;

const track = buildPrototypeTrack();
const world = new World($<HTMLCanvasElement>('c'));
const audio = new Audio();
const keyboard = new Keyboard();
const debug = new DebugOverlay(world, $('debug'));
const lobbyUI = new Lobby($('lobby'));

let lobby: LobbyUpdate | null = null;
let session!: RaceSession;
let inRace = false;
let lastPhase: Phase | null = null;
let autopilot = false;
const lastInput = new Map<number, number>();

const net = new HostNet({
  room: (code) => lobbyUI.setRoom(code),
  connection: (online) => {
    $('netDown').classList.toggle('hidden', online);
    if (online) {
      lastPhase = null;
      void net.netInfo().then((i) => lobbyUI.setNet(i));
      setTimeout(() => void net.netInfo().then((i) => lobbyUI.setNet(i)), 7000);
    }
  },
  lobby: (u) => {
    lobby = u;
    lobbyUI.update(u, net.latency);
    if (inRace) {
      // a dropped phone hands its kart to the AI until it reconnects (section 5.4)
      for (const p of session.players) {
        const lp = u.players.find((x) => x.slot === p.slot);
        session.game.setHumanAi(p.slot, autopilot || !lp?.connected);
      }
    }
  },
  input: (i) => {
    if (!inRace || !session.players.some((p) => p.slot === i.slot)) return;
    session.setInput(i.slot, { steer: i.steer, throttle: i.throttle, brake: i.brake, drift: i.drift, item: i.item });
    lastInput.set(i.slot, performance.now());
  },
  start: () => {
    if (!inRace) startRace();
  },
  rematch: (_slot, toLobby) => {
    if (session.stage === 'podium') {
      if (toLobby) backToLobby();
      else startRace();
    }
  },
  pause: (slot, paused) => {
    const name = lobby?.players.find((p) => p.slot === slot)?.name ?? `P${slot + 1}`;
    setPaused(paused, name);
  },
  latency: () => {
    if (lobby && !inRace) lobbyUI.update(lobby, net.latency);
  },
  settings: () => {},
  device: () => {},
  config: () => {},
});

lobbyUI.onKick = (slot) => {
  if (!inRace) net.kick(slot);
};
lobbyUI.onSound = () => {
  audio.unlock();
  lobbyUI.setSoundOn(true);
};

function names(humans: HumanSpec[]): Map<number, string> {
  const m = new Map<number, string>();
  humans.forEach((h, i) => m.set(i, h.name ?? `P${h.slot + 1}`));
  return m;
}

function layoutViews(): void {
  const L = splitLayout(session.players.length, window.innerWidth, window.innerHeight);
  session.layout(L.views);
}

/** The lobby's 3D preview: the grid, with the camera orbiting a kart. */
function preview(): void {
  session?.dispose();
  const humans: HumanSpec[] = [{ slot: 0, ci: 1, name: 'Pip' }];
  session = new RaceSession(
    { seed: 1, humans, aiFill: true, laps: 2, difficulty: 'normal', itemsOn: true, track },
    world,
    audio,
    $('huds'),
    names(humans),
  );
  session.game.setHumanAi(0, true);
  for (const p of session.players) p.cam.wideOrbit = true;
  session.layout([{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }]);
}

function startRace(
  opts: { seed?: number; autopilot?: boolean; laps?: number; diff?: Difficulty; ci?: number } = {},
): void {
  audio.unlock();
  lobbyUI.setSoundOn(true);
  const players = (lobby?.players ?? []).slice().sort((a, b) => a.slot - b.slot);
  let humans: HumanSpec[] = players.map((p) => ({
    slot: p.slot,
    ci: Math.max(0, charIndex(p.characterId ?? '')),
    name: p.name,
  }));
  if (humans.length === 0) {
    if (!KEYBOARD && !opts.autopilot) return; // section 6.1: at least one player
    humans = [{ slot: 0, ci: opts.ci ?? 1, name: 'You' }];
  }
  const cfg = lobby?.config;
  autopilot = !!opts.autopilot;
  session.dispose();
  session = new RaceSession(
    {
      seed: opts.seed ?? Math.floor(Math.random() * 1e9),
      humans,
      aiFill: cfg?.aiFill ?? true,
      laps: opts.laps ?? cfg?.laps ?? 2,
      difficulty: opts.diff ?? cfg?.aiDifficulty ?? 'normal',
      itemsOn: cfg?.itemsOn ?? true,
      track,
    },
    world,
    audio,
    $('huds'),
    names(humans),
  );
  for (const p of session.players) {
    const lp = players.find((x) => x.slot === p.slot);
    session.game.setHumanAi(p.slot, autopilot || (!!lp && !lp.connected));
  }
  session.onResults = showResults;
  session.onHaptic = (slot, kind) => net.haptic(slot, kind);
  layoutViews();
  lastInput.clear();
  inRace = true;
  lobbyUI.show(false);
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  session.start();
}

function backToLobby(): void {
  inRace = false;
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  preview();
  lobbyUI.show(true);
}

function standings(order: Kart[]): Standing[] {
  return order.map((k) => ({
    slot: k.slot,
    name: session.players.find((p) => p.kart === k)
      ? (lobby?.players.find((p) => p.slot === k.slot)?.name ?? k.name)
      : k.name,
    color: k.slot === null ? AI_COLOR : SLOT_COLORS[k.slot]!,
    characterId: k.ch.id,
    time: k.finished ? k.finishTime : null,
    bestLap: k.bestLap || null,
  }));
}

function showResults(order: Kart[]): void {
  const st = standings(order);
  net.results(st);
  const best = Math.min(...session.players.map((p) => p.kart.rank)) + 1;
  $('resTitle').textContent =
    session.players.length === 1 ? (best === 1 ? '🏆 WINNER!' : `${best}${ord(best)} PLACE`) : 'RESULTS';
  $('standings').innerHTML = order
    .map((k, i) => {
      const s = st[i]!;
      const human = k.slot !== null;
      return `<li class="${human ? 'me' : ''}" style="--c:${s.color}"><span><i class="dot"></i>${i + 1}. ${k.ch.emoji} ${s.name.replace(/</g, '&lt;')}</span><span>${k.finished ? fmtT(k.finishTime) : '—'}</span></li>`;
    })
    .join('');
  let best1: Kart | null = null;
  for (const k of order) if (k.bestLap && (!best1 || k.bestLap < best1.bestLap)) best1 = k;
  $('resBest').textContent = best1 ? `Best lap: ${fmtT(best1.bestLap)} (${standings([best1])[0]!.name})` : '';
  $('results').classList.remove('hidden');
}

/** Pause the race for everyone. `by` names who paused (a player, or the host keyboard). */
let pausedBy = '';
function setPaused(p: boolean, by = 'the host'): void {
  if (!inRace || session.stage !== 'racing' || session.paused === p) return;
  session.paused = p;
  pausedBy = p ? by : '';
  $('pauseBy').textContent = p ? `Paused by ${by}` : '';
  $('pause').classList.toggle('hidden', !p);
}

/* ---------------- host keys (section 6.6) ---------------- */
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  audio.unlock();
  lobbyUI.setSoundOn(true);
  if (e.key === 'Enter') {
    if (!inRace || session.stage === 'podium') startRace();
  } else if (e.key === 'Escape') {
    if (inRace) backToLobby();
  } else if (e.key === 'p' || e.key === 'P') setPaused(!session.paused);
  else if (e.key === 'm' || e.key === 'M') audio.setMuted(!audio.muted);
  else if (e.key === 'f' || e.key === 'F') debug.toggleFps();
  else if (e.key === 'd' || e.key === 'D') debug.toggleFull();
});
$('againBtn').addEventListener('click', () => startRace());
$('menuBtn').addEventListener('click', backToLobby);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('quitBtn').addEventListener('click', backToLobby);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener('resize', () => {
  world.resize();
  if (inRace) layoutViews();
  else session.layout([{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }]);
});

/* ---------------- loop ---------------- */
world.resize();
preview();
let last = performance.now();
let stateT = 0;
function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t0 = performance.now();
  if (inRace && session.stage === 'racing' && !session.paused) {
    if (KEYBOARD && !autopilot) session.setInput(0, keyboard.read());
    for (const p of session.players) {
      if (KEYBOARD && p.slot === 0) continue;
      const t = lastInput.get(p.slot);
      if (t === undefined || now - t > INPUT_STALE_MS)
        session.setInput(p.slot, { steer: 0, throttle: true, brake: false, drift: false, item: null });
    }
  }
  session.frame(dt);
  world.render(session.views(), (v) => session.focusOf(v));
  // phones: phase on change (reliable), HUD at about 10 Hz (volatile)
  const phase = session.netPhase();
  stateT += dt;
  if (phase !== lastPhase) {
    lastPhase = phase;
    net.sendPhase({
      phase,
      pausedBy: phase === 'paused' ? pausedBy : undefined,
      players: inRace ? session.players.map((p) => ({ slot: p.slot, hud: session.hudFor(p) })) : [],
    });
  } else if (inRace && stateT >= 0.1) {
    stateT = 0;
    net.sendState({ phase, players: session.players.map((p) => ({ slot: p.slot, hud: session.hudFor(p) })) });
  }
  debug.frame(dt, performance.now() - t0);
}
requestAnimationFrame(frame);

/* ---------------- automation hook (tools/capture.ts, tools/bots.ts) ---------------- */
declare global {
  interface Window {
    __tk: {
      ready: boolean;
      race(opts: { seed?: number; ci?: number; diff?: Difficulty; laps?: number; autopilot?: boolean }): void;
      advance(seconds: number): void;
      state(): unknown;
      session(): RaceSession | null;
      info(): { calls: number; triangles: number; pixelRatio: number };
      lobby(): LobbyUpdate | null;
    };
  }
}
window.__tk = {
  ready: true,
  race(opts) {
    startRace({ ...opts, autopilot: opts.autopilot ?? true });
  },
  advance(seconds) {
    session.advance(seconds);
  },
  state() {
    return { phase: session.s.phase, raceTime: session.s.raceTime, stage: session.stage, inRace, room: net.room };
  },
  session: () => session,
  info: () => ({
    calls: world.renderer.info.render.calls,
    triangles: world.renderer.info.render.triangles,
    pixelRatio: world.pixelRatio,
  }),
  lobby: () => lobby,
};
