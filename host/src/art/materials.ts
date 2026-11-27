/**
 * Shared materials. D45 (art pass): soft physically based materials replace the prototype's toon ramp.
 * Karts get a clear-coated paint (car paint with a glossy lacquer), props and scenery are matte PBR, and all of
 * them pick up the sky's image-based light (scene.environment).
 */
import * as THREE from 'three';
import { INK } from './palette';

export interface Materials {
  kart: THREE.MeshPhysicalMaterial;
  /** D47: the race car: per-vertex finish (aPbr), clear-coat paint, carbon weave, metal, rubber, glow. */
  car: THREE.MeshPhysicalMaterial;
  prop: THREE.MeshStandardMaterial;
  inst: THREE.MeshStandardMaterial;
  instL: THREE.MeshStandardMaterial;
  land: THREE.MeshStandardMaterial;
  line: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createMaterials(): Materials {
  const m = {
    kart: new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.05,
      clearcoat: 0.9,
      clearcoatRoughness: 0.12,
    }),
    car: carMaterial(),
    prop: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02 }),
    inst: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0 }),
    instL: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }),
    land: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }),
    line: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
  };
  return {
    ...m,
    dispose() {
      for (const mat of Object.values(m)) mat.dispose();
    },
  };
}

/**
 * The car shader: MeshPhysicalMaterial whose roughness, metalness, clear-coat and glow come from each vertex's
 * `aPbr`. Carbon parts get a fine 2 × 2 twill weave in object space (colour and roughness), so they read as
 * carbon fibre under the lacquer. Reflections come from the sky environment, set as this material's own envMap
 * (World.build) so its strength is independent of the scene's.
 *
 * D72: `livery` picks the pattern on the paint (0 = the neon chevrons, then stripes, flames, checker, camo,
 * pinstripe) in the `accent` colour. A garage car gets its own material; all of them share one shader program.
 */
