/**
 * End-to-end check of the multiplayer path with emulated phones over the LAN address (D15).
 * Starts its own server, opens the host and phones in Chrome, and checks join, room-full, leader start,
 * per-phone input routing, AI takeover on disconnect, reconnect to the same slot, and host refresh.
 *
 *   npm run e2e -- --phase phase5
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './tk-hook';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const PHASE = arg('phase', 'latest');
const PORT = Number(arg('port', '3101'));
const OUT = path.join(ROOT, 'docs', 'screens', PHASE);
const lan =
  Object.values(networkInterfaces())
    .flat()
    .find((a) => a && a.family === 'IPv4' && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address))
    ?.address ?? 'localhost';
const PHONE_BASE = `http://${lan}:${PORT}`;

const results: { check: string; ok: boolean; note?: string }[] = [];
const check = (name: string, ok: boolean, note?: string): void => {
  results.push({ check: name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? ' — ' + note : ''}`);
};

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
    child.stderr!.on('data', (d: Buffer) => {
      const t = d.toString();
      if (!t.includes('Wi-Fi') && !t.includes('Fix:')) process.stderr.write(t);
    });
  });
}

async function phone(
  browser: Browser,
  model: string,
  room: string,
  name: string | null,
  ctx?: BrowserContext,
): Promise<Page> {
  const c = ctx ?? (await browser.newContext({ ...devices[model]! }));
  const p = await c.newPage();
  await p.addInitScript('window.__name = (f) => f;');
  p.on('pageerror', (e) => console.error(`[${name ?? model}] ${e.message}`));
  await p.goto(`${PHONE_BASE}/play?room=${room}`);
  if (name !== null) {
    await p.fill('#name', name);
    await p.click('#joinBtn');
  }
  return p;
}

/** Press and hold an element with a real pointer (touch-like) for ms milliseconds. */
async function hold(p: Page, sel: string, ms: number, dx = 0): Promise<void> {
  const b = (await p.locator(sel).boundingBox())!;
  await p.mouse.move(b.x + b.width / 2 + dx * b.width * 0.4, b.y + b.height / 2);
  await p.mouse.down();
  await p.waitForTimeout(ms);
  await p.mouse.up();
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const host = await browser.newPage({ viewport: { width: 1600, height: 900 } });
    await host.addInitScript('window.__name = (f) => f;');
    host.on('pageerror', (e) => console.error('[host]', e.message));
    await host.goto(`http://localhost:${PORT}/?noadapt=1`);
    await host.waitForFunction(() => window.__tk?.state().room, null, { timeout: 30000 });
    const room = (await host.evaluate(() => window.__tk.state().room))!;
    check('host creates a 4-letter room', /^[A-Z2-9]{4}$/.test(room), room);
    await host.waitForTimeout(1200);
    await host.screenshot({ path: path.join(OUT, 'host-lobby-empty.png') });

    // phones join (portrait join screen first, for the record)
    const aCtx = await browser.newContext({ ...devices['iPhone 15 Pro']! });
    const aPortrait = await phone(browser, 'iPhone 15 Pro', room, null, aCtx);
    await aPortrait.waitForTimeout(600);
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-join-portrait.png') });
    await aPortrait.fill('#name', 'Zul');
    await aPortrait.click('#joinBtn');
    await aPortrait.waitForSelector('#wait:not([hidden])', { timeout: 10000 });
    await aPortrait.waitForTimeout(500);
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-wait-portrait.png') });
    check('phone 1 joins and becomes leader', await aPortrait.isVisible('#startBtn'));
    const b = await phone(browser, 'Pixel 7 landscape', room, 'Ana');
    await b.waitForSelector('#wait:not([hidden])', { timeout: 10000 });
    check('phone 2 joins (not leader)', !(await b.isVisible('#startBtn')));
    await b.click('#readyBtn');
    await b.waitForTimeout(300);
    await b.screenshot({ path: path.join(OUT, 'phone-wait-landscape.png') });

    // three bots fill the room; a sixth phone is rejected
    const bots: Page[] = [];
    for (let i = 0; i < 3; i++) bots.push(await phone(browser, 'iPhone SE landscape', room, `Bot${i + 1}`));
    for (const bp of bots) await bp.waitForSelector('#wait:not([hidden])', { timeout: 10000 });
    const sixth = await phone(browser, 'Galaxy S9+ landscape', room, 'Six');
    await sixth.waitForSelector('#joinErr:not([hidden])', { timeout: 10000 });
    const errText = await sixth.textContent('#joinErr');
    check('a 6th phone gets "Room full"', /full/i.test(errText ?? ''), errText ?? '');
    await sixth.screenshot({ path: path.join(OUT, 'phone-room-full.png') });
    await sixth.context().close();
    await host.waitForFunction(() => window.__tk.lobby()?.players.length === 5, null, { timeout: 10000 });
    await host.waitForTimeout(800);
    await host.screenshot({ path: path.join(OUT, 'host-lobby-5.png') });

    // the leader starts from the phone
    await aPortrait.setViewportSize({ width: 852, height: 393 }); // turn the iPhone sideways
    await aPortrait.click('#startBtn');
    await host.waitForFunction(() => window.__tk.state().inRace, null, { timeout: 10000 });
    check('leader START on the phone starts the race', true);
    await aPortrait.waitForSelector('#drive:not([hidden])', { timeout: 10000 });
    check('phones switch to the driving screen', await b.isVisible('#drive'));
    await host.waitForTimeout(4500);
    await host.screenshot({ path: path.join(OUT, 'host-race-5.png') });
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-drive-iphone.png') });
    await b.screenshot({ path: path.join(OUT, 'phone-drive-pixel.png') });

    // input routing: phone 1 steers right, phone 2 brakes + drifts; each must only affect its own kart
    const kartIn = (i: number) =>
      host.evaluate((n) => {
        const k = window.__tk.session()!.s.humans[n]!;
        return { ...k.input, ai: k.ai, slot: k.slot };
      }, i);
    const steerA = hold(aPortrait, '#steerZone', 700, 1); // works for the slider (default) and the cross pad
    await aPortrait.waitForTimeout(350);
    const a1 = await kartIn(0),
      b1 = await kartIn(1);
    await steerA;
    check(
      'phone 1 RIGHT steers kart P1 only',
      a1.steer > 0.5 && Math.abs(b1.steer) < 0.01,
      `P1 steer ${a1.steer.toFixed(2)}, P2 steer ${b1.steer.toFixed(2)}`,
    );
    const brakeB = hold(b, '#brakeBtn', 700);
    await b.waitForTimeout(350);
    const b2 = await kartIn(1),
      a2 = await kartIn(0);
    await brakeB;
    check('phone 2 BRAKE reaches kart P2 only', b2.brake && !a2.brake);
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-drive-iphone-race.png') });

    // pause (D37): phone 2 pauses the race for everyone; phone 1 sees who paused and resumes it
    await b.click('#menuBtn');
    let paused = false,
      resumed = false,
      by = '';
    try {
      await host.waitForFunction(() => window.__tk.session()?.paused === true, null, { timeout: 5000 });
      await aPortrait.waitForSelector('#pauseSheet:not([hidden])', { timeout: 5000 });
      by = (await aPortrait.textContent('#pauseBy')) ?? '';
      paused = /Ana/.test(by);
      await aPortrait.waitForTimeout(500); // let the card finish its rise animation
      await aPortrait.screenshot({ path: path.join(OUT, 'phone-paused.png') });
      await host.screenshot({ path: path.join(OUT, 'host-paused.png') });
      await aPortrait.click('#resumeBtn');
      await host.waitForFunction(() => window.__tk.session()?.paused === false, null, { timeout: 5000 });
      await b.waitForSelector('#pauseSheet', { state: 'hidden', timeout: 5000 });
      resumed = true;
    } catch {
      /* reported below */
    }
    check('a phone pauses the race for everyone; another phone resumes it', paused && resumed, `card: "${by}"`);

    // multi-touch: steer and drift at the same time on one phone (two pointers via touchscreen events)
    const ms = await aPortrait.evaluate(async () => {
      const fire = (el: Element, type: string, id: number, x: number, y: number): void => {
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: y,
            bubbles: true,
            isPrimary: id === 1,
          }),
        );
      };
      const dp = document.getElementById('steerZone')!.getBoundingClientRect(),
        dz = document.getElementById('steerZone')!;
      const dr = document.getElementById('driftBtn')!,
        rr = dr.getBoundingClientRect();
      fire(dz, 'pointerdown', 1, dp.right - 10, dp.top + dp.height / 2);
      fire(dr, 'pointerdown', 2, rr.left + rr.width / 2, rr.top + rr.height / 2);
      await new Promise((r) => setTimeout(r, 300));
      const both = document.getElementById('dpad')!.classList.contains('right') && dr.classList.contains('on');
      fire(dz, 'pointerup', 1, dp.right - 10, dp.top + dp.height / 2);
      fire(dr, 'pointerup', 2, rr.left, rr.top);
      return both;
    });
    check('steer and drift together on one phone (two pointers)', ms);

    // disconnect → AI takeover; reopen with the same token → same slot, control restored
    await b.close();
    await host.waitForFunction(() => window.__tk.session()!.s.humans[1]!.ai === true, null, { timeout: 15000 });
    check('closing a phone mid-race hands its kart to the AI', true);
    const b2p = await b.context().newPage();
    await b2p.goto(`${PHONE_BASE}/play?room=${room}`);
    await b2p.fill('#name', 'Ana');
    await b2p.click('#joinBtn');
    await host.waitForFunction(() => window.__tk.session()!.s.humans[1]!.ai === false, null, { timeout: 15000 });
    check('reopening the page restores control of the same kart', await b2p.isVisible('#drive'));

    // phase 7: everyone races to the line (autopilot); each phone shows its finish card, then the results with
    // the leader's buttons; RACE AGAIN starts a new race and the phones count down 3-2-1-GO
    await host.evaluate(() => {
      const ses = window.__tk.session() as unknown as {
        game: { setHumanAi(slot: number, on: boolean): void };
        s: { phase: string; humans: { slot: number; finished: boolean }[] };
      };
      for (const k of ses.s.humans) ses.game.setHumanAi(k.slot, true);
      for (let i = 0; i < 60 * 240 && !ses.s.humans.every((k) => k.finished); i++) window.__tk.advance(1 / 60);
    });
    let finText = '';
    try {
      await aPortrait.waitForSelector('#finCard:not([hidden])', { timeout: 5000 });
      finText = ((await aPortrait.textContent('#finCard')) ?? '').replace(/\s+/g, ' ').trim();
      await aPortrait.waitForTimeout(500);
      await aPortrait.screenshot({ path: path.join(OUT, 'phone-finished.png') });
    } catch {
      /* reported below */
    }
    check('a finished player sees their place and time on the phone', /FINISHED \d/.test(finText), finText);
    await aPortrait.waitForSelector('#results:not([hidden])', { timeout: 15000 });
    const resTitle = (await aPortrait.textContent('#resTitle')) ?? '';
    await aPortrait.waitForTimeout(400);
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-results-leader.png') });
    await b2p.waitForSelector('#results:not([hidden])', { timeout: 10000 });
    const others = !(await b2p.isVisible('#leaderRow')) && (await b2p.isVisible('#resNote'));
    check(
      'results on every phone: leader gets RACE AGAIN, others wait for the leader',
      /You finished/.test(resTitle) && (await aPortrait.isVisible('#againBtn')) && others,
      resTitle,
    );
    await aPortrait.click('#againBtn');
    await aPortrait.waitForSelector('#drive:not([hidden])', { timeout: 10000 });
    let go = false;
    try {
      await aPortrait.waitForFunction(() => document.getElementById('count')?.textContent === 'GO!', null, {
        timeout: 10000,
      });
      go = true;
    } catch {
      /* reported below */
    }
    check('RACE AGAIN restarts; phones count down to GO', go && !(await aPortrait.isVisible('#finCard')));

    // host refresh keeps the room and the players
    await host.reload();
    await host.waitForFunction(() => window.__tk?.state().room && window.__tk.lobby()?.players.length === 5, null, {
      timeout: 20000,
    });
    const room2 = await host.evaluate(() => window.__tk.state().room);
    check('refreshing the host keeps the room and the players', room2 === room, `${room} → ${room2}`);
    await aPortrait.waitForSelector('#wait:not([hidden])', { timeout: 10000 });
    check('phones return to the waiting screen after a host refresh', true);

    // portrait during driving shows the rotate overlay
    await aPortrait.click('#startBtn');
    await aPortrait.waitForSelector('#drive:not([hidden])', { timeout: 10000 });
    await aPortrait.setViewportSize({ width: 393, height: 852 });
    await aPortrait.waitForTimeout(400);
    check('portrait while driving shows "Rotate your phone"', await aPortrait.isVisible('#rotate'));
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-rotate.png') });
    await aPortrait.setViewportSize({ width: 852, height: 393 });
    await aPortrait.waitForTimeout(300);

    // controller next to the reference image
    const ref = readFileSync(path.join(ROOT, 'reference', 'controller', 'controller.jpeg')).toString('base64');
    const mine = readFileSync(path.join(OUT, 'phone-drive-iphone-race.png')).toString('base64');
    const comp = await browser.newPage({ viewport: { width: 1500, height: 760 } });
    await comp.setContent(`<body style="margin:0;background:#2a2f3a;font-family:sans-serif;color:#fff;display:flex;gap:40px;align-items:center;justify-content:center;height:100vh">
      <figure style="margin:0;text-align:center"><img src="data:image/jpeg;base64,${ref}" style="height:640px;border-radius:16px"><figcaption>Reference (portrait)</figcaption></figure>
      <figure style="margin:0;text-align:center"><img src="data:image/png;base64,${mine}" style="width:880px;border-radius:24px"><figcaption>Built controller, held sideways (iPhone 15 Pro, landscape)</figcaption></figure></body>`);
    await comp.screenshot({ path: path.join(ROOT, 'docs', 'screens', 'controller-vs-reference.png') });
    await comp.close();
  } finally {
    writeFileSync(path.join(OUT, 'e2e.json'), JSON.stringify({ phoneBase: PHONE_BASE, results }, null, 2));
    await browser.close();
    server.kill();
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
