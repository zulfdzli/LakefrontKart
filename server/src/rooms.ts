/**
 * Rooms and player slots. Pure state (no sockets), so it can be unit-tested; index.ts wires it to Socket.IO.
 * The server never simulates the game: it tracks who is in which slot, who leads, and the room's phase.
 */
import { randomBytes, randomInt } from 'node:crypto';
import {
  CHARS,
  MAX_PLAYERS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  SLOT_COLORS,
  TRACK_IDS,
  ARENA_IDS,
  isArenaId,
  cleanName,
  isRoomCode,
  isWeatherSetting,
  AI_MAX,
  cleanSetup,
  defaultSetup,
  type KartSetup,
  type JoinErrorReason,
  type JoinOk,
  type LeaderConfig,
  type LobbyPlayer,
  type LobbyUpdate,
  type Phase,
} from '@tk/shared';

export interface Player {
  id: string;
  token: string;
  slot: number;
  name: string;
  ready: boolean;
  connected: boolean;
  socketId: string | null;
  characterId: string;
  /** D72: the phone garage's setup. */
  setup: KartSetup;
  /** Join order, for leader succession. */
  joinedAt: number;
  /** When the phone dropped (ms), for the lobby grace period. */
  droppedAt: number | null;
}

export interface Room {
  code: string;
  hostToken: string;
  hostSocketId: string | null;
  hostDroppedAt: number | null;
  phase: Phase;
  slots: (Player | null)[];
  config: LeaderConfig;
  joinCounter: number;
  /** Who paused the race, while phase is 'paused'. */
  pausedBy: string | null;
}

export const DEFAULT_CONFIG: LeaderConfig = {
  mode: 'single',
  trackId: 'meadows',
  gpOrder: ['meadows', 'canyon', 'frosty', 'sepang'],
  laps: 2,
  aiFill: true,
  aiCount: 5,
  aiDifficulty: 'normal',
  itemsOn: true,
  weather: 'random',
  events: true,
  zones: true,
  moves: true,
};

/** A phone that drops in the lobby keeps its slot this long before it is freed. */
export const LOBBY_GRACE_MS = 30_000;
/** A room is deleted this long after its host disconnects (section 5.2). */
export const HOST_GONE_MS = 10 * 60_000;

export type JoinResult =
  { ok: true; data: JoinOk; player: Player; resumed: boolean } | { ok: false; reason: JoinErrorReason };

const token = (): string => randomBytes(12).toString('base64url');

export class RoomManager {
  readonly rooms = new Map<string, Room>();

  constructor(private readonly now: () => number = Date.now) {}

