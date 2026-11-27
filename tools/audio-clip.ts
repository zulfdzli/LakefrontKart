/**
 * D75 audio clips: records what the host actually plays (the menu music, then a race with the engine and effects
 * over the race music) into .webm files you can listen to. It taps everything the page sends to the speakers.
 *
 *   npx tsx tools/audio-clip.ts            (docs/screens/d75/menu-music.webm and race-audio.webm)
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import './tk-hook';
import { chromium, type Page } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = 3180;
const OUT = path.join(ROOT, 'docs', 'screens', process.argv[2] ?? 'd75');

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

/** Everything connected to a context's speakers is also fed to a recorder. */
const TAP = `
  (() => {
    const orig = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (dst, ...rest) {
      if (dst instanceof AudioDestinationNode) {
        const ctx = dst.context;
        if (!ctx.__tap) {
          ctx.__tap = ctx.createMediaStreamDestination();
          window.__tapStream = ctx.__tap.stream;
        }
        orig.call(this, ctx.__tap);
      }
      return orig.call(this, dst, ...rest);
    };
    window.__record = (ms) => new Promise((res) => {
      const rec = new MediaRecorder(window.__tapStream, { mimeType: 'audio/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        const buf = new Uint8Array(await new Blob(chunks, { type: 'audio/webm' }).arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        res(btoa(s));
      };
      rec.start();
      setTimeout(() => rec.stop(), ms);
    });
  })();
`;

async function record(page: Page, ms: number, file: string): Promise<void> {
  const b64 = await page.evaluate(
    (ms) => (window as unknown as { __record(ms: number): Promise<string> }).__record(ms),
    ms,
  );
  writeFileSync(path.join(OUT, file), Buffer.from(b64, 'base64'));
  console.log(`  ${file}: ${Math.round((b64.length * 0.75) / 1024)} kB`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.addInitScript('window.__name = (f) => f;');
    await page.addInitScript(TAP);
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto(`http://localhost:${PORT}/?noadapt=1`);
    await page.waitForFunction(() => window.__tk?.ready, null, { timeout: 30000 });
    // the first gesture unlocks audio: the lobby plays the menu tune
    await page.mouse.click(5, 5);
    await page.waitForTimeout(1500);
    await record(page, 21000, 'menu-music.webm');
    // a race (autopilot, real time): the engine over the race music
    await page.evaluate(() =>
      window.__tk.race({
        seed: 3,
        ci: 1,
        laps: 2,
        autopilot: true,
        track: 'canyon',
        intro: false,
        events: true,
        comm: true,
      }),
    );
    await page.waitForTimeout(500);
    await record(page, 25000, 'race-audio.webm');
    if (errors.length) console.log('page errors:', errors.slice(0, 5));
  } finally {
    await browser.close();
    server.kill();
  }
}
void main();
