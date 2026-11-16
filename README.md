# Turbo Karts

A local multiplayer kart racer. One computer shows the race on a big screen, and up to 5 players use their phones as controllers over the same Wi-Fi. No internet, accounts or app install needed.

> Work in progress: phase 4 (renderer ported; single-player keyboard test drive at http://localhost:3000). See `docs/PROMPT.md` for the plan and `docs/DECISIONS.md` for decisions.

## Quick start

Needs **Node.js 22.13 or newer**.

```sh
npm install
npm run dev
```

The terminal prints three addresses:

```
Host screen:  http://localhost:3000/          ← open this on the computer
LAN URL:      http://192.168.x.x:3000/
Controller:   http://192.168.x.x:3000/play    ← phones open this (or scan the QR code)
```

Open the host screen on the computer (or press **F5** in VS Code), then scan the QR code with each phone.

## Before the first game (Windows)

1. **Set your Wi-Fi to Private.** Go to Settings → Network & internet → Wi-Fi → your network, and set "Network profile type" to **Private**. On a Public network, Windows Firewall blocks the phones. The server prints a warning when it detects this.
2. **Allow Node.js through the firewall on private networks** when Windows asks. Don't allow it on public networks.
3. **Laptops with two graphics chips** (for example an NVIDIA GPU plus integrated graphics): go to Settings → System → Display → Graphics, add Chrome, and choose **High performance**.

## Phone can't connect?

- The phone and the computer must be on the **same Wi-Fi network**. Guest networks and "client isolation" (AP isolation) block devices from seeing each other, so use the main network.
- Still stuck? Turn on the laptop's mobile hotspot and connect the phones to it, or use a phone's hotspot for both.
- If the QR shows the wrong address (VPN or several adapters), pick the right network in the dropdown on the host screen, or set the address yourself:
  `PUBLIC_URL=http://192.168.1.50:3000 npm run dev` (PowerShell: `$env:PUBLIC_URL="http://192.168.1.50:3000"; npm run dev`).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload; host and controller on one port |
| `npm run build` | Builds the host and controller into `dist/` |
| `npm start` | Serves the production build |
| `npm test` | Runs the Vitest tests (including the prototype parity test) |
| `npm run sim-report` | Headless lap times, balance, rescues and simulation cost |
| `npm run capture -- --phase <name>` | Polish-loop screenshots and frame stats into `docs/screens/<name>/` |
| `npm run typecheck` | Type-checks every workspace |
| `npm run lint` / `npm run format` | ESLint / Prettier |

## Project layout

`shared/` holds the game logic and the network protocol (pure TypeScript). `server/` is the Express and Socket.IO relay. `host/` is the big-screen game (Three.js), and `controller/` is the phone controller. The original single-file prototype is in `prototype/`.
