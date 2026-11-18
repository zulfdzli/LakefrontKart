/**
 * Visual effects (prototype): pooled instanced particles, skid marks, shockwave rings, projectile meshes,
 * per-kart trails and event bursts. Uses a seeded generator so captures are reproducible.
 */
import * as THREE from 'three';
import { Rng, type GameEvent, type GameState, type Kart } from '@tk/shared';
import { P_, merge, jitter, ico, cyl, octa, hash3 } from './geo';
import { DRIFT_COL, CONFETTI } from './palette';
import type { Materials } from './materials';
import type { KartView } from './kart';

const _o = new THREE.Object3D();
const _c = new THREE.Color();

/** Instanced particle pool with a ring-buffer head. */
class Pool {
  readonly mesh: THREE.InstancedMesh;
  private readonly p: Float32Array;
  private readonly v: Float32Array;
  private readonly life: Float32Array;
  private readonly ml: Float32Array;
  private readonly sz: Float32Array;
  private readonly g: Float32Array;
  private readonly fl: Float32Array;
  private readonly rot: Float32Array;
  private readonly mode: Uint8Array;
  private head = 0;
  private dirty = true;

  constructor(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    readonly max: number,
    private readonly rng: Rng,
  ) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.ml = new Float32Array(max);
    this.sz = new Float32Array(max);
    this.g = new Float32Array(max);
    this.fl = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.mode = new Uint8Array(max);
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < max; i++) {
      this.mesh.setMatrixAt(i, z);
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
    life: number,
    size: number,
    grav: number,
    floor: number,
    mode = 0,
  ): void {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    this.life[i] = life;
    this.ml[i] = life;
    this.sz[i] = size;
    this.g[i] = grav;
    this.fl[i] = floor;
    this.rot[i] = this.rng.next() * 6;
    this.mode[i] = mode;
    this.mesh.setColorAt(i, _c.setHex(hex));
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) continue;
      any = true;
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        _o.position.set(0, -999, 0);
        _o.scale.setScalar(0);
        _o.updateMatrix();
        this.mesh.setMatrixAt(i, _o.matrix);
        continue;
      }
      const b = i * 3;
      this.v[b + 1]! -= this.g[i]! * dt;
      if (this.mode[i] === 1) {
        const d = Math.exp(-2.5 * dt);
        this.v[b]! *= d;
        this.v[b + 2]! *= d;
      }
      this.p[b]! += this.v[b]! * dt;
      this.p[b + 1]! += this.v[b + 1]! * dt;
      this.p[b + 2]! += this.v[b + 2]! * dt;
      if (this.p[b + 1]! < this.fl[i]!) {
        this.p[b + 1] = this.fl[i]!;
        this.v[b + 1]! *= -0.35;
        this.v[b]! *= 0.7;
        this.v[b + 2]! *= 0.7;
      }
      const t = this.life[i]! / this.ml[i]!;
      const s =
        this.mode[i] === 1
          ? this.sz[i]! * Math.sqrt(Math.sin(Math.PI * Math.min(1, (1 - t) * 1.6 + 0.08)))
          : this.sz[i]! * t;
      this.rot[i]! += dt * 4;
      _o.position.set(this.p[b]!, this.p[b + 1]!, this.p[b + 2]!);
      _o.rotation.set(this.rot[i]!, this.rot[i]! * 1.3, 0);
      _o.scale.setScalar(Math.max(0.001, s));
      _o.updateMatrix();
      this.mesh.setMatrixAt(i, _o.matrix);
    }
    if (any || this.dirty) {
      this.mesh.instanceMatrix.needsUpdate = true;
      this.dirty = any;
    }
  }

  clear(): void {
    this.life.fill(0);
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < this.max; i++) this.mesh.setMatrixAt(i, z);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const SKMAX = 900;

