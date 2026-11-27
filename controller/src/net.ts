/**
 * Phone ↔ server connection: join with a saved playerToken (so a reconnect returns to the same slot),
 * automatic rejoin after a drop, input sending (on change + 100 ms heartbeat, at most 60 per second,
 * volatile), and ping measurement.
 */
import { io, type Socket } from 'socket.io-client';
import type {
  KartSetup,
  ControllerToServer,
  ServerToController,
  JoinOk,
  JoinErrorReason,
  PlayerInput,
  PlayerSettings,
  LeaderConfig,
} from '@tk/shared';

const TOKEN_KEY = 'tk_player_token';

function playerToken(): string {
  let t = localStorage.getItem(TOKEN_KEY);
  if (!t || !/^[A-Za-z0-9_-]{8,64}$/.test(t)) {
    const a = new Uint8Array(12);
    crypto.getRandomValues(a);
    t = btoa(String.fromCharCode(...a))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    localStorage.setItem(TOKEN_KEY, t);
  }
  return t;
}

export type InputState = Omit<PlayerInput, 'seq' | 't'>;

export class PhoneNet {
  readonly socket: Socket<ServerToController, ControllerToServer>;
  joined: JoinOk | null = null;
  private room: string | null = null;
  private name = '';
  private seq = 0;
  private lastSent = 0;
  private lastKey = '';
  private pendingItem: 'forward' | 'back' | null = null;
  private pendingMove = false;
  rtt: number | null = null;
  onJoinLost: ((reason: JoinErrorReason) => void) | null = null;
  onRejoined: ((j: JoinOk) => void) | null = null;

  constructor() {
    this.socket = io('/controller', {
      transports: ['websocket', 'polling'],
      reconnectionDelay: 400,
      reconnectionDelayMax: 2000,
    });
    this.socket.on('connect', () => {
      // after a drop: rejoin silently with the same token, back into the same slot
      if (this.room && this.joined) {
        this.join(this.room, this.name).then((r) => {
          if (r.ok) this.onRejoined?.(r.data);
          else this.onJoinLost?.(r.reason);
        });
      }
    });
    window.setInterval(() => this.ping(), 1000);
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  join(room: string, name: string): Promise<{ ok: true; data: JoinOk } | { ok: false; reason: JoinErrorReason }> {
    return new Promise((resolve) => {
      const send = (): void => {
        this.socket.emit('player:join', { room, name, playerToken: playerToken() }, (r) => {
          if (r.ok) {
            this.joined = r.data;
            this.room = room;
            this.name = name;
          }
          resolve(r);
        });
      };
      if (this.socket.connected) send();
      else this.socket.once('connect', send);
    });
  }

  leave(): void {
    this.socket.emit('player:leave');
    this.joined = null;
    this.room = null;
  }

  ready(ready: boolean): void {
    this.socket.emit('player:ready', { ready });
  }
  select(characterId: string): void {
    this.socket.emit('player:select', { characterId });
  }
  /** D72: the garage setup (the server ignores it outside the lobby). */
  garage(setup: KartSetup): void {
    if (this.joined) this.socket.emit('player:garage', setup);
  }
  start(): void {
    this.socket.emit('player:start');
  }
  rematch(toLobby: boolean): void {
    this.socket.emit('player:rematch', { toLobby });
  }
  settings(s: PlayerSettings): void {
    this.socket.emit('player:settings', s);
  }
  config(c: LeaderConfig): void {
    this.socket.emit('leader:config', c);
  }

  /** Queue a one-shot item press; it rides on the next input message. */
  fireItem(dir: 'forward' | 'back'): void {
    this.pendingItem = dir;
  }
  /** D74: queue a one-shot MOVE press, like an item. */
  fireMove(): void {
    this.pendingMove = true;
  }

  /**
   * Called every animation frame with the held state. Sends on change, on an item press, or as a 100 ms
   * heartbeat; never more than 60 times per second.
   */
  /** Pause or resume the race for everyone (D37). */
  pause(paused: boolean): void {
    this.socket.emit('player:pause', { paused });
  }

  /** D68: skip the highlight replay on the big screen. */
  /** D82: the leader ends the race and takes everyone back to the lobby. */
  toLobby(): void {
    this.socket.emit('player:lobby');
  }
  skip(): void {
    this.socket.emit('player:skip');
  }

  pump(st: InputState, now: number): void {
    if (!this.joined || !this.socket.connected) return;
    const key = `${st.steer.toFixed(3)}|${+st.throttle}${+st.brake}${+st.drift}`;
    const changed = key !== this.lastKey || this.pendingItem !== null || this.pendingMove;
    if (now - this.lastSent < 1000 / 60) return;
    if (!changed && now - this.lastSent < 100) return;
    this.lastKey = key;
    this.lastSent = now;
    const msg: PlayerInput = {
      ...st,
      item: this.pendingItem,
      ...(this.pendingMove ? { move: true } : {}),
      seq: ++this.seq,
      t: Date.now(),
    };
    this.pendingItem = null;
    this.pendingMove = false;
    // an item press must not be dropped; everything else is volatile (an old input is worthless)
    if (msg.item || msg.move) this.socket.emit('player:input', msg);
    else this.socket.volatile.emit('player:input', msg);
  }

  private ping(): void {
    if (!this.socket.connected) return;
    const t0 = performance.now();
    this.socket.emit('ping', Date.now(), () => {
      this.rtt = Math.round(performance.now() - t0);
      this.socket.emit('net:rtt', this.rtt);
    });
  }
}