export function carMaterial(livery = 0, accent = 0xffffff): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.9,
  });
  const liv = { uLiv: { value: livery }, uAccent: { value: new THREE.Color(accent) } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, liv);
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aPbr;\nvarying vec4 vPbr;\nvarying vec3 vObj;\nvarying vec3 vObjN;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr;\nvObj = position;\nvObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec4 vPbr;\nvarying vec3 vObj;\nvarying vec3 vObjN;\nuniform float uLiv;\nuniform vec3 uAccent;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float weave = 0.0;
        float roughMul = 1.0;
        // D72 garage liveries, in the accent colour (object space: x across, y up, z forward)
        if (uLiv > 0.5 && vPbr.w > 0.005 && vPbr.w < 0.02) {
          vec3 n = normalize(vObjN);
          float side = smoothstep(0.35, 0.75, abs(n.x)), top = 1.0 - side;
          vec3 base = diffuseColor.rgb, acc = uAccent;
          float m = 0.0;
          if (uLiv < 1.5) {
            // twin racing stripes nose to tail over the top
            float ax = abs(vObj.x), aa = fwidth(ax) + 0.004;
            m = (smoothstep(0.07 - aa, 0.07 + aa, ax) - smoothstep(0.24 - aa, 0.24 + aa, ax)) * top;
          } else if (uLiv < 2.5) {
            // hot-rod flames: tongues licking back from the nose with the base colour between them, a hot core
            float w = mix(vObj.x, vObj.y, side) * 9.0;
            float tongue = pow(abs(sin(w)), 2.0);
            float edge = 1.95 - 1.6 * tongue - 0.25 * sin(w * 0.43 + 1.3);
            float aa = fwidth(vObj.z) * 1.5 + 0.01;
            m = smoothstep(edge - aa, edge + aa, vObj.z) * (1.0 - smoothstep(2.5, 2.7, vObj.z));
            acc = mix(acc, vec3(1.0, 0.82, 0.25), smoothstep(edge + 0.35, edge + 0.9, vObj.z) * 0.75);
          } else if (uLiv < 3.5) {
            // a checkered flag over the rear half
            vec2 q = mix(vObj.xz, vObj.zy, side) / 0.26;
            float aa = fwidth(q.x) + fwidth(q.y);
            vec2 f = abs(fract(q) - 0.5);
            float c = mod(floor(q.x) + floor(q.y), 2.0);
            float soft = smoothstep(0.5, 0.5 - aa, max(f.x, f.y));
            m = mix(1.0 - c, c, soft) * (1.0 - smoothstep(-0.2, 0.5, vObj.z));
          } else if (uLiv < 4.5) {
            // camouflage: two layers of soft blobs
            float nz = sin(vObj.x * 5.1 + sin(vObj.z * 3.7)) * sin(vObj.z * 4.3 + sin(vObj.y * 6.1))
              + 0.5 * sin(vObj.y * 9.0 + vObj.z * 7.0 + vObj.x * 3.0);
            float aa = fwidth(nz) + 0.01;
            m = smoothstep(0.35 - aa, 0.35 + aa, nz);
            base = mix(base, base * 0.55, smoothstep(-0.45 + aa, -0.45 - aa, nz));
          } else {
            // pinstripes: fine lines along the car
            float p = mix(vObj.x / 0.2, vObj.y / 0.16, side);
            float aa = fwidth(p) * 1.2;
            float f = abs(fract(p) - 0.5);
            m = smoothstep(0.08 + aa, 0.08 - aa, f) * (1.0 - smoothstep(2.4, 2.9, vObj.z));
          }
          diffuseColor.rgb = mix(base, acc, m);
        } else
        // D49 livery: neon chevrons sweeping forward over the paint (yellow-green, blue, purple, pink), as the
        // reference. Top surfaces get forward-pointing V's, the sides rising diagonals; anti-aliased with fwidth.
        if (vPbr.w > 0.005 && vPbr.w < 0.02) {
          vec3 n = normalize(vObjN);
          float uTop = vObj.z * 0.9 - abs(vObj.x) * 2.4 + vObj.y * 0.4;
          float uSide = vObj.z * 0.75 + vObj.y * 2.1;
          float u = mix(uTop, uSide, smoothstep(0.35, 0.75, abs(n.x))) * 1.05;
          float f = fract(u);
          float aa = fwidth(u) * 1.2 + 0.002;
          float b1 = smoothstep(0.0 - aa, 0.0 + aa, f) - smoothstep(0.13 - aa, 0.13 + aa, f);
          float b2 = smoothstep(0.16 - aa, 0.16 + aa, f) - smoothstep(0.24 - aa, 0.24 + aa, f);
          float b3 = smoothstep(0.26 - aa, 0.26 + aa, f) - smoothstep(0.31 - aa, 0.31 + aa, f);
          float b4 = smoothstep(0.33 - aa, 0.33 + aa, f) - smoothstep(0.37 - aa, 0.37 + aa, f);
          float b5 = smoothstep(0.39 - aa, 0.39 + aa, f) - smoothstep(0.405 - aa, 0.405 + aa, f);
          // the stripes fade towards the nose tip, leaving the base colour there
          float zone = smoothstep(-2.4, -1.6, vObj.z) * (1.0 - smoothstep(1.6, 2.6, vObj.z) * 0.55);
          // stripes come in groups with plain base colour between them (every other repeat)
          zone *= smoothstep(0.12, 0.2, fract(u * 0.5 + 0.25)) * (1.0 - smoothstep(0.94, 1.0, fract(u * 0.5 + 0.25)));
          vec3 c = diffuseColor.rgb;
          c = mix(c, vec3(0.75, 1.0, 0.08), b1 * zone);
          c = mix(c, vec3(0.08, 0.32, 1.0), b2 * zone);
          c = mix(c, vec3(0.5, 0.12, 0.95), b3 * zone);
          c = mix(c, vec3(1.0, 0.25, 0.6), b4 * zone);
          c = mix(c, vec3(1.0), b5 * zone);
          diffuseColor.rgb = c;
        }
        if (vPbr.w < -0.5) {
          vec2 q = vec2(vObj.x + vObj.z, vObj.y - vObj.z) * 55.0;
          vec2 c = floor(q);
          float dir = mod(c.x + c.y, 2.0);
          vec2 f = fract(q);
          float thread = dir > 0.5 ? sin(f.x * 3.14159) : sin(f.y * 3.14159);
          weave = thread;
          diffuseColor.rgb *= 0.82 + 0.32 * thread;
        }
        // D81 realism (the same car, finished more like a real one)
        bool rubber = abs(vPbr.x - 0.82) < 0.005 && vPbr.y < 0.01 && vPbr.z < 0.01 && abs(vPbr.w) < 0.001;
        if (rubber) {
          // tyres: near-black rubber; on the tread, blocks between circumferential and slanted grooves; on the
          // sidewall, fine moulded rings
          vec3 n = normalize(vObjN);
          float r = length(vObj.yz);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.085, 0.085, 0.095), 0.7);
          if (abs(n.x) < 0.6) {
            float ang = atan(vObj.z, vObj.y) / 6.28318;
            float lx = abs(vObj.x);
            float slant = fract(ang * 26.0 + fract(lx * 2.4) * 0.45);
            float aa = fwidth(ang * 26.0) + 0.02;
            float g1 = smoothstep(0.14 + aa, 0.14 - aa, abs(slant - 0.5) - 0.32);
            float g2 = smoothstep(0.07 + aa, 0.07 - aa, abs(fract(lx * 4.6) - 0.5));
            float groove = max(g1 * 0.9, g2);
            diffuseColor.rgb *= 1.0 - groove * 0.55;
            roughMul = mix(1.05, 1.2, groove);
          } else {
            float rings = 0.5 + 0.5 * sin(r * 180.0);
            diffuseColor.rgb *= 0.92 + 0.1 * rings;
            roughMul = 0.85;
          }
        } else {
          // body: a little darker towards the floor (the ground and the car shade it), with a film of road grime low
          // down; the paint gets a fine metallic flake under the clear coat
          float low = 1.0 - smoothstep(0.02, 0.5, vObj.y);
          diffuseColor.rgb *= 1.0 - low * 0.3;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.86, 0.8, 0.72), low * 0.35);
          if (vPbr.w > 0.005 && vPbr.w < 0.02) {
            vec3 q = floor(vObj * 160.0);
            float flake = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            diffuseColor.rgb *= 0.97 + 0.07 * flake;
            roughMul = 0.85 + 0.3 * flake;
          }
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(vPbr.x * (vPbr.w < -0.5 ? 0.8 + 0.4 * weave : 1.0) * roughMul, 0.04, 1.0);`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPbr.y;')
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.clearcoat = vPbr.z;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (vPbr.w > 0.5 ? vPbr.w : 0.0);',
      );
  };
  m.customProgramCacheKey = () => 'tk-car';
  return m;
}
