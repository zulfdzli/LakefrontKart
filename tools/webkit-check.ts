/**
 * Real-phone gap (D79): opens the phone controller in WebKit (Safari's engine) as an iPhone, in both the dev server
 * and the production build, and reports page errors, failed requests and whether the controller started.
 *
 *   npx tsx tools/webkit-check.ts            (needs: npx playwright-core install webkit)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { devices, webkit } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'docs', 'screens', 'd79');

function startServer(port: number, prod: boolean): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/src/index.ts', ...(prod ? ['--prod'] : [])],
      { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const timer = setTimeout(() => reject(new Error('server did not start')), 40000);
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
  const browser = await webkit.launch();
  for (const [mode, port] of [
    ['dev', 3190],
    ['prod', 3191],
  ] as const) {
    const server = await startServer(port, mode === 'prod');
    try {
      const ctx = await browser.newContext({ ...devices['iPhone 13'] });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push('console: ' + m.text());
      });
      page.on('requestfailed', (r) => errors.push(`failed: ${r.url()} ${r.failure()?.errorText ?? ''}`));
      page.on('response', (r) => {
        if (r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
      });
      await page.goto(`http://${process.env.HOSTIP ?? '127.0.0.1'}:${port}/play?room=ABCD`, { waitUntil: 'load' });
      await page.waitForTimeout(4000);
      const styled = await page.evaluate(() => getComputedStyle(document.querySelector('.card')!).position === 'fixed');
      await page.screenshot({ path: path.join(OUT, `webkit-${mode}.png`) });
      console.log(`${mode}: controller styled=${styled}`);
      for (const e of errors.slice(0, 12)) console.log('   ' + e);
      await ctx.close();
    } finally {
      server.kill();
    }
  }
  await browser.close();
}
void main();
