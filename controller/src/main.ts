import '@fontsource-variable/inter/index.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/barlow-condensed/800.css';
import '@fontsource/barlow-condensed/700-italic.css';
import '@fontsource/barlow-condensed/800-italic.css';
import './style.css';
import {
  CHARS,
  SLOT_COLORS,
  isRoomCode,
  type JoinErrorReason,
  type LeaderConfig,
  type LobbyUpdate,
  type Phase,
  type GpInfo,
  type Standing,
  CHARS as CHAR_LIST,
  AI_MAX,
  LIVERIES,
  LIVERY_NAME,
  PAINTS,
  RIMS,
  STICKERS,
  STICKER_GLYPH,
  TUNE_KEYS,
  TUNE_MAX,
  TUNE_NAME,
  cleanSetup,
  defaultSetup,
  tuneBalance,
  type KartSetup,
} from '@tk/shared';
import { PhoneNet } from './net';
import { Remote } from './ui';
import { haptic, hapticsOn, setHaptics } from './haptics';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
// D79: the controller started (the page's boot watchdog stands down)
(window as unknown as { __tkCtl: boolean }).__tkCtl = true;
try {
  sessionStorage.removeItem('tk_boot_retry');
} catch {
  /* private mode */
}
// a lazily loaded part (the garage's 3D view) that fails to fetch: reload rather than break
window.addEventListener('vite:preloadError', () => location.reload());
const params = new URLSearchParams(location.search);
const BOT = params.has('bot');

const net = new PhoneNet();
const remote = new Remote();
let phase: Phase = 'lobby';
let lobby: LobbyUpdate | null = null;
let ready = false;
let results: { standings: Standing[]; isLeader: boolean; gp?: GpInfo } | null = null;

/* ---------------- screens ---------------- */
type Screen = 'join' | 'wait' | 'drive' | 'results' | 'garage';
let current: Screen = 'join';
function show(s: Screen): void {
  current = s;
  $('card').hidden = s === 'drive';
  $('drive').hidden = s !== 'drive';
  for (const id of ['join', 'wait', 'results', 'garage'] as const) $(id).hidden = s !== id;
  if (s !== 'garage') garageView?.stop();
  if (s !== 'drive') remote.releaseAll();
  updateRotate();
  // tips never cover the driving controls: hold them until a card screen is showing
  if (s !== 'wait') $('tip').hidden = true;
  else if ($('tip').hidden) nextTip();
}

const isPortrait = (): boolean => window.innerHeight > window.innerWidth;
function updateRotate(): void {
  $('rotate').hidden = !(current === 'drive' && isPortrait());
}
window.addEventListener('resize', updateRotate);
window.screen.orientation?.addEventListener?.('change', updateRotate);

/** Full-screen wait card. After 10 s it adds a hint and a RELOAD button (the token rejoins the same kart). */
let busyTimer = 0;
function busy(text: string | null): void {
  const wasHidden = $('busy').hidden;
  $('busy').hidden = text === null;
  if (text) $('busyText').textContent = text;
  if (text === null || wasHidden) {
    clearTimeout(busyTimer);
    $('busyHelp').hidden = $('busyReload').hidden = true;
  }
  if (text !== null && wasHidden)
    busyTimer = window.setTimeout(() => ($('busyHelp').hidden = $('busyReload').hidden = false), 10000);
}
$('busyReload').addEventListener('click', () => location.reload());

/* ---------------- join ---------------- */
const roomParam = (params.get('room') ?? '').toUpperCase();
const codeInput = $('code') as HTMLInputElement;
const nameInput = $('name') as HTMLInputElement;
if (isRoomCode(roomParam)) {
  $('codeField').hidden = true;
  $('roomTag').hidden = false;
  $('roomTag').querySelector('b')!.textContent = roomParam;
} else codeInput.value = localStorage.getItem('tk_last_room') ?? '';
nameInput.value = BOT
  ? (params.get('name') ?? `Bot${Math.floor(Math.random() * 90 + 10)}`)
  : (localStorage.getItem('tk_name') ?? '');
