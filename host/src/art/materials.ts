/**
 * Shared materials. D45 (art pass): soft physically based materials replace the prototype's toon ramp.
 * Karts get a clear-coated paint (car paint with a glossy lacquer), props and scenery are matte PBR, and all of
 * them pick up the sky's image-based light (scene.environment).
 */
import * as THREE from 'three';
import { INK } from './palette';

export interface Materials {
  kart: THREE.MeshPhysicalMaterial;
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
