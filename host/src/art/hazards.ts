/**
 * D73 living tracks on the big screen: the sheep (walking, wobbling when bumped), the rockfall (pebbles in the
 * warning, then boulders dropping onto one half of the road, gone when it clears), the giant snowball (teetering on
 * the slope, then rolling across with a snow trail) and the squall (dark clouds gathering, then rain over its
 * stretch). Positions come from the sim's hazard state every frame.
 */
import * as THREE from 'three';
import {
  BALL_R,
  ROCKS_HALF,
  posOnTrack,
  puddlesFor,
  type GameState,
  type Hazard,
  type Track,
  type Weather,
} from '@tk/shared';
import { Ambient } from './particles';
import type { Effects } from './effects';
import type { Theme } from './palette';
import { puddleMesh } from './weather';

const tmp = { x: 0, y: 0, z: 0 };

function sheepModel(wool: THREE.Material, dark: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 1), wool);
  body.scale.set(1, 0.82, 1.3);
  body.position.y = 1.05;
  body.castShadow = true;
  g.add(body);
  for (const [x, y, z, r] of [
    [0.35, 1.5, 0.4, 0.42],
    [-0.35, 1.45, -0.3, 0.45],
    [0, 1.55, -0.6, 0.4],
  ] as const) {
    const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), wool);
    puff.position.set(x, y, z);
    g.add(puff);
  }
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.48, 0.55), dark);
  head.position.set(0, 1.35, 1.1);
  g.add(head);
  for (const sd of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.08, 0.14), dark);
    ear.position.set(sd * 0.3, 1.5, 1.0);
    g.add(ear);
  }
  for (const [x, z] of [
    [0.38, 0.6],
    [-0.38, 0.6],
    [0.38, -0.6],
    [-0.38, -0.6],
  ] as const) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.7, 6), dark);
    leg.position.set(x, 0.35, z);
    leg.name = 'leg';
    g.add(leg);
  }
  return g;
}

export class HazardFx {
  readonly group = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  private readonly geos = new Set<THREE.BufferGeometry>();
  private sheep: THREE.Group[] = [];
  private readonly rocks: { mesh: THREE.Mesh; lat: number; along: number; delay: number }[] = [];
  private ball: THREE.Mesh | null = null;
  private ballRoll = 0;
  private clouds: THREE.Group | null = null;
  private rain: Ambient | null = null;
  private puddles: THREE.Mesh | null = null;
  private pebbleT = 0;
  private trailT = 0;