nameInput.placeholder = 'Player';
codeInput.addEventListener('input', () => {
  codeInput.value = codeInput.value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 4);
});

const JOIN_ERRORS: Record<JoinErrorReason, string> = {
  'room-not-found': 'That room does not exist. Check the code on the big screen.',
  'room-full': 'Room full: 5 players are already in.',
  'race-in-progress': 'A race is running. You can join when it is back in the lobby.',
  'name-taken': 'Someone already uses that name. Pick another one.',
  'bad-request': 'Something went wrong. Try again.',
};

async function doJoin(): Promise<void> {
  const room = isRoomCode(roomParam) ? roomParam : codeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();
  if (!isRoomCode(room)) {
    showJoinError('Type the 4-letter room code from the big screen.');
    return;
  }
  $('joinErr').hidden = true;
  ($('joinBtn') as HTMLButtonElement).disabled = true;
  busy('Joining…');
  const r = await net.join(room, name);
  busy(null);
  ($('joinBtn') as HTMLButtonElement).disabled = false;
  if (!r.ok) {
    showJoinError(JOIN_ERRORS[r.reason]);
    if (BOT) setTimeout(() => void doJoin(), 3000);
    return;
  }
  localStorage.setItem('tk_last_room', room);
  if (!BOT) localStorage.setItem('tk_name', r.data.name);
  onJoined();
}
function showJoinError(msg: string): void {
  $('joinErr').textContent = msg;
  $('joinErr').hidden = false;
  haptic('hit');
}
$('joinBtn').addEventListener('click', () => {
  void doJoin();
  firstGesture();
});
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void doJoin();
});

function onJoined(): void {
  const j = net.joined!;
  remote.setPlayer(j.slot, j.name);
  $('meName').textContent = j.name;
  document.documentElement.style.setProperty('--me', SLOT_COLORS[j.slot] ?? '#888');
  sendSettings();
  sendSavedSetup();
  routePhase();
  if (BOT && !ready) {
    ready = true;
    net.ready(true);
  }
}
net.onRejoined = () => {
  busy(null);
  sendSavedSetup();
  routePhase();
};
net.onJoinLost = (reason) => {
  net.joined = null;
  busy(null);
  show('join');
  showJoinError(
    reason === 'room-not-found' ? 'The game was closed. Scan the new code on the big screen.' : JOIN_ERRORS[reason],
  );
};

/* ---------------- waiting room ---------------- */
const TRACK_NAMES: Record<string, string> = {
  meadows: 'Sunny Meadows',
  canyon: 'Dusty Canyon',
  frosty: 'Frosty Peaks',
  sepang: 'Sepang Circuit',
  'arena-meadow': 'Meadow Fairground',
  'arena-canyon': 'Canyon Bowl',
  'arena-ice': 'Frozen Lake',
};
const isArena = (id: string): boolean => id.startsWith('arena-');

