/**
 * Turns a Track into meshes: road, kerbs, walls, terrain, pond, landmarks, signs, boost pads and item boxes.
 * Ported from the prototype. Phase 8 feeds it TrackDef data; phase 9 replaces the surfaces with texture sets.
 */
import * as THREE from 'three';
import { ROAD_HALF, KERB_W, WALL, TWO_PI, clamp, smooth01, Rng, type Track, type GameState } from '@tk/shared';
import { P_, inFrame, merge, jitter, canvasTex, noiseDots, box, cyl, ico, cone, octa, hash3, type Part } from './geo';
import { MEADOWS } from './palette';
import type { Materials } from './materials';

export interface Zone { x: number; z: number; r: number }

/** Terrain queries shared with scenery placement. */
export interface TerrainInfo {
  /** Track centre (mean of samples). */
  TC: { x: number; z: number };
  bounds: { x0: number; x1: number; z0: number; z1: number };
  nearTrack(x: number, z: number): { i: number; d: number; base: number };
  terrainH(x: number, z: number, n?: { i: number; d: number; base: number }): number;
  pond: { x: number; z: number; r: number; y: number } | null;
  zones: Zone[];
}

export interface Podium { x: number; y: number; z: number; ry: number; spots: [number, number, number][] }

export interface TrackWorld {
  group: THREE.Group;
  terrain: TerrainInfo;
  podium: Podium;
  /** Animate ambient things (clouds, balloons, windmill, crowd, water, pad arrows). */
  update(time: number, dt: number): void;
  /** Place the item boxes (spin, bob, hide while cooling down). */
  updateBoxes(s: Readonly<GameState>, hidden: boolean): void;
  /** Forget pads and boxes so the next race (which may differ in items on/off) recreates them. */
  resetBoxes(): void;
  dispose(): void;
}

