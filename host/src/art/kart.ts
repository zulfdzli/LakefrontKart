/**
 * Karts and characters. A KartAssetProvider builds the meshes (procedural now; a glTF provider can
 * replace it later, section 10.3). KartView owns one kart's scene graph and its procedural animation.
 */
import * as THREE from 'three';
import { RESCUE_T, SPIN_T, clamp, wrapA, type Character, type Kart } from '@tk/shared';
import { P_, merge, jitter, outlineGeo, canvasTex, box, cyl, ico, cone, octa, nonIdx, hexStr, type Part } from './geo';
import { INK, DARK, METAL, WHITE, kartPaint } from './palette';
import type { Materials } from './materials';

/* ---------------- asset provider ---------------- */

export interface KartModel {
  chassis: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  /** Outline hulls (inverted), or null to skip outlines. */
  chassisOutline: THREE.BufferGeometry | null;
  headOutline: THREE.BufferGeometry | null;
}

export interface KartAssetProvider {
  readonly kind: 'procedural' | 'gltf';
  build(ch: Character, paint: number): KartModel;
  /** Shared, character-independent parts. */
  readonly wheelRear: THREE.BufferGeometry;
  readonly wheelFront: THREE.BufferGeometry;
  readonly drone: THREE.BufferGeometry;
  dispose(): void;
}

function buildHead(ch: Character): THREE.BufferGeometry {
  const F = ch.fur, B = ch.belly, BK = INK, W = WHITE;
  const eyes = (y: number, z: number, sp = 0.22): Part[] => [P_(ico(0.08, 0), BK, sp, y, z), P_(ico(0.08, 0), BK, -sp, y, z), P_(ico(0.03, 0), W, sp - 0.03, y + 0.04, z + 0.06), P_(ico(0.03, 0), W, -sp - 0.03, y + 0.04, z + 0.06)];
  switch (ch.kind) {
    case 'bear': return merge([P_(jitter(ico(0.62, 1), 0.05, 1), F, 0, 0.35, 0), P_(ico(0.23, 0), F, 0.45, 0.85, -0.05), P_(ico(0.23, 0), F, -0.45, 0.85, -0.05),
      P_(ico(0.12, 0), B, 0.45, 0.85, 0.1), P_(ico(0.12, 0), B, -0.45, 0.85, 0.1), P_(ico(0.3, 0), B, 0, 0.2, 0.52, 0, 0, 0, 1, 0.8, 0.8), P_(ico(0.11, 0), BK, 0, 0.3, 0.78), ...eyes(0.5, 0.56)]);
    case 'penguin': return merge([P_(ico(0.62, 1), F, 0, 0.35, 0), P_(ico(0.5, 1), W, 0, 0.3, 0.32, 0, 0, 0, 1, 0.9, 0.75), P_(cone(0.15, 0.45, 4), 0xff9800, 0, 0.24, 0.86, Math.PI / 2), ...eyes(0.46, 0.68, 0.2)]);
    case 'robot': return merge([P_(box(1.0, 0.86, 0.92), F, 0, 0.42, 0), P_(box(0.84, 0.3, 0.1), 0x18ffff, 0, 0.5, 0.47), P_(box(0.42, 0.08, 0.06), BK, 0, 0.2, 0.47),
      P_(cyl(0.04, 0.04, 0.5, 4), BK, 0, 1.08, 0), P_(ico(0.12, 0), 0xff5252, 0, 1.36, 0), P_(cyl(0.15, 0.15, 0.16, 6), ch.accent, 0.56, 0.42, 0, 0, 0, Math.PI / 2), P_(cyl(0.15, 0.15, 0.16, 6), ch.accent, -0.56, 0.42, 0, 0, 0, Math.PI / 2)]);
    case 'fox': return merge([P_(ico(0.58, 1), F, 0, 0.35, 0, 0, 0, 0, 1, 0.92, 1), P_(cone(0.28, 0.62, 5), B, 0, 0.22, 0.7, Math.PI / 2), P_(ico(0.08, 0), BK, 0, 0.22, 1.0),
      P_(cone(0.21, 0.52, 4), F, 0.32, 0.95, 0), P_(cone(0.21, 0.52, 4), F, -0.32, 0.95, 0), P_(cone(0.1, 0.25, 4), BK, 0.32, 1.13, 0.02), P_(cone(0.1, 0.25, 4), BK, -0.32, 1.13, 0.02),
      P_(ico(0.24, 0), B, 0.3, 0.15, 0.36), P_(ico(0.24, 0), B, -0.3, 0.15, 0.36), ...eyes(0.48, 0.52, 0.2)]);
    case 'frog': return merge([P_(ico(0.62, 1), F, 0, 0.3, 0, 0, 0, 0, 1.25, 0.72, 1.05), P_(ico(0.24, 1), W, 0.38, 0.7, 0.2), P_(ico(0.24, 1), W, -0.38, 0.7, 0.2),
      P_(ico(0.11, 0), BK, 0.38, 0.74, 0.42), P_(ico(0.11, 0), BK, -0.38, 0.74, 0.42), P_(box(0.8, 0.06, 0.08), BK, 0, 0.18, 0.64), P_(ico(0.12, 0), 0xf48fb1, 0.5, 0.25, 0.48), P_(ico(0.12, 0), 0xf48fb1, -0.5, 0.25, 0.48)]);
    default: return merge([P_(ico(0.62, 1), F, 0, 0.35, 0), P_(ico(0.5, 1), B, 0, 0.35, 0.42, 0, 0, 0, 1, 0.9, 0.5), P_(cyl(0.22, 0.22, 0.1, 8), 0xfff176, 0.22, 0.46, 0.66, Math.PI / 2), P_(cyl(0.22, 0.22, 0.1, 8), 0xfff176, -0.22, 0.46, 0.66, Math.PI / 2),
      P_(ico(0.1, 0), BK, 0.22, 0.46, 0.73), P_(ico(0.1, 0), BK, -0.22, 0.46, 0.73), P_(cone(0.1, 0.3, 4), 0xff9800, 0, 0.26, 0.74, Math.PI / 2 + 0.4),
      P_(cone(0.13, 0.42, 4), F, 0.38, 0.95, 0, 0, 0, -0.35), P_(cone(0.13, 0.42, 4), F, -0.38, 0.95, 0, 0, 0, 0.35)]);
  }
}

