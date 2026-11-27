/**
 * D72 garage screenshots: four autopilot players with different garage setups (paint, livery, sticker, rims) on the
 * grid and a little way into the race, in 4-way split screen, so every livery can be checked on the real car.
 *
 *   npx tsx tools/garage-shot.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium } from 'playwright-core';
import type { KartSetup } from '@tk/shared';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3120;
const OUT = path.join(ROOT, 'docs', 'screens', 'd72');
const tune = { speed: 0, accel: 0, handling: 0 };
const SETS: KartSetup[][] = [
  [
    { paint: 7, accent: 11, livery: 'flames', num: 7, sticker: 'crown', rims: 2, tune },
    { paint: 9, accent: 2, livery: 'stripes', num: 21, sticker: 'star', rims: 4, tune },
    { paint: 11, accent: 10, livery: 'checker', num: 99, sticker: 'skull', rims: 3, tune },
    { paint: 8, accent: 3, livery: 'camo', num: 4, sticker: 'paw', rims: 1, tune },
  ],
  [
    { paint: 6, accent: 11, livery: 'pinstripe', num: 12, sticker: 'heart', rims: 4, tune },
    { paint: 10, accent: 0, livery: 'flames', num: 66, sticker: 'bolt', rims: 3, tune },
    { paint: 0, accent: 11, livery: 'neon', num: 1, sticker: 'none', rims: 0, tune },
    { paint: 4, accent: 7, livery: 'checker', num: 30, sticker: 'star', rims: 2, tune },
  ],
];

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
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await page.addInitScript('window.__name = (f) => f;');
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/?noadapt=1`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    for (const [n, setups] of SETS.entries()) {
      for (const [t, at] of [
        ['grid', 0],
        ['race', 9],
      ] as const) {
        await page.evaluate(
          ([setups, at]) => {
            window.__tk.race({ seed: 3, ci: 0, humans: 4, laps: 2, autopilot: true, track: 'meadows', setups });
            window.__tk.advance(at);
          },
          [setups, at] as const,
        );
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, `garage-${n + 1}-${t}.png`) });
        console.log(`  garage-${n + 1}-${t}`);
      }
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
