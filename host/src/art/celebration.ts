/**
 * D51 the podium ceremony: a festive stage per theme and the celebration around it.
 *
 *  - The stage (always there, one shiny mesh plus the three steps): a white stage on a deep blue base with a
 *    neon edge in the theme's colour, gold / silver / bronze steps with glowing frames, poles and the banner bar.
 *    On Frosty Peaks the steps carry snow and the stage edge icicles.
 *  - The celebration (only during the podium): bunting, balloons, championship banners, searchlight beams,
 *    fireworks in the sky, sparkler fountains, twinkling stars, tumbling foil confetti and curly ribbons; falling
 *    snow on Frosty Peaks; a small cheering crowd and a light tower on Sunny Meadows.
 *
 * Everything is in the podium's own frame (x across, +z towards the camera, y up from the ground at its centre).
 * Effects are seeded, so captures are reproducible.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Rng } from '@tk/shared';
import { P_, box, cyl, cone, ico, canvasTex, type Part } from './geo';
import { mergePbr, type Finish } from './car';
import type { Materials } from './materials';
import type { Podium, TerrainInfo } from './track-builder';
import type { Theme } from './palette';

const _o = new THREE.Object3D();
const _c = new THREE.Color();

/** Finishes for the stage (roughness, metal, clear-coat, glow). */
const F = {
  gloss: [0.18, 0.05, 1, 0],
  satin: [0.45, 0.15, 0.6, 0],
  chrome: [0.16, 1, 0.6, 0],
  fabric: [0.62, 0, 0.15, 0],
  latex: [0.14, 0, 1, 0],
  snow: [0.62, 0, 0.25, 0],
  ice: [0.06, 0, 1, 0],
  neon: [0.35, 0, 1, 0.65],
  trim: [0.35, 0, 1, 0.42],
} as const satisfies Record<string, Finish>;

interface Look {
  neon: number;
  base: number;
  bar: number;
  banner: [string, string];
  beam: number;
  crowd: boolean;
  snow: boolean;
  fireworks: number[];
}
const LOOKS: Record<Theme['id'], Look> = {
  meadows: {
    neon: 0x3dff7a,
    base: 0x283593,
    bar: 0xffd23a,
    banner: ['#5e35b1', '#1a237e'],
    beam: 0xfff2c4,
    crowd: true,
    snow: false,
    fireworks: [0xff4fa0, 0xffd54f, 0x4fc3f7, 0xb388ff, 0x69f0ae],
  },
  canyon: {
    neon: 0xffa030,
    base: 0x283593,
    bar: 0xffc93a,
    banner: ['#ef6c00', '#7f2f08'],
    beam: 0xffd8a0,
    crowd: false,
    snow: false,
    fireworks: [0xffb74d, 0xff7043, 0xfff59d, 0xff4081, 0xffe0b2],
  },
  frosty: {
    neon: 0x7fe8ff,
    base: 0x1e3a8a,
    bar: 0xffd23a,
    banner: ['#4fc3f7', '#1a237e'],
    beam: 0xd6f4ff,
    crowd: false,
    snow: true,
    fireworks: [0x80deea, 0xff80ab, 0xffffff, 0xb39ddb, 0xfff59d],
  },
  tropical: {
    neon: 0x45a6ff,
    base: 0x283593,
    bar: 0xffd23a,
    banner: ['#2e7d32', '#004d40'],
    beam: 0xfff6d0,
    crowd: false,
    snow: false,
    fireworks: [0xffd54f, 0x69f0ae, 0xff6e40, 0x40c4ff, 0xea80fc],
  },
};
const BUNTING = [0xff3b5c, 0xffd23a, 0x2f8cff, 0x3ddc84, 0xa259ff, 0xff8a3d, 0xff6ec7];
const CONFETTI = [0xff3b5c, 0xffd23a, 0x2f8cff, 0x3ddc84, 0xa259ff, 0xff8a3d, 0xff6ec7, 0xffffff];
const SPARK = [0xffe7a0, 0xffd27a, 0xfff6e0];

/* ---------------- glowing points: fireworks, sparks, stars, snow ---------------- */

