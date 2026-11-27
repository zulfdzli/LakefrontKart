/**
 * Headless gameplay metrics for the polish loop (section 13): lap times per difficulty and character,
 * AI gaps, rescues, items used, longest stuck time and simulation cost.
 *
 *   npm run sim-report                       (Sunny Meadows, 20 races per row)
 *   npm run sim-report -- --track canyon     (meadows | canyon | frosty | proto)
 *   npm run sim-report -- --races 50 --json docs/sim-report.json
 *   npm run sim-report -- --track canyon --weather rain   (D71: day | sunset | night | rain | snow)
 *   npm run sim-report -- --moves                          (D74: signature moves on)
 *   npm run sim-report -- --events                         (D73: the track's living event on)
 *   npm run sim-report -- --zones                          (D83: the fun zones on)
 *   npm run sim-report -- --tune 2,0,-2                    (D72: the test driver's garage tune: speed,accel,handling)
 */
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  CHARS,
  createGame,
  getTrack,
  isTrackId,
  STEP,
  type Difficulty,
  type Game,
  type Track,
  type Weather,
} from '@tk/shared';

const args = process.argv.slice(2);
const arg = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : def;
};
const RACES = Number(arg('races', '20'));
const TRACK_ID = arg('track', 'meadows');
const TRACK: Track | undefined = isTrackId(TRACK_ID) ? getTrack(TRACK_ID) : undefined;
const LAPS = Number(arg('laps', TRACK ? '2' : '3'));
const JSON_OUT = arg('json', '');
const WEATHER = arg('weather', 'day') as Weather;
const [tS, tA, tH] = arg('tune', '0,0,0').split(',').map(Number) as [number, number, number];
const TUNE = { speed: tS, accel: tA, handling: tH };
const EVENTS = args.includes('--events');
const MOVES = args.includes('--moves');
/** D83: the fun zones on. */
const ZONES = args.includes('--zones');
/** The steady test driver from section 11.1. */
const DRIVER_SKILL = 0.93;

const median = (a: number[]): number => (a.length ? [...a].sort((x, y) => x - y)[a.length >> 1]! : NaN);
const mean = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const pct = (a: number, b: number): string => `${(((a - b) / b) * 100).toFixed(1)}%`;

interface RaceStats {
  driverLaps: number[];
  aiLaps: number[];
  driverPlace: number;
  rescues: number;
  missedGates: number;
  jumps: number;
  unfinished: number;
  itemsUsed: number;
  maxStuck: number;
  stepMs: number[];
}

function race(seed: number, diff: Difficulty, itemsOn: boolean, ci: number): RaceStats {
  const g: Game = createGame({
    seed,
    humans: [{ slot: 0, ci, tune: TUNE }],
    aiFill: true,
    laps: LAPS,
    difficulty: diff,
    itemsOn,
    raceEndGrace: 1e9,
    weather: WEATHER,
    events: EVENTS,
    moves: MOVES,
    zones: ZONES,
    ...(TRACK ? { track: TRACK } : {}),
  });
  g.setHumanAi(0, true);
  const s = g.getSnapshot();
  s.humans[0]!.aiCfg.skill = DRIVER_SKILL;
  g.startCountdown();
  let rescues = 0,
    itemsUsed = 0,
    missedGates = 0,
    jumps = 0;
  const stuck = new Map<number, number>();
  let maxStuck = 0;
  const stepMs: number[] = [];
  for (let i = 0; i < 60 * 60 * 15; i++) {
    const t0 = performance.now();
    g.step(STEP);
    stepMs.push(performance.now() - t0);
    for (const e of g.drainEvents()) {
      if (e.type === 'rescue') rescues++;
      if (e.type === 'missedgate') missedGates++;
      if (e.type === 'jump') jumps++;
      if (e.type.startsWith('use')) itemsUsed++;
    }
    if (s.phase === 'race' || s.phase === 'finished') {
      for (const k of s.karts) {
        if (k.finished) continue;
        const t = Math.abs(k.sp) < 3 && k.rescue <= 0 && k.spin <= 0 ? (stuck.get(k.id) ?? 0) + STEP : 0;
        stuck.set(k.id, t);
        if (t > maxStuck) maxStuck = t;
      }
    }
    if (s.karts.every((k) => k.finished)) break;
  }
  const me = s.humans[0]!;
  return {
    driverLaps: me.lapTimes,
    aiLaps: s.karts.filter((k) => k.slot === null).flatMap((k) => k.lapTimes),
    driverPlace: me.rank + 1,
    rescues,
    missedGates,
    jumps,
    unfinished: s.karts.filter((k) => !k.finished).length,
    itemsUsed,
    maxStuck,
    stepMs,
  };
}

