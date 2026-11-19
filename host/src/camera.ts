/**
 * Per-player chase camera (prototype): smoothed heading, speed-based FOV and distance, a countdown swing-in,
 * shake on hits, and FOV kick on boost. Plus the lobby orbit and the podium camera. Frame-rate independent.
 */
import * as THREE from 'three';
import { COUNTDOWN_T, clamp, posOnTrack, smooth01, wrapA, type GameState, type Kart } from '@tk/shared';
import type { KartView } from './art/kart';
import type { Podium } from './art/track-builder';

export type CamMode = 'orbit' | 'intro' | 'chase' | 'finish' | 'podium';

/** Race intro flyover length (s), section 12.4. */
export const INTRO_T = 4.2;

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
  private spinBack = 0;
  introT = 0;
  private readonly fly = { x: 0, y: 0, z: 0 };
  private readonly flyLook = { x: 0, y: 0, z: 0 };
  private readonly target = new THREE.Vector3();
  private readonly look = new THREE.Vector3();

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    // narrower viewports get a wider vertical FOV so the road and the corners stay in view (prototype baseFov,
    // made continuous for the split-screen shapes: 66° at 16:10 and wider, up to 82° for tall views)
    this.baseFov = Math.max(66, Math.min(82, 66 + (1.6 - aspect) * 23));
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
    if (this.mode === 'intro') {
      // section 12.4 race intro: start high over the track well ahead of the grid and fly back down it towards
      // the field, ending just in front of this player's car looking back at it, where the countdown swing begins
      this.introT += dt;
      const T = s.track,
        u = clamp(this.introT / INTRO_T, 0, 1),
        e = smooth01(u);
      const endAhead = 12.4 / T.DS;
      const ahead = endAhead + (1 - e) * T.N * 0.14;
      const side = Math.sin(u * Math.PI) * 22 * (k.id % 2 ? 1 : -1);
      posOnTrack(T, k.idx + ahead, k.lat * e + side * (1 - e * 0.6), this.fly);
      posOnTrack(T, k.idx + ahead - 45 / T.DS, k.lat, this.flyLook);
      cam.position.set(this.fly.x, this.fly.y + 6.7 + (1 - e) * 46, this.fly.z);
      const lx = this.flyLook.x + (ix - this.flyLook.x) * e,
        ly = this.flyLook.y + (iy + 1.6 - this.flyLook.y) * e,
        lz = this.flyLook.z + (iz - this.flyLook.z) * e;
      cam.lookAt(lx, ly, lz);
      this.setFov(this.baseFov + 6 * (1 - e), dt);
      this.focus.set(lx, ly, lz);
      this.camH = k.h;
      this.init = false;
      return;
    }
    if (this.mode === 'finish') {
      // after this player finishes (section 6.2): a slow, wide orbit around their kart, eased in from the chase
      // position so the cut is a swing rather than a jump; the kart sits below the FINISHED banner
      this.spin += dt * 0.25;
      const a = v.ih + Math.PI * 0.75 + this.spin,
        d = cam.aspect < 1 ? 15 : 13;
      this.target.set(ix + Math.sin(a) * d, iy + 5.2, iz + Math.cos(a) * d);
      cam.position.lerp(this.target, 1 - Math.exp(-2.5 * dt));
      cam.lookAt(ix, iy + 2.2, iz);
      this.setFov(this.baseFov - 6, dt);
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
    // D54: a low, tight broadcast-style chase view (your reference): about 3.5 m behind the rear wing, just above
    // the roofline, so the car's rear fills the lower middle of the screen and the horizon sits about 40% down
    // in a drift the car swings sideways and slides at the camera: ease back about 1.8 m (travelW 0.35 to 0.8)
    // and while spinning out (oil, hits) the body whips round: ease back up to 3.2 m (quickly in, slowly out)
    this.spinBack += ((k.spin > 0 ? 3.2 : 0) - this.spinBack) * (1 - Math.exp(-(k.spin > 0 ? 10 : 3) * dt));
    const driftBack = Math.max(0, this.travelW - 0.35) * 4 + this.spinBack;
    const dist = 6.5 + Math.max(0, k.sp) * 0.012 + this.fovKick * 0.8 + driftBack + (1 - intro) * 4;
    // D55: higher (3.3 m), looking down onto the roof and wing as in your second reference
    const hgt = 3.3 + (1 - intro) * 2.5;
    // the follow below trails the car by about speed / 8 m; lead the target by most of that, so the framing stays
    // the same at any speed (a little trail is kept for the sense of speed)
    const lead = intro * 0.82 * (1 / 8);
    this.target.set(ix - Math.sin(a) * dist + k.vx * lead, iy + hgt, iz - Math.cos(a) * dist + k.vz * lead);
    if (!this.init) {
      cam.position.copy(this.target);
      this.init = true;
    } else cam.position.lerp(this.target, 1 - Math.exp(-8 * dt));
    this.look.set(ix + Math.sin(this.camH) * 12 * intro, iy + 0.9, iz + Math.cos(this.camH) * 12 * intro);
    cam.lookAt(this.look);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.2);
      const sk = this.shake * this.shake * 0.9,
        t = s.time;
      cam.position.x += Math.sin(t * 53) * sk;
      cam.position.y += Math.sin(t * 61 + 1) * sk * 0.6;
      cam.position.z += Math.cos(t * 47) * sk;
    }
    // a slightly narrower lens than before (baseFov - 6), widening with speed and boost
    this.setFov(this.baseFov - 6 + Math.max(0, k.sp) * 0.15 + this.fovKick * 6, dt);
    this.focus.set(ix, iy, iz);
  }
}
