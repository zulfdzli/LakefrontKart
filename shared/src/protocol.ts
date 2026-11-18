/**
 * Every Socket.IO event and payload exchanged between controller (phone), server (relay) and host (game).
 * See docs/PROMPT.md section 5.3. The server never simulates the game; it validates, routes and relays.
 */

export const MAX_PLAYERS = 5;
export const ROOM_CODE_LENGTH = 4;
/** Room code alphabet: uppercase, without I, O, 0 and 1 so codes are easy to read and type. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const NAME_MAX_LENGTH = 10;

/** Fixed slot colours, P1 to P5 (section 6.1). AI karts are orange. */
export const SLOT_COLORS = ['#e53935', '#1e88e5', '#fdd835', '#43a047', '#8e24aa'] as const;
export const AI_COLOR = '#fb8c00';

export type Phase = 'lobby' | 'countdown' | 'race' | 'paused' | 'results';
export type SteeringScheme = 'buttons' | 'slider';
export type ItemFire = 'forward' | 'back' | null;
export type GameMode = 'single' | 'gp';
import type { Difficulty } from './ai';
export type HapticKind = 'hit' | 'boost' | 'item' | 'finish' | 'drift1' | 'drift2' | 'drift3';
export type JoinErrorReason = 'room-not-found' | 'room-full' | 'race-in-progress' | 'name-taken' | 'bad-request';

/* ---------------- controller → server ---------------- */

export interface JoinRequest {
  room: string;
  name: string;
  /** Random id kept in the phone's localStorage, used to reconnect to the same slot. */
  playerToken?: string;
}

export interface PlayerInput {
  /** Increments on every send, so the host can drop stale or duplicate packets. */
  seq: number;
  /** -1 (full left) to 1 (full right). */
  steer: number;
  throttle: boolean;
  brake: boolean;
  drift: boolean;
  /** One-shot: set on the message that carries the press, null otherwise. */
  item: ItemFire;
  /** Phone clock (ms) when the input was produced, for latency measurement. */
  t: number;
}

export interface PlayerSettings {
  steering: SteeringScheme;
  assist: boolean;
  /** Steering sensitivity multiplier set with the − / + buttons (0.6 to 1.4). */
  sensitivity: number;
}

export interface LeaderConfig {
  mode: GameMode;
  trackId: string;
  gpOrder: string[];
  laps: 1 | 2 | 3;
  aiFill: boolean;
  aiDifficulty: Difficulty;
  itemsOn: boolean;
}

/* ---------------- server → controller ---------------- */

export interface JoinOk {
  playerId: string;
  playerToken: string;
  slot: number;
  color: string;
  name: string;
  isLeader: boolean;
}

export interface LobbyPlayer {
  slot: number;
  name: string;
  color: string;
  ready: boolean;
  connected: boolean;
  characterId: string | null;
  isLeader: boolean;
}

export interface LobbyUpdate {
  room: string;
  players: LobbyPlayer[];
  config: LeaderConfig;
}

export interface HudUpdate {
  place: number;
  totalRacers: number;
  lap: number;
  laps: number;
  item: string | null;
  itemUses: number;
  boosting: boolean;
  drifting: boolean;
  driftLevel: number;
  finished: boolean;
}

export interface Standing {
  slot: number | null;
  name: string;
  color: string;
  characterId: string;
  time: number | null;
  bestLap: number | null;
  points?: number;
}

/* ---------------- host ↔ server ---------------- */

export interface HostCreateOk {
  room: string;
  hostToken: string;
}

export interface HostStatePerPlayer {
  slot: number;
  hud: HudUpdate;
}

export interface HostState {
  phase: Phase;
  players: HostStatePerPlayer[];
}

/** Server → host: an input from a phone, tagged with its slot. */
export interface RelayedInput extends PlayerInput {
  slot: number;
}

export interface NetInfo {
  port: number;
  /** Candidate LAN base URLs, best first, e.g. http://192.168.0.26:3000 */
  candidates: { name: string; address: string; url: string }[];
  /** Set when PUBLIC_URL overrides detection. */
  publicUrl: string | null;
  /** Windows only: true when the LAN adapter's network profile is Public (firewall blocks phones). */
  publicNetworkProfile: boolean;
}

