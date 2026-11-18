/**
 * Host ↔ server connection: creates the room (or resumes it after a page refresh, section 5.2),
 * receives lobby updates and phone input, and sends phase, HUD, haptics and results back.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  HostToServer,
  ServerToHost,
  LobbyUpdate,
  NetInfo,
  RelayedInput,
  HostState,
  HapticKind,
  Standing,
  LeaderConfig,
  PlayerSettings,
} from '@tk/shared';

const KEY = 'tk_host';

export interface HostNetEvents {
  lobby(u: LobbyUpdate): void;
  input(i: RelayedInput): void;
  start(slot: number): void;
  rematch(slot: number, toLobby: boolean): void;
  pause(slot: number, paused: boolean): void;
  latency(slot: number, rttMs: number): void;
  settings(slot: number, s: PlayerSettings): void;
  device(slot: number, d: string): void;
  config(c: LeaderConfig): void;
  room(code: string): void;
  connection(online: boolean): void;
}

export class HostNet {
  readonly socket: Socket<ServerToHost, HostToServer>;
  room: string | null = null;
  lobby: LobbyUpdate | null = null;
  readonly latency = new Map<number, number>();
  readonly devices = new Map<number, string>();

  constructor(private readonly on: HostNetEvents) {
    const s = (this.socket = io('/host', { transports: ['websocket', 'polling'] }));
    s.on('connect', () => {
      on.connection(true);
      this.claimRoom();
    });
    s.on('disconnect', () => on.connection(false));
    s.on('lobby:update', (u) => {
      this.lobby = u;
      on.lobby(u);
    });
    s.on('player:input', (i) => on.input(i));
    s.on('player:start', (p) => on.start(p.slot));
    s.on('player:rematch', (p) => on.rematch(p.slot, p.toLobby));
    s.on('player:pause', (p) => on.pause(p.slot, p.paused));
    s.on('player:latency', (p) => {
      this.latency.set(p.slot, p.rttMs);
      on.latency(p.slot, p.rttMs);
    });
    s.on('player:settings', (p) => on.settings(p.slot, p.settings));
    s.on('player:device', (p) => {
      this.devices.set(p.slot, p.device);
      on.device(p.slot, p.device);
    });
    s.on('leader:config', (c) => on.config(c));
  }

  /** Resume the room from this tab's sessionStorage, or create a new one. */
  private claimRoom(): void {
    type Saved = { room: string; hostToken: string } | null;
    let saved: Saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as Saved;
    } catch {
      saved = null;
    }
    const create = (): void => {
      this.socket.emit('host:create', (r) => {
        this.room = r.room;
        try {
          sessionStorage.setItem(KEY, JSON.stringify(r));
        } catch {
          /* private mode */
        }
        this.on.room(r.room);
      });
    };
    if (saved) {
      const resume = saved;
      this.socket.emit('host:resume', resume, (r) => {
        if (r.ok) {
          this.room = resume.room;
          this.on.room(resume.room);
        } else create();
      });
    } else create();
  }

  netInfo(): Promise<NetInfo> {
    return new Promise((res) => this.socket.emit('net:info', res));
  }

  sendState(st: HostState): void {
    this.socket.volatile.emit('host:state', st);
  }

  /** Phase changes must arrive (not volatile). */
  sendPhase(st: HostState): void {
    this.socket.emit('host:state', st);
  }

  haptic(slot: number, kind: HapticKind): void {
    this.socket.emit('host:haptic', { slot, kind });
  }

  results(standings: Standing[]): void {
    this.socket.emit('host:results', { standings });
  }

  kick(slot: number): void {
    this.socket.emit('host:kick', { slot });
  }

  config(c: LeaderConfig): void {
    this.socket.emit('host:config', c);
  }
}
