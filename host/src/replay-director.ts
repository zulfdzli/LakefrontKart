/**
 * D68 race highlights: plays the picked moments of a finished race, each from a fresh deterministic re-simulation
 * (shared/src/replay.ts), in slow motion around the key instant, with a broadcast camera and a caption.
 *
 * Cameras by kind: a low trackside camera beside a jump's flight path (looking up at the kart), a zooming trackside
 * camera ahead of an overtake or at the line for a finish, and a chase camera behind a kart that is hit.
 */
import * as THREE from 'three';
import {
  MOVE_INFO,
  MOVE_OF,
  STEP,
  posOnTrack,
  ReplaySim,
  type GameEvent,
  type GameOptions,
  type GameState,
  type Kart,
  type Moment,
  type ReplayLog,
} from '@tk/shared';
import type { World } from './renderer';
import type { Audio } from './audio';

const SLOW = 0.3;

export class ReplayDirector {
  readonly camera = new THREE.PerspectiveCamera(55, 16 / 9, 0.5, 3200);
  readonly focus = new THREE.Vector3();
  private readonly sim: ReplaySim;
  private ci = -1;
  private acc = 0;
  private speed = 1;
  done = false;
  private readonly look = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private fixed = true;
  private side = 1;
  private readonly tmp = { x: 0, y: 0, z: 0 };
  private readonly cap: HTMLElement;
  private readonly bars: HTMLElement;
  /** Called between clips (the host fades through its veil); null = cut. */
  cut: ((swap: () => void) => void) | null = null;
  private cutting = false;

  constructor(
    opts: GameOptions,
    log: ReplayLog,
    readonly clips: readonly Moment[],
    private readonly world: World,
    private readonly audio: Audio,
    private readonly nameOf: (k: Kart) => string,
  ) {
    this.sim = new ReplaySim(opts, log);
    this.bars = document.createElement('div');
    this.bars.className = 'replayBars';
    this.cap = document.createElement('div');
    this.cap.className = 'replayCap';
    this.cap.innerHTML = '<i>● REPLAY</i><b></b><span></span>';
    document.body.append(this.bars, this.cap);
    requestAnimationFrame(() => this.bars.classList.add('on'));
  }

  get state(): Readonly<GameState> {
    return this.sim.game.getSnapshot();
  }
  /** Interpolation between the last two replay steps. */
  get alpha(): number {
    return Math.min(1, this.acc / STEP);
  }

  /** Go to clip i: fast-forward the re-simulation to its start (behind the host's fade) and frame it. */
  private enter(i: number): void {
    this.ci = i;
    const m = this.clips[i];
    if (!m) {
      this.done = true;
      return;
    }
    this.sim.seek(m.from);
    this.acc = 0;
    this.speed = 1;
    for (const v of this.world.views) v.resetMotion();
    this.world.effects?.clearAll(this.world.views);
    this.frameCamera(m, true);
    const s = this.state,
      k = s.karts[m.kart]!,
      o = m.other !== undefined ? s.karts[m.other] : undefined;
    const who = this.nameOf(k).toUpperCase(),
      them = o ? this.nameOf(o).toUpperCase() : '';
    const [title, sub] =
      m.kind === 'air'
        ? [`${(m.air ?? 0).toFixed(1)} s BIG AIR!`, who]
        : m.kind === 'hit'
          ? ['DIRECT HIT!', `${who} gets taken out`]
          : m.kind === 'ko'
            ? ['KNOCKED OUT!', `${who} is out of the brawl`]
            : m.kind === 'pass'
              ? [`${who} PASSES ${them}`, 'OVERTAKE']
              : m.kind === 'photo'
                ? ['PHOTO FINISH!', `${who} and ${them}`]
                : m.kind === 'move'
                  ? [`${MOVE_INFO[MOVE_OF[k.ch.id] ?? 'charge'].name.toUpperCase()}!`, them ? `${who} on ${them}` : who]
                  : [`${who} WINS!`, 'ACROSS THE LINE'];
    this.cap.querySelector('b')!.textContent = title;
    this.cap.querySelector('span')!.textContent = sub;
    this.cap.classList.remove('on');
    void this.cap.offsetWidth;
    this.cap.classList.add('on');
  }

