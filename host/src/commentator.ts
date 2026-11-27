/**
 * D81 race commentator: an excited voice calling the race, using the computer's own speech voices (no recordings),
 * with each line also shown as a caption at the top of the screen. Bigger moments interrupt smaller ones, small ones
 * wait their turn (and are dropped if something bigger is being said), and quiet stretches get a word on the order.
 * Silent when the game is muted; captions still show.
 */

/** Line priority: filler 1, incidents 2, the lead, final lap and knockouts 3, the result 4. */
export type Pri = 1 | 2 | 3 | 4;

const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]!;

export class Commentator {
  private voice: SpeechSynthesisVoice | null = null;
  private readonly synth: SpeechSynthesis | null = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
  private readonly cap: HTMLDivElement;
  private speaking = 0;
  private busyUntil = 0;
  private quietSince = performance.now();
  private capTimer = 0;
  enabled = true;

  constructor(private readonly muted: () => boolean) {
    this.cap = document.createElement('div');
    this.cap.className = 'commentary';
    document.body.appendChild(this.cap);
    const choose = (): void => {
      const vs = this.synth?.getVoices() ?? [];
      // a lively English voice: the well-known natural ones first, then any English one
      const want = [/Ryan/i, /Guy/i, /Google UK English Male/i, /Daniel/i, /Aria/i, /Google US English/i, /David/i];
      this.voice =
        want.map((re) => vs.find((v) => re.test(v.name) && /^en/i.test(v.lang))).find(Boolean) ??
        vs.find((v) => /^en/i.test(v.lang)) ??
        null;
    };
    choose();
    this.synth?.addEventListener?.('voiceschanged', choose);
  }

  /** Say a line now if it outranks what is being said, or after a short breath otherwise. */
  say(text: string, pri: Pri): void {
    if (!this.enabled) return;
    const now = performance.now();
    const talking = now < this.busyUntil;
    if (talking && pri <= this.speaking) return;
    // small talk needs a gap after the last line
    if (pri === 1 && now - this.quietSince < 9000) return;
    this.speaking = pri;
    this.busyUntil = now + 1200 + text.length * 55;
    this.quietSince = now;
    this.caption(text);
    if (!this.synth || this.muted()) return;
    if (talking) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.rate = pri >= 3 ? 1.18 : 1.1;
    u.pitch = pri >= 3 ? 1.12 : 1.0;
    u.volume = 1;
    u.onend = () => {
      this.busyUntil = Math.min(this.busyUntil, performance.now() + 250);
      this.quietSince = performance.now();
    };
    this.synth.speak(u);
  }

  /** Has it been quiet long enough for some small talk? */
  get quiet(): boolean {
    return performance.now() - this.quietSince > 11000 && performance.now() > this.busyUntil;
  }

  private caption(text: string): void {
    this.cap.textContent = `🎙️ ${text}`;
    this.cap.classList.add('on');
    clearTimeout(this.capTimer);
    this.capTimer = window.setTimeout(() => this.cap.classList.remove('on'), 2600 + text.length * 35);
  }

  /** Stop talking (leaving a race, pausing). */
  hush(): void {
    this.synth?.cancel();
    this.busyUntil = 0;
    this.cap.classList.remove('on');
  }

  /* ---------------- the lines ---------------- */
  static go = (): string => pick(["Lights out, and they're away!", 'And we are racing!', 'Green light, here they go!']);
  static lead = (who: string): string =>
    pick([`${who} takes the lead!`, `And ${who} hits the front!`, `${who} is through into first!`]);
  static finalLap = (who: string): string =>
    pick([`Final lap! ${who} leads the way.`, `Last lap, and ${who} is out in front!`, `Bell lap! ${who} leads.`]);
  static hit = (who: string): string =>
    pick([`Oh! ${who} is spinning!`, `Ouch, ${who} has been hit!`, `${who} goes round!`, `Big moment for ${who}!`]);
  static flattened = (who: string): string => pick([`${who} is flattened by the snowball!`, `Snowball gets ${who}!`]);
  static rocks = (who: string): string => pick([`${who} into the rubble!`, `${who} finds the rocks!`]);
  static sheep = (who: string): string => pick([`${who} bumps a sheep!`, `Mind the sheep, ${who}!`]);
  static move = (who: string, move: string): string =>
    pick([`${move} from ${who}!`, `${who} uses ${move}!`, `There's the ${move} from ${who}!`]);
  static hazard = (what: string): string =>
    pick([`Look out, ${what.toLowerCase()}!`, `Watch out up ahead, ${what.toLowerCase()}!`]);
  static win = (who: string): string =>
    pick([`${who} wins it!`, `And ${who} takes the victory!`, `It's ${who}! What a drive!`]);
  static photo = (): string => pick(['Photo finish! Too close to call!', "It's a photo finish!"]);
  static finished = (who: string, place: string): string =>
    pick([`${who} crosses the line in ${place}.`, `${place} for ${who}.`]);
  static ko = (who: string): string => pick([`${who} is out!`, `And that's it for ${who}!`]);
  static suddenDeath = (): string => 'Sudden death! One life each!';
  /* D83 fun zones */
  static slalom = (who: string): string =>
    pick([`A clean slalom from ${who}!`, `${who} threads every gate!`, `Lovely slalom, ${who}!`]);
  static bullseye = (who: string): string =>
    pick([`Bullseye for ${who}!`, `${who} sticks the landing, right on target!`, `Right on the target, ${who}!`]);
  static tunnelPass = (who: string, n: number): string =>
    n > 1
      ? pick([`${who} takes ${n} in the draft tunnel!`, `What a move! ${who} gains ${n} places in the tunnel!`])
      : pick([`${who} slingshots through in the tunnel!`, `${who} makes the pass in the draft tunnel!`]);
  static order = (a: string, b: string, gap: number): string =>
    gap < 1.5
      ? pick([`${a} leads, but ${b} is right there!`, `Nothing between ${a} and ${b}!`])
      : pick([`${a} still leads, ${b} giving chase.`, `${a} out in front, ${b} in second.`]);
}
