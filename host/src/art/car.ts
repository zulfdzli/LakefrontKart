/**
 * The race car (D44), built from reference/kart/kart.jpg (front, back, side and top views): an open-wheel car with
 * a long tapered nose, a multi-element front wing with endplates, a narrow survival cell with the halo, undercut
 * sidepods with front inlets, an engine cover rising to the airbox and a shark fin, a high rear wing with endplates,
 * DRS flap, swan-neck pylon and beam wing, a diffuser and crash structure with a red rain light, slick tyres,
 * wishbone suspension and mirrors.
 *
 * Livery follows the reference's pattern: the main colour (the player's slot colour, AI orange) with white panels
 * on the sidepods and engine cover, and black wings, floor, halo and suspension. The reference's real brand marks
 * are replaced by the game's fictional sponsors and a Turbo Karts badge, and each car carries its own number.
 *
 * Coordinates: metres, +z forward, +y up, x across. The model is stylised a little shorter than a real car (5.5 m).
 */
import * as THREE from 'three';
import { P_, merge, cyl, box, ico, type Part } from './geo';
import { DARK, WHITE } from './palette';

/** The whole car (and its driver) is drawn this much bigger than the model's metres (your request, D45). */
export const CAR_SCALE = 1.15;

/** Wheel placement, shared with the effects (skid marks, sparks, smoke). */
export const CAR = {
  rearX: 1.14,
  rearZ: -1.62,
  rearR: 0.7,
  frontX: 1.08,
  frontZ: 1.86,
  frontR: 0.6,
  /** Driver's head (helmet centre) in body space. */
  head: new THREE.Vector3(0, 0.98, -0.22),
  /** Exhaust exits for the boost flames. */
  exhaust: [new THREE.Vector3(0.16, 0.74, -2.62), new THREE.Vector3(-0.16, 0.74, -2.62)],
} as const;

/** Rear-wheel and exhaust positions in world metres (after CAR_SCALE), for the effects. */
export const CAR_WORLD = {
  rearX: CAR.rearX * CAR_SCALE,
  rearZ: CAR.rearZ * CAR_SCALE,
  exhaustZ: -2.62 * CAR_SCALE,
  exhaustY: 0.74 * CAR_SCALE,
} as const;

const BLACK = 0x1c1d22;
const CARBON = 0x2a2c33;
const TYRE = 0x3a3a46;
const RIM = 0x2e3036;
const NUT = 0x55565e;
const LIGHT = 0xff2a2a;
/** The reference's neon yellow-green accent (wing endplates, tyre sidewalls). */
const NEON = 0xc8f21e;
const SIDEWALL = 0xf2d21b;

/**
 * Surface finish per vertex (D47): roughness, metalness, clear-coat, and w = glow (> 0) or carbon weave (-1).
 * One material and one draw call per car; the shader in materials.ts reads this attribute.
 */
export type Finish = readonly [number, number, number, number];
export const FIN = {
  /** Metallic-flake paint under a glossy clear-coat; w = 0.01 marks it for the neon livery stripes. */
  paint: [0.2, 0.45, 1, 0.01],
  /** White panels: pearl, less metal so they stay white. */
  pearl: [0.16, 0.08, 1, 0],
  /** Carbon fibre: woven, lacquered. */
  carbon: [0.32, 0.25, 0.85, -1],
  /** Rubber: satin, scuffed. */
  rubber: [0.82, 0, 0, 0],
  /** Sidewall lettering band. */
  band: [0.75, 0, 0, 0],
  /** Machined metal (rims, wheel nuts). */
  metal: [0.28, 0.95, 0.3, 0],
  /** Rain light: glows. */
  light: [0.3, 0, 1, 2.2],
  /** Fur and faces: soft. */
  fur: [0.78, 0, 0, 0],
} as const satisfies Record<string, Finish>;

