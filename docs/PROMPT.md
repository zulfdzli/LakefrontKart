# Prompt: Build "Turbo Karts" as a local multiplayer game (one screen + phones as controllers)

## 0. How to run this prompt (read first)

### 0.1 For me (the human), before starting
1. Create the project folder and put these files in it:
   - `prototype/index.html`: the latest single-file Turbo Karts build (from `turbokarts-prototype.html`).
   - `reference/`: my controller reference image or images (for example `reference/controller.png`).
   - `docs/PROMPT.md`: this prompt.
2. Install Matt Pocock's skills in the project: `npx skills@latest add mattpocock/skills`. This installs the whole set, including `grill-me` and the `grilling` skill it depends on (grill-me alone does nothing without `grilling`).
3. In Claude Code (VS Code), start with: `/grill-me @docs/PROMPT.md`.

### 0.2 For you (the agent): the grilling protocol
This project uses the **grill-me / grilling** method to close gaps before and during the build. Follow it exactly:

**Gate 0: before writing any code.** Run a full grilling session on this prompt, the prototype and everything in `reference/`.
- **Look up facts yourself; ask me only for decisions.** Read the prototype, open the reference images, run the prototype's logic headlessly to measure lap times, and check the tooling available. Never ask me something the files can answer.
- Ask in rounds: every question whose prerequisites are already settled goes in the current round. Number each question, give it a short title, and put your recommended answer on its own `➡️` line so I can reply by number.
- Seed the first round with at least these open decisions, and add any other gaps you find:
  1. Host hardware (laptop, TV or projector, GPU class) and phones (iOS and Android mix), which sets the graphics budget.
  2. How to read my controller reference image: which parts are binding (layout, button shapes, colours) and how to handle anything it shows that conflicts with or is missing from section 7.
  3. Default lap count, now that one lap takes about 2 minutes (section 11.1).
  4. Shading direction: keep the toon / cel look of the prototype, or move to "soft stylized PBR" (my default recommendation, section 10.2).
  5. How "realistic-ish" the track surfaces should be compared with the stylized world (section 11.3).
  6. The three track themes and their order, the item list, and the difficulty feel.
  7. What "done" means and how much time I am willing to spend on polish passes.
- The session ends when no open decisions are left **and** I confirm that we share the same understanding. Do not start building before I confirm.
- Grilling does not write files, so **you** keep `docs/DECISIONS.md`: one entry per decision with the date, question, my answer and the reason. Where `DECISIONS.md` and this prompt disagree, `DECISIONS.md` wins.

**Phase gates: after every phase in section 16.** Run a short grilling round (use the `grilling` skill) covering only **new** gaps: things this prompt does not cover, results that miss a target (tests, lap time, FPS, the polish scorecard in section 13), or trade-offs you need me to choose. Never re-ask a settled decision. If there are no new gaps, say "No open questions at this gate" and continue.

**Finish gate.** Before reporting done, run one last grilling round on the acceptance results (section 15) and the polish scorecard. Keep iterating (fix, then re-check, then grill) until every acceptance check passes, every scorecard item meets its target, and I confirm. If something cannot reach its target, tell me why and let me decide.

---

## 1. Your role and goal

You are a senior full-stack game developer and technical artist. Build a **local multiplayer kart racing game** that runs on `localhost` and is played on the same Wi-Fi:

- One **host screen** (a laptop or TV browser) shows the game.
- **Up to 5 players** join by **scanning a QR code** shown on the host screen. Each player's **smartphone becomes the controller**.
- The host screen uses **split-screen**: one view per joined player.
- **One lap takes about 2 minutes** (section 11.1).
- The look must be **smooth, polished and stylized**, with **textured, realistic-ish track surfaces** (sections 10, 11 and 13). The driving must feel **tight and smooth** (section 12).

The single-file game in `prototype/index.html` is your **starting point** (section 2). It already has characters, items, AI, a low-poly art style, effects, a menu and a podium. **Do not redesign it from scratch.** Port it into the architecture below, extend it to multiplayer, then raise the graphics and gameplay well beyond it.

Work in the phases in section 16, and use the grilling gates in section 0.2. After each phase, run the project, verify it, run the polish loop (section 13) and fix problems before moving on. Between gates, make sensible decisions yourself, log them in `docs/DECISIONS.md`, and keep going.

---

## 2. The starting point: what `prototype/index.html` already has

Read the whole file before changing anything. It is one HTML file using **Three.js r128 from a CDN** and the **Fredoka** font from Google Fonts.

**Important:** the prototype's rendering code was written without being run in a real browser with WebGL. Its game logic was tested headlessly, but its 3D graphics were not. **Your first task (phase 1) is to open it in a real browser, take screenshots, and list and fix any visible rendering bugs** before porting it.

### 2.1 Game logic (pure, headless-testable)
The logic sits between the markers `//#LOGIC-START` and `//#LOGIC-END`. It has no DOM or Three.js code.
- **Loop**: fixed timestep `STEP = 1/60`, `stepWorld(dt)`. Each kart stores its previous transform (`px, pz, py, ph`) so the renderer interpolates.
- **Track**: a closed Catmull-Rom spline (14 control points, scaled by 0.8), resampled to 400 points about 3.2 m apart, so the lap is about **1.28 km**. Per sample it has a tangent and right vector (`TX/TZ`, `RX/RZ`), heading `ANG`, height `H` (about ±8 m of hills, slopes up to 0.13), slope `SL`, curvature `CURV` and a smoothed **racing line** `RLINE`. Road half-width is 13 m, kerbs 2.2 m, walls at 25 m from the centreline.
- **Characters**: 6 originals (Bruno the bear, Pip the penguin, Zed the robot, Mochi the fox, Gus the frog, Luna the owl). Each has 15 stat points spread over speed, acceleration, handling, weight and drift, which map to top speed, acceleration, turn rate, collision mass and drift charge rate.
- **Kart physics**: arcade forward speed plus lateral slip, with grip that converts sideways slide back into forward speed. Slopes affect speed. Off-road slows the kart.
  - **Drift**: hop at the start, counter-steer to adjust the arc, and three charge tiers that give turbos of 0.7, 1.2 or 1.9 s. Total boost is capped at 3 s.
  - **Walls**: the kart slides along with friction based on the impact angle, and its nose is turned to follow the wall so it can't get pinned.
  - **Collisions** between karts use mass-based impulses.
  - **Slipstream**: staying close behind another kart for 1 s raises top speed by 4.
  - **Rocket start**: press DRIFT within 0.35 s before GO, or 0.25 s after it. Pressing too early stalls the kart.
