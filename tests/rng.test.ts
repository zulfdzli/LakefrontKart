import { describe, expect, it } from 'vitest';
import { Rng, seedFromString, sanitizeInput, isRoomCode, cleanName } from '@tk/shared';

describe('Rng', () => {
  it('replays the same sequence for the same seed', () => {
    const a = new Rng(42), b = new Rng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  it('gives different sequences for different seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });
  it('stays in [0, 1) and is roughly uniform', () => {
    const r = new Rng(seedFromString('turbo'));
    let sum = 0;
    for (let i = 0; i < 20000; i++) { const v = r.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); sum += v; }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
  });
  it('can save and restore its state', () => {
    const r = new Rng(7); r.next(); const s = r.state; const v = r.next();
    r.state = s; expect(r.next()).toBe(v);
  });
});

describe('protocol validation', () => {
  it('rejects malformed input', () => {
    expect(sanitizeInput(null)).toBeNull();
    expect(sanitizeInput({ seq: 1, steer: 'left', throttle: true, brake: false, drift: false, item: null })).toBeNull();
    expect(sanitizeInput({ seq: 1, steer: NaN, throttle: true, brake: false, drift: false, item: null })).toBeNull();
    expect(sanitizeInput({ seq: 1, steer: 0, throttle: true, brake: false, drift: false, item: 'sideways' })).toBeNull();
  });
  it('clamps steering', () => {
    expect(sanitizeInput({ seq: 1, steer: 9, throttle: true, brake: false, drift: false, item: 'back', t: 5 })).toEqual({ seq: 1, steer: 1, throttle: true, brake: false, drift: false, item: 'back', t: 5 });
  });
  it('validates room codes and names', () => {
    expect(isRoomCode('ABCD')).toBe(true);
    expect(isRoomCode('AB0D')).toBe(false);
    expect(isRoomCode('abcd')).toBe(false);
    expect(cleanName('  <b>Zul</b> the great  ', 'P1')).toBe('bZulb the');
    expect(cleanName('', 'Player 2')).toBe('Player 2');
  });
});
