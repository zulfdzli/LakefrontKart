/**
 * Turbo Karts server: a thin relay. It serves the host and controller apps on one port, manages rooms
 * and slots, validates what phones send, and relays messages between phones and the host screen.
 * It never simulates the game (section 4).
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Namespace, type Socket } from 'socket.io';
import {
  cleanName,
  isHapticKind,
  sanitizeInput,
  type ControllerToServer,
  type ServerToController,
  type HostToServer,
  type ServerToHost,
  type NetInfo,
  type PlayerSettings,
} from '@tk/shared';
import { lanCandidates, publicUrlFromEnv, windowsPublicProfile } from './lan';
import { RoomManager, type Room } from './rooms';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROD = process.argv.includes('--prod');
const PORT = Number(process.env.PORT) || 3000;
/** Section 5.4: at most 60 input messages per second per phone. */
const INPUT_CAP_PER_S = 60;

const app = express();
app.disable('x-powered-by');
const httpServer = http.createServer(app);

/* ---------------- network info ---------------- */

const candidates = lanCandidates(PORT);
const publicUrl = publicUrlFromEnv();
let publicNetworkProfile = false;
const netInfo = (): NetInfo => ({ port: PORT, candidates, publicUrl, publicNetworkProfile });

/* ---------------- Socket.IO ---------------- */

const io = new Server(httpServer, {
  transports: ['websocket', 'polling'],
  // phones on a LAN: short heartbeats so a locked phone is noticed quickly
  pingInterval: 4000,
  pingTimeout: 5000,
  maxHttpBufferSize: 16 * 1024,
});
const hostNs: Namespace<HostToServer, ServerToHost> = io.of('/host');
const ctrlNs: Namespace<ControllerToServer, ServerToController> = io.of('/controller');
const rooms = new RoomManager();

const hostRoom = (code: string): string => `h:${code}`;
const ctrlRoom = (code: string): string => `r:${code}`;
const phaseMsg = (room: Room): { phase: Room['phase']; pausedBy?: string } =>
  room.phase === 'paused' && room.pausedBy ? { phase: room.phase, pausedBy: room.pausedBy } : { phase: room.phase };

function broadcastLobby(room: Room): void {
  const u = rooms.lobbyUpdate(room);
  hostNs.to(hostRoom(room.code)).emit('lobby:update', u);
  ctrlNs.to(ctrlRoom(room.code)).emit('lobby:update', u);
}

function deviceOf(socket: Socket): 'iOS' | 'Android' | 'Desktop' {
  const ua = String(socket.handshake.headers['user-agent'] ?? '');
  return /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : 'Desktop';
}

const isFn = (f: unknown): f is (...a: never[]) => void => typeof f === 'function';

/* ---- host screen ---- */
hostNs.on('connection', (socket) => {
  let room: Room | null = null;
  const attach = (r: Room): void => {
    room = r;
    void socket.join(hostRoom(r.code));
    ctrlNs.to(ctrlRoom(r.code)).emit('host:status', { online: true });
    broadcastLobby(r);
  };

  socket.on('host:create', (ack) => {
    if (!isFn(ack)) return;
    if (room) return ack({ room: room.code, hostToken: room.hostToken });
    const r = rooms.createRoom(socket.id);
    attach(r);
    ack({ room: r.code, hostToken: r.hostToken });
  });
  socket.on('host:resume', (p, ack) => {
    if (!isFn(ack)) return;
    const r = rooms.resumeHost(p?.room, p?.hostToken, socket.id);
    if (r) attach(r);
    ack({ ok: !!r });
  });
  socket.on('net:info', (ack) => {
    if (isFn(ack)) ack(netInfo());
  });
  socket.on('ping', (t, ack) => {
    if (isFn(ack)) ack(typeof t === 'number' ? t : 0);
  });

  socket.on('host:state', (st) => {
    if (!room || typeof st !== 'object' || st === null) return;
    const by = st.phase === 'paused' ? cleanName(st.pausedBy, '') || null : null;
    if (rooms.setPhase(room, st.phase)) {
      room.pausedBy = room.phase === 'paused' ? by : null;
      ctrlNs.to(ctrlRoom(room.code)).emit('phase', phaseMsg(room));
      broadcastLobby(room);
    }
    if (!Array.isArray(st.players)) return;
    for (const ps of st.players) {
      const p = room.slots[ps?.slot];
      if (p?.socketId) ctrlNs.to(p.socketId).volatile.emit('hud', ps.hud);
    }
  });
  socket.on('host:haptic', (h) => {
    const p = room?.slots[h?.slot];
    if (!p?.socketId || !isHapticKind(h.kind)) return;
    const n = typeof h.n === 'number' && Number.isFinite(h.n) ? Math.round(h.n) : undefined;
    ctrlNs.to(p.socketId).emit('haptic', n === undefined ? { kind: h.kind } : { kind: h.kind, n });
  });
  socket.on('host:results', (r) => {
    if (!room || !Array.isArray(r?.standings)) return;
    for (const p of rooms.players(room))
      if (p.socketId)
        ctrlNs.to(p.socketId).emit('results', { standings: r.standings, isLeader: rooms.isLeader(room, p) });
  });
  socket.on('host:kick', (k) => {
    if (!room || typeof k?.slot !== 'number') return;
    const p = rooms.remove(room, k.slot);
    if (p?.socketId) {
      ctrlNs.to(p.socketId).emit('kicked');
      ctrlNs.sockets.get(p.socketId)?.leave(ctrlRoom(room.code));
    }
    broadcastLobby(room);
  });
  socket.on('host:config', (c) => {
    if (room && rooms.setConfig(room, c)) broadcastLobby(room);
  });
  socket.on('disconnect', () => {
    if (!room || room.hostSocketId !== socket.id) return;
    rooms.hostDisconnected(room);
    ctrlNs.to(ctrlRoom(room.code)).emit('host:status', { online: false });
  });
});

