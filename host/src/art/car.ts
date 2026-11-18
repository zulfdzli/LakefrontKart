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
  rearX: 1.08,
  rearZ: -1.62,
  rearR: 0.66,
  frontX: 1.02,
  frontZ: 1.86,
  frontR: 0.57,
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
  const K = paint,
    W = WHITE;
  const parts: Part[] = [];
  const add = (...p: Part[]): void => {
    parts.push(...p);
  };

  // floor, edges, plank and diffuser
  add(P_(taper(-2.05, 1.62, 0.12, 0.18, 1.05, 1.5, 0.12, 0.18), BLACK));
  add(P_(taper(-1.6, 0.08, 0.12, 0.28, 0.9, 0.08, 0.12, 0.24, 0.84), CARBON));
  add(P_(taper(-1.6, 0.08, 0.12, 0.28, 0.9, 0.08, 0.12, 0.24, -0.84), CARBON));
  add(P_(taper(-2.6, 1.3, 0.12, 0.52, -2.0, 1.4, 0.12, 0.2), BLACK));
  for (const x of [-0.4, 0, 0.4]) add(P_(box(0.03, 0.3, 0.55), CARBON, x, 0.3, -2.32));

  // survival cell and cockpit rim
  add(P_(taper(-0.6, 0.88, 0.2, 0.92, 0.9, 0.7, 0.2, 0.84), K));
  add(P_(taper(-0.55, 0.62, 0.86, 0.95, 0.45, 0.5, 0.82, 0.9), BLACK));
  // nose: long and tapering, with a black tip
  add(P_(taper(0.9, 0.66, 0.22, 0.84, 2.7, 0.3, 0.22, 0.46), K));
  add(P_(taper(2.7, 0.3, 0.22, 0.46, 3.02, 0.2, 0.22, 0.36), BLACK));
  // white chevron along the nose top (the reference's white nose panel)
  add(P_(taper(1.2, 0.3, 0.8, 0.83, 2.4, 0.16, 0.5, 0.53), W));

  // front wing: main plane, two flap elements, white centre panels, endplates
  add(P_(box(2.6, 0.05, 0.52), BLACK, 0, 0.17, 2.86));
  add(P_(box(2.4, 0.04, 0.3), BLACK, 0, 0.27, 2.62, -0.35));
  add(P_(box(2.2, 0.04, 0.24), BLACK, 0, 0.36, 2.48, -0.6));
  for (const s of [1, -1]) {
    // white panels on the main plane's leading edge (seen from the front, as the reference)
    add(P_(box(0.66, 0.1, 0.06), W, s * 0.6, 0.2, 3.13));
    // endplates, splayed outward at the front like the reference's top view
    add(P_(box(0.05, 0.4, 0.82), BLACK, s * 1.3, 0.3, 2.7, 0, s * 0.22, 0));
    add(P_(box(0.05, 0.12, 0.82), K, s * 1.3, 0.52, 2.7, 0, s * 0.22, 0));
  }
  // nose pylons into the wing
  add(rod([0.12, 0.3, 2.55], [0.2, 0.18, 2.75], 0.05, BLACK), rod([-0.12, 0.3, 2.55], [-0.2, 0.18, 2.75], 0.05, BLACK));

  // sidepods: front inlet, undercut, white top panel; mirrors above
  for (const s of [1, -1]) {
    const x = s * 0.72;
    add(P_(taper(-1.25, 0.34, 0.26, 0.5, 0.55, 0.62, 0.3, 0.8, x), K));
    // white only on the inner top, beside the cockpit (as the reference); the rest of the sidepod is body colour
    add(P_(taper(-0.75, 0.2, 0.56, 0.62, 0.15, 0.24, 0.74, 0.8, x - s * 0.17), W));
    add(P_(box(0.44, 0.34, 0.05), BLACK, x, 0.6, 0.56));
    add(P_(taper(-1.0, 0.24, 0.16, 0.3, 0.45, 0.4, 0.16, 0.32, x), CARBON));
    // mirrors on stalks
    add(rod([s * 0.42, 0.84, 0.55], [s * 0.66, 0.98, 0.5], 0.04, BLACK));
    add(P_(box(0.22, 0.1, 0.06), K, s * 0.72, 1.0, 0.5));
  }

  // engine cover up to the airbox, with white side panels and the shark fin
  add(P_(taper(-2.35, 0.36, 0.28, 0.62, -0.55, 0.86, 0.28, 1.12), K));
  // the large white panel on each side of the engine cover, from the cockpit back towards the rear wheels
  for (const s of [1, -1]) {
    add(P_(taper(-1.95, 0.02, 0.42, 0.68, -0.6, 0.02, 0.44, 1.08, s * 0.25 + s * 0.12), W));
  }
  add(P_(box(0.38, 0.34, 0.42), K, 0, 1.24, -0.78));
  // white zone on the engine-cover top just behind the airbox
  add(P_(taper(-1.35, 0.5, 0.95, 1.0, -0.98, 0.66, 1.03, 1.08), W));
  add(P_(box(0.26, 0.2, 0.04), BLACK, 0, 1.28, -0.56));
  add(P_(box(0.12, 0.08, 0.2), BLACK, 0, 1.45, -0.78));
  add(P_(taper(-2.2, 0.03, 0.62, 0.95, -0.95, 0.03, 1.0, 1.36), K));
  // exhaust
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

  // rear wing: main plane, DRS flap, endplates, swan-neck pylon; beam wing below
  add(P_(box(1.94, 0.06, 0.44), BLACK, 0, 1.22, -2.58, 0.18));
  add(P_(box(1.94, 0.05, 0.3), BLACK, 0, 1.44, -2.5, 0.5));
  for (const s of [1, -1]) {
    add(P_(box(0.045, 0.78, 0.7), BLACK, s * 0.99, 1.12, -2.52));
    add(P_(box(0.05, 0.1, 0.7), K, s * 0.99, 1.55, -2.52));
  }
  add(rod([0, 0.68, -2.3], [0, 1.2, -2.5], 0.07, BLACK));
  add(P_(box(1.42, 0.05, 0.26), BLACK, 0, 0.62, -2.5, 0.25));
  // crash structure and rain light
  add(P_(taper(-2.78, 0.22, 0.34, 0.54, -2.3, 0.3, 0.32, 0.62), BLACK));
  add(P_(box(0.18, 0.13, 0.04), 0xff2a2a, 0, 0.44, -2.8));

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
  return merge(parts);
}

