/**
 * D71 weather and time of day on the host: each weather is a variation of the track's theme (sky, sun, haze and
 * grade), plus what only some skies have: stars, kart head- and tail-lights with a pool of light on the road, edge
 * lamps along both kerbs (night), and the sim's puddles drawn as glossy wet patches (rain).
 */
import * as THREE from 'three';
import { KERB_W, posOnTrack, type Puddle, type Track, type Weather } from '@tk/shared';
import type { Theme, ThemeLook } from './palette';

/** What a weather adds on top of the theme's colours. */
export interface WeatherFx {
  kind: Weather;
  /** 0..1: how wet the road looks (rain). */
  wet: number;
  /** Lights on: head- and tail-lights, glowing kerbs and edge lamps. */
  night: boolean;
  /** 0..1: stars in the sky. */
  stars: number;
}

/** Keep the sun's compass direction, set its height (0 = horizon, 1 = overhead). */
function sunAt(d: Theme['sunDir'], y: number): Theme['sunDir'] {
  const h = Math.hypot(d[0], d[2]) || 1,
    k = Math.sqrt(1 - y * y) / h;
  return [d[0] * k, y, d[2] * k];
}
const scaleLook = (L: ThemeLook, o: Partial<ThemeLook>): ThemeLook => ({ ...L, ...o });

/** The theme as a weather sees it. Day is each theme's own look, except Frosty, whose own look is already a sunset. */
export function weatherTheme(th: Theme, w: Weather): Theme & { wx: WeatherFx } {
  const fx: WeatherFx = { kind: w, wet: 0, night: false, stars: 0 };
  const L = th.look;
  switch (w) {
    case 'day':
      if (th.id !== 'frosty') return { ...th, wx: fx };
      // a crisp bright mountain noon
      return {
        ...th,
        wx: fx,
        horizon: 0xdbe7f6,
        zenith: 0x2f73cf,
        sunLight: 0xfff5e8,
        hemiSky: 0xcfe0ff,
        sunGlow: [1.0, 0.96, 0.9],
        sun: 0.95,
        hemi: 0.55,
        sunDir: sunAt(th.sunDir, 0.6),
        look: scaleLook(L, {
          exposure: 0.94,
          fogColor: 0xdbe5f3,
          sunColor: 0xfff1dc,
          scatter: 0.3,
          flare: 0.35,
          bloom: 0.36,
          lift: [0.008, 0.012, 0.026],
          gain: [1.0, 1.0, 1.02],
          saturation: 1.08,
        }),
      };
    case 'sunset':
      if (th.id === 'frosty') return { ...th, wx: fx };
      // the sun on the horizon: orange glare, a violet sky, long shadows
      return {
        ...th,
        wx: fx,
        horizon: 0xffae78,
        zenith: 0x36397a,
        sunLight: 0xffa05c,
        hemiSky: 0xb6a3d6,
        hemiGround: new THREE.Color(th.hemiGround).multiplyScalar(0.8).getHex(),
        sunGlow: [1.0, 0.62, 0.36],
        sun: 1.0,
        hemi: 0.55,
        sunDir: sunAt(th.sunDir, 0.13),
        look: scaleLook(L, {
          exposure: 1.02,
          fogColor: 0xeca68a,
          fogDensity: L.fogDensity * 1.2,
          sunColor: 0xff9450,
          scatter: 1.35,
          flare: 0.95,
          lift: [0.02, 0.008, 0.03],
          gamma: [1.0, 0.99, 1.0],
          gain: [1.1, 0.97, 0.88],
          saturation: 1.16,
          vignette: 0.36,
        }),
      };
    case 'night':
      fx.night = true;
      fx.stars = 1;
      // moonlight: a cool, dim key light and a readable blue fill; the track's own lights do the rest
      return {
        ...th,
        wx: fx,
        horizon: 0x24305e,
        zenith: 0x05081a,
        sunLight: 0x9db4ff,
        hemiSky: 0x5a6ca8,
        hemiGround: 0x22283c,
        sunGlow: [0.75, 0.82, 1.0],
        sun: 0.42,
        hemi: 0.62,
        sunDir: sunAt([-th.sunDir[0], 0, -th.sunDir[2]], 0.5),
        look: scaleLook(L, {
          exposure: 1.2,
          fogColor: 0x1c2548,
          fogDensity: L.fogDensity * 1.4,
          mist: L.mist * 0.6,
          sunColor: 0x8ea4ff,
          scatter: 0.3,
          flare: 0.08,
          lift: [0.012, 0.016, 0.04],
          gamma: [1.0, 1.0, 1.02],
          gain: [0.94, 0.98, 1.08],
          saturation: 1.02,
          contrast: 1.1,
          vignette: 0.42,
          bloom: 0.8,
        }),
      };
    case 'rain':
      fx.wet = 1;
      // overcast: no sun disc, soft shadows, a grey haze that closes in
      return {
        ...th,
        wx: fx,
        horizon: 0x9aa4b0,
        zenith: 0x56606e,
        sunLight: 0xd6dfea,
        hemiSky: 0xc6cfdb,
        hemiGround: new THREE.Color(th.hemiGround).lerp(new THREE.Color(0x5a6068), 0.5).getHex(),
        sunGlow: [0.12, 0.12, 0.13],
        sun: 0.5,
        hemi: 0.85,
        sunDir: sunAt(th.sunDir, 0.7),
        look: scaleLook(L, {
          exposure: 1.04,
          fogColor: 0xa2abb6,
          fogDensity: L.fogDensity * 2.4,
          mist: L.mist * 2.5 + 0.004,
          sunColor: 0xc8d0da,
          scatter: 0.15,
          flare: 0,
          lift: [0.01, 0.014, 0.022],
          gamma: [1.0, 1.0, 1.0],
          gain: [0.97, 1.0, 1.04],
          saturation: 0.86,
          contrast: 1.06,
          vignette: 0.34,
          bloom: 0.38,
        }),
      };
    case 'snow':
      // a white-out sky: flat light, heavy flakes, a pale haze
      return {
        ...th,
        wx: fx,
        horizon: 0xdde3ec,
        zenith: 0x9aa7bc,
        sunLight: 0xeef2ff,
        hemiSky: 0xe0e8f6,
        sunGlow: [0.2, 0.2, 0.22],
        sun: 0.55,
        hemi: 0.9,
        sunDir: sunAt(th.sunDir, 0.65),
        look: scaleLook(L, {
          exposure: 1.04,
          fogColor: 0xdfe5ee,
          fogDensity: L.fogDensity * 2.6,
          mist: L.mist * 2 + 0.004,
          sunColor: 0xf0f4ff,
          scatter: 0.2,
          flare: 0,
          lift: [0.012, 0.016, 0.03],
          gamma: [1.0, 1.0, 1.0],
          gain: [0.98, 1.0, 1.04],
          saturation: 0.9,
          vignette: 0.32,
          bloom: 0.42,
        }),
      };
  }
}