  /** Place the camera for a clip (fixed trackside spots are chosen once; the chase camera follows). */
  private frameCamera(m: Moment, snap: boolean): void {
    const T = this.state.track,
      N = T.N;
    // the side of the road away from the kart, so the camera sees it pass with room to spare
    this.side = m.lat > 0 ? -1 : 1;
    this.fixed = m.kind !== 'hit' && m.kind !== 'ko' && m.kind !== 'move';
    if (!this.fixed) return;
    let i: number, lat: number, up: number;
    if (m.kind === 'air') {
      // beside the middle of the flight, low, looking up at the kart
      const i0 = m.idx0 ?? m.idx;
      const span = (m.idx - i0 + N) % N;
      i = (i0 + Math.round(span * 0.55)) % N;
      lat = this.side * (T.HW[i]! + 2.6);
      up = 1.5;
    } else if (m.kind === 'pass') {
      i = (m.idx + 14) % N; // ahead of where the pass happens: the karts come at the camera and go by
      lat = this.side * (T.HW[i]! + 2.6);
      up = 2.4;
    } else {
      i = 7 % N; // just past the line (clear of the gantry posts), a photo-finish camera
      lat = this.side * (T.HW[i]! + 3);
      up = 1.5;
    }
    // never right beside an item box row (the boxes would fill the shot): step along the road until clear
    const boxes = this.state.boxes;
    for (let t = 0; t < 8; t++) {
      posOnTrack(T, i, lat, this.tmp);
      if (boxes.every((b) => Math.hypot(b.x - this.tmp.x, b.z - this.tmp.z) > 14)) break;
      i = (i + 4) % N;
      lat = Math.sign(lat) * (T.HW[i]! + 2.6);
    }
    // inside the walls (tunnels have them close), on the run-off, clear of the tall grass further out
    lat = Math.sign(lat) * Math.min(Math.abs(lat), T.WALLD[i]! - 1.2);
    posOnTrack(T, i, lat, this.tmp);
    this.camPos.set(this.tmp.x, this.tmp.y + up, this.tmp.z);
    const g = this.world.terrain.terrainH(this.camPos.x, this.camPos.z) + 0.8;
    if (this.camPos.y < g) this.camPos.y = g;
    this.camera.position.copy(this.camPos);
    if (snap) {
      const k = this.state.karts[m.kart]!;
      this.look.set(k.x, k.y + 0.8, k.z);
    }
  }

  private updateCamera(dt: number): void {
    const m = this.clips[this.ci]!,
      k = this.state.karts[m.kart]!;
    const kp = 1 - Math.exp(-7 * dt);
    if (this.fixed) {
      this.look.lerp(this.focus.set(k.x, k.y + 0.9, k.z), kp);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.look);
      // broadcast zoom: keep the kart about the same size on screen as it comes and goes
      const d = this.camera.position.distanceTo(this.look);
      this.camera.fov = THREE.MathUtils.clamp(THREE.MathUtils.radToDeg(2 * Math.atan(7 / d)), 14, 62);
    } else {
      const sp = Math.hypot(k.vx, k.vz),
        dx = sp > 3 ? k.vx / sp : Math.sin(k.h),
        dz = sp > 3 ? k.vz / sp : Math.cos(k.h);
      const want = this.tmp;
      want.x = k.x - dx * 7.5;
      want.y = k.y + 3;
      want.z = k.z - dz * 7.5;
      this.camera.position.lerp(new THREE.Vector3(want.x, want.y, want.z), kp);
      const g = this.world.terrain.terrainH(this.camera.position.x, this.camera.position.z) + 1;
      if (this.camera.position.y < g) this.camera.position.y = g;
      this.look.lerp(this.focus.set(k.x + dx * 3, k.y + 0.8, k.z + dz * 3), kp);
      this.camera.lookAt(this.look);
      this.camera.fov = 60;
    }
    this.camera.updateProjectionMatrix();
  }

  /** Advance the replay by a frame; returns the events of the steps taken (for effects and sounds). */
  update(dt: number, aspect: number): GameEvent[] {
    if (this.camera.aspect !== aspect) this.camera.aspect = aspect;
    if (this.done) return [];
    if (this.ci < 0) {
      this.enter(0);
      this.updateCamera(1);
      return [];
    }
    const m = this.clips[this.ci]!;
    const events: GameEvent[] = [];
    if (!this.cutting) {
      const st = this.sim.step;
      const target = st >= m.slowFrom && st < m.slowTo ? SLOW : 1;
      this.speed += (target - this.speed) * Math.min(1, dt * 7);
      this.acc += dt * this.speed;
      let n = 0;
      while (this.acc >= STEP && n < 5) {
        events.push(...this.sim.advance());
        this.acc -= STEP;
        n++;
      }
      if (this.sim.step >= m.to) {
        const next = this.ci + 1;
        if (next >= this.clips.length) this.done = true;
        else if (this.cut) {
          this.cutting = true;
          this.cut(() => {
            this.cutting = false;
            this.enter(next);
            this.updateCamera(1);
          });
        } else this.enter(next);
      }
    }
    if (this.ci >= 0 && this.ci < this.clips.length) this.updateCamera(dt);
    for (const e of events) this.sound(e);
    return events;
  }

  /** Slow motion only for the audio's tempo: a few replay sounds. */
  private sound(e: GameEvent): void {
    const a = this.audio;
    switch (e.type) {
      case 'land':
        a.noiseHit((e.t ?? 0) > 0.9 ? 0.3 : 0.18, 0.25, 320);
        break;
      case 'jump':
        a.tone(420, 0.4, 'triangle', 0.06, 900);
        break;
      case 'orbhit':
      case 'bolthit':
      case 'comethit':
      case 'hit':
        a.noiseHit(0.5, 0.45, 300);
        break;
      case 'finish':
        a.tone(520, 0.6, 'triangle', 0.1, 1040);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.cap.remove();
    this.bars.remove();
  }
}