/** The leader's race settings (section 12.6): mode, track, laps, AI difficulty, AI fill, items. */
function renderConfig(leader: boolean): void {
  if (!lobby) return;
  const c = lobby.config;
  $('cfgBox').hidden = !leader;
  const track = $('cfgTrack');
  if (track.children.length !== Object.keys(TRACK_NAMES).length) {
    track.innerHTML = Object.entries(TRACK_NAMES)
      .map(([id, n]) => `<button data-v="${id}" type="button">${n}</button>`)
      .join('');
    for (const b of Array.from(track.children) as HTMLElement[])
      b.addEventListener('click', () => sendConfig({ trackId: b.dataset.v! }));
  }
  const sel = (id: string, v: string): void => {
    for (const b of Array.from($(id).children) as HTMLElement[]) b.classList.toggle('sel', b.dataset.v === v);
  };
  // D69: a brawl picks from the arenas and has no laps
  for (const b of Array.from(track.children) as HTMLElement[])
    b.hidden = isArena(b.dataset.v!) !== (c.mode === 'brawl');
  $('cfgLapsRow').hidden = c.mode === 'brawl';
  sel('cfgMode', c.mode);
  sel('cfgTrack', c.trackId);
  sel('cfgLaps', String(c.laps));
  sel('cfgDiff', c.aiDifficulty);
  sel('cfgSky', c.weather);
  $('cfgTrackRow').hidden = c.mode === 'gp';
  // D82: the number of AI bots (the race holds 8 karts in all)
  const ai = c.aiFill ? c.aiCount : 0;
  $('cfgAi').textContent = String(ai);
  ($('cfgAiDn') as HTMLButtonElement).disabled = ai <= 0;
  ($('cfgAiUp') as HTMLButtonElement).disabled = ai >= AI_MAX;
  $('cfgItems').classList.toggle('on', c.itemsOn);
  $('cfgEvents').classList.toggle('on', c.events);
  $('cfgEvents').hidden = $('cfgEventsLbl').hidden = c.mode === 'brawl';
  $('cfgMoves').classList.toggle('on', c.moves);
  // D83: the slalom gates, jump target and draft tunnel (races only)
  $('cfgZones').classList.toggle('on', c.zones);
  $('cfgZonesRow').hidden = c.mode === 'brawl';
  const where =
    c.mode === 'gp'
      ? `Grand Prix: ${c.gpOrder.map((t) => TRACK_NAMES[t] ?? t).join(' → ')}`
      : c.mode === 'brawl'
        ? `Bumper Brawl: ${TRACK_NAMES[c.trackId]}`
        : TRACK_NAMES[c.trackId];
  $('cfgSummary').textContent =
    `${where} · ${c.mode === 'brawl' ? '3 lives' : `${c.laps} lap${c.laps > 1 ? 's' : ''}`} · ${c.aiFill && c.aiCount > 0 ? `${c.aiCount} ${c.aiDifficulty} AI` : 'no AI'} · items ${c.itemsOn ? 'on' : 'off'}${c.mode !== 'brawl' && !c.events ? ' · no track events' : ''}${c.moves ? '' : ' · no moves'}${c.mode !== 'brawl' && !c.zones ? ' · no fun zones' : ''} · ${skyText(c)}`;
}
/** D71: the sky setting in words (snow only falls on the frosty tracks; elsewhere it rains). */
function skyText(c: LeaderConfig): string {
  if (c.weather === 'random') return 'random sky';
  if (c.weather !== 'snow') return c.weather === 'day' ? 'daytime' : c.weather;
  const tracks = c.mode === 'gp' ? c.gpOrder : [c.trackId];
  const frosty = tracks.filter((t) => t === 'frosty' || t === 'arena-ice').length;
  return frosty === tracks.length
    ? 'snow'
    : frosty
      ? 'snow (rain off the frosty tracks)'
      : 'rain (snow is frosty-only)';
}
function sendConfig(patch: Partial<LeaderConfig>): void {
  if (!lobby) return;
  haptic('tap');
  net.config({ ...lobby.config, ...patch });
}
for (const [id, key] of [
  ['cfgMode', 'mode'],
  ['cfgLaps', 'laps'],
  ['cfgDiff', 'aiDifficulty'],
  ['cfgSky', 'weather'],
] as const)
  for (const b of Array.from($(id).children) as HTMLElement[])
    b.addEventListener('click', () =>
      sendConfig({ [key]: key === 'laps' ? Number(b.dataset.v) : b.dataset.v } as Partial<LeaderConfig>),
    );
const aiNow = (): number => (lobby?.config.aiFill ? lobby.config.aiCount : 0);
$('cfgAiDn').addEventListener('click', () => sendConfig({ aiCount: Math.max(0, aiNow() - 1) }));
$('cfgAiUp').addEventListener('click', () => sendConfig({ aiCount: Math.min(AI_MAX, aiNow() + 1) }));
$('cfgItems').addEventListener('click', () => sendConfig({ itemsOn: !lobby?.config.itemsOn }));
$('cfgEvents').addEventListener('click', () => sendConfig({ events: !lobby?.config.events }));
$('cfgMoves').addEventListener('click', () => sendConfig({ moves: !lobby?.config.moves }));
$('cfgZones').addEventListener('click', () => sendConfig({ zones: !lobby?.config.zones }));

