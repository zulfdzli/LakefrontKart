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
import { MEADOWS, THEMES, type Theme } from './art/palette';
import { TRACKS, isTrackId } from '@tk/shared';

/** A viewport in CSS pixels, top-left origin (layout space). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

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
/**
 * Another kart between a view's camera and that view's own kart is hidden in that view, so it cannot fill the
 * screen (phase 6, D39): closer than NEAR_HIDE_SHARE of the camera-to-own-kart distance, or NEAR_HIDE_M.
 */
const NEAR_HIDE_M = 4.6;
const NEAR_HIDE_SHARE = 0.7;
/** Draw distance and fog per view count (section 6.3: shorter with more than 3 viewports). */
const VIEW_RANGE = { near: { fog: [300, 1500], far: 3200 }, many: { fog: [240, 1050], far: 1500 } } as const;

export class World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly sunDir = new THREE.Vector3(0.42, 0.78, 0.46).normalize();
  private readonly sun: THREE.DirectionalLight;
  private sky: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private themeId = 'meadows';
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
    this.hemi = new THREE.HemisphereLight(MEADOWS.hemiSky, MEADOWS.hemiGround, 0.62 * LEGACY_LIGHT_SCALE);
    s.add(this.hemi);
    this.sun = new THREE.DirectionalLight(MEADOWS.sunLight, 0.82 * LEGACY_LIGHT_SCALE);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 10;
    sc.far = 420;
    sc.updateProjectionMatrix();
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
  /** Sky, fog and light for a track's theme (phase 8). */
  private applyTheme(th: Theme): void {
    if (th.id === this.themeId) return;
    this.themeId = th.id;
    const s = this.scene;
    (s.background as THREE.Color).setHex(th.horizon);
    (s.fog as THREE.Fog).color.setHex(th.horizon);
    this.hemi.color.setHex(th.hemiSky);
    this.hemi.groundColor.setHex(th.hemiGround);
    this.hemi.intensity = th.hemi * LEGACY_LIGHT_SCALE;
    this.sun.color.setHex(th.sunLight);
    this.sun.intensity = th.sun * LEGACY_LIGHT_SCALE;
    this.sunDir.set(th.sunDir[0], th.sunDir[1], th.sunDir[2]).normalize();
    s.remove(this.sky);
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    const scale = this.sky.scale.x;
    this.sky = createSky(th.zenith, th.horizon, this.sunDir, th.sunGlow);
    this.sky.scale.setScalar(scale);
    s.add(this.sky);
  }

  build(s: Readonly<GameState>, names: Map<number, string>): void {
    if (this.builtTrack !== s.track) {
      this.disposeTrack();
      const def = isTrackId(s.track.id) ? TRACKS[s.track.id] : null;
      const th = THEMES[def?.theme ?? 'meadows'];
      this.applyTheme(th);
      const M = (this.M = createMaterials());
      this.trackWorld = buildTrackWorld(s.track, M, 1234, th, def);
      this.scene.add(this.trackWorld.group);
      this.scenery = buildScenery(s.track, this.trackWorld.terrain, M, 4321, th);
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
    for (const v of this.views) {
      this.scene.remove(v.root);
      v.dispose();
    }
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
    const p = this.podium,
      s = Math.sin(p.ry),
      c = Math.cos(p.ry);
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

  /** Draw calls and triangles summed over every view in the last frame (renderer.info resets per render call). */
  readonly frameStats = { calls: 0, triangles: 0, views: 0 };
  private readonly hidden: KartView[] = [];
  private viewCount = 1;

  /** Shorter draw distance and fog with more than 3 viewports (section 6.3). The sky dome shrinks to fit. */
  setViewCount(n: number): void {
    this.viewCount = n;
    const R = n > 3 ? VIEW_RANGE.many : VIEW_RANGE.near;
    const fog = this.scene.fog as THREE.Fog;
    fog.near = R.fog[0];
    fog.far = R.fog[1];
    this.sky.scale.setScalar(Math.min(1, (R.far * 0.92) / 2600));
  }

  /** Camera far plane for the current view count. */
  get viewFar(): number {
    return this.viewCount > 3 ? VIEW_RANGE.many.far : VIEW_RANGE.near.far;
  }

  /** Render each view into its rectangle. Three.js viewports use a bottom-left origin, so flip y. */
  render(list: ViewToRender[], focus: (v: ViewToRender) => THREE.Vector3): void {
    const r = this.renderer,
      H = window.innerHeight,
      st = this.frameStats;
    st.calls = st.triangles = 0;
    st.views = list.length;
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
      if (v.camera.far !== this.viewFar) {
        v.camera.far = this.viewFar;
        v.camera.updateProjectionMatrix();
      }
      const cx = v.camera.position.x,
        cz = v.camera.position.z;
      const own = this.views[v.viewerKart];
      const hideR = own ? Math.max(NEAR_HIDE_M, NEAR_HIDE_SHARE * Math.hypot(own.ix - cx, own.iz - cz)) : NEAR_HIDE_M;
      this.hidden.length = 0;
      for (const kv of this.views) {
        // another kart right next to this camera would fill the view: hide it for this view only
        if (v.tags && kv.kartId !== v.viewerKart && kv.root.visible && Math.hypot(kv.ix - cx, kv.iz - cz) < hideR) {
          kv.root.visible = false;
          this.hidden.push(kv);
        }
        kv.updateTag(cx, cz, kv.kartId === v.viewerKart, v.tags && kv.root.visible);
      }
      r.render(this.scene, v.camera);
      for (const kv of this.hidden) kv.root.visible = true;
      st.calls += r.info.render.calls;
      st.triangles += r.info.render.triangles;
    }
    r.setScissorTest(false);
  }

  hideTags(): void {
    for (const v of this.views) v.tag.visible = false;
  }

  private disposeTrack(): void {
    this.disposeKarts();
    this.builtTrack = null;
    if (this.trackWorld) {
      this.scene.remove(this.trackWorld.group);
      this.trackWorld.dispose();
      this.trackWorld = null;
    }
    if (this.scenery) {
      this.scene.remove(this.scenery.group);
      this.scenery.dispose();
      this.scenery = null;
    }
    if (this.effects) {
      this.scene.remove(this.effects.group);
      this.effects.dispose();
      this.effects = null;
    }
    this.assets?.dispose();
    this.assets = null;
    this.M?.dispose();
    this.M = null;
  }

  dispose(): void {
    this.disposeTrack();
    this.renderer.dispose();
  }
}
