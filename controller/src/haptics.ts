/**
 * Haptics: navigator.vibrate where it exists (Android Chrome). iOS Safari has no vibration API; on iOS 18+
 * toggling a hidden <input type="checkbox" switch> through its label gives a system haptic tick (D16b).
 * That trick is best-effort: if Apple changes it, the screen flash remains the feedback.
 */
import type { HapticKind } from '@tk/shared';

const PATTERNS: Record<HapticKind | 'tap', number[]> = {
  tap: [8],
  drift1: [12],
  drift2: [12, 50, 12],
  drift3: [12, 40, 12, 40, 12],
  boost: [140],
  hit: [40, 60, 40],
  item: [18],
  finish: [60, 80, 60, 80, 160],
};

let label: HTMLLabelElement | null = null;
const canVibrate = typeof navigator.vibrate === 'function';
const isIOS =
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function iosSwitch(): HTMLLabelElement | null {
  if (!isIOS) return null;
  if (label) return label;
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  input.id = 'hapticSwitch';
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  label = document.createElement('label');
  label.htmlFor = input.id;
  for (const el of [input, label])
    Object.assign(el.style, {
      position: 'fixed',
      left: '-100px',
      top: '0',
      width: '1px',
      height: '1px',
      opacity: '0',
      pointerEvents: 'none',
    });
  document.body.append(input, label);
  return label;
}

export let hapticsOn = localStorage.getItem('tk_haptics') !== '0';
export function setHaptics(on: boolean): void {
  hapticsOn = on;
  localStorage.setItem('tk_haptics', on ? '1' : '0');
}

/** Play a feedback pattern. Pulses are the "on" entries of the pattern. */
export function haptic(kind: HapticKind | 'tap'): void {
  if (!hapticsOn) return;
  const pattern = PATTERNS[kind];
  if (canVibrate) {
    navigator.vibrate(pattern);
    return;
  }
  const l = iosSwitch();
  if (!l) return;
  let t = 0;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) window.setTimeout(() => l.click(), t);
    t += ms;
  });
}

export const hapticSupport = canVibrate ? 'vibrate' : isIOS ? 'ios-switch' : 'none';
