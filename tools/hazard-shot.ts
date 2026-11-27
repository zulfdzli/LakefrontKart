/**
 * D73 living-track screenshots: on each race track, an autopilot race (Easy AI, so the player leads into the event)
 * runs until the track's event warns, then shots during the warning and as it lands, and the frame rate there.
 *
 *   npx tsx tools/hazard-shot.ts
 *   npx tsx tools/hazard-shot.ts --tracks frosty --weather night
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
const PORT = 3140;
const OUT = path.join(ROOT, 'docs', 'screens', 'd73');
const TRACKS = arg('tracks', 'meadows,canyon,frosty,sepang').split(',');
const WEATHER = arg('weather', 'day');
const [NEAR1, NEAR2] = arg('near', '45,15').split(',').map(Number) as [number, number];

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

/**
 * Advance the race until the first event reaches a phase, then (if `near` > 0) until the player is within `near` m of
 * it, then `extra` seconds more; returns its state.
 */
async function until(page: Page, phase: string, near: number, extra: number): Promise<string> {
  return page.evaluate(
    ([phase, near, extra]) => {
      const ses = window.__tk.session() as unknown as {
        s: {
          hazards: { phase: string; t: number; kind: string; idx: number }[];
          phase: string;
          humans: { idx: number }[];
          track: { N: number; DS: number };
        };
      };
      const h = () => ses.s.hazards[0];
      const ahead = (): number => {
        const T = ses.s.track;
        return (((h()!.idx - ses.s.humans[0]!.idx + T.N) % T.N) * T.DS) % (T.N * T.DS);
      };
      for (let i = 0; i < 60 * 200 && h() && h()!.phase !== phase && ses.s.phase !== 'finished'; i++)
        window.__tk.advance(1 / 30);
      if (near > 0)
        for (let i = 0; i < 60 * 30 && h() && h()!.phase === phase && ahead() > near; i++) window.__tk.advance(1 / 30);
      for (let t = 0; t < extra; t += 1 / 30) window.__tk.advance(1 / 30);
      return `${h()?.kind} ${h()?.phase} t=${h()?.t.toFixed(1)} ahead ${ahead().toFixed(0)} m`;
    },
    [phase, near, extra] as const,
  );
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript('window.__name = (f) => f;');
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/?noadapt=1`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    for (const track of TRACKS) {
      await page.evaluate(
        ([track, weather]) =>
          window.__tk.race({
            seed: 5,
            ci: 1,
            laps: 2,
            autopilot: true,
            track,
            weather,
            events: true,
            diff: 'easy',
            pole: true,
          }),
        [track, WEATHER] as const,
      );
      const shots: [string, string, number, number][] = [
        ['warn', 'warn', 0, 1.2],
        ['close', 'active', NEAR1, 0],
        ['pass', 'active', NEAR2, 0],
      ];
      for (const [name, phase, near, extra] of shots) {
        const st = await until(page, phase, near, extra);
        await page.waitForTimeout(700);
        await page.screenshot({ path: path.join(OUT, `${track}-${name}.png`) });
        console.log(`  ${track}-${name}: ${st}`);
      }
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
