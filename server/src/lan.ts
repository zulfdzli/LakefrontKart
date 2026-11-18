import os from 'node:os';
import { execFile } from 'node:child_process';

export interface LanCandidate {
  name: string;
  address: string;
  url: string;
}

/** Adapter names that are never the Wi-Fi/Ethernet a phone can reach. */
const VIRTUAL =
  /(vEthernet|WSL|Docker|Hyper-V|VirtualBox|VMware|vmnet|Hamachi|ZeroTier|Tailscale|\bTAP\b|\bTUN\b|VPN|Loopback|Bluetooth|utun|bridge|Npcap|Local Area Connection\*)/i;

function privateRank(ip: string): number {
  const [a, b] = ip.split('.').map(Number) as [number, number];
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return -1; // not a private LAN range (e.g. Hamachi 25.x, link-local 169.254.x)
}

/** LAN IPv4 candidates a phone on the same Wi-Fi can reach, best first. */
export function lanCandidates(port: number): LanCandidate[] {
  const out: (LanCandidate & { rank: number })[] = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!addrs || VIRTUAL.test(name)) continue;
    for (const a of addrs) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const rank = privateRank(a.address);
      if (rank < 0) continue;
      out.push({ name, address: a.address, url: `http://${a.address}:${port}`, rank });
    }
  }
  out.sort((x, y) => x.rank - y.rank || x.name.localeCompare(y.name));
  return out.map(({ name, address, url }) => ({ name, address, url }));
}

/** Normalise PUBLIC_URL (no trailing slash). Returns null when unset or invalid. */
export function publicUrlFromEnv(): string | null {
  const raw = process.env.PUBLIC_URL?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    console.warn(`PUBLIC_URL "${raw}" is not a valid URL and is ignored.`);
    return null;
  }
}

/**
 * Windows only: is the network profile of one of these adapters "Public"?
 * Windows Firewall blocks inbound connections from phones on Public networks by default.
 */
export function windowsPublicProfile(adapterNames: string[]): Promise<boolean> {
  if (process.platform !== 'win32' || adapterNames.length === 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-NetConnectionProfile | Select-Object InterfaceAlias,NetworkCategory | ConvertTo-Json -Compress',
      ],
      { timeout: 6000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout.trim()) return resolve(false);
        try {
          const parsed: unknown = JSON.parse(stdout);
          const rows = (Array.isArray(parsed) ? parsed : [parsed]) as {
            InterfaceAlias?: string;
            NetworkCategory?: number | string;
          }[];
          // NetworkCategory: 0 = Public, 1 = Private, 2 = DomainAuthenticated
          resolve(
            rows.some(
              (r) =>
                adapterNames.includes(r.InterfaceAlias ?? '') &&
                (r.NetworkCategory === 0 || r.NetworkCategory === 'Public'),
            ),
          );
        } catch {
          resolve(false);
        }
      },
    );
  });
}
