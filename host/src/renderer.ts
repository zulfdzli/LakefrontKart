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
import { Post, type PostLook, type Tier } from './post';
import { Ambient, type AmbientKind } from './art/particles';
import { buildNature, type Nature } from './art/nature';
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
  /** 0..1 speed (radial speed blur) and boost (chromatic fringe) for the post-processing. */
  blur?: number;
  boost?: number;
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
  private themeId = '';
  private M: Materials | null = null;
  private trackWorld: TrackWorld | null = null;
  private scenery: Scenery | null = null;
  private ambient: Ambient | null = null;
  private nature: Nature | null = null;
  effects: Effects | null = null;
  private assets: KartAssetProvider | null = null;
  views: KartView[] = [];
  /** Device pixel ratio actually used (adaptive). */
  pixelRatio: number;
  /** D45 cinematic post-processing; ?nopost renders straight to the screen as before. */
  readonly post: Post | null;
  private lastFrame = performance.now();
  private readonly maxPixelRatio: number;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // D45: ACES Filmic tone mapping (applied by the post chain's output pass), soft shadows
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.post = new URLSearchParams(location.search).has('nopost') ? null : new Post(this.renderer);
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
    // low golden-hour suns cast long shadows: a wider box around the view's focus
    sc.left = -75;
    sc.right = 75;
    sc.top = 75;
    sc.bottom = -75;
    sc.near = 10;
    sc.far = 520;
    sc.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    s.add(this.sun, this.sun.target);
    this.sky = createSky(MEADOWS.zenith, MEADOWS.horizon, this.sunDir, MEADOWS.sunGlow);
    s.add(this.sky);
  }

  private builtTrack: GameState['track'] | null = null;

  /**
   * Build the world for a race. The track (terrain, props, scenery) is only rebuilt when the track changes;
   * kart views are rebuilt every race, because players and characters change.
   */
  private envRT: THREE.WebGLRenderTarget | null = null;
  /**
   * Image-based light (phase 9): the theme's sky, prefiltered, so wet patches, steel and paint reflect the real
   * sky instead of black. Kept soft (environmentIntensity) until the art pass tunes the lighting.
   */
  private makeEnvironment(): void {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const sc = new THREE.Scene();
    const sky = this.sky.clone();
    sky.position.set(0, 0, 0);
    sky.scale.setScalar(0.04);
    sc.add(sky);
    // the ground half of the environment: a dim plane in the hemisphere's ground colour
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: this.hemi.groundColor.clone().multiplyScalar(0.35) }),
    );
    floor.position.y = -2;
    sc.add(floor);
    this.envRT?.dispose();
    this.envRT = pm.fromScene(sc, 0.02, 0.1, 200);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.45;
    floor.geometry.dispose();
    (floor.material as THREE.Material).dispose();
    pm.dispose();
  }

  /** Sky, fog and light for a track's theme (phase 8). */
  private applyTheme(th: Theme): void {
    if (th.id === this.themeId) return;
    this.themeId = th.id;
    const s = this.scene;
    (s.background as THREE.Color).setHex(th.horizon);
    (s.fog as THREE.Fog | null)?.color.setHex(th.horizon);
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
    this.makeEnvironment();
    if (this.post) {
      // the post chain's height fog replaces the scene's distance fog
      s.fog = null;
      const L = th.look,
        c = (h: number): THREE.Color => new THREE.Color(h);
      const look: PostLook = {
        ...L,
        fogColor: c(L.fogColor),
        sunColor: c(L.sunColor).multiplyScalar(1.3),
        lift: new THREE.Vector3(...L.lift),
        gamma: new THREE.Vector3(...L.gamma),
        gain: new THREE.Vector3(...L.gain),
      };
      this.post.setLook(look, this.sunDir);
    }
  }

  build(s: Readonly<GameState>, names: Map<number, string>): void {
    if (this.builtTrack !== s.track) {
      this.disposeTrack();
      const def = isTrackId(s.track.id) ? TRACKS[s.track.id] : null;
      const th = THEMES[def?.theme ?? 'meadows'];
      this.applyTheme(th);
      const M = (this.M = createMaterials());
      // D47: the car paint reflects the sky at its own strength (scene.environment would override it)
      if (this.envRT) M.car.envMap = this.envRT.texture;
      this.trackWorld = buildTrackWorld(s.track, M, 1234, th, def);
      this.scene.add(this.trackWorld.group);
      // natural detail first, so the canyon formations claim their ground before the scattered scenery
      this.nature = buildNature(s.track, this.trackWorld.terrain, th, false);
      this.scene.add(this.nature.group);
      this.scenery = buildScenery(s.track, this.trackWorld.terrain, M, 4321, th);
      this.scene.add(this.scenery.group);
      this.effects = new Effects(M);
      this.effects.theme = th.id;
      this.scene.add(this.effects.group);
      // D45 air: leaves and pollen, desert dust, falling snow, or mist motes
      const kind: AmbientKind =
        th.id === 'frosty' ? 'snow' : th.id === 'canyon' ? 'dust' : th.id === 'tropical' ? 'mist' : 'leaves';
      const light = new THREE.Color(th.hemiSky)
        .multiplyScalar(0.55)
        .add(new THREE.Color(th.sunLight).multiplyScalar(0.6));
      this.ambient = new Ambient(s.track, kind, kind === 'snow' ? 9000 : kind === 'dust' ? 2600 : 3200, light);
      this.scene.add(this.ambient.points);
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

  private trophy: THREE.Group | null = null;
  /** The Grand Prix trophy: a golden cup turning above the winner's step (D48). */
  setTrophy(on: boolean): void {
    if (on && !this.trophy) {
      const gold = new THREE.MeshPhysicalMaterial({
        color: 0xffc83d,
        metalness: 1,
        roughness: 0.18,
        clearcoat: 1,
        emissive: 0x3a2400,
      });
      const g = new THREE.Group();
      const prof: THREE.Vector2[] = [];
      for (const [x, y] of [
        [0, 0],
        [0.55, 0],
        [0.55, 0.12],
        [0.22, 0.2],
        [0.16, 0.7],
        [0.32, 0.85],
        [0.62, 1.15],
        [0.72, 1.7],
        [0.66, 1.72],
        [0.5, 1.2],
        [0, 1.0],
      ] as const)
        prof.push(new THREE.Vector2(x, y));
      g.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 32), gold));
      for (const sd of [-1, 1]) {
        const h = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.06, 8, 20, Math.PI), gold);
        h.position.set(sd * 0.72, 1.35, 0);
        h.rotation.z = (sd * -Math.PI) / 2;
        g.add(h);
      }
      g.scale.setScalar(1.6);
      this.trophy = g;
      this.scene.add(g);
    }
    if (this.trophy) this.trophy.visible = on;
  }

  podiumPose(order: Kart[], t: number): void {
    if (this.trophy?.visible) {
      const p = this.podium,
        sp = p.spots[0]!;
      this.trophy.position.set(
        p.x + Math.cos(p.ry) * sp[0] + Math.sin(p.ry) * sp[2],
        p.y + sp[1] + 4.2 + Math.sin(t * 2) * 0.15,
        p.z - Math.sin(p.ry) * sp[0] + Math.cos(p.ry) * sp[2],
      );
      this.trophy.rotation.y = t * 0.9;
    }
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
    this.ambient?.update(s.time);
    this.nature?.update(s.time);
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
    this.post?.setSize(window.innerWidth, window.innerHeight, this.pixelRatio);
  }

  /**
   * Automatic quality (phase 13): when even the lowest pixel ratio cannot hold the frame rate, step down:
   * 1 = Low post tier (no bloom, no grain), 2 = also no real-time shadows (the cars keep their blob shadows).
   */
  perfLevel = 0;
  degrade(): boolean {
    if (this.perfLevel >= 2) return false;
    this.perfLevel++;
    this.applyPerf();
    return true;
  }
  restore(): boolean {
    if (this.perfLevel <= 0) return false;
    this.perfLevel--;
    this.applyPerf();
    return true;
  }
  private applyPerf(): void {
    if (this.post) {
      this.post.perfFloor = this.perfLevel >= 1 ? 'low' : null;
      this.post.refreshTier();
    }
    this.setShadows(this.perfLevel < 2);
  }

  /* ---- section 12.8 debug view: velocity vectors and checkpoint gates ---- */
  private dbg: THREE.LineSegments | null = null;
  private readonly dbgPos = new Float32Array(4096 * 3);
  private readonly dbgCol = new Float32Array(4096 * 3);
  setDebugLines(on: boolean): void {
    if (on && !this.dbg) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.dbgPos, 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(this.dbgCol, 3).setUsage(THREE.DynamicDrawUsage));
      this.dbg = new THREE.LineSegments(
        g,
        new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true }),
      );
      this.dbg.frustumCulled = false;
      this.dbg.renderOrder = 10;
      this.scene.add(this.dbg);
    }
    if (this.dbg) this.dbg.visible = on;
  }
  updateDebugLines(s: Readonly<GameState>): void {
    if (!this.dbg?.visible) return;
    const P = this.dbgPos,
      C = this.dbgCol,
      T = s.track;
    let n = 0;
    const seg = (
      ax: number,
      ay: number,
      az: number,
      bx: number,
      by: number,
      bz: number,
      r: number,
      g: number,
      b: number,
    ): void => {
      if (n >= 2046) return;
      P.set([ax, ay, az, bx, by, bz], n * 6);
      C.set([r, g, b, r, g, b], n * 6);
      n++;
    };
    for (const k of s.karts) {
      const y = k.y + 1.2;
      // velocity (cyan), heading (white), and the next checkpoint for this car (yellow)
      seg(k.x, y, k.z, k.x + k.vx * 0.4, y, k.z + k.vz * 0.4, 0.2, 0.9, 1);
      seg(k.x, y, k.z, k.x + Math.sin(k.h) * 4, y, k.z + Math.cos(k.h) * 4, 1, 1, 1);
    }
    T.gates.forEach((g) => {
      const w = T.WALLD[g]!;
      seg(
        T.CX[g]! - T.RX[g]! * w,
        T.H[g]! + 0.5,
        T.CZ[g]! - T.RZ[g]! * w,
        T.CX[g]! + T.RX[g]! * w,
        T.H[g]! + 0.5,
        T.CZ[g]! + T.RZ[g]! * w,
        1,
        0.85,
        0.1,
      );
    });
    const w0 = T.WALLD[0]!;
    seg(
      T.CX[0]! - T.RX[0]! * w0,
      T.H[0]! + 0.5,
      T.CZ[0]! - T.RZ[0]! * w0,
      T.CX[0]! + T.RX[0]! * w0,
      T.H[0]! + 0.5,
      T.CZ[0]! + T.RZ[0]! * w0,
      1,
      0.2,
      0.2,
    );
    const g = this.dbg.geometry;
    g.setDrawRange(0, n * 2);
    g.attributes.position!.needsUpdate = true;
    g.attributes.color!.needsUpdate = true;
  }

  /** Q: cycle the quality tier override (auto, High, Medium, Low). */
  cycleTier(): Tier | null {
    if (!this.post) return null;
    const t = this.post.cycleOverride();
    this.post.setSize(window.innerWidth, window.innerHeight, this.pixelRatio);
    return t;
  }

  /** Draw calls and triangles summed over every view in the last frame (renderer.info resets per render call). */
  readonly frameStats = { calls: 0, triangles: 0, views: 0 };
  private readonly hidden: KartView[] = [];
  private viewCount = 1;

  /** Shorter draw distance and fog with more than 3 viewports (section 6.3). The sky dome shrinks to fit. */
  setViewCount(n: number): void {
    this.viewCount = n;
    const R = n > 3 ? VIEW_RANGE.many : VIEW_RANGE.near;
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.near = R.fog[0];
      fog.far = R.fog[1];
    }
    this.post?.setViewCount(n);
    // budgets per tier: fewer grass tufts, no tree shadows and a smaller shadow map when many views draw it all
    this.nature?.setDetail(n <= 2 ? 1 : n <= 4 ? 0.4 : 0.22);
    this.scenery?.setCastShadows(n <= 2);
    for (const v of this.views) v.setShadowDetail(n <= 2);
    const ms = n <= 3 ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.post) this.post.setSize(window.innerWidth, window.innerHeight, this.pixelRatio);
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
    // an off-screen target ignores the renderer's viewport: it has its own viewport and scissor, in device pixels
    const tgt = this.post ? this.post.target : null,
      pr = this.pixelRatio;
    if (tgt) {
      tgt.scissorTest = false;
      tgt.viewport.set(0, 0, tgt.width, tgt.height);
    }
    r.setRenderTarget(tgt);
    r.setScissorTest(true);
    r.setViewport(0, 0, window.innerWidth, H);
    r.setScissor(0, 0, window.innerWidth, H);
    r.setClearColor(0x14162f, 1);
    r.clear();
    for (const v of list) {
      const { x, y, w, h } = v.rect;
      const by = H - y - h;
      if (tgt) {
        const px = Math.round(x * pr),
          py = Math.round(by * pr),
          pw = Math.round(w * pr),
          ph = Math.round(h * pr);
        tgt.viewport.set(px, py, pw, ph);
        tgt.scissor.set(px, py, pw, ph);
        tgt.scissorTest = true;
        r.setRenderTarget(tgt);
      }
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
    if (this.post) {
      const now = performance.now(),
        dt = Math.min(0.1, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      r.setRenderTarget(null);
      // the composite covers the whole screen: undo the last view's viewport and scissor
      r.setViewport(0, 0, window.innerWidth, H);
      r.setScissor(0, 0, window.innerWidth, H);
      this.post.render(
        list.map((v) => ({ rect: v.rect, camera: v.camera, blur: v.blur ?? 0, boost: v.boost ?? 0 })),
        window.innerWidth,
        H,
        dt,
      );
    }
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
    if (this.nature) {
      this.scene.remove(this.nature.group);
      this.nature.dispose();
      this.nature = null;
    }
    if (this.ambient) {
      this.scene.remove(this.ambient.points);
      this.ambient.dispose();
      this.ambient = null;
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
