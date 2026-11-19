/**
 * Validation screenshot of the lobby with phones joined (D51): starts a server, opens the host, joins three
 * simulated phones through the real join flow, lets one pick Grand Prix settings, and saves the host screen and
 * one phone's waiting screen.
 *   npx tsx tools/lobby-shot.ts --out docs/screens/validation
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium, devices } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const OUT = path.join(ROOT, args[args.indexOf('--out') + 1] ?? 'docs/screens/validation');
const PORT = 3104;

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
    const host = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await host.addInitScript('window.__name = (f) => f;');
    await host.goto(`http://localhost:${PORT}/`);
    await host.waitForFunction(() => window.__tk?.ready && !!window.__tk.state().room, null, { timeout: 30000 });
    const room = await host.evaluate(() => window.__tk.state().room!);
    await host.screenshot({ path: path.join(OUT, '01-main-menu-empty.png') });
    const names = ['Zul', 'Ana', 'Sam'];
    const phones = [];
    for (const n of names) {
      const ctx = await browser.newContext({ ...devices['iPhone 15 Pro landscape']! });
      const p = await ctx.newPage();
      await p.addInitScript('window.__name = (f) => f;');
      await p.goto(`http://localhost:${PORT}/play?room=${room}`);
      await p.fill('#name', n);
      await p.click('#joinBtn');
      await p.waitForSelector('#wait:not([hidden])', { timeout: 15000 });
      phones.push(p);
    }
    // different characters, everyone ready, and the leader picks a Grand Prix
    const chars = ['pip', 'mochi', 'zed'];
    for (let i = 0; i < phones.length; i++) {
      await phones[i]!.click(`#chars button[data-id="${chars[i]}"]`).catch(() => {});
      await phones[i]!.click('#readyBtn');
    }
    await phones[0]!.click('#cfgMode button[data-v="gp"]');
    await host.waitForTimeout(2500);
    await host.screenshot({ path: path.join(OUT, '02-main-menu-players.png') });
    // dismiss the one-time tip, as a player would
    for (const p of phones) for (let k = 0; k < 5 && (await p.isVisible('#tip')); k++) await p.click('#tipClose');
    await phones[0]!.waitForTimeout(400);
    await phones[0]!.screenshot({ path: path.join(OUT, '03-phone-leader-settings.png') });
    // single race with a track picked, to show the track row too
    await phones[0]!.click('#cfgMode button[data-v="single"]');
    await phones[0]!.click('#cfgTrack button[data-v="sepang"]');
    await phones[0]!.waitForTimeout(500);
    await phones[0]!.screenshot({ path: path.join(OUT, '03b-phone-leader-single.png') });
    console.log('room', room, 'saved');
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
