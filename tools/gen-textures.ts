/**
 * Generates the surface texture sets (section 11.3) with seeded, tileable noise and bakes them to PNG under
 * host/public/textures/. Every texture tiles seamlessly; the game samples them in world space and breaks up
 * repetition with the low-frequency `macro` texture.
 *
 * For each surface: `<name>.png` (albedo, sRGB) and `<name>_h.png` (height, grey). Normal maps are derived from
 * the height maps in the browser (smaller downloads). `detail.png` holds road wear masks (R patches, G cracks,
 * B oil stains). Every texture also gets a half-size `_lo` version for the Low quality tier.
 *
 *   npm run textures
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encodePng } from './png';

const OUT = fileURLToPath(new URL('../host/public/textures/', import.meta.url));

/* ---------------- tileable noise ---------------- */

/** Integer hash to [0, 1). */
function hash(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const wrap = (i: number, p: number): number => ((i % p) + p) % p;

/** Value noise, period p (tileable). */
function vnoise(x: number, y: number, p: number, s: number): number {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = fade(x - ix),
    fy = fade(y - iy);
  const x0 = wrap(ix, p),
    x1 = wrap(ix + 1, p),
    y0 = wrap(iy, p),
    y1 = wrap(iy + 1, p);
  const a = hash(x0, y0, s),
    b = hash(x1, y0, s),
    c = hash(x0, y1, s),
    d = hash(x1, y1, s);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal noise in [0, 1], base period p (an integer, so it tiles). */
function fbm(u: number, v: number, p: number, oct: number, s: number, gain = 0.5): number {
  let sum = 0,
    amp = 1,
    norm = 0,
    f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise(u * p * f, v * p * f, p * f, s + o * 17);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Cellular noise with `n` cells per side (tileable): distance to the nearest and second-nearest point, and its id. */
function worley(u: number, v: number, n: number, s: number): { f1: number; f2: number; id: number } {
  const x = u * n,
    y = v * n,
    ix = Math.floor(x),
    iy = Math.floor(y);
  let f1 = 9,
    f2 = 9,
    id = 0;
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const cx = wrap(ix + dx, n),
        cy = wrap(iy + dy, n);
      const px = ix + dx + hash(cx, cy, s),
        py = iy + dy + hash(cx, cy, s + 1);
      const d = Math.hypot(px - x, py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        id = hash(cx, cy, s + 2);
      } else if (d < f2) f2 = d;
    }
  return { f1, f2, id };
}

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth = (a: number, b: number, t: number): number => {
  const x = clamp01((t - a) / (b - a));
  return x * x * (3 - 2 * x);
};
type RGB = [number, number, number];
const mixc = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

/* ---------------- image helpers ---------------- */

interface Img {
  n: number;
  ch: 1 | 3;
  data: Uint8Array;
}
function make(n: number, ch: 1 | 3, f: (u: number, v: number) => number | RGB): Img {
  const data = new Uint8Array(n * n * ch);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const r = f(x / n, y / n),
        o = (y * n + x) * ch;
      if (typeof r === 'number') data[o] = Math.round(clamp01(r) * 255);
      else for (let k = 0; k < 3; k++) data[o + k] = Math.round(Math.max(0, Math.min(255, r[k]!)));
    }
  return { n, ch, data };
}
/** 2 × 2 box downsample (for the Low tier). */
function half(img: Img): Img {
  const n = img.n / 2,
    ch = img.ch,
    data = new Uint8Array(n * n * ch);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      for (let k = 0; k < ch; k++) {
        const at = (xx: number, yy: number): number => img.data[(yy * img.n + xx) * ch + k]!;
        data[(y * n + x) * ch + k] =
          (at(2 * x, 2 * y) + at(2 * x + 1, 2 * y) + at(2 * x, 2 * y + 1) + at(2 * x + 1, 2 * y + 1)) >> 2;
      }
  return { n, ch, data };
}
let total = 0;
function save(name: string, img: Img): void {
  for (const [suffix, im] of [
    ['', img],
    ['_lo', half(img)],
  ] as const) {
    const buf = encodePng(im.n, im.n, im.ch, im.data);
    writeFileSync(path.join(OUT, `${name}${suffix}.png`), buf);
    total += buf.length;
    console.log(`  ${name}${suffix}.png  ${im.n}px  ${(buf.length / 1024).toFixed(0)} KB`);
  }
}

/* ---------------- the texture sets ---------------- */

/** Asphalt, 4 m per tile: aggregate stones in dark binder, with fine grain. */
function asphalt(): void {
  const N = 1024,
    cells = 96;
  const h = new Float32Array(N * N);
  const alb = make(N, 3, (u, v) => {
    const w = worley(u, v, cells, 11);
    const edge = w.f2 - w.f1;
    const stone = smooth(0.06, 0.2, edge);
    const tone = 0.78 + w.id * 0.42 + (w.id > 0.94 ? 0.35 : 0);
    const grain = fbm(u, v, 64, 3, 21);
    const mottled = fbm(u, v, 6, 4, 31);
    const base: RGB = [68, 70, 74];
    const binder: RGB = [40, 41, 44];
    const tint: RGB = w.id > 0.5 ? [1.03, 1.0, 0.96] : [0.97, 0.99, 1.03];
    let c = mixc(binder, [base[0] * tone * tint[0], base[1] * tone * tint[1], base[2] * tone * tint[2]], stone);
    const k = 0.86 + mottled * 0.22 + (grain - 0.5) * 0.18;
    c = [c[0] * k, c[1] * k, c[2] * k];
    h[Math.round(v * N) * N + Math.round(u * N)] = stone * (0.55 + 0.45 * smooth(0.06, 0.35, edge)) + grain * 0.15;
    return c;
  });
  save('asphalt', alb);
  save(
    'asphalt_h',
    make(N, 1, (u, v) => h[Math.round(v * N) * N + Math.round(u * N)]!),
  );
}

/** Road wear masks, 48 m per tile: R patch repairs, G cracks, B oil stains. */
function detail(): void {
  const N = 1024,
    data = new Float32Array(N * N * 3);
  const put = (x: number, y: number, k: number, val: number): void => {
    const i = (wrap(Math.round(y), N) * N + wrap(Math.round(x), N)) * 3 + k;
    data[i] = Math.max(data[i]!, val);
  };
  let seed = 7;
  const rnd = (): number => hash(seed++, 3, 99);
  // patch repairs: rough-edged rectangles
  for (let p = 0; p < 9; p++) {
    const cx = rnd() * N,
      cy = rnd() * N,
      w = 40 + rnd() * 120,
      hh = 25 + rnd() * 70,
      a = rnd() * Math.PI;
    const ca = Math.cos(a),
      sa = Math.sin(a);
    for (let y = -hh - 8; y <= hh + 8; y++)
      for (let x = -w - 8; x <= w + 8; x++) {
        const n = fbm(((cx + x) / N + 1) % 1, ((cy + y) / N + 1) % 1, 32, 3, 50) * 10;
        const d = Math.max(Math.abs(x) - w, Math.abs(y) - hh) + n - 5;
        const val = 1 - smooth(-2, 2, d);
        if (val > 0) put(cx + x * ca - y * sa, cy + x * sa + y * ca, 0, val);
      }
  }
  // fine cracks: branching random walks
  for (let c = 0; c < 46; c++) {
    let x = rnd() * N,
      y = rnd() * N,
      a = rnd() * Math.PI * 2;
    const len = 80 + rnd() * 260;
    for (let s = 0; s < len; s++) {
      a += (rnd() - 0.5) * 0.7;
      x += Math.cos(a);
      y += Math.sin(a);
      put(x, y, 1, 1);
      put(x + 0.5, y + 0.5, 1, 0.5);
      if (rnd() < 0.01) {
        let bx = x,
          by = y,
          ba = a + (rnd() < 0.5 ? 1 : -1) * 0.9;
        for (let b = 0; b < 40 + rnd() * 60; b++) {
          ba += (rnd() - 0.5) * 0.6;
          bx += Math.cos(ba);
          by += Math.sin(ba);
          put(bx, by, 1, 0.8);
        }
      }
    }
  }
  // oil stains: soft blotches
  for (let o = 0; o < 10; o++) {
    const cx = rnd() * N,
      cy = rnd() * N,
      r = 10 + rnd() * 26;
    for (let y = -r * 2; y <= r * 2; y++)
      for (let x = -r * 2; x <= r * 2; x++) {
        const n = fbm(((cx + x) / N + 1) % 1, ((cy + y) / N + 1) % 1, 48, 3, 70);
        const val = (1 - smooth(r * 0.3, r * 1.6, Math.hypot(x, y))) * (0.5 + n * 0.8);
        put(cx + x, cy + y, 2, clamp01(val));
      }
  }
  const img = make(N, 3, (u, v) => {
    const i = (Math.round(v * N) % N) * N + (Math.round(u * N) % N);
    return [data[i * 3]! * 255, data[i * 3 + 1]! * 255, data[i * 3 + 2]! * 255];
  });
  save('detail', img);
}

/** Large-scale variation, 160 m per tile. */
function macro(): void {
  save(
    'macro',
    make(512, 1, (u, v) => fbm(u, v, 5, 5, 400)),
  );
}

/** A ground layer: albedo and height from one function. */
function layer(name: string, n: number, f: (u: number, v: number) => { c: RGB; h: number }): void {
  const hs = new Float32Array(n * n);
  const alb = make(n, 3, (u, v) => {
    const r = f(u, v);
    hs[Math.round(v * n) * n + Math.round(u * n)] = r.h;
    return r.c;
  });
  save(name, alb);
  save(
    `${name}_h`,
    make(n, 1, (u, v) => hs[Math.round(v * n) * n + Math.round(u * n)]!),
  );
}

function grounds(): void {
  // grass, 3 m per tile: fine blades over soft clumps; neutral green (each theme tints it)
  layer('grass', 512, (u, v) => {
    const blades = fbm(u, v * 0.35 + u * 0.1, 48, 3, 101);
    const clumps = fbm(u, v, 8, 4, 111);
    const shade = fbm(u, v, 24, 3, 121);
    const dry = smooth(0.62, 0.85, fbm(u, v, 4, 3, 131));
    const t = clamp01(blades * 0.65 + clumps * 0.5 - 0.2);
    let c = mixc([48, 92, 34], [118, 168, 66], t);
    c = mixc(c, [150, 150, 78], dry * 0.45);
    c = mixc(c, [40, 70, 30], smooth(0.55, 0.85, 1 - shade) * 0.35);
    return { c, h: clamp01(t * 0.85 + shade * 0.15) };
  });
  // dirt, 4 m per tile: clods and small pebbles
  layer('dirt', 512, (u, v) => {
    const n = fbm(u, v, 16, 5, 201);
    const w = worley(u, v, 40, 211);
    const pebble = smooth(0.05, 0.16, w.f2 - w.f1) * (w.id > 0.72 ? 1 : 0);
    let c = mixc([92, 66, 44], [142, 108, 76], n);
    c = mixc(c, [168, 150, 128], pebble * 0.7);
    return { c, h: clamp01(n * 0.7 + pebble * 0.4) };
  });
  // rock, 6 m per tile: strata and cracks
  layer('rock', 512, (u, v) => {
    const n = fbm(u, v, 8, 5, 301);
    const strata = 0.5 + 0.5 * Math.sin((v * 7 + n * 1.8) * Math.PI * 2);
    const w = worley(u, v, 10, 311);
    const crack = 1 - smooth(0.0, 0.06, w.f2 - w.f1);
    let c = mixc([104, 100, 96], [158, 152, 144], n * 0.7 + strata * 0.3);
    c = mixc(c, [62, 58, 56], crack * 0.7);
    return { c, h: clamp01(n * 0.6 + strata * 0.25 - crack * 0.4 + 0.2) };
  });
  // snow, 4 m per tile: soft drifts with blue shade and sparkles
  layer('snow', 512, (u, v) => {
    const n = fbm(u, v, 6, 5, 401);
    const sparkle = hash(Math.floor(u * 512), Math.floor(v * 512), 409) > 0.995 ? 1 : 0;
    let c = mixc([206, 218, 236], [250, 252, 255], n);
    c = mixc(c, [255, 255, 255], sparkle);
    return { c, h: n };
  });
  // sand, 4 m per tile: wind ripples and grains
  layer('sand', 512, (u, v) => {
    const n = fbm(u, v, 8, 4, 501);
    const ripple = 0.5 + 0.5 * Math.sin((u * 22 + v * 6 + n * 2.5) * Math.PI * 2);
    const grain = fbm(u, v, 128, 2, 511);
    const c = mixc([196, 160, 112], [236, 206, 156], n * 0.6 + ripple * 0.25 + grain * 0.15);
    return { c, h: clamp01(ripple * 0.55 + n * 0.35) };
  });
  // gravel, 2 m per tile: rounded pebbles
  layer('gravel', 512, (u, v) => {
    const w = worley(u, v, 34, 601);
    const peb = smooth(0.02, 0.22, w.f2 - w.f1);
    const tone = 0.7 + w.id * 0.5;
    const c: RGB = mixc([70, 66, 60], [168 * tone, 160 * tone, 146 * tone], peb);
    return { c, h: peb * (0.6 + w.id * 0.4) };
  });
  // concrete, 3 m per tile: pores and stains
  layer('concrete', 512, (u, v) => {
    const n = fbm(u, v, 12, 5, 701);
    const pore = hash(Math.floor(u * 512), Math.floor(v * 512), 709) > 0.985 ? 1 : 0;
    let c = mixc([150, 150, 146], [196, 196, 190], n);
    c = mixc(c, [96, 96, 94], pore * 0.6);
    return { c, h: clamp01(n * 0.5 - pore * 0.4 + 0.3) };
  });
}

mkdirSync(OUT, { recursive: true });
console.log('Generating textures into host/public/textures/ …');
asphalt();
detail();
macro();
grounds();
console.log(`Total ${(total / 1024 / 1024).toFixed(1)} MB`);
