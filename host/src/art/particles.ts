/**
 * D45 soft particles: camera-facing, soft-edged sprites (THREE.Points with a custom shader), so smoke, dust,
 * spray and kicked-up snow look like soft volumes instead of solid shapes. Works in every viewport at once
 * (points always face the camera that draws them).
 *
 * SoftPool keeps the old Pool's emit() signature. Ambient adds the air: drifting leaves and pollen, desert dust,
 * mist motes, or falling snow, scattered along the track and animated entirely in the vertex shader.
 */
import * as THREE from 'three';
import { Rng, type Track } from '@tk/shared';

const SOFT_VERT = /* glsl */ `
  attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
  varying float vAlpha; varying vec3 vColor;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.5, -mv.z);
    vAlpha = aAlpha; vColor = aColor;
  }`;
const SOFT_FRAG = /* glsl */ `
  varying float vAlpha; varying vec3 vColor;
  uniform vec3 uLight;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    // soft puff: a gaussian-ish falloff with a lighter top (lit from above)
    float a = pow(1.0 - d, 1.6) * vAlpha;
    float shade = 0.82 + 0.25 * (0.5 - p.y);
    gl_FragColor = vec4(vColor * uLight * shade, a);
  }`;

export class SoftPool {
  readonly points: THREE.Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly v: Float32Array;
  private readonly life: Float32Array;
  private readonly ml: Float32Array;
  private readonly sz: Float32Array;
  private readonly g: Float32Array;
  private readonly fl: Float32Array;
  private readonly a0: Float32Array;
  private head = 0;
  private readonly geo = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  private readonly c = new THREE.Color();

  constructor(readonly max: number) {
    this.pos = new Float32Array(max * 3).fill(-9999);
    this.col = new Float32Array(max * 3).fill(1);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ml = new Float32Array(max);
    this.sz = new Float32Array(max);
    this.g = new Float32Array(max);
    this.fl = new Float32Array(max);
    this.a0 = new Float32Array(max);
    const dyn = (arr: Float32Array, n: number): THREE.BufferAttribute =>
      new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', dyn(this.pos, 3));
    this.geo.setAttribute('aColor', dyn(this.col, 3));
    this.geo.setAttribute('aSize', dyn(this.size, 1));
    this.geo.setAttribute('aAlpha', dyn(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      vertexShader: SOFT_VERT,
      fragmentShader: SOFT_FRAG,
      uniforms: { uScale: { value: 620 }, uLight: { value: new THREE.Color(1, 1, 1) } },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  /** Same signature as the instanced Pool; `alpha` sets the starting opacity. */
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
    floor: number,
    _mode = 1,
    alpha = 0.5,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.pos.set([x, y, z], i * 3);
    this.v.set([vx, vy, vz], i * 3);
    this.c.setHex(hex);
    this.col.set([this.c.r, this.c.g, this.c.b], i * 3);
    this.life[i] = this.ml[i] = life;
    this.sz[i] = size * 2.4; // the old pool's size was an icosahedron radius; this is a soft sprite's width
    this.g[i] = grav;
    this.fl[i] = floor;
    this.a0[i] = alpha;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        if (this.alpha[i]) this.alpha[i] = 0;
        continue;
      }
      this.life[i]! -= dt;
      const b = i * 3,
        drag = Math.exp(-2.2 * dt);
      this.v[b]! *= drag;
      this.v[b + 2]! *= drag;
      this.v[b + 1]! -= this.g[i]! * dt;
      this.pos[b]! += this.v[b]! * dt;
      this.pos[b + 1] = Math.max(this.fl[i]!, this.pos[b + 1]! + this.v[b + 1]! * dt);
      this.pos[b + 2]! += this.v[b + 2]! * dt;
      const t = 1 - Math.max(0, this.life[i]!) / this.ml[i]!;
      // grows as it spreads, fades in quickly and out slowly
      this.size[i] = this.sz[i]! * (0.6 + t * 1.8);
      this.alpha[i] = this.a0[i]! * Math.min(1, t * 8) * (1 - t) * (1 - t);
    }
    for (const n of ['position', 'aSize', 'aAlpha', 'aColor']) this.geo.attributes[n]!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.geo.attributes.aAlpha!.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}

/* ---------------- ambient air particles ---------------- */

export type AmbientKind = 'leaves' | 'dust' | 'snow' | 'mist';

const AMB_VERT = /* glsl */ `
  attribute vec4 aSeed; attribute vec3 aColor;
  uniform float uTime; uniform float uScale; uniform vec3 uWind; uniform float uFall; uniform float uSize;
  varying vec3 vColor; varying float vA;
  void main() {
    float t = uTime * (0.6 + aSeed.w * 0.8);
    vec3 p = position;
    // drift with the wind inside a 40 m cell, falling (snow, leaves) and swaying
    p.xz += uWind.xz * t;
    p.x += sin(t * 1.3 + aSeed.x * 6.28) * 1.2;
    p.z += cos(t * 1.1 + aSeed.y * 6.28) * 1.2;
    p.xz = position.xz + mod(p.xz - position.xz + 20.0, 40.0) - 20.0;
    float h = 18.0;
    p.y = position.y + mod(aSeed.z * h - t * uFall + sin(t + aSeed.x * 9.0) * 0.6, h);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float dist = -mv.z;
    gl_PointSize = uSize * (0.6 + aSeed.w * 0.8) * uScale / max(0.5, dist);
    vA = smoothstep(150.0, 40.0, dist) * smoothstep(0.5, 3.0, dist);
    vColor = aColor;
  }`;
const AMB_FRAG = /* glsl */ `
  varying vec3 vColor; varying float vA;
  uniform float uSoft; uniform vec3 uLight;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d = length(p) * 2.0;
    if (d > 1.0) discard;
    float a = mix(step(d, 0.75), pow(1.0 - d, 1.4), uSoft) * vA;
    gl_FragColor = vec4(vColor * uLight, a);
  }`;

export class Ambient {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo = new THREE.BufferGeometry();

