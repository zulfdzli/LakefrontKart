/**
 * Development page: renders the race car in the four views of reference/kart/kart.jpg (front, back, side, top)
 * with orthographic cameras, so tools/car-sheet.ts can put it next to the reference (D44).
 *   /tools/carview/?slot=0&ci=1
 */
import * as THREE from 'three';
import { CHARS } from '@tk/shared';
import { createMaterials } from '../../host/src/art/materials';
import { KartView, ProceduralKartProvider } from '../../host/src/art/kart';

const W = 1280,
  H = 860;
const params = new URLSearchParams(location.search);
const slot = params.has('ai') ? null : Number(params.get('slot') ?? '0');
const ci = Number(params.get('ci') ?? '1');

const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById('c') as HTMLCanvasElement,
  antialias: true,
});
renderer.setSize(W, H);
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.autoClear = false;
const scene = new THREE.Scene();
scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x5a5f68, 0.9 * Math.PI));
const sun = new THREE.DirectionalLight(0xffffff, 0.8 * Math.PI);
sun.position.set(3, 6, 4);
scene.add(sun);

const M = createMaterials();
const kv = new KartView(0, CHARS[ci]!, slot, 'P1', new ProceduralKartProvider(), M);
kv.tag.visible = false;
// no ground shadow disc on the drawing sheet
kv.root.traverse((o) => {
  const m = (o as THREE.Mesh).material as THREE.Material | undefined;
  if (m && (m as THREE.MeshBasicMaterial).transparent && (m as THREE.MeshBasicMaterial).opacity < 0.3)
    o.visible = false;
});
scene.add(kv.root);
(window as unknown as { __car: boolean }).__car = true;

// grid background like the reference sheet
function grid(): void {
  const g = document.createElement('canvas');
  g.width = W;
  g.height = H;
  const c = g.getContext('2d')!;
  c.fillStyle = '#2b2f35';
  c.fillRect(0, 0, W, H);
  c.strokeStyle = 'rgba(255,255,255,0.06)';
  for (let x = 0; x < W; x += 40) {
    c.beginPath();
    c.moveTo(x, 0);
    c.lineTo(x, H);
    c.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(W, y);
    c.stroke();
  }
  scene.background = new THREE.CanvasTexture(g);
  (scene.background as THREE.Texture).colorSpace = THREE.SRGBColorSpace;
}
grid();

type View = {
  x: number;
  y: number;
  w: number;
  h: number;
  pos: [number, number, number];
  up: [number, number, number];
  half: number;
};
const views: View[] = [
  { x: 0, y: H / 2, w: W / 2, h: H / 2, pos: [0, 0.8, 20], up: [0, 1, 0], half: 1.9 }, // front
  { x: W / 2, y: H / 2, w: W / 2, h: H / 2, pos: [0, 0.8, -20], up: [0, 1, 0], half: 1.9 }, // back
  { x: 0, y: 0, w: W / 2, h: H / 2, pos: [-20, 0.8, 0], up: [0, 1, 0], half: 3.3 }, // side (nose to the right)
  { x: W / 2, y: 0, w: W / 2, h: H / 2, pos: [0, 20, 0], up: [1, 0, 0], half: 3.3 }, // top (nose to the right)
];
renderer.setScissorTest(true);
renderer.clear();
for (const v of views) {
  const a = v.w / v.h;
  const cam = new THREE.OrthographicCamera(-v.half * a, v.half * a, v.half, -v.half, 0.1, 100);
  cam.up.set(...v.up);
  cam.position.set(...v.pos);
  cam.lookAt(0, v.pos[1] === 20 ? 0 : 0.8, 0);
  renderer.setViewport(v.x, v.y, v.w, v.h);
  renderer.setScissor(v.x, v.y, v.w, v.h);
  renderer.render(scene, cam);
}
(window as unknown as { __done: boolean }).__done = true;
