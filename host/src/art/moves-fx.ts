/**
 * D74 signature moves on the big screen: Mochi's Mirage decoy (a hologram of her car where she was), Luna's Night
 * Eyes (the best line glowing on the road ahead of her), and the running effects: Pip's icy slide trail and Zed's
 * overclock sparks. One-off bursts (a move fired, a shove, a decoy popping, a dodge) are in Effects.onEvent.
 */
import * as THREE from 'three';
import { posOnTrack, type GameState } from '@tk/shared';
import { holoShell } from './holo';
import type { Effects } from './effects';
import type { KartView } from './kart';

const LINE_AHEAD = 130;
const SEG = 52;

export class MoveFx {
  readonly group = new THREE.Group();
  private readonly decoys = new Map<number, THREE.Object3D>();
  private readonly holo = holoShell(0xc9a6ff, 2.4, 0.4, 0.1, 0.6);
  private readonly line: THREE.Mesh;
  private readonly lineMat: THREE.ShaderMaterial;
  private trailT = 0;

  constructor(private readonly s: Readonly<GameState>) {
    // the stretch of racing line ahead of Luna, rebuilt each frame (SEG + 1 cross-sections), fading out ahead
    const n = SEG + 1;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 2 * 3), 3));
    // the distance ahead rides in the standard uv attribute (x), which every material binds
    const d = new Float32Array(n * 2 * 2);
    for (let i = 0; i < n; i++) d[i * 4] = d[i * 4 + 2] = (i / SEG) * LINE_AHEAD;
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(d, 2));
    const idx: number[] = [];
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: { uOn: { value: 0 }, uT: { value: 0 } },
      vertexShader: /* glsl */ `
        varying float vD;
        void main() { vD = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOn; uniform float uT;
        varying float vD;
        void main() {
          // chevron-like dashes running forward, from beyond the car's nose to a soft end
          float dash = 0.35 + 0.65 * step(0.45, fract(vD / 5.0 - uT * 1.5));
          float a = uOn * dash * smoothstep(10.0, 18.0, vD) * (1.0 - smoothstep(${(LINE_AHEAD * 0.6).toFixed(1)}, ${LINE_AHEAD.toFixed(1)}, vD));
          gl_FragColor = vec4(vec3(0.3, 0.88, 1.0), a * 0.95);
        }`,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      // seen through crests and over the karts ahead: it is a vision, not paint
      depthTest: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.line = new THREE.Mesh(geo, this.lineMat);
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = 2;
    this.group.add(this.line);
  }

  /** Lay the line ribbon on the racing line from the kart forward. */
  private layLine(idx: number, frac: number): void {
    const T = this.s.track,
      pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const p = { x: 0, y: 0, z: 0 };
    for (let i = 0; i <= SEG; i++) {
      const at = idx + frac + ((i / SEG) * LINE_AHEAD) / T.DS;
      const j = Math.floor(at) % T.N;
      const lat = T.RLINE[j]!;
      for (const [c, sd] of [
        [0, -0.8],
        [1, 0.8],
      ] as const) {
        posOnTrack(T, at, lat + sd, p);
        pos.setXYZ(i * 2 + c, p.x, p.y + 0.22, p.z);
      }
    }
    pos.needsUpdate = true;
  }

  update(dt: number, views: readonly KartView[], fx: Effects | null): void {
    const s = this.s,
      T = s.track;
    // Mirage decoys
    for (const k of s.karts) {
      const d = k.decoy;
      let m = this.decoys.get(k.id);
      if (d && !m) {
        const v = views[k.id];
        if (!v) continue;
        m = v.body.clone(true);
        m.traverse((o) => {
          const mesh = o as THREE.Mesh;
          if (mesh.isMesh) mesh.material = this.holo;
          (o as THREE.Mesh).castShadow = false;
        });
        m.scale.copy(v.root.scale);
        this.decoys.set(k.id, m);
        this.group.add(m);
      }
      if (m && !d) {
        this.group.remove(m);
        this.decoys.delete(k.id);
      } else if (m && d) {
        m.position.set(d.x, d.y + 0.05 + Math.sin(s.time * 6) * 0.04, d.z);
        m.rotation.set(0, T.ANG[d.idx]!, 0);
        m.visible = Math.sin(s.time * 30) > -0.85;
      }
    }
    // Night Eyes: the line ahead of the kart using it
    const luna = s.karts.find((k) => k.eyesT > 0);
    const want = luna ? Math.min(1, luna.eyesT / 0.6) : 0;
    const u = this.lineMat.uniforms;
    u.uOn!.value += (want - (u.uOn!.value as number)) * Math.min(1, dt * 8);
    if (luna) this.layLine(luna.idx, luna.frac);
    u.uT!.value = s.time;
    this.line.visible = (u.uOn!.value as number) > 0.01;
    // icy slide trail and overclock sparks
    this.trailT -= dt;
    if (fx && this.trailT <= 0) {
      this.trailT = 0.05;
      for (const k of s.karts) {
        const fx0 = Math.sin(k.h),
          fz0 = Math.cos(k.h);
        if (k.slideT > 0) fx.burst(k.x - fx0 * 2.6, k.y + 0.25, k.z - fz0 * 2.6, [0xb3ecff, 0xffffff], 3, 1.5, 1.1);
        if (k.overT > 0) fx.burst(k.x, k.y + 0.9, k.z, [0xffb74d, 0xe040fb, 0xffffff], 2, 3, 0.8);
      }
    }
  }

  dispose(): void {
    this.line.geometry.dispose();
    this.lineMat.dispose();
    this.holo.dispose();
  }
}
