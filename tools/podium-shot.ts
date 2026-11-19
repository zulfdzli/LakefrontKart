/**
 * Podium ceremony shots (D51): for each track, finish a seeded autopilot race and capture the podium a few
 * seconds into the celebration (two moments), plus frame stats during the ceremony.
 *
 *   npx tsx tools/podium-shot.ts --out docs/screens/phase14/podium
 *   npx tsx tools/podium-shot.ts --out docs/screens/phase14/podium --tracks frosty
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
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
const OUT = path.join(ROOT, arg('out', 'docs/screens/latest/podium'));
const PORT = 3105;
const TRACKS = arg('tracks', 'meadows,canyon,frosty,sepang').split(',');
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
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu'],
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    await page.addInitScript('window.__name = (f) => f;');
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?noadapt=1`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    for (const track of TRACKS) {
      await page.evaluate((t) => window.__tk.race({ seed: 7, ci: 1, laps: 2, autopilot: true, track: t }), track);
      await page.waitForFunction(() => window.__tk.state().raceTime > 0.5, null, { timeout: 30000 });
      await page.evaluate(() => {
        const s = window.__tk.session()!;
        for (let i = 0; i < 60 * 300 && s.s.phase !== 'finished'; i++) window.__tk.advance(1 / 60);
      });
      await page.waitForFunction(() => window.__tk.state().stage === 'podium', null, { timeout: 20000 });
      await page.waitForTimeout(2600);
      await page.screenshot({ path: path.join(OUT, `${track}-podium.png`) });
      const f = await fps(page, 3);
      await page.screenshot({ path: path.join(OUT, `${track}-podium-b.png`) });
      console.log(track, f);
    }
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