const GLOW_VERT = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor; attribute float aKind;
  varying float vAlpha; varying vec3 vColor; varying float vKind;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 1.0, 110.0);
    vAlpha = aAlpha; vColor = aColor; vKind = aKind;
  }`;
const GLOW_FRAG = /* glsl */ `
  varying float vAlpha; varying vec3 vColor; varying float vKind;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    if (vKind > 1.5) {
      // a soft snowflake (normal blending)
      gl_FragColor = vec4(vColor, smoothstep(1.0, 0.45, d) * vAlpha);
      return;
    }
    float a = exp(-d * d * 9.0) + pow(1.0 - d, 2.0) * 0.3;
    if (vKind > 0.5) {
      // a four-point star with a soft core
      vec2 q = abs(p) * 2.0;
      a = max(exp(-d * d * 14.0), max(exp(-q.x * 16.0) * (1.0 - q.y), exp(-q.y * 16.0) * (1.0 - q.x)));
    }
    gl_FragColor = vec4(vColor * a * vAlpha, 1.0);
  }`;

class GlowPoints {
  readonly points: THREE.Points;
  private readonly geo = new THREE.BufferGeometry();
  private readonly mat: THREE.ShaderMaterial;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly kind: Float32Array;
  private readonly v: Float32Array;
  private readonly c0: Float32Array;
  private readonly life: Float32Array;
  private readonly ml: Float32Array;
  private readonly sz: Float32Array;
  private readonly g: Float32Array;
  private readonly drag: Float32Array;
  private readonly flick: Float32Array;
  /** Fireworks that leave a trail of sparks behind them. */
  private readonly trail: Uint8Array;
  private head = 0;
  private t = 0;

  constructor(
    readonly max: number,
    additive: boolean,
    private readonly rnd: () => number,
  ) {
    this.pos = new Float32Array(max * 3).fill(-9999);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.kind = new Float32Array(max);
    this.v = new Float32Array(max * 3);
    this.c0 = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ml = new Float32Array(max);
    this.sz = new Float32Array(max);
    this.g = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.flick = new Float32Array(max);
    this.trail = new Uint8Array(max);
    const dyn = (a: Float32Array, n: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aColor', dyn(this.col, 3));
    this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    this.geo.setAttribute('aKind', dyn(this.kind, 1));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uScale: { value: 620 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  /** `bright` scales the colour above 1 so the bloom picks it up; kind 0 glow, 1 star, 2 snowflake. */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    hex: number,
    life: number,
    size: number,
    grav: number,
    drag: number,
    bright: number,
    kind = 0,
    flicker = 0,
    trail = false,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    _c.setHex(hex);
    this.c0.set([_c.r * bright, _c.g * bright, _c.b * bright], i * 3);
    this.life[i] = this.ml[i] = life;
    this.sz[i] = size;
    this.g[i] = grav;
    this.drag[i] = drag;
    this.kind[i] = kind;
    this.flick[i] = flicker;
    this.trail[i] = trail ? 1 : 0;
  }

  update(dt: number): void {
    this.t += dt;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        if (this.alpha[i]) this.alpha[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const b = i * 3,
        k = Math.exp(-this.drag[i]! * dt);
      this.v[b]! *= k;
      this.v[b + 1]! *= k;
      this.v[b + 2]! *= k;
      this.v[b + 1]! -= this.g[i]! * dt;
      this.pos[b]! += this.v[b]! * dt;
      this.pos[b + 1]! += this.v[b + 1]! * dt;
      this.pos[b + 2]! += this.v[b + 2]! * dt;
      const left = Math.max(0, this.life[i]! / this.ml[i]!);
      // fade in fast, out slowly; crackling ones twinkle as they die
      let a = Math.min(1, (1 - left) * 12) * Math.pow(left, 0.75);
      if (this.flick[i]! > 0 && left < 0.6) a *= 0.35 + 0.65 * (Math.sin(this.t * 40 + i * 1.7) > 0 ? 1 : 0.2);
      if (this.kind[i] === 2) a = Math.min(1, (1 - left) * 6) * Math.min(1, left * 6);
      this.alpha[i] = a;
      // colour cools from white-hot towards the shell's colour
      const hot = this.kind[i] === 0 ? Math.max(0, (left - 0.75) * 3) : 0;
      this.col[b] = this.c0[b]! + hot;
      this.col[b + 1] = this.c0[b + 1]! + hot;
      this.col[b + 2] = this.c0[b + 2]! + hot;
      this.size[i] = this.sz[i]! * (this.kind[i] === 1 ? 0.5 + Math.sin(left * Math.PI) * 0.7 : 0.55 + left * 0.45);
      if (this.trail[i] && this.rnd() < 0.35)
        this.emit(
          this.pos[b]!,
          this.pos[b + 1]!,
          this.pos[b + 2]!,
          0,
          0,
          0,
          0xffc864,
          0.55,
          this.sz[i]! * 0.45,
          1.5,
          0.5,
          1.6,
        );
    }
    for (const n of ['position', 'aColor', 'aSize', 'aAlpha', 'aKind']) this.geo.attributes[n]!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha!.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

/* ---------------- tumbling confetti and curly ribbons ---------------- */

class Flutter {
  readonly mesh: THREE.InstancedMesh;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly r: Float32Array;
  private readonly w: Float32Array;
  private readonly life: Float32Array;
  private readonly floor: Float32Array;
  private readonly ph: Float32Array;
  private head = 0;
  private t = 0;

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    readonly max: number,
    private readonly fall: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.r = new Float32Array(max * 3);
    this.w = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.floor = new Float32Array(max);
    this.ph = new Float32Array(max);
    _o.position.set(0, -999, 0);
    _o.scale.setScalar(0);
    _o.updateMatrix();
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, _o.matrix);
      this.mesh.setColorAt(i, _c.setHex(0xffffff));
    }
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    hex: number,
    floor: number,
    rnd: () => number,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.p.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.r.set([rnd() * 6, rnd() * 6, rnd() * 6], i * 3);
    this.w.set([(rnd() - 0.5) * 14, (rnd() - 0.5) * 10, (rnd() - 0.5) * 14], i * 3);
    this.life[i] = 9 + rnd() * 3;
    this.floor[i] = floor;
    this.ph[i] = rnd() * 6.28;
    this.mesh.setColorAt(i, _c.setHex(hex));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    this.t += dt;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) continue;
      this.life[i]! -= dt;
      const b = i * 3;
      const grounded = this.p[b + 1]! <= this.floor[i]! + 0.02;
      if (!grounded) {
        // air drag towards a slow, swaying fall
        const k = Math.exp(-2.2 * dt);
        this.v[b]! *= k;
        this.v[b + 2]! *= k;
        this.v[b + 1] = Math.max(-this.fall, this.v[b + 1]! - 9 * dt);
        const sway = Math.sin(this.t * 2.6 + this.ph[i]!) * 0.9;
        this.p[b]! += (this.v[b]! + sway) * dt;
        this.p[b + 1]! += this.v[b + 1]! * dt;
        this.p[b + 2]! += (this.v[b + 2]! + Math.cos(this.t * 2.1 + this.ph[i]!) * 0.5) * dt;
        this.r[b]! += this.w[b]! * dt;
        this.r[b + 1]! += this.w[b + 1]! * dt;
        this.r[b + 2]! += this.w[b + 2]! * dt;
        if (this.p[b + 1]! < this.floor[i]!) this.p[b + 1] = this.floor[i]!;
      } else {
        // lying on the ground: flat, slowly fading away at the end
        this.r[b] = -Math.PI / 2;
        this.r[b + 2] = 0;
        this.life[i] = Math.min(this.life[i]!, 4);
      }
      const s = this.life[i]! < 0.6 ? Math.max(0, this.life[i]! / 0.6) : 1;
      _o.position.set(this.p[b]!, this.p[b + 1]!, this.p[b + 2]!);
      _o.rotation.set(this.r[b]!, this.r[b + 1]!, this.r[b + 2]!);
      _o.scale.setScalar(this.life[i]! > 0 ? s : 0);
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    _o.position.set(0, -999, 0);
    _o.scale.setScalar(0);
    _o.updateMatrix();
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, _o.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** A curly ribbon: a narrow strip wound round a helix, about 2.4 m long. */
function ribbonGeo(): THREE.BufferGeometry {
  const n = 28,
    pos: number[] = [],
    idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      a = t * Math.PI * 5,
      r = 0.2 + t * 0.06,
      x = Math.cos(a) * r,
      z = Math.sin(a) * r,
      y = 1.2 - t * 2.4;
    pos.push(x, y + 0.05, z, x, y - 0.05, z);
    if (i < n) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------- canvas art ---------------- */

/** Pale marble with soft veins, used as the steps' colour map (tinted gold, silver or bronze). */
function marbleTex(rnd: () => number): THREE.CanvasTexture {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#e9e9e9';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '120,120,120'},${0.04 + rnd() * 0.06})`;
      g.beginPath();
      g.arc(rnd() * w, rnd() * h, 10 + rnd() * 60, 0, Math.PI * 2);
      g.fill();
    }
    g.lineCap = 'round';
    for (let i = 0; i < 16; i++) {
      g.strokeStyle = `rgba(90,90,90,${0.12 + rnd() * 0.22})`;
      g.lineWidth = 0.8 + rnd() * 2.6;
      g.beginPath();
      let x = rnd() * w,
        y = rnd() * h;
      g.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        const nx = x + (rnd() - 0.3) * 140,
          ny = y + (rnd() - 0.5) * 140;
        g.quadraticCurveTo(x + (rnd() - 0.5) * 90, y + (rnd() - 0.5) * 90, nx, ny);
        x = nx;
        y = ny;
      }
      g.stroke();
    }
  });
}