function renderWait(): void {
  const j = net.joined;
  if (!j || !lobby) return;
  const me = lobby.players.find((p) => p.slot === j.slot);
  const leader = !!me?.isLeader;
  renderConfig(leader);
  (document.querySelector('.leaderTag') as HTMLElement).hidden = !leader;
  $('startBtn').hidden = !leader;
  $('waitNote').textContent = leader ? 'You lead: start when everyone is in.' : 'Waiting for the leader to start…';
  $('readyBtn').classList.toggle('on', ready);
  $('readyBtn').textContent = ready ? 'READY ✓' : 'READY';
  const chars = $('chars');
  if (chars.children.length !== CHARS.length) {
    chars.innerHTML = '';
    for (const c of CHARS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.id = c.id;
      b.innerHTML = `<span>${c.emoji}</span><small>${c.name}</small>`;
      b.addEventListener('click', () => {
        haptic('tap');
        net.select(c.id);
      });
      chars.appendChild(b);
    }
  }
  for (const b of Array.from(chars.children) as HTMLButtonElement[]) {
    const owner = lobby.players.find((p) => p.characterId === b.dataset.id);
    b.classList.toggle('mine', owner?.slot === j.slot);
    b.disabled = !!owner && owner.slot !== j.slot;
    b.style.setProperty('--c', owner ? owner.color : 'transparent');
  }
}
$('readyBtn').addEventListener('click', () => {
  ready = !ready;
  haptic('tap');
  net.ready(ready);
  renderWait();
});
$('startBtn').addEventListener('click', () => {
  haptic('tap');
  net.start();
  firstGesture();
});
$('leaveBtn').addEventListener('click', () => {
  net.leave();
  ready = false;
  show('join');
});
$('waitSettings').addEventListener('click', () => openSettings());

