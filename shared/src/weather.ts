/**
 * D71 weather and time of day. Each race rolls (or the lobby picks) a sky: Day, Sunset, Night, Rain or Snow (Snow
 * only where the theme is frosty). The look lives on the host; the sim only needs the grip: rain takes about 5% off
 * the tyres and scatters puddles that make a kart twitch and slide for a moment, snow takes a light 2.5%.
 */
import { Rng, seedFromString } from './rng';
import type { Track } from './track';
import { TRACKS, isTrackId } from './tracks';

export type Weather = 'day' | 'sunset' | 'night' | 'rain' | 'snow';
/** The lobby setting: one weather for every race, or a fresh roll per race. */
export type WeatherSetting = Weather | 'random';

export const WEATHERS: readonly Weather[] = ['day', 'sunset', 'night', 'rain', 'snow'];
export const WEATHER_SETTINGS: readonly WeatherSetting[] = ['random', ...WEATHERS];
export const WEATHER_NAME: Readonly<Record<WeatherSetting, string>> = {
  random: 'Random',
  day: 'Day',
  sunset: 'Sunset',
  night: 'Night',
  rain: 'Rain',
  snow: 'Snow',
};
export const WEATHER_ICON: Readonly<Record<WeatherSetting, string>> = {
  random: '🎲',
  day: '☀️',
  sunset: '🌇',
  night: '🌙',
  rain: '🌧️',
  snow: '❄️',
};
export const isWeatherSetting = (v: unknown): v is WeatherSetting =>
  typeof v === 'string' && (WEATHER_SETTINGS as readonly string[]).includes(v);

/** Tyre grip per weather (1 = dry). */
export const WEATHER_GRIP: Readonly<Record<Weather, number>> = {
  day: 1,
  sunset: 1,
  night: 1,
  rain: 0.95,
  snow: 0.975,
};
/** A puddle's grip while a kart is still wet from it, and for how long (s). */
export const PUDDLE_GRIP = 0.72;
export const PUDDLE_WET = 0.45;

/** Snow falls only on the frosty themes. */
export function weatherAllowed(trackId: string, w: Weather): boolean {
  if (w !== 'snow') return true;
  return isTrackId(trackId) && TRACKS[trackId].theme === 'frosty';
}

/** Random's odds: mostly fair weather, so the change still feels like an event. */
const ODDS: Readonly<Record<Weather, number>> = { day: 3, sunset: 2, night: 2, rain: 2, snow: 2 };

/**
 * The weather a race is run in. A fixed setting is kept where it is allowed (Snow away from the frosty themes falls
 * back to Rain, the nearest look); Random rolls from the seed, so a race and its replay agree.
 */
export function rollWeather(setting: WeatherSetting, trackId: string, seed: number): Weather {
  if (setting !== 'random') return weatherAllowed(trackId, setting) ? setting : 'rain';
  const pool = WEATHERS.filter((w) => weatherAllowed(trackId, w));
  const total = pool.reduce((a, w) => a + ODDS[w], 0);
  let r = new Rng((seed ^ 0x5eed) >>> 0).next() * total;
  for (const w of pool) if ((r -= ODDS[w]) < 0) return w;
  return pool[0]!;
}

export interface Puddle {
  /** Road sample, lateral position (m) and radius (m). */
  i: number;
  lat: number;
  r: number;
}

/**
 * Where the rain pools on a track: fixed per track (the host draws them where the sim has them), on the straights
 * and gentle bends only, clear of the start, jumps, crests, boost pads and item rows.
 */
export function puddlesFor(T: Track): Puddle[] {
  const rng = new Rng(seedFromString(`puddles:${T.id}`));
  const N = T.N,
    out: Puddle[] = [];
  const near = (i: number, j: number, d: number): boolean => {
    const a = Math.abs(i - j) % N;
    return Math.min(a, N - a) <= d;
  };
  // an arena (a short ring, curved all the way round) has no start straight and no straights to keep to
  const ring = N < 300;
  const bad = (i: number): boolean => {
    if (!ring && (i < 50 || i > N - 25)) return true;
    if (T.airZone[i]) return true;
    if (!ring && Math.abs(T.CURV[i]!) > 0.5) return true;
    const gap = ring ? 0.35 : 1;
    for (const r of T.ramps) {
      const len = (r.i1 - r.i0 + N) % N;
      if ((i - r.i0 + N + Math.round(25 * gap)) % N <= len + Math.round(70 * gap)) return true;
    }
    for (const p of T.pads) if (near(i, p.idx, Math.round(25 * gap))) return true;
    for (const b of T.boxRows) if (near(i, b, Math.round(15 * gap))) return true;
    return out.some((p) => near(i, p.i, Math.floor(N / (ring ? 10 : 30))));
  };
  const want = ring ? 5 : Math.max(6, Math.min(12, Math.round(T.LEN / 250)));
  for (let tries = 0; out.length < want && tries < 400; tries++) {
    const i = rng.int(N);
    if (bad(i)) continue;
    const hw = T.HW[i]!;
    const r = rng.range(2.2, 3.4);
    out.push({ i, lat: rng.range(-(hw - r - 0.8), hw - r - 0.8), r });
  }
  return out.sort((a, b) => a.i - b.i);
}
