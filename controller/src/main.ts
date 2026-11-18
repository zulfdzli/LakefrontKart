import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import {
  CHARS,
  SLOT_COLORS,
  isRoomCode,
  type JoinErrorReason,
  type LobbyUpdate,
  type Phase,
  type Standing,
} from '@tk/shared';
import { PhoneNet } from './net';
import { Remote } from './ui';
import { haptic, hapticsOn, setHaptics } from './haptics';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
const params = new URLSearchParams(location.search);
const BOT = params.has('bot');

const net = new PhoneNet();
const remote = new Remote();
let phase: Phase = 'lobby';
let lobby: LobbyUpdate | null = null;
let ready = false;
let results: { standings: Standing[]; isLeader: boolean } | null = null;

/* ---------------- screens ---------------- */
type Screen = 'join' | 'wait' | 'drive' | 'results';
let current: Screen = 'join';
function show(s: Screen): void {
  current = s;
  $('card').hidden = s === 'drive';
  $('drive').hidden = s !== 'drive';
  for (const id of ['join', 'wait', 'results'] as const) $(id).hidden = s !== id;
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
  routePhase();
  if (BOT && !ready) {
    ready = true;
    net.ready(true);
  }
}
net.onRejoined = () => {
  busy(null);
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
function renderWait(): void {
  const j = net.joined;
  if (!j || !lobby) return;
  const me = lobby.players.find((p) => p.slot === j.slot);
  const leader = !!me?.isLeader;
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
remote.onPause = () => {
  if (phase === 'race' || phase === 'countdown') net.pause(true);
  else if (phase === 'paused') $('pauseSheet').hidden = false;
};
$('resumeBtn').addEventListener('click', () => net.pause(false));
$('pauseControls').addEventListener('click', () => openSettings());
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