/* ---------------- D72 garage ---------------- */
const GARAGE_KEY = 'tk_garage';
let draft: KartSetup | null = null;
let garageView: import('./garage-view').GarageView | null = null;
function savedSetup(): KartSetup | null {
  try {
    return cleanSetup(JSON.parse(localStorage.getItem(GARAGE_KEY) ?? 'null'));
  } catch {
    return null;
  }
}
/** A returning player's kart comes back as they left it. */
function sendSavedSetup(): void {
  const s = savedSetup();
  if (s && !BOT) net.garage(s);
}
function myLobby(): LobbyUpdate['players'][number] | undefined {
  const j = net.joined;
  return lobby?.players.find((p) => p.slot === j?.slot);
}
function openGarage(): void {
  const j = net.joined;
  if (!j) return;
  haptic('tap');
  draft = structuredClone(myLobby()?.setup ?? defaultSetup(j.slot));
  show('garage');
  renderGarage();
  void import('./garage-view').then((m) => {
    if (current !== 'garage') return;
    garageView ??= new m.GarageView($('garageView') as HTMLCanvasElement);
    garageView.start();
    updateGarageView();
  });
}
function updateGarageView(): void {
  const j = net.joined;
  if (garageView && draft && j) garageView.set(myLobby()?.characterId ?? null, j.slot, draft);
}
/** Apply a change: redraw, and save and send it whenever the tuning adds up. */
function change(f: (d: KartSetup) => void): void {
  if (!draft) return;
  haptic('tap');
  f(draft);
  renderGarage();
  updateGarageView();
  if (tuneBalance(draft.tune) === 0) {
    localStorage.setItem(GARAGE_KEY, JSON.stringify(draft));
    net.garage(draft);
  }
}
function swatches(id: string, colors: readonly string[], key: 'paint' | 'accent' | 'rims'): void {
  const el = $(id);
  if (!el.children.length)
    colors.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--sw', c);
      b.setAttribute('aria-label', c);
      b.addEventListener('click', () => change((d) => (d[key] = i)));
      el.appendChild(b);
    });
  Array.from(el.children).forEach((b, i) => b.classList.toggle('sel', draft?.[key] === i));
}
function chips<T extends string>(
  id: string,
  values: readonly T[],
  label: (v: T) => string,
  pick: (d: KartSetup, v: T) => void,
  cur: T,
): void {
  const el = $(id);
  if (!el.children.length)
    for (const v of values) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = v;
      b.textContent = label(v);
      b.addEventListener('click', () => change((d) => pick(d, v)));
      el.appendChild(b);
    }
  for (const b of Array.from(el.children) as HTMLElement[]) b.classList.toggle('sel', b.dataset.v === cur);
}
function renderGarage(): void {
  const d = draft;
  if (!d) return;
  swatches('gPaint', PAINTS, 'paint');
  swatches('gAccent', PAINTS, 'accent');
  swatches('gRims', RIMS, 'rims');
  chips(
    'gLivery',
    LIVERIES,
    (v) => LIVERY_NAME[v],
    (dd, v) => (dd.livery = v),
    d.livery,
  );
  chips(
    'gSticker',
    STICKERS,
    (v) => (v === 'none' ? 'None' : STICKER_GLYPH[v]),
    (dd, v) => (dd.sticker = v),
    d.sticker,
  );
  $('gNum').textContent = String(d.num);
  // tuning: the character's own stat and the points moved, as pips (7 at most)
  const ch = CHAR_LIST.find((c) => c.id === myLobby()?.characterId) ?? CHAR_LIST[0]!;
  const rows = $('gTuneRows');
  if (!rows.children.length)
    for (const k of TUNE_KEYS) {
      const r = document.createElement('div');
      r.className = 'tRow';
      r.dataset.k = k;
      r.innerHTML = `<span>${TUNE_NAME[k]}</span><button type="button" data-d="-1">−</button><i class="pips"></i><button type="button" data-d="1">+</button>`;
      for (const b of Array.from(r.querySelectorAll('button')))
        b.addEventListener('click', () =>
          change((dd) => {
            dd.tune[k] = Math.max(-TUNE_MAX, Math.min(TUNE_MAX, dd.tune[k] + Number(b.dataset.d)));
          }),
        );
      rows.appendChild(r);
    }
  for (const r of Array.from(rows.children) as HTMLElement[]) {
    const k = r.dataset.k as (typeof TUNE_KEYS)[number];
    const base = ch.stats[k],
      t = d.tune[k],
      now = Math.max(0, base + t);
    let html = '';
    for (let i = 1; i <= 7; i++) {
      const cls = i <= Math.min(base, now) ? 'on' : i <= now ? 'on up' : i <= base ? 'down' : '';
      html += `<b class="${cls}"></b>`;
    }
    r.querySelector('.pips')!.innerHTML = html;
    const [dn, up] = Array.from(r.querySelectorAll('button')) as [HTMLButtonElement, HTMLButtonElement];
    dn.disabled = t <= -TUNE_MAX || now <= 0;
    up.disabled = t >= TUNE_MAX;
  }
  const bal = tuneBalance(d.tune);
  const free = $('gFree');
  free.textContent =
    bal > 0
      ? `${bal} point${bal > 1 ? 's' : ''} to place`
      : bal < 0
        ? `Take ${-bal} point${bal < -1 ? 's' : ''} from another stat`
        : TUNE_KEYS.some((k) => d.tune[k] !== 0)
          ? 'Balanced ✓'
          : 'Standard setup';
  free.classList.toggle('warn', bal !== 0);
  ($('garageDone') as HTMLButtonElement).disabled = bal !== 0;
}
$('garageBtn').addEventListener('click', openGarage);
$('garageDone').addEventListener('click', () => {
  haptic('tap');
  draft = null;
  show('wait');
  renderWait();
});
$('gNumDn').addEventListener('click', () => change((d) => (d.num = (d.num + 99) % 100)));
$('gNumUp').addEventListener('click', () => change((d) => (d.num = (d.num + 1) % 100)));
$('gTuneReset').addEventListener('click', () => change((d) => (d.tune = { speed: 0, accel: 0, handling: 0 })));

