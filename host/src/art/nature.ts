/**
 * D45 natural detail, per theme: ridged distant mountains with geological banding (peaks, sandstone buttes,
 * green hills), soft billboard clouds, swaying 3D grass on the verges and fields, colossal eroded sandstone
 * formations in the canyon, deep snow drifts on Frosty Peaks, and festive bunting along the start straight.
 */
import * as THREE from 'three';
import { KERB_W, Rng, type Track } from '@tk/shared';
import type { Theme } from './palette';
import type { TerrainInfo } from './track-builder';

export interface Nature {
  group: THREE.Group;
  update(time: number): void;
  /** Detail by quality tier: 1 full grass, lower values thin it out. */
  setDetail(f: number): void;
  dispose(): void;
}

/** Tileable-ish value noise for the mountain displacement. */
function vnoise(x: number, y: number, seed: number): number {
  const h = (a: number, b: number): number => {
    let n = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0;
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  const u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy);
  const a = h(ix, iy),
    b = h(ix + 1, iy),
    c = h(ix, iy + 1),
    d = h(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function ridged(x: number, y: number, seed: number): number {
  let s = 0,
    amp = 0.5,
    f = 1;
  for (let o = 0; o < 5; o++) {
    const n = 1 - Math.abs(vnoise(x * f, y * f, seed + o) * 2 - 1);
    s += n * n * amp;
    amp *= 0.5;
    f *= 2.1;
  }
  return s;
}

export function buildNature(T: Track, terrain: TerrainInfo, th: Theme, lite: boolean): Nature {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <D extends { dispose(): void }>(d: D): D => {
    disposables.push(d);
    return d;
  };
  const rng = new Rng(0x7a7e);
  const rnd = (a: number, b: number): number => rng.range(a, b);
  const TC = terrain.TC;
  let RMAX = 0;
  for (let i = 0; i < T.N; i++) RMAX = Math.max(RMAX, Math.hypot(T.CX[i]! - TC.x, T.CZ[i]! - TC.z));
  const updates: ((t: number) => void)[] = [];
  let grassSet: (f: number) => void = () => {};

  /* ---------------- distant mountains: one ring mesh, ridged noise, banded colours ---------------- */
  {
    const SEG = 220,
      RINGS = 26;
    const r0 = RMAX + 380,
      r1 = RMAX + 1250;
    const pos: number[] = [],
      col: number[] = [],
      idx: number[] = [];
    const c = new THREE.Color();
    const snowy = th.id === 'frosty' || th.id === 'meadows';
    const mesa = th.id === 'canyon';
    const green = th.id === 'tropical';
    for (let r = 0; r <= RINGS; r++) {
      const tr = r / RINGS;
      const rad = r0 + (r1 - r0) * tr;
      for (let s = 0; s <= SEG; s++) {
        const a = (s / SEG) * Math.PI * 2;
        const nx = Math.cos(a) * 3.2,
          nz = Math.sin(a) * 3.2;
        let h = ridged(nx + tr * 2.4, nz + tr * 2.4, 11) * (mesa ? 1.0 : 1.35);
        // the range rises away from the track and drops at the outer edge
        const env = Math.sin(Math.min(1, tr * 1.25) * Math.PI) ** 0.7;
        if (mesa) h = Math.min(h * 1.3, 0.62 + vnoise(nx * 2, nz * 2, 5) * 0.08); // flat-topped buttes
        let y = (green ? 150 : 330) * h * env - 8;
        if (green) y += vnoise(nx * 3, nz * 3, 3) * 40 * env;
        pos.push(TC.x + Math.cos(a) * rad, y, TC.z + Math.sin(a) * rad);
        // colour by height band and a little noise (strata in the canyon)
        const hn = Math.max(0, y) / (green ? 190 : 380);
        if (mesa) {
          const band = Math.sin(y * 0.11 + vnoise(nx, nz, 7) * 3) * 0.5 + 0.5;
          c.setHex(band > 0.6 ? 0xc8754a : band > 0.3 ? 0xb5603a : 0xd99064);
          if (h > 0.6) c.lerp(new THREE.Color(0xe7a774), 0.4);
        } else if (green) {
          c.setHex(0x3f7f4a).lerp(new THREE.Color(0x7fae6e), hn);
        } else {
          c.setHex(th.mountain[0]!).lerp(new THREE.Color(th.mountainMid), Math.min(1, hn * 1.6));
          if (snowy && hn > 0.48 - vnoise(nx * 4, nz * 4, 9) * 0.12) c.setHex(th.mountainSnow);
        }
        col.push(c.r, c.g, c.b);
      }
    }
    for (let r = 0; r < RINGS; r++)
      for (let s = 0; s < SEG; s++) {
        const A = r * (SEG + 1) + s,
          B = A + 1,
          C = A + SEG + 1,
          D = C + 1;
        idx.push(A, B, C, B, D, C);
      }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: false })),
    );
    m.frustumCulled = false;
    m.receiveShadow = false;
    group.add(m);
  }

  /* ---------------- soft billboard clouds ---------------- */
  {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    for (let k = 0; k < 26; k++) {
      const x = 128 + (rng.next() - 0.5) * 150,
        y = 140 + (rng.next() - 0.5) * 60,
        r = 30 + rng.next() * 46;
      const gr = g.createRadialGradient(x, y - r * 0.2, r * 0.1, x, y, r);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)');
      gr.addColorStop(0.6, 'rgba(250,250,252,0.55)');
      gr.addColorStop(1, 'rgba(240,242,248,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    // a soft grey underside
    const sh = g.createLinearGradient(0, 120, 0, 210);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(1, 'rgba(120,128,150,0.35)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = sh;
    g.fillRect(0, 0, 256, 256);
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    // D71: moonlit clouds at night, grey rain clouds, pale snow clouds
    const k = th.wx?.kind;
    const tint = th.wx?.night
      ? new THREE.Color(0x3b4672)
      : k === 'rain'
        ? new THREE.Color(0x949ca8)
        : k === 'snow'
          ? new THREE.Color(0xcfd6e2)
          : new THREE.Color(th.horizon).lerp(new THREE.Color(0xffffff), 0.55);
    const mat = keep(
      new THREE.SpriteMaterial({ map: tex, color: tint, transparent: true, depthWrite: false, fog: false }),
    );
    const n = k === 'rain' || k === 'snow' ? 34 : th.id === 'canyon' ? 8 : 22;
    const clouds: { s: THREE.Sprite; a: number; r: number; v: number }[] = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(mat);
      const w = rnd(160, 340);
      s.scale.set(w, w * 0.45, 1);
      const a = rnd(0, Math.PI * 2),
        r = rnd(RMAX * 0.3, RMAX + 900);
      s.position.set(TC.x + Math.cos(a) * r, rnd(170, 300), TC.z + Math.sin(a) * r);
      s.renderOrder = -1;
      group.add(s);
      clouds.push({ s, a, r, v: rnd(0.002, 0.006) });
    }
    updates.push((t) => {
      for (const c of clouds) {
        const a = c.a + t * c.v;
        c.s.position.x = TC.x + Math.cos(a) * c.r;
        c.s.position.z = TC.z + Math.sin(a) * c.r;
      }
    });
  }

  /** Ground height for scatter: the flat verge inside the walls, the terrain outside. */
  const groundAt = (i: number, lat: number): { x: number; y: number; z: number } => {
    const x = T.CX[i]! + T.RX[i]! * lat,
      z = T.CZ[i]! + T.RZ[i]! * lat;
    const a = Math.abs(lat);
    const y = a < T.WALLD[i]! + 2 ? T.H[i]! + lat * T.BT[i]! : terrain.terrainH(x, z);
    return { x, y, z };
  };
  const blocked = (x: number, z: number): boolean => terrain.zones.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r);

  /* ---------------- swaying 3D grass ---------------- */
  if (th.id !== 'frosty') {
    const dry = th.id === 'canyon';
    // one tuft: 7 tapered blades fanned around the centre, darker at the root
    const pos: number[] = [],
      col: number[] = [],
      perp: number[] = [],
      idx: number[] = [];
    const base = new THREE.Color(dry ? 0x7d6a3a : 0x2f6a24),
      tip = new THREE.Color(dry ? 0xd9c27a : 0x9fd65a);
    for (let b = 0; b < 5; b++) {
      const a = (b / 5) * Math.PI * 2 + b * 0.37,
        lean = 0.18 + (b % 3) * 0.08,
        h = 0.45 + ((b * 37) % 10) / 22,
        w = 0.045;
      const dx = Math.cos(a),
        dz = Math.sin(a);
      const o = pos.length / 3;
      const root = [dx * 0.05, 0, dz * 0.05];
      pos.push(root[0]! - dz * w, 0, root[2]! + dx * w);
      pos.push(root[0]! + dz * w, 0, root[2]! - dx * w);
      pos.push(dx * lean, h, dz * lean);
      // the root's sideways offset, so the shader can widen far blades (phase 14 shimmer fix)
      perp.push(-dz * w, dx * w, dz * w, -dx * w, 0, 0);
      for (let k = 0; k < 2; k++) col.push(base.r, base.g, base.b);
      col.push(tip.r, tip.g, tip.b);
      idx.push(o, o + 1, o + 2);
    }
    const geo = keep(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setAttribute('aPerp', new THREE.Float32BufferAttribute(perp, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // normals point up, so the tufts light like the ground they stand on
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0);
    const mat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    const wind = { value: 0 };
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWind = wind;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWind;\nattribute vec2 aPerp;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iw = instanceMatrix[3].xyz;
          #else
            vec3 iw = vec3(0.0);
          #endif
          float sway = sin(uWind * 1.7 + iw.x * 0.21 + iw.z * 0.17) * 0.5 + sin(uWind * 2.9 + iw.x * 0.5) * 0.25;
          transformed.xz += vec2(0.9, 0.5) * sway * transformed.y * 0.35;
          // phase 14 shimmer fix: far blades are thinner than a pixel and flicker as the camera moves. Past 22 m
          // the roots widen with distance (about a pixel wide on screen), and from 55 to 90 m the tufts sink into
          // the ground, where the terrain's grass texture carries the colour.
          float gd = distance((modelMatrix * vec4(iw, 1.0)).xyz, cameraPosition);
          transformed.xz += aPerp * (max(1.0, gd / 22.0) - 1.0);
          transformed.y *= 1.0 - smoothstep(55.0, 90.0, gd);`,
        );
    };
    mat.customProgramCacheKey = () => 'tk-grass';
    const count = lite ? 12000 : dry ? 12000 : 40000;
    const im = new THREE.InstancedMesh(geo, mat, count);
    const m4 = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      e = new THREE.Euler(),
      v = new THREE.Vector3(),
      sc = new THREE.Vector3(),
      tint = new THREE.Color();
    let n = 0;
    for (let tries = 0; n < count && tries < count * 4; tries++) {
      const i = Math.floor(rng.next() * T.N);
      const side = rng.next() < 0.5 ? -1 : 1;
      // dense along the verges, thinning out into the fields
      const inner = T.HW[i]! + KERB_W + 0.6;
      const lat = side * (inner + Math.pow(rng.next(), 1.8) * 55);
      if (Math.abs(lat) > T.CLEAR[i]! - 1) continue;
      const p = groundAt(i, lat);
      const near = terrain.nearTrack(p.x, p.z);
      if (near.d < T.HW[near.i]! + KERB_W + 0.4 || blocked(p.x, p.z)) continue;
      if (terrain.pond && Math.hypot(p.x - terrain.pond.x, p.z - terrain.pond.z) < terrain.pond.r + 6) continue;
      const s = rnd(0.8, 1.6);
      m4.compose(
        v.set(p.x, p.y - 0.02, p.z),
        q.setFromEuler(e.set(0, rnd(0, 6.28), 0)),
        sc.set(s, s * rnd(0.8, 1.4), s),
      );
      im.setMatrixAt(n, m4);
      im.setColorAt(n, tint.setHSL(0, 0, rnd(0.82, 1.12)));
      n++;
    }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.frustumCulled = false;
    im.receiveShadow = true;
    group.add(im);
    disposables.push(im);
    updates.push((t) => (wind.value = t));
    grassSet = (f) => (im.count = Math.round(n * f));
  }

  /* ---------------- canyon: colossal eroded sandstone formations ---------------- */
  if (th.id === 'canyon') {
    const parts: THREE.BufferGeometry[] = [];
    const strata = (y: number, seed: number): THREE.Color => {
      const b = Math.sin(y * 0.55 + seed) * 0.5 + 0.5,
        b2 = Math.sin(y * 1.9 + seed * 2) * 0.5 + 0.5;
      return new THREE.Color(b > 0.66 ? 0xc96f3f : b > 0.33 ? 0xb25a33 : 0xdb8a58).lerp(
        new THREE.Color(0xe9b07c),
        b2 * 0.25,
      );
    };
    const formation = (x: number, y0: number, z: number, hgt: number, rad: number, seed: number): void => {
      // stacked, eroded drums: wide base, narrow neck, a wider cap (hoodoo / butte)
      const tiers = 6 + Math.floor(rng.next() * 4);
      let y = y0;
      for (let k = 0; k < tiers; k++) {
        const t = k / (tiers - 1);
        const r = rad * (1 - 0.45 * Math.sin(t * Math.PI * 0.9)) * (k === tiers - 1 ? 1.18 : 1) * rnd(0.9, 1.08);
        const h = hgt / tiers;
        const g = new THREE.CylinderGeometry(r * rnd(0.88, 1), r, h * 1.02, 10, 3);
        const p = g.attributes.position as THREE.BufferAttribute;
        const cl: number[] = [];
        for (let i = 0; i < p.count; i++) {
          const px = p.getX(i),
            py = p.getY(i),
            pz = p.getZ(i);
          const a = Math.atan2(pz, px);
          const er = 1 + (vnoise(a * 2.5 + seed, (y + py) * 0.15, 3) - 0.5) * 0.35;
          p.setXYZ(i, px * er + x, py + y + h / 2, pz * er + z);
          const c = strata(y + py, seed);
          cl.push(c.r, c.g, c.b);
        }
        g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
        parts.push(g.toNonIndexed());
        g.dispose();
        y += h * 0.98;
      }
    };
    let made = 0;
    for (let tries = 0; made < (lite ? 22 : 42) && tries < 900; tries++) {
      const i = Math.floor(rng.next() * T.N),
        side = rng.next() < 0.5 ? -1 : 1;
      const rad = rnd(16, 46);
      const lat = side * (T.WALLD[i]! + rad + rnd(10, 120));
      const x = T.CX[i]! + T.RX[i]! * lat,
        z = T.CZ[i]! + T.RZ[i]! * lat;
      const near = terrain.nearTrack(x, z);
      if (near.d < T.WALLD[near.i]! + rad + 6 || blocked(x, z)) continue;
      formation(x, terrain.terrainH(x, z) - 3, z, rnd(45, 130), rad, rng.next() * 10);
      terrain.zones.push({ x, z, r: rad + 4 });
      made++;
    }
    if (parts.length) {
      const merged = keep(mergeGeos(parts));
      merged.computeVertexNormals();
      const m = new THREE.Mesh(
        merged,
        keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true })),
      );
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      group.add(m);
    }
    for (const g of parts) g.dispose();
  }

  /* ---------------- Frosty: deep snow drifts piled against the barriers ---------------- */
  if (th.id === 'frosty') {
    const geo = keep(new THREE.IcosahedronGeometry(1, 2));
    const im = new THREE.InstancedMesh(
      geo,
      keep(new THREE.MeshStandardMaterial({ color: 0xf6f9ff, roughness: 0.6 })),
      lite ? 900 : 1800,
    );
    const m4 = new THREE.Matrix4(),
      q = new THREE.Quaternion(),
      v = new THREE.Vector3(),
      sc = new THREE.Vector3();
    let n = 0;
    for (let i = 0; i < T.N && n < im.count; i += 2)
      for (const side of [-1, 1]) {
        if (n >= im.count || rng.next() < 0.35) continue;
        const lat = side * (T.WALLD[i]! + 1.4 + rnd(0.3, 3.5));
        if (Math.abs(lat) > T.CLEAR[i]! - 1) continue;
        const p = groundAt(i, lat);
        const s = rnd(1.2, 3.2);
        m4.compose(
          v.set(p.x, p.y - s * 0.55, p.z),
          q.setFromAxisAngle(v.clone().set(0, 1, 0), T.ANG[i]!),
          sc.set(s, s * rnd(0.5, 0.8), s * rnd(1.6, 2.6)),
        );
        im.setMatrixAt(n++, m4);
      }
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
    disposables.push(im);
  }

  /* ---------------- bunting along the start straight ---------------- */
  {
    const cols = [0xff5252, 0xffeb3b, 0x40c4ff, 0x69f0ae, 0xe040fb, 0xffffff];
    const pos: number[] = [],
      cl: number[] = [];
    const c = new THREE.Color();
    for (const side of [-1, 1])
      for (let seg = -5; seg < 5; seg++) {
        const i0 = (seg * 12 + T.N) % T.N,
          i1 = (seg * 12 + 12 + T.N) % T.N;
        const l0 = side * (T.WALLD[i0]! + 2.6),
          l1 = side * (T.WALLD[i1]! + 2.6);
        const a = [T.CX[i0]! + T.RX[i0]! * l0, T.H[i0]! + 7.8, T.CZ[i0]! + T.RZ[i0]! * l0];
        const b = [T.CX[i1]! + T.RX[i1]! * l1, T.H[i1]! + 7.8, T.CZ[i1]! + T.RZ[i1]! * l1];
        const flags = 14;
        for (let k = 0; k < flags; k++) {
          const t0 = (k + 0.1) / flags,
            t1 = (k + 0.9) / flags,
            tm = (k + 0.5) / flags;
          const sag = (t: number): number => Math.sin(t * Math.PI) * 1.4;
          const P = (t: number, dy: number): number[] => [
            a[0]! + (b[0]! - a[0]!) * t,
            a[1]! + (b[1]! - a[1]!) * t - sag(t) + dy,
            a[2]! + (b[2]! - a[2]!) * t,
          ];
          pos.push(...P(t0, 0), ...P(t1, 0), ...P(tm, -0.9));
          c.setHex(cols[(k + seg + 6) % cols.length]!);
          for (let v = 0; v < 3; v++) cl.push(c.r, c.g, c.b);
        }
      }
    const g = keep(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(
      g,
      keep(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 })),
    );
    m.castShadow = true;
    m.frustumCulled = false;
    group.add(m);
  }

  return {
    group,
    update(t) {
      for (const u of updates) u(t);
    },
    setDetail(f) {
      grassSet(f);
    },
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}

/** Merge non-indexed geometries that all have position and color. */
function mergeGeos(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let total = 0;
  for (const g of gs) total += g.attributes.position!.count;
  const pos = new Float32Array(total * 3),
    col = new Float32Array(total * 3);
  let o = 0;
  for (const g of gs) {
    pos.set(g.attributes.position!.array as Float32Array, o * 3);
    col.set(g.attributes.color!.array as Float32Array, o * 3);
    o += g.attributes.position!.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
