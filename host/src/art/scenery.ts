/**
 * Instanced scenery scattered beside the track (prototype), per theme (phase 8): trees, bushes, rocks and flowers
 * in Sunny Meadows; cacti, rock spires and dry scrub in Dusty Canyon; snowy pines and snow drifts in Frosty Peaks.
 */
import * as THREE from 'three';
import { Rng, type Track } from '@tk/shared';
import { P_, merge, jitter, ico, cyl, cone, octa, box } from './geo';
import type { Materials } from './materials';
import type { TerrainInfo } from './track-builder';
import { MEADOWS, type Theme } from './palette';

export interface Scenery {
  group: THREE.Group;
  /** Tree shadows cost a second draw per view; the Medium and Low tiers turn them off. */
  setCastShadows(on: boolean): void;
  dispose(): void;
}

const lerpHex = (a: number, b: number, t: number): number =>
  new THREE.Color(a).lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))).getHex();

/** A broadleaf tree: a forked trunk and 9 lumpy leaf clusters, shaded dark underneath and bright on top. */
function bushyTree(dark: number, light: number, trunk: number, seed: number, h = 1): THREE.BufferGeometry {
  const parts = [
    P_(cyl(0.28, 0.48, 3.4 * h, 7), trunk, 0, 1.7 * h, 0),
    P_(cyl(0.12, 0.2, 2.2, 5), trunk, 0.6, 3.6 * h, 0.2, 0, 0, -0.6),
    P_(cyl(0.12, 0.2, 2.0, 5), trunk, -0.55, 3.5 * h, -0.2, 0, 0, 0.65),
  ];
  const top = 4.2 * h + 3.6;
  for (let k = 0; k < 9; k++) {
    const a = k * 2.399 + seed,
      r = k === 0 ? 0 : 1.2 + (k % 3) * 0.6,
      y = 4.2 * h + 1.2 + (k % 4) * 0.75 + (k === 0 ? 1.4 : 0);
    const rad = k === 0 ? 2.2 : 1.35 + ((k * 7) % 5) * 0.12;
    parts.push(
      P_(
        jitter(ico(rad, 0), rad * 0.3, seed * 13 + k),
        (_x, yy) => lerpHex(dark, light, (yy - (y - rad)) / (top - 4.2 * h)),
        Math.cos(a) * r,
        y,
        Math.sin(a) * r,
      ),
    );
  }
  return merge(parts);
}

/** A conifer: 6 drooping tiers that narrow upwards; `frost` caps each tier with snow. */
function pineTree(dark: number, light: number, frost: boolean, seed: number): THREE.BufferGeometry {
  const parts = [P_(cyl(0.22, 0.38, 2.2, 6), 0x5d4037, 0, 1.1, 0)];
  const tiers = 6;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1),
      r = 2.9 - t * 2.2,
      y = 2.0 + k * 1.25,
      hh = 2.3 - t * 0.6;
    const col = lerpHex(dark, light, t * 0.7 + (k % 2) * 0.15);
    parts.push(P_(jitter(cone(r, hh, 9), 0.18, seed + k), col, 0, y + hh / 2, 0, 0, k * 0.7, 0));
    if (frost)
      parts.push(
        P_(jitter(cone(r * 0.82, hh * 0.42, 9), 0.1, seed + 20 + k), 0xf4f8ff, 0, y + hh * 0.86, 0, 0, k * 0.7, 0),
      );
  }
  if (frost) parts.push(P_(cone(0.5, 0.9, 7), 0xffffff, 0, 2.0 + tiers * 1.25 + 0.6, 0));
  return merge(parts);
}

