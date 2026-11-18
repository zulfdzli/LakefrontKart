/** Host keyboard driving for slot 0 (phase 4 test drive; also handy for debugging later). */

// Arrow keys only: letters are host shortcuts (D debug, F fps, M mute, P pause).
const KMAP: Record<string, 'left' | 'right' | 'up' | 'down' | 'drift'> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ' ': 'drift',
  Shift: 'drift',
};

export class Keyboard {
  private readonly keys = { left: false, right: false, up: false, down: false, drift: false };
  private itemPressed = false;

  constructor() {
    window.addEventListener('keydown', (e) => {
      const m = KMAP[e.key];
      if (m) {
        this.keys[m] = true;
        e.preventDefault();
      }
      if (['e', 'E', 'x', 'X', 'Control'].includes(e.key) && !e.repeat) {
        this.itemPressed = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      const m = KMAP[e.key];
      if (m) this.keys[m] = false;
    });
    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys) as (keyof typeof this.keys)[]) this.keys[k] = false;
    });
  }

  read(): { steer: number; throttle: boolean; brake: boolean; drift: boolean; item: 'forward' | 'back' | null } {
    const k = this.keys;
    const item = this.itemPressed ? (k.down ? 'back' : 'forward') : null;
    this.itemPressed = false;
    return { steer: (k.right ? 1 : 0) - (k.left ? 1 : 0), throttle: k.up, brake: k.down, drift: k.drift, item };
  }
}
