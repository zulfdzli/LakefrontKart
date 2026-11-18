/**
 * Regression test: the ported game logic must match the prototype exactly (section 8: "keep a regression
 * test that shows the base handling still feels the same before the tuning changes").
 *
 * It runs the prototype's own //#LOGIC block (extracted from prototype/turbokarts-prototype.html) with
 * Math.random swapped for the same seeded RNG the port uses, next to the port, and compares every kart
 * every step. One human in slot 0, driven by the prototype's autopilot, on the prototype's grid.
 *
 * Phase 11 (tyre model, tuning) changes the handling on purpose. When that happens this test is kept
 * against a frozen copy of the phase 3 logic instead, and a feel-metrics test takes over.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Rng, createGame, PROTOTYPE_GRID, PROTOTYPE_HANDLING, STEP, type Difficulty } from '@tk/shared';

const html = readFileSync(new URL('../prototype/turbokarts-prototype.html', import.meta.url), 'utf8');
const logic = html.split('//#LOGIC-START')[1]!.split('//#LOGIC-END')[0]!;

interface ProtoKart {
  x: number;
  z: number;
  h: number;
  sp: number;
  lap: number;
  finished: boolean;
  finishTime: number;
  rank: number;
  item: string | null;
  boost: number;
  auto: boolean;
}
interface ProtoEvent {
  type: string;
  k?: ProtoKart;
}
interface Proto {
  G: {
    diff: string;
    laps: number;
    playerChar: number;
    karts: ProtoKart[];
    boxes: unknown[];
    phase: string;
    cd: number;
    lastCd: number;
    events: ProtoEvent[];
  };
  resetRace: () => void;
  stepWorld: (dt: number) => void;
}

const makeProto = new Function('Math', `${logic}; return { G, resetRace, stepWorld };`) as (m: Math) => Proto;

interface Case {
  seed: number;
  diff: Difficulty;
  items: boolean;
  pc: number;
}

function runParity(c: Case): { steps: number; finishedAll: boolean } {
  const laps = 3;
  // prototype, with a seeded Math.random
  const pr = new Rng(c.seed);
  const M = Object.create(Math) as Math;
  M.random = () => pr.next();
  const P = makeProto(M);
  P.G.diff = c.diff;
  P.G.laps = laps;
  P.G.playerChar = c.pc;
  P.resetRace();
  if (!c.items) P.G.boxes.length = 0;
  P.G.karts[0]!.auto = true;
  P.G.phase = 'countdown';
  P.G.cd = 3.6;
  P.G.lastCd = 4;

  // port: same seed, one human on the prototype grid, driven by the autopilot
  const g = createGame({
    seed: c.seed,
    humans: [{ slot: 0, ci: c.pc }],
    aiFill: true,
    laps,
    difficulty: c.diff,
    itemsOn: c.items,
    grid: PROTOTYPE_GRID,
    handling: PROTOTYPE_HANDLING,
  });
  g.setHumanAi(0, true);
  g.startCountdown();
  const s = g.getSnapshot();

  let step = 0;
  for (; step < 60 * 400; step++) {
    P.stepWorld(STEP);
    g.step(STEP);
    const pev = P.G.events.map((e) => `${e.type}:${e.k ? P.G.karts.indexOf(e.k) : -1}`);
    P.G.events.length = 0;
    const gev = g
      .drainEvents()
      .filter((e) => e.type !== 'raceover')
      .map((e) => `${e.type}:${e.kart}`);
    if (pev.join() !== gev.join())
      throw new Error(`step ${step}: events differ\nproto: ${pev.join()}\nport:  ${gev.join()}`);
    for (let i = 0; i < 6; i++) {
      const a = P.G.karts[i]!,
        b = s.karts[i]!;
      if (
        a.x !== b.x ||
        a.z !== b.z ||
        a.h !== b.h ||
        a.sp !== b.sp ||
        a.lap !== b.lap ||
        a.finished !== b.finished ||
        a.rank !== b.rank ||
        a.item !== b.item ||
        a.boost !== b.boost
      ) {
        throw new Error(
          `step ${step} kart ${i} differs: proto ${JSON.stringify({ x: a.x, z: a.z, h: a.h, sp: a.sp, lap: a.lap, rank: a.rank, item: a.item })} port ${JSON.stringify({ x: b.x, z: b.z, h: b.h, sp: b.sp, lap: b.lap, rank: b.rank, item: b.item })}`,
        );
      }
    }
    if (P.G.karts.every((k) => k.finished)) break;
  }
  return { steps: step, finishedAll: s.karts.every((k) => k.finished) };
}

describe('port matches the prototype step for step', () => {
  const cases: Case[] = [
    { seed: 1, diff: 'normal', items: true, pc: 1 },
    { seed: 2, diff: 'normal', items: false, pc: 0 },
    { seed: 3, diff: 'easy', items: true, pc: 3 },
    { seed: 4, diff: 'hard', items: true, pc: 5 },
    { seed: 5, diff: 'hard', items: false, pc: 2 },
    { seed: 6, diff: 'easy', items: false, pc: 4 },
  ];
  for (const c of cases) {
    it(`seed ${c.seed}, ${c.diff}, items ${c.items ? 'on' : 'off'}, character ${c.pc}`, () => {
      const r = runParity(c);
      expect(r.finishedAll).toBe(true);
      expect(r.steps).toBeGreaterThan(60 * 140); // a real 3-lap race, not an early exit
    });
  }
});
