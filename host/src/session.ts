/**
 * One race on the host: owns the Game, a camera and HUD per human player, and the fixed-step loop
 * (60 Hz, at most 5 substeps per frame, render interpolation, hit-stop). Routes simulation events
 * to effects, audio and the right player's HUD.
 */
import * as THREE from 'three';
import {
  STEP,
  createGame,
  type Game,
  type GameEvent,
  type GameOptions,
  type GameState,
  type HapticKind,
  type HudUpdate,
  type Kart,
  type Phase,
} from '@tk/shared';
import { World, type Rect, type ViewToRender } from './renderer';
import { ChaseCam } from './camera';
import { PlayerHud, MinimapBase, ord } from './hud';
import { SpeedLines } from './art/effects';
import { kartPaint } from './art/palette';
import { hexStr } from './art/geo';
import type { Audio } from './audio';

const MAX_SUBSTEPS = 5;
/** Seconds between the race ending and the podium (prototype). */
const RESULTS_DELAY = 3;

export interface PlayerView {
  slot: number;
  kart: Kart;
  cam: ChaseCam;
  hud: PlayerHud;
  lines: SpeedLines;
  rect: Rect;
}

export type SessionStage = 'preview' | 'racing' | 'podium';

export class RaceSession {
  readonly game: Game;
  readonly s: Readonly<GameState>;
  readonly players: PlayerView[] = [];
  stage: SessionStage = 'preview';
  paused = false;
  private acc = 0;
  private hitStop = 0;
  private doneT = 0;
  private podT = 0;
  private podiumOrder: Kart[] = [];
  private readonly minimap: MinimapBase;
  private readonly camPositions: THREE.Vector3[] = [];
  onResults: ((order: Kart[]) => void) | null = null;
  /** Feedback for a player's phone (vibration). */
  onHaptic: ((slot: number, kind: HapticKind) => void) | null = null;

  constructor(
    opts: GameOptions,
    private readonly world: World,
    private readonly audio: Audio,
    hudLayer: HTMLElement,
    names: Map<number, string>,
  ) {
    this.game = createGame(opts);
    this.s = this.game.getSnapshot();
    world.build(this.s, names);
    this.minimap = new MinimapBase(this.s.track);
    const colorOf = (k: Kart): number => kartPaint(k.slot);
    for (const k of this.s.humans) {
      const hud = new PlayerHud(hudLayer, this.minimap, colorOf, hexStr(kartPaint(k.slot)));
      const cam = new ChaseCam();
      cam.reset(k.h);
      this.players.push({
        slot: k.slot!,
        kart: k,
        cam,
        hud,
        lines: new SpeedLines(hud.fx.getContext('2d')!),
        rect: { x: 0, y: 0, w: 1, h: 1 },
      });
    }
    this.setStage('preview');
  }

  /** Assign each player's viewport rectangle (CSS px, top-left origin). */
  layout(rects: Rect[]): void {
    this.players.forEach((p, i) => {
      const r = rects[i] ?? rects[0]!;
      p.rect = r;
      p.cam.setAspect(r.w / r.h);
      p.hud.place(r);
    });
  }

  setStage(stage: SessionStage): void {
    this.stage = stage;
    for (const p of this.players) {
      p.cam.mode = stage === 'preview' ? 'orbit' : stage === 'podium' ? 'podium' : 'chase';
      p.hud.setVisible(stage === 'racing');
    }
    this.world.setVisibleKarts(stage === 'podium' ? new Set(this.podiumOrder.slice(0, 3).map((k) => k.id)) : null);
    this.audio.mood = stage === 'preview' ? 'menu' : stage === 'podium' ? 'podium' : 'race';
  }

  start(): void {
    this.world.effects?.clearAll(this.world.views);
    for (const p of this.players) {
      p.cam.reset(p.kart.h);
      p.hud.reset();
    }
    for (const v of this.world.views) v.resetMotion();
    this.audio.tempo = 1;
    this.setStage('racing');
    this.game.startCountdown();
  }

  setInput(slot: number, inp: Parameters<Game['setInput']>[1]): void {
    this.game.setInput(slot, inp);
  }

  /** Advance the simulation synchronously (capture tool and tests). */
  advance(seconds: number): void {
    const n = Math.round(seconds / STEP);
    for (let i = 0; i < n; i++) {
      this.game.step(STEP);
      this.handleEvents(this.game.drainEvents());
    }
    // a fast-forward is a teleport for the cameras: snap instead of smoothing across the gap
    for (const p of this.players) p.cam.snap(p.kart.h);
  }