- **Items** (6, weighted by race position): Turbo, Triple Turbo, Oil Slick, Homing Orb (fired forward, or backward while holding brake), Bounce Disc (bounces off walls up to 3 times) and Shield (lasts 10 s and blocks one hit). There are 7 rows of 4 item boxes and 4 boost pads. A hit spins the kart out for 1.2 s, followed by 2 s of protection.
- **Race rules**: a rescue drone recovers a kart that is stuck (2.5 s), or an AI kart that is going the wrong way (2.5 s) or has lost the racing direction (3 s). There is a wrong-way warning, lap times and best lap, and rankings.
- **AI**: follows the racing line with a personal lane offset, avoids oil slicks, swerves to overtake, slows for corners based on the turn angle ahead, and drifts and uses items sensibly. It slows down whenever its target point is far off its nose, which stops a bug where AI karts orbited in circles. Rubber-banding is mild. There are three difficulty tables (Easy, Normal, Hard).
- **Measured headlessly**: a lap takes about 48 to 50 s. Character median lap times are within about 4% of each other. With items off, a steady test driver averages about 2nd place on Easy, 3rd on Normal and 4th to 5th on Hard. In 150 simulated races, every kart finished.
- **Events**: the logic pushes events to `G.events`, and the renderer and audio react to them: `cd, go, boost, pad, perfect, stall, pickup, item, useturbo, useoil, useorb, usebolt, useshield, shieldpop, hit, orbhit, bolthit, orbpop, boltbounce, bump, draft, driftstart, driftlevel, rescue, lap, finish`. Keep this pattern.

### 2.2 Rendering, UI and audio
- **Shading and models**: flat-shaded low-poly models built in code with merged vertex-coloured geometry, `MeshToonMaterial` with a 3-step gradient, and inverted-hull outlines on the karts.
- **Environment**:
  - Sky and terrain: a gradient sky shader with a sun, fog, and a terrain heightfield with hills, a pond, and rock and snow on the high ground.
  - Track surfaces: canvas-drawn road, kerb, grass and wall textures.
  - Landmarks: a start gantry with bunting, a grandstand with a bouncing crowd, a windmill, a podium, balloons and clouds.
  - Scenery: mountains, corner arrow signs, tyre stacks, and instanced trees, bushes, rocks and flowers.
- **Effects**: one PCF shadow map that follows the player, and adaptive quality (it turns shadows off first, then lowers the pixel ratio). Particles are instanced low-poly chunks. There are also skid marks, boost shockwave rings, a speed-lines overlay, flames, a shield bubble, dizzy stars and a rescue drone.
- **Screens**: a menu (character cards with stat bars, difficulty, laps), countdown lights, a HUD (place, lap, time, item roulette, minimap, drift bar, speed, wrong-way and slipstream tags), a pause menu, and a results screen with a 3D podium ceremony.
- **Audio**: all sound is generated with WebAudio: engine, tyre squeal, sound effects, and a step-sequencer music loop that speeds up on the final lap.

### 2.3 Limits you must fix while porting
- It supports one human only (`G.player`). This must become an array of human-controlled karts.
- `Math.random` is used everywhere. Replace it with a seeded RNG owned by the game state.
- Three.js r128 and fonts load from a CDN. Port to the current Three.js from npm (color-management and API changes) and bundle everything locally, so the game works with **no internet**.
- One short track, about 50 s per lap. It needs to become about 2 minutes (section 11.1).
- The toon look and the flat canvas road textures are a starting point, not the target (sections 10 and 11).

---

## 3. Tech stack (required)

- **Node.js 20+**, **TypeScript** everywhere (`strict: true`).
- **Server**: Express + **Socket.IO** (WebSocket transport first, polling as fallback).
- **Host display app**: TypeScript + **Three.js** (npm package, current stable) + plain DOM/CSS for HUD.
- **Controller app (phone)**: plain TypeScript + HTML + CSS (React is not needed). It must be tiny and load fast.
- **Bundler**: **Vite**. In development, run Vite in **middleware mode inside the Express server**, so **one port** serves everything. This matters because phones must reach the dev server too.
- **QR code**: the `qrcode` npm package, rendered as an SVG or canvas on the host screen.
- **Tests**: Vitest for the shared game logic (headless simulation).
- **Graphics helpers**: Three.js examples (`three/examples/jsm/utils/BufferGeometryUtils`) for merged geometry; optional `postprocessing` or Three.js `EffectComposer` for bloom on the High tier only; a bundled font through `@fontsource/*`. Everything is installed from npm and bundled. No CDN at runtime.
- **Package layout**: npm workspaces (`shared`, `server`, `host`, `controller`).
- No cloud services, no accounts, no database.

---

## 4. Architecture and authority model

```
Phones (controllers)  --Socket.IO-->  Node server (room relay)  --Socket.IO-->  Host screen (game)
        input only                          no game logic                    runs the simulation
                      <------------ feedback (item, place, lap, haptics) ------------
```

- **The host screen is authoritative.** It runs the full simulation (the shared logic), renders all viewports and plays audio.
- **The server is a thin relay.** It creates rooms, tracks connected sockets, assigns player slots, forwards messages and serves the static apps. It does **not** simulate the game.
- **Phones are UI-only.** They send input and display small status info sent back by the host. They never run physics.
- Put the game logic in `shared/` (pure TypeScript, no DOM, no Three.js). The host imports it. Vitest tests import it.

### Folder structure

