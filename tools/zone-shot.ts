/**
 * D83 fun-zone screenshots: on each race track, an autopilot race (Easy AI, the player from pole) with the zones on,
 * shot coming up to the slalom, in the gates, over the jump target, at the draft tunnel's mouth and inside it; and the
 * frame rate in the tunnel. The player's zone events are printed.
 *
 *   npx tsx tools/zone-shot.ts
 *   npx tsx tools/zone-shot.ts --tracks sepang --weather night
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
const PORT = 3141;
const OUT = path.join(ROOT, 'docs', 'screens', 'd83');
const TRACKS = arg('tracks', 'meadows,canyon,frosty,sepang').split(',');
const WEATHER = arg('weather', 'day');

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

/** Advance until the player is `d` m before a zone's sample (negative: past it); `which` picks the sample. */
async function until(page: Page, which: string, d: number): Promise<string> {
  return page.evaluate(
    ([which, d]) => {
      type Z = {
        slalom: { gates: { idx: number }[] };
        target: { lip: number; idx: number };
        tunnel: { i0: number; i1: number };
      };
      const ses = window.__tk.session() as unknown as {
        s: { zones: Z; phase: string; humans: { idx: number; lap: number }[]; track: { N: number; DS: number } };
      };
      const s = ses.s,
        z = s.zones,
        T = s.track,
        me = s.humans[0]!;
      const at: Record<string, number> = {
        slalom: z.slalom.gates[0]!.idx,
        gates: z.slalom.gates[2]!.idx,
        lip: z.target.lip,
        tunnel: z.tunnel.i0,
        inside: z.tunnel.i0 + Math.round((z.tunnel.i1 - z.tunnel.i0) * 0.45),
      };
      const i = at[which]! % T.N;
      const ahead = (): number => {
        let a = ((i - me.idx + T.N) % T.N) * T.DS;
        if (a > (T.N * T.DS) / 2) a -= T.N * T.DS;
        return a;
      };
      // first lap only once the grid is behind (the line's wrap would read as "just past it")
      for (let n = 0; n < 60 * 240 && (me.lap < 1 || ahead() > d || ahead() < d - 40) && s.phase !== 'finished'; n++)
        window.__tk.advance(1 / 60);
      return `${which}: ${ahead().toFixed(0)} m ahead, lap ${me.lap}`;
    },
    [which, d] as const,
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
        ([track, weather]) => {
          window.__tk.race({
            seed: 5,
            ci: 1,
            laps: 3,
            autopilot: true,
            track,
            weather,
            zones: true,
            moves: true,
            diff: 'easy',
            pole: true,
          });
          // the player's zone events, for the log
          const w = window as unknown as { __zl: string[] };
          w.__zl = [];
          const ses = window.__tk.session() as unknown as {
            game: { drainEvents(): { type: string; kart: number; n?: number; lvl?: number }[] };
          };
          const g = ses.game,
            drain = g.drainEvents.bind(g);
          g.drainEvents = () => {
            const ev = drain();
            for (const e of ev)
              if (e.kart === 0 && ['zone', 'zonemiss', 'cone'].includes(e.type))
                w.__zl.push(`${e.type}${e.n ?? ''}${e.lvl ? `+${e.lvl}` : ''}`);
            return ev;
          };
        },
        [track, WEATHER] as const,
      );
      const shots: [string, string, number][] = [
        ['slalom', 'slalom', 45],
        ['gates', 'gates', 8],
        ['ramp', 'lip', 75],
        ['target', 'lip', 30],
        ['tunnel', 'tunnel', 35],
        ['inside', 'inside', 0],
      ];
      for (const [name, which, d] of shots) {
        const st = await until(page, which, d);
        await page.waitForTimeout(600);
        await page.screenshot({ path: path.join(OUT, `${track}-${name}.png`) });
        console.log(`  ${track}-${name}: ${st}`);
        if (name === 'inside') {
          const fps = await page.evaluate(
            () =>
              new Promise<number>((res) => {
                let n = 0;
                const t0 = performance.now();
                const f = (): void => {
                  if (++n === 90) res((n * 1000) / (performance.now() - t0));
                  else requestAnimationFrame(f);
                };
                requestAnimationFrame(f);
              }),
          );
          console.log(`  ${track} fps in the tunnel: ${fps.toFixed(0)}`);
        }
      }
      console.log(
        `  ${track} player zone events: ${await page.evaluate(() => (window as unknown as { __zl: string[] }).__zl.join(' '))}`,
      );
    }
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
