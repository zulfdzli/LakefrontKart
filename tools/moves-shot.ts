/**
 * D74 signature-move screenshots: an autopilot race per character (two players in split screen, from the front of
 * the grid), the move fired a few seconds after GO, and a shot just after.
 *
 *   npx tsx tools/moves-shot.ts
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3160;
const OUT = path.join(ROOT, 'docs', 'screens', 'd74');
/** Character index, seconds after the start to fire, seconds to wait before the shot. */
const SHOTS: [string, number, number, number][] = [
  ['bruno', 0, 0.4, 0.25],
  ['pip', 1, 6, 0.5],
  ['zed', 2, 6, 1.0],
  ['mochi', 3, 6, 0.9],
  ['gus', 4, 6, 0.35],
  ['luna', 5, 6, 0.6],
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
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=d3d11', '--enable-gpu'] });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript('window.__name = (f) => f;');
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?noadapt=1`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    for (const [name, ci, at, after] of SHOTS) {
      const r = await page.evaluate(
        ([ci, at, after]) => {
          window.__tk.race({
            seed: 4,
            ci,
            humans: 2,
            laps: 2,
            autopilot: true,
            track: 'meadows',
            moves: true,
            pole: true,
          });
          const ses = window.__tk.session() as unknown as {
            s: { phase: string; raceTime: number; humans: { meter: number; slot: number }[] };
            game: { setHumanAi(slot: number, on: boolean): void; setInput(slot: number, i: unknown): void };
            skipIntro(): void;
          };
          for (let i = 0; i < 60 * 20 && (ses.s.phase !== 'race' || ses.s.raceTime < at); i++)
            window.__tk.advance(1 / 60);
          const k = ses.s.humans[0]!;
          k.meter = 1;
          ses.game.setHumanAi(0, false);
          ses.game.setInput(0, { steer: 0, throttle: true, brake: false, drift: false, item: null, move: true });
          window.__tk.advance(1 / 60);
          ses.game.setHumanAi(0, true);
          for (let t = 0; t < after; t += 1 / 60) window.__tk.advance(1 / 60);
          return k.meter;
        },
        [ci, at, after] as const,
      );
      await page.waitForTimeout(800);
      await page.screenshot({ path: path.join(OUT, `move-${name}.png`) });
      console.log(`  move-${name} (meter after ${r.toFixed(2)})`);
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 4));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
