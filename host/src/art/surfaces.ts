/**
 * Phase 9 surface materials (section 11.3): physically based, sampled in world space so nothing visibly tiles.
 *
 * - Road: asphalt albedo/normal with macro variation, patch repairs, fine cracks and oil stains from the wear masks,
 *   a darker rubbered-in racing line, painted edge and dashed centre lines with wear, and puddle sheen (Frosty).
 * - Kerbs: red/white paint with chips, rumble-ridge normals (the geometry is raised and bevelled by the builder).
 * - Ground: one splat material for the terrain and the road verges, so they meet without a seam. It mixes the
 *   theme's ground layer (grass, sand or snow) with dirt, rock and snow by slope, height, distance from the road
 *   and painted masks, each with its own normal detail.
 */
import * as THREE from 'three';
import type { Theme } from './palette';
import { textures, type SurfaceTex } from './textures';

type Shader = THREE.WebGLProgramParametersWithUniforms;

/** Shared vertex plumbing: world position and normal, and the builder's per-vertex attributes. */
function worldVaryings(shader: Shader, attrs: string[]): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
      varying vec3 vWP;
      varying vec3 vWN;
      ${attrs.map((a) => `attribute ${a};\nvarying ${a.replace(/a([A-Z])/, 'v$1')};`).join('\n')}`,
    )
    .replace(
      '#include <project_vertex>',
      `#include <project_vertex>
      vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vWN = normalize(mat3(modelMatrix) * objectNormal);
      ${attrs
        .map((a) => {
          const name = a.split(' ')[1]!;
          return `${name.replace(/^a/, 'v')} = ${name};`;
        })
        .join('\n')}`,
    );
}

/* ---------------- road ---------------- */

/**
 * Phase 14 shimmer fix: the asphalt's aggregate is one or two pixels per stone in the mid-distance, and sampled at
 * full detail it sparkles as the camera moves. A small mip bias on the asphalt's colour and normal maps picks a
 * slightly softer level; close up the stones still read.
 */
const ROAD_LOD_BIAS = 0.6;
const biased = (chunk: string): string =>
  chunk
    .replace('texture2D( map, vMapUv )', `texture2D( map, vMapUv, ${ROAD_LOD_BIAS.toFixed(2)} )`)
    .replaceAll(
      'texture2D( normalMap, vNormalMapUv )',
      `texture2D( normalMap, vNormalMapUv, ${ROAD_LOD_BIAS.toFixed(2)} )`,
    );

export function roadMaterial(th: Theme): THREE.MeshStandardMaterial {
  const T = textures();
  const m = new THREE.MeshStandardMaterial({
    map: T.asphalt.map,
    normalMap: T.asphalt.normal,
    roughness: 0.9,
    metalness: 0,
    // the asphalt texture is dark (real asphalt reflects ~10%); lift it and tint it slightly towards the theme
    color: new THREE.Color(th.road).lerp(new THREE.Color(0xffffff), 0.82).multiplyScalar(1.75),
  });
  const uniforms = {
    tMacro: { value: T.macro },
    tDetail: { value: T.detail },
    uPuddle: { value: th.id === 'frosty' ? 1 : 0 },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader, ['float aLat', 'float aLine', 'float aHW', 'float aDist']);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tMacro; uniform sampler2D tDetail; uniform float uPuddle;
        varying vec3 vWP; varying vec3 vWN;
        varying float vLat; varying float vLine; varying float vHW; varying float vDist;`,
      )
      .replace(
        '#include <map_fragment>',
        `${biased(THREE.ShaderChunk.map_fragment)}
        vec2 wp = vWP.xz;
        float mac = texture2D(tMacro, wp / 160.0).r;
        float mac2 = texture2D(tMacro, wp / 23.0 + 0.37).r;
        vec3 det = texture2D(tDetail, wp / 48.0).rgb;
        diffuseColor.rgb *= 0.82 + mac * 0.34;
        diffuseColor.rgb *= mix(1.0, 0.8, det.r);            // patch repairs: fresher, darker asphalt
        diffuseColor.rgb *= 1.0 - det.g * 0.55;              // fine cracks
        diffuseColor.rgb *= 1.0 - det.b * 0.4;               // oil stains
        float dl = vLat - vLine;
        float rubber = exp(-dl * dl / 7.0) * 0.6
          + (exp(-(dl - 0.85) * (dl - 0.85) / 0.18) + exp(-(dl + 0.85) * (dl + 0.85) / 0.18)) * 0.2;
        diffuseColor.rgb *= 1.0 - rubber * 0.17;
        float aw = fwidth(vLat) * 1.2;
        float ed = abs(vLat);
        float eLine = smoothstep(vHW - 0.9 - aw, vHW - 0.9 + aw, ed) * (1.0 - smoothstep(vHW - 0.5 - aw, vHW - 0.5 + aw, ed));
        float cLine = (1.0 - smoothstep(0.13 - aw, 0.13 + aw, ed)) * step(fract(vDist / 12.0), 0.45);
        float wear = smoothstep(0.35, 0.8, texture2D(tMacro, wp / 2.7).r * 0.8 + det.r * 0.4 + rubber * 0.3);
        float paint = max(eLine, cLine) * (1.0 - wear * 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.82, 0.82, 0.8), paint);
        float pud = smoothstep(0.66, 0.8, mac2) * smoothstep(0.3, 0.6, mac) * uPuddle * (1.0 - paint);
        diffuseColor.rgb *= 1.0 - pud * 0.3;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.6, paint);
        roughnessFactor *= mix(1.0, 0.88, det.r) * (1.0 - rubber * 0.12);
        roughnessFactor = mix(roughnessFactor, 0.12, pud);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `${biased(THREE.ShaderChunk.normal_fragment_maps)}
        normal = normalize(mix(normal, normalize(vNormal), max(paint * 0.6, smoothstep(0.0, 0.5, pud))));`,
      );
  };
  m.customProgramCacheKey = () => 'tk-road';
  return m;
}

/* ---------------- kerbs ---------------- */

export function kerbMaterial(th: Theme): THREE.MeshStandardMaterial {
  // paint blocks (red/white along the road, 2.5 m each) with chips, on a ridged normal map
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = th.kerbRed;
  g.fillRect(0, 0, 64, 128);
  g.fillStyle = th.kerbWhite;
  g.fillRect(0, 128, 64, 128);
  for (let k = 0; k < 140; k++) {
    g.fillStyle = `rgba(60,58,56,${0.25 + Math.random() * 0.4})`;
    g.beginPath();
    g.arc(Math.random() * 64, Math.random() * 256, 0.6 + Math.random() * 1.8, 0, Math.PI * 2);
    g.fill();
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = 8;
  const n = document.createElement('canvas');
  n.width = 4;
  n.height = 64;
  const ng = n.getContext('2d')!;
  for (let y = 0; y < 64; y++) {
    // rumble ridges every 0.5 m (8 ridges per 5 m tile of the paint)
    const s = Math.sin((y / 64) * Math.PI * 2 * 8);
    ng.fillStyle = `rgb(128,${Math.round(128 + s * 90)},${Math.round(230 - Math.abs(s) * 30)})`;
    ng.fillRect(0, y, 4, 1);
  }
  const normal = new THREE.CanvasTexture(n);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  // both sides: the left kerb's ribbon winds the other way
  return new THREE.MeshStandardMaterial({
    map,
    normalMap: normal,
    roughness: 0.55,
    metalness: 0,
    side: THREE.DoubleSide,
  });
}

/* ---------------- ground (terrain and verges) ---------------- */

interface GroundParams {
  ground: SurfaceTex;
  tint: THREE.Color;
  dirtEdge: number;
  dirtPatches: number;
  rockSlope: number;
  rockTint: THREE.Color;
  snowLine: number;
}

function groundParams(th: Theme): GroundParams {
  const T = textures();
  switch (th.id) {
    case 'canyon':
      return {
        ground: T.sand,
        tint: new THREE.Color(1.0, 0.94, 0.86),
        dirtEdge: 0.7,
        dirtPatches: 0.6,
        rockSlope: 0.28,
        rockTint: new THREE.Color(1.25, 0.72, 0.52),
        snowLine: 1e5,
      };
    case 'frosty':
      return {
        ground: T.snow,
        tint: new THREE.Color(0.96, 0.97, 1.0),
        dirtEdge: 0.45,
        dirtPatches: 0,
        rockSlope: 0.4,
        rockTint: new THREE.Color(0.82, 0.86, 1.0),
        snowLine: -1e5,
      };
    case 'tropical':
      return {
        ground: T.grass,
        tint: new THREE.Color(0.78, 0.98, 0.72),
        dirtEdge: 0.8,
        dirtPatches: 0.25,
        rockSlope: 0.38,
        rockTint: new THREE.Color(0.9, 0.95, 0.85),
        snowLine: 1e5,
      };
    default:
      return {
        ground: T.grass,
        tint: new THREE.Color(1.0, 1.06, 0.92),
        dirtEdge: 0.9,
        dirtPatches: 0.45,
        rockSlope: 0.36,
        rockTint: new THREE.Color(1.0, 0.98, 1.05),
        snowLine: 62,
      };
  }
}

/**
 * The splat material. Geometry needs a world-space `uv` (x, z / 5 m), `aRoad` (metres from the road edge) and
 * `aMask` (x: painted dirt, y: wet shore sand).
 */
export function groundMaterial(th: Theme): THREE.MeshStandardMaterial {
  const T = textures(),
    G = groundParams(th);
  const m = new THREE.MeshStandardMaterial({
    map: G.ground.map,
    normalMap: G.ground.normal,
    roughness: 0.95,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const uniforms = {
    tMacro: { value: T.macro },
    tGround: { value: G.ground.map },
    tGroundN: { value: G.ground.normal },
    tDirt: { value: T.dirt.map },
    tDirtN: { value: T.dirt.normal },
    tRock: { value: T.rock.map },
    tRockN: { value: T.rock.normal },
    tSnow: { value: T.snow.map },
    tSnowN: { value: T.snow.normal },
    tSand: { value: T.sand.map },
    uTint: { value: G.tint },
    uRockTint: { value: G.rockTint },
    uDirtEdge: { value: G.dirtEdge },
    uDirtPatches: { value: G.dirtPatches },
    uRockSlope: { value: G.rockSlope },
    uSnowLine: { value: G.snowLine },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    worldVaryings(shader, ['float aRoad', 'vec2 aMask']);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D tMacro, tGround, tGroundN, tDirt, tDirtN, tRock, tRockN, tSnow, tSnowN, tSand;
        uniform vec3 uTint, uRockTint;
        uniform float uDirtEdge, uDirtPatches, uRockSlope, uSnowLine;
        varying vec3 vWP; varying vec3 vWN; varying float vRoad; varying vec2 vMask;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 wp = vWP.xz;
        float mac = texture2D(tMacro, wp / 170.0).r;
        float mac2 = texture2D(tMacro, wp / 37.0 + vec2(0.31, 0.77)).r;
        // abs: some ribbons are wound downwards (both sides are drawn), they are still flat ground
        float slope = 1.0 - abs(normalize(vWN).y);
        float wRock = smoothstep(uRockSlope, uRockSlope + 0.16, slope + (mac2 - 0.5) * 0.12);
        float wSnow = smoothstep(uSnowLine, uSnowLine + 14.0, vWP.y + (mac - 0.5) * 16.0) * (1.0 - wRock * 0.6);
        float edge = (1.0 - smoothstep(0.0, 2.8, vRoad + (mac2 - 0.5) * 2.0)) * uDirtEdge;
        float wDirt = clamp(max(max(smoothstep(0.64, 0.8, mac2) * uDirtPatches, edge), vMask.x), 0.0, 1.0) * (1.0 - wRock);
        float wSand = clamp(vMask.y, 0.0, 1.0);
        vec2 uvG = wp / 5.0, uvD = wp / 4.0 + 0.2, uvR = wp / 9.0, uvS = wp / 6.0;
        vec3 col = texture2D(tGround, uvG).rgb * uTint;
        col = mix(col, texture2D(tDirt, uvD).rgb, wDirt);
        col = mix(col, texture2D(tSand, uvS).rgb, wSand);
        col = mix(col, texture2D(tRock, uvR).rgb * uRockTint, wRock);
        col = mix(col, texture2D(tSnow, uvS).rgb, wSnow);
        diffuseColor.rgb *= col * (0.84 + mac * 0.32);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(mix(mix(0.96, 0.9, wDirt), 0.82, wRock), 0.55, wSnow);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 nG = texture2D(tGroundN, uvG).xyz * 2.0 - 1.0;
        vec3 nD = texture2D(tDirtN, uvD).xyz * 2.0 - 1.0;
        vec3 nR = texture2D(tRockN, uvR).xyz * 2.0 - 1.0;
        vec3 nS = texture2D(tSnowN, uvS).xyz * 2.0 - 1.0;
        vec3 mapN = normalize(mix(mix(mix(nG, nD, wDirt), nR, wRock), nS, wSnow));
        mapN.xy *= normalScale;
        normal = normalize(tbn * mapN);`,
      );
  };
  m.customProgramCacheKey = () => 'tk-ground-' + th.id;
  return m;
}

/** A plain surface (gravel traps, shortcut paths, concrete): world-space uv from the geometry. */
export function layerMaterial(
  t: SurfaceTex,
  extra: THREE.MeshStandardMaterialParameters = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: t.map,
    normalMap: t.normal,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
    ...extra,
  });
}

/** World-space uv for a position attribute (x, z / scale). */
export function worldUv(g: THREE.BufferGeometry, scale: number): void {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) / scale;
    uv[i * 2 + 1] = p.getZ(i) / scale;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
