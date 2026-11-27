/**
 * D72 garage balance: the steady test driver's median lap with each garage tune (speed, accel, handling points
 * moved), on every race track, against the standard setup. Four characters × 8 seeds × 2 laps per row.
 *
 *   npx tsx tools/tune-report.ts
 */
import { createGame, getTrack, STEP, TRACK_IDS, type Tune } from '@tk/shared';

const TUNES: [number, number, number][] = [
  [0, 0, 0],
  [2, 0, -2],
  [-2, 0, 2],
  [2, -2, 0],
  [-2, 2, 0],
  [0, 2, -2],
  [0, -2, 2],
  [1, 1, -2],
  [-1, -1, 2],
  [2, -1, -1],
];
const median = (a: number[]): number => [...a].sort((x, y) => x - y)[a.length >> 1]!;

const only = process.argv.includes('--tracks') ? process.argv[process.argv.indexOf('--tracks') + 1]!.split(',') : null;
for (const id of TRACK_IDS.filter((t) => !only || only.includes(t))) {
  const T = getTrack(id);
  let base = 0,
    lo = Infinity,
    hi = -Infinity;
  console.log(id);
  for (const [speed, accel, handling] of TUNES) {
    const tune: Tune = { speed, accel, handling },
      laps: number[] = [];
    for (const ci of [0, 1, 3, 4])
      for (let seed = 1; seed <= 8; seed++) {
        const g = createGame({
          seed,
          humans: [{ slot: 0, ci, tune }],
          aiFill: true,
          laps: 2,
          difficulty: 'normal',
          itemsOn: false,
          raceEndGrace: 1e9,
          track: T,
        });
        g.setHumanAi(0, true);
        const k = g.getSnapshot().humans[0]!;
        k.aiCfg.skill = 0.93;
        g.startCountdown();
        for (let n = 0; n < 60 * 400 && !k.finished; n++) g.step(STEP);
        laps.push(...k.lapTimes);
      }
    const m = median(laps);
    if (!base) base = m;
    lo = Math.min(lo, m);
    hi = Math.max(hi, m);
    console.log(`  ${speed},${accel},${handling}: ${m.toFixed(2)} s (${(((m - base) / base) * 100).toFixed(1)}%)`);
  }
  console.log(`  spread ${(((hi - lo) / lo) * 100).toFixed(1)}% (target ≤ 4%)`);
}
