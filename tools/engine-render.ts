/**
 * Engine sound render (D60): drives the real EngineModel + EngineSound through a scripted lap in an
 * OfflineAudioContext (headless Chrome) and writes a WAV to listen to, plus levels per section.
 *
 *   npx tsx tools/engine-render.ts --out docs/audio/engine-demo.wav
 *
 * The script: idle on the grid, launch revs, GO and upshifts to top speed, a boost into 7th, a jump on the gas
 * (rev limiter), hard braking with blipped downshifts, a spin-out (overrun crackles), back on the gas, then a
 * lift to a stop at the finish and idle.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const OUT = path.join(ROOT, arg('out', 'docs/audio/engine-demo.wav'));
const PORT = Number(arg('port', '3108'));

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
    child.stderr!.on('data', (d: Buffer) => process.stderr.write(d));
  });
}

interface Result {
  wav: string;
  sections: { name: string; from: number; to: number; rms: number; peak: number; rpm: [number, number] }[];
  peak: number;
  events: string[];
}

async function main(): Promise<void> {
  mkdirSync(path.dirname(OUT), { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript('window.__name = (f) => f;');
    await page.goto(`http://localhost:${PORT}/play`);
    const res: Result = await page.evaluate(async () => {
      const { EngineModel } = await import('/host/src/engine-model.ts' as string);
      const { EngineSound, noiseBuffer } = await import('/host/src/engine-sound.ts' as string);
      const { masterLimiter } = await import('/host/src/audio.ts' as string);
      const SR = 44100,
        DUR = 28,
        FPS = 60,
        dt = 1 / FPS;
      const ctx = new OfflineAudioContext(1, SR * DUR, SR);
      const master = ctx.createGain();
      master.gain.value = 0.9; // as Audio's master
      master.connect(masterLimiter(ctx)).connect(ctx.destination);
      const sfx = ctx.createGain();
      sfx.connect(master);
      const snd = new EngineSound(ctx, sfx, noiseBuffer(ctx, 2, 7));
      const m = new EngineModel();
      const SECTIONS: [string, number, number][] = [
        ['idle on the grid', 0, 2],
        ['launch revs (DRIFT held)', 2, 4],
        ['GO: launch and upshifts', 4, 9.5],
        ['boost into 7th', 9.5, 13],
        ['jump on the gas: rev limiter', 13, 14.3],
        ['land, flat out', 14.3, 15.3],
        ['hard braking: blipped downshifts', 15.3, 16],
        ['back on the gas', 16, 17.5],
        ['spin-out: overrun crackles', 17.5, 19.5],
        ['back on the gas', 19.5, 24],
        ['lift at the finish: overrun to a stop', 24, 26.5],
        ['idle', 26.5, 28],
      ];
      let sp = 0;
      const rpmLog: number[] = [];
      const events: string[] = [];
      const step = (t: number): void => {
        const grid = t < 4;
        let throttle = !grid,
          air = false,
          boost = false;
        const M = 1.3, // the game's default speed setting (handling.speedMul)
          top = 38 * M;
        if (t >= 9.5 && t < 11) boost = true;
        if (t >= 13 && t < 14.3) air = true;
        if (t >= 15.3 && t < 16) throttle = false; // braking
        if (t >= 17.5 && t < 19.5) throttle = false; // spinning
        if (t >= 24) throttle = false; // lifted
        if (!grid && !air) {
          if (throttle) {
            const tp = boost ? 52 * M : top;
            if (sp < tp) sp = Math.min(tp, sp + (boost ? 70 * M : Math.max(5, 28 * M * (1 - sp / tp))) * dt);
            if (sp > tp) sp -= (sp - tp) * Math.min(1, 2.2 * dt);
          } else if (t < 16) sp = Math.max(0, sp - 48 * dt);
          else if (t < 19.5) sp *= Math.exp(-2.5 * dt);
          else sp = Math.max(0, sp - 12 * dt);
        }
        const inp = { speed: sp, throttle, boost, air, grid, launch: t >= 2 && t < 4, scale: M };
        const ev = m.update(dt, inp);
        if (ev) events.push(`${t.toFixed(2)}s ${ev} -> ${m.gear}`);
        snd.update(m, ev, { on: true, speed: sp, boost, dt }, t);
        rpmLog.push(m.rpm);
      };
      const N = DUR * FPS;
      for (let i = 0; i < N; i++) {
        const t = i * dt;
        void ctx.suspend(t).then(() => {
          step(t);
          void ctx.resume();
        });
      }
      const buf = await ctx.startRendering();
      const d = buf.getChannelData(0);
      let peak = 0;
      for (const v of d) peak = Math.max(peak, Math.abs(v));
      const sections = SECTIONS.map(([name, from, to]) => {
        let s2 = 0,
          pk = 0;
        const a = Math.floor(from * SR),
          b = Math.floor(to * SR);
        for (let i = a; i < b; i++) {
          s2 += d[i]! * d[i]!;
          pk = Math.max(pk, Math.abs(d[i]!));
        }
        const r = rpmLog.slice(Math.floor(from * FPS), Math.floor(to * FPS));
        return {
          name,
          from,
          to,
          rms: 20 * Math.log10(Math.sqrt(s2 / (b - a)) + 1e-9),
          peak: 20 * Math.log10(pk + 1e-9),
          rpm: [Math.round(Math.min(...r)), Math.round(Math.max(...r))] as [number, number],
        };
      });
      // 16-bit PCM WAV
      const bytes = new ArrayBuffer(44 + d.length * 2),
        v = new DataView(bytes);
      const str = (o: number, s: string): void => {
        for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
      };
      str(0, 'RIFF');
      v.setUint32(4, 36 + d.length * 2, true);
      str(8, 'WAVE');
      str(12, 'fmt ');
      v.setUint32(16, 16, true);
      v.setUint16(20, 1, true);
      v.setUint16(22, 1, true);
      v.setUint32(24, SR, true);
      v.setUint32(28, SR * 2, true);
      v.setUint16(32, 2, true);
      v.setUint16(34, 16, true);
      str(36, 'data');
      v.setUint32(40, d.length * 2, true);
      for (let i = 0; i < d.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i]!)) * 32767, true);
      let bin = '';
      const u8 = new Uint8Array(bytes);
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      return { wav: btoa(bin), sections, peak: 20 * Math.log10(peak), events };
    });
    writeFileSync(OUT, Buffer.from(res.wav, 'base64'));
    console.log(`wrote ${path.relative(ROOT, OUT)}  overall peak ${res.peak.toFixed(1)} dBFS`);
    for (const s of res.sections)
      console.log(
        `${String(s.from).padStart(5)}-${String(s.to).padEnd(5)} ${s.name.padEnd(40)} rms ${s.rms.toFixed(1).padStart(6)} dBFS  peak ${s.peak.toFixed(1).padStart(6)}  rpm ${s.rpm[0]}-${s.rpm[1]}`,
      );
    console.log('shifts:', res.events.join(', '));
  } finally {
    await browser.close();
    server.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
