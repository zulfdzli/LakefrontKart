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
      .replace('#include <common>', '#include <common>\nattribute vec4 aPbr;\nvarying vec4 vPbr;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPbr = aPbr;\nvObj = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPbr;\nvarying vec3 vObj;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float weave = 0.0;
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
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * max(vPbr.w, 0.0);',
      );
  };
  m.customProgramCacheKey = () => 'tk-car';
  return m;
}