/* ---- phones ---- */
ctrlNs.on('connection', (socket) => {
  let room: Room | null = null;
  let slot = -1;
  let windowStart = 0,
    inWindow = 0;
  const me = () => (room && slot >= 0 ? (room.slots[slot] ?? null) : null);
  const hostSocket = (): string | null => room?.hostSocketId ?? null;
  const toHost = (): ReturnType<typeof hostNs.to> | null => (room ? hostNs.to(hostRoom(room.code)) : null);

  socket.on('player:join', (req, ack) => {
    if (!isFn(ack)) return;
    const already = me();
    if (already && room) return ack({ ok: true, data: rooms.joinOk(room, already) });
    const r = rooms.join(req?.room, req?.name, req?.playerToken, socket.id);
    if (!r.ok) return ack({ ok: false, reason: r.reason });
    room = rooms.rooms.get(String(req.room).trim().toUpperCase())!;
    slot = r.player.slot;
    void socket.join(ctrlRoom(room.code));
    ack({ ok: true, data: r.data });
    socket.emit('phase', phaseMsg(room));
    socket.emit('host:status', { online: hostSocket() !== null });
    toHost()?.emit('player:device', { slot, device: deviceOf(socket) });
    broadcastLobby(room);
  });

  socket.on('player:ready', (p) => {
    const pl = me();
    if (!room || !pl) return;
    rooms.setReady(room, pl, p?.ready);
    broadcastLobby(room);
  });
  socket.on('player:select', (p) => {
    const pl = me();
    if (!room || !pl) return;
    const res = rooms.select(room, pl, p?.characterId);
    if (res === 'ok') broadcastLobby(room);
    else socket.emit('select:error', { reason: res });
  });
  socket.on('player:settings', (s) => {
    if (!room || slot < 0 || typeof s !== 'object' || s === null) return;
    const settings: PlayerSettings = {
      steering: s.steering === 'slider' ? 'slider' : 'buttons',
      assist: s.assist === true,
      sensitivity:
        typeof s.sensitivity === 'number' && Number.isFinite(s.sensitivity)
          ? Math.max(0.6, Math.min(1.4, s.sensitivity))
          : 1,
    };
    toHost()?.emit('player:settings', { slot, settings });
  });
  socket.on('leader:config', (c) => {
    const pl = me();
    if (!room || !pl || !rooms.isLeader(room, pl)) return;
    if (rooms.setConfig(room, c)) {
      toHost()?.emit('leader:config', room.config);
      broadcastLobby(room);
    }
  });
  socket.on('player:start', () => {
    const pl = me();
    if (!room || !pl || !rooms.isLeader(room, pl) || room.phase !== 'lobby') return;
    toHost()?.emit('player:start', { slot });
  });
  socket.on('player:rematch', (p) => {
    const pl = me();
    if (!room || !pl || !rooms.isLeader(room, pl) || room.phase !== 'results') return;
    toHost()?.emit('player:rematch', { slot, toLobby: p?.toLobby === true });
  });
  socket.on('player:pause', (p) => {
    if (!room || slot < 0 || !me()) return;
    if (room.phase !== 'countdown' && room.phase !== 'race' && room.phase !== 'paused') return;
    toHost()?.emit('player:pause', { slot, paused: p?.paused === true });
  });
  socket.on('player:leave', () => {
    if (!room || slot < 0) return;
    rooms.remove(room, slot);
    void socket.leave(ctrlRoom(room.code));
    broadcastLobby(room);
    room = null;
    slot = -1;
  });
  socket.on('player:input', (raw) => {
    if (!room || slot < 0 || !me()) return;
    // rate limit (section 5.4): drop anything beyond the cap within a one-second window
    const t = Date.now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      inWindow = 0;
    }
    if (++inWindow > INPUT_CAP_PER_S) return;
    const inp = sanitizeInput(raw);
    if (!inp) return;
    toHost()?.volatile.emit('player:input', { ...inp, slot });
  });
  socket.on('ping', (t, ack) => {
    if (isFn(ack)) ack(typeof t === 'number' ? t : 0);
  });
  socket.on('net:rtt', (rtt) => {
    if (!room || slot < 0 || typeof rtt !== 'number' || !Number.isFinite(rtt)) return;
    toHost()?.volatile.emit('player:latency', { slot, rttMs: Math.max(0, Math.min(10000, Math.round(rtt))) });
  });
  socket.on('disconnect', () => {
    const hit = rooms.disconnect(socket.id);
    if (hit) broadcastLobby(hit.room);
  });
});