/* ---------------- phase routing ---------------- */
function routePhase(): void {
  if (!net.joined) {
    show('join');
    return;
  }
  if (phase === 'lobby') {
    results = null;
    show('wait');
    renderWait();
  } else if (phase === 'results') {
    show('results');
    renderResults();
  } else show('drive');
}

net.socket.on('phase', (p) => {
  phase = p.phase;
  // every phone shows the pause card while the race is paused; anyone can resume
  $('pauseSheet').hidden = phase !== 'paused';
  $('pauseBy').textContent = phase === 'paused' && p.pausedBy ? `by ${p.pausedBy}` : '';
  // D82: the leader can end the race from here and take everyone back to the lobby
  const leads = !!lobby?.players.find((x) => x.slot === net.joined?.slot)?.isLeader;
  $('pauseLobby').hidden = !leads;
  $('pauseLobbyNote').hidden = leads;
  $('replayCard').hidden = phase !== 'replay';
  if (phase === 'replay') remote.releaseAll();
  if (phase === 'paused') remote.releaseAll();
  if (phase === 'countdown') remote.resetRace();
  if (phase === 'lobby' && !BOT) ready = false;
  if (phase === 'lobby' && BOT) {
    ready = true;
    net.ready(true);
  }
  routePhase();
});
net.socket.on('lobby:update', (u) => {
  lobby = u;
  if (current === 'wait') renderWait();
  // D72: a new character shows in the garage too
  if (current === 'garage') {
    renderGarage();
    updateGarageView();
  }
});
net.socket.on('hud', (h) => remote.setHud(h));
net.socket.on('haptic', (h) => {
  haptic(h.kind);
  if (h.kind === 'boost') remote.flash('boost');
  if (h.kind === 'hit') remote.flash('hit');
  if (h.kind === 'cd' && h.n) remote.count(String(h.n));
  if (h.kind === 'go') remote.count('GO!');
  if (h.kind === 'lap') remote.toast('FINAL LAP!');
  if (h.kind === 'warn') remote.flash('hit');
  if (h.kind === 'hazard') remote.toast('⚠ TRACK EVENT AHEAD');
  // D83: a fun zone done well
  if (h.kind === 'zone') remote.toast(['⛷️ SLALOM CLEAN!', '🎯 BULLSEYE!', '💨 NICE PASS!'][h.n ?? 0] ?? 'NICE!');
});
net.socket.on('results', (r) => {
  results = r;
  if (current === 'results') renderResults();
});
net.socket.on('host:status', (s) => {
  busy(!s.online && net.joined ? 'Waiting for host…' : null);
});
net.socket.on('select:error', () => {
  haptic('hit');
  remote.toast('That character is taken');
});
net.socket.on('kicked', () => {
  net.joined = null;
  show('join');
  showJoinError('The host removed you from the game.');
});
net.socket.on('disconnect', () => {
  if (net.joined) busy('Reconnecting…');
});
net.socket.on('connect', () => {
  if (!net.joined) busy(null);
});

