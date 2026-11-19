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
import { ChaseCam, INTRO_T } from './camera';
import { PlayerHud, MinimapBase, SharedPanel } from './hud';
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
  /** Best time per sector this race (index = sector number). */
  bestSec: (number | null)[];
  cam: ChaseCam;
  hud: PlayerHud;
  lines: SpeedLines;
  rect: Rect;
}

export type SessionStage = 'preview' | 'intro' | 'racing' | 'podium';

export class RaceSession {
  readonly game: Game;
  readonly s: Readonly<GameState>;
  readonly players: PlayerView[] = [];
  stage: SessionStage = 'preview';
  paused = false;
  private acc = 0;
  private hitStop = 0;
  /** Smoothed simulation time per frame (ms). */
  simMs = 0;
  /** Real seconds of photo-finish slow motion left (the simulation runs at 30%). */
  private slowMo = 0;
  private lastFinish: { t: number; human: boolean } | null = null;
  private doneT = 0;
  private podT = 0;
  private podiumOrder: Kart[] = [];
  private readonly minimap: MinimapBase;
  private readonly panel: SharedPanel;
  private readonly camPositions: THREE.Vector3[] = [];
  onResults: ((order: Kart[]) => void) | null = null;
  /** Grand Prix: when the race ends, may reorder the podium (overall standings after the final). */
  podiumFor: ((race: Kart[]) => Kart[] | null) | null = null;
  /** Show the Grand Prix trophy on the podium. */
  trophy = false;
  private introLeft = 0;
  /** Feedback for a player's phone (vibration, countdown, alerts). */
  onHaptic: ((slot: number, kind: HapticKind, n?: number) => void) | null = null;

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
    this.panel = new SharedPanel(hudLayer, this.s.track, colorOf);
    for (const k of this.s.humans) {
      const hud = new PlayerHud(hudLayer, this.minimap, colorOf, hexStr(kartPaint(k.slot)));
      hud.setName(k.name);
      const cam = new ChaseCam();
      cam.reset(k.h);
      this.players.push({
        slot: k.slot!,
        kart: k,
        cam,
        hud,
        lines: new SpeedLines(hud.fx.getContext('2d')!),
        bestSec: [],
        rect: { x: 0, y: 0, w: 1, h: 1 },
      });
    }
    this.setStage('preview');
  }

  /**
   * Assign each player's viewport rectangle (CSS px, top-left origin) and place the shared minimap + standings:
   * in the spare gaps (3 and 5 players), at the screen centre (2 and 4), or in the corner HUD (1 player).
   */
  layout(rects: Rect[], spare: Rect[] = []): void {
    const n = this.players.length,
      multi = n > 1,
      W = window.innerWidth;
    this.players.forEach((p, i) => {
      const r = rects[i] ?? rects[0]!;
      p.rect = r;
      p.cam.setAspect(r.w / r.h);
      p.hud.place(r, multi, multi && r.x + r.w / 2 > W / 2 + 2);
    });
    if (spare.length >= 2) this.panel.place('split', spare[0], spare[1]);
    else this.panel.place(multi ? 'centre' : 'none');
    this.world.setViewCount(n);
  }

  /** A phone dropped or came back: show the reconnecting badge on that player's view. */
  setOffline(slot: number, offline: boolean): void {
    this.players.find((p) => p.slot === slot)?.hud.setOffline(offline);
  }

  setStage(stage: SessionStage): void {
    this.stage = stage;
    for (const p of this.players) {
      p.cam.mode =
        stage === 'preview' ? 'orbit' : stage === 'podium' ? 'podium' : stage === 'intro' ? 'intro' : 'chase';
      p.hud.setVisible(stage === 'racing');
    }
    this.panel.setVisible(stage === 'racing');
    this.world.setVisibleKarts(stage === 'podium' ? new Set(this.podiumOrder.slice(0, 3).map((k) => k.id)) : null);
    this.audio.mood = stage === 'preview' ? 'menu' : stage === 'podium' ? 'podium' : 'race';
    this.world.setTrophy(stage === 'podium' && this.trophy);
    this.world.setCelebrate(stage === 'podium');
  }

  /** Start the race; with `intro`, a track flyover plays before the countdown. */
  start(intro = false): void {
    this.world.effects?.clearAll(this.world.views);
    for (const p of this.players) {
      p.cam.reset(p.kart.h);
      p.hud.reset();
      p.bestSec = [];
    }
    this.panel.reset();
    for (const v of this.world.views) v.resetMotion();
    this.audio.tempo = 1;
    this.slowMo = 0;
    this.lastFinish = null;
    if (intro) {
      // section 12.4: a flyover first, then the grid and the countdown
      for (const p of this.players) p.cam.introT = 0;
      this.introLeft = INTRO_T;
      this.setStage('intro');
      return;
    }
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
        if (this.slowMo > 0) this.slowMo -= dt;
        this.acc += this.slowMo > 0 ? dt * 0.3 : dt;
        let steps = 0;
        const t0 = performance.now();
        while (this.acc >= STEP && steps < MAX_SUBSTEPS) {
          this.game.step(STEP);
          this.handleEvents(this.game.drainEvents());
          this.acc -= STEP;
          steps++;
        }
        // section 12.8: simulation time per frame (smoothed), for the debug overlay and tools/perf.ts
        if (steps) this.simMs += (performance.now() - t0 - this.simMs) * 0.1;
        if (steps >= MAX_SUBSTEPS) this.acc = 0;
      }
      if (s.phase === 'finished') {
        this.doneT += dt;
        if (this.doneT > RESULTS_DELAY) this.showPodium();
      }
    } else if (live && this.stage === 'intro') {
      this.game.step(STEP); // grid phase: ambient time only
      this.game.drainEvents();
      this.introLeft -= dt;
      if (this.introLeft <= 0) this.skipIntro();
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
    } else this.world.syncKarts(s, alpha, pdt, this.camPositions);
    this.world.updateAmbient(s, pdt, this.stage === 'podium');

    if (this.stage === 'racing') this.panel.update(s);
    for (const p of this.players) {
      p.cam.update(this.paused ? 0.0001 : dt, s, p.kart, this.world.views[p.kart.id]!, this.world.podium);
      // section 12.1 camera collision: never inside the ground (hills beside the road, ramps, banking)
      const c = p.cam.camera.position,
        g = this.world.terrain.terrainH(c.x, c.z) + 1.2;
      if (c.y < g) c.y += (g - c.y) * Math.min(1, dt * 12 + 0.25);
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

  /** End the intro now (Space on the host): straight to the countdown. */
  skipIntro(): void {
    if (this.stage !== 'intro') return;
    this.introLeft = 0;
    this.setStage('racing');
    this.game.startCountdown();
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
      finishTime: k.finished ? k.finishTime : null,
      wrongWay: k.wrongT > 1 && !k.finished,
      threat: k.threat > 0 && !k.finished,
    };
  }

  views(): ViewToRender[] {
    return this.players.map((p) => ({
      camera: p.cam.camera,
      rect: p.rect,
      viewerKart: this.stage === 'podium' ? -1 : p.kart.id,
      tags: this.stage === 'racing',
      // D45 speed blur: starts above about 100 km/h, strongest while boosting
      blur:
        this.stage === 'racing' && !this.paused
          ? Math.min(1, Math.max(0, (p.kart.sp - 30) / 40) * 0.55 + (p.kart.boost > 0 ? 0.45 : 0))
          : 0,
      boost: this.stage === 'racing' && p.kart.boost > 0 ? 1 : 0,
      // D63 camera motion blur while racing (the post pass starts clean after a pause or a camera jump)
      motion: this.stage === 'racing' && !this.paused ? 1 : 0,
    }));
  }

  focusOf(v: ViewToRender): THREE.Vector3 {
    const p = this.players.find((pl) => pl.cam.camera === v.camera);
    return p ? p.cam.focus : new THREE.Vector3();
  }

  private showPodium(): void {
    if (this.stage === 'podium') return;
    const race = this.s.standings ?? this.game.updateRanks();
    this.podiumOrder = this.podiumFor?.(race) ?? race;
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
    this.onResults?.(race);
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
          // every phone shows the number and ticks (section 6.4)
          for (const p of this.players) this.onHaptic?.(p.slot, 'cd', e.n);
          break;
        case 'go':
          a.tone(880, 0.5, 'square', 0.12);
          for (const p of this.players) this.onHaptic?.(p.slot, 'go');
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
        case 'sector':
          if (me && e.n !== undefined && e.t !== undefined) {
            const best = me.bestSec[e.n] ?? null;
            me.hud.split(e.n, e.t, best);
            if (best === null || e.t < best) me.bestSec[e.n] = e.t;
          }
          break;
        case 'jump':
          // D64: the big ramps (launch, tabletop) whoosh longer and higher
          if (me) a.tone(420, e.lvl === 2 ? 0.45 : 0.25, 'triangle', 0.07, e.lvl === 2 ? 980 : 760);
          break;
        case 'land':
          if (me) {
            const big = (e.t ?? 0) > 0.9;
            a.noiseHit(big ? 0.28 : 0.18, big ? 0.3 : 0.2, big ? 300 : 380);
            me.cam.shake = Math.max(me.cam.shake, big ? 0.55 : 0.35);
            if (e.power) me.hud.say(big ? 'BIG AIR! BOOST!' : 'NICE LANDING!', 900, big ? 'small gold' : 'small blue');
          }
          break;
        case 'missedgate':
          if (me) me.hud.say('MISSED A CHECKPOINT!', 1600, 'small');
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
              if (k.lap === s.laps) {
                a.tempo = 1.1;
                this.onHaptic?.(me.slot, 'lap', k.lap);
              }
            }
          }
          break;
        case 'driftperfect':
          if (me) {
            me.hud.say('PERFECT DRIFT!', 900, 'small gold');
            a.tone(880, 0.12, 'triangle', 0.1);
            a.tone(1320, 0.2, 'triangle', 0.1, 0, a.at(0.08));
            this.onHaptic?.(me.slot, 'drift3');
          }
          break;
        case 'userocket':
          if (me) {
            me.hud.say('ROCKET!', 900, 'small gold');
            a.tone(140, 1.2, 'sawtooth', 0.12, 900);
            me.cam.shake = Math.max(me.cam.shake, 0.4);
          }
          break;
        case 'usecomet':
          a.tone(300, 1.4, 'sine', 0.07, 1400);
          for (const p of this.players)
            if (p.kart.id !== e.other && !p.kart.finished) p.hud.say('☄️ COMET LAUNCHED', 1200, 'small blue');
          break;
        case 'warn':
          if (me) {
            a.tone(980, 0.08, 'square', 0.07);
            a.tone(980, 0.08, 'square', 0.07, 0, a.at(0.14));
            this.onHaptic?.(me.slot, 'warn');
          }
          break;
        case 'comethit':
          if (me) {
            me.cam.shake = 1;
            this.hitStop = 0.09;
          }
          a.noiseHit(0.6, 0.5, 300);
          break;
        case 'cometmiss':
          if (me) me.hud.say('DODGED!', 1000, 'small blue');
          break;
        case 'finish':
          // photo finish: two cars over the line within 0.2 s, at least one a player, play out in slow motion
          if (
            k &&
            this.lastFinish !== null &&
            k.finishTime - this.lastFinish.t < 0.2 &&
            (me || this.lastFinish.human)
          ) {
            this.slowMo = 1.6;
            for (const p of this.players) p.hud.say('PHOTO FINISH!', 1600, 'small gold');
          }
          if (k) this.lastFinish = { t: k.finishTime, human: !!me };
          if (me && k) {
            // section 6.2: a FINISHED banner, and this view switches to an orbit around the (now AI-driven) kart
            me.hud.clearMsg();
            me.hud.setFinished(k.rank + 1, k.finishTime);
            me.cam.mode = 'finish';
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
    this.panel.dispose();
  }
}