/** Merge groups of parts, each with its own finish, into one geometry with an `aPbr` attribute. */
export function mergePbr(groups: { parts: Part[]; fin: Finish }[]): THREE.BufferGeometry {
  const merged = groups.filter((g) => g.parts.length).map((g) => ({ geo: merge(g.parts), fin: g.fin }));
  let total = 0;
  for (const m of merged) total += m.geo.attributes.position!.count;
  const pos = new Float32Array(total * 3),
    nrm = new Float32Array(total * 3),
    col = new Float32Array(total * 3),
    pbr = new Float32Array(total * 4);
  let o = 0;
  for (const { geo, fin } of merged) {
    const n = geo.attributes.position!.count;
    pos.set(geo.attributes.position!.array as Float32Array, o * 3);
    // glossy finishes: half-smoothed normals, so sky reflections sweep across a panel instead of filling it flat
    const nr = geo.attributes.normal!.array as Float32Array;
    if (fin[2] >= 0.85) {
      const P = geo.attributes.position!.array as Float32Array,
        acc = new Map<string, [number, number, number]>();
      const key = (i: number): string =>
        `${Math.round(P[i * 3]! * 200)},${Math.round(P[i * 3 + 1]! * 200)},${Math.round(P[i * 3 + 2]! * 200)}`;
      for (let i = 0; i < n; i++) {
        const k = key(i),
          a = acc.get(k) ?? [0, 0, 0];
        a[0] += nr[i * 3]!;
        a[1] += nr[i * 3 + 1]!;
        a[2] += nr[i * 3 + 2]!;
        acc.set(k, a);
      }
      for (let i = 0; i < n; i++) {
        const a = acc.get(key(i))!,
          l = Math.hypot(a[0], a[1], a[2]) || 1;
        let x = nr[i * 3]! + a[0] / l,
          y = nr[i * 3 + 1]! + a[1] / l,
          z = nr[i * 3 + 2]! + a[2] / l;
        const m = Math.hypot(x, y, z) || 1;
        x /= m;
        y /= m;
        z /= m;
        nrm.set([x, y, z], (o + i) * 3);
      }
    } else nrm.set(nr, o * 3);
    col.set(geo.attributes.color!.array as Float32Array, o * 3);
    for (let i = 0; i < n; i++) pbr.set(fin, (o + i) * 4);
    o += n;
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 4));
  return out;
}

/** Split car parts by their colour into finishes. */
function byFinish(parts: Part[], paint: number, metal = RIM): { parts: Part[]; fin: Finish }[] {
  const g = {
    paint: [] as Part[],
    pearl: [] as Part[],
    carbon: [] as Part[],
    rubber: [] as Part[],
    band: [] as Part[],
    metal: [] as Part[],
    light: [] as Part[],
  };
  for (const p of parts) {
    const c = p.color;
    if (c === BLACK || c === CARBON) g.carbon.push(p);
    else if (c === TYRE) g.rubber.push(p);
    else if (c === RIM || c === NUT || c === metal) g.metal.push(p);
    else if (c === LIGHT) g.light.push(p);
    else if (c === SIDEWALL) g.band.push(p);
    else if (c === NEON) g.pearl.push(p);
    else if (c === WHITE && c !== paint) g.pearl.push(p);
    else g.paint.push(p);
  }
  return (Object.keys(g) as (keyof typeof g)[]).map((k) => ({ parts: g[k], fin: FIN[k] }));
}

/**
 * A box whose back end (z0) and front end (z1) have their own width and bottom/top heights: the tapering body
 * panels (nose, survival cell, sidepods, engine cover) are all made from this.
 */
function taper(
  z0: number,
  w0: number,
  yb0: number,
  yt0: number,
  z1: number,
  w1: number,
  yb1: number,
  yt1: number,
  x = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const front = p.getZ(i) > 0,
      top = p.getY(i) > 0,
      side = Math.sign(p.getX(i));
    const w = front ? w1 : w0;
    p.setXYZ(i, x + (side * w) / 2, front ? (top ? yt1 : yb1) : top ? yt0 : yb0, front ? z1 : z0);
  }
  g.computeVertexNormals();
  return g;
}

/** A thin rod between two points (suspension arms, pylons). */
function rod(a: [number, number, number], b: [number, number, number], t: number, color: number): Part {
  const A = new THREE.Vector3(...a),
    B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Matrix4().lookAt(B, A, new THREE.Vector3(0, 1, 0));
  m.setPosition(A.clone().add(B).multiplyScalar(0.5));
  return { geo: box(t, t, len), color, m };
}