  frame(dt: number): void {
    const s = this.s;
    const live = !this.paused;
    if (live && this.stage === 'racing') {
      if (this.hitStop > 0) this.hitStop -= dt;
      else {
        this.acc += dt;
        let steps = 0;
        while (this.acc >= STEP && steps < MAX_SUBSTEPS) {
          this.game.step(STEP);
          this.handleEvents(this.game.drainEvents());
          this.acc -= STEP;
          steps++;
        }
        if (steps >= MAX_SUBSTEPS) this.acc = 0;
      }
      if (s.phase === 'finished') {
        this.doneT += dt;
        if (this.doneT > RESULTS_DELAY) this.showPodium();
      }
    } else if (live && this.stage === 'preview') {
      this.game.step(STEP); // grid phase: only keeps time moving for ambient animation
      this.game.drainEvents();
    }
    const alpha = Math.min(1, Math.max(0, this.acc / STEP));
    const pdt = this.paused ? 0 : dt;

    this.camPositions.length = 0;
    for (const p of this.players) this.camPositions.push(p.cam.camera.position);
    if (this.stage === 'podium') {
      this.podT += pdt;
      this.world.podiumPose(this.podiumOrder, this.podT);
      const pd = this.world.podium;
      if (pdt > 0) this.world.effects?.podiumConfetti(pd.x, pd.y, pd.z);
    } else this.world.syncKarts(s, alpha, pdt, this.camPositions);
    this.world.updateAmbient(s, pdt, this.stage === 'podium');

    for (const p of this.players) {
      p.cam.update(this.paused ? 0.0001 : dt, s, p.kart, this.world.views[p.kart.id]!, this.world.podium);
      if (this.stage === 'racing') {
        p.hud.update(s, p.kart);
        const k = p.kart,
          strength = !this.paused ? (k.boost > 0 ? 1 : k.drafting ? 0.5 : 0) : 0;
        p.lines.draw(strength, 0, 0, p.rect.w, p.rect.h);
      } else p.lines.draw(0, 0, 0, p.rect.w, p.rect.h);
    }
    const lead = this.players[0];
    if (lead) {
      const k = lead.kart;
      this.audio.engine(
        this.stage === 'racing' && !this.paused,
        k.sp,
        k.boost > 0,
        k.drifting || (k.wall && Math.abs(k.sp) > 10),
      );
    }
  }

  /** The phase phones should show. */
  netPhase(): Phase {
    if (this.stage === 'preview') return 'lobby';
    if (this.stage === 'podium') return 'results';
    if (this.paused) return 'paused';
    return this.s.phase === 'countdown' || this.s.phase === 'grid' ? 'countdown' : 'race';
  }

  /** Small status for a player's phone (section 5.3 'hud'). */
  hudFor(p: PlayerView): HudUpdate {
    const k = p.kart,
      s = this.s;
    return {
      place: k.rank + 1,
      totalRacers: s.karts.length,
      lap: Math.max(1, Math.min(s.laps, k.lap)),
      laps: s.laps,
      item: k.roll > 0 ? 'roll' : k.item,
      itemUses: k.itemUses,
      boosting: k.boost > 0,
      drifting: k.drifting,
      driftLevel: k.drifting ? k.driftLevel : 0,
      finished: k.finished,
    };
  }

  views(): ViewToRender[] {
    return this.players.map((p) => ({
      camera: p.cam.camera,
      rect: p.rect,
      viewerKart: this.stage === 'podium' ? -1 : p.kart.id,
      tags: this.stage === 'racing',
    }));
  }

  focusOf(v: ViewToRender): THREE.Vector3 {
    const p = this.players.find((pl) => pl.cam.camera === v.camera);
    return p ? p.cam.focus : new THREE.Vector3();
  }

  private showPodium(): void {
    if (this.stage === 'podium') return;
    this.podiumOrder = this.s.standings ?? this.game.updateRanks();
    this.podT = 0;
    this.setStage('podium');
    this.world.hideTags();
    const best = Math.min(...this.players.map((p) => p.kart.rank));
    if (best <= 2) {
      const a = this.audio;
      a.tone(523, 0.18, 'triangle', 0.12);
      a.tone(659, 0.18, 'triangle', 0.12, 0, a.at(0.18));
      a.tone(784, 0.4, 'triangle', 0.12, 0, a.at(0.36));
    }
    this.onResults?.(this.podiumOrder);
  }

  private playerOf(kartId: number): PlayerView | undefined {
    return this.players.find((p) => p.kart.id === kartId);
  }

