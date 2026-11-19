/**
 * Performance and leak check (section 12.8, phase 13): runs the real host in Chrome on the GPU and reports
 *  - frame time (median, p95), draw calls, triangles and simulation ms for 1 and 5 views, vsync off;
 *  - the draw-call cost of the shadow passes;
 *  - a leak check: 8 races over all four tracks; GPU geometries / textures / shader programs and the JS heap
 *    (after a forced GC) are recorded after each and must not keep growing.
 * Writes docs/screens/<phase>/perf.json.
 *
 *   npm run perf -- --phase phase13
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium, type Page } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const PHASE = arg('phase', 'latest');
const PORT = 3103;
const OUT = path.join(ROOT, 'docs', 'screens', PHASE);

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

async function frames(page: Page, sec: number): Promise<{ fps: number; p50: number; p95: number }> {
  return page.evaluate(
    (s) =>
      new Promise<{ fps: number; p50: number; p95: number }>((res) => {
        const ft: number[] = [];
        let last = performance.now();
        const t0 = last;
        const f = (now: number): void => {
          ft.push(now - last);
          last = now;
          if (now - t0 < s * 1000) requestAnimationFrame(f);
          else {
            ft.sort((a, b) => a - b);
            res({
              fps: Math.round(1000 / (ft.reduce((a, b) => a + b, 0) / ft.length)),
              p50: +ft[ft.length >> 1]!.toFixed(2),
              p95: +ft[Math.floor(ft.length * 0.95)]!.toFixed(2),
            });
          }
        };
        requestAnimationFrame(f);
      }),
    sec,
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--use-angle=d3d11',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
      '--js-flags=--expose-gc',
    ],
  });
  const report: Record<string, unknown> = {};
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.addInitScript('window.__name = (f) => f;');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?noadapt=1&track=frosty`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    await page.waitForTimeout(1500);

    // frame budget per view count
    const views: Record<string, unknown> = {};
    for (const n of [1, 3, 5]) {
      await page.evaluate((h) => window.__tk.race({ seed: 7, humans: h, laps: 2, autopilot: true }), n);
      await page.waitForFunction(() => window.__tk.state().raceTime > 0.5, null, { timeout: 20000 });
      await page.evaluate(() => window.__tk.advance(15));
      await page.waitForTimeout(800);
      const f = await frames(page, 4);
      const info = await page.evaluate(() => window.__tk.info());
      await page.evaluate(() => window.__tk.world().setShadows(false));
      await page.waitForTimeout(300);
      const noShadow = await page.evaluate(() => window.__tk.info().calls);
      await page.evaluate(() => window.__tk.world().setShadows(true));
      views[n] = {
        ...f,
        calls: info.calls,
        shadowCalls: info.calls - noShadow,
        triangles: info.triangles,
        simMs: +info.simMs.toFixed(3),
        tier: info.tier,
      };
      console.log(`views ${n}:`, views[n]);
    }
    report.views = views;
    // the debug overlay (D): stats, per-player rows, velocity vectors and checkpoint gates
    await page.evaluate(() => window.__tk.race({ seed: 7, humans: 1, laps: 2, autopilot: true }));
    await page.waitForFunction(() => window.__tk.state().raceTime > 0.5, null, { timeout: 20000 });
    await page.evaluate(() => window.__tk.advance(8));
    await page.keyboard.press('d');
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(OUT, 'debug-overlay.png') });
    await page.keyboard.press('d');

    // leak check: 8 races across the four tracks
    const leak: Record<string, number>[] = [];
    const tracks = ['meadows', 'canyon', 'frosty', 'sepang'];
    for (let r = 0; r < 8; r++) {
      await page.evaluate(
        ([t, h]) =>
          window.__tk.race({
            seed: 11 + (h as number),
            humans: h as number,
            laps: 1,
            autopilot: true,
            track: t as string,
          }),
        [tracks[r % 4]!, (r % 3) + 1] as const,
      );
      await page.waitForFunction(() => window.__tk.state().raceTime > 0.3, null, { timeout: 30000 });
      await page.evaluate(() => window.__tk.advance(20));
      await page.waitForTimeout(600);
      const m = await page.evaluate(() => {
        (window as unknown as { gc?: () => void }).gc?.();
        const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
        const i = window.__tk.info();
        return { ...i.memory, heapMB: mem ? +(mem.usedJSHeapSize / 1048576).toFixed(1) : -1 };
      });
      leak.push({ race: r + 1, ...m });
      console.log(`race ${r + 1} (${tracks[r % 4]}):`, m);
    }
    report.leak = leak;
    // the second lap round of tracks must not need more than the first (same tracks, everything rebuilt)
    const a = leak[3]!,
      b = leak[7]!;
    report.leakVerdict = {
      geometries: b.geometries! - a.geometries!,
      textures: b.textures! - a.textures!,
      programs: b.programs! - a.programs!,
      heapMB: +(b.heapMB! - a.heapMB!).toFixed(1),
    };
    console.log('growth between race 4 and race 8 (same track):', report.leakVerdict);
    report.errors = errors;
    console.log('errors:', errors.length ? errors.join('\n') : 'none');
  } finally {
    writeFileSync(path.join(OUT, 'perf.json'), JSON.stringify(report, null, 2));
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