const track = createGame({
  seed: 1,
  humans: [],
  aiFill: true,
  laps: 1,
  difficulty: 'normal',
  itemsOn: false,
  ...(TRACK ? { track: TRACK } : {}),
}).getSnapshot().track;
const out: Record<string, unknown> = {
  track: track.id,
  trackLengthM: Math.round(track.LEN),
  samples: track.N,
  races: RACES,
  laps: LAPS,
};
console.log(
  `\nTrack: ${track.id}, ${Math.round(track.LEN)} m, ${track.N} samples · ${RACES} races per row · ${LAPS} laps · test driver skill ${DRIVER_SKILL}\n`,
);

const rows: Record<string, unknown>[] = [];
const aiMedian: Record<string, number> = {};
const allStep: number[] = [];
console.log('items  diff    driver lap  AI lap   driver place  rescues/race  items/race  unfinished  max stuck');
for (const itemsOn of [false, true]) {
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const R: RaceStats[] = [];
    for (let seed = 1; seed <= RACES; seed++) R.push(race(seed, diff, itemsOn, 1));
    const row = {
      items: itemsOn,
      diff,
      driverLap: median(R.flatMap((r) => r.driverLaps)),
      aiLap: median(R.flatMap((r) => r.aiLaps)),
      driverPlace: mean(R.map((r) => r.driverPlace)),
      rescuesPerRace: mean(R.map((r) => r.rescues)),
      itemsPerRace: mean(R.map((r) => r.itemsUsed)),
      unfinished: R.reduce((a, r) => a + r.unfinished, 0),
      maxStuck: Math.max(...R.map((r) => r.maxStuck)),
      missedGates: R.reduce((a, r) => a + r.missedGates, 0),
      jumpsPerRace: mean(R.map((r) => r.jumps)),
    };
    for (const r of R) allStep.push(...r.stepMs);
    if (!itemsOn) aiMedian[diff] = row.aiLap;
    rows.push(row);
    console.log(
      `${itemsOn ? 'on ' : 'off'}    ${diff.padEnd(7)} ${row.driverLap.toFixed(1).padStart(7)} s  ${row.aiLap.toFixed(1).padStart(5)} s  ${row.driverPlace.toFixed(2).padStart(9)}     ${row.rescuesPerRace.toFixed(2).padStart(8)}      ${row.itemsPerRace.toFixed(1).padStart(6)}      ${String(row.unfinished).padStart(5)}      ${row.maxStuck.toFixed(1)} s${row.missedGates ? `  missed gates ${row.missedGates}` : ''}`,
    );
  }
}
out.rows = rows;

const gapEN = (aiMedian.easy! - aiMedian.normal!) / aiMedian.normal!;
const gapNH = (aiMedian.normal! - aiMedian.hard!) / aiMedian.hard!;
console.log(
  `\nAI gaps (items off): Easy→Normal ${pct(aiMedian.easy!, aiMedian.normal!)}, Normal→Hard ${pct(aiMedian.normal!, aiMedian.hard!)}  (target ≥ 3% each)`,
);
out.aiGaps = { easyNormal: gapEN, normalHard: gapNH };

const perChar: Record<string, number> = {};
for (let ci = 0; ci < CHARS.length; ci++) {
  const laps: number[] = [];
  for (let seed = 1; seed <= Math.max(6, Math.round(RACES / 2)); seed++)
    laps.push(...race(seed, 'normal', false, ci).driverLaps);
  perChar[CHARS[ci]!.id] = median(laps);
}
const pv = Object.values(perChar);
const spread = Math.max(...pv) / Math.min(...pv) - 1;
console.log(
  `\nCharacter medians (test driver, Normal, items off): ${Object.entries(perChar)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(' · ')}`,
);
console.log(`Character spread: ${(spread * 100).toFixed(2)}%  (target ≤ 4%)`);
out.perCharacter = perChar;
out.characterSpread = spread;

allStep.sort((a, b) => a - b);
const simCost = { meanMs: mean(allStep), p99Ms: allStep[Math.floor(allStep.length * 0.99)]! };
console.log(
  `\nSimulation cost per step (6 karts): mean ${simCost.meanMs.toFixed(3)} ms, p99 ${simCost.p99Ms.toFixed(3)} ms  (budget 2 ms)\n`,
);
out.simCost = simCost;

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(out, null, 2));
  console.log(`Wrote ${JSON_OUT}`);
}
