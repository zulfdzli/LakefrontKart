/**
 * D45 holographic materials: the item boxes' translucent, glowing, iridescent shell, and the shield bubble.
 * The rim (fresnel) glows above 1.0 in HDR, so the bloom pass gives it a soft halo.
 */
import * as THREE from 'three';

export const holoTime = { value: 0 };

/** A glassy shell: mostly see-through, iridescent rim that shifts with view angle, position and time. */
export function holoShell(
  base = 0xffffff,
  rim = 2.2,
  opacity = 0.32,
  roughness = 0.08,
  glow = 0.25,
): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: base,
    roughness,
    metalness: 0.1,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = holoTime;
    sh.uniforms.uRim = { value: rim };
    sh.uniforms.uGlow = { value: glow };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vHoloW;').replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
        #ifdef USE_INSTANCING
          vHoloW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vHoloW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
    );
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime; uniform float uRim; uniform float uGlow; varying vec3 vHoloW;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        vec3 Vd = normalize(cameraPosition - vHoloW);
        float fr = pow(1.0 - abs(dot(normalize(vNormal), normalize((viewMatrix * vec4(Vd, 0.0)).xyz))), 2.2);
        float hue = fract(fr * 0.8 + uTime * 0.25 + dot(vHoloW, vec3(0.05, 0.08, 0.05)));
        vec3 rainbow = 0.5 + 0.5 * cos(6.2831 * (hue + vec3(0.0, 0.33, 0.67)));
        float scan = 0.85 + 0.15 * sin(vHoloW.y * 18.0 - uTime * 6.0);
        totalEmissiveRadiance += rainbow * (uGlow + fr * uRim) * scan;
        diffuseColor.a = clamp(diffuseColor.a + fr * 0.35, 0.0, 1.0);`,
      );
  };
  m.customProgramCacheKey = () => 'tk-holo-' + rim + '-' + opacity + '-' + glow;
  return m;
}
