/**
 * Bot phones (D15): opens N headless phone controllers that join a room and drive, so 2-5 player races can be
 * tested with one real phone.
 *
 *   npm run bots -- --room ABCD --n 3            (join the room shown on your host screen)
 *   npm run bots -- --n 4 --url http://192.168.0.26:3000
 * Stops with Ctrl+C, or after --seconds N.
 */
import { chromium, devices } from 'playwright-core';

const args = process.argv.slice(2);
const arg = (n: string, d: string): string => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : d;
};
const URL_BASE = arg('url', 'http://localhost:3000');
const N = Math.max(1, Math.min(5, Number(arg('n', '2'))));
const ROOM = arg('room', '').toUpperCase();
const SECONDS = Number(arg('seconds', '0'));

async function main(): Promise<void> {
  if (!/^[A-Z2-9]{4}$/.test(ROOM)) {
    console.error('Pass the room code shown on the host screen: npm run bots -- --room ABCD --n 3');
    process.exit(1);
  }
  const browser = await chromium.launch({ channel: 'chrome', headless: !args.includes('--headed') });
  const models = [
    'iPhone 15 Pro landscape',
    'Pixel 7 landscape',
    'iPhone SE landscape',
    'Galaxy S9+ landscape',
    'iPhone 13 landscape',
  ];
  for (let i = 0; i < N; i++) {
    const ctx = await browser.newContext({ ...devices[models[i % models.length]!] });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.error(`bot ${i + 1}:`, e.message));
    await page.goto(`${URL_BASE}/play?room=${ROOM}&bot=1&name=Bot${i + 1}`);
    console.log(`bot ${i + 1} joining ${ROOM} as ${models[i % models.length]}`);
  }
  console.log(`${N} bot phone(s) running. Ctrl+C to stop.`);
  if (SECONDS > 0) {
    await new Promise((r) => setTimeout(r, SECONDS * 1000));
    await browser.close();
  } else process.on('SIGINT', () => void browser.close().then(() => process.exit(0)));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