/* ---------------- night: kart lights ---------------- */

let lightRes: {
  pool: THREE.BufferGeometry;
  poolMat: THREE.MeshBasicMaterial;
  lamp: THREE.BufferGeometry;
  head: THREE.MeshBasicMaterial;
  tail: THREE.MeshBasicMaterial;
} | null = null;

/** A soft cone of light: bright near the car, fading out ahead and to the sides. */
function poolTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 128;
  const g = c.getContext('2d')!;
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 64; x++) {
      const v = y / 127,
        u = (x / 63) * 2 - 1;
      // wider further out (a cone), soft edges, brightest a few metres ahead
      const spread = 0.28 + v * 0.72,
        side = Math.max(0, 1 - (u / spread) ** 2),
        along = Math.min(1, v * 6) * (1 - v) ** 1.3;
      const a = Math.round(255 * side * side * along);
      img.data.set([255, 226, 176, a], (y * 64 + x) * 4);
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function lights(): NonNullable<typeof lightRes> {
  if (lightRes) return lightRes;
  // the beam in kart space (before CAR_SCALE): from the nose to 22 m ahead, fanning out to 10 m wide. The texture's
  // top row (v = 1) lands at the nose once the plane is laid flat.
  const pool = new THREE.PlaneGeometry(8.6, 19).rotateX(-Math.PI / 2).translate(0, 0.07, 2.7 + 9.5);
  const poolMat = new THREE.MeshBasicMaterial({
    map: poolTexture(),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    toneMapped: false,
    fog: false,
  });
  lightRes = {
    pool,
    poolMat,
    lamp: new THREE.SphereGeometry(0.17, 10, 6),
    head: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2d8).multiplyScalar(3), toneMapped: false }),
    tail: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff1206).multiplyScalar(1.5), toneMapped: false }),
  };
  return lightRes;
}

