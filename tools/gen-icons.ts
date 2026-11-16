/**
 * Draws the controller's home-screen icons (D16a) into PNGs with no image libraries:
 * a pearl-white rounded tile with a cross pad and a glowing blue round button.
 *   npx tsx tools/gen-icons.ts
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../host/public/controller/', import.meta.url));

function crc32(buf: Buffer): number {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]!) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, rgba: Uint8Array): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const sdRoundBox = (px: number, py: number, bx: number, by: number, r: number): number => {
  const qx = Math.abs(px) - bx + r, qy = Math.abs(py) - by + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
type RGBA = [number, number, number, number];
const mix = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
const over = (dst: RGBA, src: RGBA, cov: number): RGBA => mix(dst, [src[0], src[1], src[2], 255], (src[3] / 255) * cov);
const cover = (d: number, px: number): number => Math.max(0, Math.min(1, 0.5 - d / px));

/** Colour at normalised coordinates (-1..1). `full` = tile fills the square (maskable/apple). */
function shade(x: number, y: number, px: number, full: boolean): RGBA {
  let c: RGBA = [0, 0, 0, 0];
  const tile = full ? -1 : sdRoundBox(x, y, 0.92, 0.92, 0.36);
  const g = 0.5 - y * 0.25;
  c = over(c, [Math.round(232 + 20 * g), Math.round(236 + 18 * g), Math.round(242 + 12 * g), 255], full ? 1 : cover(tile, px));
  // cross pad (left)
  const cx = x + 0.34, cy = y + 0.02;
  const cross = Math.min(sdRoundBox(cx, cy, 0.3, 0.1, 0.05), sdRoundBox(cx, cy, 0.1, 0.3, 0.05));
  c = over(c, [120, 128, 140, 70], cover(cross - 0.03, px)); // soft shadow
  c = over(c, [214, 219, 227, 255], cover(cross, px));
  // glowing blue button (right)
  const bx = x - 0.36, by = y + 0.02, d = Math.hypot(bx, by);
  c = over(c, [63, 169, 245, Math.round(120 * Math.max(0, 1 - (d - 0.24) / 0.2))], d > 0.24 ? 1 : 0);
  c = over(c, [Math.round(63 + 80 * Math.max(0, -by)), Math.round(169 + 40 * Math.max(0, -by)), 245, 255], cover(d - 0.24, px));
  return c;
}

function icon(size: number, full: boolean): Buffer {
  const out = new Uint8Array(size * size * 4), ss = 3;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc: RGBA = [0, 0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const nx = ((x + (sx + 0.5) / ss) / size) * 2 - 1, ny = ((y + (sy + 0.5) / ss) / size) * 2 - 1;
      const c = shade(nx, ny, 2 / size, full);
      acc = [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2], acc[3] + c[3]];
    }
    const i = (y * size + x) * 4, n = ss * ss;
    out[i] = acc[0] / n; out[i + 1] = acc[1] / n; out[i + 2] = acc[2] / n; out[i + 3] = acc[3] / n;
  }
  return png(size, size, out);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'icon-192.png', icon(192, false));
writeFileSync(OUT + 'icon-512.png', icon(512, false));
writeFileSync(OUT + 'icon-180.png', icon(180, true));
writeFileSync(OUT + 'icon-maskable-512.png', icon(512, true));
writeFileSync(OUT + 'manifest.webmanifest', JSON.stringify({
  name: 'Turbo Karts Controller',
  short_name: 'Turbo Karts',
  start_url: '/play',
  scope: '/',
  display: 'fullscreen',
  orientation: 'landscape',
  background_color: '#e9edf3',
  theme_color: '#e9edf3',
  icons: [
    { src: '/controller/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/controller/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/controller/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));
console.log('icons written to', OUT);
