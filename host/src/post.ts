/**
 * Cinematic post-processing (D45, section 10.2), shared by every split-screen viewport:
 *
 * 1. The views render (scissored) into one HDR target with a depth texture. Phase 14: the target is multisampled
 *    (4x on High and Medium, 2x on Low). Three.js resolves it after every view's render call and then discards the
 *    samples, but the resolve blit obeys the scissor, so each call copies only its own view and the earlier
 *    split-screen views survive. SMAA still runs at the end for the edges inside textures and post effects.
 * 2. Atmosphere pass, per viewport (rects, inverse projections and camera matrices are uniforms):
 *    height fog with sun in-scattering (aerial perspective, low-lying mist, "volumetric-looking" sun haze),
 *    a lens flare (glow, streak and ghosts, only when the sun is actually visible in that view), and motion blur:
 *    camera motion blur (D63: each pixel's world position from depth is reprojected with last frame's camera, and
 *    the image is smeared along that screen motion over a fixed shutter time), with the karts' own movement taken
 *    out so they stay sharp, plus the radial speed streak towards the edges that grows with speed and boost.
 * 3. Bloom (UnrealBloomPass) on the bright parts: sparks, flames, item boxes, the sun, wet highlights.
 * 4. Finish: colour grading (lift/gamma/gain, saturation, contrast, warmth), per-view vignette, chromatic
 *    fringe while boosting, and fine animated film grain.
 * 5. ACES Filmic tone mapping and sRGB output (OutputPass), then SMAA anti-aliasing.
 *
 * Quality tiers (section 10.2): 1-2 views High, 3-4 Medium, 5 Low; Q cycles an override.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import type { Rect } from './renderer';

export const MAX_VIEWS = 5;
/** Phase 14: MSAA samples per tier for the scene target; ?msaa=N overrides (0 turns it off). */
const MSAA = { high: 4, medium: 2, low: 2 } as const;
const MSAA_OVERRIDE = ((): number | null => {
  const v = new URLSearchParams(location.search).get('msaa');
  return v === null ? null : Math.max(0, Math.min(8, Number(v) || 0));
})();
export type Tier = 'high' | 'medium' | 'low';

/** D63 motion blur: shutter as a share of a 60 fps frame (0.5 = a 180 degree shutter), samples per tier, the longest
 * smear (share of the view width), and ?mblur=0 to turn it off. */
const MBLUR = {
  shutter: 0.6,
  taps: { high: 12, medium: 9, low: 6 } as const,
  maxLen: 0.06,
  on: new URLSearchParams(location.search).get('mblur') !== '0',
};
/** Karts (moving objects) the motion blur compensates for. */
export const MAX_MOVERS = 8;
export interface Mover {
  /** The kart's origin on the ground (world). */
  pos: THREE.Vector3;
  /** Heading (rotation about y). */
  yaw: number;
  /** World movement since the last frame. */
  delta: THREE.Vector3;
}
/** A kart's box in its own frame (metres, after CAR_SCALE): half width, rear and front, floor and roof. Wheels below
 * the floor count as road (they touch it), so the road next to and under the car still blurs. */
const KART_BOX = { halfW: 1.75, rear: -3.25, front: 2.95, floor: 0.12, roof: 1.75 };

/** Per-theme look: fog, light shafts, flare and grade. */
export interface PostLook {
  exposure: number;
  fogColor: THREE.Color;
  /** Overall fog density (1/m) at fogBase height. */
  fogDensity: number;
  /** Height falloff (1/m): bigger = fog hugs the ground. */
  fogFalloff: number;
  fogBase: number;
  /** Extra mist in the lowest few metres (valleys). */
  mist: number;
  sunColor: THREE.Color;
  /** How strongly the fog glows toward the sun. */
  scatter: number;
  flare: number;
  lift: THREE.Vector3;
  gamma: THREE.Vector3;
  gain: THREE.Vector3;
  saturation: number;
  contrast: number;
  vignette: number;
  grain: number;
  bloom: number;
}

export interface PostView {
  rect: Rect;
  camera: THREE.PerspectiveCamera;
  /** 0..1: speed blur and boost fringe. */
  blur: number;
  boost: number;
  /** 0..1: camera motion blur (D63), 0 when paused or off the race. */
  motion: number;
}

