/**
 * Turbo Karts server: a thin relay. It serves the host and controller apps on one port,
 * and relays Socket.IO messages between phones and the host screen. It never simulates the game.
 */
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server, type Namespace } from 'socket.io';
import type { ControllerToServer, ServerToController, HostToServer, ServerToHost, NetInfo, NetPresence } from '@tk/shared';
import { lanCandidates, publicUrlFromEnv, windowsPublicProfile } from './lan';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PROD = process.argv.includes('--prod');
const PORT = Number(process.env.PORT) || 3000;

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
  // phones on a LAN: keep heartbeats short so a locked phone is noticed quickly
  pingInterval: 5000,
  pingTimeout: 6000,
});

const hostNs: Namespace<HostToServer, ServerToHost> = io.of('/host');
const ctrlNs: Namespace<ControllerToServer, ServerToController> = io.of('/controller');

const presence = new Map<string, { device: string; rttMs: number | null }>();
function broadcastPresence(): void {
  const p: NetPresence = { controllers: [...presence].map(([id, v]) => ({ id, ...v })) };
  hostNs.emit('net:presence', p);
}

hostNs.on('connection', (socket) => {
  socket.on('net:info', (ack) => {
    if (typeof ack === 'function') ack(netInfo());
  });
  socket.on('ping', (t, ack) => {
    if (typeof ack === 'function') ack(typeof t === 'number' ? t : 0);
  });
  broadcastPresence();
});

ctrlNs.on('connection', (socket) => {
  const ua = String(socket.handshake.headers['user-agent'] ?? '');
  const device = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : 'Desktop';
  presence.set(socket.id, { device, rttMs: null });
  broadcastPresence();

  socket.on('ping', (t, ack) => {
    if (typeof ack === 'function') ack(typeof t === 'number' ? t : 0);
  });
  socket.on('net:rtt', (rtt) => {
    const entry = presence.get(socket.id);
    if (entry && typeof rtt === 'number' && Number.isFinite(rtt)) {
      entry.rttMs = Math.max(0, Math.min(10000, Math.round(rtt)));
      broadcastPresence();
    }
  });
  socket.on('disconnect', () => {
    presence.delete(socket.id);
    broadcastPresence();
  });
});

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
  for (const [route, file] of Object.entries(PAGES)) {
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
