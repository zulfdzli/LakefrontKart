/**
 * D83 fun zones: where each track's zones are, and how often the field does them (per kart per lap), by
 * difficulty: clean slaloms (and missed gates, cones knocked), bullseyes (and near misses), draft-tunnel passes,
 * and what they won. Four seeds × 3 laps per row, items and moves on.
 *
 *   npx tsx tools/zone-report.ts
 */
import { createGame, getTrack, STEP, TRACK_IDS, ZONE_KINDS, type Difficulty } from '@tk/shared';

for (const id of TRACK_IDS) {
  const T = getTrack(id);
  let shown = false;
  for (const diff of ['easy', 'normal', 'hard'] as Difficulty[]) {
    const c = { slalom: 0, target: 0, tunnel: 0, gate: 0, near: 0, cone: 0, laps: 0, item: 0, meter: 0 };
    for (let seed = 1; seed <= 4; seed++) {
      const g = createGame({
        seed,
        humans: [{ slot: 0, ci: 0 }],
        aiFill: true,
        laps: 3,
        difficulty: diff,
        itemsOn: true,
        moves: true,
        zones: true,
        raceEndGrace: 1e9,
        track: T,
      });
      g.setHumanAi(0, true);
      const s = g.getSnapshot();
      const z = s.zones;
      if (!shown && z) {
        shown = true;
        const f = (i: number): string => (i / T.N).toFixed(3);
        const tg = z.target;
        console.log(
          `${id}: slalom at ${z.slalom ? f(z.slalom.gates[0]!.idx) : '-'}, target at ${
            tg
              ? `${f(tg.idx)} (${(((tg.idx - tg.lip + T.N) % T.N) * T.DS).toFixed(0)} m past the lip, ${tg.lat.toFixed(1)} m across)`
              : '-'
          }, tunnel ${z.tunnel ? `${f(z.tunnel.i0)}-${f(z.tunnel.i1)}` : '-'}`,
        );
      }
      g.startCountdown();
      for (let i = 0; i < 60 * 60 * 8; i++) {
        g.step(STEP);
        for (const e of g.drainEvents()) {
          if (e.type === 'zone') {
            c[ZONE_KINDS[e.n ?? 0]!]++;
            if (e.lvl === 1) c.item++;
            if (e.lvl === 2) c.meter++;
          }
          if (e.type === 'zonemiss') c[e.n === 1 ? 'near' : 'gate']++;
          if (e.type === 'cone') c.cone++;
        }
        if (s.karts.every((k) => k.finished)) break;
      }
      c.laps += s.karts.length * 3;
    }
    const r = (n: number): string => (n / c.laps).toFixed(2);
    console.log(
      `  ${diff.padEnd(6)} slalom ${r(c.slalom)} (missed a gate ${r(c.gate)}, cones ${r(c.cone)}) · target ${r(c.target)} (near ${r(c.near)}) · tunnel passes ${r(c.tunnel)} · won: ${c.item} items, ${c.meter} meter`,
    );
  }
}
