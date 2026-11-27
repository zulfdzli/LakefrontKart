/**
 * D71 weather screenshots and frame stats: every weather on the chosen tracks, a chase-camera shot mid-race and
 * the frame rate there (real GPU, like tools/capture.ts).
 *
 *   npx tsx tools/weather-shot.ts                                 (all tracks and arenas, every weather)
 *   npx tsx tools/weather-shot.ts --tracks meadows,frosty --weathers night,rain --t 24
 *   npx tsx tools/weather-shot.ts --tracks frosty --weathers snow --humans 4      (split screen)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium, type Page } from 'playwright-core';
import { WEATHERS, weatherAllowed } from '@tk/shared';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const PORT = Number(arg('port', '3110'));
const OUT = path.join(ROOT, 'docs', 'screens', arg('phase', 'd71'));
const TRACKS = arg('tracks', 'meadows,canyon,frosty,sepang,arena-ice').split(',');
const WX = arg('weathers', WEATHERS.join(',')).split(',');
const T = Number(arg('t', '22'));
const HUMANS = Number(arg('humans', '1'));
const W = Number(arg('w', '1280')),
  H = Number(arg('h', '720'));

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
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}

async function fps(page: Page, sec: number): Promise<{ fps: number; p95: number }> {
  return page.evaluate(
    (s) =>
      new Promise<{ fps: number; p95: number }>((res) => {
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
              p95: +ft[Math.floor(ft.length * 0.95)]!.toFixed(1),
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
    headless: !args.includes('--headed'),
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const errors: string[] = [];
  const report: Record<string, unknown>[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.addInitScript('window.__name = (f) => f;');
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?noadapt=1`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    for (const track of TRACKS)
      for (const weather of WX) {
        if (!weatherAllowed(track, weather as never)) continue;
        await page.evaluate(
          ([track, weather, t, humans]) => {
            window.__tk.race({
              seed: 7,
              ci: 1,
              laps: 2,
              autopilot: true,
              humans,
              track,
              weather,
              mode: track.startsWith('arena-') ? 'brawl' : 'race',
            });
            window.__tk.advance(t);
          },
          [track, weather, T, HUMANS] as const,
        );
        await page.waitForTimeout(1200);
        const f = await fps(page, 3);
        const name = `${track}-${weather}${HUMANS > 1 ? `-${HUMANS}p` : ''}`;
        await page.screenshot({ path: path.join(OUT, name + '.png') });
        console.log(`  ${name}: ${f.fps} fps, p95 ${f.p95} ms`);
        report.push({ track, weather, ...f });
      }
    writeFileSync(path.join(OUT, 'weather.json'), JSON.stringify({ report, errors }, null, 2));
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
