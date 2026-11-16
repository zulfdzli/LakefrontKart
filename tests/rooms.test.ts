import { describe, expect, it } from 'vitest';
import { RoomManager, LOBBY_GRACE_MS, HOST_GONE_MS } from '../server/src/rooms';

function setup() {
  let t = 1_000_000;
  const rm = new RoomManager(() => t);
  const room = rm.createRoom('host-1');
  return { rm, room, advance: (ms: number) => (t += ms) };
}

describe('rooms', () => {
  it('creates 4-letter codes without I, O, 0 or 1', () => {
    const { rm } = setup();
    for (let i = 0; i < 200; i++) expect(rm.createRoom('h' + i).code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });

  it('assigns slots in order and rejects a 6th player with room-full', () => {
    const { rm, room } = setup();
    for (let i = 0; i < 5; i++) {
      const r = rm.join(room.code, 'P' + i, undefined, 's' + i);
      expect(r.ok && r.data.slot).toBe(i);
    }
    const sixth = rm.join(room.code, 'P6', undefined, 's6');
    expect(sixth).toEqual({ ok: false, reason: 'room-full' });
  });

  it('accepts lowercase codes and rejects unknown ones', () => {
    const { rm, room } = setup();
    expect(rm.join(room.code.toLowerCase(), 'Zul', undefined, 's').ok).toBe(true);
    expect(rm.join('ZZZZ', 'Zul', undefined, 's2')).toEqual({ ok: false, reason: 'room-not-found' });
    expect(rm.join(42, 'Zul', undefined, 's3')).toEqual({ ok: false, reason: 'room-not-found' });
  });

  it('reconnecting with the same playerToken returns the same slot, even mid-race', () => {
    const { rm, room } = setup();
    rm.join(room.code, 'A', undefined, 'a');
    const b = rm.join(room.code, 'B', 'token-of-bee-123', 'b');
    expect(b.ok && b.data.slot).toBe(1);
    rm.disconnect('b');
    rm.setPhase(room, 'race');
    const again = rm.join(room.code, 'whatever', 'token-of-bee-123', 'b2');
    expect(again.ok && again.data.slot).toBe(1);
    expect(again.ok && again.resumed).toBe(true);
    expect(room.slots[1]!.connected).toBe(true);
  });

  it('locks joining once the race starts', () => {
    const { rm, room } = setup();
    rm.join(room.code, 'A', undefined, 'a');
    rm.setPhase(room, 'countdown');
    expect(rm.join(room.code, 'B', undefined, 'b')).toEqual({ ok: false, reason: 'race-in-progress' });
  });

  it('rejects a duplicate name and defaults empty names to "Player N"', () => {
    const { rm, room } = setup();
    rm.join(room.code, 'Zul', undefined, 'a');
    expect(rm.join(room.code, 'zul', undefined, 'b')).toEqual({ ok: false, reason: 'name-taken' });
    const r = rm.join(room.code, '   ', undefined, 'c');
    expect(r.ok && r.data.name).toBe('Player 2');
  });

  it('makes the first joiner the leader and passes leadership on', () => {
    const { rm, room } = setup();
    rm.join(room.code, 'A', undefined, 'a');
    rm.join(room.code, 'B', undefined, 'b');
    expect(rm.leader(room)!.name).toBe('A');
    rm.remove(room, 0);
    expect(rm.leader(room)!.name).toBe('B');
  });

  it('gives every player a unique character and refuses a taken one', () => {
    const { rm, room } = setup();
    for (let i = 0; i < 5; i++) rm.join(room.code, 'P' + i, undefined, 's' + i);
    const ids = rm.players(room).map((p) => p.characterId);
    expect(new Set(ids).size).toBe(5);
    const p0 = room.slots[0]!, p1 = room.slots[1]!;
    expect(rm.select(room, p0, p1.characterId)).toBe('taken');
    expect(rm.select(room, p0, 'nobody')).toBe('unknown');
  });

  it('frees a lobby slot after the grace period, but holds it during a race', () => {
    const { rm, room, advance } = setup();
    rm.join(room.code, 'A', undefined, 'a');
    rm.join(room.code, 'B', undefined, 'b');
    rm.disconnect('b');
    advance(LOBBY_GRACE_MS - 1);
    expect(rm.sweep().changed).toHaveLength(0);
    advance(2);
    expect(rm.sweep().changed).toHaveLength(1);
    expect(room.slots[1]).toBeNull();

    rm.setPhase(room, 'race');
    rm.disconnect('a');
    advance(LOBBY_GRACE_MS * 10);
    rm.sweep();
    expect(room.slots[0]).not.toBeNull();
  });

  it('deletes a room 10 minutes after its host leaves, and lets the host resume before that', () => {
    const { rm, room, advance } = setup();
    rm.hostDisconnected(room);
    advance(HOST_GONE_MS - 1000);
    expect(rm.sweep().deleted).toHaveLength(0);
    expect(rm.resumeHost(room.code, 'wrong-token', 'h2')).toBeNull();
    expect(rm.resumeHost(room.code, room.hostToken, 'h2')).toBe(room);
    rm.hostDisconnected(room);
    advance(HOST_GONE_MS);
    expect(rm.sweep().deleted).toEqual([room.code]);
  });

  it('validates leader config values', () => {
    const { rm, room } = setup();
    rm.setConfig(room, { laps: 7, aiDifficulty: 'insane', trackId: 'moon', aiFill: false });
    expect(room.config.laps).toBe(2);
    expect(room.config.aiDifficulty).toBe('normal');
    expect(room.config.trackId).toBe('meadows');
    expect(room.config.aiFill).toBe(false);
  });
});
