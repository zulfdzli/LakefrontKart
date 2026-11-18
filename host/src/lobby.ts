/**
 * Lobby screen (section 6.1): QR code, room code and URL (with a network picker when there are several),
 * five player slot cards, the race settings, and the start hint. The 3D grid preview orbits behind it.
 */
import QRCode from 'qrcode';
import { CHARS, MAX_PLAYERS, SLOT_COLORS, type LobbyUpdate, type NetInfo } from '@tk/shared';

const TRACK_NAMES: Record<string, string> = {
  meadows: 'Sunny Meadows',
  canyon: 'Dusty Canyon',
  frosty: 'Frosty Peaks',
  sepang: 'Sepang Circuit',
};
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export class Lobby {
  private readonly el: HTMLElement;
  private base: string | null = null;
  private room: string | null = null;
  private lastQr = '';
  onSound: (() => void) | null = null;
  onKick: ((slot: number) => void) | null = null;
  /** The track chip was clicked (cycle to the next track). */
  onTrack: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.el = root;
    root.innerHTML = /* html */ `
      <h1 class="logo">TURBO<br /><span>KARTS</span></h1>
      <div class="lobbyMain">
        <section class="joinCard">
          <div class="joinTitle">Scan to join</div>
          <div class="qr" aria-label="QR code that opens the controller"></div>
          <div class="code"><small>Room</small><b class="roomCode">····</b></div>
          <div class="url">…</div>
          <label class="netPick" hidden>Network <select></select></label>
          <div class="warn" hidden></div>
        </section>
        <section class="slots"></section>
      </div>
      <footer class="lobbyFoot">
        <div class="cfg"></div>
        <div class="status">Waiting for players…</div>
        <button class="alt soundBtn" type="button">🔈 Click to enable sound</button>
      </footer>`;
    const slots = this.q('.slots');
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = document.createElement('div');
      c.className = 'slot empty';
      c.style.setProperty('--c', SLOT_COLORS[i]!);
      c.innerHTML = `<i class="stripe"></i><span class="pn">P${i + 1}</span><span class="face">📱</span><span class="who"><b class="name">Scan to join</b><small class="meta"></small></span><span class="state"></span><button class="kick" type="button" title="Remove player">×</button>`;
      c.querySelector('.kick')!.addEventListener('click', () => this.onKick?.(i));
      slots.appendChild(c);
    }
    this.q('.soundBtn').addEventListener('click', () => this.onSound?.());
    this.q('.cfg').addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('[data-act="track"]')) this.onTrack?.();
    });
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    return this.el.querySelector<T>(sel)!;
  }

  show(on: boolean): void {
    this.el.classList.toggle('hidden', !on);
  }

  setSoundOn(on: boolean): void {
    this.q('.soundBtn').classList.toggle('hidden', on);
  }

  setRoom(code: string): void {
    this.room = code;
    this.q('.roomCode').textContent = code;
    void this.renderQr();
  }

  setNet(info: NetInfo): void {
    const options = info.publicUrl ? [{ name: 'PUBLIC_URL', url: info.publicUrl }] : info.candidates;
    const sel = this.q<HTMLSelectElement>('.netPick select');
    sel.innerHTML = '';
    for (const o of options) sel.add(new Option(`${o.name} — ${o.url}`, o.url));
    this.q('.netPick').hidden = options.length < 2;
    sel.onchange = () => {
      this.base = sel.value;
      void this.renderQr();
    };
    this.base = options[0]?.url ?? `${location.protocol}//${location.host}`;
    const warn = this.q('.warn');
    warn.hidden = !info.publicNetworkProfile && options.length > 0;
    warn.textContent =
      options.length === 0
        ? 'No Wi-Fi address found. Connect this computer to Wi-Fi, or set PUBLIC_URL.'
        : 'Your Wi-Fi is set to Public, so Windows Firewall blocks phones. Set it to Private in Settings → Network & internet → Wi-Fi.';
    void this.renderQr();
  }

  private async renderQr(): Promise<void> {
    if (!this.room || !this.base) return;
    const url = `${this.base}/play?room=${this.room}`;
    if (url === this.lastQr) return;
    this.lastQr = url;
    this.q('.url').textContent = url.replace(/^https?:\/\//, '');
    this.q('.qr').innerHTML = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#1d1b2e', light: '#ffffff' },
    });
  }

  update(u: LobbyUpdate, latency: Map<number, number>): void {
    const cards = this.q('.slots').children;
    for (let i = 0; i < MAX_PLAYERS; i++) {
      const c = cards[i] as HTMLElement;
      const p = u.players.find((x) => x.slot === i);
      c.classList.toggle('empty', !p);
      c.classList.toggle('ready', !!p?.ready);
      c.classList.toggle('offline', !!p && !p.connected);
      const ch = p ? CHARS.find((x) => x.id === p.characterId) : undefined;
      (c.querySelector('.face') as HTMLElement).textContent = ch ? ch.emoji : '📱';
      (c.querySelector('.name') as HTMLElement).innerHTML = p
        ? esc(p.name) + (p.isLeader ? ' <span class="crown" title="Party leader">👑</span>' : '')
        : 'Scan to join';
      const ms = latency.get(i);
      (c.querySelector('.meta') as HTMLElement).textContent = p
        ? `${ch?.name ?? ''}${p.connected ? (ms !== undefined ? ` · ${ms} ms` : '') : ' · reconnecting…'}`
        : '';
      (c.querySelector('.state') as HTMLElement).textContent = p ? (p.ready ? 'READY' : p.connected ? '…' : '') : '';
    }
    const cfg = u.config;
    const diff = cfg.aiDifficulty[0]!.toUpperCase() + cfg.aiDifficulty.slice(1);
    const chips = [
      cfg.mode === 'gp' ? 'Grand Prix' : 'Single race',
      cfg.mode === 'gp'
        ? cfg.gpOrder.map((t) => TRACK_NAMES[t] ?? t).join(' → ')
        : (TRACK_NAMES[cfg.trackId] ?? cfg.trackId),
      `${cfg.laps} lap${cfg.laps > 1 ? 's' : ''}`,
      diff,
      `AI fill ${cfg.aiFill ? 'on' : 'off'}`,
      `Items ${cfg.itemsOn ? 'on' : 'off'}`,
    ];
    // the track chip is a button: click it (or press T) to try another track until phase 12's leader settings
    this.q('.cfg').innerHTML = chips
      .map((s, i) =>
        i === 1 && cfg.mode !== 'gp'
          ? `<button type="button" class="trackChip" data-act="track" title="Change track (T)">${esc(s)} ▸</button>`
          : `<span>${esc(s)}</span>`,
      )
      .join('');
    const n = u.players.length;
    const leader = u.players.find((p) => p.isLeader);
    this.q('.status').textContent =
      n === 0
        ? 'Waiting for players…'
        : `${n} player${n > 1 ? 's' : ''} in · ${leader ? leader.name : 'The leader'} presses START on their phone, or press Enter`;
  }
}