/** The car body for one paint colour. */
export function buildCar(paint: number): THREE.BufferGeometry {
  const K = paint;
  const parts: Part[] = [];
  const add = (...p: Part[]): void => {
    parts.push(...p);
  };

  // floor, edges, plank and diffuser (black carbon underbody, as the reference)
  add(P_(taper(-2.05, 1.7, 0.12, 0.18, 1.05, 1.56, 0.12, 0.18), BLACK));
  add(P_(taper(-1.6, 0.08, 0.12, 0.3, 0.9, 0.08, 0.12, 0.26, 0.88), CARBON));
  add(P_(taper(-1.6, 0.08, 0.12, 0.3, 0.9, 0.08, 0.12, 0.26, -0.88), CARBON));
  add(P_(taper(-2.6, 1.34, 0.12, 0.54, -2.0, 1.44, 0.12, 0.2), BLACK));
  for (const x of [-0.42, -0.14, 0.14, 0.42]) add(P_(box(0.03, 0.3, 0.55), CARBON, x, 0.3, -2.32));

  // survival cell: carbon lower half, painted upper half; cockpit rim
  add(P_(taper(-0.6, 0.9, 0.2, 0.5, 0.9, 0.72, 0.2, 0.46), CARBON));
  add(P_(taper(-0.6, 0.88, 0.5, 0.92, 0.9, 0.7, 0.46, 0.84), K));
  add(P_(taper(-0.55, 0.62, 0.86, 0.96, 0.45, 0.5, 0.82, 0.91), BLACK));
  // nose: long, tapering and dropping to the wing, carbon underside, black tip
  add(P_(taper(0.9, 0.66, 0.22, 0.46, 2.7, 0.3, 0.22, 0.3), CARBON));
  add(P_(taper(0.9, 0.66, 0.46, 0.84, 2.7, 0.3, 0.3, 0.46), K));
  add(P_(taper(2.7, 0.3, 0.22, 0.46, 3.05, 0.18, 0.2, 0.34), BLACK));

  // front wing: four elements that sweep up towards the tips (the reference's curved wing), neon endplates
  for (const sd of [1, -1]) {
    for (let e = 0; e < 3; e++) {
      const y = 0.15 + e * 0.08,
        zc = 2.92 - e * 0.16;
      // inner section flat, outer section rising gently towards the tip
      add(P_(box(0.72, 0.045, 0.34 - e * 0.05), BLACK, sd * 0.38, y, zc, -0.25 * e));
      add(P_(box(0.62, 0.045, 0.32 - e * 0.05), BLACK, sd * 1.0, y + 0.06, zc, -0.25 * e, 0, sd * 0.12));
    }
    add(P_(box(0.05, 0.46, 0.86), BLACK, sd * 1.33, 0.36, 2.72, 0, sd * 0.24, 0));
    add(P_(box(0.055, 0.13, 0.86), NEON, sd * 1.33, 0.6, 2.72, 0, sd * 0.24, 0));
  }
  add(rod([0.12, 0.3, 2.55], [0.2, 0.18, 2.75], 0.05, BLACK), rod([-0.12, 0.3, 2.55], [-0.2, 0.18, 2.75], 0.05, BLACK));

  // sidepods: wider and sculpted (high inlet, downwash ramp to the rear), carbon undercut; mirrors on stalks
  for (const sd of [1, -1]) {
    const x = sd * 0.78;
    add(P_(taper(-1.35, 0.4, 0.3, 0.52, 0.55, 0.66, 0.34, 0.86, x), K));
    add(P_(taper(-1.0, 0.3, 0.14, 0.32, 0.5, 0.5, 0.14, 0.34, x), CARBON));
    add(P_(box(0.5, 0.36, 0.05), BLACK, x, 0.62, 0.56));
    add(rod([sd * 0.42, 0.86, 0.55], [sd * 0.7, 1.0, 0.5], 0.04, BLACK));
    add(P_(box(0.24, 0.11, 0.07), BLACK, sd * 0.76, 1.02, 0.5));
  }

  // engine cover up to the airbox, and the shark fin
  add(P_(taper(-2.35, 0.36, 0.28, 0.64, -0.55, 0.88, 0.28, 1.12), K));
  add(P_(box(0.38, 0.34, 0.42), K, 0, 1.24, -0.78));
  add(P_(box(0.26, 0.2, 0.04), BLACK, 0, 1.28, -0.56));
  add(P_(box(0.12, 0.08, 0.2), BLACK, 0, 1.45, -0.78));
  add(P_(taper(-2.2, 0.03, 0.62, 0.95, -0.95, 0.03, 1.0, 1.36), K));
  add(P_(cyl(0.09, 0.11, 0.3, 8), CARBON, 0, 0.74, -2.5, Math.PI / 2));

  // halo: a hoop around the cockpit with a centre pillar in front
  {
    const ring = new THREE.TorusGeometry(0.46, 0.05, 6, 16, Math.PI).rotateX(Math.PI / 2).scale(1, 1, 1.45);
    add(P_(ring, BLACK, 0, 1.18, -0.2));
    add(rod([0, 0.86, 0.62], [0, 1.18, 0.47], 0.08, BLACK));
    add(
      rod([0.46, 1.18, -0.2], [0.42, 0.9, -0.5], 0.07, BLACK),
      rod([-0.46, 1.18, -0.2], [-0.42, 0.9, -0.5], 0.07, BLACK),
    );
  }

  // rear wing: the reference's rounded wing (main plane curving down into the endplates), DRS flap,
  // painted top flap, swan-neck pylon, beam wing
  add(P_(box(1.6, 0.06, 0.46), BLACK, 0, 1.3, -2.58, 0.16));
  add(P_(box(1.6, 0.05, 0.3), K, 0, 1.5, -2.5, 0.48));
  for (const sd of [1, -1]) {
    // a quarter-round corner from the main plane into the endplate
    const corner = new THREE.TorusGeometry(0.22, 0.03, 4, 8, Math.PI / 2).rotateY(Math.PI / 2).scale(1, 1, 1.0);
    add(P_(corner, BLACK, sd * 0.8, 1.1, -2.58, 0, 0, sd > 0 ? 0 : Math.PI / 2));
    add(P_(box(0.045, 0.62, 0.72), BLACK, sd * 1.02, 0.94, -2.52));
    add(P_(box(0.05, 0.1, 0.72), NEON, sd * 1.02, 0.66, -2.52));
  }
  add(rod([0, 0.68, -2.3], [0, 1.28, -2.5], 0.07, BLACK));
  add(P_(box(1.42, 0.05, 0.26), BLACK, 0, 0.62, -2.5, 0.25));
  add(P_(taper(-2.78, 0.22, 0.34, 0.54, -2.3, 0.3, 0.32, 0.62), BLACK));
  add(P_(box(0.18, 0.13, 0.04), LIGHT, 0, 0.44, -2.8));

  // suspension: wishbones from the chassis to the wheel uprights, plus push/pull rods
  for (const s of [1, -1]) {
    const fx = s * (CAR.frontX - 0.22),
      fz = CAR.frontZ,
      rx = s * (CAR.rearX - 0.26),
      rz = CAR.rearZ;
    add(
      rod([s * 0.3, 0.68, 1.6], [fx, 0.68, fz], 0.05, BLACK),
      rod([s * 0.3, 0.68, 2.1], [fx, 0.68, fz], 0.05, BLACK),
      rod([s * 0.3, 0.4, 1.55], [fx, 0.46, fz], 0.05, BLACK),
      rod([s * 0.3, 0.4, 2.15], [fx, 0.46, fz], 0.05, BLACK),
      rod([s * 0.32, 0.78, -1.3], [rx, 0.8, rz], 0.05, BLACK),
      rod([s * 0.32, 0.78, -1.95], [rx, 0.8, rz], 0.05, BLACK),
      rod([s * 0.32, 0.38, -1.25], [rx, 0.48, rz], 0.05, BLACK),
      rod([s * 0.32, 0.38, -1.95], [rx, 0.48, rz], 0.05, BLACK),
    );
  }
  // seat back and shoulders inside the cockpit
  add(P_(box(0.56, 0.3, 0.3), CARBON, 0, 0.82, -0.45));
  return mergePbr(byFinish(parts, paint));
}

