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
 */
function carMaterial(): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    roughness: 0.3,
    metalness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    envMapIntensity: 1.9,
  });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec4 aPbr;\nvarying vec4 vPbr;\nvarying vec3 vObj;\nvarying vec3 vObjN;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr;\nvObj = position;\nvObjN = normal;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPbr;\nvarying vec3 vObj;\nvarying vec3 vObjN;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float weave = 0.0;
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
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = vPbr.x * (vPbr.w < -0.5 ? 0.8 + 0.4 * weave : 1.0);`,
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