/* ---------------- results ---------------- */
function renderResults(): void {
  const j = net.joined;
  if (!j) return;
  if (!results) {
    $('resTitle').textContent = 'FINISH!';
    $('standings').innerHTML = '';
    return;
  }
  const idx = results.standings.findIndex((s) => s.slot === j.slot);
  const place = idx + 1;
  $('resTitle').textContent = idx >= 0 ? `You finished ${place}${['st', 'nd', 'rd'][place - 1] ?? 'th'}` : 'RESULTS';
  $('standings').innerHTML = results.standings
    .map(
      (s, i) =>
        `<li class="${s.slot === j.slot ? 'me' : ''}" style="--c:${s.color}"><em class="rk">${i + 1}</em><i></i><span>${CHARS.find((c) => c.id === s.characterId)?.emoji ?? ''} ${s.name.replace(/</g, '&lt;')}</span><b>${s.time === null ? '—' : fmtT(s.time)}</b></li>`,
    )
    .join('');
  $('leaderRow').hidden = !results.isLeader;
  $('resNote').hidden = results.isLeader;
  // Grand Prix: points for this race, the totals, and the leader's NEXT RACE
  const gp = results.gp;
  $('gpBox').hidden = !gp;
  $('againBtn').textContent = gp ? (gp.final ? 'NEW GRAND PRIX' : 'NEXT RACE') : 'RACE AGAIN';
  if (gp) {
    const mine = gp.table.findIndex((s) => s.slot === j.slot);
    $('gpHead').textContent = gp.final ? 'GRAND PRIX · FINAL' : `GRAND PRIX · AFTER RACE ${gp.race} OF ${gp.total}`;
    if (gp.final && mine >= 0)
      $('resTitle').textContent =
        mine === 0 ? 'You won the Grand Prix! 🏆' : `Grand Prix: ${mine + 1}${['st', 'nd', 'rd'][mine] ?? 'th'}`;
    $('gpStand').innerHTML = gp.table
      .map(
        (s, i) =>
          `<li class="${s.slot === j.slot ? 'me' : ''}" style="--c:${s.color}"><em class="rk">${i + 1}</em><i></i><span>${s.name.replace(/</g, '&lt;')}</span><b>${s.points ?? 0}</b></li>`,
      )
      .join('');
    $('resNote').textContent = gp.next ? `Next: ${gp.next}. Waiting for the leader…` : 'Waiting for the leader…';
    for (const li of Array.from($('standings').children) as HTMLElement[]) {
      const s = results.standings[Array.from($('standings').children).indexOf(li)];
      if (s?.points !== undefined) li.querySelector('b')!.textContent += ` +${s.points}`;
    }
  } else $('resNote').textContent = 'Waiting for the leader…';
}
const fmtT = (t: number): string => {
  const m = Math.floor(t / 60),
    s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
};
$('againBtn').addEventListener('click', () => {
  haptic('tap');
  net.rematch(false);
});
$('lobbyBtn').addEventListener('click', () => {
  haptic('tap');
  net.rematch(true);
});

/* ---------------- settings sheet ---------------- */
function sendSettings(): void {
  net.settings({ steering: remote.scheme, assist: remote.assist, sensitivity: remote.sensitivity });
}
remote.onSchemeChange = sendSettings;
remote.onItem = (dir) => {
  net.fireItem(dir);
  haptic('item');
};
remote.onMove = () => {
  net.fireMove();
  haptic('boost');
};
remote.onPause = () => {
  if (phase === 'race' || phase === 'countdown') net.pause(true);
  else if (phase === 'paused') $('pauseSheet').hidden = false;
};
$('resumeBtn').addEventListener('click', () => net.pause(false));
$('skipBtn').addEventListener('click', () => {
  haptic('tap');
  net.skip();
});
$('pauseControls').addEventListener('click', () => openSettings());
$('pauseLobby').addEventListener('click', () => {
  haptic('tap');
  net.toLobby();
});
$('pauseLeave').addEventListener('click', () => {
  $('confirm').hidden = false;
});
remote.onLeave = () => {
  $('confirm').hidden = false;
};
$('stayBtn').addEventListener('click', () => {
  $('confirm').hidden = true;
});
$('quitBtn').addEventListener('click', () => {
  $('confirm').hidden = true;
  $('pauseSheet').hidden = true;
  net.leave();
  ready = false;
  show('join');
});