  private handleEvents(events: GameEvent[]): void {
    const s = this.s,
      a = this.audio;
    for (const e of events) {
      const k = e.kart >= 0 ? s.karts[e.kart]! : null;
      const v = k ? this.world.views[k.id]! : null;
      const me = k ? this.playerOf(k.id) : undefined;
      let near = true;
      if (k) {
        near = false;
        for (const p of this.players)
          if (Math.hypot(k.x - p.cam.camera.position.x, k.z - p.cam.camera.position.z) < 110) near = true;
      }
      this.world.effects?.onEvent(e, k, v, near);
      switch (e.type) {
        case 'cd':
          a.tone(440, 0.2, 'square', 0.1);
          break;
        case 'go':
          a.tone(880, 0.5, 'square', 0.12);
          break;
        case 'driftstart':
          if (me) a.tone(220, 0.12, 'sawtooth', 0.05, 330);
          break;
        case 'driftlevel':
          if (me) {
            a.tone(520 + (e.lvl ?? 1) * 200, 0.12, 'triangle', 0.1);
            this.onHaptic?.(me.slot, `drift${Math.min(3, Math.max(1, e.lvl ?? 1))}` as HapticKind);
          }
          break;
        case 'boost':
          if (me) {
            a.tone(200, 0.5, 'sawtooth', 0.09, 760);
            me.hud.flash('boost');
            this.onHaptic?.(me.slot, 'boost');
          }
          break;
        case 'perfect':
          if (me) {
            me.hud.say('ROCKET START!', 1100, 'small gold');
            a.tone(660, 0.12, 'square', 0.1);
            a.tone(990, 0.3, 'square', 0.1, 0, a.at(0.1));
          }
          break;
        case 'stall':
          if (me) {
            me.hud.say('TOO EARLY!', 1000, 'small');
            a.tone(120, 0.5, 'sawtooth', 0.12, 50);
          }
          break;
        case 'pad':
          if (me) me.hud.say('BOOST!', 600, 'small blue');
          break;
        case 'pickup': {
          const b = s.boxes[e.box ?? -1];
          if (b && near) this.world.effects?.pickupBurst(b.x, b.y, b.z);
          if (me) a.tone(660, 0.15, 'triangle', 0.1, 990);
          break;
        }
        case 'item':
          if (me) {
            a.tone(880, 0.18, 'square', 0.08);
            this.onHaptic?.(me.slot, 'item');
          }
          break;
        case 'useturbo':
        case 'useoil':
        case 'useorb':
        case 'usebolt':
          if (me) a.tone(330, 0.2, 'square', 0.08, 120);
          break;
        case 'useshield':
          if (me) a.tone(500, 0.35, 'sine', 0.12, 900);
          break;
        case 'shieldpop':
          if (me) {
            me.hud.say('BLOCKED!', 800, 'small blue');
            a.tone(900, 0.25, 'triangle', 0.12, 400);
          }
          break;
        case 'hit':
        case 'orbhit':
        case 'bolthit':
          if (me) {
            me.hud.say('OUCH!', 900, 'small');
            a.tone(300, 0.5, 'sawtooth', 0.14, 60);
            a.noiseHit(0.3, 0.25, 600);
            me.hud.flash('hit');
            me.cam.shake = 0.7;
            this.hitStop = 0.07;
            this.onHaptic?.(me.slot, 'hit');
          }
          break;
        case 'bump': {
          const other = e.other !== undefined ? this.playerOf(e.other) : undefined;
          for (const p of [me, other])
            if (p) {
              a.tone(110, 0.12, 'square', 0.1, 55);
              p.cam.shake = Math.max(p.cam.shake, 0.35);
            }
          break;
        }
        case 'draft':
          if (me) a.tone(400, 0.3, 'sine', 0.06, 800);
          break;
        case 'rescue':
          if (me) me.hud.say('RESCUE!', 900, 'small');
          break;
        case 'lap':
          if (me && k) {
            if (k.lapTimes.length) me.hud.setLastLap(k.lapTimes[k.lapTimes.length - 1]!);
            if (k.lap >= 2 && k.lap <= s.laps) {
              me.hud.say(k.lap === s.laps ? 'FINAL LAP!' : 'LAP ' + k.lap, 1400, 'small gold');
              a.tone(700, 0.3, 'triangle', 0.1, 1000);
              if (k.lap === s.laps) a.tempo = 1.1;
            }
          }
          break;
        case 'finish':
          if (me && k) {
            me.hud.say(k.rank === 0 ? '1ST PLACE!' : 'FINISHED ' + (k.rank + 1) + ord(k.rank + 1), 2400, 'gold');
            a.tone(520, 0.7, 'triangle', 0.12, 1040);
            this.onHaptic?.(me.slot, 'finish');
          }
          break;
        default:
          break;
      }
    }
  }

  dispose(): void {
    for (const p of this.players) p.hud.dispose();
  }
}