  private newCode(): string {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let c = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) c += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      if (!this.rooms.has(c)) return c;
    }
    throw new Error('no free room code');
  }

  createRoom(hostSocketId: string): Room {
    const room: Room = {
      code: this.newCode(),
      hostToken: token(),
      hostSocketId,
      hostDroppedAt: null,
      phase: 'lobby',
      slots: new Array<Player | null>(MAX_PLAYERS).fill(null),
      config: { ...DEFAULT_CONFIG, gpOrder: [...DEFAULT_CONFIG.gpOrder] },
      joinCounter: 0,
      pausedBy: null,
    };
    this.rooms.set(room.code, room);
    return room;
  }

  resumeHost(code: unknown, hostToken: unknown, hostSocketId: string): Room | null {
    if (!isRoomCode(code) || typeof hostToken !== 'string') return null;
    const room = this.rooms.get(code);
    if (!room || room.hostToken !== hostToken) return null;
    room.hostSocketId = hostSocketId;
    room.hostDroppedAt = null;
    return room;
  }

  hostDisconnected(room: Room): void {
    room.hostSocketId = null;
    room.hostDroppedAt = this.now();
  }

  players(room: Room): Player[] {
    return room.slots.filter((p): p is Player => p !== null);
  }

  leader(room: Room): Player | null {
    let best: Player | null = null;
    for (const p of this.players(room)) if (!best || p.joinedAt < best.joinedAt) best = p;
    return best;
  }

  isLeader(room: Room, p: Player): boolean {
    return this.leader(room) === p;
  }

  findBySocket(socketId: string): { room: Room; player: Player } | null {
    for (const room of this.rooms.values())
      for (const p of this.players(room)) if (p.socketId === socketId) return { room, player: p };
    return null;
  }

  private freeCharacter(room: Room, preferIndex: number): string {
    const taken = new Set(this.players(room).map((p) => p.characterId));
    for (let i = 0; i < CHARS.length; i++) {
      const c = CHARS[(preferIndex + i) % CHARS.length]!;
      if (!taken.has(c.id)) return c.id;
    }
    return CHARS[0]!.id;
  }

  join(codeRaw: unknown, nameRaw: unknown, playerToken: unknown, socketId: string): JoinResult {
    const code = typeof codeRaw === 'string' ? codeRaw.trim().toUpperCase() : '';
    if (!isRoomCode(code)) return { ok: false, reason: 'room-not-found' };
    const room = this.rooms.get(code);
    if (!room) return { ok: false, reason: 'room-not-found' };

    // reconnect with the same token: same slot, any phase
    if (typeof playerToken === 'string' && playerToken.length > 0) {
      const p = this.players(room).find((x) => x.token === playerToken);
      if (p) {
        p.socketId = socketId;
        p.connected = true;
        p.droppedAt = null;
        return { ok: true, data: this.joinOk(room, p), player: p, resumed: true };
      }
    }
    if (room.phase !== 'lobby') return { ok: false, reason: 'race-in-progress' };
    const slot = room.slots.findIndex((s) => s === null);
    if (slot < 0) return { ok: false, reason: 'room-full' };
    const name = cleanName(nameRaw, `Player ${slot + 1}`);
    if (this.players(room).some((p) => p.name.toLowerCase() === name.toLowerCase()))
      return { ok: false, reason: 'name-taken' };
    const p: Player = {
      id: token(),
      token: typeof playerToken === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(playerToken) ? playerToken : token(),
      slot,
      name,
      ready: false,
      connected: true,
      socketId,
      characterId: this.freeCharacter(room, slot + 1),
      setup: defaultSetup(slot),
      joinedAt: room.joinCounter++,
      droppedAt: null,
    };
    room.slots[slot] = p;
    return { ok: true, data: this.joinOk(room, p), player: p, resumed: false };
  }

  joinOk(room: Room, p: Player): JoinOk {
    return {
      playerId: p.id,
      playerToken: p.token,
      slot: p.slot,
      color: SLOT_COLORS[p.slot]!,
      name: p.name,
      isLeader: this.isLeader(room, p),
    };
  }

  /** The phone's socket closed. In the lobby the slot is held for LOBBY_GRACE_MS; during a race until it ends. */
  disconnect(socketId: string): { room: Room; player: Player } | null {
    const hit = this.findBySocket(socketId);
    if (!hit) return null;
    hit.player.socketId = null;
    hit.player.connected = false;
    hit.player.droppedAt = this.now();
    hit.player.ready = false;
    return hit;
  }

  /** D72: a garage setup from the phone (lobby only; anything invalid is ignored). */
  setSetup(room: Room, p: Player, raw: unknown): boolean {
    if (room.phase !== 'lobby') return false;
    const s = cleanSetup(raw);
    if (!s) return false;
    p.setup = s;
    return true;
  }

  remove(room: Room, slot: number): Player | null {
    const p = room.slots[slot] ?? null;
    room.slots[slot] = null;
    return p;
  }

  setReady(room: Room, p: Player, ready: unknown): void {
    if (typeof ready === 'boolean' && room.phase === 'lobby') p.ready = ready;
  }

  select(room: Room, p: Player, characterId: unknown): 'ok' | 'taken' | 'unknown' {
    if (typeof characterId !== 'string' || !CHARS.some((c) => c.id === characterId)) return 'unknown';
    if (room.phase !== 'lobby') return 'unknown';
    if (this.players(room).some((x) => x !== p && x.characterId === characterId)) return 'taken';
    p.characterId = characterId;
    return 'ok';
  }

  setConfig(room: Room, raw: unknown): boolean {
    if (typeof raw !== 'object' || raw === null || room.phase !== 'lobby') return false;
    const o = raw as Partial<LeaderConfig>;
    const tracks: readonly string[] = TRACK_IDS;
    const c = room.config;
    if (o.mode === 'single' || o.mode === 'gp' || o.mode === 'brawl') c.mode = o.mode;
    if (typeof o.trackId === 'string' && (tracks.includes(o.trackId) || isArenaId(o.trackId))) c.trackId = o.trackId;
    // D69: a brawl is fought in an arena, a race on a track
    if (c.mode === 'brawl' && !isArenaId(c.trackId)) c.trackId = ARENA_IDS[0]!;
    if (c.mode !== 'brawl' && isArenaId(c.trackId)) c.trackId = TRACK_IDS[0]!;
    if (
      Array.isArray(o.gpOrder) &&
      o.gpOrder.length >= 1 &&
      o.gpOrder.length <= tracks.length &&
      o.gpOrder.every((t) => tracks.includes(t)) &&
      new Set(o.gpOrder).size === o.gpOrder.length
    )
      c.gpOrder = [...o.gpOrder];
    if (o.laps === 1 || o.laps === 2 || o.laps === 3) c.laps = o.laps;
    if (typeof o.aiFill === 'boolean') c.aiFill = o.aiFill;
    // D82: a number of AI karts (none means no AI fill)
    if (typeof o.aiCount === 'number' && Number.isInteger(o.aiCount) && o.aiCount >= 0 && o.aiCount <= AI_MAX) {
      c.aiCount = o.aiCount;
      c.aiFill = o.aiCount > 0;
    }
    if (o.aiDifficulty === 'easy' || o.aiDifficulty === 'normal' || o.aiDifficulty === 'hard')
      c.aiDifficulty = o.aiDifficulty;
    if (typeof o.itemsOn === 'boolean') c.itemsOn = o.itemsOn;
    if (isWeatherSetting(o.weather)) c.weather = o.weather;
    if (typeof o.events === 'boolean') c.events = o.events;
    if (typeof o.zones === 'boolean') c.zones = o.zones;
    if (typeof o.moves === 'boolean') c.moves = o.moves;
    return true;
  }

  setPhase(room: Room, phase: unknown): boolean {
    const ok =
      phase === 'lobby' ||
      phase === 'countdown' ||
      phase === 'race' ||
      phase === 'paused' ||
      phase === 'replay' ||
      phase === 'results';
    if (!ok || room.phase === phase) return false;
    room.phase = phase;
    if (phase === 'lobby') {
      // back in the lobby: anyone still disconnected loses their slot after the normal grace period
      for (const p of this.players(room)) {
        p.ready = false;
        if (!p.connected) p.droppedAt = this.now();
      }
    }
    return true;
  }

  lobbyUpdate(room: Room): LobbyUpdate {
    const leader = this.leader(room);
    const players: LobbyPlayer[] = this.players(room).map((p) => ({
      slot: p.slot,
      name: p.name,
      color: SLOT_COLORS[p.slot]!,
      ready: p.ready,
      connected: p.connected,
      characterId: p.characterId,
      isLeader: p === leader,
      setup: p.setup,
    }));
    return { room: room.code, players, config: room.config };
  }

  /**
   * Housekeeping: free lobby slots whose phone has been gone too long, and delete rooms whose host has been gone too long.
   * Returns the rooms whose lobby changed and the codes of deleted rooms.
   */
  sweep(): { changed: Room[]; deleted: string[] } {
    const t = this.now(),
      changed: Room[] = [],
      deleted: string[] = [];
    for (const room of this.rooms.values()) {
      if (room.hostSocketId === null && room.hostDroppedAt !== null && t - room.hostDroppedAt >= HOST_GONE_MS) {
        this.rooms.delete(room.code);
        deleted.push(room.code);
        continue;
      }
      if (room.phase !== 'lobby') continue;
      let any = false;
      for (const p of this.players(room)) {
        if (!p.connected && p.droppedAt !== null && t - p.droppedAt >= LOBBY_GRACE_MS) {
          room.slots[p.slot] = null;
          any = true;
        }
      }
      if (any) changed.push(room);
    }
    return { changed, deleted };
  }
}