export class Effects {
  readonly group = new THREE.Group();
  private readonly rng = new Rng(0x5eed);
  private readonly sparks: Pool;
  private readonly puffs: Pool;
  private readonly skPos = new Float32Array(SKMAX * 18);
  private readonly skGeo = new THREE.BufferGeometry();
  private skHead = 0;
  private skDirty = false;
  private readonly rings: THREE.Mesh[] = [];
  private ringHead = 0;
  private readonly projViews = new Map<object, THREE.Object3D>();
  private readonly orbGeo = ico(0.95, 1);
  private readonly orbShell = ico(1.55, 0);
  private readonly orbMat = new THREE.MeshBasicMaterial({ color: 0x40c4ff });
  private readonly orbShellMat = new THREE.MeshLambertMaterial({
    color: 0xb3e5fc,
    transparent: true,
    opacity: 0.4,
    emissive: 0x0277bd,
    depthWrite: false,
  });
  private readonly boltGeo = merge([
    P_(cyl(1.05, 1.05, 0.34, 8), 0xff7043, 0, 0, 0),
    P_(cyl(0.5, 0.5, 0.4, 8), 0xffeb3b, 0, 0, 0),
  ]);
  private readonly slickGeo: THREE.BufferGeometry;
  private readonly slickMat = new THREE.MeshBasicMaterial({
    color: 0x2a1840,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  private readonly slickSheen = new THREE.MeshBasicMaterial({
    color: 0x7e57c2,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
  private readonly live = new Set<object>();

  constructor(private readonly M: Materials) {
    this.sparks = new Pool(octa(0.22), new THREE.MeshBasicMaterial({ color: 0xffffff }), 520, this.rng);
    this.puffs = new Pool(ico(0.6, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), 180, this.rng);
    this.group.add(this.sparks.mesh, this.puffs.mesh);
    // skid marks: ring buffer of quads, parked far below the world until used
    for (let i = 1; i < this.skPos.length; i += 3) this.skPos[i] = -999;
    this.skGeo.setAttribute('position', new THREE.BufferAttribute(this.skPos, 3));
    const sk = new THREE.Mesh(
      this.skGeo,
      new THREE.MeshBasicMaterial({
        color: 0x2b2d42,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      }),
    );
    sk.frustumCulled = false;
    this.group.add(sk);
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(0.85, 1.25, 14).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({
          color: 0x80d8ff,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      m.visible = false;
      m.userData.t = 1;
      this.group.add(m);
      this.rings.push(m);
    }
    const g = jitter(new THREE.CircleGeometry(3.2, 9).rotateX(-Math.PI / 2), 0.0, 1),
      p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        z = p.getZ(i),
        r = Math.hypot(x, z);
      if (r > 0.1) {
        const f = 0.8 + hash3(Math.round(x * 50), Math.round(z * 50), 1, 3) * 0.4;
        p.setX(i, x * f);
        p.setZ(i, z * f);
      }
    }
    this.slickGeo = g;
  }

  private rnd(a: number, b: number): number {
    return this.rng.range(a, b);
  }

  burst(x: number, y: number, z: number, hex: number | readonly number[], n: number, spd: number, size = 1.2): void {
    for (let i = 0; i < n; i++) {
      const c = typeof hex === 'number' ? hex : hex[i % hex.length]!;
      this.sparks.emit(
        x,
        y,
        z,
        this.rnd(-spd, spd),
        this.rnd(2, spd * 1.2),
        this.rnd(-spd, spd),
        c,
        this.rnd(0.45, 0.9),
        size,
        14,
        y - 1.4,
      );
    }
  }

  puff(x: number, y: number, z: number, hex: number, n: number, spd: number, size = 1.3): void {
    for (let i = 0; i < n; i++)
      this.puffs.emit(
        x + this.rnd(-0.6, 0.6),
        y,
        z + this.rnd(-0.6, 0.6),
        this.rnd(-spd, spd),
        this.rnd(0.5, spd),
        this.rnd(-spd, spd),
        hex,
        this.rnd(0.5, 0.9),
        size,
        -1,
        y - 2,
        1,
      );
  }

  ring(x: number, y: number, z: number, hex: number): void {
    const m = this.rings[this.ringHead]!;
    this.ringHead = (this.ringHead + 1) % this.rings.length;
    m.position.set(x, y + 0.4, z);
    (m.material as THREE.MeshBasicMaterial).color.setHex(hex);
    m.userData.t = 0;
    m.visible = true;
  }

  confetti(x: number, y: number, z: number, n: number): void {
    for (let i = 0; i < n; i++)
      this.sparks.emit(
        x + this.rnd(-3, 3),
        y + 3,
        z + this.rnd(-3, 3),
        this.rnd(-6, 6),
        this.rnd(6, 14),
        this.rnd(-6, 6),
        CONFETTI[i % 5]!,
        this.rnd(1.5, 2.5),
        1.5,
        9,
        y + 0.1,
      );
  }

  podiumConfetti(x: number, y: number, z: number): void {
    if (this.rng.next() < 0.5)
      this.sparks.emit(
        x + this.rnd(-8, 8),
        y + 14,
        z + this.rnd(-6, 6),
        this.rnd(-2, 2),
        this.rnd(-1, 1),
        this.rnd(-2, 2),
        CONFETTI[Math.floor(this.rng.next() * 5)]!,
        3,
        1.1,
        2.5,
        y + 0.8,
      );
  }

  private addSkid(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const dx = x1 - x0,
      dz = z1 - z0,
      l = Math.hypot(dx, dz);
    if (l < 0.01) return;
    const px = (-dz / l) * 0.22,
      pz = (dx / l) * 0.22,
      b = this.skHead * 18,
      s = this.skPos;
    const v = [
      x0 - px,
      y0,
      z0 - pz,
      x0 + px,
      y0,
      z0 + pz,
      x1 + px,
      y1,
      z1 + pz,
      x0 - px,
      y0,
      z0 - pz,
      x1 + px,
      y1,
      z1 + pz,
      x1 - px,
      y1,
      z1 - pz,
    ];
    for (let i = 0; i < 18; i++) s[b + i] = v[i]!;
    this.skHead = (this.skHead + 1) % SKMAX;
    this.skDirty = true;
  }

  clearAll(views: Iterable<KartView>): void {
    for (let i = 0; i < this.skPos.length; i++) this.skPos[i] = i % 3 === 1 ? -999 : 0;
    this.skDirty = true;
    for (const v of views) v.skid = [null, null];
    this.sparks.clear();
    this.puffs.clear();
    for (const [, v] of this.projViews) this.group.remove(v);
    this.projViews.clear();
    for (const r of this.rings) r.visible = false;
  }

  /** Continuous per-kart effects (drift sparks, smoke, boost, dust, wall sparks, slipstream, skids). Skipped for karts far from every camera. */
  kartTrail(k: Kart, v: KartView, nearestCam: number): void {
    if (nearestCam > 90) {
      v.skid[0] = v.skid[1] = null;
      return;
    }
    const ix = v.ix,
      iy = v.iy,
      iz = v.iz;
    const fx = Math.sin(k.h),
      fz = Math.cos(k.h),
      rx = -fz,
      rz = fx;
    const slip = Math.abs(k.vx * rx + k.vz * rz);
    if (k.drifting) {
      for (const s of [-1, 1])
        this.sparks.emit(
          ix + rx * s * 1.3 - fx * 1.6,
          iy + 0.25,
          iz + rz * s * 1.3 - fz * 1.6,
          this.rnd(-2, 2) - fx * 3,
          this.rnd(2, 5),
          this.rnd(-2, 2) - fz * 3,
          DRIFT_COL[k.driftLevel]!,
          this.rnd(0.2, 0.4),
          k.driftLevel ? 1.15 : 0.8,
          14,
          iy + 0.1,
        );
      if (this.rng.next() < 0.35)
        this.puffs.emit(
          ix - fx * 2 + this.rnd(-1, 1),
          iy + 0.4,
          iz - fz * 2 + this.rnd(-1, 1),
          this.rnd(-1, 1),
          this.rnd(0.5, 1.5),
          this.rnd(-1, 1),
          0xf5f5f5,
          0.7,
          1.0,
          -0.5,
          iy,
          1,
        );
    }
    if (k.boost > 0)
      this.sparks.emit(
        ix - fx * 3.4,
        iy + 1.2,
        iz - fz * 3.4,
        -fx * 8 + this.rnd(-1, 1),
        this.rnd(0, 2),
        -fz * 8 + this.rnd(-1, 1),
        k.boostTier === 3 ? 0xea80fc : k.boostTier === 2 ? 0x80d8ff : 0xffc107,
        0.3,
        1.0,
        2,
        iy + 0.1,
      );
    if (k.offroad && Math.abs(k.sp) > 8 && this.rng.next() < 0.6)
      this.puffs.emit(
        ix + this.rnd(-1, 1),
        iy + 0.3,
        iz + this.rnd(-1, 1),
        this.rnd(-2, 2),
        this.rnd(1, 3),
        this.rnd(-2, 2),
        0xc5a880,
        0.6,
        0.9,
        1,
        iy,
        1,
      );
    if (k.wall && Math.abs(k.sp) > 8)
      this.sparks.emit(
        ix + rx * Math.sign(k.lat) * 1.4,
        iy + 0.6,
        iz + rz * Math.sign(k.lat) * 1.4,
        this.rnd(-3, 3),
        this.rnd(2, 5),
        this.rnd(-3, 3),
        0xffd54f,
        0.3,
        0.9,
        14,
        iy,
      );
    if (k.drafting && this.rng.next() < 0.5)
      this.sparks.emit(
        ix + this.rnd(-1.5, 1.5) + fx * 4,
        iy + this.rnd(0.8, 2.4),
        iz + this.rnd(-1.5, 1.5) + fz * 4,
        -fx * 20,
        0,
        -fz * 20,
        0xffffff,
        0.25,
        0.7,
        0,
        iy - 5,
      );
    const skidding = (k.drifting || slip > 4.5 || (k.input.brake && k.sp > 12)) && !k.offroad && k.rescue <= 0;
    for (let w = 0; w < 2; w++) {
      const s = w ? 1 : -1,
        wx = ix + rx * s * 1.3 - fx * 1.35,
        wz = iz + rz * s * 1.3 - fz * 1.35,
        wy = iy + 0.1;
      const last = v.skid[w];
      if (skidding) {
        if (last) {
          if (Math.hypot(wx - last[0], wz - last[2]) > 0.7) {
            this.addSkid(last[0], last[1], last[2], wx, wy, wz);
            v.skid[w] = [wx, wy, wz];
          }
        } else v.skid[w] = [wx, wy, wz];
      } else v.skid[w] = null;
    }
  }

  /** One-shot effects for simulation events. `near` says whether any camera is close enough to bother. */
  onEvent(e: GameEvent, k: Kart | null, v: KartView | null, near: boolean): void {
    switch (e.type) {
      case 'driftstart':
        if (v) v.susV += 3;
        break;
      case 'driftlevel':
        if (k && near)
          this.burst(
            k.x - Math.sin(k.h) * 1.6,
            k.y + 0.6,
            k.z - Math.cos(k.h) * 1.6,
            DRIFT_COL[e.lvl ?? 1]!,
            10,
            4,
            1.4,
          );
        break;
      case 'boost':
        if (k && near) {
          this.ring(k.x, k.y, k.z, (e.t ?? 0) >= 1.15 ? 0xe040fb : 0x80d8ff);
          this.burst(
            k.x - Math.sin(k.h) * 2.5,
            k.y + 1,
            k.z - Math.cos(k.h) * 2.5,
            [0xffb74d, 0xffffff, 0xffeb3b],
            14,
            5,
          );
        }
        if (v) v.susV -= 2;
        break;
      case 'stall':
        if (k) this.puff(k.x - Math.sin(k.h) * 2.5, k.y + 1, k.z - Math.cos(k.h) * 2.5, 0x616161, 6, 1.5, 1);
        break;
      case 'shieldpop':
        if (k) this.burst(k.x, k.y + 1.5, k.z, [0x80d8ff, 0xffffff], 22, 7);
        break;
      case 'hit':
      case 'orbhit':
      case 'bolthit':
        if (k && near) {
          this.burst(k.x, k.y + 1.6, k.z, [0xffeb3b, 0xffffff], 22, 7);
          this.puff(k.x, k.y + 1, k.z, 0xeeeeee, 6, 3, 1.6);
        }
        if (e.type === 'orbhit' && near) this.puff(e.x!, e.y! + 1, e.z!, 0x80d8ff, 8, 4, 2);
        if (v) v.susV += 6;
        break;
      case 'orbpop':
        this.puff(e.x!, e.y! + 1, e.z!, 0x80d8ff, 6, 3, 1.6);
        break;
      case 'boltbounce':
        this.burst(e.x!, e.y! + 1, e.z!, 0xff7043, 6, 4, 1);
        break;
      case 'bump':
        if (k && near) this.burst(k.x, k.y + 0.8, k.z, 0xffe082, 6, 4, 0.9);
        if (v) v.susV += 4 * (e.power ?? 0.5);
        break;
      case 'finish':
        if (k) this.confetti(k.x, k.y, k.z, 60);
        break;
      default:
        break;
    }
  }

  pickupBurst(x: number, y: number, z: number): void {
    this.burst(x, y + 2, z, [0xff5252, 0xffd740, 0x40c4ff, 0xe040fb], 18, 6);
  }

  /** Projectile meshes follow the simulation's orbs, discs and slicks. */
  syncProjectiles(s: Readonly<GameState>, dt: number): void {
    const live = this.live;
    live.clear();
    for (const o of s.orbs) {
      live.add(o);
      const v = this.projView(o, 'orb');
      v.position.set(o.x, o.y + 1.4, o.z);
      v.rotation.y += dt * 4;
      if (dt > 0 && this.rng.next() < 0.5)
        this.sparks.emit(
          o.x,
          o.y + 1.4,
          o.z,
          this.rnd(-1, 1),
          this.rnd(0, 1),
          this.rnd(-1, 1),
          0x80d8ff,
          0.3,
          0.8,
          0,
          o.y,
        );
    }
    for (const b of s.bolts) {
      live.add(b);
      const v = this.projView(b, 'bolt');
      v.position.set(b.x, b.y + 0.9, b.z);
      v.rotation.y += dt * 14;
    }
    for (const sl of s.slicks) {
      live.add(sl);
      this.projView(sl, 'slick', sl);
    }
    for (const [o, v] of this.projViews)
      if (!live.has(o)) {
        this.group.remove(v);
        this.projViews.delete(o);
      }
  }

  private projView(
    o: object,
    kind: 'orb' | 'bolt' | 'slick',
    at?: { x: number; y: number; z: number },
  ): THREE.Object3D {
    let v = this.projViews.get(o);
    if (!v) {
      if (kind === 'orb') {
        v = new THREE.Group();
        v.add(new THREE.Mesh(this.orbGeo, this.orbMat));
        v.add(new THREE.Mesh(this.orbShell, this.orbShellMat));
      } else if (kind === 'bolt') v = new THREE.Mesh(this.boltGeo, this.M.kart);
      else {
        v = new THREE.Group();
        v.add(new THREE.Mesh(this.slickGeo, this.slickMat));
        const sh = new THREE.Mesh(this.slickGeo, this.slickSheen);
        sh.scale.setScalar(0.35);
        sh.position.set(0.7, 0.02, 0.4);
        v.add(sh);
        if (at) v.position.set(at.x, at.y + 0.13, at.z);
      }
      this.group.add(v);
      this.projViews.set(o, v);
    }
    return v;
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.puffs.update(dt);
    for (const r of this.rings) {
      if (!r.visible) continue;
      r.userData.t += dt * 2.6;
      const t = r.userData.t as number;
      if (t >= 1) {
        r.visible = false;
        continue;
      }
      r.scale.setScalar(1 + t * 6);
      (r.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
    }
    if (this.skDirty) {
      this.skGeo.attributes.position!.needsUpdate = true;
      this.skDirty = false;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
      }
    });
    this.orbGeo.dispose();
    this.orbShell.dispose();
    this.boltGeo.dispose();
    this.slickGeo.dispose();
  }
}

/** Radial speed lines on a 2D canvas over one viewport (boost and slipstream). */
export class SpeedLines {
  private on = false;
  private readonly rng = new Rng(0x11e5);
  constructor(private readonly g: CanvasRenderingContext2D) {}

  draw(strength: number, x: number, y: number, w: number, h: number): void {
    const g = this.g;
    if (!strength) {
      if (this.on) {
        g.clearRect(x, y, w, h);
        this.on = false;
      }
      return;
    }
    this.on = true;
    const cx = x + w / 2,
      cy = y + h * 0.5,
      R = Math.hypot(w, h) / 2;
    g.clearRect(x, y, w, h);
    g.save();
    g.beginPath();
    g.rect(x, y, w, h);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,' + 0.4 * strength + ')';
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    const n = Math.round(10 + 26 * strength);
    for (let i = 0; i < n; i++) {
      const a = this.rng.next() * Math.PI * 2,
        r0 = R * (0.58 + this.rng.next() * 0.2),
        r1 = r0 + R * (0.1 + this.rng.next() * 0.22);
      g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
      g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    }
    g.stroke();
    g.restore();
  }
}