/** A slick tyre with a coloured sidewall band, a dark rim and a centre lock nut, axis along x. */
function wheel(r: number, w: number, band: number, rim = RIM): Part[] {
  const R = Math.PI / 2;
  // sidewall lettering: short yellow arcs around the band (both sides)
  const marks: Part[] = [];
  for (let k = 0; k < 10; k++) {
    if (k % 5 === 4) continue;
    const a = (k / 10) * Math.PI * 2;
    for (const sd of [1, -1])
      marks.push(
        P_(box(0.012, r * 0.05, r * 0.24), band, sd * (w / 2 + 0.008), Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, a),
      );
  }
  return [
    P_(cyl(r, r, w, 22), TYRE, 0, 0, 0, 0, 0, R),
    P_(cyl(r * 0.86, r * 0.86, w + 0.012, 22), TYRE, 0, 0, 0, 0, 0, R),
    ...marks,
    P_(cyl(r * 0.8, r * 0.8, w + 0.016, 22), band, 0, 0, 0, 0, 0, R),
    P_(cyl(r * 0.74, r * 0.74, w + 0.02, 18), rim, 0, 0, 0, 0, 0, R),
    // five spokes and the centre lock nut, machined metal
    ...[0, 1, 2, 3, 4].map((k) => P_(box(w + 0.03, r * 0.1, r * 1.3), NUT, 0, 0, 0, (k * Math.PI * 2) / 5, 0, 0)),
    P_(cyl(r * 0.2, r * 0.2, w + 0.06, 6), NUT, 0, 0, 0, 0, 0, R),
  ];
}

