/** The host page's automation hook (host/src/main.ts), as seen by the Playwright tools. */
export interface TkKart {
  slot: number | null;
  ai: boolean;
  drifting: boolean;
  driftLevel: number;
  boost: number;
  item: string | null;
  itemUses: number;
  prog: number;
  input: { steer: number; drift: boolean; brake: boolean };
}

declare global {
  interface Window {
    __name?: (f: unknown) => unknown;
    __tk: {
      ready: boolean;
      race(o: { seed?: number; ci?: number; laps?: number; autopilot?: boolean; humans?: number }): void;
      advance(s: number): void;
      state(): { phase: string; raceTime: number; stage: string; inRace: boolean; room: string | null };
      session(): { s: { phase: string; humans: TkKart[] }; players: { kart: TkKart }[]; paused: boolean } | null;
      info(): { calls: number; triangles: number; views: number; pixelRatio: number };
      lobby(): { players: { slot: number; name: string; connected: boolean }[] } | null;
    };
  }
}
