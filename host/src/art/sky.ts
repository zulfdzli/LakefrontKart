/** Gradient sky dome with a sun disc and glow (prototype), with correct colour-space output; D71 adds stars. */
import * as THREE from 'three';

export function createSky(
  zenith: number,
  horizon: number,
  sunDir: THREE.Vector3,
  glow: readonly [number, number, number],
  stars = 0,
): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(zenith) },
      bot: { value: new THREE.Color(horizon) },
      sunDir: { value: sunDir },
      glow: { value: new THREE.Color().setRGB(glow[0], glow[1], glow[2], THREE.SRGBColorSpace) },
      stars: { value: stars },
    },
    vertexShader: /* glsl */ `
      varying vec3 vP;
      void main() {
        vP = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 glow; uniform float stars;
      varying vec3 vP;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vP);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 c = mix(bot, top, pow(smoothstep(0.0, 0.6, h), 0.8));
        float s = max(dot(d, sunDir), 0.0);
        c += glow * (smoothstep(0.9968, 0.9982, s) * 0.85 + pow(s, 22.0) * 0.22);
        if (stars > 0.0) {
          // a fixed star field: one candidate per cell, a few of them lit, twinkle-free, fading into the horizon haze
          vec3 q = d * 260.0, cell = floor(q);
          float r = hash(cell);
          vec3 off = vec3(hash(cell + 1.7), hash(cell + 4.3), hash(cell + 9.1)) - 0.5;
          float dd = length(q - cell - 0.5 - off * 0.6);
          float st = step(0.965, r) * smoothstep(0.32, 0.0, dd) * (0.4 + 0.6 * hash(cell + 2.9));
          c += vec3(0.85, 0.9, 1.0) * st * stars * smoothstep(0.04, 0.3, h) * 1.6;
        }
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
