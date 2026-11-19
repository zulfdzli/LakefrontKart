import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import {
  TRACKS,
  gpKey,
  gpStandings,
  gpTable,
  newGp,
  scoreRace,
  type GpInfo,
  type GpState,
  charIndex,
  getTrack,
  isTrackId,
  TRACK_IDS,
  type TrackId,
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
import { loadTextures } from './art/textures';
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

/** The race track: the leader's choice from the lobby; ?track= overrides it for development. */
const URL_TRACK = params.get('track');
function chosenTrack(over?: string): TrackId {
  for (const t of [over, URL_TRACK, lobby?.config.trackId]) if (isTrackId(t)) return t;
  return 'meadows';
}
let previewTrack: TrackId | null = null;
const world = new World($<HTMLCanvasElement>('c'));
// surface textures (phase 9) load before anything is built; ?lotex uses the half-size Low-tier set
await loadTextures(params.has('lotex'), world.renderer.capabilities.getMaxAnisotropy());
const audio = new Audio();
const keyboard = new Keyboard();
const debug = new DebugOverlay(world, $('debug'));
const lobbyUI = new Lobby($('lobby'));
debug.onFull = (on) => world.setDebugLines(on);
debug.extra = () =>
  inRace
    ? session.players.map((p) => {
        const ping = net.latency.get(p.slot),
          st = inputStats.get(p.slot);
        const est = ping !== undefined && st ? ` · ~${Math.round(ping / 2 + st.wait)} ms input` : '';
        const dev = net.devices.get(p.slot) ?? '';
        return `P${p.slot + 1} ${dev} · ping ${ping ?? '–'} ms · ${st ? st.rate.toFixed(0) : 0} in/s${est}`;
      })
    : [];

let lobby: LobbyUpdate | null = null;
let session!: RaceSession;
let inRace = false;
let lastPhase: Phase | null = null;
let autopilot = false;
const lastInput = new Map<number, number>();
/**
 * Section 12.8 input metrics per slot: messages per second, and how long a received input waits on the host
 * before a simulation step uses it. Estimated input latency = phone ping / 2 + that wait.
 */
const inputStats = new Map<number, { count: number; rate: number; since: number; pending: number; wait: number }>();

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
    if (!inRace && previewTrack !== chosenTrack()) preview();
    if (inRace) {
      // a dropped phone hands its kart to the AI until it reconnects (section 5.4)
      for (const p of session.players) {
        const lp = u.players.find((x) => x.slot === p.slot);
        session.game.setHumanAi(p.slot, autopilot || !lp?.connected);
        session.setOffline(p.slot, !autopilot && !lp?.connected);
      }
    }
  },
  input: (i) => {
    if (!inRace || !session.players.some((p) => p.slot === i.slot)) return;
    session.setInput(i.slot, { steer: i.steer, throttle: i.throttle, brake: i.brake, drift: i.drift, item: i.item });
    const now = performance.now();
    lastInput.set(i.slot, now);
    const st = inputStats.get(i.slot) ?? { count: 0, rate: 0, since: now, pending: 0, wait: 8 };
    st.count++;
    if (!st.pending) st.pending = now;
    inputStats.set(i.slot, st);
  },
  start: () => {
    if (!inRace) startRace();
  },
  rematch: (_slot, toLobby) => {
    if (session.stage === 'podium') {
      if (toLobby) backToLobby();
      else nextRace();
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
/** Cycle the lobby's track (the server keeps it in the room config, so phones and the preview follow). */
function nextTrack(): void {
  if (inRace || !lobby) return;
  const i = TRACK_IDS.indexOf(chosenTrack());
  net.config({ ...lobby.config, trackId: TRACK_IDS[(i + 1) % TRACK_IDS.length]! });
}
lobbyUI.onTrack = nextTrack;
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
  session.layout(L.views, L.spare);
}

/** The lobby's 3D preview: the grid, with the camera orbiting a kart. */
function preview(): void {
  session?.dispose();
  const humans: HumanSpec[] = [{ slot: 0, ci: 1, name: 'Pip' }];
  session = new RaceSession(
    { seed: 1, humans, aiFill: true, laps: 2, difficulty: 'normal', itemsOn: true, track: getTrack(chosenTrack()) },
    world,
    audio,
    $('huds'),
    names(humans),
  );
  session.game.setHumanAi(0, true);
  for (const p of session.players) p.cam.wideOrbit = true;
  session.layout([{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }]);
  previewTrack = chosenTrack();
}

function startRace(
  opts: {
    seed?: number;
    autopilot?: boolean;
    laps?: number;
    diff?: Difficulty;
    ci?: number;
    humans?: number;
    track?: string;
    /** Play the race intro flyover (default: yes, except for automation). */
    intro?: boolean;
  } = {},
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
    // automation (tools/capture.ts): N autopilot players for split-screen shots
    for (let i = 1; i < (opts.humans ?? 1); i++)
      humans.push({ slot: i, ci: (humans[0]!.ci + i) % 6, name: `P${i + 1}` });
  }
  const cfg = lobby?.config;
  autopilot = !!opts.autopilot;
  // Grand Prix (section 12.6): the next track in the leader's order
  if (cfg?.mode === 'gp' && !opts.track) {
    if (!gp || gp.done) gp = newGp(cfg.gpOrder);
  } else gp = null;
  const trackId = gp ? chosenTrack(gp.order[gp.race]) : chosenTrack(opts.track);
  session.dispose();
  session = new RaceSession(
    {
      seed: opts.seed ?? Math.floor(Math.random() * 1e9),
      humans,
      aiFill: cfg?.aiFill ?? true,
      laps: opts.laps ?? cfg?.laps ?? 2,
      difficulty: opts.diff ?? cfg?.aiDifficulty ?? 'normal',
      itemsOn: cfg?.itemsOn ?? true,
      track: getTrack(trackId),
    },
    world,
    audio,
    $('huds'),
    names(humans),
  );
  for (const p of session.players) {
    const lp = players.find((x) => x.slot === p.slot);
    session.game.setHumanAi(p.slot, autopilot || (!!lp && !lp.connected));
    session.setOffline(p.slot, !autopilot && !!lp && !lp.connected);
  }
  session.onResults = showResults;
  session.podiumFor = gp ? podiumForGp : null;
  session.trophy = false;
  session.onHaptic = (slot, kind, n) => net.haptic(slot, kind, n);
  layoutViews();
  lastInput.clear();
  inRace = true;
  lobbyUI.show(false);
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  const intro = opts.intro ?? !opts.autopilot;
  if (intro) showTitle(trackId);
  session.start(intro);
}