/* ---------------- typed Socket.IO maps ---------------- */

type Ack<T> = (res: T) => void;

export interface ControllerToServer {
  'player:join': (
    req: JoinRequest,
    ack: Ack<{ ok: true; data: JoinOk } | { ok: false; reason: JoinErrorReason }>,
  ) => void;
  'player:ready': (p: { ready: boolean }) => void;
  'player:input': (p: PlayerInput) => void;
  'player:start': () => void;
  'player:rematch': (p: { toLobby: boolean }) => void;
  'player:select': (p: { characterId: string }) => void;
  'player:settings': (p: PlayerSettings) => void;
  'player:leave': () => void;
  'leader:config': (p: LeaderConfig) => void;
  ping: (t: number, ack: Ack<number>) => void;
  /** The phone reports its measured round-trip time so the host's debug overlay can show it. */
  'net:rtt': (rttMs: number) => void;
}

export interface ServerToController {
  'lobby:update': (p: LobbyUpdate) => void;
  phase: (p: { phase: Phase }) => void;
  hud: (p: HudUpdate) => void;
  haptic: (p: { kind: HapticKind }) => void;
  results: (p: { standings: Standing[]; isLeader: boolean }) => void;
  'host:status': (p: { online: boolean }) => void;
  'select:error': (p: { reason: 'taken' | 'unknown' }) => void;
  kicked: () => void;
}

export interface HostToServer {
  'host:create': (ack: Ack<HostCreateOk>) => void;
  'host:resume': (p: { room: string; hostToken: string }, ack: Ack<{ ok: boolean }>) => void;
  'host:state': (p: HostState) => void;
  'host:haptic': (p: { slot: number; kind: HapticKind }) => void;
  'host:results': (p: { standings: Standing[] }) => void;
  'host:kick': (p: { slot: number }) => void;
  'host:config': (p: LeaderConfig) => void;
  'net:info': (ack: Ack<NetInfo>) => void;
  ping: (t: number, ack: Ack<number>) => void;
}

export interface ServerToHost {
  'lobby:update': (p: LobbyUpdate) => void;
  'player:input': (p: RelayedInput) => void;
  'player:start': (p: { slot: number }) => void;
  'player:rematch': (p: { slot: number; toLobby: boolean }) => void;
  'player:settings': (p: { slot: number; settings: PlayerSettings }) => void;
  'player:latency': (p: { slot: number; rttMs: number }) => void;
  'leader:config': (p: LeaderConfig) => void;
  /** Which kind of phone a slot uses (debug overlay, haptics expectations). */
  'player:device': (p: { slot: number; device: 'iOS' | 'Android' | 'Desktop' }) => void;
}

/* ---------------- validation helpers (shared by server and host) ---------------- */

export function isRoomCode(v: unknown): v is string {
  if (typeof v !== 'string' || v.length !== ROOM_CODE_LENGTH) return false;
  for (const ch of v) if (!ROOM_CODE_ALPHABET.includes(ch)) return false;
  return true;
}

export function cleanName(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  // keep letters, digits, spaces and a few symbols; strip control characters and markup
  const s = v
    .replace(/[^\p{L}\p{N} _.\-!?']/gu, '')
    .trim()
    .slice(0, NAME_MAX_LENGTH)
    .trim();
  return s.length ? s : fallback;
}

const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate and clamp a phone input. Returns null when malformed (section 12.8: never trust the phone). */
export function sanitizeInput(v: unknown): PlayerInput | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (!isNum(o.seq) || !isNum(o.steer) || !isBool(o.throttle) || !isBool(o.brake) || !isBool(o.drift)) return null;
  const item = o.item === 'forward' || o.item === 'back' ? o.item : null;
  if (o.item !== null && o.item !== undefined && item === null) return null;
  return {
    seq: Math.trunc(o.seq),
    steer: Math.max(-1, Math.min(1, o.steer)),
    throttle: o.throttle,
    brake: o.brake,
    drift: o.drift,
    item,
    t: isNum(o.t) ? o.t : 0,
  };
}
