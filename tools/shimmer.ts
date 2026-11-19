/**
 * Shimmer meter (phase 14, "Aliasing and shimmer"): how much the picture flickers when the camera moves by less
 * than a pixel.
 *
 * For each track it fast-forwards a seeded race, pauses, and renders the frozen scene five times while turning the
 * camera by a quarter of a pixel each time. A well anti-aliased picture slides smoothly, so the second difference
 * of each pixel across three neighbouring frames (f0 - 2 f1 + f2) stays near zero. Thin stripes, wires and leaves
 * that pop in and out of pixels give large values. The score is the mean of |f0 - 2 f1 + f2| (0..255 luma), and
 * the share of pixels above 24 ("flicker pixels"). A heat map shows where the flicker comes from.
 *
 *   npx tsx tools/shimmer.ts --out docs/screens/phase14/shimmer --q "msaa=0"
 *   npx tsx tools/shimmer.ts --out docs/screens/phase14/shimmer --views 5
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const OUT = path.join(ROOT, arg('out', 'docs/screens/latest/shimmer'));
const PORT = Number(arg('port', '3106'));
const TRACKS = arg('tracks', 'meadows,canyon,frosty,sepang').split(',');
const TIMES = arg('times', '22,48').split(',').map(Number);
const VIEWS = Number(arg('views', '1'));
const Q = arg('q', '');
const TAG = arg('tag', 'now');
const W = Number(arg('w', '1920')),
  H = Number(arg('h', '1080'));

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/src/index.ts'],
      { cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('Host screen:')) {
        clearTimeout(timer);
        resolve(child);
      }
    });
    child.stderr!.on('data', (d: Buffer) => process.stderr.write(d));
  });
}

/** The parts of the host's RaceSession this tool uses. */
interface Ses {
  s: { raceTime: number; phase: string };
  paused: boolean;
  views(): unknown[];
  focusOf(v: unknown): unknown;
}

