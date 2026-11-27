/**
 * D83 fun zones on the big screen.
 *
 * - Slalom: an entry banner, orange cones at each gate's edges (knocked cones tumble away and pop back up), a ski
 *   flag beside each gate (red on the right, blue on the left) and the gap painted on the road in the gate's colour.
 * - Jump target: a red and white bullseye on the road where the launch ramp comes down, a sign by the ramp, and a
 *   gold ring that bursts out of it on a hit.
 * - Draft tunnel: a covered gallery (pillars, beams, roof panels with gaps the sun strobes through) with neon strips
 *   whose dashes run forward along the roof, and a sign over the mouth.
 *
 * The cones follow the sim's zone state every frame (the live race or the replay's re-simulation).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SLALOM_HALF, posOnTrack, type GameState, type Track, type Zones } from '@tk/shared';
import type { Theme } from './palette';

const tmp = { x: 0, y: 0, z: 0 };
/** Tunnel roof height (m), and the gap between roof panels (samples) every PANEL samples. */
const ROOF = 7.6;
const PANEL = 6;

/** A canvas label: big text on a coloured board with a border. */
function label(text: string, sub: string, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, 1024, 256);
  g.strokeStyle = fg;
  g.lineWidth = 14;
  g.strokeRect(14, 14, 996, 228);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${sub ? 118 : 140}px system-ui, sans-serif`;
  g.fillText(text, 512, sub ? 108 : 132);
  if (sub) {
    g.font = '700 50px system-ui, sans-serif';
    g.fillText(sub, 512, 200);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function bullseye(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const rings = ['#d32f2f', '#ffffff', '#d32f2f', '#ffffff', '#d32f2f'];
  // the outermost (dark) ring is just past the scoring edge, so the edge reads on any road colour
  g.fillStyle = 'rgba(20,20,24,0.85)';
  g.beginPath();
  g.arc(256, 256, 256, 0, Math.PI * 2);
  g.fill();
  rings.forEach((col, i) => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(256, 256, 236 * (1 - i / rings.length), 0, Math.PI * 2);
    g.fill();
  });
  g.fillStyle = '#ffd54f';
  g.beginPath();
  g.arc(256, 256, 22, 0, Math.PI * 2);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Dashes for the tunnel's neon strips (they scroll forward). */
function dashes(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = '#3fd2e8';
  g.fillRect(0, 0, 128, 8);
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.7, '#b8fbff');
  grad.addColorStop(1, '#ffffff');
  g.fillStyle = grad;
  g.fillRect(40, 0, 88, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** Colour a geometry's vertices (for merged, vertex-coloured parts). */
function tint(g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry {
  const col = new THREE.Color(hex),
    n = g.getAttribute('position').count,
    a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, ry = 0, rz = 0): THREE.BufferGeometry =>
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, rz)),
      new THREE.Vector3(1, 1, 1),
    ),
  );
/** Non-indexed, so parts from different primitives merge. */
const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);

/** Gallery colours per theme: pillars and beams, the roof. */
const GALLERY: Readonly<Record<Theme['id'], { frame: number; roof: number }>> = {
  meadows: { frame: 0x7a5232, roof: 0xa4442f },
  canyon: { frame: 0x7b4a2c, roof: 0x5e4433 },
  frosty: { frame: 0x6a4a32, roof: 0xe8eef5 },
  tropical: { frame: 0x59636e, roof: 0x2d3d4f },
};

export class ZoneFx {
  readonly group = new THREE.Group();
  private readonly mats: THREE.Material[] = [];
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly texs: THREE.Texture[] = [];
  private cones: THREE.InstancedMesh | null = null;
  /** Per cone: how long it has been standing again (for the pop back up). */
  private readonly up: number[] = [];
  private readonly wasDown: boolean[] = [];
  private ring: THREE.Mesh | null = null;
  private ringT = -1;
  private dash: THREE.Texture | null = null;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly sc = new THREE.Vector3();

  constructor(
    private readonly T: Track,
    z: Zones,
    th: Theme,
  ) {
    if (z.slalom) this.buildSlalom(z, th);
    if (z.target) this.buildTarget(z);
    if (z.tunnel) this.buildTunnel(z, th);
  }

  private mat<M extends THREE.Material>(m: M): M {
    this.mats.push(m);
    return m;
  }
  private geo(g: THREE.BufferGeometry): THREE.BufferGeometry {
    this.geos.push(g);
    return g;
  }
  private tex<X extends THREE.Texture>(t: X): X {
    this.texs.push(t);
    return t;
  }

  /** A board on two posts beside (or over) the road at sample i, facing the karts coming up to it. */
  private sign(i: number, lat: number, w: number, h: number, y: number, map: THREE.Texture, post: number): void {
    const T = this.T;
    posOnTrack(T, i, lat, tmp);
    const board = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(w, h)),
      this.mat(
        new THREE.MeshStandardMaterial({
          map,
          roughness: 0.6,
          emissive: 0xffffff,
          emissiveMap: map,
          emissiveIntensity: 0.25,
        }),
      ),
    );
    board.position.set(tmp.x, tmp.y + y, tmp.z);
    board.rotation.y = T.ANG[i]! + Math.PI;
    this.group.add(board);
    const posts: THREE.BufferGeometry[] = [];
    for (const sd of [-1, 1]) {
      posOnTrack(T, i, lat + sd * (w / 2 - 0.4) * Math.abs(Math.cos(0)), tmp);
      posts.push(
        tint(
          flat(place(new THREE.BoxGeometry(0.35, y + h / 2, 0.35), tmp.x, tmp.y + (y + h / 2) / 2, tmp.z, T.ANG[i]!)),
          post,
        ),
      );
    }
    const pm = new THREE.Mesh(
      this.geo(mergeGeometries(posts)!),
      this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })),
    );
    pm.castShadow = true;
    this.group.add(pm);
    for (const p of posts) p.dispose();
  }

  private buildSlalom(z: Zones, th: Theme): void {
    const T = this.T,
      sl = z.slalom!;
    // the cones: one instanced, vertex-coloured mesh (orange body, white band, black base)
    const parts = [
      tint(flat(new THREE.ConeGeometry(0.46, 1.25, 16).translate(0, 0.66, 0)), 0xff6d1f),
      tint(flat(new THREE.CylinderGeometry(0.25, 0.32, 0.2, 16, 1, true).translate(0, 0.62, 0)), 0xffffff),
      tint(flat(new THREE.BoxGeometry(0.95, 0.08, 0.95).translate(0, 0.04, 0)), 0x222222),
    ];
    const cg = this.geo(mergeGeometries(parts)!);
    for (const p of parts) p.dispose();
    this.cones = new THREE.InstancedMesh(
      cg,
      this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 })),
      sl.cones.length,
    );
    this.cones.castShadow = true;
    this.cones.frustumCulled = false;
    this.group.add(this.cones);
    for (let i = 0; i < sl.cones.length; i++) {
      this.up.push(1);
      this.wasDown.push(false);
    }
    // the ski flags beside each gate, and the gap painted on the road
    const flags: THREE.BufferGeometry[] = [];
    const paint: THREE.BufferGeometry[] = [];
    sl.gates.forEach((g) => {
      const sd = Math.sign(g.lat) || 1,
        col = sd > 0 ? 0xe53935 : 0x1e88e5,
        a = T.ANG[g.idx]!;
      posOnTrack(T, g.idx, g.lat + sd * (SLALOM_HALF + 0.9), tmp);
      flags.push(
        tint(flat(place(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6), tmp.x, tmp.y + 1.7, tmp.z)), 0xf2f2f2),
      );
      flags.push(tint(flat(place(new THREE.BoxGeometry(0.05, 1.1, 1.6), tmp.x, tmp.y + 2.8, tmp.z, a)), col));
      posOnTrack(T, g.idx, g.lat, tmp);
      const pg = new THREE.PlaneGeometry((SLALOM_HALF - 0.5) * 2, 3.2).rotateX(-Math.PI / 2);
      paint.push(tint(flat(place(pg, tmp.x, tmp.y + 0.08, tmp.z, a)), col));
    });
    const fm = new THREE.Mesh(
      this.geo(mergeGeometries(flags)!),
      this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide })),
    );
    fm.castShadow = true;
    this.group.add(fm);
    const pm = new THREE.Mesh(
      this.geo(mergeGeometries(paint)!),
      this.mat(
        new THREE.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      ),
    );
    pm.renderOrder = 1;
    this.group.add(pm);
    for (const g of [...flags, ...paint]) g.dispose();
    // the banner over the road before the first gate
    const b0 = (sl.gates[0]!.idx - Math.round(24 / T.DS) + T.N) % T.N;
    const w = (T.WALLD[b0]! + 1.2) * 2;
    this.sign(
      b0,
      0,
      w,
      w / 8,
      7,
      this.tex(label('SLALOM', 'EVERY GATE = FREE ITEM', '#ff6d1f', '#ffffff')),
      th.id === 'tropical' ? 0x59636e : 0x5d4037,
    );
  }

  private buildTarget(z: Zones): void {
    const T = this.T,
      tg = z.target!;
    // the bullseye: its red rings end at the scoring edge, a dark rim just past it
    const size = tg.r * 2 * (256 / 236);
    const m = new THREE.Mesh(
      this.geo(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2)),
      this.mat(
        new THREE.MeshStandardMaterial({
          map: this.tex(bullseye()),
          transparent: true,
          roughness: 0.75,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        }),
      ),
    );
    m.position.set(tg.x, tg.y + 0.1, tg.z);
    m.rotation.y = T.ANG[tg.idx]!;
    m.renderOrder = 1;
    m.receiveShadow = true;
    this.group.add(m);
    // the ring that bursts out on a hit
    this.ring = new THREE.Mesh(
      this.geo(new THREE.RingGeometry(tg.r * 0.86, tg.r, 48).rotateX(-Math.PI / 2)),
      this.mat(
        new THREE.MeshBasicMaterial({
          color: 0xffd54f,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
        }),
      ),
    );
    this.ring.position.set(tg.x, tg.y + 0.3, tg.z);
    this.ring.visible = false;
    this.group.add(this.ring);
    // a sign beside the ramp, on the target's side
    const at = (tg.lip - Math.round(30 / T.DS) + T.N) % T.N,
      sd = Math.sign(tg.lat) || 1;
    this.sign(
      at,
      sd * (T.WALLD[at]! + 3.4),
      6.4,
      1.6,
      2.6,
      this.tex(label('JUMP TARGET', 'LAND ON IT = FREE ITEM', '#c62828', '#ffffff')),
      0x455a64,
    );
  }

  private buildTunnel(z: Zones, th: Theme): void {
    const T = this.T,
      N = T.N,
      tu = z.tunnel!;
    const col = GALLERY[th.id];
    const W = (i: number): number => T.WALLD[i % N]! + 0.7;
    // pillars and beams, at every gap in the roof
    const frame: THREE.BufferGeometry[] = [];
    for (let i = tu.i0; i <= tu.i1; i += PANEL) {
      const j = i % N,
        a = T.ANG[j]!,
        w = W(j);
      for (const sd of [-1, 1]) {
        posOnTrack(T, j, sd * w, tmp);
        frame.push(
          tint(flat(place(new THREE.BoxGeometry(0.7, ROOF, 0.7), tmp.x, tmp.y + ROOF / 2, tmp.z, a)), col.frame),
        );
      }
      posOnTrack(T, j, 0, tmp);
      frame.push(
        tint(flat(place(new THREE.BoxGeometry(w * 2 + 0.7, 0.6, 0.7), tmp.x, tmp.y + ROOF, tmp.z, a)), col.frame),
      );
    }
    const fm = new THREE.Mesh(
      this.geo(mergeGeometries(frame)!),
      this.mat(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 })),
    );
    fm.castShadow = true;
    this.group.add(fm);
    for (const g of frame) g.dispose();

    // the roof: a panel between each pair of beams, with a gap of one sample (the sun strobes through)
    const pos: number[] = [],
      idx: number[] = [];
    const l = { x: 0, y: 0, z: 0 },
      r = { x: 0, y: 0, z: 0 };
    for (let i = tu.i0; i < tu.i1; i++) {
      if ((i - tu.i0) % PANEL === PANEL - 1) continue;
      const base = pos.length / 3;
      for (const s of [i, i + 1]) {
        const j = s % N,
          w = W(j);
        posOnTrack(T, j, -w, l);
        posOnTrack(T, j, w, r);
        const y = (l.y + r.y) / 2 + ROOF + 0.32;
        pos.push(l.x, y, l.z, r.x, y, r.z);
      }
      idx.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const roof = new THREE.Mesh(
      this.geo(rg),
      this.mat(new THREE.MeshStandardMaterial({ color: col.roof, roughness: 0.8, side: THREE.DoubleSide })),
    );
    roof.castShadow = true;
    this.group.add(roof);

    // neon strips along both sides under the roof and at kerb height: dashes run forward
    this.dash = this.tex(dashes());
    const np: number[] = [],
      nu: number[] = [],
      ni: number[] = [];
    for (const [hgt, inset] of [
      [ROOF - 0.55, 0.45],
      [1.35, 0.45],
    ] as const)
      for (const sd of [-1, 1]) {
        let along = 0;
        for (let i = tu.i0; i <= tu.i1; i++) {
          const j = i % N;
          posOnTrack(T, j, sd * (W(j) - inset), l);
          const b = np.length / 3;
          np.push(l.x, l.y + hgt - 0.14, l.z, l.x, l.y + hgt + 0.14, l.z);
          nu.push(along / 6, 0, along / 6, 1);
          if (i > tu.i0) ni.push(b - 2, b, b - 1, b - 1, b, b + 1);
          along += T.DS;
        }
      }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
    ng.setAttribute('uv', new THREE.Float32BufferAttribute(nu, 2));
    ng.setIndex(ni);
    const neon = new THREE.Mesh(
      this.geo(ng),
      this.mat(
        new THREE.MeshBasicMaterial({ map: this.dash, color: 0xffffff, side: THREE.DoubleSide, toneMapped: false }),
      ),
    );
    neon.frustumCulled = false;
    this.group.add(neon);

    // the sign over the mouth
    const m0 = tu.i0 % N,
      w = W(m0) * 2;
    this.sign(
      m0,
      0,
      Math.min(w, 22),
      Math.min(w, 22) / 7,
      ROOF + 1.6,
      this.tex(label('DRAFT TUNNEL', 'SLIPSTREAM CHARGES YOUR MOVE', '#0f3a4a', '#7ff3ff')),
      col.frame,
    );
  }

  /** A bullseye: the ring bursts out of the target. */
  pulse(): void {
    if (!this.ring) return;
    this.ringT = 0;
    this.ring.visible = true;
  }

  update(s: Readonly<GameState>, dt: number): void {
    if (this.dash) this.dash.offset.x -= dt * 2.2;
    if (this.ring && this.ringT >= 0) {
      this.ringT += dt;
      const t = this.ringT / 0.8;
      this.ring.scale.setScalar(1 + t * 1.6);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      if (t >= 1) {
        this.ringT = -1;
        this.ring.visible = false;
      }
    }
    const sl = s.zones?.slalom;
    if (!this.cones || !sl) return;
    const T = this.T;
    sl.cones.forEach((c, i) => {
      const a = T.ANG[c.idx]!;
      if (c.down >= 0) {
        // knocked: thrown along the kart's way, tipping onto its side, then lying there
        const t = Math.min(c.down, 0.6),
          d = t * 9 - t * t * 6;
        const hop = Math.sin(Math.min(1, c.down / 0.45) * Math.PI) * 0.7;
        this.v.set(c.x + c.dx * d, c.y + hop + (c.down > 0.3 ? 0.18 : 0), c.z + c.dz * d);
        this.e.set(0, Math.atan2(c.dx, c.dz), 0);
        this.q.setFromEuler(this.e);
        const tip = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0),
          Math.min(1, c.down / 0.3) * (Math.PI / 2) + c.down * 0.2,
        );
        this.q.multiply(tip);
        this.sc.setScalar(c.down > 2.7 ? Math.max(0.01, (3 - c.down) / 0.3) : 1);
        this.wasDown[i] = true;
      } else {
        if (this.wasDown[i]) {
          this.wasDown[i] = false;
          this.up[i] = 0;
        }
        this.up[i] = Math.min(1, this.up[i]! + dt / 0.25);
        const u = this.up[i]!;
        this.v.set(c.x, c.y, c.z);
        this.e.set(0, a, 0);
        this.q.setFromEuler(this.e);
        // pops back up a touch too big, then settles
        this.sc.setScalar(u < 1 ? u * 1.15 : 1);
      }
      this.m4.compose(this.v, this.q, this.sc);
      this.cones!.setMatrixAt(i, this.m4);
    });
    this.cones.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.cones?.dispose();
  }
}
