/**
 * Renders the race car's four views (tools/carview/) and puts them next to reference/kart/kart.jpg in
 * docs/screens/car-vs-reference.png (D44). Also saves the AI livery.
 *   npm run car-sheet
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3102;
const OUT = path.join(ROOT, 'docs', 'screens');

function startServer(): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [path.join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'server/src/index.ts'],
      {
        cwd: ROOT,
        env: { ...process.env, PORT: String(PORT) },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
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

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.addInitScript('window.__name = (f) => f;');
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    for (const [name, q] of [
      ['car-sheet', 'slot=0&ci=1'],
      ['car-sheet-ai', 'ai=1&ci=0'],
    ] as const) {
      await page.goto(`http://localhost:${PORT}/dev/car?${q}`);
      await page.waitForFunction(() => (window as unknown as { __done?: boolean }).__done === true, null, {
        timeout: 30000,
      });
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `${name}.png`) });
      console.log('  ' + name);
    }
    if (errors.length) console.log('errors:', errors.join('\n'));
    const ref = readFileSync(path.join(ROOT, 'reference', 'kart', 'kart-v2.jpg')).toString('base64');
    const mine = readFileSync(path.join(OUT, 'car-sheet.png')).toString('base64');
    const comp = await browser.newPage({ viewport: { width: 2000, height: 760 } });
    await comp.setContent(`<body style="margin:0;background:#1e2126;font-family:sans-serif;color:#fff;display:flex;gap:30px;align-items:center;justify-content:center;height:100vh">
      <figure style="margin:0;text-align:center"><img src="data:image/jpeg;base64,${ref}" style="width:960px"><figcaption>Reference</figcaption></figure>
      <figure style="margin:0;text-align:center"><img src="data:image/png;base64,${mine}" style="width:960px"><figcaption>Built (P1 colour, neon livery)</figcaption></figure></body>`);
    await comp.screenshot({ path: path.join(OUT, 'car-vs-reference.png') });
    console.log('  car-vs-reference');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
