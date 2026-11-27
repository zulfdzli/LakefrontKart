/**
 * One race on the host: owns the Game, a camera and HUD per human player, and the fixed-step loop
 * (60 Hz, at most 5 substeps per frame, render interpolation, hit-stop). Routes simulation events
 * to effects, audio and the right player's HUD.
 */
import * as THREE from 'three';
import {
  STEP,
  ReplayLog,
  createGame,
  frameMoment,
  pickMoments,
  type Moment,
  type Game,
  type GameEvent,
  type GameOptions,
  type GameState,
  type HapticKind,
  type HudUpdate,
  type Kart,
  type Phase,
  HAZARD_NAME,
  MOVE_INFO,
  MOVE_OF,
  type MoveId,
} from '@tk/shared';
import { World, type Rect, type ViewToRender } from './renderer';
import { ChaseCam, INTRO_T } from './camera';
import { ReplayDirector } from './replay-director';
import { PlayerHud, MinimapBase, SharedPanel } from './hud';
import { SpeedLines } from './art/effects';
import { Commentator } from './commentator';
import { ord } from './hud';
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

export type SessionStage = 'preview' | 'intro' | 'racing' | 'replay' | 'podium';

export class RaceSession {
  readonly game: Game;
  readonly s: Readonly<GameState>;
  readonly players: PlayerView[] = [];
  private readonly opts: GameOptions;
  stage: SessionStage = 'preview';
  paused = false;
  private acc = 0;
  private hitStop = 0;
  /** Smoothed simulation time per frame (ms). */
  simMs = 0;
  /** Real seconds of photo-finish slow motion left (the simulation runs at 30%). */
  private slowMo = 0;
  private lastFinish: { t: number; human: boolean } | null = null;
  /** D81: the race commentator (shared by every race; set by main.ts), and what it has said this race. */
  comm: Commentator | null = null;
  private leaderId = -1;
  private finalLapCalled = false;
  private winnerCalled = false;
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
  /** D67: wraps the cut from the race to the podium (the host fades through a veil); null = cut at once. */
  transition: ((swap: () => void) => void) | null = null;
  private podiumAsked = false;
  /** D68: every call into the game is recorded, so the race can be re-simulated for the highlight replay. */
  readonly replayLog = new ReplayLog();
  /** D68: play the highlight reel after the race (off for automation). */
  replayOn = true;
  private replay: ReplayDirector | null = null;
  private replayAsked = false;
  private readonly moments: Moment[] = [];
  private readonly jumpAt = new Map<number, number>();
  private readonly prevRank = new Map<number, number>();
  private readonly finishes: { kart: number; step: number; human: boolean; idx: number; lat: number }[] = [];