setInterval(() => {
  const { changed, deleted } = rooms.sweep();
  for (const r of changed) broadcastLobby(r);
  for (const code of deleted) ctrlNs.to(ctrlRoom(code)).emit('host:status', { online: false });
}, 5000).unref();

/* ---------------- HTTP: apps ---------------- */

const PAGES: Record<string, string> = { '/': 'host/index.html', '/play': 'controller/index.html' };

if (PROD) {
  const dist = path.join(ROOT, 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  for (const [route, file] of Object.entries(PAGES)) {
    app.get(route, (_req, res) => res.sendFile(path.join(dist, file)));
  }
} else {
  const { createServer: createVite } = await import('vite');
  const vite = await createVite({
    configFile: path.join(ROOT, 'vite.config.ts'),
    // HMR rides on the same HTTP server, so phones only ever need one port
    server: { middlewareMode: true, hmr: { server: httpServer } },
    appType: 'custom',
  });
  // development only: the race car's four-view sheet (tools/car-sheet.ts, D44)
  const devPages = { ...PAGES, '/dev/car': 'tools/carview/index.html' };
  for (const [route, file] of Object.entries(devPages)) {
    app.get(route, async (req, res, next) => {
      try {
        const raw = await fs.readFile(path.join(ROOT, file), 'utf8');
        res.type('html').send(await vite.transformIndexHtml(req.originalUrl, raw));
      } catch (e) {
        vite.ssrFixStacktrace(e as Error);
        next(e);
      }
    });
  }
  app.use(vite.middlewares);
}

/* ---------------- start ---------------- */

httpServer.listen(PORT, '0.0.0.0', () => {
  const base = publicUrl ?? candidates[0]?.url ?? null;
  const lines = [
    '',
    `  Turbo Karts ${PROD ? '(production build)' : '(dev)'}`,
    `  Host screen:  http://localhost:${PORT}/`,
    ...candidates.map((c, i) => `  ${i === 0 ? 'LAN URL:     ' : '             '} ${c.url}/   (${c.name})`),
    publicUrl ? `  PUBLIC_URL:   ${publicUrl}/` : '',
    base ? `  Controller:   ${base}/play` : '  Controller:   no LAN address found. Connect to Wi-Fi or set PUBLIC_URL.',
    '',
  ].filter((l) => l !== '');
  console.log(lines.join('\n') + '\n');

  void windowsPublicProfile(candidates.map((c) => c.name)).then((isPublic) => {
    publicNetworkProfile = isPublic;
    if (isPublic) {
      console.warn(
        '  ⚠ Your Wi-Fi is set to a PUBLIC network profile, so Windows Firewall will block phones.\n' +
          '    Fix: Settings → Network & internet → Wi-Fi → (your network) → Network profile type: Private.\n',
      );
    }
  });
});
