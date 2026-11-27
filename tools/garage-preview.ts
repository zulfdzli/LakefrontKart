/**
 * D72 the phone garage's 3D preview, rendered straight from its module (no room needed): one shot per livery at
 * phone size, for checking the look.
 *
 *   npx tsx tools/garage-preview.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { LIVERIES, type KartSetup } from '@tk/shared';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3130;
const OUT = path.join(ROOT, 'docs', 'screens', 'd72');

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

const PAINT = [7, 9, 11, 8, 6, 10];
const ACCENT = [11, 2, 10, 3, 11, 0];

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu'] });
  try {
    const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3 });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/play`);
    await page.waitForTimeout(1500);
    await page.evaluate(`(async () => {
      const c = document.createElement('canvas');
      c.id = 'gv';
      c.style.cssText = 'position:fixed;left:16px;top:16px;width:361px;height:190px;z-index:99;border-radius:22px;background:radial-gradient(120% 90% at 50% 20%, #3a4252, #161a21 75%)';
      document.body.appendChild(c);
      const m = await import('/controller/src/garage-view.ts');
      window.gv = new m.GarageView(c);
      window.gv.start();
    })()`);
    for (const [i, livery] of LIVERIES.entries()) {
      const setup: KartSetup = {
        paint: PAINT[i]!,
        accent: ACCENT[i]!,
        livery,
        num: 7 + i,
        sticker: 'crown',
        rims: 2,
        tune: { speed: 0, accel: 0, handling: 0 },
      };
      await page.evaluate(
        (s) => (window as unknown as { gv: { set(c: string, slot: number, s: unknown): void } }).gv.set('bruno', 0, s),
        setup,
      );
      await page.waitForTimeout(700);
      await page.locator('#gv').screenshot({ path: path.join(OUT, `preview-${livery}.png`) });
      console.log('  preview-' + livery);
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 4));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
