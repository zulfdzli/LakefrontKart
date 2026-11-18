/**
 * Track design tool (phase 8): draws each TrackDef's layout (road, walls, sectors, gates, pads, ramps, item rows,
 * shortcuts and surface zones) to docs/screens/tracks/<id>.png and prints its layout checks.
 *
 *   npm run track-view            (all tracks)
 *   npm run track-view -- canyon  (one track)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { TRACKS, buildTrackFromDef, trackStats, type TrackId } from '@tk/shared';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'docs', 'screens', 'tracks');
const ids = (process.argv.slice(2).filter((a) => a in TRACKS) as TrackId[]).concat();
const list: TrackId[] = ids.length ? ids : (Object.keys(TRACKS) as TrackId[]);

const SURF_COL: Record<string, string> = {
  ice: '#b3e5fc',
  gravel: '#bcaaa4',
  dirt: '#a1887f',
  sand: '#ffe0b2',
  snow: '#ffffff',
  grass: '#9ccc65',
};

function svgFor(id: TrackId): { svg: string; stats: ReturnType<typeof trackStats> } {
  const def = TRACKS[id],
    T = buildTrackFromDef(def);
  const st = trackStats(T);
  let x0 = 1e9,
    x1 = -1e9,
    z0 = 1e9,
    z1 = -1e9;
  for (let i = 0; i < T.N; i++) {
    x0 = Math.min(x0, T.CX[i]!);
    x1 = Math.max(x1, T.CX[i]!);
    z0 = Math.min(z0, T.CZ[i]!);
    z1 = Math.max(z1, T.CZ[i]!);
  }
  const pad = 80;
  const vb = `${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}`;
  const edge = (off: (i: number) => number): string =>
    Array.from({ length: T.N + 1 }, (_, k) => {
      const i = k % T.N;
      return `${(T.CX[i]! + T.RX[i]! * off(i)).toFixed(1)},${(T.CZ[i]! + T.RZ[i]! * off(i)).toFixed(1)}`;
    }).join(' ');
  const band = (a: (i: number) => number, b: (i: number) => number, fill: string): string =>
    `<polygon points="${edge(a)} ${edge(b).split(' ').reverse().join(' ')}" fill="${fill}" fill-rule="nonzero"/>`;
  const at = (i: number, lat: number): [number, number] => [T.CX[i]! + T.RX[i]! * lat, T.CZ[i]! + T.RZ[i]! * lat];
  const line = (i: number, a: number, b: number, col: string, w: number): string => {
    const [ax, az] = at(i, a),
      [bx, bz] = at(i, b);
    return `<line x1="${ax}" y1="${az}" x2="${bx}" y2="${bz}" stroke="${col}" stroke-width="${w}"/>`;
  };
  const parts: string[] = [];
  parts.push(
    band(
      (i) => -T.WALLD[i]!,
      (i) => T.WALLD[i]!,
      '#e8e4d8',
    ),
  );
  parts.push(
    band(
      (i) => -T.HW[i]!,
      (i) => T.HW[i]!,
      '#55595f',
    ),
  );
  for (const sc of T.shortcuts) {
    const pts = [];
    for (let i = 0; i < sc.pts.length; i += 2) pts.push(`${sc.pts[i]},${sc.pts[i + 1]}`);
    parts.push(
      `<polyline points="${pts.join(' ')}" fill="none" stroke="${SURF_COL[sc.surface] ?? '#a1887f'}" stroke-width="${sc.half * 2}" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>`,
    );
  }
  for (let i = 0; i < T.N; i++)
    for (const z of T.zones[i] ?? [])
      parts.push(line(i, z.latMin, z.latMax, SURF_COL[z.surface] ?? '#f0f', T.DS + 0.5));
  for (const r of T.ramps)
    for (let i = r.i0; i !== r.i1; i = (i + 1) % T.N) parts.push(line(i, -T.HW[i]!, T.HW[i]!, '#ff9800', T.DS + 0.5));
  for (const p of T.pads) parts.push(line(p.idx, p.lat - 4, p.lat + 4, '#00e5ff', 9));
  for (const b of T.boxRows)
    for (const l of [-9, -3, 3, 9]) {
      const [x, z] = at(b, (l * T.HW[b]!) / 13);
      parts.push(`<circle cx="${x}" cy="${z}" r="3.5" fill="#ff4081"/>`);
    }
  for (const g of T.gates) parts.push(line(g, -T.WALLD[g]!, T.WALLD[g]!, '#ffd600', 3));
  parts.push(line(0, -T.WALLD[0]!, T.WALLD[0]!, '#fff', 6));
  T.sectors.forEach((s, k) => {
    const [x, z] = at(s, T.WALLD[s]! + 30);
    parts.push(
      `<text x="${x}" y="${z}" font-size="30" font-family="sans-serif" font-weight="700" fill="#1a237e" text-anchor="middle">S${k + 1}</text>`,
    );
  });
  for (let k = 1; k <= 9; k++) {
    const f = k / 10,
      i = Math.round(f * T.N),
      [x, z] = at(i, 0);
    parts.push(
      `<text x="${x}" y="${z + 6}" font-size="18" font-family="sans-serif" fill="#fff" text-anchor="middle">${Math.round(f * 10)}</text>`,
    );
  }
  // direction arrow at the start
  const [sx, sz] = at(0, 0);
  parts.push(
    `<line x1="${sx}" y1="${sz}" x2="${sx + T.TX[0]! * 60}" y2="${sz + T.TZ[0]! * 60}" stroke="#e53935" stroke-width="6" marker-end="url(#a)"/>`,
  );
  // tightest corner and closest approach
  const ri = Math.round(st.minRadiusAt * T.N);
  const [rx, rz] = at(ri, 0);
  parts.push(`<circle cx="${rx}" cy="${rz}" r="22" fill="none" stroke="#d50000" stroke-width="4"/>`);
  const [ai, bi] = st.minSepAt.map((f) => Math.round(f * T.N)) as [number, number];
  const [ax, az] = at(ai, 0),
    [bx, bz] = at(bi, 0);
  parts.push(
    `<line x1="${ax}" y1="${az}" x2="${bx}" y2="${bz}" stroke="#d50000" stroke-width="3" stroke-dasharray="10 6"/>`,
  );
  // height profile along the bottom
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="1400" height="${Math.round((1400 * (z1 - z0 + 2 * pad)) / (x1 - x0 + 2 * pad))}">
<defs><marker id="a" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill="#e53935"/></marker></defs>
<rect x="${x0 - pad}" y="${z0 - pad}" width="${x1 - x0 + 2 * pad}" height="${z1 - z0 + 2 * pad}" fill="#7cb342"/>
${parts.join('\n')}
</svg>`;
  return { svg, stats: st };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const id of list) {
      const { svg, stats } = svgFor(id);
      const T = buildTrackFromDef(TRACKS[id]);
      let hMin = 1e9,
        hMax = -1e9;
      for (const h of T.H) {
        hMin = Math.min(hMin, h);
        hMax = Math.max(hMax, h);
      }
      console.log(
        `${id}: ${(stats.len / 1000).toFixed(2)} km, ${T.N} samples, tightest radius ${stats.minRadius.toFixed(0)} m at ${stats.minRadiusAt.toFixed(2)}, ` +
          `closest unrelated road ${stats.minSep.toFixed(0)} m at ${stats.minSepAt.map((f) => f.toFixed(2)).join('/')}, height ${hMin.toFixed(1)}..${hMax.toFixed(1)} m, ` +
          `${T.gates.length} gates, ${T.boxRows.length} item rows`,
      );
      // lap fraction of each control point (for placing sectors, zones and shortcuts)
      const def = TRACKS[id];
      console.log(
        '  points at: ' +
          def.points
            .map((p, k) => {
              let bi = 0,
                bd = 1e18;
              for (let i = 0; i < T.N; i++) {
                const d = (T.CX[i]! - p.x) ** 2 + (T.CZ[i]! - p.z) ** 2;
                if (d < bd) {
                  bd = d;
                  bi = i;
                }
              }
              return `${k}:${(bi / T.N).toFixed(3)}`;
            })
            .join(' '),
      );
      writeFileSync(path.join(OUT, `${id}.svg`), svg);
      const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
      await page.setContent(`<body style="margin:0;background:#333">${svg}</body>`);
      await page.locator('svg').screenshot({ path: path.join(OUT, `${id}.png`) });
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
