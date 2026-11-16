import '@fontsource/fredoka/600.css';
import '@fontsource/fredoka/700.css';
import './style.css';
import { io, type Socket } from 'socket.io-client';
import type { ControllerToServer, ServerToController } from '@tk/shared';

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el;
};

const socket: Socket<ServerToController, ControllerToServer> = io('/controller', {
  transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
  $('state').textContent = 'Connected to the host computer ✓';
  $('state').className = 'state ok';
});
socket.on('disconnect', () => {
  $('state').textContent = 'Reconnecting…';
  $('state').className = 'state';
});

// measure the round-trip time once a second
setInterval(() => {
  if (!socket.connected) return;
  const t0 = performance.now();
  socket.emit('ping', Date.now(), () => {
    const rtt = performance.now() - t0;
    $('rtt').textContent = `${Math.round(rtt)} ms`;
    socket.emit('net:rtt', rtt);
  });
}, 1000);

// instant local press feedback, before any network round trip (section 12.1)
const tap = $('tap');
tap.addEventListener('pointerdown', (e) => {
  tap.classList.add('on');
  tap.setPointerCapture(e.pointerId);
  navigator.vibrate?.(15);
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
  tap.addEventListener(ev, () => tap.classList.remove('on'));
}
document.addEventListener('contextmenu', (e) => e.preventDefault());