/** A slick tyre with a coloured sidewall band, a dark rim and a centre lock nut, axis along x. */
function wheel(r: number, w: number, band: number): Part[] {
  const R = Math.PI / 2;
  return [
    P_(cyl(r, r, w, 18), TYRE, 0, 0, 0, 0, 0, R),
    P_(cyl(r * 0.86, r * 0.86, w + 0.012, 18), TYRE, 0, 0, 0, 0, 0, R),
    P_(cyl(r * 0.8, r * 0.8, w + 0.016, 18), band, 0, 0, 0, 0, 0, R),
    P_(cyl(r * 0.74, r * 0.74, w + 0.02, 18), BLACK, 0, 0, 0, 0, 0, R),
    P_(cyl(r * 0.2, r * 0.2, w + 0.06, 6), 0x55565e, 0, 0, 0, 0, 0, R),
  ];
}

/** Rear axle (both wheels, one mesh, spun together) and one front wheel (steered on its pivot). */
export function buildWheels(): { rear: THREE.BufferGeometry; front: THREE.BufferGeometry } {
  const band = 0xf5f5f5;
  const rear: Part[] = [];
  for (const s of [1, -1])
    for (const p of wheel(CAR.rearR, 0.78, band)) {
      p.m.premultiply(new THREE.Matrix4().makeTranslation(s * CAR.rearX, 0, 0));
      rear.push(p);
    }
  return { rear: merge(rear), front: merge(wheel(CAR.frontR, 0.62, band)) };
}

/**
 * Livery decals for one car (number and fictional sponsors), drawn into one small atlas and placed on the body
 * as slightly raised quads: one extra draw call per car.
 */
export function buildDecals(number: number, paint: number): { geo: THREE.BufferGeometry; map: THREE.CanvasTexture } {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // number cell (0, 0, 128, 128): white with a dark outline
  g.font = 'bold 96px Fredoka, sans-serif';
  g.lineWidth = 10;
  g.strokeStyle = '#1c1d22';
  g.strokeText(String(number), 64, 70);
  g.fillStyle = '#fff';
  g.fillText(String(number), 64, 70);
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
  g.font = 'bold 48px Fredoka, sans-serif';
  g.fillText('TK', 192, 66);
  // sponsor rows (y = 128 + k * 64): white text on clear, except row 4 (on white panels: paint-coloured text)
  const rows = ['VOLTEX', 'NIMBUS OIL', 'KARTRONIX', 'RAPIDO TYRES', 'ZAP COLA', 'SKYFIZZ'];
  rows.forEach((t, k) => {
    g.font = 'bold 44px Fredoka, sans-serif';
    g.fillStyle = k === 4 ? '#' + paint.toString(16).padStart(6, '0') : '#ffffff';
    if (k === 4) {
      g.lineWidth = 3;
      g.strokeStyle = '#1c1d22';
      g.strokeText(t, S / 2, 128 + k * 64 + 34);
    }
    g.fillText(t, S / 2, 128 + k * 64 + 34);
  });
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;

  type Cell = [number, number, number, number];
  const NUM: Cell = [0, 0, 128, 128],
    BADGE: Cell = [128, 0, 128, 128];
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
  quad(NUM, 0.4, 0.4, [0, 0.905, -1.7], [UP + 0.27, Math.PI, 0]);
  quad(NUM, 0.46, 0.46, [0.372, 0.79, -1.0], [0, Math.PI / 2, 0]);
  quad(NUM, 0.46, 0.46, [-0.372, 0.79, -1.0], [0, -Math.PI / 2, 0]);
  quad(NUM, 0.3, 0.3, [0, 0.73, 1.45], [UP + 0.19, 0, 0]);
  // badge on the nose
  quad(BADGE, 0.2, 0.2, [0, 0.6, 2.2], [UP + 0.19, 0, 0]);
  // sponsors: sidepods, engine cover panels, rear wing (face and endplates), front wing
  for (const s of [1, -1]) {
    const ry = (s * Math.PI) / 2;
    quad(row(0), 0.84, 0.105, [s * 1.0, 0.52, -0.3], [0, ry, 0]);
    quad(row(4), 0.62, 0.078, [s * 0.375, 0.64, -1.4], [0, ry, 0]);
    quad(row(1), 0.7, 0.088, [s * 1.02, 1.12, -2.52], [0, ry, 0]);
  }
  quad(row(2), 1.5, 0.19, [0, 1.2, -2.815], [-0.18, Math.PI, 0]);
  quad(row(3), 1.4, 0.175, [0, 0.199, 2.88], [UP, 0, 0]);
  quad(row(5), 0.56, 0.07, [0, 0.88, 0.4], [UP + 0.05, 0, 0]);
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
