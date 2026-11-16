/**
 * Geometry helpers ported from the prototype: merged, flat-shaded, vertex-coloured parts,
 * jitter for organic shapes, inverted-hull outlines and canvas textures.
 */
import * as THREE from 'three';

export function hash3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1274126177) ^ Math.imul(s | 0, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export const nonIdx = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);

export function jitter(geo: THREE.BufferGeometry, amt: number, seed: number): THREE.BufferGeometry {
  const g = nonIdx(geo),
    p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = Math.round(x * 997), b = Math.round(y * 997), c = Math.round(z * 997);
    p.setXYZ(i, x + (hash3(a, b, c, seed) - 0.5) * amt, y + (hash3(b, c, a, seed + 7) - 0.5) * amt, z + (hash3(c, a, b, seed + 13) - 0.5) * amt);
  }
  p.needsUpdate = true;
  return g;
}

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();

/** A colour per face: either one hex, or a function of the face centre (world space) and face index. */
export type PartColor = number | ((x: number, y: number, z: number, face: number) => number);

export interface Part {
  geo: THREE.BufferGeometry;
  color: PartColor;
  m: THREE.Matrix4;
}

/** A positioned, rotated, scaled, coloured part. */
export function P_(geo: THREE.BufferGeometry, color: PartColor, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): Part {
  return { geo, color, m: new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)) };
}

/** Move parts into a frame at (x, y, z) rotated by ry. */
export function inFrame(parts: Part[], x: number, y: number, z: number, ry: number): Part[] {
  const F = new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1));
  for (const p of parts) p.m.premultiply(F);
  return parts;
}

/** Merge parts into one flat-shaded geometry with per-face vertex colours (linear, via THREE.Color). */
export function merge(parts: Part[]): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = [];
  let total = 0;
  for (const p of parts) {
    const g = nonIdx(p.geo).clone();
    g.applyMatrix4(p.m);
    gs.push(g);
    total += g.attributes.position!.count;
  }
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  gs.forEach((g, gi) => {
    const a = g.attributes.position!.array as Float32Array, cnt = g.attributes.position!.count, pc = parts[gi]!.color;
    pos.set(a, o * 3);
    for (let v = 0; v < cnt; v += 3) {
      if (typeof pc === 'function') {
        const b = v * 3;
        _c.setHex(pc((a[b]! + a[b + 3]! + a[b + 6]!) / 3, (a[b + 1]! + a[b + 4]! + a[b + 7]!) / 3, (a[b + 2]! + a[b + 5]! + a[b + 8]!) / 3, v / 3));
      } else if (v === 0) _c.setHex(pc);
      for (let w = 0; w < 3; w++) {
        const q = (o + v + w) * 3;
        col[q] = _c.r; col[q + 1] = _c.g; col[q + 2] = _c.b;
      }
    }
    o += cnt;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeVertexNormals();
  return out;
}

/** Inverted-hull outline: push every vertex out along the averaged normal of its position. */
export function outlineGeo(geo: THREE.BufferGeometry, t: number): THREE.BufferGeometry {
  const p = geo.attributes.position!, nr = geo.attributes.normal!, map = new Map<string, [number, number, number]>(), keys: string[] = new Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const key = Math.round(p.getX(i) * 400) + ',' + Math.round(p.getY(i) * 400) + ',' + Math.round(p.getZ(i) * 400);
    keys[i] = key;
    let s = map.get(key);
    if (!s) { s = [0, 0, 0]; map.set(key, s); }
    s[0] += nr.getX(i); s[1] += nr.getY(i); s[2] += nr.getZ(i);
  }
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = map.get(keys[i]!)!, l = Math.hypot(s[0], s[1], s[2]) || 1;
    out[i * 3] = p.getX(i) + (s[0] / l) * t; out[i * 3 + 1] = p.getY(i) + (s[1] / l) * t; out[i * 3 + 2] = p.getZ(i) + (s[2] / l) * t;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(out, 3));
  return g;
}

let maxAniso = 1;
export function setMaxAnisotropy(n: number): void {
  maxAniso = n;
}

/** A canvas-drawn colour texture (sRGB), repeating unless clampEdge. */
export function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, clampEdge = false): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = clampEdge ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
  t.anisotropy = Math.min(8, maxAniso);
  return t;
}

/** Speckle noise for canvas textures. Uses its own seeded generator so textures are stable. */
export function noiseDots(g: CanvasRenderingContext2D, w: number, h: number, n: number, a: number, rand: () => number): void {
  for (let i = 0; i < n; i++) {
    g.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,' + a + ')' : 'rgba(0,0,0,' + a + ')';
    g.fillRect(rand() * w, rand() * h, 2, 2);
  }
}

export const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
export const cyl = (rt: number, rb: number, h: number, s: number): THREE.BufferGeometry => new THREE.CylinderGeometry(rt, rb, h, s);
export const ico = (r: number, d = 0): THREE.BufferGeometry => new THREE.IcosahedronGeometry(r, d);
export const cone = (r: number, h: number, s: number): THREE.BufferGeometry => new THREE.ConeGeometry(r, h, s);
export const octa = (r: number): THREE.BufferGeometry => new THREE.OctahedronGeometry(r, 0);

export const hexStr = (c: number): string => '#' + c.toString(16).padStart(6, '0');