function buildChassis(ch: Character, K: number): THREE.BufferGeometry {
  const A = ch.accent, D = DARK, MT = METAL, F = ch.fur, B = ch.belly;
  const torsoCol = ch.kind === 'robot' ? 0x90a4ae : F;
  return merge([
    P_(box(2.3, 0.32, 3.9), D, 0, 0.5, 0),
    P_(box(2.0, 0.56, 2.5), K, 0, 0.9, -0.35),
    P_(box(1.7, 0.5, 1.7), K, 0, 0.82, 1.45, -0.18),
    P_(box(2.15, 0.32, 0.42), D, 0, 0.55, 2.06),
    P_(box(0.55, 0.5, 2.0), A, 1.2, 0.78, -0.25), P_(box(0.55, 0.5, 2.0), A, -1.2, 0.78, -0.25),
    P_(box(0.55, 0.06, 1.55), A, 0, 1.1, 1.4, -0.18),
    P_(box(1.35, 1.05, 0.35), D, 0, 1.45, -1.15),
    P_(box(1.5, 0.6, 0.8), MT, 0, 1.05, -1.75),
    P_(cyl(0.15, 0.2, 0.7, 6), MT, 0.45, 1.2, -2.25, Math.PI / 2), P_(cyl(0.15, 0.2, 0.7, 6), MT, -0.45, 1.2, -2.25, Math.PI / 2),
    P_(box(0.12, 0.65, 0.12), D, 0.65, 1.55, -1.95), P_(box(0.12, 0.65, 0.12), D, -0.65, 1.55, -1.95),
    P_(box(2.5, 0.14, 0.72), K, 0, 1.9, -2.0),
    P_(box(0.1, 0.46, 0.78), A, 1.25, 1.85, -2.0), P_(box(0.1, 0.46, 0.78), A, -1.25, 1.85, -2.0),
    P_(box(0.38, 0.2, 0.08), 0xfff59d, 0.58, 0.95, 2.31), P_(box(0.38, 0.2, 0.08), 0xfff59d, -0.58, 0.95, 2.31),
    P_(cyl(0.05, 0.05, 0.75, 5), D, 0, 1.2, 0.5, -0.9),
    P_(new THREE.TorusGeometry(0.3, 0.07, 4, 8), D, 0, 1.5, 0.2, -0.5),
    P_(cyl(0.42, 0.56, 0.95, 7), torsoCol, 0, 1.62, -0.55),
    P_(ico(0.38, 0), B, 0, 1.58, -0.25, 0, 0, 0, 1, 1.1, 0.6),
    P_(box(0.22, 0.22, 0.8), torsoCol, 0.5, 1.66, -0.12, 0.5), P_(box(0.22, 0.22, 0.8), torsoCol, -0.5, 1.66, -0.12, 0.5),
    P_(ico(0.15, 0), B, 0.3, 1.5, 0.22), P_(ico(0.15, 0), B, -0.3, 1.5, 0.22),
  ]);
}