function openSettings(): void {
  remote.releaseAll();
  renderSettings();
  $('sheet').hidden = false;
}
function renderSettings(): void {
  for (const b of Array.from($('steerSeg').children) as HTMLElement[])
    b.classList.toggle('sel', b.dataset.v === remote.scheme);
  $('assistTog').classList.toggle('on', remote.assist);
  $('hapticTog').classList.toggle('on', hapticsOn);
  $('sensVal').textContent = remote.sensitivity.toFixed(1);
}
for (const b of Array.from($('steerSeg').children) as HTMLElement[]) {
  b.addEventListener('click', () => {
    remote.setScheme(b.dataset.v === 'slider' ? 'slider' : 'buttons');
    renderSettings();
    haptic('tap');
  });
}
$('assistTog').addEventListener('click', () => {
  remote.setAssist(!remote.assist);
  renderSettings();
  haptic('tap');
});
$('hapticTog').addEventListener('click', () => {
  setHaptics(!hapticsOn);
  renderSettings();
  haptic('tap');
});
$('sheetClose').addEventListener('click', () => {
  $('sheet').hidden = true;
});

/* ---------------- fullscreen, wake lock, tips ---------------- */
let gestured = false;
function firstGesture(): void {
  if (gestured) return;
  gestured = true;
  const de = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  // Android Chrome: fullscreen, then lock to landscape. iOS Safari supports neither for web pages (D16).
  if (de.requestFullscreen) {
    de.requestFullscreen({ navigationUI: 'hide' })
      .then(() => {
        const o = window.screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
        return o.lock?.('landscape');
      })
      .catch(() => {
        /* not allowed here */
      });
  }
  void requestWakeLock();
}
async function requestWakeLock(): Promise<void> {
  const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } };
  if (nav.wakeLock && window.isSecureContext) {
    try {
      await nav.wakeLock.request('screen');
      return;
    } catch {
      /* fall through */
    }
  }
  tipOnce('tk_tip_lock', 'Tip: set your phone’s Auto-Lock to “Never” while playing, so the screen stays on.');
}
document.addEventListener('pointerdown', firstGesture, { once: true });
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && gestured) void requestWakeLock();
});

const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone =
  (navigator as Navigator & { standalone?: boolean }).standalone === true ||
  matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches;
const tipQueue: string[] = [];
function tipOnce(key: string, text: string): void {
  if (BOT || localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  tipQueue.push(text);
  if ($('tip').hidden && current === 'wait') nextTip();
}
function nextTip(): void {
  if (current !== 'wait') {
    $('tip').hidden = true;
    return;
  }
  const t = tipQueue.shift();
  $('tip').hidden = !t;
  if (t) $('tipText').textContent = t;
}
$('tipClose').addEventListener('click', nextTip);
if (isIOS && !standalone)
  tipOnce('tk_tip_a2hs', 'For full screen: tap Share, then “Add to Home Screen”, and open Turbo Karts from there.');

// block pinch-zoom and double-tap zoom on iOS (touch-action covers the rest)
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());

/* ---------------- input pump ---------------- */
let botT = 0;
function loop(now: number): void {
  requestAnimationFrame(loop);
  if (current === 'drive' && (!$('sheet').hidden || !$('pauseSheet').hidden)) remote.releaseAll();
  if (BOT && current === 'drive') {
    // bots weave and drift so the network path and the host see realistic input
    botT += 1 / 60;
    remote.state.steer = Math.sin(botT * 0.9) * 0.6 + Math.sin(botT * 2.3) * 0.25;
    remote.state.drift = Math.sin(botT * 0.5) > 0.7;
    remote.state.throttle = true;
    if (Math.random() < 0.004) net.fireItem(Math.random() < 0.7 ? 'forward' : 'back');
  }
  if (current === 'drive' && !BOT) remote.tick(now);
  if (current === 'drive') net.pump(remote.state, now);
  remote.setPing(net.rtt);
}
requestAnimationFrame(loop);

if (BOT || (isRoomCode(roomParam) && params.has('autojoin'))) void doJoin();
