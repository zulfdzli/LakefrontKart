/** Grand Prix scoring (section 12.6, D48). */
import { describe, expect, it } from 'vitest';
import { GP_POINTS, gpTable, newGp, scoreRace, type Standing } from '@tk/shared';

const st = (names: string[]): Standing[] =>
  names.map((n) => ({
    slot: n.startsWith('P') ? Number(n.slice(1)) : null,
    name: n,
    color: '#fff',
    characterId: n.toLowerCase(),
    time: 100,
    bestLap: 50,
  }));

describe('Grand Prix', () => {
  it('awards 15/12/10/8/6/4, carries totals across races and finishes after the last track', () => {
    const gp = newGp(['meadows', 'canyon', 'frosty', 'sepang']);
    const r1 = scoreRace(gp, st(['P0', 'Bruno', 'P1', 'Gus', 'Luna', 'Mochi']));
    expect(r1.map((s) => s.points)).toEqual([...GP_POINTS]);
    expect(gp.done).toBe(false);
    for (let r = 1; r < 4; r++) {
      gp.race = r;
      scoreRace(gp, st(['P1', 'P0', 'Bruno', 'Gus', 'Luna', 'Mochi']));
    }
    expect(gp.done).toBe(true);
    const t = gpTable(gp);
    // P1: 10 + 15×3 = 55; P0: 15 + 12×3 = 51; Bruno: 12 + 10×3 = 42
    expect(t.slice(0, 3).map((e) => [e.name, e.points])).toEqual([
      ['P1', 55],
      ['P0', 51],
      ['Bruno', 42],
    ]);
  });

  it('breaks a points tie by best finish, then by the latest race', () => {
    const gp = newGp(['meadows', 'canyon']);
    scoreRace(gp, st(['A', 'B', 'C']));
    gp.race = 1;
    scoreRace(gp, st(['B', 'C', 'A']));
    // A 15 + 10 = 25, B 12 + 15 = 27, C 10 + 12 = 22
    expect(gpTable(gp).map((e) => e.name)).toEqual(['B', 'A', 'C']);
    const tie = newGp(['meadows', 'canyon']);
    scoreRace(tie, st(['A', 'B']));
    tie.race = 1;
    scoreRace(tie, st(['B', 'A']));
    // both 27 points and both won once: the latest race decides
    expect(gpTable(tie).map((e) => [e.name, e.points])).toEqual([
      ['B', 27],
      ['A', 27],
    ]);
  });
});