  constructor(T: Track, kind: AmbientKind, count: number, light: THREE.Color) {
    const rng = new Rng(0xa1b);
    const pos = new Float32Array(count * 3),
      seed = new Float32Array(count * 4),
      col = new Float32Array(count * 3);
    const pal: Record<AmbientKind, number[]> = {
      leaves: [0x9ccc65, 0xd4e157, 0xffca28, 0xfff3c4],
      dust: [0xe8c9a0, 0xd7b089, 0xf3dcc0],
      snow: [0xffffff, 0xf2f6ff],
      mist: [0xffffff, 0xf0fff4, 0xfff6d5],
    };
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const s = Math.floor(rng.next() * T.N),
        lat = (rng.next() * 2 - 1) * (T.HW[s]! + 30);
      pos[i * 3] = T.CX[s]! + T.RX[s]! * lat;
      pos[i * 3 + 1] = T.H[s]! + 0.3;
      pos[i * 3 + 2] = T.CZ[s]! + T.RZ[s]! * lat;
      seed.set([rng.next(), rng.next(), rng.next(), rng.next()], i * 4);
      const p = pal[kind];
      c.setHex(p[i % p.length]!);
      col.set([c.r, c.g, c.b], i * 3);
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    const cfg: Record<AmbientKind, { wind: [number, number, number]; fall: number; size: number; soft: number }> = {
      leaves: { wind: [1.4, 0, 0.8], fall: 0.9, size: 0.18, soft: 0.2 },
      dust: { wind: [3.5, 0, 1.2], fall: -0.15, size: 0.55, soft: 1 },
      snow: { wind: [0.8, 0, 0.5], fall: 1.6, size: 0.14, soft: 0.6 },
      mist: { wind: [0.6, 0, 0.3], fall: -0.1, size: 0.1, soft: 0.8 },
    };
    const k = cfg[kind];
    this.mat = new THREE.ShaderMaterial({
      vertexShader: AMB_VERT,
      fragmentShader: AMB_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uScale: { value: 620 },
        uWind: { value: new THREE.Vector3(...k.wind) },
        uFall: { value: k.fall },
        uSize: { value: k.size },
        uSoft: { value: k.soft },
        uLight: { value: light },
      },
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
  }

  update(time: number): void {
    this.mat.uniforms.uTime!.value = time;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
