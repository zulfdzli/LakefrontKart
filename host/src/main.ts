import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import * as THREE from 'three';
import QRCode from 'qrcode';
import { io, type Socket } from 'socket.io-client';
import type { HostToServer, ServerToHost, NetInfo } from '@tk/shared';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

/* ---- Three.js from npm, with current colour management (proves no-CDN rendering works) ---- */
const renderer = new THREE.WebGLRenderer({ canvas: $<HTMLCanvasElement>('bg'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#4ea7ea');
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 1.5, 7);
scene.add(new THREE.HemisphereLight('#eaf6ff', '#7da35c', 1.4));
const sun = new THREE.DirectionalLight('#fff1d6', 2.2);
sun.position.set(3, 5, 4);
scene.add(sun);
const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1.6, 1.6, 1.6),
  new THREE.MeshStandardMaterial({ color: '#e53935', roughness: 0.45 }),
);
cube.position.set(-4.2, 0.4, -2);
scene.add(cube);
function resize(): void {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop((t) => {
  cube.rotation.set(t * 0.0004, t * 0.0007, 0);
  renderer.render(scene, camera);
});

/* ---- network: QR, URL, connected phones ---- */
const socket: Socket<ServerToHost, HostToServer> = io('/host', { transports: ['websocket', 'polling'] });

async function showQr(base: string): Promise<void> {
  const url = `${base}/play`;
  $('url').textContent = url;
  $('qr').innerHTML = await QRCode.toString(url, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#1d1b2e', light: '#ffffff' },
  });
}

function applyNet(info: NetInfo): void {
  const sel = $<HTMLSelectElement>('netSel');
  const options = info.publicUrl ? [{ name: 'PUBLIC_URL', url: info.publicUrl }] : info.candidates;
  const first = options[0];
  if (!first) {
    $('url').textContent = 'No LAN address found. Connect this computer to Wi-Fi, or set PUBLIC_URL.';
    return;
  }
  sel.innerHTML = '';
  for (const o of options) sel.add(new Option(`${o.name} — ${o.url}`, o.url));
  $('netPick').hidden = options.length < 2;
  sel.onchange = () => void showQr(sel.value);
  void showQr(first.url);
  const warn = $('warn');
  warn.hidden = !info.publicNetworkProfile;
  warn.textContent =
    'Your Wi-Fi is set to Public, so Windows Firewall blocks phones. Switch it to Private in Settings → Network & internet → Wi-Fi.';
}

socket.on('connect', () => {
  $('status').textContent = 'Connected to server. Scan the code with a phone on the same Wi-Fi.';
  socket.emit('net:info', applyNet);
  // the firewall check finishes a moment after server start; ask again so the warning appears
  setTimeout(() => socket.emit('net:info', applyNet), 7000);
});
socket.on('disconnect', () => {
  $('status').textContent = 'Server connection lost. Reconnecting…';
});
// update rows in place, so a row only animates in once (not on every RTT update)
const rows = new Map<string, HTMLLIElement>();
socket.on('net:presence', (p) => {
  $('count').textContent = String(p.controllers.length);
  const list = $('phones');
  const live = new Set(p.controllers.map((c) => c.id));
  for (const [id, li] of rows) {
    if (live.has(id)) continue;
    li.remove();
    rows.delete(id);
  }
  p.controllers.forEach((c, i) => {
    let li = rows.get(c.id);
    if (!li) {
      li = document.createElement('li');
      li.append(document.createElement('span'), document.createElement('b'));
      rows.set(c.id, li);
      list.append(li); // presence arrives in connection order, so appending keeps the order
    }
    li.children[0]!.textContent = `Phone ${i + 1} · ${c.device}`;
    li.children[1]!.textContent = c.rttMs === null ? '…' : `${c.rttMs} ms`;
  });
});