  constructor(
    private readonly T: Track,
    hazards: readonly Hazard[],
    th: Theme,
    light: THREE.Color,
    weather: Weather,
    env: THREE.Texture | null,
  ) {
    const kind = hazards[0]?.kind;
    if (!kind) return;
    const h = hazards[0]!;
    if (kind === 'sheep') {
      const wool = this.mat(new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.95 }));
      const dark = this.mat(new THREE.MeshStandardMaterial({ color: 0x2a2626, roughness: 0.8 }));
      for (let i = 0; i < 6; i++) {
        const s = sheepModel(wool, dark);
        s.visible = false;
        this.sheep.push(s);
        this.group.add(s);
      }
    } else if (kind === 'rocks') {
      const mats = th.rock.map((c) =>
        this.mat(new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true })),
      );
      // boulders over the blocked half: a line along the road's middle and a heap towards the edge
      let n = 0;
      for (let along = -ROCKS_HALF + 1; along <= ROCKS_HALF - 1; along += 2.6)
        for (const f of [0.15, 0.55, 0.9]) {
          const r = 0.9 + ((n * 37) % 10) * 0.12 + (f < 0.3 ? 0.4 : 0);
          const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), mats[n % mats.length]!);
          m.rotation.set(n * 1.3, n * 2.1, n * 0.7);
          m.castShadow = true;
          m.visible = false;
          this.rocks.push({ mesh: m, lat: f, along: along + ((n * 13) % 7) * 0.2 - 0.6, delay: (n % 9) * 0.08 });
          this.group.add(m);
          n++;
        }
    } else if (kind === 'snowball') {
      const geo = new THREE.IcosahedronGeometry(BALL_R, 3);
      // a lumpy, packed-snow ball
      const p = geo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const v = new THREE.Vector3().fromBufferAttribute(p, i);
        const k = 1 + 0.06 * Math.sin(v.x * 3.1 + v.y * 2.3) * Math.cos(v.z * 2.7);
        p.setXYZ(i, v.x * k, v.y * k, v.z * k);
      }
      geo.computeVertexNormals();
      this.ball = new THREE.Mesh(
        geo,
        // packed snow, a touch blue and faceted, so it reads against the white slopes
        this.mat(new THREE.MeshStandardMaterial({ color: 0xc9d8ee, roughness: 0.7, flatShading: true })),
      );
      this.ball.castShadow = true;
      this.ball.visible = false;
      this.group.add(this.ball);
    } else if (kind === 'squall') {
      // a bank of dark clouds over the stretch, and the rain under it
      const cg = new THREE.Group();
      const tex = cloudTexture();
      const cm = this.mat(
        new THREE.SpriteMaterial({ map: tex, color: 0x4a5260, transparent: true, depthWrite: false, opacity: 0 }),
      );
      for (let o = 0; o <= h.len; o += 18) {
        const sp = new THREE.Sprite(cm);
        posOnTrack(this.T, h.idx + o, ((o * 7) % 30) - 15, tmp);
        sp.position.set(tmp.x, tmp.y + 42 + ((o * 3) % 9), tmp.z);
        sp.scale.set(90, 36, 1);
        cg.add(sp);
      }
      this.clouds = cg;
      this.group.add(cg);
      this.rain = new Ambient(this.T, 'rain', 5000, light, [h.idx, h.len]);
      this.rain.points.visible = false;
      this.group.add(this.rain.points);
      // on a dry track the squall brings its own puddles (a rainy race already shows them all)
      if (weather !== 'rain') {
        const P = puddlesFor(T).filter((p) => (p.i - h.idx + T.N) % T.N <= h.len);
        if (P.length) {
          this.puddles = puddleMesh(T, P, env);
          this.puddles.visible = false;
          this.mats.push(this.puddles.material as THREE.Material);
          this.group.add(this.puddles);
        }
      }
    }
  }

  private mat<M extends THREE.Material>(m: M): M {
    this.mats.push(m);
    return m;
  }

  update(s: Readonly<GameState>, dt: number, fx: Effects | null): void {
    const T = this.T;
    for (const h of s.hazards) {
      if (h.kind === 'sheep') this.updateSheep(h, s.time);
      else if (h.kind === 'rocks') this.updateRocks(h, dt, fx);
      else if (h.kind === 'snowball') this.updateBall(h, dt, fx);
      else if (h.kind === 'squall') this.updateSquall(h, s.time);
    }
    // a hazard that is done hides its pieces (another of the same race may show them again)
    if (!s.hazards.some((h) => h.kind === 'sheep' && h.sheep.length)) for (const g of this.sheep) g.visible = false;
    if (this.ball && !s.hazards.some((h) => h.ball)) this.ball.visible = false;
    void T;
  }

  private updateSheep(h: Hazard, time: number): void {
    if (!h.sheep.length) return;
    h.sheep.forEach((sh, i) => {
      const g = this.sheep[i];
      if (!g) return;
      g.visible = true;
      posOnTrack(this.T, h.idx + sh.along / this.T.DS, sh.lat, tmp);
      const walking = h.phase === 'active';
      const step = walking ? Math.sin(time * 9 + i) : 0;
      g.position.set(tmp.x, tmp.y + Math.abs(step) * 0.08, tmp.z);
      // facing the way they walk (across the road), grazing while they wait; a wobble after a bump
      const ang = this.T.ANG[h.idx]! + (h.side > 0 ? Math.PI / 2 : -Math.PI / 2);
      g.rotation.set(walking ? 0 : 0.25 * Math.sin(time * 1.3 + i), ang + Math.sin(time * 0.7 + i) * 0.25, 0);
      g.rotation.z = sh.bump > 0 ? Math.sin(sh.bump * 30) * 0.25 : 0;
      g.children.forEach((c) => {
        if (c.name === 'leg') c.rotation.x = step * 0.5 * Math.sign(c.position.x * c.position.z);
      });
    });
  }

  private updateRocks(h: Hazard, dt: number, fx: Effects | null): void {
    const T = this.T;
    const hw = T.HW[h.idx]!;
    if (h.phase === 'warn' && fx) {
      // pebbles trickling down onto the blocked half
      this.pebbleT -= dt;
      if (this.pebbleT <= 0) {
        this.pebbleT = 0.12;
        posOnTrack(T, h.idx + (Math.random() * 2 - 1) * (ROCKS_HALF / T.DS), h.side * hw * Math.random(), tmp);
        fx.burst(tmp.x, tmp.y + 9, tmp.z, [0x8d6e63, 0xa1887f, 0x6d4c41], 4, 3, 0.9);
      }
    }
    const show = h.phase === 'active';
    for (const r of this.rocks) {
      if (!show) {
        if (h.phase === 'done') r.mesh.visible = false;
        continue;
      }
      const t = h.t - r.delay;
      if (t < 0) continue;
      posOnTrack(T, h.idx + r.along / T.DS, h.side * (0.4 + r.lat * (hw + 0.8)), tmp);
      const fall = Math.max(0, 1 - t / 0.55);
      if (!r.mesh.visible && fx) fx.burst(tmp.x, tmp.y + 0.6, tmp.z, [0xbcaaa4, 0xd7ccc8], 6, 5, 1.6);
      r.mesh.visible = true;
      r.mesh.position.set(tmp.x, tmp.y + 0.55 + fall * fall * 16, tmp.z);
    }
  }

  private updateBall(h: Hazard, dt: number, fx: Effects | null): void {
    const b = h.ball,
      m = this.ball;
    if (!b || !m) return;
    m.visible = true;
    posOnTrack(this.T, h.idx, b.lat, tmp);
    // off the road the ground rises with the slope; the ball sits on it until it rolls
    m.position.set(tmp.x, tmp.y + BALL_R * 0.92 + b.y, tmp.z);
    const T = this.T,
      rx = T.RX[h.idx]!,
      rz = T.RZ[h.idx]!;
    if (h.phase === 'warn') {
      // teetering, shedding a little snow
      m.rotation.z = Math.sin(h.t * 7) * 0.06;
      if (fx && Math.random() < 0.2) fx.burst(tmp.x, tmp.y + 1, tmp.z, 0xffffff, 3, 2, 1.2);
      return;
    }
    this.ballRoll += (10 * dt) / BALL_R;
    // roll about the road's direction, the way it travels across
    m.rotation.set(0, 0, 0);
    m.rotateOnWorldAxis(new THREE.Vector3(T.TX[h.idx]!, 0, T.TZ[h.idx]!), -h.side * this.ballRoll);
    this.trailT -= dt;
    if (fx && this.trailT <= 0) {
      this.trailT = 0.05;
      fx.burst(tmp.x - rx * h.side * BALL_R, tmp.y + b.y + 0.6, tmp.z - rz * h.side * BALL_R, 0xffffff, 5, 4, 1.8);
    }
  }

  private updateSquall(h: Hazard, time: number): void {
    const on = h.phase === 'warn' || h.phase === 'active';
    if (this.clouds) {
      const m = (this.clouds.children[0] as THREE.Sprite | undefined)?.material;
      if (m) {
        const want = h.phase === 'active' ? 0.95 : h.phase === 'warn' ? Math.min(0.95, h.t / 3) : 0;
        m.opacity += (want - m.opacity) * 0.05;
      }
      this.clouds.visible = on || (m?.opacity ?? 0) > 0.02;
    }
    if (this.rain) {
      this.rain.points.visible = h.phase === 'active';
      if (this.puddles) this.puddles.visible = h.phase === 'active';
      this.rain.update(time);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g) this.geos.add(g);
    });
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) {
      (m as THREE.SpriteMaterial).map?.dispose();
      m.dispose();
    }
    this.rain?.dispose();
  }
}

function cloudTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let k = 0; k < 14; k++) {
    const x = 64 + Math.sin(k * 2.4) * 34,
      y = 70 + Math.cos(k * 1.7) * 14,
      r = 22 + (k % 4) * 6;
    const gr = g.createRadialGradient(x, y, 2, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.8)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