export function buildScenery(T: Track, terrain: TerrainInfo, M: Materials, seed: number, th: Theme = MEADOWS): Scenery {
  const { N, CX, CZ, RX, RZ } = T;
  const WALL = Math.max(...T.WALLD);
  const rng = new Rng(seed);
  const rnd = (a: number, b: number): number => rng.range(a, b);
  const group = new THREE.Group();
  const meshes: THREE.InstancedMesh[] = [];
  const geos: THREE.BufferGeometry[] = [];

  const blocked = (x: number, z: number): boolean => terrain.zones.some((zn) => Math.hypot(x - zn.x, z - zn.z) < zn.r);
  function scatter(
    count: number,
    minD: number,
    maxLat: number,
    cb: (k: number, x: number, y: number, z: number) => void,
  ): number {
    let placed = 0,
      tries = 0;
    while (placed < count && tries++ < count * 25) {
      const i = Math.floor(rng.next() * N),
        lat = (rng.next() < 0.5 ? -1 : 1) * (minD + rng.next() * (maxLat - minD));
      const x = CX[i]! + RX[i]! * lat,
        z = CZ[i]! + RZ[i]! * lat;
      if (blocked(x, z)) continue;
      const n = terrain.nearTrack(x, z);
      if (n.d < minD) continue;
      const y = terrain.terrainH(x, z, n);
      if (terrain.pond && y < terrain.pond.y + 0.3) continue;
      cb(placed++, x, y, z);
    }
    return placed;
  }
  function instanced(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    count: number,
    shadow: boolean,
  ): THREE.InstancedMesh {
    geos.push(geo);
    const im = new THREE.InstancedMesh(geo, mat, count);
    im.castShadow = shadow;
    im.userData.shadow = shadow;
    im.receiveShadow = true;
    group.add(im);
    meshes.push(im);
    return im;
  }
  const m4 = new THREE.Matrix4(),
    q = new THREE.Quaternion(),
    e = new THREE.Euler(),
    v = new THREE.Vector3(),
    sc = new THREE.Vector3(),
    c = new THREE.Color();
  function setInst(
    im: THREE.InstancedMesh,
    n: number,
    x: number,
    y: number,
    z: number,
    ry: number,
    s: number,
    sy: number,
    tint?: number,
  ): void {
    m4.compose(v.set(x, y, z), q.setFromEuler(e.set(0, ry, 0)), sc.set(s, s * (sy || 1), s));
    im.setMatrixAt(n, m4);
    if (tint !== undefined) im.setColorAt(n, c.setHex(tint));
  }
  function finishInst(im: THREE.InstancedMesh, n: number): void {
    im.count = n;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  const tints = [0xffffff, 0xf0fff0, 0xe6f7d9, 0xfff6e0, 0xdff5ff];
  const place = (
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    cnt: number,
    minD: number,
    maxLat: number,
    shadow: boolean,
    s0: number,
    s1: number,
    sy0: number,
    sy1: number,
    cols: readonly number[],
    dy = 0,
  ): void => {
    const im = instanced(geo, mat, cnt, shadow);
    finishInst(
      im,
      scatter(cnt, minD, maxLat, (k, x, y, z) =>
        setInst(im, k, x, y + dy, z, rng.next() * 6, rnd(s0, s1), rnd(sy0, sy1), cols[k % cols.length]),
      ),
    );
  };
  if (th.id === 'canyon') {
    const cactus = merge([
      P_(cyl(0.55, 0.65, 6, 7), 0x5f8f4a, 0, 3, 0),
      P_(cyl(0.38, 0.42, 2.2, 6), 0x6a9a52, 1.1, 3.4, 0, 0, 0, 0.9),
      P_(cyl(0.34, 0.38, 2.0, 6), 0x6a9a52, 1.65, 4.6, 0),
      P_(cyl(0.34, 0.38, 1.6, 6), 0x6a9a52, -1.0, 2.6, 0, 0, 0, -0.9),
      P_(cyl(0.3, 0.34, 1.6, 6), 0x6a9a52, -1.5, 3.6, 0),
    ]);
    place(cactus, M.inst, 170, WALL + 8, 170, true, 0.7, 1.3, 0.8, 1.3, tints, -0.2);
    const spire = merge([P_(jitter(new THREE.ConeGeometry(4, 22, 6, 3), 1.2, 3), th.rock[0]!, 0, 10, 0)]);
    place(spire, M.inst, 45, WALL + 30, 260, true, 0.6, 1.4, 0.6, 1.6, [0xffffff, 0xf4dccb, 0xe8c9b4]);
    const scrub = merge([
      P_(jitter(ico(1.0, 0), 0.35, 5), 0x9c9a52, 0, 0.5, 0, 0, 0, 0, 1.3, 0.7, 1.1),
      P_(jitter(ico(0.7, 0), 0.25, 6), 0xa8a65c, 0.7, 0.4, 0.3),
    ]);
    place(scrub, M.inst, 160, WALL + 5, 90, true, 0.8, 1.5, 1, 1, tints);
    const rock = merge([P_(jitter(new THREE.DodecahedronGeometry(1.2, 0), 0.5, 8), th.rock[1]!, 0, 0.5, 0)]);
    place(rock, M.inst, 120, WALL + 5, 180, true, 0.6, 2.6, 0.6, 1, [0xffffff, 0xf0d0c0]);
  } else if (th.id === 'tropical') {
    const palm = merge([
      P_(cyl(0.32, 0.45, 9, 6), 0x8d6e4f, 0.6, 4.5, 0, 0, 0, -0.12),
      ...[0, 1, 2, 3, 4, 5, 6].map((k) =>
        P_(
          box(0.9, 0.18, 4.6),
          k % 2 ? 0x3e9b3a : 0x48ad43,
          1.2 + Math.sin((k * Math.PI * 2) / 7) * 1.9,
          8.7,
          Math.cos((k * Math.PI * 2) / 7) * 1.9,
          -0.35,
          (k * Math.PI * 2) / 7,
          0,
        ),
      ),
      P_(ico(0.55, 0), 0x6d4c2f, 1.2, 9.0, 0),
    ]);
    place(palm, M.inst, 260, WALL + 8, 180, true, 0.8, 1.3, 0.85, 1.25, tints, -0.2);
    // dense tropical forest: broadleaf clusters and alpine pines on the hills (D45)
    place(
      bushyTree(0x1f5a28, 0x63b04a, 0x6a4a35, 3, 1.1),
      M.inst,
      260,
      WALL + 14,
      220,
      true,
      0.9,
      1.7,
      0.9,
      1.25,
      tints,
      -0.2,
    );
    place(pineTree(0x173f2c, 0x3f8a52, false, 41), M.inst, 220, WALL + 20, 230, true, 1.0, 1.8, 0.9, 1.3, tints, -0.2);
    const bush = merge([
      P_(jitter(ico(1.1, 0), 0.3, 5), 0x3f9a3a, 0, 0.6, 0, 0, 0, 0, 1.3, 0.8, 1.1),
      P_(jitter(ico(0.8, 0), 0.25, 6), 0x52ad48, 0.8, 0.5, 0.3),
    ]);
    place(bush, M.inst, 160, WALL + 5, 70, true, 0.8, 1.5, 1, 1, tints);
  } else if (th.id === 'frosty') {
    place(
      pineTree(0x173d34, 0x2f6a58, true, 7),
      M.inst,
      420,
      WALL + 9,
      220,
      true,
      0.8,
      1.8,
      0.9,
      1.35,
      [0xffffff, 0xeef4ff, 0xe4ecff],
    );
    const drift = merge([P_(jitter(ico(1.4, 1), 0.3, 5), 0xffffff, 0, 0.1, 0, 0, 0, 0, 1.6, 0.45, 1.2)]);
    place(drift, M.inst, 160, WALL + 4, 80, false, 0.8, 1.8, 1, 1, [0xffffff, 0xf3f7ff]);
    const rock = merge([
      P_(jitter(new THREE.DodecahedronGeometry(1.2, 0), 0.5, 8), th.rock[0]!, 0, 0.5, 0),
      P_(jitter(ico(0.9, 0), 0.2, 9), 0xffffff, 0, 1.15, 0, 0, 0, 0, 1.1, 0.4, 1.1),
    ]);
    place(rock, M.inst, 90, WALL + 6, 170, true, 0.6, 2.4, 0.6, 1, [0xffffff, 0xe8eeff]);
  } else {
    const treeRound = bushyTree(0x2c6b2a, 0x8ccf5a, 0x7a5a42, 1);
    const treePine = pineTree(0x1d5634, 0x4c9a55, false, 17);
    const treeTall = bushyTree(0x4a7d2a, 0xb5d65a, 0x8d6e63, 5, 1.4);
    for (const [geo, cnt] of [
      [treeRound, 240],
      [treePine, 200],
      [treeTall, 90],
    ] as const) {
      const im = instanced(geo, M.inst, cnt, true);
      finishInst(
        im,
        scatter(cnt, WALL + 11, 190, (k, x, y, z) =>
          setInst(im, k, x, y - 0.2, z, rng.next() * 6, rnd(0.8, 1.45), rnd(0.9, 1.15), tints[k % tints.length]),
        ),
      );
    }
    const bush = merge([
      P_(jitter(ico(1.1, 0), 0.3, 5), 0x66bb6a, 0, 0.6, 0, 0, 0, 0, 1.3, 0.8, 1.1),
      P_(jitter(ico(0.8, 0), 0.25, 6), 0x7cc576, 0.8, 0.5, 0.3),
    ]);
    let im = instanced(bush, M.inst, 130, true);
    finishInst(
      im,
      scatter(130, WALL + 6, 70, (k, x, y, z) =>
        setInst(im, k, x, y, z, rng.next() * 6, rnd(0.8, 1.5), 1, tints[k % 5]),
      ),
    );
    const rock = merge([P_(jitter(new THREE.DodecahedronGeometry(1.2, 0), 0.5, 8), 0xa09cb0, 0, 0.5, 0)]);
    im = instanced(rock, M.inst, 70, true);
    finishInst(
      im,
      scatter(70, WALL + 6, 160, (k, x, y, z) =>
        setInst(im, k, x, y, z, rng.next() * 6, rnd(0.6, 2.2), rnd(0.6, 1), 0xffffff),
      ),
    );
    const flower = merge([P_(octa(0.32), 0xffffff, 0, 0.45, 0), P_(cone(0.08, 0.45, 3), 0x4caf50, 0, 0.2, 0)]);
    im = instanced(flower, M.instL, 700, false);
    const fc = [0xff80ab, 0xffeb3b, 0xffffff, 0xff5252, 0xb388ff, 0xffab40];
    finishInst(
      im,
      scatter(700, WALL + 4.5, 55, (k, x, y, z) =>
        setInst(im, k, x, y, z, rng.next() * 6, rnd(0.8, 1.3), 1, fc[k % fc.length]),
      ),
    );
  }

  return {
    group,
    setCastShadows(on) {
      for (const m of meshes) if (m.userData.shadow) m.castShadow = on;
    },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of meshes) m.dispose();
    },
  };
}