/* ---------------- Grand Prix (section 12.6, D48) ---------------- */
let gp: GpState | null = null;
let raceScored: Standing[] | null = null;

/** Race intro title card: the track and, in a Grand Prix, which race this is. */
function showTitle(trackId: string): void {
  const el = $('introCard');
  const def = TRACKS[trackId as keyof typeof TRACKS];
  el.querySelector('b')!.textContent = def?.name ?? trackId;
  el.querySelector('span')!.textContent = gp
    ? `Grand Prix · Race ${gp.race + 1} of ${gp.order.length}`
    : `${lobby?.config.laps ?? 2} lap${(lobby?.config.laps ?? 2) > 1 ? 's' : ''} · ${lobby?.config.aiDifficulty ?? 'normal'}`;
  el.classList.remove('on');
  void el.offsetWidth;
  el.classList.add('on');
}

/** When a GP race ends: score it; after the final, the podium shows the overall top three with the trophy. */
function podiumForGp(race: Kart[]): Kart[] | null {
  if (!gp) return null;
  raceScored = scoreRace(gp, standings(race));
  if (!gp.done) return null;
  session.trophy = true;
  const rank = new Map(gpTable(gp).map((e, i) => [e.key, i]));
  return race
    .slice()
    .sort(
      (a, b) =>
        (rank.get(gpKey({ slot: a.slot, characterId: a.ch.id })) ?? 99) -
        (rank.get(gpKey({ slot: b.slot, characterId: b.ch.id })) ?? 99),
    );
}

/** Enter / the leader's RACE AGAIN or NEXT RACE: the next GP race, a new GP after the final, or a rematch. */
function nextRace(): void {
  if (gp && !gp.done) gp.race++;
  startRace();
}

