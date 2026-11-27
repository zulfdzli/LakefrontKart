import '@fontsource-variable/inter/index.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
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
  ARENA_IDS,
  BRAWL_LIVES,
  isArenaId,
  type TrackId,
  SLOT_COLORS,
  AI_COLOR,
  type Difficulty,
  type HumanSpec,
  type Kart,
  type LobbyUpdate,
  type Phase,
  type Standing,
  WEATHER_ICON,
  WEATHER_NAME,
  isWeatherSetting,
  rollWeather,
  type Weather,
  type KartSetup,
  MAX_KARTS,
} from '@tk/shared';
import { World } from './renderer';
import { loadTextures } from './art/textures';
import { RaceSession } from './session';
import { Audio } from './audio';
import { Commentator } from './commentator';
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
let previewTrack: string | null = null;
/** D71: ?weather=rain (automation and screenshots) overrides the lobby's sky. */
const URL_WEATHER = params.get('weather');
/** The lobby preview's sky: the leader's fixed pick, or plain day while it is Random. */
function previewWeather(): Weather {
  const w = isWeatherSetting(URL_WEATHER) ? URL_WEATHER : lobby?.config.weather;
  return w && w !== 'random' ? rollWeather(w, chosenTrack(), 1) : 'day';
}
const previewKey = (): string => `${chosenTrack()}|${previewWeather()}`;
/** D72: the players' karts in the preview (character and garage setup); a change rebuilds only the karts. */
const kartsKey = (): string => JSON.stringify((lobby?.players ?? []).map((p) => [p.slot, p.characterId, p.setup]));
let previewKarts = '';
let kartsTimer = 0;
/** The lobby's players as race entrants: character, name and garage tune; their setups go to the renderer. */
function lobbyHumans(): HumanSpec[] {
  const players = (lobby?.players ?? []).slice().sort((a, b) => a.slot - b.slot);
  world.setups = new Map(players.map((p) => [p.slot, p.setup]));
  return players.map((p) => ({
    slot: p.slot,
    ci: Math.max(0, charIndex(p.characterId ?? '')),
    name: p.name,
    tune: p.setup?.tune,
  }));
}
const world = new World($<HTMLCanvasElement>('c'));
// surface textures (phase 9) load before anything is built; ?lotex uses the half-size Low-tier set
await loadTextures(params.has('lotex'), world.renderer.capabilities.getMaxAnisotropy());
// D52: canvas-drawn text (decals, name tags, signs, the podium bar) needs the display fonts loaded first
await Promise.all(
  ['800 48px "Barlow Condensed"', 'italic 800 48px "Barlow Condensed"', '700 32px "Inter Variable"'].map((f) =>
    document.fonts.load(f).catch(() => []),
  ),
);
const audio = new Audio();
/** D81: the race commentator (quiet when the game is muted, and in automation races). */
const commentator = new Commentator(() => audio.muted);
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
    // D67: the preview fades through the veil to the newly chosen track instead of freezing on the rebuild
    if (!inRace && !switching && previewTrack !== previewKey())
      void transition(() => {
        if (!inRace && previewTrack !== previewKey()) preview();
      });
    else if (!inRace && !switching && previewKarts !== kartsKey()) {
      // D72: a new player, character or garage change: rebuild the karts on the grid (the track stays)
      clearTimeout(kartsTimer);
      kartsTimer = window.setTimeout(() => {
        if (!inRace && !switching && previewKarts !== kartsKey()) preview();
      }, 250);
    }
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
    session.setInput(i.slot, {
      steer: i.steer,
      throttle: i.throttle,
      brake: i.brake,
      drift: i.drift,
      item: i.item,
      move: i.move,
    });
    const now = performance.now();
    lastInput.set(i.slot, now);
    const st = inputStats.get(i.slot) ?? { count: 0, rate: 0, since: now, pending: 0, wait: 8 };
    st.count++;
    if (!st.pending) st.pending = now;
    inputStats.set(i.slot, st);
  },
  start: () => queueStart(),
  rematch: (_slot, toLobby) => {
    // D82: the leader can also go back to the lobby mid-race (from the pause card)
    if (toLobby && inRace && !switching) {
      setPaused(false, '');
      goLobby();
      return;
    }
    if (session.stage === 'podium' && !switching) {
      if (toLobby) goLobby();
      else goNextRace();
    }
  },
  pause: (slot, paused) => {
    const name = lobby?.players.find((p) => p.slot === slot)?.name ?? `P${slot + 1}`;
    setPaused(paused, name);
  },
  latency: () => {
    if (lobby && !inRace) lobbyUI.update(lobby, net.latency);
  },
  skip: () => {
    if (inRace) session.skipReplay();
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
  // D69: a brawl cycles the arenas
  const list = lobby.config.mode === 'brawl' ? ARENA_IDS : TRACK_IDS;
  const i = list.indexOf(chosenTrack());
  net.config({ ...lobby.config, trackId: list[(i + 1) % list.length]! });
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

/* ---------------- D67: smooth scene changes ---------------- */
const veil = $('veil');
let veilChain: Promise<void> = Promise.resolve();
/** True from the moment a scene change is asked for until its swap has run (blocks double starts). */
let switching = false;
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
/** Resolves once the page draws smoothly again: three frames in a row under 40 ms (or after 2 s). */
function settled(): Promise<void> {
  return new Promise((resolve) => {
    let last = performance.now(),
      good = 0;
    const t0 = last;
    const tick = (now: number): void => {
      good = now - last < 40 ? good + 1 : 0;
      last = now;
      if (good >= 3 || now - t0 > 2000) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
/**
 * Fade the scene out to the veil, run `swap` behind it (track and kart rebuilds, shader compiles), and fade back in
 * once frames are smooth, so a rebuild never shows as a frozen frame or a hard cut. Changes queue in order.
 */
function transition(swap: () => void, fadeOut = 280, fadeIn = 520): Promise<void> {
  switching = true;
  veilChain = veilChain.then(async () => {
    if (!veil.classList.contains('on')) {
      veil.style.transitionDuration = `${fadeOut}ms`;
      veil.classList.add('on');
      await wait(fadeOut + 20);
    }
    try {
      swap();
    } finally {
      switching = false;
    }
    const cam = session.views()[0]?.camera;
    if (cam) await world.warm(cam);
    await settled();
    veil.style.transitionDuration = `${fadeIn}ms`;
    veil.classList.remove('on');
    await wait(fadeIn);
  });
  return veilChain;
}

/** The lobby's 3D preview: the grid, with the camera orbiting a kart. */
function preview(): void {
  session?.dispose();
  // D72: every player's kart on the grid (the camera orbits the first), or Pip when nobody has joined
  let humans = lobbyHumans();
  if (!humans.length) humans = [{ slot: 0, ci: 1, name: 'Pip' }];
  session = new RaceSession(
    {
      seed: 1,
      humans,
      aiFill: true,
      laps: 2,
      difficulty: 'normal',
      itemsOn: true,
      track: getTrack(chosenTrack()),
      weather: previewWeather(),
    },
    world,
    audio,
    $('huds'),
    names(humans),
  );
  for (const h of humans) session.game.setHumanAi(h.slot, true);
  for (const p of session.players) p.cam.wideOrbit = true;
  session.layout([{ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight }]);
  previewTrack = previewKey();
  previewKarts = kartsKey();
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
    /** D69: 'brawl' for Bumper Brawl (default: the lobby's mode). */
    mode?: 'race' | 'brawl';
    /** D71: the sky (default: the lobby's setting; automation races in the day). */
    weather?: Weather;
    /** D72 automation: garage setups for the autopilot players, by slot. */
    setups?: KartSetup[];
    /** D73: track events (default: the lobby's setting; automation races without, unless asked). */
    events?: boolean;
    /** Automation: the players start from the front of the grid. */
    pole?: boolean;
    /** D74: signature moves (default: the lobby's setting; automation races without, unless asked). */
    moves?: boolean;
    /** D81: the commentator (on in real races; automation races without, unless asked). */
    comm?: boolean;
    /** D83: fun zones (default: the lobby's setting; automation races without, unless asked). */
    zones?: boolean;
  } = {},
): void {
  audio.unlock();
  lobbyUI.setSoundOn(true);
  const players = (lobby?.players ?? []).slice().sort((a, b) => a.slot - b.slot);
  let humans = lobbyHumans();
  if (humans.length === 0) {
    if (!KEYBOARD && !opts.autopilot) return; // section 6.1: at least one player
    humans = [{ slot: 0, ci: opts.ci ?? 1, name: 'You' }];
    // automation (tools/capture.ts): N autopilot players for split-screen shots
    for (let i = 1; i < (opts.humans ?? 1); i++)
      humans.push({ slot: i, ci: (humans[0]!.ci + i) % 6, name: `P${i + 1}` });
    // D72 automation: garage setups for those players (screenshots)
    if (opts.setups) {
      world.setups = new Map(opts.setups.map((g, i) => [i, g]));
      for (const h of humans) h.tune = opts.setups[h.slot]?.tune;
    }
  }
  const cfg = lobby?.config;
  autopilot = !!opts.autopilot;
  // Grand Prix (section 12.6): the next track in the leader's order
  if (cfg?.mode === 'gp' && !opts.track) {
    if (!gp || gp.done) gp = newGp(cfg.gpOrder);
  } else gp = null;
  const brawl = opts.mode ? opts.mode === 'brawl' : cfg?.mode === 'brawl';
  if (brawl) gp = null;
  let trackId = gp ? chosenTrack(gp.order[gp.race]) : chosenTrack(opts.track);
  // D69: a brawl is fought in an arena, a race on a track
  if (brawl && !isArenaId(trackId)) trackId = ARENA_IDS[0]!;
  if (!brawl && isArenaId(trackId)) trackId = TRACK_IDS[0]!;
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  // D71: a fixed sky, or a fresh roll per race (so a Grand Prix changes weather between races)
  const sky = isWeatherSetting(URL_WEATHER) ? URL_WEATHER : opts.autopilot ? 'day' : (cfg?.weather ?? 'day');
  const weather = opts.weather ?? rollWeather(sky, trackId, seed);
  session.dispose();
  session = new RaceSession(
    {
      seed,
      weather,
      events: opts.events ?? (opts.autopilot ? false : (cfg?.events ?? true)),
      moves: opts.moves ?? (opts.autopilot ? false : (cfg?.moves ?? true)),
      zones: opts.zones ?? (opts.autopilot ? false : (cfg?.zones ?? true)),
      ...(opts.pole ? { grid: Array.from({ length: 12 }, (_, i) => i) } : {}),
      humans,
      aiFill: cfg ? cfg.aiFill && cfg.aiCount > 0 : true,
      // D82: the leader's number of AI karts, within the race's 8 karts
      totalKarts: humans.length + Math.min(cfg?.aiCount ?? 5, Math.max(0, MAX_KARTS - humans.length)),
      laps: brawl ? 1 : (opts.laps ?? cfg?.laps ?? 2),
      mode: brawl ? 'brawl' : 'race',
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
  session.comm = (opts.comm ?? !opts.autopilot) ? commentator : null;
  // D67: the cut to the podium fades through the veil (automation races cut at once)
  session.transition = opts.autopilot ? null : (swap) => void transition(swap, 380, 650);
  // D68: the highlight reel after the race (automation goes straight to the podium)
  session.replayOn = !opts.autopilot;
  layoutViews();
  lastInput.clear();
  inRace = true;
  lobbyUI.show(false);
  $('results').classList.add('hidden');
  $('pause').classList.add('hidden');
  const intro = opts.intro ?? !opts.autopilot;
  if (intro) showTitle(trackId, weather);
  session.start(intro);
}

/* ---------------- Grand Prix (section 12.6, D48) ---------------- */
let gp: GpState | null = null;
let raceScored: Standing[] | null = null;

/** Race intro title card: the track and, in a Grand Prix, which race this is. */
function showTitle(trackId: string, weather: Weather): void {
  const el = $('introCard');
  const def = TRACKS[trackId as keyof typeof TRACKS];
  el.querySelector('b')!.textContent = def?.name ?? trackId;
  el.querySelector('span')!.textContent = isArenaId(trackId)
    ? `Bumper Brawl · ${BRAWL_LIVES} lives · last kart standing`
    : gp
      ? `Grand Prix · Race ${gp.race + 1} of ${gp.order.length}`
      : `${lobby?.config.laps ?? 2} lap${(lobby?.config.laps ?? 2) > 1 ? 's' : ''} · ${lobby?.config.aiDifficulty ?? 'normal'}`;
  // D71: the forecast
  el.querySelector('i')!.textContent = `${WEATHER_ICON[weather]} ${WEATHER_NAME[weather]}`;
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

/**
 * Start from the lobby, faded through the veil. A start pressed while the preview is still fading to a newly
 * picked track queues behind it (it used to be dropped, so START right after a track change did nothing).
 */
let startQueued = false;
function queueStart(): void {
  if (inRace || startQueued) return;
  startQueued = true;
  void transition(() => {
    startQueued = false;
    if (!inRace) startRace();
  });
}

/** D67: the same, faded through the veil (players' and host-key paths; automation calls the plain ones). */
function goNextRace(): void {
  if (!switching) void transition(() => nextRace());
}
function goLobby(): void {
  if (inRace && !switching) void transition(() => backToLobby());
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
      return `<li class="${human ? 'me' : ''}" style="--c:${s.color}"><span><i class="dot"></i>${i + 1}. ${k.ch.emoji} ${s.name.replace(/</g, '&lt;')}</span><span>${session.s.mode === 'brawl' ? (k.out ? 'OUT ' + fmtT(k.finishTime) : '♥'.repeat(k.lives)) : k.finished ? fmtT(k.finishTime) : '—'}${pts}</span></li>`;
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
    if (!inRace) queueStart();
    else if (inRace && session.stage === 'podium') goNextRace();
    else if (inRace) session.skipReplay();
  } else if (e.key === ' ') {
    if (inRace) {
      session.skipIntro();
      session.skipReplay();
    }
  } else if (e.key === 'Escape') {
    goLobby();
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
$('againBtn').addEventListener('click', goNextRace);
$('menuBtn').addEventListener('click', goLobby);
$('resumeBtn').addEventListener('click', () => setPaused(false));
$('quitBtn').addEventListener('click', goLobby);
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
// D67: the main menu fades in from the veil once the first frames (shader compiles) are behind it
veilChain = veilChain.then(async () => {
  await settled();
  veil.style.transitionDuration = '700ms';
  veil.classList.remove('on');
});
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
        mode?: 'race' | 'brawl';
        weather?: Weather;
        setups?: KartSetup[];
        events?: boolean;
        pole?: boolean;
        moves?: boolean;
        comm?: boolean;
        zones?: boolean;
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
    // automation: no veil in the way of its screenshots
    veil.style.transitionDuration = '0ms';
    veil.classList.remove('on');
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