```
turbo-karts/
  package.json              (workspaces, scripts)
  README.md
  prototype/index.html      (single-file starting point, read-only reference)
  reference/                (my controller reference image(s), read-only)
  docs/
    PROMPT.md               (this prompt)
    DECISIONS.md            (grilling decisions; overrides the prompt)
    POLISH.md               (polish scorecard per phase)
    screens/<phase>/        (captured screenshots)
  tools/
    gen-textures.ts         (procedural texture sets baked to PNG)
    capture.ts              (Playwright screenshot capture)
    sim-report.ts           (headless lap times, balance, rescues)
    racing-line.ts          (precompute AI racing lines)
  shared/src/
    protocol.ts             (all Socket.IO event names and payload types)
    rng.ts                  (seeded RNG, e.g. mulberry32)
    track.ts                (track generation)
    game.ts                 (GameState, stepWorld, kart physics, items, AI, ranking)
    constants.ts
    characters.ts           (character stats and ids)
    items.ts                (item definitions and rules)
    tracks/                 (TrackDef data: meadows.ts, canyon.ts, frosty.ts)
    ai-lines/               (precomputed racing-line data per track)
  server/src/
    index.ts                (Express, Socket.IO, Vite middleware, LAN URL detection)
    rooms.ts                (room and slot management)
  host/
    index.html
    public/textures/        (generated, committed texture sets)
    src/
      main.ts
      lobby.ts              (QR, slots, ready states)
      renderer.ts           (scene, per-player cameras, split-screen viewports)
      hud.ts                (per-viewport HUD)
      audio.ts              (sfx, engine, procedural music)
      net.ts
      art/
        palette.ts
        materials.ts        (stylized PBR, splat terrain shader, outlines)
        post.ts             (post-processing per quality tier)
        kart.ts             (KartAssetProvider, procedural characters)
        track-builder.ts    (TrackDef to meshes)
        scenery.ts          (instanced props)
        sky.ts
        effects.ts          (pooled particles, skid marks, speed lines)
      debug.ts
  controller/
    index.html
    src/
      main.ts
      ui.ts
      net.ts
  tests/
    game.test.ts            (headless race, determinism, lap counting)
```

---

## 5. Networking details

### 5.1 Making phones able to connect
`localhost` does not work from a phone. The QR code must contain the host computer's **LAN address**.

- The server listens on `0.0.0.0` at `PORT` (default `3000`).
- Detect the LAN IPv4 address with `os.networkInterfaces()`. Ignore internal, IPv6 and virtual adapters (Docker, WSL, VPN, `169.254.x.x`). Prefer `192.168.x.x`, then `10.x.x.x`, then `172.16-31.x.x`.
- If several candidates exist, show a small dropdown on the host lobby so the user can choose, and re-render the QR when it changes.
- Support the environment variable `PUBLIC_URL` to override detection.
- On startup, print the host URL, the LAN URL and the controller URL in the terminal.
- The QR encodes: `http://<lan-ip>:<port>/play?room=<CODE>`.
- Also show the URL and the 4-letter room code as text under the QR code, as a fallback for typing.

### 5.2 Rooms
- When the host page opens, it sends `host:create`. The server generates a **4-letter room code** (uppercase, no `I`, `O`, `0`, `1`) and returns it.
- The host stores a `hostToken` in `sessionStorage`. If the host page is refreshed, it sends `host:resume` and keeps the same room and players.
- Only one host per room. Rooms are deleted 10 minutes after the host disconnects.

### 5.3 Protocol (define all of this in `shared/src/protocol.ts` with TypeScript types)

Controller to server:
- `player:join` `{ room, name, playerToken? }` — `playerToken` is a random id kept in the phone's `localStorage`, used to reconnect to the same slot.
- `player:ready` `{ ready: boolean }`
- `player:input` `{ seq, steer, throttle, brake, drift, item }` — `steer` is -1..1; booleans are held states; `item` is a one-shot press flag.
- `player:start` `{}` — only accepted from the party leader (first player to join).
- `player:rematch` `{}` — only from the party leader, on the results screen.
- `player:select` `{ characterId }` — pick a character (rejected if already taken).
- `player:settings` `{ steering: 'buttons' | 'slider', assist: boolean }` — personal controller settings.
- `leader:config` `{ mode, trackId or gpOrder, laps, aiFill, aiDifficulty, itemsOn }` — only from the party leader.
- `item:use` is sent as part of `player:input` using `item: 'forward' | 'back' | null`.
- `ping` / `pong` for latency display.

Server to controller:
- `join:ok` `{ playerId, slot, color, name, isLeader }`
- `join:error` `{ reason: 'room-not-found' | 'room-full' | 'race-in-progress' | 'name-taken' }`
- `lobby:update` `{ players: [{ slot, name, color, ready }] }`
- `phase` `{ phase: 'lobby' | 'countdown' | 'race' | 'results' }`
- `hud` `{ place, totalRacers, lap, laps, item, boosting, drifting }` — sent by the host through the server, at about 10 Hz and on change.
- `haptic` `{ kind: 'hit' | 'boost' | 'item' | 'finish' }`
- `results` `{ standings }`

Host to server and onward: `host:create`, `host:resume`, `host:state` (phase, HUD data per player), `host:kick` `{ slot }`.

### 5.4 Input handling rules
- Controllers send input **only when it changes**, plus a heartbeat every 100 ms. Cap at 60 messages per second.
- Use `volatile` emits for `player:input` (dropping an old input is fine).
- The host applies the **latest** input per player each simulation step.
- If no input arrives for 500 ms, treat steering as 0 and drift/brake as false, but keep throttle on (auto-accelerate), so a laggy phone does not stop the kart dead.
- If a phone disconnects mid-race, **an AI takes over that kart** until the phone reconnects with the same `playerToken`. Show a small "reconnecting…" badge in that viewport.
- If the host disconnects, controllers show "Waiting for host…" and reconnect automatically.

---

## 6. Host screen (the game display)

### 6.1 Lobby screen
- Big title, **QR code**, room code, the URL as text, and the network picker if needed.
- **5 player slots** shown as cards with kart colour, name, ready state, and connection state. Empty slots show "Scan to join".
- Fixed slot colours: P1 red `#e53935`, P2 blue `#1e88e5`, P3 yellow `#fdd835`, P4 green `#43a047`, P5 purple `#8e24aa`. AI karts are orange.
- A 3D preview (slowly orbiting camera on the start grid) behind the lobby UI is welcome, using the existing menu camera code.
- **Minimum 1 player** to start. Start with: the party leader's **START** button on their phone, or **Enter** on the host keyboard. Show "Waiting for players…" until at least one has joined.
- Fill remaining kart slots with **AI drivers so there are always 6 karts total**. With 5 humans there is 1 AI. Add a lobby toggle "AI fill: on/off". If off, race only the humans.
- The lobby shows each player's chosen **character** (locked when taken), the selected **mode, track, laps and difficulty**, and a **track preview**.
- Players can join and leave freely in the lobby. Joining is locked once the countdown starts (new scans get `race-in-progress` and a friendly message on the phone).

