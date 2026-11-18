# Decisions log

Where this file and `docs/PROMPT.md` disagree, this file wins.
Each entry: date, question, answer, reason.

---

## Gate 0: facts gathered (2026-11-16)

These were looked up, not decided. They feed the decisions below.

### Project files
- The prototype is at `prototype/turbokarts-prototype.html` (2,814 lines). The prompt expects `prototype/index.html`.
- The reference image is at `reference/controller/controller.jpeg` (484 × 1080, portrait).
- The project root is `LakefrontKart/`. The prompt's folder tree calls it `turbo-karts/`.
- This is not a git repository yet.
- The Matt Pocock skills were installed to `.agents/skills/` and `.aider-desk/skills/`, not `.claude/skills/`, so Claude Code does not see `/grill-me`. The grilling protocol is followed by hand from `.agents/skills/grilling/SKILL.md`.

### Host machine (this laptop)
- CPU: AMD Ryzen 7 5800H (8 cores). RAM: 16 GB.
- GPU: **hybrid**. NVIDIA GeForce GTX 1650 (4 GB) plus AMD Radeon integrated graphics. Chrome must be set to "High performance" in Windows Graphics settings, or it may render on the integrated GPU.
- Built-in display: 1920 × 1080 at 144 Hz.
- Browsers: Chrome and Edge are installed. Playwright is not installed yet; it can drive the installed Chrome.
- Node 22.16.0, npm 10.9.2, git 2.49.
- Network: Wi-Fi at `192.168.0.26`. **The Wi-Fi profile is set to "Public"**, so Windows Firewall blocks inbound connections from phones by default. There is also a **Hamachi VPN adapter** (`25.29.223.47`) and several `169.254.x.x` link-local adapters, which LAN detection must ignore.