export function buildTrackWorld(T: Track, M: Materials, seed: number): TrackWorld {
  const { N, DS, CX, CZ, RX, RZ, TX, TZ, ANG, H, SL, CURV } = T;
  const rng = new Rng(seed);
  const rnd = (a: number, b: number): number => rng.range(a, b);
  const rand = (): number => rng.next();
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const add = <O extends THREE.Object3D>(o: O): O => {
    group.add(o);
    return o;
  };
  const track = <D extends { dispose(): void }>(d: D): D => {
    disposables.push(d);
    return d;
  };

  /* ---------------- track surfaces ---------------- */
  const roadTex = track(canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = MEADOWS.road; g.fillRect(0, 0, w, h); noiseDots(g, w, h, 1600, 0.05, rand);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(w * 0.22, 0, w * 0.12, h); g.fillRect(w * 0.66, 0, w * 0.12, h);
    g.fillStyle = '#f5f5f5'; g.fillRect(w * 0.035, 0, w * 0.03, h); g.fillRect(w * 0.935, 0, w * 0.03, h);
    g.fillStyle = 'rgba(255,255,255,.75)'; g.fillRect(w * 0.49, 0, w * 0.02, h * 0.3);
  }));
  const kerbTex = track(canvasTex(16, 64, (g, w, h) => { g.fillStyle = MEADOWS.kerbRed; g.fillRect(0, 0, w, h / 2); g.fillStyle = MEADOWS.kerbWhite; g.fillRect(0, h / 2, w, h / 2); }));
  const wallTex = track(canvasTex(64, 64, (g, w, h) => {
    g.fillStyle = '#fafafa'; g.fillRect(0, 0, w, h); g.fillStyle = '#ef3b3b'; g.fillRect(0, 0, w / 2, h);
    g.fillStyle = '#2b2d42'; g.fillRect(0, h * 0.86, w, h * 0.14); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0, 0, w, h * 0.12);
  }));
  const grassTex = track(canvasTex(64, 128, (g, w, h) => {
    g.fillStyle = MEADOWS.grassA; g.fillRect(0, 0, w, h); g.fillStyle = MEADOWS.grassB; g.fillRect(0, 0, w, h / 2); noiseDots(g, w, h, 160, 0.05, rand);
  }));
  function strip(latA: number, yA: number, latB: number, yB: number, vDiv: number, mat: THREE.Material, rs = true): THREE.Mesh {
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    for (let i = 0; i <= N; i++) {
      const j = i % N, v = (i * DS) / vDiv;
      pos.push(CX[j]! + RX[j]! * latA, H[j]! + yA, CZ[j]! + RZ[j]! * latA, CX[j]! + RX[j]! * latB, H[j]! + yB, CZ[j]! + RZ[j]! * latB);
      uv.push(0, v, 1, v);
    }
    for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.receiveShadow = rs;
    return add(m);
  }
  const lambert = (o: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial => track(new THREE.MeshLambertMaterial(o));
  const roadMat = lambert({ map: roadTex, side: THREE.DoubleSide });
  const kerbMat = lambert({ map: kerbTex, side: THREE.DoubleSide });
  const wallMat = lambert({ map: wallTex, side: THREE.DoubleSide });
  const grassMat = lambert({ map: grassTex, side: THREE.DoubleSide });
  const capMat = lambert({ color: 0xffffff, side: THREE.DoubleSide });
  const WV = WALL + 1.4;
  strip(-ROAD_HALF, 0.05, ROAD_HALF, 0.05, 26, roadMat);
  strip(ROAD_HALF, 0.08, ROAD_HALF + KERB_W, 0.08, 6, kerbMat);
  strip(-ROAD_HALF - KERB_W, 0.08, -ROAD_HALF, 0.08, 6, kerbMat);
  for (const s of [1, -1]) {
    strip(s * (ROAD_HALF + KERB_W), 0.0, s * (WALL + 3), 0.0, 14, grassMat);
    strip(s * (WALL + 3), 0.0, s * (WALL + 8), -0.7, 14, grassMat);
    strip(s * WV, 0.0, s * WV, 1.35, 7, wallMat);
    strip(s * WV, 1.35, s * (WV + 0.6), 1.35, 7, capMat, false);
  }

  /* ---------------- terrain ---------------- */
  const TC = { x: 0, z: 0 };
  for (let i = 0; i < N; i++) { TC.x += CX[i]! / N; TC.z += CZ[i]! / N; }
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (let i = 0; i < N; i++) { bx0 = Math.min(bx0, CX[i]!); bx1 = Math.max(bx1, CX[i]!); bz0 = Math.min(bz0, CZ[i]!); bz1 = Math.max(bz1, CZ[i]!); }
  function nearTrack(x: number, z: number): { i: number; d: number; base: number } {
    let bi = 0, bd = 1e18, ws = 0, hs = 0;
    for (let i = 0; i < N; i++) {
      const dx = x - CX[i]!, dz = z - CZ[i]!, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; bi = i; }
      const w = 1 / (d2 * d2 + 1); ws += w; hs += w * H[i]!;
    }
    return { i: bi, d: Math.sqrt(bd), base: hs / ws };
  }
  function clearOther(x: number, z: number, i0: number): number {
    let bd = 1e18;
    for (let i = 0; i < N; i++) {
      const di = Math.min(Math.abs(i - i0), N - Math.abs(i - i0)); if (di < 40) continue;
      const dx = x - CX[i]!, dz = z - CZ[i]!; bd = Math.min(bd, dx * dx + dz * dz);
    }
    return Math.sqrt(bd);
  }
  const hills = (x: number, z: number): number =>
    (Math.sin(x * 0.011 + 1.3) * Math.cos(z * 0.009 + 0.4) + 0.55 * Math.sin(x * 0.024 - z * 0.019 + 2.1) + 0.25 * Math.sin(x * 0.057 + z * 0.043 + 0.7)) * 10 + 7;
  function terrainRaw(x: number, z: number, n: { d: number; base: number }): number {
    const t = smooth01((n.d - (WALL + 6)) / 95), r = Math.hypot(x - TC.x, z - TC.z), far = smooth01((r - 560) / 480) * 80;
    return (n.base - 0.45) * (1 - t) + (hills(x, z) + far + n.base * 0.4) * t;
  }
  let pond: TerrainInfo['pond'] = null;
  function terrainH(x: number, z: number, n?: { i: number; d: number; base: number }): number {
    n = n || nearTrack(x, z);
    let h = terrainRaw(x, z, n);
    if (pond) {
      const dp = Math.hypot(x - pond.x, z - pond.z);
      if (dp < pond.r + 24) { const f = smooth01((dp - pond.r * 0.85) / (24 + pond.r * 0.15)); h = (pond.y - 2.2) * (1 - f) + h * f; }
    }
    return h;
  }
  // clear spots for landmarks
  const spots: { x: number; z: number; d: number }[] = [];
  for (let x = bx0; x <= bx1; x += 12) for (let z = bz0; z <= bz1; z += 12) spots.push({ x, z, d: nearTrack(x, z).d });
  spots.sort((a, b) => b.d - a.d);
  function pickSpot(minD: number, away: { x: number; z: number }[], minSep: number): { x: number; z: number; d: number } | null {
    for (const s of spots) { if (s.d < minD) break; if (away.every((o) => Math.hypot(s.x - o.x, s.z - o.z) > minSep)) return s; }
    return null;
  }
  const zones: Zone[] = [];
  const sp0 = pickSpot(85, [], 0);
  if (sp0) {
    const p = { x: sp0.x, z: sp0.z, r: clamp(sp0.d - 62, 16, 42), y: 0 };
    let mn = 1e9;
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * TWO_PI, px = p.x + Math.cos(ang) * (p.r + 20), pz = p.z + Math.sin(ang) * (p.r + 20);
      mn = Math.min(mn, terrainRaw(px, pz, nearTrack(px, pz)));
    }
    p.y = mn - 0.6;
    pond = p;
    zones.push({ x: p.x, z: p.z, r: p.r + 18 });
  }
  const used = pond ? [pond] : [];
  let podSpot: { x: number; z: number } | null = pickSpot(56, used, pond ? pond.r + 46 : 0);
  if (!podSpot) { const i = N - 30; podSpot = { x: CX[i]! + RX[i]! * (WALL + 40), z: CZ[i]! + RZ[i]! * (WALL + 40) }; }
  zones.push({ x: podSpot.x, z: podSpot.z, r: 24 });
  const millSpot = pickSpot(55, [...used, podSpot], 70);
  if (millSpot) zones.push({ x: millSpot.x, z: millSpot.z, r: 14 });

  {
    const TS = 2600, TN = 160, cell = TS / TN, ox = TC.x - TS / 2, oz = TC.z - TS / 2, V = TN + 1;
    const hh = new Float32Array(V * V);
    for (let r = 0; r < V; r++) for (let c = 0; c < V; c++) hh[r * V + c] = terrainH(ox + c * cell, oz + r * cell);
    const pos = new Float32Array(TN * TN * 18), col = new Float32Array(TN * TN * 18);
    const greens = MEADOWS.grassTerrain, _c = new THREE.Color();
    let o = 0;
    const put = (x: number, y: number, z: number): void => { pos[o++] = x; pos[o++] = y; pos[o++] = z; };
    const colTri = (ci: number, x: number, z: number, h: number, k: number): void => {
      let hex: number;
      const dp = pond ? Math.hypot(x - pond.x, z - pond.z) : 1e9;
      if (pond && dp < pond.r + 22 && h < pond.y + 1.4) hex = h < pond.y - 0.4 ? MEADOWS.sandWet : MEADOWS.sandDry;
      else if (h > 64) hex = MEADOWS.snow;
      else if (h > 44) hex = MEADOWS.rock[k % 3]!;
      else {
        const v = 0.5 + 0.5 * Math.sin(x * 0.02 + z * 0.013) * Math.cos(z * 0.017 - x * 0.007);
        hex = greens[clamp(Math.floor(v * 3.6 + hash3(Math.round(x), Math.round(z), 3, 9) * 1.6), 0, 4)]!;
      }
      _c.setHex(hex);
      for (let w = 0; w < 3; w++) { col[ci++] = _c.r; col[ci++] = _c.g; col[ci++] = _c.b; }
    };
    let k = 0;
    for (let r = 0; r < TN; r++) for (let c = 0; c < TN; c++) {
      const x0 = ox + c * cell, x1 = x0 + cell, z0 = oz + r * cell, z1 = z0 + cell;
      const ha = hh[r * V + c]!, hb = hh[r * V + c + 1]!, hc = hh[(r + 1) * V + c]!, hd = hh[(r + 1) * V + c + 1]!;
      let ci = o; put(x0, ha, z0); put(x0, hc, z1); put(x1, hb, z0); colTri(ci, x0 + cell * 0.33, z0 + cell * 0.33, (ha + hb + hc) / 3, k++);
      ci = o; put(x1, hb, z0); put(x0, hc, z1); put(x1, hd, z1); colTri(ci, x0 + cell * 0.66, z0 + cell * 0.66, (hb + hc + hd) / 3, k++);
    }
    const g = track(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, M.land); m.receiveShadow = true; m.frustumCulled = false; add(m);
  }
  let water: THREE.Mesh | null = null, lilies: THREE.Mesh | null = null;
  if (pond) {
    const wg = track(jitter(new THREE.CircleGeometry(pond.r + 20, 18).rotateX(-Math.PI / 2), 1.2, 4));
    wg.computeVertexNormals();
    water = add(new THREE.Mesh(wg, lambert({ color: MEADOWS.water, transparent: true, opacity: 0.88 })));
    water.position.set(pond.x, pond.y, pond.z);
    const lily: Part[] = [];
    for (let i = 0; i < 9; i++) {
      const a = rand() * TWO_PI, r = rand() * pond.r * 0.8;
      lily.push(P_(cyl(1.1, 1.1, 0.12, 7), i % 3 ? 0x66bb6a : 0x81c784, Math.cos(a) * r, 0.08, Math.sin(a) * r));
      if (i % 3 === 0) lily.push(P_(octa(0.35), 0xf48fb1, Math.cos(a) * r, 0.35, Math.sin(a) * r));
    }
    lilies = add(new THREE.Mesh(track(merge(lily)), M.prop));
    lilies.position.copy(water.position);
  }

  /* ---------------- static props (merged) ---------------- */
  const staticParts: Part[] = [];
  const addStatic = (parts: Part[]): void => { for (const p of parts) staticParts.push(p); };

  // start / finish gantry with bunting
  {
    const parts: Part[] = [], hw = ROAD_HALF + 3.5;
    for (const s of [-1, 1]) { parts.push(P_(cyl(0.6, 0.75, 11, 6), 0xeceff1, s * hw, 5.5, 0)); parts.push(P_(box(1.8, 0.6, 1.8), 0x5c6bc0, s * hw, 0.3, 0)); }
    const cols = [0xff5252, 0xffeb3b, 0x40c4ff, 0x69f0ae, 0xe040fb];
    for (let i = 0; i < 15; i++) {
      const x = -hw + ((i + 0.5) / 15) * hw * 2, sag = Math.sin(((i + 0.5) / 15) * Math.PI) * 0.9;
      parts.push(P_(cone(0.42, 0.95, 3), cols[i % 5]!, x, 7.6 - sag, 0, Math.PI, 0, 0, 1, 1, 0.25));
    }
    addStatic(inFrame(parts, CX[0]!, H[0]!, CZ[0]!, ANG[0]!));
    const checker = track(canvasTex(64, 16, (g) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#1d1b2e' : '#fff'; g.fillRect(x * 4, y * 4, 4, 4); } }));
    const line = add(new THREE.Mesh(track(new THREE.PlaneGeometry(ROAD_HALF * 2, 3.2).rotateX(-Math.PI / 2)), lambert({ map: checker, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })));
    line.position.set(CX[0]!, H[0]! + 0.09, CZ[0]!); line.rotation.order = 'YXZ'; line.rotation.y = ANG[0]!; line.rotation.x = -Math.atan(SL[0]!); line.receiveShadow = true;
    const bTex = track(canvasTex(512, 64, (g, w, h) => {
      g.fillStyle = '#3949ab'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff'; for (let x = 0; x < 32; x++) { g.fillRect(x * 16, (x % 2) * 7, 8, 7); g.fillRect(x * 16, h - 7 - (x % 2) * 7, 8, 7); }
      g.font = 'bold 38px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#1d1b2e';
      g.strokeText('TURBO  KARTS', w / 2, h / 2 + 2); g.fillStyle = '#ffeb3b'; g.fillText('TURBO  KARTS', w / 2, h / 2 + 2);
    }, true));
    const banner = add(new THREE.Mesh(track(box(hw * 2 + 1.2, 3.2, 0.8)), lambert({ map: bTex })));
    banner.position.set(CX[0]!, H[0]! + 10.2, CZ[0]!); banner.rotation.y = ANG[0]!; banner.castShadow = true;
  }

  // grandstand with a bouncing crowd beside the start straight
  const crowd: THREE.InstancedMesh[] = [];
  {
    const i = 14, outer = WALL + 9;
    const cp = clearOther(CX[i]! + RX[i]! * outer, CZ[i]! + RZ[i]! * outer, i), cm = clearOther(CX[i]! - RX[i]! * outer, CZ[i]! - RZ[i]! * outer, i);
    const sG = cp >= cm ? 1 : -1;
    if (Math.max(cp, cm) >= 45) {
      const gx = CX[i]! + RX[i]! * sG * outer, gz = CZ[i]! + RZ[i]! * sG * outer, gy = H[i]! - 0.3, ry = sG > 0 ? ANG[i]! + Math.PI : ANG[i]!;
      zones.push({ x: gx + RX[i]! * sG * 6, z: gz + RZ[i]! * sG * 6, r: 36 });
      const parts: Part[] = [P_(box(13, 1.2, 54), 0x9fa8da, 6, -0.2, 0)];
      for (let s = 0; s < 5; s++) { const hgt = 1 + s * 1.1; parts.push(P_(box(2.2, hgt, 50), s % 2 ? 0x5c6bc0 : 0x7986cb, 1.1 + s * 2.2, hgt / 2, 0)); }
      parts.push(P_(box(0.6, 9, 54), 0xeceff1, 11.4, 4.5, 0));
      parts.push(P_(box(14, 0.5, 56), 0xff5252, 6, 10.2, 0, 0, 0, -0.1));
      for (const z of [-26, -9, 9, 26]) parts.push(P_(box(0.5, 9.5, 0.5), 0xeceff1, 0.2, 4.9, z));
      addStatic(inFrame(parts, gx, gy, gz, ry));
      const person = track(merge([P_(cyl(0.34, 0.46, 1.0, 5), 0xffffff, 0, 0.5, 0), P_(ico(0.3, 0), 0xffe0bd, 0, 1.28, 0)]));
      const F = new THREE.Matrix4().compose(new THREE.Vector3(gx, gy, gz), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
      const tints = [0xff8a80, 0xffd180, 0x80d8ff, 0xb9f6ca, 0xea80fc, 0xfff59d, 0xffffff];
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(), c = new THREE.Color();
      for (let half = 0; half < 2; half++) {
        const list: [number, number, number][] = [];
        for (let s = 0; s < 5; s++) for (let z = -23; z <= 23; z += 1.5) if (rand() < 0.75 && ((Math.round(z / 1.5) + s) & 1) === half) list.push([1.1 + s * 2.2 + rnd(-0.3, 0.3), 1 + s * 1.1, z]);
        const im = add(new THREE.InstancedMesh(person, M.inst, list.length));
        list.forEach((p, n) => {
          m4.compose(v.set(p[0], p[1], p[2]), q.setFromEuler(e.set(0, -Math.PI / 2 + rnd(-0.3, 0.3), 0)), sc.setScalar(rnd(0.9, 1.1)));
          m4.premultiply(F); im.setMatrixAt(n, m4); im.setColorAt(n, c.setHex(tints[n % tints.length]!));
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = true; im.receiveShadow = true; crowd.push(im);
      }
    }
  }

  // podium for the results ceremony
  const podium: Podium = { x: podSpot.x, z: podSpot.z, y: 0, ry: 0, spots: [] };
  {
    podium.y = terrainH(podium.x, podium.z);
    podium.ry = Math.atan2(TC.x - podium.x, TC.z - podium.z);
    const parts: Part[] = [P_(box(17, 4, 9), 0x5c6bc0, 0, -1.3, 0), P_(box(17.6, 0.4, 9.6), 0xffffff, 0, 0.75, 0)];
    const blocks: [number, number, number][] = [[0, 2.6, 0xffca28], [-5, 1.8, 0xcfd8dc], [5, 1.2, 0xd08b4b]];
    for (const [x, hgt, c] of blocks) { parts.push(P_(box(4.6, hgt, 4.6), c, x, 0.95 + hgt / 2, 0)); podium.spots.push([x, 0.95 + hgt, 0]); }
    for (const s of [-1, 1]) {
      parts.push(P_(cyl(0.35, 0.35, 11, 6), 0xeceff1, s * 8.2, 5.5, -3.8));
      parts.push(P_(cone(0.9, 2.2, 3), s > 0 ? 0xff5252 : 0x40c4ff, s * 8.2 - s * 0.9, 10, -3.8, 0, 0, (s * Math.PI) / 2, 1, 1, 0.2));
    }
    parts.push(P_(box(17, 1.2, 0.5), 0xffeb3b, 0, 9.4, -3.8));
    addStatic(inFrame(parts, podium.x, podium.y, podium.z, podium.ry));
  }

  // windmill
  let mill: THREE.Mesh | null = null;
  if (millSpot) {
    const x = millSpot.x, z = millSpot.z, y = terrainH(x, z) - 0.3, ry = Math.atan2(TC.x - x, TC.z - z);
    addStatic(inFrame([
      P_(cyl(2.2, 3.6, 15, 6), 0xfff8e1, 0, 7.5, 0), P_(cyl(3.75, 3.75, 0.8, 6), 0x8d6e63, 0, 0.4, 0), P_(cone(3.3, 4.2, 6), 0xe53935, 0, 17.1, 0),
      P_(box(1.5, 2.6, 0.5), 0x6d4c41, 0, 1.3, 3.3), P_(box(1.1, 1.1, 0.4), 0x80d8ff, 0, 9.5, 2.75, -0.08),
    ], x, y, z, ry));
    const bl: Part[] = [P_(cyl(0.6, 0.6, 1.4, 6), 0x8d6e63, 0, 0, 0, Math.PI / 2)];
    for (let b = 0; b < 4; b++) {
      const a = (b * Math.PI) / 2;
      bl.push(P_(box(1.9, 8.4, 0.22), 0xfff3e0, Math.sin(a) * 4.6, Math.cos(a) * 4.6, 0, 0, 0, -a));
      bl.push(P_(box(0.25, 8.6, 0.32), 0x8d6e63, Math.sin(a) * 4.6, Math.cos(a) * 4.6, 0.05, 0, 0, -a));
    }
    mill = add(new THREE.Mesh(track(merge(bl)), M.prop));
    mill.position.set(x + Math.sin(ry) * 3.3, y + 14.2, z + Math.cos(ry) * 3.3); mill.rotation.y = ry; mill.castShadow = true;
  }

  // corner signs and tyre stacks
  {
    const signsL: [number, number][] = [], signsR: [number, number][] = [], tyreSpots: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const c = CURV[i]!, a = Math.abs(c);
      if (a > 0.5 && i % 4 === 0) tyreSpots.push([i, c > 0 ? 1 : -1]);
      if (a > 0.7) {
        let peak = true;
        for (let o = -18; o <= 18; o++) if (Math.abs(CURV[(i + o + N) % N]!) > a) { peak = false; break; }
        if (peak) { const si = (i - 9 + N) % N; (c > 0 ? signsL : signsR).push([si, c > 0 ? 1 : -1]); }
      }
    }
    const mkTex = (left: boolean): THREE.CanvasTexture => track(canvasTex(128, 64, (g, w, h) => {
      g.fillStyle = '#ffeb3b'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d1b2e'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
      for (let k = 0; k < 3; k++) {
        const x0 = 22 + k * 32; g.beginPath();
        if (left) { g.moveTo(x0 + 18, 12); g.lineTo(x0, h / 2); g.lineTo(x0 + 18, h - 12); g.lineTo(x0 + 28, h - 12); g.lineTo(x0 + 10, h / 2); g.lineTo(x0 + 28, 12); }
        else { g.moveTo(x0 + 10, 12); g.lineTo(x0 + 28, h / 2); g.lineTo(x0 + 10, h - 12); g.lineTo(x0, h - 12); g.lineTo(x0 + 18, h / 2); g.lineTo(x0, 12); }
        g.closePath(); g.fill();
      }
    }, true));
    const plate = track(new THREE.PlaneGeometry(4.4, 2.0));
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
    for (const [list, left] of [[signsL, true], [signsR, false]] as const) {
      if (!list.length) continue;
      const im = add(new THREE.InstancedMesh(plate, lambert({ map: mkTex(left) }), list.length));
      list.forEach(([i, s], n) => {
        const lat = s * (WV + 2.2), x = CX[i]! + RX[i]! * lat, z = CZ[i]! + RZ[i]! * lat;
        m4.compose(v.set(x, H[i]! + 2.6, z), q.setFromEuler(e.set(0, ANG[i]! + Math.PI, 0)), one); im.setMatrixAt(n, m4);
        addStatic(inFrame([P_(box(4.6, 2.2, 0.2), 0x2b2d42, 0, 2.6, -0.14), P_(box(0.25, 2.4, 0.25), 0x90a4ae, -1.5, 1.2, -0.2), P_(box(0.25, 2.4, 0.25), 0x90a4ae, 1.5, 1.2, -0.2)], x, H[i]!, z, ANG[i]! + Math.PI));
        zones.push({ x, z, r: 6 });
      });
      im.instanceMatrix.needsUpdate = true;
    }
    const tyre = track(merge([P_(cyl(0.62, 0.62, 0.44, 8), 0xeeeeee, 0, 0.22, 0), P_(cyl(0.62, 0.62, 0.44, 8), 0x444444, 0, 0.66, 0), P_(cyl(0.62, 0.62, 0.44, 8), 0xeeeeee, 0, 1.1, 0)]));
    const im = add(new THREE.InstancedMesh(tyre, M.inst, tyreSpots.length * 2)), tcol = [0xff5252, 0xffffff, 0x40c4ff];
    let n = 0;
    for (const [i, s] of tyreSpots) for (const off of [0, 1.3]) {
      const lat = s * (WV + 1.2), fwd = off ? 1.3 : 0, x = CX[i]! + RX[i]! * lat + TX[i]! * fwd, z = CZ[i]! + RZ[i]! * lat + TZ[i]! * fwd;
      m4.compose(v.set(x, H[i]! - 0.05, z), q.setFromEuler(e.set(0, rand() * 3, 0)), one); im.setMatrixAt(n, m4); im.setColorAt(n, c.setHex(tcol[n % 3]!)); n++;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; im.castShadow = true; im.receiveShadow = true;
  }

  /* ---------------- mountains, clouds, balloons ---------------- */
  {
    const parts: Part[] = [];
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * TWO_PI + rnd(-0.08, 0.08), r = rnd(980, 1180), hgt = rnd(170, 360), rad = rnd(130, 240), peak = hgt;
      parts.push(P_(jitter(new THREE.ConeGeometry(rad, hgt, 7, 3), rad * 0.18, i + 20), (x, y) => {
        const t = (y - 30) / peak; // colour fn sees world y; the base sits at y = 30
        return t > 0.62 ? MEADOWS.mountainSnow : t > 0.42 ? MEADOWS.mountainMid : MEADOWS.mountain[Math.abs(Math.round(x)) % 3]!;
      }, TC.x + Math.cos(a) * r, hgt / 2 + 30, TC.z + Math.sin(a) * r, 0, rand() * 6, 0));
    }
    const m = add(new THREE.Mesh(track(merge(parts)), M.land)); m.frustumCulled = false;
  }
  const cloudGeo = track(merge([
    P_(ico(1, 0), 0xffffff, 0, 0, 0, 0, 0, 0, 1.6, 1, 1.2), P_(ico(1, 0), 0xffffff, 1.4, 0.3, 0.2, 0.3, 0.5, 0, 1.1),
    P_(ico(1, 0), 0xffffff, -1.3, 0.1, -0.1, 0, 1, 0, 1.0), P_(ico(1, 0), 0xffffff, 0.3, 0.7, 0.4, 0.5, 0, 0, 0.9),
  ]));
  const clouds = add(new THREE.InstancedMesh(cloudGeo, lambert({ vertexColors: true, emissive: 0x55606e }), 18));
  const cloudData: { x: number; z: number; y: number; s: number; r: number; v: number }[] = [];
  for (let i = 0; i < 18; i++) cloudData.push({ x: TC.x + rnd(-900, 900), z: TC.z + rnd(-900, 900), y: rnd(140, 240), s: rnd(7, 14), r: rand() * 6, v: rnd(2, 5) });
  clouds.frustumCulled = false;
  const balloons: { m: THREE.Mesh; a: number; r: number; y: number; sp: number; ph: number }[] = [];
  {
    const pal = [[0xff5252, 0xffeb3b], [0x40c4ff, 0xffffff], [0x69f0ae, 0xe040fb], [0xffab40, 0x7c4dff]] as const;
    for (let b = 0; b < 4; b++) {
      const [c1, c2] = pal[b]!;
      const g = track(merge([
        P_(ico(6, 1), (x, y, z) => (y > 6.2 ? c2 : Math.floor((Math.atan2(x, z) + Math.PI) / (TWO_PI / 8)) % 2 ? c1 : c2), 0, 0, 0, 0, 0, 0, 1, 1.18, 1),
        P_(cone(2.2, 3.5, 8), c1, 0, -6.6, 0, Math.PI), P_(box(2.3, 1.8, 2.3), 0x8d6e63, 0, -10, 0),
        P_(box(0.1, 2.6, 0.1), 0x5d4037, 1, -8.4, 1), P_(box(0.1, 2.6, 0.1), 0x5d4037, -1, -8.4, 1), P_(box(0.1, 2.6, 0.1), 0x5d4037, 1, -8.4, -1), P_(box(0.1, 2.6, 0.1), 0x5d4037, -1, -8.4, -1),
      ]));
      const m = add(new THREE.Mesh(g, M.prop));
      balloons.push({ m, a: rnd(0, TWO_PI), r: rnd(120, 420), y: rnd(70, 115), sp: rnd(0.008, 0.02) * (b % 2 ? 1 : -1), ph: rand() * 6 });
    }
  }

  /* ---------------- merged static props ---------------- */
  {
    const m = add(new THREE.Mesh(track(merge(staticParts)), M.prop)); m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
  }

  /* ---------------- boost pads & item boxes ---------------- */
  const padTex = track(canvasTex(64, 128, (g, w) => {
    g.fillStyle = MEADOWS.boostPad; g.fillRect(0, 0, w, 128); g.fillStyle = MEADOWS.boostPadDark;
    for (let i = 0; i < 4; i++) { const y = 6 + i * 32; g.beginPath(); g.moveTo(8, y + 22); g.lineTo(w / 2, y); g.lineTo(w - 8, y + 22); g.lineTo(w - 8, y + 30); g.lineTo(w / 2, y + 10); g.lineTo(8, y + 30); g.closePath(); g.fill(); }
  }));
  const padMat = track(new THREE.MeshBasicMaterial({ map: padTex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const padGeo = track(new THREE.PlaneGeometry(9, 12).rotateX(-Math.PI / 2));
  const qTex = track(canvasTex(64, 64, (g, w, h) => {
    const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#ff5252'); gr.addColorStop(0.33, '#ffd740'); gr.addColorStop(0.66, '#40c4ff'); gr.addColorStop(1, '#e040fb');
    g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(3, 3, w - 6, h - 6);
    g.font = 'bold 48px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6; g.strokeStyle = '#1d1b2e';
    g.strokeText('?', w / 2, h / 2 + 3); g.fillStyle = '#fff'; g.fillText('?', w / 2, h / 2 + 3);
  }, true));
  const boxGeo = track(box(2.3, 2.3, 2.3));
  const boxMat = track(new THREE.MeshBasicMaterial({ map: qTex, transparent: true, opacity: 0.93 }));
  let boxMesh: THREE.InstancedMesh | null = null;
  let padsBuilt = false;
  const padGroups: THREE.Object3D[] = [];
  const _o = new THREE.Object3D();

  const terrain: TerrainInfo = { TC, bounds: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 }, nearTrack, terrainH, pond, zones };

  return {
    group,
    terrain,
    podium,
    update(time: number, dt: number) {
      for (let i = 0; i < cloudData.length; i++) {
        const c = cloudData[i]!; c.x += c.v * dt; if (c.x > TC.x + 1000) c.x = TC.x - 1000;
        _o.position.set(c.x, c.y, c.z); _o.rotation.set(0, c.r, 0); _o.scale.set(c.s, c.s * 0.7, c.s); _o.updateMatrix(); clouds.setMatrixAt(i, _o.matrix);
      }
      clouds.instanceMatrix.needsUpdate = true;
      for (const b of balloons) { b.a += b.sp * dt; b.m.position.set(TC.x + Math.cos(b.a) * b.r, b.y + Math.sin(time * 0.5 + b.ph) * 3, TC.z + Math.sin(b.a) * b.r); b.m.rotation.y = time * 0.1 + b.ph; }
      if (mill) mill.rotation.z += dt * 0.9;
      crowd.forEach((m, i) => { m.position.y = Math.max(0, Math.sin(time * 9 + i * Math.PI)) * 0.35; });
      if (water && lilies && pond) { water.position.y = pond.y + Math.sin(time * 0.8) * 0.06; lilies.position.y = water.position.y; }
      padTex.offset.y = (padTex.offset.y - dt * 1.2) % 1;
    },
    updateBoxes(s: Readonly<GameState>, hidden: boolean) {
      if (!padsBuilt) {
        padsBuilt = true;
        for (const p of s.pads) {
          const grp = add(new THREE.Object3D()); padGroups.push(grp); grp.position.set(p.x, p.y + 0.11, p.z); grp.rotation.order = 'YXZ'; grp.rotation.y = ANG[p.idx]!; grp.rotation.x = -Math.atan(SL[p.idx]!);
          const m = new THREE.Mesh(padGeo, padMat); m.rotation.y = Math.PI; m.receiveShadow = true; grp.add(m);
        }
      }
      if (!boxMesh || boxMesh.count !== s.boxes.length) {
        if (boxMesh) { group.remove(boxMesh); boxMesh.dispose(); }
        boxMesh = add(new THREE.InstancedMesh(boxGeo, boxMat, Math.max(1, s.boxes.length)));
        boxMesh.count = s.boxes.length;
        boxMesh.frustumCulled = false;
      }
      const t = s.time;
      s.boxes.forEach((b, i) => {
        const vis = b.cool <= 0 && !hidden, sc = vis ? 1 + Math.sin(t * 4 + i) * 0.05 : 0.0001;
        _o.position.set(b.x, b.y + 2.0 + Math.sin(t * 3 + i) * 0.25, b.z); _o.rotation.set(t * 0.9, t * 1.8 + i, 0); _o.scale.setScalar(sc); _o.updateMatrix();
        boxMesh!.setMatrixAt(i, _o.matrix);
      });
      boxMesh.instanceMatrix.needsUpdate = true;
    },
    resetBoxes() {
      padsBuilt = false;
      for (const g of padGroups) group.remove(g);
      padGroups.length = 0;
      if (boxMesh) { group.remove(boxMesh); boxMesh.dispose(); boxMesh = null; }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      if (boxMesh) boxMesh.dispose();
      for (const im of crowd) im.dispose();
      clouds.dispose();
    },
  };
}