### 6.2 Split-screen
Use **one Three.js scene and one renderer**, with **one camera per human player**. Render each viewport with `renderer.setViewport`, `renderer.setScissor` and `renderer.setScissorTest(true)`, once per player per frame. Note that Three.js viewport and scissor rectangles use a **bottom-left origin in CSS pixels**, so convert from top-left layout rectangles.

Layout for a **landscape host display** (fractions of the screen; leave a 4 px gutter between viewports, drawn in dark colour):

| Players | Layout |
|---|---|
| 1 | one full-screen view |
| 2 | two views side by side (left / right), each full height |
| 3 | top row: 2 views; bottom row: 1 view centred at the same size as the top views (the empty quarter shows the shared minimap and race standings panel) |
| 4 | 2 x 2 grid |
| 5 | top row: 3 views; bottom row: 2 views centred; the empty slot shows the shared minimap and standings panel |

Rules:
- The layout is recomputed from the number of **human players** when the race starts, and on window resize. It is fixed during a race, even if someone disconnects (their kart becomes AI-driven and the viewport stays, showing the reconnecting badge).
- Each camera gets its **own aspect ratio** from its viewport. Adjust the vertical FOV when the viewport is narrower than tall (like the prototype's `baseFov` logic).
- Every viewport has a **player-colour border** and its own HUD overlay: place (1st/6), lap, race time, item slot with roulette animation, speed, drift charge bar, centre messages (3-2-1-GO, FINAL LAP, OUCH, BOOST). Build the HUD as absolutely positioned DOM elements aligned to each viewport rectangle (one HUD container per player, created from a template).
- Show a **shared minimap** with all karts as coloured dots, and a small live **standings list**, in the spare slot (3 and 5 players) or as a small overlay in the screen centre (1, 2 and 4 players).
- Cameras: keep the prototype's chase camera (smoothed heading, speed-based FOV and distance). After a player finishes, their viewport switches to an automatic orbit or follow-leader camera with a "FINISHED 2nd" banner.

### 6.3 Performance (important with up to 5 views)
- Target **60 FPS** on a mid-range laptop with 5 viewports. Budget the draw calls.
- Share all geometry and materials between kart meshes. Use `InstancedMesh` for scenery (as the prototype does). Shadows and post effects follow the quality tiers in section 10.2.
- Particles: shared instanced particle pools (as in the prototype). Cull particle emission for karts that no player can see.
- Use `renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))` by default. Add **adaptive resolution**: if the average frame time stays above 18 ms for 2 seconds, lower the pixel ratio in steps (down to 0.75), and raise it again if there is headroom. Show an FPS counter toggled with the `F` key.
- Lower the far plane and fog distance when more than 3 viewports are active.

### 6.4 Race flow on the host
1. Lobby, then countdown 3-2-1-GO (all phones vibrate on GO where supported).
2. Race over the chosen number of laps (1, 2 or 3, about 2 minutes each). Each human has their own lap and position.
3. The race ends when **all humans have finished**, or **30 seconds after the first human finishes** (whichever comes first). Remaining karts are ranked by progress.
4. Results screen: standings with kart colours, names and times, "best lap" highlight, and a **Race again** button (or leader's phone button, or Enter on the host).
5. Rematch returns to the lobby (keeping players and slots) or restarts directly. Offer both: "Race again" and "Back to lobby".

### 6.5 Audio
Port the prototype's WebAudio sound effects and music (then improve them per section 10.5). The browser requires a user gesture first, so the lobby needs a "Click to enable sound" interaction. For multiplayer, play global sfx (countdown, GO, finish), and play per-kart sfx (boost, hit, item) at lower volume. Keep one engine tone driven by the fastest human kart. Add a mute key (`M`).

### 6.6 Host keyboard shortcuts
`Enter` start / rematch, `Esc` back to lobby, `M` mute, `F` FPS counter, `P` pause (pauses the simulation and tells phones the phase is `paused`).

---

## 7. Controller app (the phone)

URL: `/play?room=CODE`. It must work on current iOS Safari and Android Chrome over plain **HTTP on the LAN**.

### 7.0 Reference design: the `reference/` folder
- Before designing any controller screen, **open every image in `reference/`** (for example `reference/controller.png`). Write a short description of what you see in `docs/DECISIONS.md`: orientation, button positions and sizes, shapes, colours, icons, text, background and any HUD on the phone.
- **The reference image decides the look and layout** of the driving screen (and of other phone screens, if shown). **This section decides the functions**: every control listed in 7.2 must exist.
- If the image is missing a required control, has controls with unclear functions, or conflicts with this section, raise it at the next grilling gate with a recommendation. Do not guess silently.
- Adapt the image faithfully to real phones: safe areas and notches, both iOS and Android, a range of screen sizes, and touch targets of at least 72 px.
- If `reference/` is empty or missing, stop and ask me for the image before building the controller UI.
- Acceptance: put a screenshot of the built controller next to the reference image in `docs/screens/controller-vs-reference.png`.

### 7.1 Join flow
1. Opens from the QR code. If `room` is in the URL, skip code entry; otherwise show a code field.
2. Name field (max 10 characters, remembered in `localStorage`, default "Player N"). Big **JOIN** button.
3. Waiting screen: shows the player's colour, name, and a **READY** toggle. The party leader also sees **START RACE**.
4. Errors (room full, race in progress, host offline) are shown clearly with a retry.

### 7.2 Driving screen (landscape)
The look and layout follow the reference image (7.0). The functions below are required.
- Lock to landscape where possible. In portrait, show a full-screen "Rotate your phone" overlay.
- Layout (thumbs on the edges):
  - **Left side**: steering. Offer two schemes selectable in a small settings sheet: (a) two big **◀ ▶** buttons, (b) a horizontal **drag slider** that gives analog steering from -1 to 1. Default to (a).
  - **Right side**: a large **DRIFT** button (hold), an **ITEM** button showing the current item icon (tap = fire forward; hold BRAKE or swipe down on it = fire backward, matching section 12.3), and a small **BRAKE** button.
- The kart **accelerates automatically**. Holding BRAKE slows or reverses.
- Top strip: player name and colour, race position (e.g. "3rd/6"), lap (e.g. "2/3"), item icon, and a ping indicator.
- **Haptics**: use `navigator.vibrate` where supported (Android) for hit, boost, item and finish. It silently does nothing on iOS.
- Flash the screen border in the player's colour on boost, and red on hit.
- Make it **multi-touch safe**: use Pointer Events with `setPointerCapture`, `touch-action: none`, `user-select: none`, `-webkit-touch-callout: none`. Block double-tap zoom, pinch zoom and pull-to-refresh. Release all held states on `pointercancel`, `blur` and `visibilitychange`.
- Request **fullscreen** on the first tap where allowed, and try the **Screen Wake Lock API**. It needs a secure context, so on plain HTTP over the LAN it will probably be unavailable. Fall back gracefully and show a one-time tip: "Set your phone's auto-lock to Never while playing".
- **Do not rely on the gyroscope or motion sensors.** iOS requires HTTPS for them. Touch buttons only.
- After finishing, show the result ("You finished 2nd"), then the standings, then **Race again** for the leader and "Waiting for leader…" for others.
- Reconnection: if the socket drops, show "Reconnecting…", retry automatically with the saved `playerToken`, and return to the same slot.

---

## 8. Game logic changes needed for multiplayer

In `shared/src/game.ts`:

1. Replace `G.player` with `G.humans: Kart[]` plus a `slot` field on each kart (0-4) and an `ai: boolean` flag (`true` for AI-driven, including disconnected humans).
2. Kart creation takes a list of human slots and an AI-fill count. Starting grid positions follow join order (P1 in the best available slot), then AI karts fill the rest. Use the existing two-column grid.
3. `stepWorld` applies each human's latest input from `G.inputs[slot]`. AI karts (and disconnected or finished humans) use `aiInput`.
4. AI **rubber-banding** should compare against the **average progress of the humans** instead of a single player.
5. Race end rules from section 6.4. Track `finishTime`, `bestLap` and per-lap times for each kart.
6. Replace all `Math.random()` with a seeded RNG in the state. Add a `seed` to `GameState`. Same seed plus same inputs must give the same result.
7. Keep the events system. Each event carries the kart so the host can route feedback to the right phone (`haptic`, `hud`).
8. Export a clean API: `createGame(opts)`, `setInput(slot, input)`, `step(dt)`, `drainEvents()`, `getSnapshot()`.

Start from the prototype's physics constants and feel, then apply the upgrades in section 12. Keep a regression test that shows the base handling still feels the same before the tuning changes.

---

## 9. Visual and UX requirements

- The visual target is **section 10** (polished, smooth, stylized) with **section 11** track surfaces. The prototype's look is the floor, not the ceiling. Do not copy Nintendo characters, tracks, music or names. Everything stays original.
- Give each player kart its **slot colour** (as a stripe or decal, while the character keeps its own body colour) and a small floating **name tag** above each kart: a camera-facing sprite, visible from all viewports, fading beyond 60 m.
- Smooth UI: all menus and overlays animate with springs or CSS transitions. Nothing pops in without a transition.
- Accessibility: large tap targets on the phone (at least 72 px), high contrast, readable at arm's length.

---

## 10. Art direction: smooth, polished stylized graphics

Keep the cheerful, toy-like, original identity of the prototype, but **always push the look smoother and more polished**. Every phase must leave the game looking better than the previous one (see the polish loop in section 13).

### 10.1 Style target
- **Stylized, not cartoon-flat**: chunky, readable shapes with **bevelled edges and smooth shading** where surfaces are curved (kart bodies, characters, rocks, trees). Keep a deliberate low-poly feel on distant scenery. The overall feel is "modern stylized racer": clean silhouettes, soft light, rich but harmonious colour.
- Readable in the smallest split-screen viewport (a fifth of the screen): the road, the karts and incoming items must always stand out.
- Keep every colour in `host/src/art/palette.ts`, with named swatches per theme.

### 10.2 Rendering pipeline (current Three.js from npm)
- **Colour management**: `renderer.outputColorSpace = THREE.SRGBColorSpace`, colour textures flagged as sRGB, and **ACES Filmic tone mapping** with tuned exposure. Colours must match the palette.
- **Materials**: **soft stylized PBR** by default, unless the grilling session decides otherwise.
  - Karts: `MeshStandardMaterial`, or `MeshPhysicalMaterial` with clearcoat for kart paint on the High tier.
  - Characters: soft, fairly rough materials, with a subtle rim light and an optional thin outline.
  - Image-based lighting: a small generated environment map (`PMREMGenerator` with `RoomEnvironment`, or a gradient sky render) so reflections and ambient light look rich.
- **Smoothness**:
  - No jaggies: MSAA on the render target or SMAA/FXAA post-processing.
  - Texture filtering: mipmaps, and anisotropy of 8 or more on the road.
  - Stability: no shimmering, no z-fighting (use polygon offset for decals), no popping (LOD with fades or dithered transitions).
- **Lighting and shadows**:
  - A hemisphere light plus a sun with **soft shadows** (PCFSoft or VSM), using a cascaded or player-following shadow camera. For split-screen, render shadows per viewport on High and fall back to contact or blob shadows on Low.
  - **Ambient occlusion** (SSAO or GTAO) on the High tier, and baked AO in vertex colours for props on every tier.
- **Post-processing** on High and Medium (`postprocessing` package or `EffectComposer`):
  - Effects: bloom on boosts and sparks, slight colour grading, a vignette, and motion blur only while boosting.
  - Off switch: everything can be disabled on Low.
- **Sky and atmosphere**: a gradient sky with sun glow, soft volumetric-looking clouds (billboards or merged geometry with soft shading), height fog that matches the sky, and distant mountains that fade into the haze.
- **Quality tiers** chosen automatically from the number of players and measured FPS (override with `Q`):

| Tier | Used when | Enabled |
|---|---|---|
| Low | 5 players or a slow GPU | contact or blob shadows, FXAA, no SSAO, fewer particles, pixel ratio 0.75 to 1 |
| Medium | 3 to 4 players | soft shadows, SMAA, bloom, full particles, pixel ratio 1 to 1.25 |
| High | 1 to 2 players | cascaded soft shadows, SSAO, MSAA or SMAA, bloom, clearcoat, pixel ratio up to 1.5 |

### 10.3 Karts and characters (`host/src/art/kart.ts`)
- Start from the prototype's 6 characters and kart shapes. Rebuild them with **more geometric detail and bevels**:
  - Kart: rounded body panels, a seat, a steering wheel, a number plate with the slot colour, tyres with tread and sidewall detail, and hubcaps.
  - Drivers: smoother heads, eyes with highlights, simple hands on the wheel.
- Budget: up to 4,000 triangles per kart plus driver on High. Provide a lower-detail version for distant karts.
- **Procedural animation** (keep and polish everything from the prototype): suspension spring, body roll and pitch, wheel spin and steering, head look into turns, drift lean, boost lean-back, squash and stretch on hits and landings, dizzy stars, podium celebration and a sad pose. Add hands turning the wheel and a blink.
- Keep the `KartAssetProvider` interface with a `procedural` implementation and a `gltf` stub, so hand-made `.glb` models can replace the procedural ones later.

### 10.4 Visual effects (all pooled, no per-frame allocations)
- **Boost**: flame and a coloured trail by tier, a shockwave ring, and speed lines.
- **Drift and tyres**: sparks with three colour tiers, tyre smoke, and skid marks as fading ribbon decals that follow the road height.
- **Surfaces**: surface-specific dust, gravel, sand, snow and water spray.
- **Items and hits**: item box shatter, pickup sparkle, hit stars, a screen-edge flash on the hit player's viewport, the orb explosion and the oil splat.
- **Finish**: confetti, fireworks and the podium scene.
- **Camera feel**: camera shake on hits and landings, and an FOV kick on boost.
- Soft particles: particles fade where they meet geometry, with no hard intersections.

### 10.5 UI and audio
- Bundle the Fredoka font (or another chunky rounded font) through `@fontsource/*`. **No CDN fonts.**
- Bubbly icons, springy place-change pop-ups, countdown lights and clean character cards. The phone controller uses the same font, colours and icons as the host.
- Keep and improve the procedural WebAudio:
  - Engine with gear steps, tyre squeal and surface-specific rolling sounds.
  - Item sounds.
  - Original music per track that speeds up on the final lap and ducks under big sound effects.

### 10.6 Art budget and checks
- For 5 viewports: at most about 400 draw calls and 600k triangles per frame on Low or Medium. Show these numbers (from `renderer.info`) in the debug overlay.
- Dispose of geometries, materials and textures when switching tracks. Check for leaks by loading each track 5 times in a row.

---

## 11. Tracks: about 2-minute laps, textured and realistic-ish surfaces

### 11.1 Lap length: about 2 minutes
- **Target lap time: 115 to 125 s**, measured headlessly with the Normal-difficulty AI (median of at least 10 laps) and with a steady test driver (the prototype's autopilot with skill 0.93). Every track must hit this.
- **Reach it by making tracks longer, not by making karts slower.** The prototype's speeds feel right, and it averages about 26 m/s, so each track needs a centreline of roughly **3.0 to 3.4 km**. Increase the number of track samples to keep about 3 m spacing.
- Make a long lap stay interesting:
  - Split each track into **3 or 4 sectors**, each with its own scenery and its own signature feature (a bridge, a tunnel, a jump, a hairpin complex, a fast sweeper, an elevation change).
  - Show sector split times in the HUD.
- Scale everything with length: item box rows about every 350 to 450 m, boost pads, checkpoint gates, corner signs and the minimap.
- Laps per race: offer 1, 2 or 3. The default is decided in grilling (2 is my starting suggestion). With 2-minute laps, the race-end rule in section 6.4 uses **30 s** after the first human finishes.

### 11.2 Track data and builder
- A track is **data**: a `TrackDef` in `shared/src/tracks/` with theme, control points (`x, z, height, width, banking`), sectors, surface zones, boost pads, jump ramps, item rows, ordered checkpoint gates, prop rules, landmarks, music id and AI line hints. One generic builder turns a `TrackDef` into meshes and into the physics lookup tables.
- **3 tracks**, each with at least one hairpin, one S-bend, one long straight with a boost pad and one risk/reward shortcut:
  1. **Sunny Meadows**: the prototype's world, grown to full length.
  2. **Dusty Canyon**: sand, rock arches, a tunnel, a jump ramp.
  3. **Frosty Peaks**: snow, pines, icy low-grip patches and a twilight sky.
- **Elevation and banking**: karts follow the ground height, pitch and roll. Physics stays 2D plus derived height and slope, so it stays deterministic.
- **Jump ramps**: a short airborne state. Landing straight gives a small boost.
- **Surfaces**: asphalt, kerb, gravel trap, grass, dirt, sand, snow, ice and boost pad. Each has its own grip, top speed, particles and sound.

### 11.3 Textured, realistic-ish surfaces (stylized world, believable ground)
The world stays stylized, but **the ground the karts drive on should read as real material up close**.
- **Road**: asphalt with an **albedo, normal and roughness texture set**.
  - Surface detail: visible aggregate, darker rubbered-in racing line, patch repairs and fine cracks, painted edge and centre lines with wear, and subtle puddle sheen on Frosty Peaks.
  - Tiling: use world-space UVs plus a **macro variation texture** so the tiling never repeats visibly.
- **Kerbs**: bevelled, raised kerb geometry with red/white paint, chips and rumble ridges, not a flat strip.
- **Run-off**: gravel traps with a gravel texture (and small instanced stones near the camera), grass verges with clumps, and dirt edges where the road meets grass.
- **Terrain**: a splat-blended material (a custom shader through `onBeforeCompile`, or a node material) mixing grass, dirt, rock and snow by **slope, height and painted masks**, each layer with normal detail. It should blend smoothly into the shoulders without a visible seam.
- **Track-side detail**:
  - Barriers: Armco barriers or concrete walls with stripes, tyre walls at corners, and catch fences on fast sections.
  - Furniture: marshal posts, light poles, distance boards before hairpins, and fictional sponsor banners.
- **Decals**: skid marks, oil stains, painted grid slots at the start, and the start/finish checkerboard, all with polygon offset.
- **Textures**: generate them **procedurally** with a script (`tools/gen-textures.ts`, seeded noise baked to PNG, 1024 to 2048 px with mipmaps). Commit the results under `host/public/textures/`, so they are bundled locally, can be tuned, and never load from a CDN. Low tier uses smaller versions.

---

## 12. Polished mechanics and a smooth game feel

The prototype already has the core feel (section 2.1). Keep it, port it, and make it **tighter, fairer and smoother**.

### 12.1 Smoothness foundations
- Keep the fixed 60 Hz simulation with an accumulator (at most 5 substeps per frame) and **render interpolation** (already in the prototype). Motion must be smooth at 60, 120 and 144 Hz.
- All camera and UI smoothing is frame-rate independent (`1 - exp(-k * dt)` or critically damped springs). The chase camera has look-ahead, speed-based pull-back, collision avoidance against scenery, and no snaps on spin-outs, rescues or landings.
- **Input latency budget**: under 50 ms from a phone tap to the kart reacting on the host over a normal home LAN. Measure it (timestamped input, ping) and show it in the debug overlay.
- **Steering from phones**: a dead zone, an exponential response curve and speed-sensitive steering. Smooth the input on the host so network jitter never makes the kart twitch. Offer a **Steering assist** toggle.
- **Instant feedback on the phone** (press animation and haptic) before any network round trip.
- No allocations in hot paths. Pool vectors, particles, events and projectiles.
- Pause the simulation when the host tab is hidden.

### 12.2 Handling
- Replace the grip logic with a simple **tyre slip-angle curve** (peak, then soft fall-off), so slides are predictable and recoverable. Keep a regression test that the prototype's baseline feel is preserved before tuning changes.
- Keep the character stats (equal points). Median lap times per character must stay within **4%** on every track.
- **Drift**: the hop, counter-steer, three tiers, and a small bonus for releasing exactly as a tier is reached. Tier changes are obvious through sparks, sound and a phone vibration.
- **Keep from the prototype**: wall sliding, mass-based collisions with no jitter or sticking, slipstream, rocket start and the boost cap.
- Surfaces, slopes, ramps and banking apply to all karts, including AI.

### 12.3 Items
Keep the prototype's 6 items and add two:

| Item | Behavior |
|---|---|
| Turbo | one boost of 1.6 s |
| Triple Turbo | three uses of 1.0 s each |
| Oil Slick | drops behind, spins out the first kart that hits it |
| Homing Orb | follows the track toward the next kart ahead (or behind when fired backward) |
| Bounce Disc | travels straight, bounces off walls up to 3 times |
| Shield | blocks one hit, lasts 10 s |
| Rocket Booster (new) | a long boost, only for the last 2 positions |
| Seeker Comet (new) | rare, hunts the leader with a 2 s warning; can be dodged with a Shield or a boost; never in lap 1 |

- **Controls**: tap ITEM to fire forward, and hold BRAKE (or swipe down on the item button) to fire backward.
- **Fairness rules**: protection after a hit, no stacked spin-outs, warnings for incoming projectiles, and AI never gets better items than a human in the same position.

### 12.4 Race rules
- **Ordered checkpoint gates**: a lap only counts after passing every gate in order.
- Keep from the prototype: the wrong-way warning and the rescue drone. Also rescue karts that are off-track for 4 s or fall out of bounds.
- Show position-change pop-ups and a FINAL LAP banner with a music change. Add a photo-finish slow-motion when two karts finish within 0.2 s, and a race intro (track flyover, then the grid).

### 12.5 AI
- **Three difficulty levels**, with a clear gap. With items off, the AI's average lap times must order Hard < Normal < Easy, with at least 3% between levels.
- Each track ships a **precomputed racing line** (a script that smooths it to reduce curvature). AI follows it with human-like imperfections, with more mistakes on Easy.
- Keep the prototype's AI fixes (wall alignment, anti-orbit slow-down, rescue when lost). The AI drifts, uses pads and items sensibly, dodges hazards and overtakes without ramming. Rubber-banding stays mild (at most about 5%).

### 12.6 Modes and flow
- **Single race** and **Grand Prix** (all 3 tracks). Points are 15, 12, 10, 8, 6 and 4. Show standings between races and end with a trophy ceremony.
- The party leader's phone chooses: mode, track, laps, AI fill, difficulty, and items on or off. Every player picks a unique character.

### 12.7 Game-feel checklist
Hit-stop of about 60 ms on big hits, camera shake scaled to impact, an FOV kick on boost, squash and stretch, speed lines, and boost shockwaves. Phone haptic patterns: a tick for each drift tier, a long pulse for boost, a double pulse for a hit, and a rhythm at the finish. Every menu and overlay uses spring animation.

### 12.8 Performance and robustness
- Frame budget: simulation at most 2 ms, and rendering at most 12 ms with 5 viewports on a mid-range laptop. Quality adapts automatically.
- Debug overlay (`?debug=1` or `D`): frame-time graph, simulation ms, draw calls, triangles, quality tier, per-player ping, input rate and input latency, physics vectors and checkpoint gates.
- Validate and clamp every value a phone sends. A bad phone can never freeze the host.

---

## 13. The continuous polish loop (graphics and gameplay)

"Always improve" is a standing requirement. Run this loop **at the end of every phase from phase 3 onward**, and repeatedly in the final polish phase.

1. **Capture**:
   - Screenshots: use a Playwright script (`tools/capture.ts`) to save screenshots at fixed camera spots per track (start grid, each sector, a hairpin, mid-drift, mid-boost, the podium), in 1, 2 and 5-player split-screen, on each quality tier. Use headed Chrome, or headless with `--use-angle=swiftshader --enable-unsafe-swiftshader`. Save them in `docs/screens/<phase>/`.
   - Gameplay metrics: record frame timing and gameplay metrics (`tools/sim-report.ts`): lap times per track, character and difficulty, rescues per race, items used, and stuck time.
2. **Score**: fill in `docs/POLISH.md`, scoring each item below from 1 to 5 with a one-line reason, and compare with the previous phase:
   - **Graphics**: aliasing and shimmer, lighting and shadow quality, material quality of the road, kerbs and terrain, how visible texture tiling is, scenery density and variety per sector, kart and character detail, effect quality, readability at 1/5 screen, colour harmony, and UI finish.
   - **Gameplay**: steering smoothness, drift feel, camera smoothness, collision feel, item fairness, AI believability, input latency, and frame-time stability.
3. **Fix**: fix the **three lowest-scoring items** before moving on, then re-capture to confirm they improved. Never let a score drop compared with the previous phase.
4. **Target**: every graphics and gameplay item at **4 or higher** by the end. Anything that cannot reach 4 becomes a question at the next grilling gate.

---

## 14. Setup, run and developer experience

Scripts in the root `package.json`:
- `npm install` installs everything.
- `npm run dev`: starts the server with Vite middleware, hot reload for host and controller, prints the URLs.
- `npm run build`: builds `host` and `controller` into `dist/`.
- `npm start`: serves the production build from the same server and port.
- `npm test`: runs Vitest.
- `npm run typecheck`: runs `tsc --noEmit` across all workspaces.
- `npm run textures`: regenerates the texture sets (`tools/gen-textures.ts`).
- `npm run capture`: takes the polish-loop screenshots (`tools/capture.ts`).
- `npm run sim-report`: prints headless lap times, balance and rescue stats (`tools/sim-report.ts`).

Also add:
- `.vscode/launch.json` and `.vscode/tasks.json` so pressing F5 starts the dev server.
- ESLint + Prettier configs.
- A `README.md` with: quick start, how phones join, Windows firewall note (allow Node.js on **private networks** when prompted), what to do if the QR URL is unreachable (same Wi-Fi, disable "client isolation" or "guest network", try a phone hotspot or the laptop's hotspot), how to override `PUBLIC_URL`, controls, and troubleshooting.

---

---

## 15. Testing and acceptance criteria

Automated (Vitest):
- **Lap length**: on every track, the Normal AI's median lap is **115 to 125 s**, and a headless 6-AI race over the default lap count finishes with every kart, and no kart stuck for more than 10 s.
- **Balance**: character median laps are within 4% of each other on every track. With items off, AI lap times order Hard < Normal < Easy, with at least 3% between levels.
- **Robustness**: in 150 seeded races per track, no kart fails to finish and no kart circles or is pinned for more than 5 s.
- **Determinism**: the same seed and the same scripted inputs give identical standings.
- **Rules**: lap counting works forwards and backwards across the line, skipping a checkpoint gate does not count a lap, and the race ends 30 s after the first human finishes (or when all humans have finished).
- **Rescue**: the rescue drone fires for each stuck case and always restores a valid on-track position.
- **Interpolation**: rendering at 30, 60 and 144 FPS (simulated clock) gives consistent positions with no backward steps.
- **Protocol**: malformed `player:input` is rejected, a 6th join gets "room full", and reconnecting with the same `playerToken` returns the same slot.

Manual acceptance checklist (confirm each, and report results at the end):
1. `npm run dev` prints a LAN URL. The host page shows a QR code that opens the controller on a real phone.
2. 1, 2, 3, 4 and 5 phones can join. A 6th is rejected with "Room full".
3. The split-screen layout matches the table in 6.2 for each player count, with correct aspect ratios and no stretched views.
4. Each phone controls only its own kart. Steering, drift, brake and item all work with multi-touch.
5. **The controller matches the reference image(s) in `reference/`** (layout, button shapes, colours, icons), with every deviation listed and justified in `docs/DECISIONS.md`.
6. Drift turbo, boost pads, items and spin-outs work in every viewport. Hits and boosts vibrate the right phone.
7. Locking a phone or closing its tab mid-race hands the kart to AI. Reopening the page restores control.
8. Refreshing the host page keeps the room and the players.
9. 60 FPS (or a clean adaptive quality drop) with 5 viewports on a typical laptop. Input latency is under 50 ms on the LAN.
10. Everything works with the internet disconnected (no CDN requests).
11. `npm test` and `npm run typecheck` pass.
12. All 3 tracks give laps of about 2 minutes, with 3 or 4 distinct sectors, landmarks, a shortcut, a jump ramp where specified, and working boost pads.
13. The road, kerbs, gravel, grass and terrain read as textured, believable materials up close, with no visible tiling, seams or z-fighting.
14. Graphics are smooth: no jaggies or shimmer, with soft shadows, tone mapping and the post effects described for each tier.
15. Motion is smooth with no judder on a 60 Hz and a 120/144 Hz display.
16. All 8 items work as described, with the fairness rules.
17. Single race and Grand Prix work end to end, with the leader choosing settings from their phone.
18. Every graphics and gameplay item in `docs/POLISH.md` scores 4 or higher.

---

## 16. Work plan (in order; verify, polish and grill at each gate)

0. **Gate 0: grilling session** (section 0.2). Write `docs/DECISIONS.md`. Wait for my confirmation.
1. **Run the prototype in a real browser.** Screenshot it, and list and fix its rendering bugs. Measure its lap time and FPS. This is the baseline for the polish scorecard.
2. **Scaffold** the workspaces, TypeScript, Vite-in-Express, Socket.IO, and hello-world host and controller pages. Print the LAN URLs.
3. **Port the logic** to `shared/` with a seeded RNG and the multi-human API. The headless tests must match the prototype's behaviour.
4. **Port the renderer** to current Three.js from npm, single-player first, matching the prototype visually (then run the first polish loop).
5. **Networking and controller**: rooms, the QR lobby, slots, the join flow, input relay, and the controller built from the `reference/` image. Verify with two real phones.
6. **Split-screen**: per-player cameras and viewports, a HUD per viewport, and a shared minimap and standings.
7. **Phone feedback**: HUD data on phones, haptics, reconnection with AI takeover, results and rematch.
8. **Track system and lap length** (section 11): `TrackDef`, sectors, gates, surfaces, and the about-2-minute laps. Build Sunny Meadows at full length first, then the other two tracks.
9. **Surface and material pass** (section 11.3): generated texture sets, splat terrain, kerbs, gravel, barriers and decals.
10. **Art pass** (section 10): the rendering pipeline, tiers, post effects, detailed karts and characters, effects, UI and audio.
11. **Mechanics pass** (section 12): tyre model, balance, items (now 8), checkpoints, AI racing lines and difficulty, game feel.
12. **Modes and flow**: leader settings, character select, single race, Grand Prix and the trophy ceremony.
13. **Performance**: budgets, auto quality, leak checks and latency.
14. **Final polish loop** (section 13), repeated until every score is at least 4. Then the **finish gate** grilling round, and the final report.

If time or complexity forces a trade-off, protect this order of importance: (1) multiplayer works reliably, (2) the driving feels smooth and good, (3) the look is polished. Raise any cut at the next grilling gate. Do not cut things silently.

## 17. Non-goals (do not build)

Online play over the internet, accounts, matchmaking, a database, tracks beyond the 3 listed (the track system must make adding more easy), gyro steering, or voice chat.

## 18. When you finish

Reply with:
- How to run it (three commands at most).
- A table of the acceptance checks (pass / fail / not tested).
- The final `docs/POLISH.md` scores, compared with the phase-1 baseline.
- Measured lap times per track.
- A short list of the decisions made (pointing to `docs/DECISIONS.md`).
- Known issues.
