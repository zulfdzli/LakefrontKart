# Turbo Karts

A local multiplayer kart racer. One computer shows the race on a big screen, and up to 5 players use their phones as controllers over the same Wi-Fi. No internet, accounts or app install needed.

Four flat tracks (Sunny Meadows, Dusty Canyon, Frosty Peaks and Sepang Circuit) with laps of about 80 to 95 seconds, 8 to 12 jumps and 16 to 19 rows of mystery boxes a lap, and a living event on each (sheep, a rockfall, a giant snowball, a monsoon squall). No boosts: no boost pads, no turbo items, and drifts and jumps give none. 5 items (Oil Slick, Homing Orb, Bounce Disc, Shield, Seeker Comet), a signature move for every character, weather and time of day, a phone garage to style and tune your kart, AI rivals at three difficulties, single races, a 4-race Grand Prix or Bumper Brawl, and split-screen for 1 to 5 players. See `docs/DECISIONS.md` for every design decision and `docs/POLISH.md` for the quality scorecard.

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

**Controller:** hold the phone sideways. The left side steers (◀ ▶, or a slider in Controls). The tall **BRAKE** pedal at the right edge brakes (even during a boost), **DRIFT** is held, and **ITEM** fires the moment you touch it; hold BRAKE while touching ITEM to throw backwards. The kart accelerates by itself. Sound starts on the first click or key press; **M** mutes.

**Party leader settings:** on the leader's phone, **Settings** sets the mode (single race or Grand Prix), the track, laps (1 to 3), how many AI bots race (0 to 7; a race holds up to 8 karts), AI difficulty, items on or off, and the sky. The big screen follows. Mid-race, the leader can pause and tap **BACK TO LOBBY** to end the race for everyone. The **−** and **+** buttons next to PAUSE set the steering sensitivity.

## Bumper Brawl

A battle mode next to racing: on the leader's phone, **Settings → Brawl**, then pick an arena (Meadow Fairground, Canyon Bowl or Frozen Lake). Every kart has **3 lives** (the orbs over it, the hearts on your phone).

- **Losing lives**: an Orb, Disc or Oil Slick hit costs a life. Ram a rival **while boosting** to knock off one of theirs and take it for yourself.
- **Knocked out**: lose all three and you're out; your view follows the leader until the round ends.
- **Ending**: the last kart standing wins. At 1:30 it's **sudden death** (everyone down to one life), and the round ends at 2:30 (most lives wins, then most hits landed).

## On the big screen

- **Commentator**: a voice calls the race (the start, lead changes, spins, moves, the final lap, the winner) using the computer's speech voices, with a caption at the top. **M** mutes it with everything else.
- **Crowd**: the stands murmur through the race and cheer the start, the final lap and the finish (and gasp when you crash).
- **Emotes**: get hit and your kart pulls a face in a bubble over it.

## Signature moves

Every character has a move of their own. The **MOVE** bar under ITEM and DRIFT on your phone fills as you drive well (drifting, airtime and slipstreaming charge it fastest, about a lap of good driving) and glows when it is ready; tap it to fire (**Q** on the keyboard).

| Character | Move               | What it does                                                                                 |
| --------- | ------------------ | -------------------------------------------------------------------------------------------- |
| 🐻 Bruno  | 💥 Shoulder Charge | A short lunge that shoves the kart beside you off its line                                   |
| 🐧 Pip    | 🛷 Belly Slide     | A slippery dash: a boost, and oil slides off you for 2 s                                     |
| 🤖 Zed    | ⚡ Overclock       | For 6 s the engine pulls 60% harder (top speed unchanged): first out of every corner         |
| 🦊 Mochi  | 👻 Mirage          | Vanish in a puff (a short boost), leaving a decoy that takes the next homing item            |
| 🐸 Gus    | 🦘 Hop             | A big jump on demand: over oil, rubble or sheep                                              |
| 🦉 Luna   | 👁️ Night Eyes      | For 6 s the best line glows ahead, grip is a little better, and the first Orb or Disc misses |

Each is worth about one item, and the headless races keep every character within the same 4% as without moves. **Settings → Moves** turns them off.

## Living tracks

Each race track has its own event that happens once or twice a race, just ahead of the leader. A warning on the big screen and a buzz on your phone come a few seconds before it lands:

- **Sunny Meadows: sheep.** A flock wanders across a bend. Weave through; a bump only slows you.
- **Dusty Canyon: rockfall.** Rubble blocks one half of a straight until the next lap. The warning says which side to keep to.
- **Frosty Peaks: giant snowball.** It rolls down the mountain and across the road. Time your pass or get flattened into a spin.
- **Sepang: monsoon squall.** One stretch gets soaked for a lap: less grip, and puddles.

The AI sees it coming more often on Hard than on Easy. **Settings → Track events** turns them off for classic races.

## Fun zones

Every race track has three marked stretches that reward skill (none of them is a speed boost):

- **Slalom gates.** Four cone gates, alternately right and left. Go through every one without knocking a cone and you win a free item, or a lift on your MOVE meter if your hands are full.
- **Jump target.** A bullseye where the big launch ramp comes down, off the racing line. Land on it for the same reward; your line and your speed off the lip decide where you land.
- **Draft tunnel.** A covered gallery where the slipstream charges twice as fast, racing close charges your MOVE meter, and every place you gain inside it adds more.

