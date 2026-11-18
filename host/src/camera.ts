/**
 * Per-player chase camera (prototype): smoothed heading, speed-based FOV and distance, a countdown swing-in,
 * shake on hits, and FOV kick on boost. Plus the lobby orbit and the podium camera. Frame-rate independent.
 */
import * as THREE from 'three';
import { COUNTDOWN_T, clamp, smooth01, wrapA, type GameState, type Kart } from '@tk/shared';
import type { KartView } from './art/kart';
import type { Podium } from './art/track-builder';

export type CamMode = 'orbit' | 'chase' | 'podium';

export class ChaseCam {
  readonly camera = new THREE.PerspectiveCamera(70, 1, 0.5, 3200);
  readonly focus = new THREE.Vector3();
  mode: CamMode = 'orbit';
  /** Lobby: a wide, high orbit over the grid instead of a close-up of one kart. */
  wideOrbit = false;
  private baseFov = 66;
  private camH = 0;
  /** How much the camera follows the travel direction instead of the nose (0..1), smoothed. */
  private travelW = 0.35;
  private init = false;
  private fovKick = 0;
  shake = 0;
  private spin = 0;
  private podT = 0;
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // narrow viewports get a wider vertical FOV so the road stays in view (prototype baseFov)
    this.baseFov = aspect < 1 ? 82 : 66;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to the chase position on the next update (after a teleport or a fast-forward). */
  snap(headingTo: number): void {
    this.camH = headingTo;
    this.init = false;
  }

  reset(headingTo: number): void {
    this.camH = headingTo;
    this.init = false;
    this.fovKick = 0;
    this.shake = 0;
    this.podT = 0;
  }

  private setFov(f: number, dt: number): void {
    if (Math.abs(this.camera.fov - f) > 0.01) {
      // the prototype used 0.15 per 60 Hz frame; convert to a rate so it is frame-rate independent
      this.camera.fov += (f - this.camera.fov) * (1 - Math.pow(0.85, dt * 60));
      this.camera.updateProjectionMatrix();
    }
  }

  update(dt: number, s: Readonly<GameState>, k: Kart, v: KartView, podium: Podium | null): void {
    const cam = this.camera,
      ix = v.ix,
      iy = v.iy,
      iz = v.iz;
    if (this.mode === 'orbit') {
      this.spin += dt * 0.3;
      if (this.wideOrbit) {
        const a = k.h + 2.2 + this.spin * 0.25,
          d = 34;
        cam.position.set(ix + Math.sin(a) * d, iy + 13, iz + Math.cos(a) * d);
        cam.lookAt(ix + Math.sin(k.h) * 6, iy + 1, iz + Math.cos(k.h) * 6);
        this.setFov(this.baseFov - 8, dt);
        this.focus.set(ix, iy, iz);
        return;
      }
      const a = k.h + 0.9 + Math.sin(this.spin) * 0.9,
        d = cam.aspect < 1 ? 10.5 : 8.2;
      cam.position.set(ix + Math.sin(a) * d, iy + 2.8, iz + Math.cos(a) * d);
      cam.lookAt(ix, iy + (cam.aspect < 1 ? -0.8 : 0.2), iz);
      this.setFov(this.baseFov - 18, dt);
      this.focus.set(ix, iy, iz);
      return;
    }
    if (this.mode === 'podium' && podium) {
      this.podT += dt;
      const sn = Math.sin(podium.ry),
        cs = Math.cos(podium.ry),
        d = 17 + Math.sin(this.podT * 0.4) * 1.5,
        side = Math.sin(this.podT * 0.25) * 4;
      // wide screens: frame the podium left of centre, so the results panel on the right does not cover it
      const shift = cam.aspect > 4 / 3 ? 5.5 : 0;
      cam.position.set(
        podium.x + sn * d + cs * (side + shift),
        podium.y + 5.6,
        podium.z + cs * d - sn * (side + shift),
      );
      cam.lookAt(podium.x + cs * shift, podium.y + (cam.aspect < 1 ? 4.6 : 3.2), podium.z - sn * shift);
      this.setFov(cam.aspect < 1 ? 70 : 52, dt);
      this.focus.set(podium.x, podium.y, podium.z);
      return;
    }
    // aim between the nose and the direction of travel: in a drift the camera keeps following the line the kart is
    // sliding along, so the body is seen angled sideways (D35) instead of the whole view swinging with the nose
    const vMag = Math.hypot(k.vx, k.vz);
    this.travelW += ((k.drifting ? 0.8 : 0.35) - this.travelW) * (1 - Math.exp(-3 * dt));
    const slip = vMag > 4 && k.sp > 0 ? clamp(wrapA(Math.atan2(k.vx, k.vz) - v.ih), -0.7, 0.7) : 0;
    const aimH = v.ih + slip * this.travelW;
    this.camH += wrapA(aimH - this.camH) * (1 - Math.exp(-4.5 * dt));
    const intro = s.phase === 'countdown' ? smooth01((COUNTDOWN_T - s.cd) / 2.4) : s.phase === 'grid' ? 0 : 1;
    const a = this.camH + Math.PI * (1 - intro);
    this.fovKick += ((k.boost > 0 ? 1 : 0) - this.fovKick) * (1 - Math.exp(-6 * dt));
    const dist = 9.8 + Math.max(0, k.sp) * 0.03 + this.fovKick * 1.4 + (1 - intro) * 3;
    const hgt = 4.0 + (1 - intro) * 2.5;
    this.target.set(ix - Math.sin(a) * dist, iy + hgt, iz - Math.cos(a) * dist);
    if (!this.init) {
      cam.position.copy(this.target);
      this.init = true;
    } else cam.position.lerp(this.target, 1 - Math.exp(-8 * dt));
    this.look.set(ix + Math.sin(this.camH) * 8 * intro, iy + 1.6, iz + Math.cos(this.camH) * 8 * intro);
    cam.lookAt(this.look);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const sk = this.shake * this.shake * 0.9,
        t = s.time;
      cam.position.x += Math.sin(t * 53) * sk;
      cam.position.y += Math.sin(t * 61 + 1) * sk * 0.6;
      cam.position.z += Math.cos(t * 47) * sk;
    }
    this.setFov(this.baseFov + Math.max(0, k.sp) * 0.16 + this.fovKick * 7, dt);
    this.focus.set(ix, iy, iz);
  }
}