export class ProceduralKartProvider implements KartAssetProvider {
  readonly kind = 'procedural' as const;
  readonly wheelRear = merge([
    P_(cyl(0.68, 0.68, 0.7, 8), 0x26262e, 1.3, 0, 0, 0, 0, Math.PI / 2), P_(cyl(0.34, 0.34, 0.76, 6), METAL, 1.3, 0, 0, 0, 0, Math.PI / 2),
    P_(cyl(0.68, 0.68, 0.7, 8), 0x26262e, -1.3, 0, 0, 0, 0, Math.PI / 2), P_(cyl(0.34, 0.34, 0.76, 6), METAL, -1.3, 0, 0, 0, 0, Math.PI / 2),
    P_(cyl(0.12, 0.12, 2.2, 5), DARK, 0, 0, 0, 0, 0, Math.PI / 2),
  ]);
  readonly wheelFront = merge([P_(cyl(0.55, 0.55, 0.55, 8), 0x26262e, 0, 0, 0, 0, 0, Math.PI / 2), P_(cyl(0.28, 0.28, 0.6, 6), METAL, 0, 0, 0, 0, 0, Math.PI / 2)]);
  readonly drone = merge([
    P_(box(1.4, 0.45, 1.4), 0xffeb3b, 0, 0, 0), P_(box(3.2, 0.15, 0.25), DARK, 0, 0.1, 0, 0, Math.PI / 4), P_(box(3.2, 0.15, 0.25), DARK, 0, 0.1, 0, 0, -Math.PI / 4),
    P_(cyl(0.6, 0.6, 0.06, 6), 0x90a4ae, 1.1, 0.25, 1.1), P_(cyl(0.6, 0.6, 0.06, 6), 0x90a4ae, -1.1, 0.25, 1.1), P_(cyl(0.6, 0.6, 0.06, 6), 0x90a4ae, 1.1, 0.25, -1.1), P_(cyl(0.6, 0.6, 0.06, 6), 0x90a4ae, -1.1, 0.25, -1.1),
    P_(box(0.06, 2.6, 0.06), DARK, 0, -1.4, 0), P_(ico(0.18, 0), 0xff5252, 0, 0.35, 0.7),
  ]);
  private readonly built: THREE.BufferGeometry[] = [];

  build(ch: Character, paint: number): KartModel {
    const chassis = buildChassis(ch, paint), head = buildHead(ch);
    const m: KartModel = { chassis, head, chassisOutline: outlineGeo(chassis, 0.06), headOutline: outlineGeo(head, 0.05) };
    this.built.push(chassis, head, m.chassisOutline!, m.headOutline!);
    return m;
  }

  dispose(): void {
    for (const g of this.built) g.dispose();
    this.wheelRear.dispose(); this.wheelFront.dispose(); this.drone.dispose();
  }
}

/** Placeholder for hand-made .glb karts (section 10.3). Falls back to the procedural models until implemented. */
export class GltfKartProvider implements KartAssetProvider {
  readonly kind = 'gltf' as const;
  private readonly fallback = new ProceduralKartProvider();
  get wheelRear(): THREE.BufferGeometry { return this.fallback.wheelRear; }
  get wheelFront(): THREE.BufferGeometry { return this.fallback.wheelFront; }
  get drone(): THREE.BufferGeometry { return this.fallback.drone; }
  build(ch: Character, paint: number): KartModel { return this.fallback.build(ch, paint); }
  dispose(): void { this.fallback.dispose(); }
}

/* ---------------- shared FX geometry for kart views ---------------- */

