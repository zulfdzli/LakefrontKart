# Turbo Karts

A local multiplayer kart racer. One computer shows the race on a big screen, and up to 5 players use their phones as controllers over the same Wi-Fi. No internet, accounts or app install needed.

Four tracks (Sunny Meadows, Dusty Canyon, Frosty Peaks and Sepang Circuit), laps of about 2 minutes, 8 items, AI rivals at three difficulties, single races or a 4-race Grand Prix, and split-screen for 1 to 5 players. See `docs/DECISIONS.md` for every design decision and `docs/POLISH.md` for the quality scorecard.

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

**How phones join:** scan the QR code (or open the URL and type the 4-letter room code), type a name and tap **JOIN**. Up to 5 phones can join. The first phone to join is the party leader (👑): it presses **START RACE**. Enter on the computer also starts. On iPhone, tap Share → "Add to Home Screen" for a full-screen controller.

**Controller:** hold the phone sideways. The left side steers (◀ ▶, or a slider in Controls). The tall **BRAKE** pedal at the right edge brakes, **DRIFT** is held, and **ITEM** is tapped; swipe down on ITEM, or hold BRAKE, to throw backwards. The kart accelerates by itself.

**Party leader settings:** on the leader's phone, **Settings** sets the mode (single race or Grand Prix), the track, laps (1 to 3), whether AI karts fill the empty places, AI difficulty, and items on or off. The big screen follows.

## Keys on the computer

| Key   | What it does                                                               |
| ----- | -------------------------------------------------------------------------- |
| Enter | Start the race (lobby); next race (podium)                                 |
| Space | Skip the track intro                                                       |
| P     | Pause or resume                                                            |
| Esc   | Back to the lobby                                                          |
| T / G | Next track / switch single race and Grand Prix (lobby)                     |
| M     | Mute                                                                       |
| F / D | Frame-rate counter / debug overlay (input latency, quality, physics lines) |
| Q     | Cycle the graphics quality (auto, High, Medium, Low)                       |

To drive from the computer's keyboard (testing), open `http://localhost:3000/?keyboard`: arrow keys steer, accelerate and brake, Shift drifts, and E throws an item (hold ↓ to throw it backwards).

## Before the first game (Windows)

1. **Set your Wi-Fi to Private.** Go to Settings → Network & internet → Wi-Fi → your network, and set "Network profile type" to **Private**. On a Public network, Windows Firewall blocks the phones. The server prints a warning when it detects this.
2. **Allow Node.js through the firewall on private networks** when Windows asks. Don't allow it on public networks.
3. **Laptops with two graphics chips** (for example an NVIDIA GPU plus integrated graphics): go to Settings → System → Display → Graphics, add Chrome, and choose **High performance**.

## Phone can't connect?

- The phone and the computer must be on the **same Wi-Fi network**. Guest networks and "client isolation" (AP isolation) block devices from seeing each other, so use the main network.
- Still stuck? Turn on the laptop's mobile hotspot and connect the phones to it, or use a phone's hotspot for both.
- If the QR shows the wrong address (VPN or several adapters), pick the right network in the dropdown on the host screen, or set the address yourself:
  `PUBLIC_URL=http://192.168.1.50:3000 npm run dev` (PowerShell: `$env:PUBLIC_URL="http://192.168.1.50:3000"; npm run dev`).

## Slow or choppy?

The game picks its quality automatically: High for 1 to 2 players, Medium for 3 to 4, and Low for 5. If the frame rate drops, it lowers the resolution first, then effects and shadows, and restores them when it can. On a laptop, plug in the charger and use the fast graphics chip (see above). Press F to see the frame rate.

## Scripts

| Command                             | What it does                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `npm run dev`                       | Dev server with hot reload; host and controller on one port         |
| `npm run build`                     | Builds the host and controller into `dist/`                         |
| `npm start`                         | Serves the production build                                         |
| `npm test`                          | Runs the Vitest tests (including the prototype parity test)         |
| `npm run sim-report`                | Headless lap times, balance, rescues and simulation cost            |
| `npm run capture -- --phase <name>` | Polish-loop screenshots and frame stats into `docs/screens/<name>/` |
| `npm run e2e -- --phase <name>`     | End-to-end multiplayer check with emulated phones                   |
| `npm run bots -- --room ABCD --n 3` | Adds simulated phones to your room (testing without 5 phones)       |
| `npm run perf -- --phase <name>`    | Frame time, draw calls and a leak check over 8 races                |
| `npx tsx tools/shimmer.ts`          | Shimmer meter: flicker under sub-pixel camera moves, with heat maps |
| `npm run textures`                  | Regenerates the texture sets                                        |
| `npm run typecheck`                 | Type-checks every workspace                                         |
| `npm run lint` / `npm run format`   | ESLint / Prettier                                                   |

## Project layout

`shared/` holds the game logic and the network protocol (pure TypeScript). `server/` is the Express and Socket.IO relay. `host/` is the big-screen game (Three.js), and `controller/` is the phone controller. The original single-file prototype is in `prototype/`.