/** A swallow-tailed championship banner: theme colours, a gold frame, a trophy and stars. */
function bannerTex(c0: string, c1: string): THREE.CanvasTexture {
  return canvasTex(
    256,
    512,
    (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, c0);
      grad.addColorStop(1, c1);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(w, 0);
      g.lineTo(w, h);
      g.lineTo(w / 2, h - 70);
      g.lineTo(0, h);
      g.closePath();
      g.fill();
      const gold = g.createLinearGradient(0, 0, w, h);
      gold.addColorStop(0, '#fff3b0');
      gold.addColorStop(0.5, '#ffc83d');
      gold.addColorStop(1, '#b8860b');
      g.strokeStyle = gold;
      g.lineWidth = 12;
      g.lineJoin = 'round';
      g.beginPath();
      g.moveTo(10, 8);
      g.lineTo(w - 10, 8);
      g.lineTo(w - 10, h - 14);
      g.lineTo(w / 2, h - 82);
      g.lineTo(10, h - 14);
      g.closePath();
      g.stroke();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(255,236,170,0.7)';
      g.strokeRect(26, 24, w - 52, h - 150);
      // the trophy
      const cx = w / 2,
        ty = 150;
      g.fillStyle = gold;
      g.beginPath();
      g.moveTo(cx - 62, ty - 50);
      g.lineTo(cx + 62, ty - 50);
      g.quadraticCurveTo(cx + 60, ty + 40, cx + 12, ty + 58);
      g.lineTo(cx + 12, ty + 92);
      g.lineTo(cx + 40, ty + 104);
      g.lineTo(cx + 40, ty + 122);
      g.lineTo(cx - 40, ty + 122);
      g.lineTo(cx - 40, ty + 104);
      g.lineTo(cx - 12, ty + 92);
      g.lineTo(cx - 12, ty + 58);
      g.quadraticCurveTo(cx - 60, ty + 40, cx - 62, ty - 50);
      g.fill();
      g.lineWidth = 11;
      g.strokeStyle = gold;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(
          cx + s * 66,
          ty - 10,
          26,
          s > 0 ? -Math.PI / 2 : Math.PI / 2,
          s > 0 ? Math.PI / 2 : (Math.PI * 3) / 2,
          s < 0,
        );
        g.stroke();
      }
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(cx - 40, ty - 40, 10, 60);
      // stars
      const star = (x: number, y: number, r: number): void => {
        g.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5,
            rr = i % 2 ? r * 0.45 : r;
          g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        }
        g.closePath();
        g.fill();
      };
      g.fillStyle = '#fff3b0';
      star(cx, 345, 30);
      star(cx - 62, 330, 16);
      star(cx + 62, 330, 16);
      star(cx - 80, 60, 10);
      star(cx + 80, 60, 10);
    },
    true,
  );
}

/** The banner bar's face: a gold band with VICTORY between stars. */
function barTex(): THREE.CanvasTexture {
  return canvasTex(
    1024,
    80,
    (g, w, h) => {
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#fff07a');
      grad.addColorStop(0.5, '#ffcf24');
      grad.addColorStop(1, '#e09a00');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.fillRect(0, 4, w, 5);
      g.fillStyle = '#c62828';
      g.font = 'italic 800 60px "Barlow Condensed", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.letterSpacing = '10px';
      g.fillText('★  VICTORY  ★', w / 2, h / 2 + 3);
    },
    true,
  );
}

/* ---------------- the stage and the celebration ---------------- */