  constructor(
    opts: GameOptions,
    private readonly world: World,
    private readonly audio: Audio,
    hudLayer: HTMLElement,
    private readonly names: Map<number, string>,
  ) {
    this.opts = opts;
    this.game = createGame(opts);
    this.replayLog.attach(this.game);
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
    // D72: the lobby preview has every player's kart on the grid but draws one view (the orbit)
    this.world.setViewCount(this.stage === 'preview' ? 1 : n);
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
    // D81: the crowd: quiet in the menu, a murmur through the race, a roar at the podium
    this.audio.crowd(stage === 'preview' ? 0 : stage === 'podium' ? 0.85 : stage === 'racing' ? 0.6 : 0.4);
    if (stage === 'podium') this.audio.cheer(1);
    if (stage === 'preview' || stage === 'replay') this.comm?.hush();
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
    this.leaderId = -1;
    this.finalLapCalled = false;
    this.winnerCalled = false;
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
      this.notePasses();
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
          this.notePasses();
          this.commentate();
          this.acc -= STEP;
          steps++;
        }
        // section 12.8: simulation time per frame (smoothed), for the debug overlay and tools/perf.ts
        if (steps) this.simMs += (performance.now() - t0 - this.simMs) * 0.1;
        if (steps >= MAX_SUBSTEPS) this.acc = 0;
      }
      if (s.phase === 'finished') {
        this.doneT += dt;
        if (this.doneT > RESULTS_DELAY) this.startReplay();
      }
    } else if (this.stage === 'replay' && this.replay) {
      // D68: the highlight reel steps its own re-simulation; its events drive the effects and a few sounds
      const r = this.replay;
      const ev = r.update(this.paused ? 0 : dt, window.innerWidth / Math.max(1, window.innerHeight));
      const rs = r.state;
      for (const e of ev) {
        const k = e.kart >= 0 ? (rs.karts[e.kart] ?? null) : null;
        this.world.effects?.onEvent(e, k, k ? (this.world.views[k.id] ?? null) : null, true);
      }
      if (r.done) this.skipReplay();
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
    const rp = this.stage === 'replay' ? this.replay : null;
    if (this.stage === 'podium') {
      this.podT += pdt;
      this.world.podiumPose(this.podiumOrder, this.podT);
    } else if (rp) this.world.syncKarts(rp.state, rp.alpha, pdt, [rp.camera.position]);
    else this.world.syncKarts(s, alpha, pdt, this.camPositions);
    this.world.updateAmbient(rp ? rp.state : s, pdt, this.stage === 'podium');

    if (this.stage === 'racing') this.panel.update(s);
    for (const p of this.players) {
      // D69: knocked out of a brawl, the player's view follows the kart leading the brawl
      const watch = p.kart.out && this.stage === 'racing' ? (s.karts.find((k) => k.rank === 0) ?? p.kart) : p.kart;
      p.cam.update(this.paused ? 0.0001 : dt, s, watch, this.world.views[watch.id]!, this.world.podium);
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
    if (this.stage === 'replay') return 'replay';
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
      ...(s.mode === 'brawl' ? { lives: k.lives } : {}),
      boosting: k.boost > 0,
      drifting: k.drifting,
      driftLevel: k.drifting && s.handling.boosts ? k.driftLevel : 0,
      finished: k.finished,
      finishTime: k.finished ? k.finishTime : null,
      wrongWay: k.wrongT > 1 && !k.finished,
      threat: k.threat > 0 && !k.finished,
      // D74: the move and its meter, in twentieths (so a slowly filling meter does not flood the network)
      ...(s.moves && MOVE_OF[k.ch.id] ? { move: MOVE_OF[k.ch.id], meter: Math.floor(k.meter * 20) / 20 } : {}),
    };
  }

  views(): ViewToRender[] {
    if (this.stage === 'replay' && this.replay)
      return [
        {
          camera: this.replay.camera,
          rect: { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight },
          viewerKart: -1,
          tags: false,
          blur: 0,
          boost: 0,
          motion: 0.8,
        },
      ];
    const shown = this.stage === 'preview' ? this.players.slice(0, 1) : this.players;
    return shown.map((p) => ({
      camera: p.cam.camera,
      rect: p.rect,
      viewerKart: this.stage === 'podium' ? -1 : p.kart.id,
      tags: this.stage === 'racing',
      // D45 speed blur, strongest while boosting. D80: softer again at the user's request (D78 had made it stronger)
      blur:
        this.stage === 'racing' && !this.paused
          ? Math.min(1, Math.max(0, (p.kart.sp - 26) / 30) * 0.5 + (p.kart.boost > 0 ? 0.3 : 0))
          : 0,
      boost: this.stage === 'racing' && p.kart.boost > 0 ? 1 : 0,
      // D63 camera motion blur while racing (the post pass starts clean after a pause or a camera jump)
      motion: this.stage === 'racing' && !this.paused ? 1 : 0,
    }));
  }

  focusOf(v: ViewToRender): THREE.Vector3 {
    if (this.replay && v.camera === this.replay.camera) return this.replay.focus;
    const p = this.players.find((pl) => pl.cam.camera === v.camera);
    return p ? p.cam.focus : new THREE.Vector3();
  }

  private showPodium(): void {
    if (this.stage === 'podium' || this.podiumAsked) return;
    this.replayAsked = true;
    this.podiumAsked = true;
    if (this.transition) this.transition(() => this.enterPodium());
    else this.enterPodium();
  }

  /* ---------------- D68: highlight replay ---------------- */

  private nameOf(k: Kart): string {
    return this.names.get(k.id) ?? k.name;
  }

  /** D81: the commentator's running calls: the lead changing hands, and a word on the order when it is quiet. */
  private commentate(): void {
    const s = this.s,
      c = this.comm;
    if (!c || s.phase !== 'race' || s.mode !== 'race') return;
    const leader = s.karts.find((k) => k.rank === 0);
    if (!leader) return;
    if (leader.id !== this.leaderId) {
      if (this.leaderId >= 0 && s.raceTime > 4) {
        c.say(Commentator.lead(this.nameOf(leader)), 3);
        if (leader.lap >= s.laps) this.audio.cheer(0.6);
      }
      this.leaderId = leader.id;
    }
    if (c.quiet && s.raceTime > 8) {
      const second = s.karts.find((k) => k.rank === 1);
      if (second && !second.finished) {
        const gap = ((leader.prog - second.prog) * s.track.DS) / Math.max(10, Math.abs(second.sp));
        c.say(Commentator.order(this.nameOf(leader), this.nameOf(second), gap), 1);
      }
    }
  }

  /** D81: what the commentator and the crowd make of one event. */
  private react(e: GameEvent, k: Kart | null, human: boolean): void {
    const c = this.comm,
      a = this.audio,
      s = this.s;
    const who = k ? this.nameOf(k) : '';
    const matters = human || (k !== null && k.rank <= 2);
    switch (e.type) {
      case 'go':
        c?.say(Commentator.go(), 3);
        a.cheer(0.9);
        break;
      case 'lap':
        if (k && k.rank === 0 && k.lap === s.laps && s.laps > 1 && !this.finalLapCalled && s.mode === 'race') {
          this.finalLapCalled = true;
          c?.say(Commentator.finalLap(who), 3);
          a.cheer(0.5);
        }
        break;
      case 'hit':
        if (k && matters) c?.say(Commentator.hit(who), 2);
        if (human) a.gasp();
        break;
      case 'squash':
        if (k && matters) c?.say(Commentator.flattened(who), 2);
        break;
      case 'rockhit':
        if (k && matters) c?.say(Commentator.rocks(who), 2);
        break;
      case 'baa':
        if (k && human) c?.say(Commentator.sheep(who), 2);
        break;
      case 'move': {
        const mv = k ? MOVE_OF[k.ch.id] : undefined;
        if (k && mv && matters) c?.say(Commentator.move(who, MOVE_INFO[mv as MoveId].name), 2);
        break;
      }
      case 'hazardwarn': {
        const h = s.hazards[e.n ?? 0];
        if (h) c?.say(Commentator.hazard(HAZARD_NAME[h.kind]), 2);
        break;
      }
      case 'ko':
        if (k) c?.say(Commentator.ko(who), 3);
        a.cheer(0.6);
        break;
      case 'suddendeath':
        c?.say(Commentator.suddenDeath(), 3);
        break;
      case 'zone':
        // D83: a player's fun zone (or the leaders'), now and then
        if (!k || !matters) break;
        if (e.n === 0) c?.say(Commentator.slalom(who), 1);
        else if (e.n === 1) c?.say(Commentator.bullseye(who), 1);
        else c?.say(Commentator.tunnelPass(who, e.power ?? 1), 1);
        if (human) a.cheer(0.45);
        break;
      case 'finish':
        if (!k) break;
        if (this.slowMo > 1.5) {
          c?.say(Commentator.photo(), 4);
          a.cheer(1);
        } else if (!this.winnerCalled) {
          this.winnerCalled = true;
          c?.say(Commentator.win(who), 4);
          a.cheer(1);
        } else if (human) c?.say(Commentator.finished(who, `${k.rank + 1}${ord(k.rank + 1)}`), 2);
        break;
    }
  }

  /** Remember a highlight candidate from a live event (big air, a hit, the finish order). */
  private noteMoment(e: GameEvent, k: Kart | null): void {
    if (!k || !this.replayOn || this.stage !== 'racing') return;
    const step = this.replayLog.steps,
      human = k.slot !== null,
      lastLap = k.lap >= this.s.laps;
    const base = { kart: k.id, human, idx: k.idx, lat: k.lat, step };
    switch (e.type) {
      case 'jump':
        this.jumpAt.set(k.id, k.idx);
        break;
      case 'ko':
        this.moments.push(frameMoment({ ...base, kind: 'ko' }, true));
        break;
      case 'land': {
        // a ramp jump (floats over crests have no 'jump' event) with real air
        const i0 = this.jumpAt.get(k.id);
        this.jumpAt.delete(k.id);
        if (i0 !== undefined && (e.t ?? 0) >= 0.75)
          this.moments.push(frameMoment({ ...base, kind: 'air', air: e.t, idx0: i0 }, lastLap));
        break;
      }
      case 'orbhit':
      case 'bolthit':
      case 'comethit':
        this.moments.push(frameMoment({ ...base, kind: 'hit' }, lastLap));
        break;
      // D74: a signature move that paid off; the clip follows the kart that made it
      case 'shoved': {
        const by = e.other !== undefined ? this.s.karts[e.other] : undefined;
        if (by)
          this.moments.push(
            frameMoment({ ...base, kart: by.id, human: by.slot !== null, other: k.id, kind: 'move' }, lastLap),
          );
        break;
      }
      case 'decoypop':
      case 'dodge':
        this.moments.push(frameMoment({ ...base, kind: 'move' }, lastLap));
        break;
      case 'finish': {
        if (this.s.mode === 'brawl') break;
        const prev = this.finishes[this.finishes.length - 1];
        this.finishes.push({ kart: k.id, step, human, idx: k.idx, lat: k.lat });
        // a photo finish: two karts over the line within a quarter of a second, a player among them
        if (prev && step - prev.step <= Math.round(0.25 / STEP) && (human || prev.human))
          this.moments.push(frameMoment({ ...base, kind: 'photo', kart: prev.kart, other: k.id, human: true }, true));
        break;
      }
      default:
        break;
    }
  }

  /** A player gaining a place on a kart right beside them is an overtake worth showing. */
  private notePasses(): void {
    if (!this.replayOn || this.stage !== 'racing' || this.s.mode === 'brawl') return;
    const s = this.s,
      live = s.phase === 'race' && s.raceTime > 6;
    for (const p of this.players) {
      const k = p.kart,
        prev = this.prevRank.get(k.id);
      if (live && prev !== undefined && k.rank < prev && !k.finished) {
        const o = s.karts.find((x) => x.rank === k.rank + 1);
        if (o && Math.abs(o.prog - k.prog) < 8)
          this.moments.push(
            frameMoment(
              {
                kind: 'pass',
                step: this.replayLog.steps,
                kart: k.id,
                other: o.id,
                human: true,
                idx: k.idx,
                lat: k.lat,
              },
              k.lap >= s.laps,
            ),
          );
      }
      this.prevRank.set(k.id, k.rank);
    }
  }

  /** The race is over: play the highlight reel (behind a fade), or go straight to the podium. */
  private startReplay(): void {
    if (this.replayAsked || this.stage !== 'racing') return;
    this.replayAsked = true;
    const win = this.s.mode === 'brawl' ? undefined : this.finishes[0];
    const winner = win
      ? frameMoment(
          { kind: 'finish', step: win.step, kart: win.kart, human: win.human, idx: win.idx, lat: win.lat },
          true,
        )
      : undefined;
    const clips = this.replayOn ? pickMoments(this.moments, 3, winner) : [];
    if (!clips.length) {
      this.showPodium();
      return;
    }
    const go = (): void => {
      this.replay = new ReplayDirector(this.opts, this.replayLog, clips, this.world, this.audio, (k) => this.nameOf(k));
      if (this.transition) this.replay.cut = (swap) => this.transition!(swap);
      this.setStage('replay');
    };
    if (this.transition) this.transition(go);
    else go();
  }

  /** Skip the rest of the reel (host key or any phone): on to the podium. */
  skipReplay(): void {
    if (this.stage !== 'replay') return;
    this.showPodium();
  }

  private enterPodium(): void {
    if (this.stage === 'podium') return;
    if (this.replay) {
      this.replay.dispose();
      this.replay = null;
      for (const v of this.world.views) v.resetMotion();
      this.world.effects?.clearAll(this.world.views);
    }
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
      this.noteMoment(e, k);
      if (this.stage === 'racing') this.react(e, k, !!me);
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
        case 'move': {
          // D74: a signature move: its name on the mover's screen, a whoosh for everyone close
          const mv = k ? MOVE_OF[k.ch.id] : undefined;
          if (me && mv)
            me.hud.say(
              `${MOVE_INFO[mv as MoveId].icon} ${MOVE_INFO[mv as MoveId].name.toUpperCase()}!`,
              1100,
              'small blue',
            );
          if (me) a.tone(300, 0.35, 'sawtooth', 0.05, 900);
          break;
        }
        case 'shoved': {
          if (me) {
            me.hud.say('SHOVED!', 900, 'small');
            me.cam.shake = Math.max(me.cam.shake, 0.7);
            this.onHaptic?.(me.slot, 'hit');
          }
          const by = e.other !== undefined ? this.playerOf(e.other) : undefined;
          if (by) by.hud.say('💥 GOT THEM!', 900, 'small gold');
          if (me || by) a.noiseHit(0.2, 0.25, 500, 'lowpass');
          break;
        }
        case 'decoypop':
          if (me) me.hud.say('👻 THE MIRAGE TOOK IT!', 1200, 'small gold');
          break;
        case 'dodge':
          if (me) me.hud.say('👁️ DODGED!', 1000, 'small gold');
          break;
        case 'hazardwarn': {
          // D73: a track event ahead: a warning (which way to go, for the rockfall and the snowball), a horn, a buzz
          const h = this.s.hazards[e.n ?? 0];
          if (!h) break;
          const keep =
            h.kind === 'rocks'
              ? h.side > 0
                ? ' · KEEP LEFT ◀'
                : ' · KEEP RIGHT ▶'
              : h.kind === 'snowball'
                ? h.side > 0
                  ? ' FROM THE LEFT ◀'
                  : ' FROM THE RIGHT ▶'
                : '';
          const T = this.s.track;
          for (const p of this.players) {
            const ahead = (h.idx - p.kart.idx + T.N) % T.N;
            if (p.kart.finished || ahead > T.N * 0.6) continue;
            p.hud.say(`⚠ ${HAZARD_NAME[h.kind]}${keep}`, 2800, 'small gold');
            this.onHaptic?.(p.slot, 'hazard');
          }
          a.tone(660, 0.18, 'square', 0.06, 520);
          setTimeout(() => a.tone(660, 0.18, 'square', 0.06, 520), 280);
          break;
        }
        case 'hazard': {
          const h = this.s.hazards[e.n ?? 0];
          // the event lands: rumble for the rocks and the ball, thunder for the squall
          if (h?.kind === 'rocks' || h?.kind === 'snowball') a.noiseHit(0.9, 0.22, 180, 'lowpass');
          if (h?.kind === 'squall') a.noiseHit(1.4, 0.25, 120, 'lowpass');
          break;
        }
        case 'baa':
          if (me) {
            a.tone(540, 0.32, 'sawtooth', 0.05, 420);
            me.cam.shake = Math.max(me.cam.shake, 0.3);
            this.onHaptic?.(me.slot, 'splash');
          }
          break;
        case 'rockhit':
          if (me) {
            a.noiseHit(0.3, 0.3, 300, 'lowpass');
            me.cam.shake = Math.max(me.cam.shake, 0.8);
            this.onHaptic?.(me.slot, 'hit');
          }
          break;
        case 'squash':
          if (me) {
            a.noiseHit(0.45, 0.32, 220, 'lowpass');
            me.hud.say('FLATTENED!', 1200, 'small');
          }
          break;
        case 'zone': {
          // D83: a fun zone done well: what it won, a bright arpeggio, a buzz on the phone (and the target's ring)
          if (e.n === 1) this.world.zoneFx?.pulse();
          if (!me) break;
          const what = ['⛷️ SLALOM CLEAN!', '🎯 BULLSEYE!', `💨 NICE PASS${(e.power ?? 1) > 1 ? ` ×${e.power}` : ''}!`][
            e.n ?? 0
          ];
          const won = e.lvl === 1 ? ' +ITEM' : e.lvl === 2 ? ' +MOVE' : '';
          me.hud.say(`${what}${won}`, 1500, 'small gold');
          [784, 988, 1319].forEach((f, i) => a.tone(f, 0.16, 'triangle', 0.08, 0, a.at(i * 0.07)));
          this.onHaptic?.(me.slot, 'zone', e.n);
          break;
        }
        case 'zonemiss':
          if (me) {
            me.hud.say(e.n === 1 ? 'SO CLOSE!' : 'MISSED A GATE', 900, 'small');
            a.tone(330, 0.18, 'triangle', 0.06, 220);
          }
          break;
        case 'cone':
          if (me) a.tone(260, 0.09, 'square', 0.06, 140);
          break;
        case 'splash':
          // D71: a puddle: a hiss of water, a small jolt and a buzz on the phone
          if (me) {
            a.noiseHit(0.28, 0.16, 2600, 'highpass');
            me.cam.shake = Math.max(me.cam.shake, 0.25);
            this.onHaptic?.(me.slot, 'splash');
          }
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
            const big = (e.t ?? 0) > 0.9,
              hop = (e.t ?? 0) < 0.3;
            // D65: a quick float over a crest touches down with a soft bump; a jump lands with a thud
            a.noiseHit(big ? 0.28 : hop ? 0.1 : 0.18, big ? 0.3 : hop ? 0.12 : 0.2, big ? 300 : hop ? 460 : 380);
            me.cam.shake = Math.max(me.cam.shake, big ? 0.55 : hop ? 0.22 : 0.35);
            // D76: a landing boosts only when the boosts are on
            const boost = this.s.handling.boosts ? ' BOOST!' : '';
            if (e.power) me.hud.say(big ? `BIG AIR!${boost}` : 'NICE LANDING!', 900, big ? 'small gold' : 'small blue');
          }
          break;
        case 'float':
          // D65 roller coaster: over the top of a crest, the stomach-lift whoosh
          if (me) {
            a.tone(300, 0.4, 'sine', 0.06, 620);
            a.noiseHit(0.4, 0.08, 1800, 'highpass');
          }
          break;
        case 'slingshot':
          if (me) {
            me.hud.say('SLINGSHOT!', 800, 'small blue');
            a.tone(500, 0.3, 'sawtooth', 0.07, 1100);
          }
          break;
        case 'guard':
          if (me) {
            me.hud.say('GUARDED!', 800, 'small blue');
            a.tone(900, 0.2, 'triangle', 0.1, 500);
            this.onHaptic?.(me.slot, 'hit');
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
        /* ---- D69 Bumper Brawl ---- */
        case 'lifelost':
          if (me && (e.n ?? 0) > 0) me.hud.say(`${e.n} ${e.n === 1 ? 'LIFE' : 'LIVES'} LEFT`, 1100, 'small');
          break;
        case 'ko': {
          a.noiseHit(0.7, 0.6, 220);
          a.tone(330, 0.7, 'sawtooth', 0.1, 70);
          const who = k ? this.nameOf(k).toUpperCase() : '';
          for (const p of this.players) if (p !== me && !p.kart.out) p.hud.say(`${who} IS OUT!`, 1300, 'small gold');
          if (me && k) {
            me.hud.clearMsg();
            me.hud.setFinished(k.rank + 1, k.finishTime, 'KNOCKED OUT');
            me.cam.shake = 1;
            this.onHaptic?.(me.slot, 'finish');
          }
          break;
        }
        case 'steal':
          if (me) {
            me.hud.say('STOLE A LIFE!', 1200, 'small gold');
            a.tone(660, 0.3, 'triangle', 0.12, 1320);
            this.onHaptic?.(me.slot, 'boost');
          }
          break;
        case 'suddendeath':
          a.tone(220, 0.9, 'square', 0.1, 110);
          for (const p of this.players) if (!p.kart.out) p.hud.say('SUDDEN DEATH! ONE LIFE EACH', 2200, 'gold');
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
            me.hud.setFinished(k.rank + 1, k.finishTime, this.s.mode === 'brawl' ? 'LAST ONE STANDING' : 'FINISHED');
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
    this.comm?.hush();
    for (const p of this.players) p.hud.dispose();
    this.panel.dispose();
  }
}
