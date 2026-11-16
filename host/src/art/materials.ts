/**
 * Shared materials. Phase 4 keeps the prototype's toon look; D5 moves to soft stylized PBR in the art pass.
 */
import * as THREE from 'three';
import { INK } from './palette';

/** 3-step toon ramp. Current three.js samples gradientMap.r, so a single channel is correct here. */
function toonRamp(): THREE.DataTexture {
  const t = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export interface Materials {
  kart: THREE.MeshToonMaterial;
  prop: THREE.MeshToonMaterial;
  inst: THREE.MeshToonMaterial;
  instL: THREE.MeshLambertMaterial;
  land: THREE.MeshLambertMaterial;
  line: THREE.MeshBasicMaterial;
  dispose(): void;
}

export function createMaterials(): Materials {
  const grad = toonRamp();
  const toon = (): THREE.MeshToonMaterial => new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad });
  const m = {
    kart: toon(),
    prop: toon(),
    inst: toon(),
    instL: new THREE.MeshLambertMaterial({ vertexColors: true }),
    land: new THREE.MeshLambertMaterial({ vertexColors: true }),
    line: new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }),
  };
  return {
    ...m,
    dispose() {
      grad.dispose();
      for (const mat of Object.values(m)) mat.dispose();
    },
  };
}