function backToLobby(): void {
  inRace = false;
  gp = null;
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
  const st = gp && raceScored ? raceScored : standings(order);
  let info: GpInfo | undefined;
  if (gp) {
    const nextId = gp.done ? null : gp.order[gp.race + 1];
    info = {
      race: gp.race + 1,
      total: gp.order.length,
      table: gpStandings(gp),
      final: gp.done,
      next: nextId ? (TRACKS[nextId as keyof typeof TRACKS]?.name ?? nextId) : null,
    };
  }
  net.results(st, info);
  const best = Math.min(...session.players.map((p) => p.kart.rank)) + 1;
  const champ = info?.final ? info.table[0] : undefined;
  $('resTitle').textContent = champ
    ? `🏆 ${champ.name} WINS THE GRAND PRIX!`
    : info
      ? `RACE ${info.race} OF ${info.total}`
      : session.players.length === 1
        ? best === 1
          ? '🏆 WINNER!'
          : `${best}${ord(best)} PLACE`
        : 'RESULTS';
  $('standings').innerHTML = order
    .map((k, i) => {
      const s = st[i]!;
      const human = k.slot !== null;
      const pts = s.points !== undefined ? ` <em class="pts">+${s.points}</em>` : '';
      return `<li class="${human ? 'me' : ''}" style="--c:${s.color}"><span><i class="dot"></i>${i + 1}. ${k.ch.emoji} ${s.name.replace(/</g, '&lt;')}</span><span>${k.finished ? fmtT(k.finishTime) : '—'}${pts}</span></li>`;
    })
    .join('');
  // Grand Prix table: totals after this race
  const tbl = $('gpTable');
  tbl.hidden = !info;
  if (info)
    tbl.innerHTML =
      `<h4>${info.final ? 'FINAL STANDINGS' : 'GRAND PRIX STANDINGS'}</h4><ol>` +
      info.table
        .map(
          (e, i) =>
            `<li class="${e.slot !== null ? 'me' : ''}" style="--c:${e.color}"><span>${i < 3 && info!.final ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`} <i class="dot"></i>${e.name.replace(/</g, '&lt;')}</span><b>${e.points}</b></li>`,
        )
        .join('') +
      '</ol>';
  $('againBtn').textContent = info ? (info.final ? 'NEW GRAND PRIX' : `NEXT RACE ▸ ${info.next}`) : 'RACE AGAIN';
  let best1: Kart | null = null;
  for (const k of order) if (k.bestLap && (!best1 || k.bestLap < best1.bestLap)) best1 = k;
  $('resBest').textContent = best1 ? `Best lap: ${fmtT(best1.bestLap)} (${standings([best1])[0]!.name})` : '';
  // D51: the card is framed in the track's theme (gold stars, desert sun, ice, leaves)
  const tid = session.s.track.id;
  const theme = isTrackId(tid) ? TRACKS[tid].theme : 'meadows';
  $('results').dataset.theme = theme;
  $('resDeco').innerHTML =
    theme === 'meadows'
      ? '<i>★</i><i>★</i><b>★</b><i>★</i><i>★</i>'
      : theme === 'canyon'
        ? '<i>✦</i><b>☀</b><i>✦</i>'
        : theme === 'frosty'
          ? '<i>❄</i><b>❄</b><i>❄</i>'
          : '<i>❀</i><b>✿</b><i>❀</i>';
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
    if (!inRace) startRace();
    else if (session.stage === 'podium') nextRace();
  } else if (e.key === ' ') {
    if (inRace) session.skipIntro();
  } else if (e.key === 'Escape') {
    if (inRace) backToLobby();
  } else if (e.key === 'p' || e.key === 'P') setPaused(!session.paused);
  else if (e.key === 'm' || e.key === 'M') audio.setMuted(!audio.muted);
  else if (e.key === 't' || e.key === 'T') nextTrack();
  else if ((e.key === 'g' || e.key === 'G') && !inRace && lobby)
    net.config({ ...lobby.config, mode: lobby.config.mode === 'gp' ? 'single' : 'gp' });
  else if (e.key === 'q' || e.key === 'Q') {
    const t = world.cycleTier();
    if (t) console.info(`Quality tier: ${world.post!.override ?? 'auto'} (${t})`);
  } else if (e.key === 'f' || e.key === 'F') debug.toggleFps();
  else if (e.key === 'd' || e.key === 'D') debug.toggleFull();
});
$('againBtn').addEventListener('click', () => nextRace());
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
  {
    const now = performance.now();
    for (const st of inputStats.values()) {
      if (st.pending) {
        st.wait += (now - st.pending - st.wait) * 0.1;
        st.pending = 0;
      }
      if (now - st.since >= 1000) {
        st.rate = (st.count * 1000) / (now - st.since);
        st.count = 0;
        st.since = now;
      }
    }
    debug.simMs = session.simMs;
    if (debug.isFull) world.updateDebugLines(session.s);
  }
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
      race(opts: {
        seed?: number;
        ci?: number;
        diff?: Difficulty;
        laps?: number;
        autopilot?: boolean;
        humans?: number;
        track?: string;
        intro?: boolean;
      }): void;
      advance(seconds: number): void;
      state(): unknown;
      session(): RaceSession | null;
      info(): {
        calls: number;
        triangles: number;
        views: number;
        pixelRatio: number;
        simMs: number;
        tier: string;
        memory: { geometries: number; textures: number; programs: number };
      };
      world(): World;
      lobby(): LobbyUpdate | null;
    };
  }
}
window.__tk = {
  ready: true,
  race(opts) {
    startRace({ ...opts, autopilot: opts.autopilot ?? true, intro: opts.intro ?? false });
  },
  advance(seconds) {
    session.advance(seconds);
  },
  state() {
    return { phase: session.s.phase, raceTime: session.s.raceTime, stage: session.stage, inRace, room: net.room };
  },
  session: () => session,
  info: () => ({
    calls: world.frameStats.calls,
    triangles: world.frameStats.triangles,
    views: world.frameStats.views,
    pixelRatio: world.pixelRatio,
    simMs: session.simMs,
    tier: world.post?.tier ?? 'off',
    memory: { ...world.renderer.info.memory, programs: world.renderer.info.programs?.length ?? 0 },
  }),
  world: () => world,
  lobby: () => lobby,
};