interface Shot {
  mean: number;
  flicker: number;
  heat: string;
  frame: string;
  samples: number;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const errors: string[] = [];
  const rows: { track: string; t: number; mean: number; flicker: number }[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.addInitScript('window.__name = (f) => f;');
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?noadapt=1${Q ? `&${Q}` : ''}`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    for (const track of TRACKS) {
      await page.evaluate(
        ([t, n]) => window.__tk.race({ seed: 7, ci: 1, laps: 2, autopilot: true, track: t, humans: n }),
        [track, VIEWS] as const,
      );
      await page.waitForFunction(() => window.__tk.state().raceTime > 0.5, null, { timeout: 30000 });
      for (const t of TIMES) {
        await page.evaluate((tt) => {
          const s = window.__tk.session() as unknown as Ses;
          s.paused = false;
          while (s.s.raceTime < tt && s.s.phase !== 'finished') window.__tk.advance(1 / 60);
        }, t);
        await page.waitForTimeout(800); // let the chase camera settle
        const shot: Shot = await page.evaluate(() => {
          const w = window.__tk.world() as unknown as {
            renderer: { domElement: HTMLCanvasElement };
            post: { finish: { uniforms: { uGrain: { value: number } } }; target: { samples: number } } | null;
            render(l: unknown, f: unknown): void;
          };
          const s = window.__tk.session() as unknown as Ses;
          s.paused = true;
          const views = s.views() as { camera: import('three').PerspectiveCamera }[];
          const cams = views.map((v) => v.camera);
          const q0 = cams.map((c) => c.quaternion.clone());
          const canvas = w.renderer.domElement;
          const cw = canvas.width,
            ch = canvas.height;
          const c2 = document.createElement('canvas');
          c2.width = cw;
          c2.height = ch;
          const g = c2.getContext('2d', { willReadFrequently: true })!;
          const grain = w.post?.finish.uniforms.uGrain.value ?? 0;
          if (w.post) w.post.finish.uniforms.uGrain.value = 0;
          const lum: Float32Array[] = [];
          let firstFrame = '';
          // frame 5 repeats frame 0: pixels that change without the camera moving (flames, smoke, sparkles) are
          // animation, not shimmer, and are left out
          for (let k = 0; k < 6; k++) {
            const kk = k % 5;
            cams.forEach((c, i) => {
              // a quarter pixel of yaw at the centre of this view
              const perPx =
                (2 * Math.tan((c.fov * Math.PI) / 180 / 2)) / (ch / Math.max(1, Math.round(Math.sqrt(cams.length))));
              c.quaternion.copy(q0[i]!);
              c.rotateY(kk * 0.25 * perPx);
              c.updateMatrixWorld(true);
            });
            w.render(views, (v: unknown) => s.focusOf(v));
            g.drawImage(canvas, 0, 0);
            if (k === 0) firstFrame = c2.toDataURL('image/jpeg', 0.85);
            const d = g.getImageData(0, 0, cw, ch).data;
            const L = new Float32Array(cw * ch);
            for (let p = 0, j = 0; p < L.length; p++, j += 4)
              L[p] = 0.2126 * d[j]! + 0.7152 * d[j + 1]! + 0.0722 * d[j + 2]!;
            lum.push(L);
          }
          cams.forEach((c, i) => {
            c.quaternion.copy(q0[i]!);
            c.updateMatrixWorld(true);
          });
          if (w.post) w.post.finish.uniforms.uGrain.value = grain;
          // second differences over the three triples; ignore a 4 px border (the view slides in at the edge)
          const heat = new Float32Array(cw * ch);
          let sum = 0,
            n = 0,
            flick = 0,
            px = 0;
          for (let y = 4; y < ch - 4; y++)
            for (let x = 4; x < cw - 4; x++) {
              const p = y * cw + x;
              if (Math.abs(lum[0]![p]! - lum[5]![p]!) > 3) continue;
              px++;
              let m = 0;
              for (let k = 1; k < 4; k++) {
                const v = Math.abs(lum[k - 1]![p]! - 2 * lum[k]![p]! + lum[k + 1]![p]!);
                sum += v;
                n++;
                if (v > m) m = v;
              }
              heat[p] = m;
              if (m > 24) flick++;
            }
          // heat map: the frame in grey, flicker in red/yellow
          const img = g.createImageData(cw, ch);
          const L0 = lum[0]!;
          for (let p = 0, j = 0; p < heat.length; p++, j += 4) {
            const h = Math.min(1, heat[p]! / 48),
              base = L0[p]! * 0.35;
            img.data[j] = base + (255 - base) * Math.min(1, h * 2);
            img.data[j + 1] = base + (255 - base) * Math.max(0, h * 2 - 1);
            img.data[j + 2] = base * (1 - h);
            img.data[j + 3] = 255;
          }
          g.putImageData(img, 0, 0);
          return {
            mean: +(sum / n).toFixed(3),
            flicker: +((100 * flick) / Math.max(1, px)).toFixed(2),
            heat: c2.toDataURL('image/jpeg', 0.85),
            frame: firstFrame,
            samples: w.post?.target.samples ?? -1,
          };
        });
        const base = `${track}-${t}s-${VIEWS}v-${TAG}`;
        writeFileSync(path.join(OUT, `${base}-heat.jpg`), Buffer.from(shot.heat.split(',')[1]!, 'base64'));
        writeFileSync(path.join(OUT, `${base}.jpg`), Buffer.from(shot.frame.split(',')[1]!, 'base64'));
        rows.push({ track, t, mean: shot.mean, flicker: shot.flicker });
        console.log(`${track} ${t}s  mean ${shot.mean}  flicker ${shot.flicker}%  (samples ${shot.samples})`);
      }
    }
    const avg = (k: 'mean' | 'flicker'): number => +(rows.reduce((a, r) => a + r[k], 0) / rows.length).toFixed(3);
    console.log(`AVERAGE  mean ${avg('mean')}  flicker ${avg('flicker')}%`);
    writeFileSync(
      path.join(OUT, `results-${VIEWS}v-${TAG}.json`),
      JSON.stringify({ q: Q, rows, mean: avg('mean'), flicker: avg('flicker') }, null, 2),
    );
    console.log('errors:', errors.length ? errors.join('\n') : 'none');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
