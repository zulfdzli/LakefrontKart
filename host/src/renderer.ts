/**
 * One renderer, one scene, many viewports (section 6.2). Builds the world for a track, keeps kart views
 * in sync with the simulation, and renders each player's camera into its own scissored rectangle.
 */
import * as THREE from 'three';
import type { GameState, Kart } from '@tk/shared';
import { createMaterials, type Materials } from './art/materials';
import { createSky } from './art/sky';
import { buildTrackWorld, type TrackWorld } from './art/track-builder';
import { buildScenery, type Scenery } from './art/scenery';
import { Effects } from './art/effects';
import { KartView, ProceduralKartProvider, type KartAssetProvider } from './art/kart';
import { setMaxAnisotropy } from './art/geo';
import { MEADOWS } from './art/palette';

/** A viewport in CSS pixels, top-left origin (layout space). */
export interface Rect { x: number; y: number; w: number; h: number }

export interface ViewToRender {
  camera: THREE.PerspectiveCamera;
  rect: Rect;
  /** Kart id this view follows (its own name tag is hidden), or -1. */
  viewerKart: number;
  /** Show name tags (only while racing). */
  tags: boolean;
}

/** Light intensities are scaled by π: three.js r155+ uses physical units, the prototype (r128) did not. */
const LEGACY_LIGHT_SCALE = Math.PI;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sunDir = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
  private readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private M: Materials | null = null;
  private trackWorld: TrackWorld | null = null;
  private scenery: Scenery | null = null;
  effects: Effects | null = null;
  private assets: KartAssetProvider | null = null;
  views: KartView[] = [];
  /** Device pixel ratio actually used (adaptive). */
  pixelRatio: number;
  private readonly maxPixelRatio: number;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Phase 4 matches the prototype; ACES Filmic tone mapping arrives with the art pass (section 10.2)
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = false;
    setMaxAnisotropy(this.renderer.capabilities.getMaxAnisotropy());

    const s = this.scene;
    s.background = new THREE.Color(MEADOWS.horizon);
    s.fog = new THREE.Fog(MEADOWS.horizon, 300, 1500);
    s.add(new THREE.HemisphereLight(MEADOWS.hemiSky, MEADOWS.hemiGround, 0.62 * LEGACY_LIGHT_SCALE));
    this.sun = new THREE.DirectionalLight(MEADOWS.sunLight, 0.82 * LEGACY_LIGHT_SCALE);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 10; sc.far = 420; sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    s.add(this.sun, this.sun.target);
    this.sky = createSky(MEADOWS.zenith, MEADOWS.horizon, this.sunDir, MEADOWS.sunGlow);
    s.add(this.sky);
  }

  private builtTrack: GameState['track'] | null = null;

  /**
   * Build the world for a race. The track (terrain, props, scenery) is only rebuilt when the track changes;
   * kart views are rebuilt every race, because players and characters change.
   */
  build(s: Readonly<GameState>, names: Map<number, string>): void {
    if (this.builtTrack !== s.track) {
      this.disposeTrack();
      const M = (this.M = createMaterials());
      this.trackWorld = buildTrackWorld(s.track, M, 1234);
      this.scene.add(this.trackWorld.group);
      this.scenery = buildScenery(s.track, this.trackWorld.terrain, M, 4321);
      this.scene.add(this.scenery.group);
      this.effects = new Effects(M);
      this.scene.add(this.effects.group);
      this.assets = new ProceduralKartProvider();
      this.builtTrack = s.track;
    }
    this.disposeKarts();
    this.views = s.karts.map((k) => new KartView(k.id, k.ch, k.slot, names.get(k.id) ?? k.name, this.assets!, this.M!));
    for (const v of this.views) this.scene.add(v.root);
    this.trackWorld!.resetBoxes();
    this.effects!.clearAll(this.views);
    this.syncKarts(s, 1, 0, []);
  }

  private disposeKarts(): void {
    for (const v of this.views) { this.scene.remove(v.root); v.dispose(); }
    this.views = [];
  }

  get podium(): TrackWorld['podium'] {
    return this.trackWorld!.podium;
  }

  get terrain(): TrackWorld['terrain'] {
    return this.trackWorld!.terrain;
  }

  /** Interpolate and animate every kart; emit trails for karts near any camera. */
  syncKarts(s: Readonly<GameState>, alpha: number, dt: number, cams: THREE.Vector3[]): void {
    const racing = s.phase !== 'grid';
    for (const k of s.karts) {
      const v = this.views[k.id]!;
      v.interpolate(k, alpha);
      v.animate(k, dt, s.time);
      if (racing && dt > 0 && this.effects) {
        let nearest = 1e9;
        for (const c of cams) nearest = Math.min(nearest, Math.hypot(v.ix - c.x, v.iz - c.z));
        this.effects.kartTrail(k, v, nearest);
      }
    }
  }

  /** Show only the given karts (e.g. the podium three), or all when null. */
  setVisibleKarts(only: Set<number> | null): void {
    for (const v of this.views) v.root.visible = only === null || only.has(v.kartId);
  }

  podiumPose(order: Kart[], t: number): void {
    const p = this.podium, s = Math.sin(p.ry), c = Math.cos(p.ry);
    order.slice(0, 3).forEach((k, i) => {
      const sp = p.spots[i]!;
      this.views[k.id]!.podiumPose(i, p.x + c * sp[0] + s * sp[2], p.y + sp[1], p.z - s * sp[0] + c * sp[2], p.ry, t);
    });
  }

  updateAmbient(s: Readonly<GameState>, dt: number, hideBoxes: boolean): void {
    this.trackWorld?.update(s.time, dt);
    this.trackWorld?.updateBoxes(s, hideBoxes);
    this.effects?.syncProjectiles(s, dt);
    this.effects?.update(dt);
  }

  /** Point the shadow camera at what a view is looking at. */
  setSunFocus(x: number, y: number, z: number): void {
    const d = this.sunDir;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + d.x * 200, y + d.y * 200, z + d.z * 200);
    this.sun.target.updateMatrixWorld();
  }

  setShadows(on: boolean): void {
    this.sun.castShadow = on;
  }

  setPixelRatio(pr: number): void {
    this.pixelRatio = Math.max(0.75, Math.min(this.maxPixelRatio, pr));
    this.renderer.setPixelRatio(this.pixelRatio);
    this.resize();
  }

  get maxPR(): number {
    return this.maxPixelRatio;
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  }

  /** Render each view into its rectangle. Three.js viewports use a bottom-left origin, so flip y. */
  render(list: ViewToRender[], focus: (v: ViewToRender) => THREE.Vector3): void {
    const r = this.renderer, H = window.innerHeight;
    r.setScissorTest(true);
    r.setViewport(0, 0, window.innerWidth, H);
    r.setScissor(0, 0, window.innerWidth, H);
    r.setClearColor(0x14162f, 1);
    r.clear();
    for (const v of list) {
      const { x, y, w, h } = v.rect;
      const by = H - y - h;
      r.setViewport(x, by, w, h);
      r.setScissor(x, by, w, h);
      const f = focus(v);
      this.setSunFocus(f.x, f.y, f.z);
      this.sky.position.copy(v.camera.position);
      for (const kv of this.views) kv.updateTag(v.camera.position.x, v.camera.position.z, kv.kartId === v.viewerKart, v.tags && kv.root.visible);
      r.render(this.scene, v.camera);
    }
    r.setScissorTest(false);
  }

  hideTags(): void {
    for (const v of this.views) v.tag.visible = false;
  }

  private disposeTrack(): void {
    this.disposeKarts();
    this.builtTrack = null;
    if (this.trackWorld) { this.scene.remove(this.trackWorld.group); this.trackWorld.dispose(); this.trackWorld = null; }
    if (this.scenery) { this.scene.remove(this.scenery.group); this.scenery.dispose(); this.scenery = null; }
    if (this.effects) { this.scene.remove(this.effects.group); this.effects.dispose(); this.effects = null; }
    this.assets?.dispose(); this.assets = null;
    this.M?.dispose(); this.M = null;
  }

  dispose(): void {
    this.disposeTrack();
    this.renderer.dispose();
  }
}
