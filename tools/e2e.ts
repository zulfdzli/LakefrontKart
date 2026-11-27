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
import { CHARS, TUNE_WEIGHT } from '@tk/shared';

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
    // D74: the MOVE bar fills on the phone; full, a tap fires the move on the host
    await host.evaluate(() => {
      const ses = window.__tk.session() as unknown as { s: { humans: { slot: number; meter: number }[] } };
      ses.s.humans.find((h) => h.slot === 1)!.meter = 1;
    });
    let moveNote = '';
    const moveOk = await b
      .waitForSelector('#moveBtn.ready', { timeout: 5000 })
      .then(async () => {
        moveNote = ((await b.textContent('#moveLbl')) ?? '').trim();
        await b.screenshot({ path: path.join(OUT, 'phone-move-ready.png') });
        await b.dispatchEvent('#moveBtn', 'pointerdown', { pointerId: 9, isPrimary: true });
        return host
          .waitForFunction(
            () =>
              (window.__tk.session() as unknown as { s: { humans: { slot: number; meter: number }[] } }).s.humans.find(
                (h) => h.slot === 1,
              )!.meter < 0.2,
            null,
            { timeout: 5000 },
          )
          .then(() => true);
      })
      .catch(() => false);
    check('the MOVE bar lights up when full; a tap fires the move on the host', moveOk, moveNote);
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
      for (let i = 0; i < 60 * 400 && !ses.s.humans.every((k) => k.finished); i++) window.__tk.advance(1 / 60);
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
    // D68: the highlight replay plays on the host; every phone shows SKIP, and any racer can skip it
    let replayOk = false,
      replayNote = '';
    try {
      await host.waitForFunction(() => window.__tk.state().stage === 'replay', null, { timeout: 15000 });
      await aPortrait.waitForSelector('#replayCard:not([hidden])', { timeout: 5000 });
      await b2p.waitForSelector('#replayCard:not([hidden])', { timeout: 5000 });
      await host.waitForTimeout(2500);
      replayNote = (await host.textContent('.replayCap b')) ?? '';
      await host.screenshot({ path: path.join(OUT, 'host-replay.png') });
      await b2p.screenshot({ path: path.join(OUT, 'phone-replay.png') });
      await b2p.click('#skipBtn');
      await host.waitForFunction(() => window.__tk.state().stage === 'podium', null, { timeout: 8000 });
      replayOk = replayNote.length > 0;
    } catch (e) {
      replayNote += ` (${(e as Error).message.split(/\r?\n/)[0]})`;
    }
    check('the race highlights replay on the host, and a phone skips to the podium', replayOk, replayNote);
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

    // phase 12: the leader sets up a 1-lap Grand Prix on the phone and the four races run with points
    await host.keyboard.press('Escape');
    await aPortrait.waitForSelector('#wait:not([hidden])', { timeout: 10000 });

    // D72: the phone garage: paint, livery, sticker, rims and a speed-for-handling tune; the host follows
    await aPortrait.setViewportSize({ width: 393, height: 852 });
    await aPortrait.click('#garageBtn');
    await aPortrait.waitForSelector('#garage:not([hidden])', { timeout: 5000 });
    await aPortrait.click('#gPaint button:nth-child(8)');
    await aPortrait.click('#gAccent button:nth-child(12)');
    await aPortrait.click('#gLivery button[data-v="flames"]');
    await aPortrait.click('#gSticker button[data-v="crown"]');
    await aPortrait.click('#gRims button:nth-child(3)');
    for (let i = 0; i < 2; i++) await aPortrait.click('.tRow[data-k="speed"] button[data-d="1"]');
    const midTune = (await aPortrait.textContent('#gFree')) ?? '';
    const doneLocked = await aPortrait.isDisabled('#garageDone');
    for (let i = 0; i < 2; i++) await aPortrait.click('.tRow[data-k="handling"] button[data-d="-1"]');
    await aPortrait.waitForTimeout(1500);
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-garage.png') });
    await aPortrait.locator('#garageView').scrollIntoViewIfNeeded();
    await aPortrait.waitForTimeout(300);
    await aPortrait.screenshot({ path: path.join(OUT, 'phone-garage-top.png') });
    await aPortrait.click('#garageDone');
    const garageOk = await host
      .waitForFunction(
        () => {
          const p = (
            window.__tk.lobby() as unknown as {
              players: {
                slot: number;
                setup: {
                  paint: number;
                  livery: string;
                  sticker: string;
                  rims: number;
                  tune: { speed: number; handling: number };
                };
              }[];
            }
          ).players.find((x) => x.slot === 0);
          const s = p?.setup;
          return (
            !!s &&
            s.paint === 7 &&
            s.livery === 'flames' &&
            s.sticker === 'crown' &&
            s.rims === 2 &&
            s.tune.speed === 2 &&
            s.tune.handling === -2
          );
        },
        null,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
    await host.waitForTimeout(1500);
    await host.screenshot({ path: path.join(OUT, 'host-lobby-garage.png') });
    await aPortrait.setViewportSize({ width: 852, height: 393 });
    check(
      'the phone garage styles and tunes the kart; Done waits for a balanced tune; the host has it',
      garageOk && doneLocked && /take/i.test(midTune),
      midTune,
    );
    await aPortrait.click('#cfgLaps button[data-v="1"]');
    await aPortrait.click('#cfgMode button[data-v="gp"]');
    const cfgOk = await host
      .waitForFunction(
        () => {
          const c = (window.__tk.lobby() as unknown as { config: { mode: string; laps: number } }).config;
          return c.mode === 'gp' && c.laps === 1;
        },
        null,
        { timeout: 5000 },
      )
      .then(() => true)
      .catch(() => false);
    check('the leader sets mode and laps on the phone; the host follows', cfgOk);
    // D71: the leader picks a sky on the phone; the host's lobby preview changes to it; then back to Random
    await aPortrait.click('#cfgSky button[data-v="night"]');
    const skyOk = await host
      .waitForFunction(
        () => {
          const c = (window.__tk.lobby() as unknown as { config: { weather: string } }).config;
          const ses = window.__tk.session() as unknown as { s: { weather: string } } | null;
          return c.weather === 'night' && ses?.s.weather === 'night';
        },
        null,
        { timeout: 8000 },
      )
      .then(() => true)
      .catch(() => false);
    const skyText = (await aPortrait.textContent('#cfgSummary')) ?? '';
    await host.waitForTimeout(800);
    await host.screenshot({ path: path.join(OUT, 'host-lobby-night.png') });
    await aPortrait.click('#cfgSky button[data-v="random"]');
    check('the leader picks Night on the phone; the host preview turns to night', skyOk, skyText.split(' · ').at(-1));
    // D73: the Track events switch on the phone reaches the host (off, then back on for the Grand Prix)
    await aPortrait.click('#cfgEvents');
    const evOff = await host
      .waitForFunction(() => !(window.__tk.lobby() as unknown as { config: { events: boolean } }).config.events, null, {
        timeout: 5000,
      })
      .then(() => true)
      .catch(() => false);
    await aPortrait.click('#cfgEvents');
    const evOn = await host
      .waitForFunction(() => (window.__tk.lobby() as unknown as { config: { events: boolean } }).config.events, null, {
        timeout: 5000,
      })
      .then(() => true)
      .catch(() => false);
    const finishRace = (): Promise<string> =>
      host.evaluate(() => {
        const ses = window.__tk.session() as unknown as {
          game: { setHumanAi(slot: number, on: boolean): void; startCountdown(): void };
          skipIntro(): void;
          s: { track: { id: string }; weather: string; humans: { slot: number; finished: boolean }[] };
        };
        ses.skipIntro();
        for (const k of ses.s.humans) ses.game.setHumanAi(k.slot, true);
        for (let i = 0; i < 60 * 400 && !ses.s.humans.every((k) => k.finished); i++) window.__tk.advance(1 / 60);
        return `${ses.s.track.id}:${ses.s.weather}`;
      });
    const tracks: string[] = [],
      skies: string[] = [];
    let gpOk = true,
      gpNote = '';
    await aPortrait.click('#startBtn');
    for (let r = 0; r < 4; r++) {
      // D67: the next race is built behind a fade, so wait for it to start (not just for "in a race", which the
      // finished race still is during the fade)
      await host.waitForFunction(
        () => window.__tk.state().inRace && ['intro', 'racing'].includes(window.__tk.state().stage),
        null,
        { timeout: 10000 },
      );
      if (r === 0) {
        // D73: the race has its track event planned (sheep on Sunny Meadows)
        const hz = await host.evaluate(() =>
          (window.__tk.session() as unknown as { s: { hazards: { kind: string }[] } }).s.hazards.map((h) => h.kind),
        );
        check(
          'Track events: the phone switch reaches the host; the race has its event',
          evOff && evOn && hz[0] === 'sheep',
          hz.join(', '),
        );
        // D72: the garage tune is on the kart: two points from handling into speed
        const k = await host.evaluate(() => {
          const ses = window.__tk.session() as unknown as {
            s: { humans: { slot: number; ch: { id: string; stats: { speed: number; handling: number } } }[] };
          };
          const h = ses.s.humans.find((x) => x.slot === 0)!;
          return { id: h.ch.id, speed: h.ch.stats.speed, handling: h.ch.stats.handling };
        });
        const base = CHARS.find((c) => c.id === k.id)!.stats;
        check(
          'the garage tune is on the kart in the race',
          Math.abs(k.speed - (base.speed + 2 * TUNE_WEIGHT.speed)) < 1e-6 &&
            Math.abs(k.handling - Math.max(0, base.handling - 2 * TUNE_WEIGHT.handling)) < 1e-6,
          `${k.id}: speed ${base.speed}→${k.speed}, handling ${base.handling}→${k.handling}`,
        );
      }
      const [tid, sky] = (await finishRace()).split(':') as [string, string];
      tracks.push(tid);
      skies.push(sky);
      await aPortrait.waitForSelector('#replayCard:not([hidden])', { timeout: 20000 });
      await aPortrait.click('#skipBtn');
      await aPortrait.waitForSelector('#results:not([hidden])', { timeout: 20000 });
      await aPortrait.waitForSelector('#gpBox:not([hidden])', { timeout: 5000 });
      const head = (await aPortrait.textContent('#gpHead')) ?? '',
        btn = (await aPortrait.textContent('#againBtn')) ?? '';
      const want = r < 3 ? `AFTER RACE ${r + 1} OF 4` : 'FINAL';
      if (!head.includes(want) || btn !== (r < 3 ? 'NEXT RACE' : 'NEW GRAND PRIX')) {
        gpOk = false;
        gpNote = `race ${r + 1}: "${head}" / "${btn}"`;
      }
      if (r === 3) {
        await aPortrait.screenshot({ path: path.join(OUT, 'phone-gp-final.png') });
        await host.waitForTimeout(2500);
        await host.screenshot({ path: path.join(OUT, 'host-gp-final.png') });
      } else await aPortrait.click('#againBtn');
    }
    const trophy = await host.evaluate(() => (window.__tk.session() as unknown as { trophy: boolean }).trophy);
    check(
      'a 4-race Grand Prix: points after each race, NEXT RACE, final standings and the trophy',
      gpOk && trophy && tracks.join(',') === 'meadows,canyon,frosty,sepang',
      gpNote || tracks.join(' → '),
    );
    // D71: a Random sky rolls each race's weather (snow only on Frosty Peaks)
    check(
      'Random sky: every Grand Prix race rolls its own weather',
      skies.length === 4 &&
        skies.every((w, i) => ['day', 'sunset', 'night', 'rain', 'snow'].includes(w) && (w !== 'snow' || i === 2)),
      tracks.map((t, i) => `${t} ${skies[i]}`).join(', '),
    );

    // D69 Bumper Brawl: the leader picks Brawl (arenas only, no laps), the round runs with lives on every phone,
    // and the last kart standing wins
    let brawlOk = false,
      brawlNote = '';
    try {
      await aPortrait.click('#lobbyBtn');
      await aPortrait.waitForSelector('#wait:not([hidden])', { timeout: 10000 });
      await aPortrait.click('#cfgMode button[data-v="brawl"]');
      await host.waitForFunction(
        () => {
          const c = (window.__tk.lobby() as unknown as { config: { mode: string; trackId: string } }).config;
          return c.mode === 'brawl' && c.trackId.startsWith('arena-');
        },
        null,
        { timeout: 5000 },
      );
      const arenasOnly = await aPortrait.evaluate(() =>
        Array.from(document.querySelectorAll<HTMLElement>('#cfgTrack button')).every(
          (b) => b.hidden !== b.dataset.v!.startsWith('arena-'),
        ),
      );
      brawlNote = 'start';
      await aPortrait.click('#startBtn');
      await host.waitForFunction(() => ['intro', 'racing'].includes(window.__tk.state().stage), null, {
        timeout: 15000,
      });
      brawlNote = 'hearts';
      await host.keyboard.press(' ');
      await aPortrait.waitForFunction(() => /♥/.test(document.getElementById('sLap')?.textContent ?? ''), null, {
        timeout: 15000,
      });
      const hearts = (await aPortrait.textContent('#sLap')) ?? '';
      await host.waitForTimeout(3000);
      await host.screenshot({ path: path.join(OUT, 'host-brawl.png') });
      await aPortrait.screenshot({ path: path.join(OUT, 'phone-brawl.png') });
      const mode = await host.evaluate(
        () => (window.__tk.session() as unknown as { s: { mode: string; track: { id: string } } }).s,
      );
      // play it out: every kart AI-driven, until the round ends
      await host.evaluate(() => {
        const ses = window.__tk.session() as unknown as {
          game: { setHumanAi(slot: number, on: boolean): void };
          s: { phase: string; humans: { slot: number }[] };
        };
        for (const k of ses.s.humans) ses.game.setHumanAi(k.slot, true);
        for (let i = 0; i < 60 * 200 && ses.s.phase !== 'finished'; i++) window.__tk.advance(1 / 60);
      });
      await aPortrait.waitForSelector('#replayCard:not([hidden]), #results:not([hidden])', { timeout: 20000 });
      if (await aPortrait.isVisible('#replayCard')) await aPortrait.click('#skipBtn');
      await aPortrait.waitForSelector('#results:not([hidden])', { timeout: 20000 });
      const winner = await host.evaluate(() => {
        const s = (window.__tk.session() as unknown as { s: { standings: { out: boolean; lives: number }[] | null } })
          .s;
        return s.standings ? { out: s.standings[0]!.out, lives: s.standings[0]!.lives } : null;
      });
      brawlNote = `${mode.track.id}, phone "${hearts}", winner ${winner ? `♥${winner.lives}` : '?'}`;
      brawlOk = arenasOnly && mode.mode === 'brawl' && /♥/.test(hearts) && !!winner && !winner.out;
    } catch (e) {
      brawlNote += ` (${(e as Error).message.split(/\r?\n/)[0]})`;
    }
    check(
      'Bumper Brawl: Brawl on the phone, an arena, lives on the phones, a winner still standing',
      brawlOk,
      brawlNote,
    );

    const b2pOrB = (): typeof aPortrait => b2p;
    // D82: the leader sets the number of AI bots on the phone, then pauses mid-race and goes back to the lobby
    let botsOk = false,
      botsNote = '';
    try {
      await aPortrait.click('#lobbyBtn');
      await aPortrait.waitForSelector('#wait:not([hidden])', { timeout: 15000 });
      await aPortrait.click('#cfgMode button[data-v="single"]');
      for (let i = 0; i < 6; i++) {
        const n = Number((await aPortrait.textContent('#cfgAi')) ?? '0');
        if (n === 2) break;
        await aPortrait.click(n > 2 ? '#cfgAiDn' : '#cfgAiUp');
        await aPortrait.waitForTimeout(250);
      }
      const cfgAi = await host
        .waitForFunction(
          () => (window.__tk.lobby() as unknown as { config: { aiCount: number } }).config.aiCount === 2,
          null,
          { timeout: 5000 },
        )
        .then(() => true)
        .catch(() => false);
      await aPortrait.locator('#cfgAi').scrollIntoViewIfNeeded();
      await aPortrait.screenshot({ path: path.join(OUT, 'phone-ai-bots.png') });
      botsNote = 'start';
      await aPortrait.click('#startBtn');
      await host.waitForFunction(() => ['intro', 'racing'].includes(window.__tk.state().stage), null, {
        timeout: 15000,
      });
      await host.keyboard.press(' ');
      await host.waitForFunction(() => window.__tk.state().stage === 'racing', null, { timeout: 10000 });
      const karts = await host.evaluate(
        () =>
          (window.__tk.session() as unknown as { s: { karts: { slot: number | null }[] } }).s.karts.filter(
            (k) => k.slot === null,
          ).length,
      );
      botsNote = `${karts} AI karts`;
      // pause from the phone, then BACK TO LOBBY on the pause card
      await aPortrait.click('#menuBtn');
      await aPortrait.waitForSelector('#pauseSheet:not([hidden])', { timeout: 8000 });
      await aPortrait.waitForTimeout(400);
      await aPortrait.screenshot({ path: path.join(OUT, 'phone-pause-lobby.png') });
      const nonLeaderNote = await b2pOrB().isVisible('#pauseLobbyNote');
      await aPortrait.click('#pauseLobby');
      await host.waitForFunction(() => !window.__tk.state().inRace, null, { timeout: 10000 });
      await aPortrait.waitForSelector('#wait:not([hidden])', { timeout: 10000 });
      botsNote += `, back in the lobby${nonLeaderNote ? ', others told the leader can end it' : ''}`;
      botsOk = cfgAi && karts === 2 && nonLeaderNote;
    } catch (e) {
      botsNote += ` (${(e as Error).message.split(/\r?\n/)[0]})`;
    }
    check('the leader sets 2 AI bots; pause mid-race and BACK TO LOBBY on the phone', botsOk, botsNote);

    // D83: the leader turns the fun zones off and on from the phone; a race with them builds the cones, target and tunnel
    let zonesOk = false,
      zonesNote = '';
    try {
      const cfgZones = (): Promise<boolean> =>
        host.evaluate(() => (window.__tk.lobby() as unknown as { config: { zones: boolean } }).config.zones);
      const before = await cfgZones();
      await aPortrait.click('#cfgZones');
      await host.waitForFunction(
        (b) => (window.__tk.lobby() as unknown as { config: { zones: boolean } }).config.zones !== b,
        before,
        { timeout: 5000 },
      );
      await aPortrait.click('#cfgZones');
      await host.waitForFunction(
        (b) => (window.__tk.lobby() as unknown as { config: { zones: boolean } }).config.zones === b,
        before,
        { timeout: 5000 },
      );
      zonesNote = `toggle ${before ? 'on→off→on' : 'off→on→off'}`;
      await host.evaluate(() => window.__tk.race({ seed: 4, track: 'frosty', zones: true, laps: 1, diff: 'easy' }));
      await host.waitForFunction(() => window.__tk.state().stage === 'racing', null, { timeout: 15000 });
      const z = await host.evaluate(() => {
        const ses = window.__tk.session() as unknown as {
          s: { zones: { slalom: { cones: unknown[] } | null; target: unknown; tunnel: unknown } | null };
        };
        const w = window.__tk.world() as unknown as { zoneFx: { group: { children: unknown[] } } | null };
        const z = ses.s.zones;
        return {
          cones: z?.slalom?.cones.length ?? 0,
          target: !!z?.target,
          tunnel: !!z?.tunnel,
          parts: w.zoneFx?.group.children.length ?? 0,
        };
      });
      await host.evaluate(() => window.__tk.advance(20));
      zonesNote += `, ${z.cones} cones, target ${z.target ? 'yes' : 'no'}, tunnel ${z.tunnel ? 'yes' : 'no'}, ${z.parts} meshes`;
      zonesOk = before && z.cones === 8 && z.target && z.tunnel && z.parts > 5;
    } catch (e) {
      zonesNote += ` (${(e as Error).message.split(String.fromCharCode(10))[0]})`;
    }
    check(
      'the leader toggles Fun zones on the phone; a race builds the slalom, jump target and draft tunnel',
      zonesOk,
      zonesNote,
    );

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
