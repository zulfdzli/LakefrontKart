/**
 * FPS counter (F), debug overlay (D or ?debug=1): frame-time graph, frame ms, draw calls, triangles,
 * pixel ratio. Also runs adaptive resolution (section 6.3): if the average frame time stays above 18 ms
 * for 2 s, lower the pixel ratio in steps down to 0.75; raise it again when there is headroom.
 */
import type { World } from './renderer';

export class DebugOverlay {
  private showFps = false;
  private full = new URLSearchParams(location.search).has('debug');
  private acc = 0;
  private n = 0;
  private fps = 0;
  private readonly hist = new Float32Array(120);
  private hi = 0;
  private perfAcc = 0;
  private perfN = 0;
  private calmFor = 0;
  private readonly graph: HTMLCanvasElement;
  private readonly text: HTMLDivElement;
  frameMs = 0;

  constructor(
    private readonly world: World,
    private readonly el: HTMLElement,
  ) {
    this.text = document.createElement('div');
    this.graph = document.createElement('canvas');
    this.graph.width = 240;
    this.graph.height = 48;
    el.append(this.text, this.graph);
    this.apply();
  }

  toggleFps(): void {
    this.showFps = !this.showFps;
    this.apply();
  }
  toggleFull(): void {
    this.full = !this.full;
    this.apply();
  }

  private apply(): void {
    this.el.style.display = this.showFps || this.full ? 'block' : 'none';
    this.graph.style.display = this.full ? 'block' : 'none';
  }

  frame(dt: number, cpuMs: number): void {
    this.frameMs = dt * 1000;
    this.hist[this.hi] = dt * 1000;
    this.hi = (this.hi + 1) % this.hist.length;
    this.acc += dt;
    this.n++;
    if (this.acc >= 0.5) {
      this.fps = this.n / this.acc;
      this.acc = 0;
      this.n = 0;
      this.draw(cpuMs);
    }
    this.adapt(dt);
  }

  private readonly adaptive = !new URLSearchParams(location.search).has('noadapt');

  private adapt(dt: number): void {
    if (!this.adaptive) return;
    this.perfAcc += dt;
    this.perfN++;
    if (this.perfAcc < 2) return;
    const avg = (this.perfAcc / this.perfN) * 1000;
    this.perfAcc = 0;
    this.perfN = 0;
    const w = this.world;
    if (avg > 18 && w.pixelRatio > 0.75) {
      w.setPixelRatio(w.pixelRatio - 0.25);
      this.calmFor = 0;
    } else if (avg < 13) {
      this.calmFor += 2;
      if (this.calmFor >= 6 && w.pixelRatio < w.maxPR) {
        w.setPixelRatio(w.pixelRatio + 0.25);
        this.calmFor = 0;
      }
    } else this.calmFor = 0;
  }

  private draw(cpuMs: number): void {
    if (this.el.style.display === 'none') return;
    const info = this.world.renderer.info.render;
    this.text.textContent = this.full
      ? `${this.fps.toFixed(0)} fps · ${cpuMs.toFixed(1)} ms cpu · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · pr ${this.world.pixelRatio.toFixed(2)}`
      : `${this.fps.toFixed(0)} fps`;
    if (!this.full) return;
    const g = this.graph.getContext('2d')!,
      W = this.graph.width,
      H = this.graph.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(29,27,46,.6)';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,255,255,.35)';
    g.beginPath();
    g.moveTo(0, H - (16.7 / 40) * H);
    g.lineTo(W, H - (16.7 / 40) * H);
    g.stroke();
    g.fillStyle = '#69f0ae';
    for (let i = 0; i < this.hist.length; i++) {
      const v = this.hist[(this.hi + i) % this.hist.length]!,
        h = Math.min(H, (v / 40) * H);
      g.fillStyle = v > 20 ? '#ff5252' : '#69f0ae';
      g.fillRect(i * 2, H - h, 2, h);
    }
  }
}