interface SharedKartFx {
  shadowGeo: THREE.BufferGeometry; shadowMat: THREE.MeshBasicMaterial;
  starGeo: THREE.BufferGeometry; starMat: THREE.MeshBasicMaterial;
  flameGeo: THREE.BufferGeometry; coreGeo: THREE.BufferGeometry; coreMat: THREE.MeshBasicMaterial;
  shieldGeo: THREE.BufferGeometry;
}
let fx: SharedKartFx | null = null;
function sharedFx(): SharedKartFx {
  if (fx) return fx;
  const shieldGeo = nonIdx(ico(2.7, 1));
  shieldGeo.computeVertexNormals();
  fx = {
    shadowGeo: new THREE.CircleGeometry(2.4, 10).rotateX(-Math.PI / 2),
    shadowMat: new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0.22, depthWrite: false }),
    starGeo: octa(0.24), starMat: new THREE.MeshBasicMaterial({ color: 0xffeb3b }),
    flameGeo: cone(0.34, 1.9, 6).rotateX(-Math.PI / 2), coreGeo: cone(0.18, 1.1, 6).rotateX(-Math.PI / 2), coreMat: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    shieldGeo,
  };
  return fx;
}

function nameTag(name: string, color: number): THREE.Sprite {
  const t = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = hexStr(color); g.strokeStyle = '#1d1b2e'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(30, 6); g.lineTo(w - 30, 6); g.quadraticCurveTo(w - 6, 6, w - 6, 32); g.quadraticCurveTo(w - 6, h - 6, w - 30, h - 6);
    g.lineTo(30, h - 6); g.quadraticCurveTo(6, h - 6, 6, 32); g.quadraticCurveTo(6, 6, 30, 6); g.closePath(); g.fill(); g.stroke();
    g.font = 'bold 36px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 6;
    g.strokeText(name, w / 2, h / 2 + 2); g.fillStyle = '#fff'; g.fillText(name, w / 2, h / 2 + 2);
  }, true);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(4.6, 1.15, 1);
  s.position.y = 4.5;
  return s;
}

/* ---------------- kart view ---------------- */

