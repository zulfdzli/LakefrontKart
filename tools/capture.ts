/**
 * Polish-loop screenshots (section 13): starts its own server, drives a seeded autopilot race through the
 * host's window.__tk hook in Chrome on the real GPU, and saves fixed shots plus frame stats.
 *
 *   npm run capture -- --phase phase4
 *   npm run capture -- --phase phase4 --headed      (watch it)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium, type Page } from 'playwright-core';
import { TRACKS, isTrackId } from '@tk/shared';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const PHASE = arg('phase', 'latest');
const PORT = Number(arg('port', '3100'));
const OUT = path.join(ROOT, 'docs', 'screens', PHASE);
const SEED = Number(arg('seed', '7'));
const TRACK = arg('track', 'meadows');
const W = Number(arg('w', '1600')),
  H = Number(arg('h', '900'));

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
    child.on('exit', (c) => reject(new Error('server exited ' + c)));
  });
}

async function frames(page: Page, ms: number): Promise<void> {
  await page.waitForTimeout(ms);
}

async function stats(page: Page, seconds: number): Promise<Record<string, number>> {
  return page.evaluate(
    (sec) =>
      new Promise<Record<string, number>>((res) => {
        const ft: number[] = [];
        let last = performance.now();
        const t0 = last;
        const f = (now: number): void => {
          ft.push(now - last);
          last = now;
          if (now - t0 < sec * 1000) requestAnimationFrame(f);
          else {
            ft.sort((a, b) => a - b);
            res({
              fps: Math.round(1000 / (ft.reduce((a, b) => a + b, 0) / ft.length)),
              p50: +ft[ft.length >> 1]!.toFixed(2),
              p95: +ft[Math.floor(ft.length * 0.95)]!.toFixed(2),
            });
          }
        };
        requestAnimationFrame(f);
      }),
    seconds,
  );
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !args.includes('--headed'),
    args: [
      '--use-angle=d3d11',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--force_high_performance_gpu',
      ...(args.includes('--uncapped') ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : []),
    ],
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    // tsx/esbuild wraps named functions in __name(); functions sent to page.evaluate need it to exist there
    await page.addInitScript('window.__name = (f) => f;');
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/?noadapt=1&track=${TRACK}`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    await frames(page, 1500);
    const gpu = await page.evaluate(() => {
      const gl = document.createElement('canvas').getContext('webgl2')!;
      const e = gl.getExtension('WEBGL_debug_renderer_info');
      return e ? (gl.getParameter(e.UNMASKED_RENDERER_WEBGL) as string) : 'unknown';
    });
    console.log('GPU:', gpu);
    const shot = async (name: string): Promise<void> => {
      await page.screenshot({ path: path.join(OUT, name + '.png') });
      console.log('  ' + name);
    };

    await shot('01-title');
    await page.evaluate((seed) => window.__tk.race({ seed, ci: 1, laps: 2, autopilot: true }), SEED);
    await frames(page, 1300);
    await shot('02-countdown');
    await page.waitForFunction(() => (window.__tk.state() as { raceTime: number }).raceTime > 1.5, null, {
      timeout: 20000,
    });
    await shot('03-race-start');
    const perf = await stats(page, 5);
    const info = await page.evaluate(() => window.__tk.info());

    // fast-forward the simulation to fixed race times, then let the camera settle in real time
    const at = async (t: number, name: string): Promise<void> => {
      await page.evaluate((target) => {
        const st = window.__tk.state() as { raceTime: number };
        if (st.raceTime < target) window.__tk.advance(target - st.raceTime);
      }, t);
      await frames(page, 700);
      await shot(name);
    };
    // wait for a drift, then a boost, on the player's kart
    const until = async (cond: string, name: string): Promise<void> => {
      const ok = await page.evaluate((c) => {
        const s = window.__tk.session()!;
        const k = s.players[0]!.kart;
        let seen = 0;
        for (let i = 0; i < 60 * 90; i++) {
          if (k.drifting) seen++;
          if ((c === 'drift' && k.drifting && k.driftLevel >= 1) || (c === 'boost' && k.boost > 0.5)) return 'ok';
          window.__tk.advance(1 / 60);
        }
        return 'no ' + c + ' (drifting steps ' + seen + ', phase ' + s.s.phase + ')';
      }, cond);
      await frames(page, 120);
      if (ok === 'ok') await shot(name);
      else console.log('  skipped', name, ok);
    };
    await until('drift', '04-mid-drift');
    await until('boost', '05-mid-boost');
    await at(40, '06-race-40s');
    await at(75, '07-race-75s');
    // finish and show the podium
    await page.evaluate(() => {
      const s = window.__tk.session()!;
      for (let i = 0; i < 60 * 200 && s.s.phase !== 'finished'; i++) window.__tk.advance(1 / 60);
    });
    await page.waitForFunction(() => (window.__tk.state() as { stage: string }).stage === 'podium', null, {
      timeout: 15000,
    });
    await frames(page, 2500);
    await shot('08-podium');

    // phase 8: one shot just before each landmark, ramp (in the air), shortcut entrance and ice patch
    if (isTrackId(TRACK) && !args.includes('--no-features')) {
      const def = TRACKS[TRACK];
      const feats: [string, number, boolean][] = [
        ...def.landmarks.map((l) => [l.kind, l.at, false] as [string, number, boolean]),
        ...def.ramps.map((r) => ['jump', r.at, true] as [string, number, boolean]),
        ...def.shortcuts.map((c) => ['shortcut', c.from, false] as [string, number, boolean]),
        ...def.zones
          .filter((z) => z.surface === 'ice')
          .slice(0, 1)
          .map((z) => ['ice', z.from, false] as [string, number, boolean]),
      ];
      for (const [kind, at, air] of feats) {
        await page.evaluate((seed) => window.__tk.race({ seed, ci: 1, laps: 2, autopilot: true }), SEED);
        await page.waitForFunction(() => (window.__tk.state() as { raceTime: number }).raceTime > 0.5, null, {
          timeout: 20000,
        });
        const ok = await page.evaluate(
          ([f, wantAir]) => {
            const ses = window.__tk.session() as unknown as {
              s: { track: { N: number } };
              players: { kart: { idx: number; lap: number; air: boolean } }[];
            };
            const k = ses.players[0]!.kart,
              N = ses.s.track.N;
            const target = (((f - 0.012) % 1) + 1) % 1;
            for (let i = 0; i < 60 * 200; i++) {
              const fr = k.idx / N;
              if (wantAir ? k.air && k.lap >= 1 : k.lap >= 1 && fr >= target && fr < target + 0.006) return true;
              window.__tk.advance(1 / 60);
            }
            return false;
          },
          [at, air] as const,
        );
        await frames(page, air ? 120 : 700);
        if (ok) await shot(`feat-${kind}-${at.toFixed(2)}`);
        else console.log('  skipped feature', kind, at);
      }
    }

    // split-screen (section 6.2): every player count, with frame stats summed over all viewports
    const split: Record<string, unknown> = {};
    if (!args.includes('--no-split'))
      for (const n of [2, 3, 4, 5]) {
        await page.evaluate(([seed, humans]) => window.__tk.race({ seed, humans, laps: 2, autopilot: true }), [
          SEED,
          n,
        ] as const);
        await page.waitForFunction(() => (window.__tk.state() as { raceTime: number }).raceTime > 0.5, null, {
          timeout: 20000,
        });
        await page.evaluate(() => window.__tk.advance(14));
        await frames(page, 900);
        const p = await stats(page, 4);
        const inf = await page.evaluate(() => window.__tk.info());
        split[n] = { ...p, ...inf };
        await shot(`split-${n}`);
        console.log(`  split ${n}:`, p, inf);
        if (n === 5) {
          // one phone drops (reconnecting badge), then run on until the first player has finished
          await page.evaluate(() => {
            const s = window.__tk.session() as unknown as { setOffline(slot: number, off: boolean): void };
            s.setOffline(3, true);
          });
          await frames(page, 500);
          await shot('split-5-offline');
          await page.evaluate(() => {
            const s = window.__tk.session()!;
            for (let i = 0; i < 60 * 200 && !s.players.some((pl) => (pl.kart as { finished?: boolean }).finished); i++)
              window.__tk.advance(1 / 60);
            window.__tk.advance(1.5);
          });
          await frames(page, 1200);
          await shot('split-5-finished');
        }
      }

    const report = {
      phase: PHASE,
      gpu,
      viewport: `${W}x${H}`,
      seed: SEED,
      racePerf: perf,
      render: info,
      split,
      errors,
    };
    writeFileSync(path.join(OUT, 'capture.json'), JSON.stringify(report, null, 2));
    console.log('perf (racing):', perf, 'render:', info);
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