export class Celebration {
  readonly group = new THREE.Group();
  /** Only shown during the ceremony. */
  private readonly extras = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];
  private readonly glow: GlowPoints;
  private readonly snow: GlowPoints | null;
  private readonly confetti: Flutter;
  private readonly ribbons: Flutter;
  private readonly balloons: THREE.Mesh[] = [];
  private readonly banners: THREE.Mesh[] = [];
  private readonly beams: THREE.Mesh[] = [];
  private crowdBody: THREE.InstancedMesh | null = null;
  private crowdHead: THREE.InstancedMesh | null = null;
  private crowd: { x: number; y: number; z: number; ry: number; ph: number; s: number }[] = [];
  private readonly look: Look;
  private readonly rng: Rng;
  private readonly rnd = (): number => this.rng.next();
  private readonly r = (a: number, b: number): number => a + this.rng.next() * (b - a);
  private on = false;
  private t = 0;
  private nextRocket = 0;
  private rockets: { x: number; y: number; z: number; vy: number; t: number; c: number; type: number }[] = [];
  /** Sparkler fountains: x, y, z in the podium frame. */
  private readonly fountains: [number, number, number][];
  /** Ground height in the podium frame (sampled on a grid round the stage). */
  private readonly groundAt: (x: number, z: number) => number;

  constructor(
    private readonly pod: Podium,
    terrain: TerrainInfo,
    th: Theme,
    M: Materials,
  ) {
    this.look = LOOKS[th.id];
    this.rng = new Rng(0xce1eb);
    const L = this.look;
    this.group.position.set(pod.x, pod.y, pod.z);
    this.group.rotation.y = pod.ry;
    const s = Math.sin(pod.ry),
      c = Math.cos(pod.ry);
    this.groundAt = (x, z) => terrain.terrainH(pod.x + c * x + s * z, pod.z - s * x + c * z) - pod.y;

    this.buildStage(M);
    this.buildDecor(M);
    if (L.crowd) this.buildCrowd(M);
    this.buildBeams();

    // effects
    this.glow = new GlowPoints(5200, true, this.rnd);
    this.extras.add(this.glow.points);
    this.snow = L.snow ? new GlowPoints(900, false, this.rnd) : null;
    if (this.snow) this.extras.add(this.snow.points);
    const foil = this.mat(
      new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide,
        roughness: 0.32,
        metalness: 0.55,
        envMapIntensity: 1.4,
      }),
    );
    if (M.car.envMap) foil.envMap = M.car.envMap;
    this.confetti = new Flutter(this.geo(new THREE.PlaneGeometry(0.2, 0.32)), foil, 1500, 1.7);
    const ribbonMat = this.mat(
      new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 0.4, metalness: 0.3 }),
    );
    this.ribbons = new Flutter(this.geo(ribbonGeo()), ribbonMat, 110, 1.1);
    this.confetti.mesh.castShadow = this.ribbons.mesh.castShadow = false;
    this.extras.add(this.confetti.mesh, this.ribbons.mesh);
    this.fountains = [
      [-2.45, 0.95, 4.45],
      [2.45, 0.95, 4.45],
      [8.0, 0.95, 4.45],
      [1.2, this.groundAt(1.2, 9.5), 9.5],
      [10.5, this.groundAt(10.5, 8.5), 8.5],
    ];
    this.extras.visible = false;
    this.group.add(this.extras);
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }
  private mat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }
  private tex<T extends THREE.Texture>(t: T): T {
    this.texs.push(t);
    return t;
  }

  /** The stage: base, white top with a neon edge, the three steps with glowing frames, poles and the bar. */
  private buildStage(M: Materials): void {
    const L = this.look;
    const body: Part[] = [],
      gloss: Part[] = [],
      chrome: Part[] = [],
      neon: Part[] = [],
      trim: Part[] = [],
      snow: Part[] = [],
      ice: Part[] = [],
      fabric: Part[] = [];
    body.push(P_(new RoundedBoxGeometry(17, 4, 9, 2, 0.18), L.base, 0, -1.3, 0));
    body.push(P_(new RoundedBoxGeometry(17.6, 0.4, 9.6, 2, 0.12), 0xd3d8e2, 0, 0.75, 0));
    // the neon edge under the white top, round the front and both sides
    neon.push(
      P_(box(17.3, 0.11, 0.11), L.neon, 0, 0.5, 4.56),
      P_(box(0.11, 0.11, 9.1), L.neon, 8.56, 0.5, 0),
      P_(box(0.11, 0.11, 9.1), L.neon, -8.56, 0.5, 0),
    );
    // the steps (separate meshes below); their glowing front frames and top edges belong to the stage
    const steps: [number, number, number, number][] = [
      [0, 2.6, 0xf0a818, 0xffd84a],
      [-5, 1.8, 0xc9d1dc, 0xdde8ff],
      [5, 1.2, 0xb0602a, 0xff8a30],
    ];
    const marble = this.tex(marbleTex(this.rnd));
    steps.forEach(([x, hgt, col, glowC], i) => {
      const m = this.mat(
        new THREE.MeshPhysicalMaterial({
          color: col,
          map: marble,
          metalness: 0.7,
          roughness: i === 1 ? 0.28 : 0.32,
          clearcoat: 0.7,
          clearcoatRoughness: 0.1,
          envMapIntensity: 1.1,
        }),
      );
      if (M.car.envMap) m.envMap = M.car.envMap;
      const mesh = new THREE.Mesh(this.geo(new RoundedBoxGeometry(4.6, hgt, 4.6, 3, 0.1)), m);
      mesh.position.set(x, 0.95 + hgt / 2, 0);
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      const y0 = 0.95,
        y1 = 0.95 + hgt,
        zf = 2.33,
        t = 0.08;
      trim.push(
        P_(box(4.5, t, t), glowC, x, y1 - 0.06, zf),
        P_(box(4.5, t, t), glowC, x, y0 + 0.06, zf),
        P_(box(t, hgt - 0.1, t), glowC, x - 2.27, (y0 + y1) / 2, zf),
        P_(box(t, hgt - 0.1, t), glowC, x + 2.27, (y0 + y1) / 2, zf),
        P_(box(t, t, 4.5), glowC, x - 2.27, y1 - 0.06, 0),
        P_(box(t, t, 4.5), glowC, x + 2.27, y1 - 0.06, 0),
      );
      if (L.snow) {
        // a snow cap and soft drifts on each step
        snow.push(P_(new RoundedBoxGeometry(4.75, 0.28, 4.75, 2, 0.12), 0xffffff, x, y1 + 0.1, 0));
        for (let k = 0; k < 5; k++)
          snow.push(
            P_(
              ico(0.5, 1),
              0xf7fbff,
              x + this.r(-1.8, 1.8),
              y1 + 0.18,
              this.r(-1.8, 1.8),
              0,
              this.r(0, 3),
              0,
              this.r(0.8, 1.5),
              0.35,
              this.r(0.8, 1.5),
            ),
          );
      }
    });
    if (L.snow) {
      // drifts on the stage and icicles under its front edge
      for (let k = 0; k < 14; k++) {
        const x = this.r(-8.4, 8.4),
          z = this.rnd() < 0.5 ? this.r(2.6, 4.5) : this.r(-4.5, -2.6);
        snow.push(P_(ico(0.6, 1), 0xf7fbff, x, 0.98, z, 0, this.r(0, 3), 0, this.r(1, 2.2), 0.3, this.r(0.8, 1.6)));
      }
      for (let x = -8.5; x <= 8.5; x += 0.38 + this.rnd() * 0.25) {
        const l = this.r(0.25, 0.85);
        ice.push(P_(cone(0.07, l, 5), 0xd8f3ff, x, 0.55 - l / 2, 4.82, Math.PI, 0, 0));
      }
    }
    // poles with gold finials and the banner bar
    for (const sd of [-1, 1]) {
      chrome.push(P_(cyl(0.3, 0.36, 11, 12), 0xf2f4f7, sd * 8.2, 5.5, -3.8));
      chrome.push(P_(ico(0.42, 2), 0xffc83d, sd * 8.2, 11.15, -3.8));
      // championship pennants
      fabric.push(
        P_(
          cone(0.9, 2.2, 3),
          sd > 0 ? 0xff3b5c : 0x2f8cff,
          sd * 8.2 - sd * 0.9,
          10.2,
          -3.8,
          0,
          0,
          (sd * Math.PI) / 2,
          1,
          1,
          0.2,
        ),
      );
      // the banners' cross-arms
      chrome.push(P_(cyl(0.07, 0.07, 1.8, 6), 0xf2f4f7, sd * 7.3, 8.6, -3.55, 0, 0, Math.PI / 2));
    }
    gloss.push(P_(new RoundedBoxGeometry(17, 1.2, 0.5, 2, 0.1), L.bar, 0, 9.4, -3.8));
    neon.push(P_(box(17, 0.08, 0.08), 0xfff4c0, 0, 9.98, -3.52), P_(box(17, 0.08, 0.08), 0xfff4c0, 0, 8.82, -3.52));
    const geo = this.geo(
      mergePbr([
        { parts: body, fin: F.satin },
        { parts: gloss, fin: F.gloss },
        { parts: chrome, fin: F.chrome },
        { parts: neon, fin: F.neon },
        { parts: trim, fin: F.trim },
        { parts: snow, fin: F.snow },
        { parts: ice, fin: F.ice },
        { parts: fabric, fin: F.fabric },
      ]),
    );
    const stage = new THREE.Mesh(geo, M.car);
    stage.castShadow = stage.receiveShadow = true;
    this.group.add(stage);
    // VICTORY on the bar's face
    const bt = this.tex(barTex());
    const face = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(16.4, 0.95)),
      this.mat(
        new THREE.MeshStandardMaterial({
          map: bt,
          emissive: 0xffffff,
          emissiveMap: bt,
          emissiveIntensity: 0.18,
          roughness: 0.35,
        }),
      ),
    );
    face.position.set(0, 9.4, -3.53);
    this.group.add(face);
  }

  /** Bunting, balloons and championship banners (shown during the ceremony). */
  private buildDecor(M: Materials): void {
    const flags: Part[] = [],
      cords: Part[] = [];
    let ci = 0;
    const tri = new THREE.BufferGeometry();
    tri.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-0.36, 0, 0, 0.36, 0, 0, 0, -0.78, 0, 0.36, 0, 0, -0.36, 0, 0, 0, -0.78, 0], 3),
    );
    this.geos.push(tri);
    const string = (a: THREE.Vector3, b: THREE.Vector3, sag: number, spacing = 0.82): void => {
      const n = Math.max(2, Math.round(a.distanceTo(b) / spacing));
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -sag * 4 * t * (1 - t), 0)));
      }
      for (let i = 0; i < n; i++) {
        const p = pts[i]!,
          q = pts[i + 1]!,
          d = new THREE.Vector3().subVectors(q, p),
          len = d.length(),
          mid = new THREE.Vector3().addVectors(p, q).multiplyScalar(0.5);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
        const e = new THREE.Euler().setFromQuaternion(quat);
        cords.push(P_(cyl(0.025, 0.025, len, 4), 0x2b2d42, mid.x, mid.y, mid.z, e.x, e.y, e.z));
        // a flag hanging from the cord, facing across it
        const yaw = Math.atan2(-d.z, d.x);
        flags.push(
          P_(
            tri,
            BUNTING[ci++ % BUNTING.length]!,
            mid.x,
            mid.y - 0.02,
            mid.z,
            0,
            yaw,
            Math.atan2(d.y, Math.hypot(d.x, d.z)) * 0.6,
          ),
        );
      }
    };
    const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
    // along the bar in scallops, and from the pole tops out to the sides and to the front
    for (let k = 0; k < 4; k++) string(V(-8 + k * 4, 8.8, -3.4), V(-4 + k * 4, 8.8, -3.4), 0.45, 0.62);
    for (const sd of [-1, 1]) {
      string(V(sd * 8.2, 10.7, -3.8), V(sd * 18, this.groundAt(sd * 18, 0.5) + 1.6, 0.5), 1.2);
      string(V(sd * 8.2, 10.4, -3.8), V(sd * 11.5, this.groundAt(sd * 11.5, 7) + 1.4, 7), 1.0);
    }
    const bunting = new THREE.Mesh(
      this.geo(
        mergePbr([
          { parts: flags, fin: F.fabric },
          { parts: cords, fin: F.satin },
        ]),
      ),
      M.car,
    );
    bunting.castShadow = true;
    this.extras.add(bunting);

    // balloon clusters on the pole tops (each sways about its tie point)
    for (const sd of [-1, 1]) {
      const parts: Part[] = [],
        str: Part[] = [];
      const offs: [number, number, number][] = [
        [0, 2.1, 0],
        [-0.85, 1.6, 0.3],
        [0.85, 1.7, -0.2],
        [0.15, 1.3, 0.9],
        [-0.3, 2.9, -0.3],
      ];
      offs.forEach(([x, y, z], i) => {
        const col = BUNTING[(i * 3 + (sd > 0 ? 1 : 0)) % BUNTING.length]!;
        parts.push(P_(ico(0.62, 3), col, x, y, z, 0, 0, 0, 1, 1.22, 1));
        parts.push(P_(cone(0.12, 0.18, 6), col, x, y - 0.8, z));
        const len = Math.hypot(x, y - 0.9, z);
        str.push(
          P_(
            cyl(0.012, 0.012, len, 3),
            0xeeeeee,
            x / 2,
            (y - 0.9) / 2,
            z / 2,
            Math.atan2(z, y - 0.9),
            0,
            -Math.atan2(x, y - 0.9),
          ),
        );
      });
      const mesh = new THREE.Mesh(
        this.geo(
          mergePbr([
            { parts, fin: F.latex },
            { parts: str, fin: F.satin },
          ]),
        ),
        M.car,
      );
      mesh.position.set(sd * 8.2, 11.4, -3.8);
      mesh.userData.sd = sd;
      mesh.castShadow = true;
      this.extras.add(mesh);
      this.balloons.push(mesh);
    }

    // championship banners hanging from the cross-arms
    const bt = this.tex(bannerTex(this.look.banner[0], this.look.banner[1]));
    const bm = this.mat(
      new THREE.MeshStandardMaterial({
        map: bt,
        alphaTest: 0.5,
        side: THREE.DoubleSide,
        roughness: 0.65,
        emissive: 0xffffff,
        emissiveMap: bt,
        emissiveIntensity: 0.12,
      }),
    );
    const bg = this.geo(new THREE.PlaneGeometry(2.3, 4.6).translate(0, -2.3, 0));
    for (const sd of [-1, 1]) {
      const m = new THREE.Mesh(bg, bm);
      m.position.set(sd * 7.1, 8.55, -3.5);
      m.castShadow = true;
      this.extras.add(m);
      this.banners.push(m);
    }
  }

  /** Sunny Meadows: a little stand of cheering animal fans and a stadium light tower, behind and left. */
  private buildCrowd(M: Materials): void {
    const stand: Part[] = [],
      lamps: Part[] = [];
    const sx = -1,
      sz = -10.5,
      sry = 0.08;
    const gy = this.groundAt(sx, sz);
    const sn = Math.sin(sry),
      cs = Math.cos(sry);
    const toLocal = (x: number, z: number): [number, number] => [sx + cs * x + sn * z, sz - sn * x + cs * z];
    // two tiers, a front barrier with a red banner
    for (let t = 0; t < 2; t++) {
      const [x, z] = toLocal(0, -t * 1.6);
      stand.push(P_(box(15, 0.6 + t * 0.9, 1.6), 0xb0bec5, x, gy + (0.3 + t * 0.45), z, 0, sry, 0));
    }
    {
      const [x, z] = toLocal(0, 1.25);
      stand.push(P_(box(15.4, 1.0, 0.18), 0xe53935, x, gy + 0.5, z, 0, sry, 0));
      stand.push(P_(box(15.4, 0.12, 0.2), 0xffffff, x, gy + 1.02, z, 0, sry, 0));
    }
    // the light tower
    const lx = -18.2,
      lz = -12.5,
      ly = this.groundAt(lx, lz);
    stand.push(P_(cyl(0.18, 0.28, 12, 8), 0x90a4ae, lx, ly + 6, lz));
    stand.push(P_(box(3.4, 2.2, 0.3), 0x37474f, lx, ly + 12.4, lz, 0, 0.5, 0));
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 4; b++) {
        const ox = -1.2 + b * 0.8,
          oy = -0.65 + a * 0.65;
        lamps.push(
          P_(
            box(0.55, 0.45, 0.1),
            0xfffbe8,
            lx + Math.cos(0.5) * ox + Math.sin(0.5) * 0.18,
            ly + 12.4 + oy,
            lz - Math.sin(0.5) * ox + Math.cos(0.5) * 0.18,
            0,
            0.5,
            0,
          ),
        );
      }
    const mesh = new THREE.Mesh(
      this.geo(
        mergePbr([
          { parts: stand, fin: F.satin },
          { parts: lamps, fin: [0.3, 0, 1, 0.9] },
        ]),
      ),
      M.car,
    );
    mesh.castShadow = mesh.receiveShadow = true;
    this.extras.add(mesh);
    // fans: a body with raised arms (shirt colour per fan) and an animal head (fur colour per fan)
    const bodyGeo = this.geo(
      mergePbr([
        {
          parts: [
            P_(cyl(0.3, 0.36, 0.85, 10), 0xffffff, 0, 0.45, 0),
            P_(cyl(0.08, 0.08, 0.6, 6), 0xffffff, 0.36, 1.05, 0, 0, 0, -0.5),
            P_(cyl(0.08, 0.08, 0.6, 6), 0xffffff, -0.36, 1.05, 0, 0, 0, 0.5),
          ],
          fin: [0.5, 0, 0.3, 0],
        },
      ]),
    );
    const headGeo = this.geo(
      mergePbr([
        {
          parts: [
            P_(ico(0.33, 2), 0xffffff, 0, 1.18, 0),
            P_(ico(0.12, 1), 0xffffff, 0.22, 1.46, 0),
            P_(ico(0.12, 1), 0xffffff, -0.22, 1.46, 0),
            P_(ico(0.07, 1), 0x222222, 0.11, 1.22, 0.29),
            P_(ico(0.07, 1), 0x222222, -0.11, 1.22, 0.29),
          ],
          fin: [0.55, 0, 0.4, 0],
        },
      ]),
    );
    const shirts = [0xff3b5c, 0x2f8cff, 0xffd23a, 0x3ddc84, 0xa259ff, 0xff8a3d, 0xffffff];
    const furs = [0xa1887f, 0xfff3e0, 0xffb74d, 0x9ccc65, 0xbdbdbd, 0x8d6e63, 0xf8bbd0];
    const n = 26;
    this.crowdBody = new THREE.InstancedMesh(bodyGeo, M.car, n);
    this.crowdHead = new THREE.InstancedMesh(headGeo, M.car, n);
    for (let i = 0; i < n; i++) {
      const row = i < 13 ? 0 : 1,
        col = i % 13;
      const [x, z] = toLocal(-6.6 + col * 1.1 + (row ? 0.5 : 0) + this.r(-0.15, 0.15), -row * 1.6 - 0.1);
      this.crowd.push({
        x,
        y: gy + 0.6 + row * 0.9,
        z,
        ry: sry + this.r(-0.3, 0.3),
        ph: this.r(0, 6.28),
        s: this.r(1.15, 1.4),
      });
      this.crowdBody.setColorAt(i, _c.setHex(shirts[i % shirts.length]!));
      this.crowdHead.setColorAt(i, _c.setHex(furs[(i * 3) % furs.length]!));
    }
    this.crowdBody.castShadow = this.crowdHead.castShadow = true;
    // instances move every frame: skip the (stale) instance bounds test
    this.crowdBody.frustumCulled = this.crowdHead.frustumCulled = false;
    this.extras.add(this.crowdBody, this.crowdHead);
  }

  /** Searchlights sweeping the sky behind the stage. */
  private buildBeams(): void {
    const g = this.geo(new THREE.CylinderGeometry(5.5, 0.35, 95, 24, 1, true).translate(0, 47.5, 0));
    const m = this.mat(
      new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(this.look.beam) }, uI: { value: 0.14 } },
        vertexShader: /* glsl */ `
          varying float vH; varying vec3 vN; varying vec3 vV;
          void main() {
            vH = position.y / 95.0;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vN = normalize(mat3(modelMatrix) * normal);
            vV = normalize(cameraPosition - wp.xyz);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uI;
          varying float vH; varying vec3 vN; varying vec3 vV;
          void main() {
            float edge = pow(abs(dot(normalize(vN), normalize(vV))), 2.0);
            float a = uI * edge * pow(1.0 - vH, 1.6) * smoothstep(0.02, 0.2, vH);
            gl_FragColor = vec4(uColor * a, 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    for (const [x, z, ph] of [
      [-22, -34, 0],
      [24, -36, 2.1],
      [4, -42, 4.2],
    ] as const) {
      const b = new THREE.Mesh(g, m);
      b.position.set(x, this.groundAt(x, z), z);
      b.userData.ph = ph;
      b.renderOrder = 2;
      this.extras.add(b);
      this.beams.push(b);
    }
  }

  /** Start or stop the ceremony. */
  setActive(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    this.extras.visible = on;
    this.t = 0;
    this.rockets = [];
    this.nextRocket = 0.3;
    this.glow.clear();
    this.snow?.clear();
    this.confetti.clear();
    this.ribbons.clear();
    if (on) {
      // confetti cannons from both poles
      for (const sd of [-1, 1])
        for (let i = 0; i < 220; i++)
          this.confetti.emit(
            sd * 8.2,
            10.5,
            -3.6,
            -sd * this.r(2, 9),
            this.r(4, 12),
            this.r(-1, 7),
            CONFETTI[i % CONFETTI.length]!,
            0.96,
            this.rnd,
          );
      // and a sky already full: some confetti, ribbons and falling snow mid-air
      for (let i = 0; i < 380; i++) this.dropConfetti(this.r(1, 15));
      for (let i = 0; i < 40; i++) this.dropRibbon(this.r(1, 14));
      if (this.snow) for (let i = 0; i < 500; i++) this.dropSnow(this.r(0, 14), this.r(2, 9));
    }
  }

  private floorAt(x: number, z: number): number {
    if (Math.abs(x) < 8.7 && Math.abs(z) < 4.7) {
      for (const [sx, h] of [
        [0, 2.6],
        [-5, 1.8],
        [5, 1.2],
      ] as const)
        if (Math.abs(x - sx) < 2.3 && Math.abs(z) < 2.3) return 0.97 + h + (this.look.snow ? 0.24 : 0);
      return 0.97;
    }
    return this.groundAt(x, z) + 0.04;
  }

  private dropConfetti(y = this.r(13, 17)): void {
    const x = this.r(-15, 21),
      z = this.r(-7, 10);
    this.confetti.emit(
      x,
      y,
      z,
      this.r(-0.5, 0.5),
      this.r(-1, 0),
      this.r(-0.5, 0.5),
      CONFETTI[Math.floor(this.rnd() * CONFETTI.length)]!,
      this.floorAt(x, z),
      this.rnd,
    );
  }

  private dropRibbon(y = this.r(14, 18)): void {
    const x = this.r(-14, 20),
      z = this.r(-6, 8);
    this.ribbons.emit(x, y, z, 0, -0.5, 0, CONFETTI[Math.floor(this.rnd() * 7)]!, this.floorAt(x, z) + 0.05, this.rnd);
  }

  private dropSnow(y: number, life: number): void {
    this.snow!.emit(
      this.r(-18, 24),
      y,
      this.r(-12, 12),
      this.r(-0.4, 0.4),
      this.r(-1.4, -0.8),
      this.r(-0.3, 0.3),
      0xffffff,
      life,
      this.r(0.14, 0.3),
      0,
      0,
      1,
      2,
    );
  }

  /** Burst a firework shell at (x, y, z): 0 peony, 1 gold willow, 2 ring, 3 crackling chrysanthemum. */
  private burst(x: number, y: number, z: number, col: number, type: number): void {
    const n = type === 2 ? 70 : type === 1 ? 80 : 110;
    const col2 = this.look.fireworks[Math.floor(this.rnd() * this.look.fireworks.length)]!;
    const ax = this.r(0, Math.PI),
      ca = Math.cos(ax),
      sa = Math.sin(ax);
    for (let i = 0; i < n; i++) {
      let dx: number, dy: number, dz: number;
      if (type === 2) {
        const a = (i / n) * Math.PI * 2;
        dx = Math.cos(a);
        dy = Math.sin(a) * ca;
        dz = Math.sin(a) * sa;
      } else {
        const u = this.r(-1, 1),
          a = this.r(0, Math.PI * 2),
          q = Math.sqrt(1 - u * u);
        dx = q * Math.cos(a);
        dy = u;
        dz = q * Math.sin(a);
      }
      const sp = type === 1 ? this.r(9, 11) : type === 2 ? 13 : this.r(12, 15);
      const c = type === 1 ? 0xffc864 : i % 3 === 0 ? col2 : col;
      this.glow.emit(
        x,
        y,
        z,
        dx * sp,
        dy * sp,
        dz * sp,
        c,
        type === 1 ? this.r(2.4, 3.0) : this.r(1.5, 2.1),
        type === 1 ? 1.1 : 1.6,
        type === 1 ? 4.5 : 3,
        type === 1 ? 1.6 : 1.25,
        type === 1 ? 3.4 : 4.6,
        0,
        type === 3 ? 1 : 0,
        type === 1 || (type === 0 && i % 4 === 0),
      );
    }
    // the flash
    this.glow.emit(x, y, z, 0, 0, 0, 0xffffff, 0.25, 9, 0, 0, 2.2);
  }

  update(dt: number): void {
    if (!this.on || dt <= 0) return;
    this.t += dt;
    const t = this.t;
    // fireworks: rockets climb with a spark trail, then burst
    this.nextRocket -= dt;
    if (this.nextRocket <= 0) {
      this.nextRocket = this.r(0.35, 0.9);
      const FW = this.look.fireworks;
      this.rockets.push({
        x: this.r(-34, 22),
        y: this.r(-2, 2),
        z: this.r(-60, -36),
        vy: this.r(19, 24),
        t: this.r(0.8, 1.05),
        c: FW[Math.floor(this.rnd() * FW.length)]!,
        type: Math.floor(this.rnd() * 4),
      });
    }
    this.rockets = this.rockets.filter((r) => {
      r.t -= dt;
      r.vy -= 6 * dt;
      r.y += r.vy * dt;
      this.glow.emit(
        r.x + this.r(-0.1, 0.1),
        r.y,
        r.z,
        this.r(-0.4, 0.4),
        -2,
        this.r(-0.4, 0.4),
        0xffd27a,
        0.5,
        0.55,
        2,
        0.5,
        2.2,
      );
      if (r.t > 0) return true;
      this.burst(r.x, r.y, r.z, r.c, r.type);
      return false;
    });
    // sparkler fountains
    for (const [fx, fy, fz] of this.fountains)
      for (let k = 0; k < Math.round(160 * dt); k++) {
        const a = this.r(0, Math.PI * 2),
          sp = this.r(0.4, 2.6);
        this.glow.emit(
          fx + this.r(-0.1, 0.1),
          fy + 0.15,
          fz + this.r(-0.1, 0.1),
          Math.cos(a) * sp,
          this.r(5.5, 9),
          Math.sin(a) * sp,
          SPARK[k % 3]!,
          this.r(0.5, 1.0),
          this.r(0.14, 0.24),
          9,
          0.4,
          4.5,
          0,
          1,
        );
      }
    // twinkling stars round the bar and the steps
    for (let k = 0; k < Math.round(30 * dt + this.rnd() * 0.6); k++)
      this.glow.emit(
        this.r(-10, 10),
        this.r(3.5, 12.5),
        this.r(-4, 2.5),
        0,
        this.r(-0.2, 0.3),
        0,
        this.rnd() < 0.6 ? 0xfff1b0 : 0xffffff,
        this.r(0.8, 1.5),
        this.r(0.6, 1.1),
        0,
        0,
        3.2,
        1,
      );
    // confetti, ribbons and snow keep falling
    for (let k = 0; k < Math.round(110 * dt + this.rnd() * 0.5); k++) this.dropConfetti();
    if (this.rnd() < 7 * dt) this.dropRibbon();
    if (this.snow)
      for (let k = 0; k < Math.round(60 * dt + this.rnd() * 0.5); k++) this.dropSnow(this.r(14, 18), this.r(8, 12));
    this.glow.update(dt);
    this.snow?.update(dt);
    this.confetti.update(dt);
    this.ribbons.update(dt);
    // gentle motion: balloons sway, banners wave, searchlights sweep, the fans cheer
    for (const b of this.balloons) {
      const sd = b.userData.sd as number;
      b.rotation.set(Math.sin(t * 0.9 + sd) * 0.12, Math.sin(t * 0.4) * 0.3, Math.sin(t * 1.1 + sd * 2) * 0.14);
    }
    this.banners.forEach((b, i) =>
      b.rotation.set(Math.sin(t * 1.3 + i) * 0.08, Math.sin(t * 0.8 + i * 2) * 0.22, Math.sin(t * 1.7 + i) * 0.03),
    );
    for (const b of this.beams) {
      const ph = b.userData.ph as number;
      b.rotation.set(-0.32 + Math.sin(t * 0.35 + ph) * 0.12, 0, Math.sin(t * 0.5 + ph) * 0.55);
    }
    if (this.crowdBody && this.crowdHead) {
      this.crowd.forEach((f, i) => {
        const hop = Math.max(0, Math.sin(t * 7 + f.ph)) * 0.32;
        _o.position.set(f.x, f.y + hop, f.z);
        _o.rotation.set(0, f.ry + Math.sin(t * 2 + f.ph) * 0.2, Math.sin(t * 5 + f.ph) * 0.08);
        _o.scale.setScalar(f.s);
        _o.updateMatrix();
        this.crowdBody!.setMatrixAt(i, _o.matrix);
        this.crowdHead!.setMatrixAt(i, _o.matrix);
      });
      this.crowdBody.instanceMatrix.needsUpdate = this.crowdHead.instanceMatrix.needsUpdate = true;
    }
  }

  dispose(): void {
    this.glow.dispose();
    this.snow?.dispose();
    this.confetti.mesh.dispose();
    this.ribbons.mesh.dispose();
    this.crowdBody?.dispose();
    this.crowdHead?.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
  }
}
