/**
 * D72 the phone garage's 3D preview: the player's own kart, built by the same code as on the big screen, turning
 * slowly on a small stage. Loaded only when the garage opens, so driving never pays for three.js.
 */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CHARS, type KartSetup } from '@tk/shared';
import { KartView, ProceduralKartProvider } from '../../host/src/art/kart';
import { createMaterials } from '../../host/src/art/materials';

export class GarageView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private readonly assets = new ProceduralKartProvider();
  private readonly M = createMaterials();
  private view: KartView | null = null;
  private key = '';
  private raf = 0;
  private yaw = 2.6;
  private dragX: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.9;
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.35;
    this.M.car.envMap = env;
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x303040, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.4);
    sun.position.set(4, 8, 5);
    this.scene.add(sun);
    // a soft round floor shadow under the car
    const g = document.createElement('canvas');
    g.width = g.height = 64;
    const c = g.getContext('2d')!;
    const gr = c.createRadialGradient(32, 32, 4, 32, 32, 32);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = gr;
    c.fillRect(0, 0, 64, 64);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(g), transparent: true, depthWrite: false }),
    );
    this.scene.add(floor);
    this.camera.position.set(0, 3.2, 10.5);
    this.camera.lookAt(0, 0.75, 0);
    // drag to turn it
    canvas.addEventListener('pointerdown', (e) => (this.dragX = e.clientX));
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.yaw += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave'])
      canvas.addEventListener(ev, () => (this.dragX = null));
  }

  /** Show this character and setup (rebuilt only when either changes). */
  set(characterId: string | null, slot: number, setup: KartSetup): void {
    const key = JSON.stringify([characterId, slot, setup]);
    if (key === this.key) return;
    this.key = key;
    const ch = CHARS.find((c) => c.id === characterId) ?? CHARS[0]!;
    if (this.view) {
      this.scene.remove(this.view.root);
      this.view.dispose();
    }
    this.view = new KartView(0, ch, slot, '', this.assets, this.M, setup);
    this.view.tag.visible = false;
    // the studio reflection is much brighter than the race sky: keep tyres black and paint rich
    this.view.root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshPhysicalMaterial | undefined;
      if (m && 'envMapIntensity' in m && m.envMap) m.envMapIntensity = 0.45;
    });
    this.scene.add(this.view.root);
  }

  start(): void {
    if (this.raf) return;
    let last = performance.now();
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (this.dragX === null) this.yaw += dt * 0.5;
      const w = this.canvas.clientWidth,
        h = this.canvas.clientHeight;
      if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.view) this.view.root.rotation.set(0, this.yaw, 0);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}