The AI has a go too, more often on Hard. **Settings → Fun zones** turns them off.

## Garage

On the waiting screen, tap **🎨 Garage** to make the kart yours. A 3D view of your kart turns as you edit (drag it to look around), and the big screen's lobby shows it on the grid.

- **Style**: paint and accent colour (12 each), a livery (Neon, Stripes, Flames, Checker, Camo, Pinstripe), your race number (0–99), a sticker for the nose and the shark fin, and the rim colour. Your name tag keeps your player colour, so you are still easy to spot. AI karts stay orange.
- **Tuning**: move up to 2 of your character's points between **top speed**, **acceleration** and **handling**. Every point added has to come from another stat (the garage won't close until it adds up), so no setup is faster overall, just different to drive: more speed suits the long straights, more handling the tight tracks.
- **Saved**: the phone remembers your kart for next time.

## Weather

**Settings → Sky** picks the weather: **Random** (the default, rolled fresh for every race, so a Grand Prix changes between races), **Day**, **Sunset**, **Night**, **Rain** or **Snow**. The title card shows each race's forecast.

- **Night**: karts drive with headlights and tail-lights, and lamps line both edges of the road.
- **Rain**: about 5% less grip, spray behind every kart, and puddles. Driving through a puddle wets your tyres for a moment and twitches the kart sideways (your phone buzzes), so steer around them or hit them straight.
- **Snow**: falls only on Frosty Peaks and Frozen Lake (elsewhere Snow gives rain). Grip drops slightly (2.5%), and the haze closes in.

## Racing tips

- **Slipstream**: tuck in behind a kart until "SLIPSTREAM" shows and its wake tows you a little faster, to set up a pass. (There are no boosts: no boost pads, no Turbo items, and drifts, jumps and the start give none.)
- **Guard or attack**: while you hold an Oil Slick, Homing Orb or Bounce Disc (the item box shows **GUARD**), it trails behind you and blocks one Orb or Disc. Fire it to attack, or keep it to defend a lead.
- **Jumps**: land straight to keep your speed. Purple lane ramps cover one side of the road only, so take the line over them or stay flat.
- **Drift the tight corners**: a drift slides the car round a hairpin faster than gripping it. BRAKE always slows you, and there is no braking in the air, so lift before a jump that lands into a corner.
- **Highlights**: after each race the big screen replays the best moments (big air, hits, overtakes, a photo finish) in slow motion before the podium. Any phone can tap **SKIP**.

## Keys on the computer

| Key   | What it does                                                               |
| ----- | -------------------------------------------------------------------------- |
| Enter | Start the race (lobby); skip the replay; next race (podium)                |
| Space | Skip the track intro or the highlight replay                               |
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

- **The phone shows a bare, unstyled page or "The controller didn't load"**: make sure only one `npm run dev` is running (close any other terminal still running it, Ctrl+C), then tap **Tap to retry** or refresh the page.

- The phone and the computer must be on the **same Wi-Fi network**. Guest networks and "client isolation" (AP isolation) block devices from seeing each other, so use the main network.
- Still stuck? Turn on the laptop's mobile hotspot and connect the phones to it, or use a phone's hotspot for both.
- If the QR shows the wrong address (VPN or several adapters), pick the right network in the dropdown on the host screen, or set the address yourself:
  `PUBLIC_URL=http://192.168.1.50:3000 npm run dev` (PowerShell: `$env:PUBLIC_URL="http://192.168.1.50:3000"; npm run dev`).

## Slow or choppy?

The game picks its quality automatically: High for 1 to 2 players, Medium for 3 to 4, and Low for 5. If the frame rate drops, it lowers the resolution first, then effects and shadows, and restores them when it can. On a laptop, plug in the charger and use the fast graphics chip (see above). Press F to see the frame rate.

Racing has motion blur (the road and scenery smear with speed and turning; the karts stay sharp). If it bothers you, open the host page with `?mblur=0` on the end of the address, for example `http://localhost:3000/play?mblur=0`.

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
| `npx tsx tools/weather-shot.ts`     | Every weather on every track: screenshots and frame rate            |
| `npx tsx tools/tune-report.ts`      | Garage tuning balance: lap times for each tune on every track       |
| `npx tsx tools/garage-shot.ts`      | Garage liveries on the real cars, in split screen                   |
| `npx tsx tools/garage-preview.ts`   | The phone garage's 3D preview, one shot per livery                  |
| `npx tsx tools/hazard-shot.ts`      | Each track's living event: the warning and the event as you arrive  |
| `npm run zone-report`               | Fun zones: where they are and how often the field does them         |
| `npx tsx tools/zone-shot.ts`        | Fun zones on every track: screenshots and the frame rate            |
| `npx tsx tools/moves-shot.ts`       | Each character's signature move fired in a race                     |
| `npx tsx tools/audio-clip.ts`       | Records the menu music and a race's sound to .webm files            |
| `npm run textures`                  | Regenerates the texture sets                                        |
| `npm run typecheck`                 | Type-checks every workspace                                         |
| `npm run lint` / `npm run format`   | ESLint / Prettier                                                   |

## Project layout

`shared/` holds the game logic and the network protocol (pure TypeScript). `server/` is the Express and Socket.IO relay. `host/` is the big-screen game (Three.js), and `controller/` is the phone controller. The original single-file prototype is in `prototype/`.