### Prototype baseline (measured headlessly, 20 seeded races per row, 3 laps)
Track centreline: **1,279 m**. Test driver: AI controller with skill 0.93 (the prototype has no 0.93 autopilot; the player's own AI config uses 0.95).

| Items | Difficulty | Driver median lap | AI median lap | Driver avg place | Rescues / race | Unfinished |
|---|---|---|---|---|---|---|
| off | Easy | 48.4 s | 50.8 s | 2.05 | 0 | 0 |
| off | Normal | 48.6 s | 49.0 s | 3.30 | 0 | 0 |
| off | Hard | 48.9 s | 47.6 s | 5.10 | 0 | 0 |
| on | Easy | 48.7 s | 50.1 s | 2.00 | 0 | 0 |
| on | Normal | 49.3 s | 48.6 s | 3.90 | 0 | 0 |
| on | Hard | 48.6 s | 47.2 s | 4.70 | 0 | 0 |

- Average speed is about 26.3 m/s, so a 120 s lap needs a centreline of about **3.15 km**.
- Character spread (driver median, items off): 2.66 %, within the 4 % target.
- AI difficulty gaps: Easy to Normal 3.6 %, **Normal to Hard 2.9 % (below the 3 % target)**. To be retuned in phase 11.
- The prototype offers 1, 3 or 5 laps (default 3).
- Character kart colours collide with the slot colours: Bruno `#e53935` = P1 red, Pip `#1e88e5` = P2 blue, Zed `#fdd835` = P3 yellow, Mochi `#8e24aa` = P5 purple. Mochi's orange fur is close to the AI orange.

### Reference image: `reference/controller/controller.jpeg`
- **Orientation**: portrait, tall and narrow (a remote held upright).
- **Background / body**: a pearl-white, glossy, skeuomorphic remote body on a light grey background, with soft shadows, bevels and recessed wells.
- **Top to bottom, centre column**:
  1. A small round **POWER** button (top left) with a red power icon and a grey "POWER" label.
  2. A large **D-pad** cross with embossed arrows.
  3. A large round **A** button sitting in a recessed ring.
  4. A pill-shaped well holding **−**, **HOME** (blue glowing house icon) and **+**, with a "HOME" label under it.
  5. A **speaker grille** of grey dots.
  6. A tall recessed pill holding two round buttons, **1** and **2**.
  7. Four **player LED dots** at the bottom, the first lit blue.
- **Side panels**: tall recessed, translucent pale-blue panels on both edges, labelled "(B) TRIGGER" vertically, with chevrons pointing inward.
- **Colours**: white and light greys, blue glow accent, red power icon. Labels in a grey rounded sans-serif.
- **On-phone HUD**: none shown.
- **Observation**: this is a close rendering of a real console's motion remote (its button names, layout and trade dress). See question Q3.

---

## Decisions

### D1 · Host display (2026-11-16)
- **Q**: Which display and hardware is the graphics budget set for?
- **A**: This laptop (GTX 1650, Ryzen 7 5800H) driving a 1080p screen: its own panel or a TV. On a 4K TV, render at most 1080p internally and upscale. The README tells you to set Chrome to "High performance" in Windows Graphics settings.
- **Why**: Five viewports at native 4K are beyond a GTX 1650. The hybrid GPU may otherwise pick the integrated chip.

### D2 · Phones (2026-11-16)
- **Q**: Which phones will people use, and how will the controller be tested?
- **A**: Both iOS and Android must work. You can only test with iOS. See D15 and D16.
- **Why**: iOS Safari is the stricter target. Android behaviour gets verified by emulation only.

### D3 · Controller reference (2026-11-16)
- **Q**: How binding is `reference/controller/controller.jpeg`?
- **A**: Follow it 100%:
  - **Kept as in the image**: the body, materials, colours and proportions, and every element in its place.
  - **Replaced**: the labels and marks that identify the original console remote (the HOME house icon, "POWER", "(B) TRIGGER", and the A / 1 / 2 / − / + glyphs) become our own function icons.

  The mapping is in D14.
- **Why**: You want the reference look. The original maker's identifying marks stay out (section 9: copy nothing from Nintendo).

### D4 · Default lap count (2026-11-16)
- **Q**: What is the default lap count, with laps of about 2 minutes?
- **A**: **2 laps** by default; 1, 2 or 3 can be chosen.
- **Why**: About 4 minutes per race, and about 13 minutes for a Grand Prix.

### D5 · Shading (2026-11-16)
- **Q**: Toon/cel shading or soft stylized PBR?
- **A**: **Soft stylized PBR**, with a thin outline on karts and characters only.
- **Why**: It keeps the toy identity and lets the textured road sit naturally in the world.

### D6 · Surface realism (2026-11-16)
- **Q**: How real should the ground look?
- **A**: **(B) Believable materials, colour-graded to the palette**: aggregate, cracks, patches, worn paint and rubbered-in lines, using normal and roughness maps. Saturation stays slightly lifted and the grime clean.
- **Why**: It should be believable up close without clashing with the stylized karts.

### D7 · Track order (2026-11-16)
- **Q**: What are the three tracks, and in what order?
- **A**: Sunny Meadows, then Dusty Canyon, then Frosty Peaks. This is also the Grand Prix order.
- **Why**: Difficulty rises: wide and forgiving first, then the jump, tunnel and sand, then ice and twilight.

### D8 · Items (2026-11-16)
- **Q**: Which items are in the game?
- **A**: Exactly the 8 items in section 12.3. Seeker Comet appears only for 4th place and below, never on lap 1, and gives a 2 s warning.
- **Why**: These are the prototype's 6 plus 2 catch-up items, with no scope creep.

### D9 · Difficulty (2026-11-16)
- **Q**: What should each difficulty feel like, and which is the default?
- **A**: The default is **Normal**.
  - **Easy**: a first-time phone player can reach the podium.
  - **Normal**: a fair fight.
  - **Hard**: needs clean drifting and good item use to win.
  - The Normal-to-Hard gap is widened to at least 3% (it measures 2.9% now).
- **Why**: Phone buttons are less precise than a keyboard.

### D10 · Definition of done (2026-11-16)
- **Q**: What does "done" mean, and how long does polishing go on?
- **A**: Done means:
  - all automated checks in section 15 pass;
  - you confirm all 18 manual checks;
  - every POLISH.md item scores 4 or higher.

  Phase 14 runs **up to 3 polish loops**. Anything still under 4 after that becomes a keep-or-cut question for you.
- **Why**: It sets a clear target with a bounded polish budget.

### D11 · Kart colour (2026-11-16)
- **Q**: Four character colours clash with slot colours. How is each kart painted?
- **A**: **The kart body is painted in the slot colour** (orange for AI). Each character keeps its own fur and accent colours, with their emblem on the nose.
- **Why**: Players can tell who is who in a 1/5 viewport.

### D12 · Firewall (2026-11-16)
- **Q**: The Wi-Fi profile is Public, which blocks phones. What is the fix?
- **A**: You switch your home Wi-Fi profile to **Private** once, and Node.js is allowed on private networks only. The README covers this, and the server warns if no phone ever connects.
- **Why**: Allowing Node on Public networks would expose it on public Wi-Fi.

### D13 · Name, folder and git (2026-11-16)
- **Q**: Which game name and folder layout, and should the project use git?
- **A**:
  - The game is called **"Turbo Karts"**.
  - Build in place at the `LakefrontKart/` root.
  - Run `git init` and make one local commit per phase gate, with no remote and no pushes.
  - The prototype keeps its current filename.
  - The UI is English only.
  - LAN detection ignores Hamachi (25.x) and link-local addresses.
  - Playwright drives the installed Chrome.
- **Why**: It keeps the existing project as it is, with checkpoints at each phase.

### D14 · Controller orientation and mapping (2026-11-16)
- **Q**: How does the portrait reference become a landscape controller?
- **A**: The remote is turned sideways, top to the left. Each element keeps its place:

  | Reference element | Landscape position | Function |
  |---|---|---|
  | Cross pad | left | ◀ ▶ steering; ▲ ▼ do nothing. Slider mode replaces the cross with a drag slider |
  | Big round button | centre-left | BRAKE / reverse (hold) |
  | Outer button of the pair | far right | DRIFT (hold), drawn larger |
  | Inner button of the pair | right | ITEM with the item icon. Tap fires forward; swipe down or hold BRAKE fires backward |
  | − / centre / + | centre | − / + set steering sensitivity; the centre button opens settings (steering scheme, assist) |
  | Small round button | bottom-left | Leave the race (asks to confirm) |
  | Speaker grille | centre-right | Decoration that pulses on boosts and hits |
  | LED dots | right edge | 5 dots, lit in the slot colour |
  | Side panels | top and bottom strips | Top: status (place, lap, item, ping). Bottom: drift-charge glow bar |

  The join, waiting and results screens use the same remote body.
- **Deviation from section 7.2**: BRAKE sits on the big round button, centre-left, not as a small button on the right. Backward fire still works one-handed (swipe down on ITEM).
- **Why**: The reference image decides the layout. Holding the remote sideways is how it is used for racing.

### D15 · Multi-phone testing (2026-11-16)
- **Q**: How are 1 to 5 phones tested when only one iPhone is available?
- **A**: Test with 1 real iPhone plus bot controllers:
  - a `?bot=1` controller mode;
  - a script that opens N simulated phones.

  Android-only checks (vibration, Chrome's fullscreen and landscape lock) are marked "verified by emulation".
- **Why**: Only one real iOS device is available.

### D16 · iOS limits (2026-11-16)
- **Q**: How do we handle iOS Safari having no vibration, no fullscreen and no orientation lock?
- **A**: Two measures:
  - **(a) Add to Home Screen.** A web-app manifest gives a full-screen controller when launched from the home-screen icon, with a one-time hint on the phone.
  - **(b) Best-effort iOS haptics.** A hidden switch-control trick for iOS 18 and later, behind a feature check, with the screen flash as the fallback. It is not guaranteed if Apple changes Safari.
- **Why**: It gives the best iPhone experience possible over plain HTTP.

### D17 · Prototype fixes in place (2026-11-16, my decision)
- **Q**: Where do the phase 1 rendering fixes go?
- **A**: They are edited directly into `prototype/turbokarts-prototype.html`. The untouched original is in git commit `792999e`.
- **Why**: There is one reference file, and the history keeps the original.

### D18 · Capture method (2026-11-16, my decision)
- **Q**: How are screenshots captured?
- **A**: Headless Chrome with `--use-angle=d3d11`, which renders on the GTX 1650 (confirmed by the WebGL renderer string). This replaces a headed browser or SwiftShader.
- **Why**: It uses the real GPU and gives real numbers, without popping windows up on your screen during captures.

### D19 · Who scores the driving feel (2026-11-16, phase 1 gate)
- **Q**: Who scores the gameplay "feel" items in POLISH.md?
- **A**: Claude scores from measurements. You do a short hands-on check at two points:
  - about 5 minutes on the keyboard after phase 4, to confirm the port feels the same as the prototype;
  - about 10 minutes with your iPhone after phase 5.

  Your verdict replaces Claude's score for each feel item, and anything rated under 4 goes on the fix list.
- **Why**: Feel can't be measured headlessly, and phone feel differs from keyboard feel.

### D20 · Toolchain versions (2026-11-16, phase 2, my decision)
- **Q**: Which toolchain versions does the project use?
- **A**:
  - **TypeScript 6.0.3**, not 7.0. typescript-eslint 8.72 only supports TypeScript below 6.1.
  - **Node 22.13 or newer**, not the prompt's "20+". Vite 8, Vitest 5 and ESLint 10 require it. This machine has 22.16.
  - Other versions: Three.js 0.187, Vite 8.3, Express 5.3, Socket.IO 4.8.
- **Why**: These are the newest versions that work together.

### D21 · Server runtime (2026-11-16, phase 2, my decision)
- **Q**: How does the server run in dev and production?
- **A**: Both run the server's TypeScript directly with `tsx` (`npm run dev` uses `tsx watch`; `npm start` uses `tsx … --prod`). Only the host and controller are bundled by Vite into `dist/`. One root `vite.config.ts` has two HTML entries: `/` is the host and `/play` is the controller. Dev runs Vite in middleware mode, and its HMR shares the HTTP server, so everything uses one port.
- **Why**: There is no separate server build step, and phones only need one port.

### D22 · Socket.IO namespaces (2026-11-16, phase 2, my decision)
- **Q**: How are host and phone messages kept apart?
- **A**: Two namespaces: `/host` and `/controller`. Each one is typed with its own event maps from `shared/src/protocol.ts`. Phase 2 adds `net:info`, `net:rtt` and `net:presence` for the connectivity check and the later debug overlay. Rooms and slots (`server/src/rooms.ts`) arrive in phase 5 as planned.
- **Why**: A host can never send phone events, and a phone can never send host events, and both are type-checked.

### D23 · Game API shape (2026-11-16, phase 3, my decision)
- **Q**: What does the `shared` game API look like?
- **A**:
  - **Entry point**: `createGame(opts)` returns a `Game` with:
    - `startCountdown()`
    - `setInput(slot, input)`: latest input wins; `item` is a one-shot that the next step consumes.
    - `setHumanAi(slot, on)`: phone disconnect handover.
    - `step(dt)`: exactly one fixed step; the host owns the accumulator.
    - `drainEvents()`
    - `getSnapshot()`
  - **Phases**: `grid → countdown → race → finished`. Karts keep driving in `finished`, so the host can show the cool-down.
  - **Events**: they carry the kart id (`kart`), not an object reference, so they can be forwarded to phones as they are.
  - **AI driving**: a kart is driven by the AI when `k.ai || k.finished`.
  - **Rubber-banding**: AI rubber-banding compares against the average progress of the humans still racing.
- **Why**: Section 8's API, made deterministic and parity-testable.

### D24 · Test driver skill (2026-11-16, phase 3, my decision)
- **Q**: The prompt describes "the prototype's autopilot with skill 0.93", but the prototype's autopilot uses 0.95. Which is used where?
- **A**:
  - **0.95**: drives a disconnected or finished human (the prototype's value, kept for parity).
  - **0.93**: the steady test driver used by `sim-report` and the lap-time targets, as section 11.1 states.
- **Why**: The parity test needs the prototype's exact value, and the metrics need the prompt's stated driver.

### D25 · Not every lap counts in tests (2026-11-16, phase 3, my decision)
- **Q**: How do the metrics measure lap times when the race may end early?
- **A**: `sim-report` sets `raceEndGrace` very high, so every kart races to the flag. This means every lap is measured, rather than the race closing 30 s after the human finishes.
- **Why**: Lap-time statistics need complete races.

### D26 · Grid order (2026-11-16, phase 3 gate)
- **Q**: Where do humans start on the grid?
- **A**: Humans start **behind** the AI, in join order, with P1 frontmost of the humans. The AI karts take the front rows.
- **Why**: The difficulty was tuned for climbing through the field (the prototype started the player 5th). A pole start would turn races into holding the lead.

### D27 · Polish-loop scope (2026-11-16, phase 3 gate)
- **Q**: Which items does the "fix the 3 lowest scores" rule apply to?
- **A**: Each phase fixes the 3 lowest items **that the phase can touch**, plus any score that dropped. The big art items (lighting, materials, scenery, kart detail) are fixed in phases 9 and 10. No score may ever drop, and every POLISH.md entry names the items deferred because of scope.
- **Why**: Applied literally, the rule would pull the art pass ahead of multiplayer, which you ranked first.

### D28 · Matching the prototype under current Three.js (2026-11-16, phase 4, my decision)
- **Q**: How does the port keep the prototype's look under current Three.js?
- **A**:
  - sRGB output.
  - Hemisphere and sun intensities × π, because three.js r155+ uses physical light units.
  - `NoToneMapping` until the art pass, where ACES arrives with the PBR materials (D5).
  - The toon ramp uses `RedFormat`, which is correct now that three.js samples `.r`.
  - The sky shader includes the tone-mapping and colour-space chunks.
- **Why**: Phase 4's goal is to match the prototype first; the look changes in phase 10.

### D29 · Host keyboard (2026-11-16, phase 4, my decision)
- **Q**: Which keys drive the host keyboard test?
- **A**: Arrows steer, accelerate (↑) and brake (↓). Space or Shift drifts, E/X/Ctrl fires the item (with ↓ held to fire backward). Letters are reserved for host shortcuts: D debug, F FPS, M mute, P pause, Enter start, Esc pause or title. On the title screen, ←→ picks the character and ▲▼ the difficulty.
- **Why**: The prompt's `D` debug shortcut clashed with WASD steering. This title screen is temporary until the phase 5 lobby.

### D30 · Capture method details (2026-11-16, phase 4, my decision)
- **Q**: How does `tools/capture.ts` produce reproducible shots?
- **A**:
  - It starts its own server on port 3100.
  - It loads `/?noadapt=1`, so adaptive resolution doesn't react to the capture's synchronous fast-forwards.
  - It drives a seeded autopilot race (`window.__tk.race`).
  - It fast-forwards with `__tk.advance`; cameras snap after a fast-forward.
  - Scenery placement and particle effects use seeded generators, so a capture is reproducible.
- **Why**: Comparable screenshots from phase to phase.

### D31 · Keyboard feel check (2026-11-16, phase 4 gate)
- **Q**: How did the D19 keyboard feel check go?
- **A**: You chose to continue without doing it. The feel items keep Claude's measured scores (marked *). Your iPhone check after phase 5 is the first hands-on verdict.
- **Why**: Your call at the gate.

### D32 · Rooms, relay and controller details (2026-11-16, phase 5, my decision)
- **Q**: How do rooms, the relay and the controller behave in detail?
- **A**:
  - **Lobby slots**: a phone that drops in the lobby keeps its slot for 30 s; during a race it keeps it until the race ends.
  - **Item presses**: sent as reliable emits, so a press is never lost. Held inputs are volatile and sent on change, plus a 100 ms heartbeat, with at most 60 per second.
  - **Stale input**: after 500 ms without input from a phone, the host keeps the throttle on with steer 0 (section 5.4).
  - **Host refresh**: brings the room and players back to the lobby, because the race lives in the host page.
  - **Characters**: each phone is given a free character on joining and can change it on the waiting screen.
  - **Tips**: shown only on the waiting screen, at the top, so they never cover controls.
- **Why**: Reliable multiplayer first (section 16 priority 1).

### D33 · Work pulled forward from later phases (2026-11-16, phase 5, my decision)
- **Q**: Which later-phase work was built early, and why?
- **A**: Four small pieces landed in phase 5 because the phase 5 test needs them:
  - the basic split-screen rectangles (`host/src/layout.ts`; phase 6 adds borders and the minimap and standings panels);
  - phone HUD data and haptics relay (phase 7);
  - the phone character picker (phase 12);
  - phone results and rematch buttons (phase 7).

  Phases 6, 7 and 12 still own the polish and checks for these.
- **Why**: A real iPhone test is more useful with place, lap, item, haptics and a character to pick.

### D34 · Development keyboard mode (2026-11-16, phase 5, my decision)
- **Q**: How can the host be tested without a phone?
- **A**: `/?keyboard=1` lets the host keyboard drive slot 0 without a phone (development only). The normal host needs at least one phone (section 6.1).
- **Why**: Quick local testing.

### D35 · Hands-on fixes after the first iPhone test (2026-11-18, phase 5 gate, your feedback)
- **Q**: Your iPhone test: connected at 54 ms, haptics felt; steering 2, drift 2, camera 2; "steering and slider should be bigger"; "drifting is more like hopping than drifting". What changes?
- **A**:
  - **Drift**: the start hop drops from 0.55 m to 0.14 m. The tail now kicks out sideways (3.2 m/s) and the kart keeps sliding (sideways grip in a drift 4.5 → 2.4, drag 0.3 → 0.22). The body swings out to a slide angle that tightens when you steer into the turn and opens when you countersteer.
  - **Camera**: aims between the nose and the direction of travel (80% travel in a drift), so you see the kart sliding sideways instead of the whole view swinging. Uses the smoothed heading, softer position spring (12 → 8), and less FOV pumping with speed and boost.
  - **Steering pad**: tap for a small correction, hold to reach full lock over 0.28 s (starts at 50%).
  - **Controller size**: the steering column is about 65% wider. The cross pad is wide with long LEFT/RIGHT arms (UP/DOWN are decoration). The slider is taller with a bigger knob. BRAKE, the settings pill and the grille shrink to make room. This departs from the reference's proportions on purpose (D3 still holds for the look).
  - These numbers live in `Handling` (`shared/src/game.ts`); `PROTOTYPE_HANDLING` keeps the parity test exact.
- **Why**: Driving feel is priority 2, and all three feel scores were under the bar of 4 (D10). Lap times and AI gaps are unchanged (sim-report: 48.2–48.7 s).

### D36 · Faster karts and sharper steering (2026-11-18, phase 5 gate, your feedback)
- **Q**: Retest: steering 3, drift 4, camera 4; the cross pad size is good; you prefer the slider; "make the kart a little faster"; steering "turns too slowly". What changes?
- **A**:
  - **Speed**: every kart is 8% faster (top speed, acceleration, boost and off-road caps), scaled evenly so the field and the AI stay balanced. Laps on the test track drop from about 48.5 s to 45.5 s. (12% was tried first; your third test found it "a little bit" too fast.)
  - **Overrides section 11**: it says the prototype's speeds feel right. Phase 8 keeps the 2-minute lap target by making tracks longer (about 3.2 to 3.6 km instead of 3.0 to 3.4 km).
  - **Turning**: base turn rate 1.8 → 2.15 rad/s, and less of it is lost at speed (30% → 22% at 40 m/s).
  - **Slider**: full lock at 85% of the travel, with a near-linear response (power 1.15, was 1.5). Halfway across now gives about 55% lock instead of 30%.
  - **Default steering**: the slider (you preferred it). The cross pad stays in Controls.
  - **Sense of speed**: the speed FOV widening is partly restored (0.16 → 0.19 per m/s).
  - All of this lives in `Handling.speedMul`, `turnRate` and `turnFalloff`. `PROTOTYPE_HANDLING` keeps the parity test exact.
- **Why**: Driving feel is priority 2, and steering is still under 4.

### D37 · Pause from the phone (2026-11-18, phase 5 gate, your request)
- **Q**: How does a player pause?
- **A**:
  - **Pausing**: the centre button of the phone's pill is now PAUSE (it was settings). Any racer can pause the race for everyone during the countdown or the race.
  - **What everyone sees**: every phone shows a pause card with who paused, RESUME, CONTROLS (the steering settings) and LEAVE. The host shows "Paused by NAME".
  - **Resuming**: anyone can resume, from any phone or with P on the host.
  - **Settings**: also still on the waiting screen.
- **Why**: You asked for it. Section 6.6 only had the host's P key.

### D38 · Art direction moves toward realistic (2026-11-18, phase 5 gate, your choice)
- **Q**: You asked for "more realistic" graphics. Change D5?
- **A**:
  - **Direction**: yes. The art pass goes for a realistic look:
    - no cartoon outlines;
    - real PBR materials and textures;
    - realistic lighting, shadows, sky and post-effects (ACES tone mapping, bloom, ambient occlusion).
  - **Characters**: the cute animal drivers stay.
  - **When**: phases 9 to 10 as planned, so the 3 new tracks get it rather than this test track.
  - **D5**: replaced. **D6** (believable surfaces) still applies and now fits the whole world, not only the road.
- **Why**: Your choice. Doing it after phase 8 avoids redoing the art on the old track.

---

## Gate 0 status
All decisions are settled (D1 to D16). **You confirmed a shared understanding on 2026-11-16. Gate 0 is closed.**
