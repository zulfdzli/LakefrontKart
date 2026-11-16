/** Gradient sky dome with a sun disc and glow (prototype), with correct colour-space output. */
import * as THREE from 'three';

export function createSky(zenith: number, horizon: number, sunDir: THREE.Vector3, glow: readonly [number, number, number]): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(zenith) },
      bot: { value: new THREE.Color(horizon) },
      sunDir: { value: sunDir },
      glow: { value: new THREE.Color().setRGB(glow[0], glow[1], glow[2], THREE.SRGBColorSpace) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 glow;
      varying vec3 vP;
      void main() {
        vec3 d = normalize(vP);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(smoothstep(0.0, 0.6, h), 0.8));
        float s = max(dot(d, sunDir), 0.0);
        c += glow * (smoothstep(0.9968, 0.9982, s) * 0.85 + pow(s, 22.0) * 0.22);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(2600, 24, 12), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  return sky;
}