const ATMOS = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tScene: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uCount: { value: 0 },
    uRect: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Vector4()) },
    uInvProj: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Matrix4()) },
    uCamWorld: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Matrix4()) },
    uSun: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Vector3()) },
    uBlur: { value: new Array<number>(MAX_VIEWS).fill(0) },
    uAspect: { value: new Array<number>(MAX_VIEWS).fill(1) },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uFogColor: { value: new THREE.Color() },
    uSunColor: { value: new THREE.Color() },
    uFog: { value: new THREE.Vector4() },
    uScatter: { value: 0 },
    uFlare: { value: 0 },
    uPrevVP: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Matrix4()) },
    uMotion: { value: new Array<number>(MAX_VIEWS).fill(0) },
    uShutter: { value: 0 },
    uTaps: { value: 12 },
    uMovers: { value: 0 },
    uMover: { value: Array.from({ length: MAX_MOVERS }, () => new THREE.Vector4()) },
    uMoverD: { value: Array.from({ length: MAX_MOVERS }, () => new THREE.Vector4()) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #define MAXV ${MAX_VIEWS}
    #define MAXM ${MAX_MOVERS}
    #define MAXTAPS 12
    #define MAXLEN ${MBLUR.maxLen.toFixed(3)}
    uniform sampler2D tScene; uniform sampler2D tDepth;
    uniform int uCount;
    uniform vec4 uRect[MAXV]; uniform mat4 uInvProj[MAXV]; uniform mat4 uCamWorld[MAXV];
    uniform vec3 uSun[MAXV]; uniform float uBlur[MAXV]; uniform float uAspect[MAXV];
    uniform vec3 uSunDir; uniform vec3 uFogColor; uniform vec3 uSunColor;
    uniform vec4 uFog; // density, falloff, base height, mist
    uniform float uScatter; uniform float uFlare;
    uniform mat4 uPrevVP[MAXV]; uniform float uMotion[MAXV]; uniform float uShutter; uniform int uTaps;
    uniform int uMovers; uniform vec4 uMover[MAXM]; uniform vec4 uMoverD[MAXM]; // xyz + cos(yaw), delta + sin(yaw)
    varying vec2 vUv;

    float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
    /** View-space position of a pixel of view vi (lp: 0..1 inside the view, z: depth buffer). */
    vec3 viewPos(int vi, vec2 lp, float z) {
      vec4 v = uInvProj[vi] * vec4(lp * 2.0 - 1.0, z * 2.0 - 1.0, 1.0);
      return v.xyz / v.w;
    }
    /** Which kart's box a world point is in, or -1. */
    int moverAt(vec3 p) {
      for (int m = 0; m < MAXM; m++) {
        if (m >= uMovers) break;
        vec3 q = p - uMover[m].xyz;
        if (dot(q, q) > 16.0) continue;
        float c = uMover[m].w, s = uMoverD[m].w;
        vec3 l = vec3(c * q.x - s * q.z, q.y, s * q.x + c * q.z);
        if (abs(l.x) < ${KART_BOX.halfW.toFixed(2)} && l.z > ${KART_BOX.rear.toFixed(2)} && l.z < ${KART_BOX.front.toFixed(2)} &&
            l.y > ${KART_BOX.floor.toFixed(2)} && l.y < ${KART_BOX.roof.toFixed(2)}) return m;
      }
      return -1;
    }

    void main() {
      int vi = -1;
      for (int i = 0; i < MAXV; i++) {
        if (i >= uCount) break;
        vec4 r = uRect[i];
        if (vUv.x >= r.x && vUv.x <= r.x + r.z && vUv.y >= r.y && vUv.y <= r.y + r.w) vi = i;
      }
      vec3 col = texture2D(tScene, vUv).rgb;
      if (vi < 0) { gl_FragColor = vec4(col, 1.0); return; }
      vec4 R = uRect[vi];
      vec2 lp = (vUv - R.xy) / R.zw;              // 0..1 inside this view

      // world position from depth
      float z = texture2D(tDepth, vUv).x;
      vec3 vp = viewPos(vi, lp, z);
      vec3 camPos = uCamWorld[vi][3].xyz;
      vec3 wp = (uCamWorld[vi] * vec4(vp, 1.0)).xyz;
      vec3 rd = normalize(wp - camPos);
      float dist = z >= 0.99999 ? 4200.0 : length(vp);

      // D63 camera motion blur: where was this point on screen last frame? A kart's pixels move with the kart, so
      // its own movement is taken out first (it stays sharp); everything else is treated as standing still
      vec2 mv = vec2(0.0);
      int own = -1;
      if (uMotion[vi] > 0.0) {
        own = moverAt(wp);
        vec3 pw = own >= 0 ? wp - uMoverD[own].xyz : wp;
        vec4 pc = uPrevVP[vi] * vec4(pw, 1.0);
        if (pc.w > 0.05) {
          mv = (lp - (pc.xy / pc.w * 0.5 + 0.5)) * uShutter * uMotion[vi];
          float ml = length(mv * vec2(uAspect[vi], 1.0));
          if (ml > MAXLEN) mv *= MAXLEN / ml;
        }
      }
      // radial speed streak, strongest at the edges of the view
      float amt = 0.0;
      vec2 rc = lp - vec2(0.5, 0.42);
      float bl = uBlur[vi];
      if (bl > 0.01) {
        float edge = smoothstep(0.12, 0.62, length(rc * vec2(uAspect[vi], 1.0)) / max(1.0, uAspect[vi] * 0.6));
        amt = bl * edge * 0.085;
      }
      // both in one pass: samples spread along the motion (centred on the pixel) and inward along the streak
      if (amt > 0.001 || dot(mv, mv) > 2e-6) {
        vec3 acc = col;
        float wsum = 1.0;
        float nT = float(uTaps - 1);
        for (int k = 1; k < MAXTAPS; k++) {
          if (k >= uTaps) break;
          float t = float(k) / nT;
          vec2 q = clamp(lp - rc * amt * t + mv * (t - 0.5), 0.001, 0.999);
          vec2 suv = R.xy + q * R.zw;
          // explicit level: no derivatives in the loop (D3D X3595)
          float tz = textureLod(tDepth, suv, 0.0).x;
          // do not pull a sharp kart into the blurred road around it
          int tm = moverAt((uCamWorld[vi] * vec4(viewPos(vi, q, tz), 1.0)).xyz);
          float w = tm >= 0 && tm != own ? 0.0 : 1.0;
          acc += textureLod(tScene, suv, 0.0).rgb * w;
          wsum += w;
        }
        col = acc / wsum;
      }

      // height fog (analytic integral along the ray) with sun in-scattering and low-lying mist
      float dens = uFog.x, fall = uFog.y, base = uFog.z;
      float h0 = camPos.y - base;
      float ry = rd.y * fall;
      float fogAmt = dens * exp(-h0 * fall) * (abs(ry) > 1e-4 ? (1.0 - exp(-dist * ry)) / ry : dist);
      float yEnd = camPos.y + rd.y * dist - base;
      fogAmt += uFog.w * smoothstep(6.0, 0.0, yEnd) * smoothstep(20.0, 160.0, dist);
      if (z >= 0.99999) fogAmt *= 0.55;   // the sky already has its own gradient
      float f = 1.0 - exp(-fogAmt);
      float sunAmt = pow(max(dot(rd, uSunDir), 0.0), 6.0);
      vec3 fc = mix(uFogColor, uSunColor, sunAmt * uScatter);
      col = mix(col, fc, clamp(f, 0.0, 1.0));

      // lens flare: only if the sun is in front of this camera and actually visible (bright) in the image
      vec3 S = uSun[vi];
      if (uFlare > 0.0 && S.z > 0.0) {
        vec2 sp = S.xy;
        vec2 suv = R.xy + clamp(sp, 0.0, 1.0) * R.zw;
        float vis = 0.0;
        for (int k = 0; k < 5; k++) {
          vec2 o = vec2(float(k - 2) * 0.004, float(2 - k) * 0.003);
          vis += smoothstep(0.9, 1.6, lum(textureLod(tScene, suv + o, 0.0).rgb));
        }
        vis = vis / 5.0 * smoothstep(-0.1, 0.05, min(min(sp.x, sp.y), min(1.0 - sp.x, 1.0 - sp.y)) + 0.1);
        if (vis > 0.0) {
          vec2 a = vec2(uAspect[vi], 1.0);
          vec2 d = (lp - sp) * a;
          float g = exp(-length(d) * 7.0) * 0.9 + exp(-length(d) * 1.8) * 0.18;
          float streak = exp(-abs(d.y) * 120.0) * exp(-abs(d.x) * 2.2) * 0.35;
          vec3 fl = uSunColor * (g + streak);
          vec2 axis = vec2(0.5) - sp;
          for (int k = 1; k <= 4; k++) {
            float t = float(k) * 0.42;
            vec2 gp = (lp - (sp + axis * t * 2.0)) * a;
            float rr = 0.03 + float(k) * 0.018;
            float ring = smoothstep(rr, rr * 0.7, length(gp)) * 0.09;
            vec3 tint = k == 1 ? vec3(1.0, 0.7, 0.4) : k == 2 ? vec3(0.5, 0.8, 1.0) : k == 3 ? vec3(0.8, 1.0, 0.6) : vec3(1.0, 0.6, 0.9);
            fl += tint * ring;
          }
          col += fl * vis * uFlare;
        }
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
};

const FINISH = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uCount: { value: 0 },
    uRect: { value: Array.from({ length: MAX_VIEWS }, () => new THREE.Vector4()) },
    uBoost: { value: new Array<number>(MAX_VIEWS).fill(0) },
    uLift: { value: new THREE.Vector3() },
    uGamma: { value: new THREE.Vector3(1, 1, 1) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.03 },
    uTime: { value: 0 },
  },
  vertexShader: ATMOS.vertexShader,
  fragmentShader: /* glsl */ `
    #define MAXV ${MAX_VIEWS}
    uniform sampler2D tDiffuse;
    uniform int uCount; uniform vec4 uRect[MAXV]; uniform float uBoost[MAXV];
    uniform vec3 uLift; uniform vec3 uGamma; uniform vec3 uGain;
    uniform float uSat; uniform float uContrast; uniform float uVignette; uniform float uGrain; uniform float uTime;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      int vi = -1;
      for (int i = 0; i < MAXV; i++) {
        if (i >= uCount) break;
        vec4 r = uRect[i];
        if (vUv.x >= r.x && vUv.x <= r.x + r.z && vUv.y >= r.y && vUv.y <= r.y + r.w) vi = i;
      }
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      if (vi < 0) { gl_FragColor = vec4(col, 1.0); return; }
      vec4 R = uRect[vi];
      vec2 lp = (vUv - R.xy) / R.zw;
      vec2 d = lp - 0.5;
      // chromatic fringe at the edges while boosting
      float ca = uBoost[vi] * 0.006 * dot(d, d) * 4.0;
      if (ca > 0.0001) {
        col.r = texture2D(tDiffuse, R.xy + clamp(lp + d * ca * 3.0, 0.0, 1.0) * R.zw).r;
        col.b = texture2D(tDiffuse, R.xy + clamp(lp - d * ca * 3.0, 0.0, 1.0) * R.zw).b;
      }
      // grade in linear HDR, before tone mapping: lift / gamma / gain, contrast around mid grey, saturation
      col = max(col * uGain + uLift * (1.0 - min(col, vec3(1.0))), 0.0);
      col = pow(col, 1.0 / uGamma);
      col = (col - 0.18) * uContrast + 0.18;
      float L = dot(max(col, 0.0), vec3(0.2126, 0.7152, 0.0722));
      col = max(mix(vec3(L), col, uSat), 0.0);
      // vignette per view
      float vg = smoothstep(0.85, 0.25, length(d * vec2(1.0, 0.85)) * 1.15);
      col *= mix(1.0 - uVignette, 1.0, vg);
      // film grain (luminance-weighted so the shadows do not go grey)
      float n = hash(vUv * vec2(1931.0, 1137.0) + fract(uTime) * 61.0) - 0.5;
      col += n * uGrain * (0.25 + 0.75 * sqrt(max(L, 0.0))) ;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Post {
  private rt: THREE.WebGLRenderTarget;
  private readonly composer: EffectComposer;
  private readonly atmos: ShaderPass;
  private readonly bloom: UnrealBloomPass;
  private readonly finish: ShaderPass;
  private readonly smaa: SMAAPass;
  tier: Tier = 'high';
  /** Q-key override, or null for automatic. */
  override: Tier | null = null;
  private look: PostLook | null = null;
  private readonly sunWorld = new THREE.Vector3();
  /** Last frame's view-projection per view slot (D63), and which camera it belonged to. */
  private readonly prevVP = Array.from({ length: MAX_VIEWS }, () => new THREE.Matrix4());
  private readonly prevCam: (THREE.Camera | null)[] = new Array<THREE.Camera | null>(MAX_VIEWS).fill(null);
  private readonly prevPos = Array.from({ length: MAX_VIEWS }, () => new THREE.Vector3());
  private readonly vp = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private time = 0;

  constructor(private readonly renderer: THREE.WebGLRenderer) {
    this.rt = this.makeTarget(1, 1);
    this.composer = new EffectComposer(renderer);
    this.composer.renderToScreen = true;
    this.atmos = new ShaderPass(ATMOS);
    this.atmos.uniforms.tScene!.value = this.rt.texture;
    this.atmos.uniforms.tDepth!.value = this.rt.depthTexture;
    this.composer.addPass(this.atmos);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.15);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass(FINISH);
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass();
    this.composer.addPass(this.smaa);
  }

  private makeTarget(w: number, h: number, samples = 0): THREE.WebGLRenderTarget {
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
    rt.depthTexture = new THREE.DepthTexture(w, h, THREE.FloatType);
    return rt;
  }

  /** The target the scene views render into. */
  get target(): THREE.WebGLRenderTarget {
    return this.rt;
  }

  setLook(l: PostLook, sunDir: THREE.Vector3): void {
    this.look = l;
    this.renderer.toneMappingExposure = l.exposure;
    const a = this.atmos.uniforms;
    a.uFogColor!.value.copy(l.fogColor);
    a.uSunColor!.value.copy(l.sunColor);
    a.uFog!.value.set(l.fogDensity, l.fogFalloff, l.fogBase, l.mist);
    a.uScatter!.value = l.scatter;
    a.uFlare!.value = l.flare;
    a.uSunDir!.value.copy(sunDir).normalize();
    this.sunWorld.copy(sunDir).normalize().multiplyScalar(5000);
    const f = this.finish.uniforms;
    f.uLift!.value.copy(l.lift);
    f.uGamma!.value.copy(l.gamma);
    f.uGain!.value.copy(l.gain);
    f.uSat!.value = l.saturation;
    f.uContrast!.value = l.contrast;
    f.uVignette!.value = l.vignette;
    this.applyTier();
  }

  /** Pick the quality tier from the number of views (section 10.2), unless overridden with Q. */
  /** Automatic quality (phase 13): tiers below this are forced when the frame rate cannot be held. */
  perfFloor: Tier | null = null;
  private viewTier: Tier = 'high';

  setViewCount(n: number): void {
    const auto: Tier = n <= 2 ? 'high' : n <= 4 ? 'medium' : 'low';
    this.viewTier = auto;
    const rank = { high: 0, medium: 1, low: 2 } as const;
    const floor = this.perfFloor && rank[this.perfFloor] > rank[auto] ? this.perfFloor : auto;
    const t = this.override ?? floor;
    if (t === this.tier) return;
    this.tier = t;
    this.applyTier();
  }

  /** Re-apply the tier after the performance floor changed. */
  refreshTier(): void {
    const n = this.viewTier === 'high' ? 1 : this.viewTier === 'medium' ? 3 : 5;
    this.tier = this.tier === 'high' ? 'medium' : 'high'; // force a change so applyTier runs
    this.setViewCount(n);
  }

  cycleOverride(): Tier {
    const order: (Tier | null)[] = [null, 'high', 'medium', 'low'];
    this.override = order[(order.indexOf(this.override) + 1) % order.length]!;
    this.tier = this.override ?? this.tier;
    this.applyTier();
    return this.override ?? this.tier;
  }

  private applyTier(): void {
    const l = this.look;
    this.bloom.strength = (l?.bloom ?? 0.5) * (this.tier === 'low' ? 0.8 : 1);
    // the Low tier drops bloom entirely (section 10.2: everything can be disabled on Low)
    this.bloom.enabled = this.tier !== 'low' || this.override === 'low';
    this.finish.uniforms.uGrain!.value = this.tier === 'low' ? 0 : (l?.grain ?? 0.02);
    this.atmos.uniforms.uTaps!.value = MBLUR.taps[this.tier];
    this.setSamples(MSAA_OVERRIDE ?? MSAA[this.tier]);
  }

  /** Multisampling of the scene target: changing it means a new target (and rebinding the atmosphere inputs). */
  private setSamples(n: number): void {
    const n2 = Math.min(n, this.renderer.capabilities.maxSamples);
    if (this.rt.samples === n2) return;
    const old = this.rt;
    this.rt = this.makeTarget(old.width, old.height, n2);
    this.atmos.uniforms.tScene!.value = this.rt.texture;
    this.atmos.uniforms.tDepth!.value = this.rt.depthTexture;
    old.depthTexture?.dispose();
    old.dispose();
  }

  setSize(w: number, h: number, pixelRatio: number): void {
    const pw = Math.max(1, Math.round(w * pixelRatio)),
      ph = Math.max(1, Math.round(h * pixelRatio));
    this.rt.setSize(pw, ph);
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    this.smaa.setSize(pw, ph);
    // bloom at half resolution (quarter on Low) is plenty for a soft glow
    const div = this.tier === 'low' ? 4 : 2;
    this.bloom.resolution.set(pw / div, ph / div);
  }

  /** Composite: per-view atmosphere and lens, bloom, grade, tone mapping, to the screen. */
  render(views: PostView[], W: number, H: number, dt: number, movers: readonly Mover[] = []): void {
    this.time += dt;
    const a = this.atmos.uniforms,
      f = this.finish.uniforms;
    // a fixed exposure time, so the smear is the same length at any frame rate
    a.uShutter!.value = (MBLUR.shutter * (1 / 60)) / Math.max(1 / 240, Math.min(1 / 20, dt));
    const nm = Math.min(MAX_MOVERS, movers.length);
    a.uMovers!.value = nm;
    for (let i = 0; i < nm; i++) {
      const m = movers[i]!;
      (a.uMover!.value as THREE.Vector4[])[i]!.set(m.pos.x, m.pos.y, m.pos.z, Math.cos(m.yaw));
      (a.uMoverD!.value as THREE.Vector4[])[i]!.set(m.delta.x, m.delta.y, m.delta.z, Math.sin(m.yaw));
    }
    const n = Math.min(MAX_VIEWS, views.length);
    a.uCount!.value = n;
    f.uCount!.value = n;
    views.slice(0, n).forEach((v, i) => {
      const { x, y, w, h } = v.rect;
      // uv space has its origin at the bottom left
      const r = (a.uRect!.value as THREE.Vector4[])[i]!.set(x / W, (H - y - h) / H, w / W, h / H);
      (f.uRect!.value as THREE.Vector4[])[i]!.copy(r);
      (a.uInvProj!.value as THREE.Matrix4[])[i]!.copy(v.camera.projectionMatrixInverse);
      (a.uCamWorld!.value as THREE.Matrix4[])[i]!.copy(v.camera.matrixWorld);
      (a.uBlur!.value as number[])[i] = v.blur;
      (a.uAspect!.value as number[])[i] = w / h;
      (f.uBoost!.value as number[])[i] = v.boost;
      // motion blur: last frame's camera for this view; a new camera, a cut or a jump (rescue) starts clean
      v.camera.updateMatrixWorld();
      this.vp.multiplyMatrices(v.camera.projectionMatrix, v.camera.matrixWorldInverse);
      const pv = this.prevVP[i]!;
      const fresh =
        !MBLUR.on ||
        v.motion <= 0 ||
        this.prevCam[i] !== v.camera ||
        this.prevPos[i]!.distanceTo(v.camera.position) > 8;
      (a.uPrevVP!.value as THREE.Matrix4[])[i]!.copy(fresh ? this.vp : pv);
      (a.uMotion!.value as number[])[i] = fresh ? 0 : v.motion;
      pv.copy(this.vp);
      this.prevCam[i] = v.camera;
      this.prevPos[i]!.copy(v.camera.position);
      // the sun's position on this view (z > 0 when in front of the camera)
      const p = this.tmp.copy(this.sunWorld).add(v.camera.position).project(v.camera);
      const sx = p.x * 0.5 + 0.5,
        sy = p.y * 0.5 + 0.5;
      const inFront =
        this.tmp
          .set(0, 0, -1)
          .applyQuaternion(v.camera.quaternion)
          .dot(a.uSunDir!.value as THREE.Vector3) > 0;
      (a.uSun!.value as THREE.Vector3[])[i]!.set(sx, sy, inFront ? 1 : -1);
    });
    f.uTime!.value = this.time;
    this.composer.render(dt);
  }

  dispose(): void {
    this.rt.dispose();
    this.composer.dispose();
  }
}