/** Rear axle (both wheels, one mesh, spun together) and one front wheel (steered on its pivot). */
export function buildWheels(rim = RIM): { rear: THREE.BufferGeometry; front: THREE.BufferGeometry } {
  const band = SIDEWALL;
  const rear: Part[] = [];
  for (const s of [1, -1])
    for (const p of wheel(CAR.rearR, 0.86, band, rim)) {
      p.m.premultiply(new THREE.Matrix4().makeTranslation(s * CAR.rearX, 0, 0));
      rear.push(p);
    }
  return {
    rear: mergePbr(byFinish(rear, -1, rim)),
    front: mergePbr(byFinish(wheel(CAR.frontR, 0.7, band, rim), -1, rim)),
  };
}

/**
 * Livery decals for one car (number and fictional sponsors), drawn into one small atlas and placed on the body
 * as slightly raised quads: one extra draw call per car.
 */
export function buildDecals(
  number: number,
  _paint: number,
  sticker = '',
): { geo: THREE.BufferGeometry; map: THREE.CanvasTexture } {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // number cell (0, 0, 128, 128): white with a dark outline
  g.font = 'italic 800 96px "Barlow Condensed", sans-serif';
  g.lineWidth = 10;
  g.strokeStyle = '#1c1d22';
  g.strokeText('#' + number, 64, 70);
  g.fillStyle = '#d4ff2a';
  g.fillText('#' + number, 64, 70);
  // badge cell (128, 0, 128, 128): the Turbo Karts shield
  g.fillStyle = '#ffd600';
  g.beginPath();
  g.moveTo(152, 14);
  g.lineTo(232, 14);
  g.lineTo(232, 70);
  g.quadraticCurveTo(232, 110, 192, 122);
  g.quadraticCurveTo(152, 110, 152, 70);
  g.closePath();
  g.fill();
  g.strokeStyle = '#1c1d22';
  g.lineWidth = 6;
  g.stroke();
  g.fillStyle = '#1c1d22';
  g.font = 'italic 800 48px "Barlow Condensed", sans-serif';
  g.fillText('TK', 192, 66);
  // D72 sticker cell (256, 0, 128, 128): the player's garage sticker
  if (sticker) {
    g.font = '96px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    g.fillText(sticker, 320, 72);
  }
  // sponsor rows (y = 128 + k * 64): white text on clear, except row 4 (on white panels: paint-coloured text)
  const rows = ['VELOCITY', 'HYPER', 'KARTRONIX', 'RAPID TYRES', 'AGILE', 'NEXTGEN'];
  rows.forEach((t, k) => {
    // fill the row: as large as fits 470 px wide and 52 px tall
    g.font = 'italic 800 52px "Barlow Condensed", sans-serif';
    const fit = Math.min(52, (52 * 470) / g.measureText(t).width);
    g.font = `italic 800 ${Math.floor(fit)}px "Barlow Condensed", sans-serif`;
    // white with a dark outline, the HYPER and RAPID TYRES rows in the neon accent (as the reference)
    g.lineWidth = 6;
    g.strokeStyle = '#1c1d22';
    g.strokeText(t, S / 2, 128 + k * 64 + 34);
    g.fillStyle = k === 1 || k === 3 ? '#d4ff2a' : '#ffffff';
    g.fillText(t, S / 2, 128 + k * 64 + 34);
  });
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  type Cell = [number, number, number, number];
  const NUM: Cell = [0, 0, 128, 128],
    BADGE: Cell = [128, 0, 128, 128],
    STICKER: Cell = [256, 0, 128, 128];
  const row = (k: number): Cell => [0, 128 + k * 64, 512, 64];
  const pos: number[] = [],
    uv: number[] = [];
  const quad = (
    cell: Cell,
    w: number,
    h: number,
    at: [number, number, number],
    rot: [number, number, number],
  ): void => {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(...at),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    const corners = [
      [-w / 2, -h / 2],
      [w / 2, -h / 2],
      [w / 2, h / 2],
      [-w / 2, h / 2],
    ].map(([x, y]) => new THREE.Vector3(x, y, 0).applyMatrix4(m));
    const [u0, v0, cw, ch] = cell;
    const U = (t: number): number => (u0 + t * cw) / S,
      V = (t: number): number => 1 - (v0 + (1 - t) * ch) / S;
    const uvs = [
      [U(0), V(0)],
      [U(1), V(0)],
      [U(1), V(1)],
      [U(0), V(1)],
    ];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(corners[i]!.x, corners[i]!.y, corners[i]!.z);
      uv.push(uvs[i]![0]!, uvs[i]![1]!);
    }
  };
  const UP = -Math.PI / 2;
  // number: engine cover top (read from behind), both sides of the engine cover, and the nose top
  quad(NUM, 0.42, 0.42, [0, 0.92, -1.7], [UP + 0.27, Math.PI, 0]);
  quad(NUM, 0.34, 0.34, [0, 0.705, 1.55], [UP + 0.12, 0, 0]);
  // badge on the nose, or the garage sticker there and on both sides of the shark fin (D72)
  if (sticker) {
    quad(STICKER, 0.24, 0.24, [0, 0.585, 2.25], [UP + 0.12, 0, 0]);
    for (const s of [1, -1]) quad(STICKER, 0.28, 0.28, [s * 0.045, 1.07, -1.38], [0, (s * Math.PI) / 2, 0]);
  } else quad(BADGE, 0.2, 0.2, [0, 0.58, 2.25], [UP + 0.12, 0, 0]);
  // sponsors, placed as the reference: VELOCITY big on the sidepods, AGILE high on the engine cover,
  // HYPER low on the sidepod, KARTRONIX on the rear wing, RAPID TYRES on the front wing, NEXTGEN on the beam wing
  for (const s of [1, -1]) {
    const ry = (s * Math.PI) / 2;
    quad(row(0), 1.7, 0.21, [s * 1.07, 0.62, -0.4], [0, ry, 0]);
    quad(row(1), 0.5, 0.062, [s * 1.07, 0.42, 0.1], [0, ry, 0]);
    quad(row(4), 0.5, 0.062, [s * 0.4, 0.92, -1.2], [0, ry, -s * 0.0]);
    quad(row(0), 0.62, 0.078, [s * 1.055, 1.0, -2.52], [0, ry, 0]);
    quad(row(3), 0.6, 0.075, [s * 1.0, 0.205, 2.86], [UP, 0, s * 0.0]);
  }
  quad(row(2), 1.4, 0.18, [0, 1.3, -2.83], [-0.16, Math.PI, 0]);
  quad(row(5), 0.9, 0.11, [0, 0.62, -2.64], [-0.25, Math.PI, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return { geo, map };
}

/**
 * An open-face racing helmet over the character's head (D44): a shell around the back and top in the character's
 * accent colour with a stripe in the car's colour, leaving the face, ears and horns showing. Head-space units
 * (the head is about 0.62 in radius, centred 0.35 up).
 */
export function helmetParts(accent: number, paint: number): Part[] {
  const open = 1.15; // half-angle of the face opening (rad)
  const shell = new THREE.SphereGeometry(0.69, 18, 12, Math.PI / 2 + open, Math.PI * 2 - 2 * open, 0, 1.95);
  const stripe = new THREE.SphereGeometry(0.705, 18, 4, Math.PI / 2 + open, Math.PI * 2 - 2 * open, 0.55, 0.22);
  return [P_(shell, accent, 0, 0.35, -0.04), P_(stripe, paint, 0, 0.35, -0.04), P_(ico(0.08, 0), DARK, 0, 1.02, -0.1)];
}