export class KartView {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly head = new THREE.Group();
  readonly tag: THREE.Sprite;
  private readonly rear: THREE.Mesh;
  private readonly pivots: THREE.Group[] = [];
  private readonly fronts: THREE.Mesh[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameMat: THREE.MeshBasicMaterial;
  private readonly shield: THREE.Mesh;
  private readonly stars = new THREE.Group();
  private readonly drone: THREE.Mesh;
  private readonly shadow: THREE.Mesh;
  /** Interpolated position (render frame). */
  ix = 0; iy = 0; iz = 0; ih = 0;
  private yaw = 0; private lean = 0; private pitch = 0; private pitchAcc = 0;
  sus = 0; susV = 0; private lastSp = 0;
  /** Rescue lift this frame (m). */
  lift = 0;
  hopH = 0;
  /** Skid trail anchors per rear wheel. */
  skid: ([number, number, number] | null)[] = [null, null];
  readonly paint: number;

  constructor(readonly kartId: number, ch: Character, slot: number | null, displayName: string, assets: KartAssetProvider, M: Materials) {
    const S = sharedFx();
    this.paint = kartPaint(slot);
    const model = assets.build(ch, this.paint);
    this.root.rotation.order = 'YXZ';
    this.body.rotation.order = 'YXZ';
    this.root.add(this.body);
    const chassis = new THREE.Mesh(model.chassis, M.kart); chassis.castShadow = true; this.body.add(chassis);
    if (model.chassisOutline) this.body.add(new THREE.Mesh(model.chassisOutline, M.line));
    this.head.position.set(0, 2.05, -0.5); this.body.add(this.head);
    const hm = new THREE.Mesh(model.head, M.kart); hm.castShadow = true; this.head.add(hm);
    if (model.headOutline) this.head.add(new THREE.Mesh(model.headOutline, M.line));
    this.rear = new THREE.Mesh(assets.wheelRear, M.kart); this.rear.position.set(0, 0.68, -1.35); this.rear.castShadow = true; this.body.add(this.rear);
    for (const x of [1.25, -1.25]) {
      const p = new THREE.Group(); p.position.set(x, 0.55, 1.4); this.body.add(p);
      const w = new THREE.Mesh(assets.wheelFront, M.kart); w.castShadow = true; p.add(w);
      this.pivots.push(p); this.fronts.push(w);
    }
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffa726, transparent: true, opacity: 0.92, depthWrite: false });
    for (const x of [0.45, -0.45]) {
      const f = new THREE.Mesh(S.flameGeo, this.flameMat); f.position.set(x, 1.2, -3.4); f.visible = false;
      const c = new THREE.Mesh(S.coreGeo, S.coreMat); c.position.z = 0.2; f.add(c);
      this.body.add(f); this.flames.push(f);
    }
    this.shield = new THREE.Mesh(S.shieldGeo, new THREE.MeshLambertMaterial({ color: 0x80d8ff, transparent: true, opacity: 0.3, depthWrite: false, emissive: 0x1565c0 }));
    this.shield.position.y = 1.4; this.shield.visible = false; this.body.add(this.shield);
    this.stars.position.y = 3.3; this.stars.visible = false;
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(S.starGeo, S.starMat); s.position.set(Math.cos(i * 2.1) * 0.8, 0, Math.sin(i * 2.1) * 0.8); this.stars.add(s); }
    this.body.add(this.stars);
    this.shadow = new THREE.Mesh(S.shadowGeo, S.shadowMat); this.shadow.position.y = 0.06; this.shadow.renderOrder = 1; this.root.add(this.shadow);
    this.drone = new THREE.Mesh(assets.drone, M.kart); this.drone.visible = false; this.drone.position.y = 5; this.root.add(this.drone);
    this.tag = nameTag(displayName, this.paint);
    this.root.add(this.tag);
  }

  /** Interpolate the transform between the last two simulation steps. */
  interpolate(k: Kart, alpha: number): void {
    this.ix = k.px + (k.x - k.px) * alpha;
    this.iz = k.pz + (k.z - k.pz) * alpha;
    this.iy = k.py + (k.y - k.py) * alpha;
    this.ih = k.ph + wrapA(k.h - k.ph) * alpha;
  }

  resetMotion(): void {
    this.sus = 0; this.susV = 0; this.yaw = 0; this.skid = [null, null];
  }

  /** Racing pose and procedural animation (prototype syncViews). dt is 0 while paused. */
  animate(k: Kart, dt: number, time: number): void {
    let lift = 0;
    if (k.rescue > 0) { const t = k.rescue / RESCUE_T; lift = (t > 0.5 ? 1 - (t - 0.5) * 2 : t * 2) * 4; }
    this.lift = lift;
    this.root.position.set(this.ix, this.iy + 0.05 + lift, this.iz);
    this.root.rotation.set(0, this.ih, 0);
    const kd = 1 - Math.exp(-10 * dt);
    this.pitch += (-Math.atan(k.slope) - this.pitch) * kd;
    this.root.rotation.x = this.pitch;
    // suspension spring
    if (dt > 0) {
      this.susV += (-140 * this.sus - 13 * this.susV) * dt; this.sus += this.susV * dt; this.sus = clamp(this.sus, -0.4, 0.4);
      const accel = (k.sp - this.lastSp) / Math.max(dt, 1e-3); this.lastSp = k.sp;
      this.pitchAcc += (clamp(-accel * 0.004, -0.08, 0.08) - this.pitchAcc) * (1 - Math.exp(-6 * dt));
    }
    const dy = k.drifting ? -k.driftDir * 0.45 : 0;
    this.yaw += (dy - this.yaw) * kd;
    const spinA = k.spin > 0 ? (1 - k.spin / SPIN_T) * 4 * Math.PI : 0;
    this.lean += (k.steerS * Math.min(1, Math.abs(k.sp) / 30) * (k.drifting ? 0.16 : 0.09) - this.lean) * (1 - Math.exp(-8 * dt));
    this.body.rotation.set(this.pitchAcc + (k.boost > 0 ? -0.05 : 0), this.yaw + spinA, this.lean);
    const hop = k.hop > 0 ? Math.sin(Math.PI * (1 - k.hop / 0.25)) * 0.55 : 0;
    this.hopH = hop;
    this.body.position.y = this.sus + hop;
    this.body.scale.set(1 - this.sus * 0.35, 1 + this.sus * 0.7, 1 - this.sus * 0.35);
    this.body.visible = (k.invuln <= 0 || Math.floor(time * 14) % 2 === 0) && !(k.rescue > 0 && Math.abs(k.rescue - RESCUE_T / 2) < 0.08);
    this.rear.rotation.x += (k.sp * dt) / 0.68;
    for (const w of this.fronts) w.rotation.x += (k.sp * dt) / 0.55;
    for (const p of this.pivots) p.rotation.y = -k.steerS * 0.45;
    this.head.rotation.y += (-k.steerS * 0.45 - (k.drifting ? k.driftDir * 0.25 : 0) - this.head.rotation.y) * (1 - Math.exp(-8 * dt));
    this.head.rotation.z = k.spin > 0 ? Math.sin(time * 20) * 0.25 : -this.lean * 0.6;
    const boosting = k.boost > 0;
    for (const f of this.flames) {
      f.visible = boosting;
      if (boosting) {
        // deterministic flicker (no Math.random in the render path, so captures are reproducible)
        const n = Math.sin(time * 71 + f.position.x * 13) * 0.5 + 0.5, m = Math.sin(time * 53 + f.position.x * 7) * 0.5 + 0.5;
        const s = 0.8 + n * 0.45;
        f.scale.set(s, s, s * (0.9 + m * 0.6) * (k.boostTier === 3 ? 1.4 : 1));
      }
    }
    if (boosting) this.flameMat.color.setHex(k.boostTier === 3 ? 0xe040fb : k.boostTier === 2 ? 0x40c4ff : 0xffa726);
    this.shield.visible = k.shield > 0;
    if (k.shield > 0) {
      this.shield.rotation.y += dt * 1.5;
      (this.shield.material as THREE.MeshLambertMaterial).opacity = 0.22 + Math.sin(time * 6) * 0.06 + (k.shield < 2 ? (Math.floor(time * 8) % 2) * 0.15 : 0);
    }
    this.stars.visible = k.spin > 0; if (k.spin > 0) this.stars.rotation.y += dt * 9;
    this.drone.visible = k.rescue > 0; if (k.rescue > 0) { this.drone.position.y = 5.3; this.drone.rotation.y += dt * 3; }
    this.shadow.position.y = 0.06 - lift;
    this.shadow.scale.setScalar(1 - Math.min(0.5, (hop + lift) * 0.1));
  }

  /**
   * Name tag for one viewport: hidden for the viewer's own kart, faded in from 9-14 m (no giant tags near the
   * camera) and out from 48-60 m (section 9). Scaled with distance so far tags stay readable and near ones stay small.
   */
  updateTag(camX: number, camZ: number, isViewer: boolean, racing: boolean): void {
    const d = Math.hypot(this.ix - camX, this.iz - camZ);
    this.tag.visible = !isViewer && racing && d > 9 && d < 60;
    if (!this.tag.visible) return;
    (this.tag.material as THREE.SpriteMaterial).opacity = Math.min(clamp((d - 9) / 5, 0, 1), clamp((60 - d) / 12, 0, 1));
    const sc = clamp(d / 24, 0.6, 1.6);
    this.tag.scale.set(4.6 * sc, 1.15 * sc, 1);
    this.tag.position.y = 3.6 + sc * 0.9;
  }

  /** Podium pose for place i (0 = winner). */
  podiumPose(i: number, x: number, y: number, z: number, ry: number, t: number): void {
    const hop = i === 0 ? Math.abs(Math.sin(t * 4)) * 0.9 : Math.abs(Math.sin(t * 3 + i)) * 0.35;
    this.root.position.set(x, y + 0.02, z); this.root.rotation.set(0, ry, 0);
    this.body.position.y = hop; this.body.rotation.set(0, i === 0 ? Math.sin(t * 2) * 0.3 : 0, 0); this.body.scale.set(1, 1, 1); this.body.visible = true;
    this.head.rotation.set(0, Math.sin(t * 1.5 + i) * 0.4, Math.sin(t * 3 + i) * 0.15);
    for (const f of this.flames) f.visible = false;
    this.shield.visible = false; this.stars.visible = false; this.drone.visible = false; this.tag.visible = false;
    this.shadow.position.y = 0.06;
  }

  dispose(): void {
    this.flameMat.dispose();
    (this.shield.material as THREE.Material).dispose();
    const tm = this.tag.material as THREE.SpriteMaterial;
    tm.map?.dispose(); tm.dispose();
  }
}