/** Head- and tail-lights and the pool of light ahead, in kart space (add to the kart's root). Shared resources. */
export function kartLights(): THREE.Group {
  const R = lights(),
    g = new THREE.Group();
  const pool = new THREE.Mesh(R.pool, R.poolMat);
  pool.renderOrder = 2;
  g.add(pool);
  for (const x of [-0.78, 0.78]) {
    const h = new THREE.Mesh(R.lamp, R.head);
    h.position.set(x, 0.55, 2.78);
    h.scale.set(1.3, 0.7, 0.6);
    const t = new THREE.Mesh(R.lamp, R.tail);
    t.position.set(x * 0.9, 0.62, -2.6);
    t.scale.set(0.75, 0.38, 0.4);
    g.add(h, t);
  }
  return g;
}

/* ---------------- night: edge lamps ---------------- */

/** Small glowing lamps along both edges of the road, every 9 m, so the line reads in the dark. */
export function edgeLamps(T: Track): THREE.InstancedMesh {
  const step = Math.max(1, Math.round(9 / T.DS)),
    n = Math.ceil(T.N / step) * 2;
  const geo = new THREE.CylinderGeometry(0.16, 0.2, 0.9, 6).translate(0, 0.45, 0);
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd590).multiplyScalar(2.2), toneMapped: false });
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  const p = { x: 0, y: 0, z: 0 },
    m = new THREE.Matrix4();
  let c = 0;
  for (let i = 0; i < T.N; i += step)
    for (const sd of [-1, 1]) {
      const lat = sd * Math.min(T.HW[i]! + KERB_W + 0.9, T.WALLD[i]! - 0.4);
      posOnTrack(T, i, lat, p);
      m.makeTranslation(p.x, p.y, p.z);
      mesh.setMatrixAt(c++, m);
    }
  mesh.count = c;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------------- rain: puddles ---------------- */

/**
 * The sim's puddles as glossy dark water, draped over the road (each vertex placed on the surface, so they follow
 * slope and banking). Mirror-smooth, so they reflect the sky.
 */
export function puddleMesh(T: Track, puddles: readonly Puddle[], env: THREE.Texture | null): THREE.Mesh {
  const RINGS = 4,
    SEG = 20,
    pos: number[] = [],
    alpha: number[] = [],
    idx: number[] = [];
  const p = { x: 0, y: 0, z: 0 };
  for (const pd of puddles) {
    const base = pos.length / 3;
    for (let r = 0; r <= RINGS; r++)
      for (let s = 0; s < (r === 0 ? 1 : SEG); s++) {
        const a = (s / SEG) * Math.PI * 2,
          // a wobbly outline, so puddles are not perfect circles
          rr = (r / RINGS) * pd.r * (1 + 0.16 * Math.sin(a * 3 + pd.i) + 0.08 * Math.sin(a * 5 + pd.lat)),
          along = Math.cos(a) * rr * 1.35,
          lat = Math.sin(a) * rr;
        posOnTrack(T, pd.i + along / T.DS, pd.lat + lat, p);
        pos.push(p.x, p.y + 0.035, p.z);
        alpha.push(r === RINGS ? 0 : r === RINGS - 1 ? 0.55 : 0.85);
      }
    const ring = (r: number, s: number): number => base + (r === 0 ? 0 : 1 + (r - 1) * SEG + (s % SEG));
    for (let s = 0; s < SEG; s++) idx.push(ring(0, 0), ring(1, s + 1), ring(1, s));
    for (let r = 1; r < RINGS; r++)
      for (let s = 0; s < SEG; s++) {
        idx.push(ring(r, s), ring(r, s + 1), ring(r + 1, s));
        idx.push(ring(r, s + 1), ring(r + 1, s + 1), ring(r + 1, s));
      }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aA', new THREE.Float32BufferAttribute(alpha, 1));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3a4250,
    roughness: 0.04,
    metalness: 0.1,
    envMap: env,
    envMapIntensity: 1.6,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aA;\nvarying float vA;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvA = aA;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vA;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\ngl_FragColor.a *= vA;');
  };
  mat.customProgramCacheKey = () => 'tk-puddle';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  return mesh;
}
