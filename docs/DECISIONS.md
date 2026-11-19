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
  - **Overrides section 11**: it says the prototype's speeds feel right. Phase 8 keeps the 2-minute lap target by making tracks longer. In the event the tracks came out at 3.9 to 4.1 km, because the AI averages about 34 m/s on them (D41).
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

### D39 · Split-screen details (2026-11-18, phase 6, my decision)
- **Q**: Where do the shared minimap and standings go, and how do small views stay readable?
- **A**:
  - **Shared panel**:
    - **3 and 5 players**: the minimap fills the left gap and the standings the right gap.
    - **2 and 4 players**: one compact panel at the screen centre, as section 6.2 asks. Views right of the screen centre mirror their HUD (place and item on the outer edge), so the panel never covers anyone's place.
    - **1 player**: keeps the corner minimap, with a compact standings list under it. A centre panel would sit on top of the player's own kart.
  - **Viewports**: a 4 px player-colour frame and a name chip in the outer bottom corner. The HUD scales with the view, but never below 66% (it was 55%). In split-screen the speed text is larger and the "last lap" line is dropped.
  - **Karts near the camera**: another kart between a view's camera and that view's own kart (closer than 70% of the camera-to-kart distance, at least 4.6 m) is hidden in that view only, so a kart right behind you cannot fill your screen. This was seen at the start grid.
  - **Finished**: a FINISHED banner with place and time. The view swings out (eased over about a second) into a slow, wide orbit around the player's kart, which the AI drives on.
  - **Reconnecting**: a badge on that player's view while the phone is away ("the computer is driving").
  - **FOV**: goes up smoothly as views get narrower (66° at 16:10, up to 82°), instead of jumping at an aspect of 1.
  - **Draw distance**: with more than 3 views, fog is 240–1050 m (was 300–1500) and the far plane 1500 m; the sky dome shrinks to fit (section 6.3).
  - **Per-object LOD**: moved to phase 13. Five views at 1080p take a median 3.7 ms per frame (p95 5.8 ms) on the GTX 1650, so there is no need yet. The draw-call budget (535 calls with 5 views) is phase 13 work too.
- **Why**: Section 6.2 and the readability score.

### D40 · Phone feedback (2026-11-18, phase 7, my decision)
- **Q**: What does the phone show and feel during a race, beyond the controls?
- **A**:
  - **Countdown**: every phone shows 3-2-1-GO with a tick on each number and a strong pattern on GO (section 6.4: all phones vibrate on GO). These ride the reliable `haptic` message as kinds `cd` (with `n`) and `go`, not the 10 Hz volatile HUD, so a dropped packet cannot skip GO.
  - **Final lap**: a "FINAL LAP!" toast and a triple pulse (`lap`).
  - **Place changes**: the place number pops, green when you gain a place and red when you lose one.
  - **Wrong way**: a blinking red WRONG WAY chip under the top strip.
  - **Finishing**: a full-screen card with your place, time and "Waiting for the others…", the moment you cross the line (section 7.2: "You finished 2nd", then the standings). The controls are released, since the AI drives on.
  - **Results**: on short landscape phones the standings use two columns (1–3 left, 4–6 right) with rank numbers, so RACE AGAIN and LOBBY are always on screen.
  - **Reconnecting**: after 10 s the "Reconnecting…" card adds a Wi-Fi hint and a RELOAD button. A reload rejoins the same kart with the saved token.
  - **Validation**: the server now relays only known haptic kinds, with a whole-number `n`.
  - **HUD data**: `HudUpdate` gains `finishTime` and `wrongWay`.
- **Why**: Section 7.2 (results flow), section 6.4 (GO on every phone), and section 12 (feedback) without waiting for the host screen.

### D41 · Track system and the three tracks (2026-11-18, phase 8, my decision)
- **Q**: How are tracks described and built, and what is on each one?
- **A**:
  - **Data**: a `TrackDef` (`shared/src/tracks/`) holds control points (x, z, height, half-width, banking), 3 to 4 sectors, extra checkpoint gates, boost pads, jump ramps, item rows (default every ~400 m), surface zones, shortcuts and landmarks. `buildTrackFromDef` makes the physics tables, and the host's track builder makes the meshes from the same data. `npm run track-view` draws every layout with its checks to `docs/screens/tracks/`.
  - **Lengths**: the tracks are 3.95 km (Meadows), 4.11 km (Canyon) and 4.05 km (Frosty), longer than section 11's 3.0 to 3.4 km. The karts are 8% faster (D36) and the corners are wide, so the AI averages about 34 m/s. The lap-time target (115 to 125 s) decides the length, as section 11.1 says.
  - **Normal AI median laps** (sim-report, 10 races): 117.7 s, 120.3 s and 120.3 s.
  - **Surfaces**: asphalt, kerb, ice, grass, dirt, gravel, sand and snow, each with its own grip, top speed and drag. Grass keeps the prototype's numbers exactly. Ice lowers drift grip too.
  - **Checkpoint gates**: a lap counts only after passing every gate in order (physical line crossing). Missing one shows "MISSED A CHECKPOINT!" and the lap does not count. Driving backwards over the line takes the lap back. A rescue counts the gates behind its drop point.
  - **Sectors**: crossing a sector gate shows the split on the HUD ("S2 41.23"), green or red against the player's best this race.
  - **Jump ramps**: the road rises before the lip; crossing it at speed launches the kart (no drive, no grip, 25% steering). A straight landing gives a 0.6 s boost and "NICE LANDING!".
  - **Banking**: per point. It raises one road edge (physics height and the road mesh), and the karts roll with it.
  - **Shortcuts**: a corridor with its own surface. Inside it the road walls are off and its edges act as walls; the road walls and verges have a gap where it joins. The AI does not take shortcuts yet (phase 11).
    - Meadows: a dirt farm track, about 1 s faster.
    - Canyon: a sand riverbed across switchback 2.
    - Frosty: a snow trail across the first hairpin. It was planned as ice, but on ice it saved about 100 m at full speed, far too much.
  - **Off-track rescue**: 4 s off the track (not in a shortcut) calls the drone. The prototype track keeps its own rules.
  - **Tunnels**: walls close in to 3.5 m beyond the road edge.
  - **The three tracks** (D7 order):
    - **Sunny Meadows**: windmill sweepers, a riverside hairpin, an orchard climb with a stone bridge over a river, and a lakeside run with the farm-track shortcut.
    - **Dusty Canyon**: a mesa straight under two rock arches, a ridge tunnel, a ravine jump, and switchbacks with the riverbed shortcut.
    - **Frosty Peaks** (twilight): avalanche sweepers, a frozen lake with three ice patches, a double-hairpin pass with the snow-trail shortcut, and a village run.
  - **Themes**: each track has its own sky, light, ground colours, walls, mountains (peaks or mesas) and scenery (trees and flowers; cacti, rock spires and scrub; snowy pines and drifts). This is the base; phases 9 and 10 make it realistic (D38).
  - **Choosing a track before phase 12**: the lobby's track chip is a button, and T on the host cycles it. The server keeps it in the room config. `?track=canyon` overrides it for development.
- **Why**: Section 11 and section 12.4. Data-driven tracks keep the physics and the art in step.
- **Left for phase 11**:
  - The AI rarely drifts on these wider corners (1 to 3 drifts per race for the whole field). Its rule needs firm steering above 22 m/s.
  - The character spread is 5.6 to 6.0% (target 4%).
  - Normal to Hard is 2.8 to 2.9% (target 3%, D9).

### D42 · Sepang Circuit, a fourth track traced from a real layout (2026-11-18, your request)
- **Q**: You asked to add the Sepang circuit's layout, followed 100%, named "Sepang Circuit". How?
- **A**:
  - **Layout**: traced turn by turn from your map: 15 turns, clockwise, starting west down the main straight. Centreline points are in the map's pixels, scaled to metres (`shared/src/tracks/sepang.ts`). Scaling changes the size, never the shape.
  - **Size**: 0.8 m per map pixel gives 3.86 km, and the Normal AI laps in 122.1 s (target 115 to 125 s). The road is 24 m wide (half-width 12, and 13.5 on the start straight), a little narrower than the other tracks, so the tight Turns 1, 2 and 9 keep their real shape.
  - **What a traced layout leaves out**: no shortcut and no jump. The real circuit has neither, and you asked for the layout exactly, so the "every track has a shortcut" rule (section 11.2) applies only to the invented tracks (`traced: true`). The pit lane is not built, because the game has no pit stops.
  - **Walls**: where two parts of the road run close together (Turn 2 passes about 35 m from the main straight), the walls now automatically stop halfway between them, and they also close in on the inside of very tight corners. This applies to every track; the original three are unchanged because they have more room.
  - **Look**: a new tropical theme: a humid blue sky, lush grass, palm trees and green hills. There are grandstands on the main straight and the back straight.
  - **Sectors**: Turns 1-3, Turns 4-6, Turns 7-11, and Turns 12-15 with the back straight. Boost pads are on the main straight, the back straight and the run to Turn 9.
  - **Choosing it**: click the lobby track chip or press T (it cycles Meadows → Canyon → Frosty → Sepang). Grand Prix (phase 12) keeps the three original tracks unless you want Sepang added.
  - **Results**: character spread 3.7%, Normal→Hard 2.8% (phase 11). 150 seeded races: every kart finishes.
  - **Name**: "Sepang Circuit" is a real venue's name. That is fine for your own use; if the game is ever published, check whether the name and layout need permission.
- **Why**: Your request.

### D43 · Faster karts again, and the phase 9 surfaces (2026-11-18, phase 9, your request and my decisions)
- **Q**: You asked for karts 13% faster, a cleaner track ("there is still grass on the road") and a more realistic look. What changed?
- **A**:
  - **Speed**: `speedMul` goes from 1.08 to 1.22 (×1.13). The tracks grew about 13% to keep 2-minute laps: Meadows 4.61 km, Canyon 4.63 km, Frosty 4.55 km and Sepang 4.34 km (Sepang is scaled, not reshaped). Normal AI laps are 117.5 to 119.7 s.
  - **Grass on the road**: there were two causes.
    - In tight corners, the grass verge on the inside was wider than the corner's radius, so it folded over the road.
    - Where two parts of the road run close together, one verge reached across the other road.
    - The fix: every roadside strip is now fitted inside the corner radius and inside half the distance to other road (`Track.CLEAR`). The ground mesh is also pushed below the road, kerbs and verges at a dense set of points, so it can never poke through.
  - **Textures** (section 11.3): `npm run textures` (`tools/gen-textures.ts`) bakes seeded, tileable noise to PNG in `host/public/textures/`, 5.3 MB including half-size `_lo` versions for the Low tier.
    - Asphalt is 1024 px; grass, dirt, rock, snow, sand, gravel and concrete are 512 px; plus road wear masks and a macro-variation texture.
    - Normal maps are made in the browser from the height maps, to keep downloads small.
  - **Road**: a physically based material in world space (4 m tiles) plus 160 m macro variation, so nothing visibly repeats. The shader adds:
    - patch repairs, fine cracks and oil stains from the wear masks;
    - a darker rubbered-in racing line with wheel tracks;
    - painted edge lines and a dashed centre line, worn by traffic;
    - puddle sheen on Frosty Peaks, reflecting the sky.
    - The "roughness map" is computed in the shader from the same wear masks rather than shipped as a third texture.
  - **Kerbs**: raised and bevelled (inner ramp, top, outer chamfer), with rumble-ridge normals and chipped red/white paint.
  - **Ground**: one splat material for the terrain and the verges, so they meet without a seam. It mixes the theme's ground (grass, sand or snow) with dirt (road edges and patches), rock (by slope) and snow (by height), each with its own normal detail. The terrain is now a smooth indexed grid with 12 m cells.
  - **Run-off**: gravel traps with the gravel texture and loose stones. Shortcut paths use their surface's texture, and ice is a glassy pale blue.
  - **Barriers**: concrete walls with the theme's stripe band on slower sections. Fast sections get Armco rails on posts, plus catch fences on the outside of the corner that follows. Tyre stacks stay at corners.
  - **Furniture**: marshal posts about every 420 m, light poles along the start straight, 150/100/50 boards before every big corner, and billboards for fictional sponsors (Voltex, Nimbus Oil, Zap Cola, Kartronix, Skyfizz, Rapido Tyres).
  - **Decals**: painted grid slots, the start/finish checkerboard, oil stains and skid marks.
  - **Reflections**: a small prefiltered environment from the theme's sky (`scene.environment`, intensity 0.45), so wet patches, steel and paint reflect the sky instead of black. Phase 10 tunes it with tone mapping.
- **Why**: Your request, and section 11.3.

### D44 · The race car from reference/kart/kart.jpg (2026-11-18, your request and answers)
- **Q**: You gave a four-view sheet of an open-wheel race car (front, back, side and top) and asked to follow it 100%. How?
- **A**:
  - **Shape**: followed part by part (`host/src/art/car.ts`):
    - a long tapered nose with a black tip and a white nose panel;
    - a three-element front wing with white panels, splayed endplates and pylons;
    - a narrow survival cell with the halo (hoop and centre pillar);
    - undercut sidepods with front inlets, and mirrors on stalks;
    - an engine cover rising to the airbox with a shark fin and large white side panels;
    - a high rear wing with endplates, DRS flap, swan-neck pylon and beam wing;
    - the diffuser and crash structure with a red rain light, and a central exhaust;
    - wishbone suspension, and slick tyres with white sidewall bands and dark rims.
  - **Size**: about 5.9 m long and 2.6 m wide over the tyres, a little shorter than a real car. The physics hitbox is unchanged.
  - **Paint**: your choice. The reference's livery pattern (main colour, white panels, black wings, floor, halo and suspension), with the main colour being the player's slot colour; AI cars are orange.
  - **Logos**: your choice. The real brand marks (team badge, Shell, HP, UniCredit, Santander, Pirelli, CEVA) are replaced in the same places with the game's fictional sponsors (Voltex, Nimbus Oil, Kartronix, Rapido Tyres, Zap Cola, Skyfizz) and a Turbo Karts badge.
  - **Driver**: your choice. The animal characters sit low under the halo in open-face helmets (the character's accent colour with a stripe in the car colour), so their faces and ears still show. Zed the robot keeps its own head.
  - **Number**: your choice. Players carry 1 to 5 and AI cars 10 and up, shown on the engine cover, its sides and the nose.
  - **Deviations from the reference**: the logos (above); the number (above); stylised rather than carbon-textured surfaces (phase 10); and no cartoon outline hulls (D38).
  - **Tools**:
    - `npm run car-sheet` renders the four views and puts them next to the reference in `docs/screens/car-vs-reference.png`.
    - `/dev/car` (dev server only) shows the sheet.
  - **Effects**: skid marks and drift sparks now come from the new rear wheel positions; boost flames come from the exhaust.
- **Why**: Your request. Real trademarks are not copied (section 9).

### D45 · Cinematic art pass from reference/graphics/graphics.jpeg (2026-11-18, phase 10, your request)
- **Q**: You asked to turn the game into the look of your four reference shots ("next-gen" stylised cartoon with rich lighting, nature, particles and lens effects), keeping the layout, camera and HUD. You also asked mid-way for the car to be a little bigger and faster. What changed?
- **A**:
  - **Post-processing** (`host/src/post.ts`), per split-screen view: the views render into one HDR target, then:
    - **Atmosphere**: height fog with sun scattering and low-lying mist.
    - **Lens flare**: only when the sun is actually visible in that view.
    - **Speed blur**: towards the screen edges, with speed and boost.
    - **Bloom**: on the bright parts.
    - **Finish**: colour grading, vignette, chromatic fringe while boosting, and fine film grain.
    - **Output**: ACES Filmic tone mapping, then SMAA anti-aliasing. The target is not multisampled, because a multisampled target loses the earlier split-screen views; SMAA smooths the edges instead.
    - `?nopost` turns it all off, and Q cycles the quality tier (auto, High, Medium, Low).
  - **Lighting per track**:
    - **Meadows**: golden late afternoon, a low warm sun and long shadows.
    - **Canyon**: a blazing sun with flare and dusty haze.
    - **Frosty**: misty sunset twilight.
    - **Sepang**: fog-kissed rolling hills.
    - Shadows are soft (PCF soft) over a wider area. Sky reflections light everything.
  - **Materials**: the toon ramp is gone. Physically based materials throughout, and clear-coated paint on the cars.
  - **Nature** (`host/src/art/nature.ts`):
    - a ridged distant mountain range: snow-capped peaks, banded sandstone buttes, or green hills;
    - soft billboard clouds;
    - swaying 3D grass on every verge and field (up to 40k tufts);
    - colossal eroded sandstone formations in the canyon;
    - snow drifts against the barriers on Frosty;
    - festive bunting along the start straight.
  - **Trees**: leafy broadleaf clusters, darker underneath, and layered pines, frosted on Frosty and denser everywhere.
  - **Start gantry**: rustic steel truss towers with a sagging fabric "TURBO KARTS" banner.
  - **Particles** (`host/src/art/particles.ts`):
    - soft camera-facing smoke, dust and spray instead of solid shapes;
    - exhaust haze, wet tyre spray on Frosty and blowing dust behind the cars in the Canyon, plus kicked-up snow;
    - glowing sparks;
    - air in every track: leaves and pollen, desert dust, falling snow, or mist motes.
  - **Item boxes and shield**: holographic. The boxes are a translucent, iridescent rounded shell around a glowing "?" core, and the shield is a soap-bubble sphere.
  - **HUD**: glass panels with soft shadows and glowing indicators; a gradient place number; glass name tags with a glowing rim in the car colour. The layout is unchanged.
  - **Your mid-way request**:
    - **Bigger**: the car is drawn 15% bigger. Its collision size is unchanged.
    - **Faster**: speed goes from 1.22 to 1.30 (about +7%). The tracks are 7 to 10% longer to keep 2-minute laps: Meadows 5.02 km, Canyon 5.08 km, Frosty 4.97 km and Sepang 4.73 km, with Normal AI laps of 118 to 120 s.
  - **Performance** (GTX 1650, 1920 × 1080, vsync): 60 FPS with 1 to 5 views at full resolution. With 3 or more views, tree shadows are off and grass is thinned; with 4 or more, the shadow map is smaller.
- **What the reference shows that is not built yet**:
  - **Drivers**: animated driver expressions and fully modelled tyre treads (phase 11's game-feel work).
  - **Volumetric light**: real volumetric light shafts are approximated by fog in-scattering.
  - **Asphalt**: the snow slush layer on the asphalt is not modelled.
- **Why**: Your request.

### D46 · Mechanics pass (2026-11-19, phase 11, my decisions)
- **Q**: How does phase 11 tighten handling, items and AI without losing the feel you scored 4?
- **A**: Every change sits behind `Handling.v2`; `PROTOTYPE_HANDLING` keeps the parity test bit-exact.
  - **Tyre model**:
    - Sideways grip follows the slip angle. It rises to a peak at about 7° and then falls off softly to 72%, capped at 34 m/s² (scaled by surface).
    - Normal cornering stays in the linear part, so it feels exactly as before.
    - Big slides saturate and recover in about a second instead of snapping straight.
    - Drifts keep their own grip.
  - **Drift bonus**: releasing within 0.2 tier-units of reaching a tier adds 0.35 s of boost, with "PERFECT DRIFT!", a chime and a phone pulse.
  - **Collisions**: each car collides as two circles (front and rear, 3.5 m apart), matching the long race car. Nose-to-tail bumps now connect.
  - **Character balance**:
    - The speed stat moves top speed 45% as much as before.
    - The AI's corner speed scales with each character's handling.
    - Median laps per character are within 1.2 to 3.1% on every track (target 4%).
  - **Items: all 8**:
    - **Rocket Booster**: only for the last two places. A 3 s tier-3 boost that also ploughs through hazards.
    - **Seeker Comet**: rare, 4th place and below, never on lap 1, one at a time. It arcs over the field to the leader with a 2.4 s warning, then strikes. A boost dodges it and a shield blocks it.
    - **Fairness**:
      - The roll depends only on place and lap, so the AI never gets better items than a human in the same place.
      - Homing orbs warn their target ("⚠ INCOMING!" on screen and phone, with a vibration).
      - Protection after hits is unchanged.
  - **Racing line**: precomputed per track by relaxing the path towards the straightest line through the corridor (4.5 m inside the edges).
  - **AI**:
    - **Mistakes**: late turn-in and running wide, about every 13 s on Easy, 28 s on Normal and 70 s on Hard.
    - **Drifting**: it drifts in many more corners (8 to 35 drifts per race instead of 1 to 3).
    - **Items**: it fires turbos inside shortcuts and uses the new items.
    - **Shortcuts**: it takes them only while holding a boost to fire inside. Measured on Meadows, braking for the turn-in otherwise costs about 2.7 s per lap.
    - **Lost-car rescue**: AI cars on a shortcut are no longer rescued as "lost".
  - **Difficulty**: v2 pace and corner caution per level. Measured (10 races): Easy→Normal 4.7 to 5.9%, Normal→Hard 3.3 to 5.2% on every track (D9: at least 3%). Normal laps are 118.5 to 120 s.
  - **Checkpoints**: crossings are measured from the last checked position, so a collision push across a checkpoint line still counts. This was the rare "missed checkpoint" on Sepang.
  - **Photo finish**: two cars over the line within 0.2 s, with a player involved, play out at 30% speed for 1.6 s with "PHOTO FINISH!".
  - **Camera**: kept above the ground (section 12.1 camera collision).
  - **Meadows shortcut**: widened from 12 m to 15 m.
- **Deferred**:
  - **Race intro flyover**: to phase 12, with the race flow.
  - **Debug overlay additions** (input rate, latency, physics vectors): to phase 13.
- **Why**: Section 12.

### D47 · Shinier, more realistic car finish; Sepang in the Grand Prix (2026-11-19, your requests)
- **Q**: You asked for the car to look more realistic and shiny, and for Sepang Circuit to be part of the Grand Prix.
- **A**:
  - **Finishes**: each part of the car has its own physically based finish, still in one draw call per car. The values live in a per-vertex `aPbr` attribute that the car shader reads.
    - **Paint**: metallic flake under a glossy clear-coat.
    - **White panels**: pearl.
    - **Black parts**: lacquered carbon fibre with a fine twill weave.
    - **Tyres**: satin rubber, with matte sidewall bands.
    - **Rims**: machined metal, now with five spokes.
    - **Rain light**: glowing.
  - **Reflections**: glossy parts use half-smoothed normals, so sky reflections sweep across the panels. The car reflects the sky through its own environment map at 1.9× strength, stronger than the scenery.
  - **Decals and driver helmets**: clear-coated too.
  - **Grand Prix**: runs all four tracks in the order Meadows → Canyon → Frosty → Sepang (phase 12).
- **Why**: Your requests.

### D48 · Modes and flow (2026-11-19, phase 12)
- **Q**: How do the leader's settings, the Grand Prix, the trophy ceremony and the race intro work?
- **A**:
  - **Leader settings on the phone**: on the waiting screen the leader sets the mode (Single race or Grand Prix), the track (single race), laps (1 to 3), AI difficulty, AI racers on or off, and items on or off. The server validates every value (section 12.8); everyone else sees a one-line summary. Host shortcuts remain: T cycles the track and G toggles the mode.
  - **Grand Prix**: all four tracks in the order Meadows → Canyon → Frosty → Sepang (your choice: Sepang is in).
    - **Points**: 15, 12, 10, 8, 6 and 4. Ties go to the better best finish, then to the latest race.
    - **Identity across races**: players by slot, AI by character.
    - **After each race**: the host shows the race results with "+points" and the standings so far. The phones show the same, and the leader gets NEXT RACE (Enter on the host).
    - **After the final**: the podium shows the overall top three under a spinning golden trophy, the title names the champion, and the leader gets NEW GRAND PRIX or LOBBY. Going back to the lobby abandons a Grand Prix.
    - **Data**: scoring is plain data (`shared/src/gp.ts`) with unit tests.
  - **Race intro** (section 12.4): a 4.2 s flyover from high over the track back down the start straight to the grid, with a title card (track, and "Grand Prix · Race 2 of 4" or laps and difficulty). Space skips it. Automation skips it unless asked (`race({ intro: true })`).
  - **Fixed**: switching to a second track crashed since phase 10, because the cinematic pass removes the scene's fog and the next theme change recoloured it. This affected T in the lobby and every Grand Prix race after the first.
- **Why**: Section 12.6 and section 12.4.

### D49 · Car livery and shape from the second reference; characters on the podium (2026-11-19, your request)
- **Q**: You gave a new four-view reference (`reference/kart/kart-v2.jpg`, a modern open-wheel car in a neon multicolour livery) and asked for the podium to show the characters instead of the cars.
- **A**:
  - **Livery**: drawn in the car shader as neon chevrons sweeping forward over the paint, in yellow-green, blue, purple, pink and a thin white line. On top surfaces they form forward-pointing V's, as in the reference's top view; on the sides they rise diagonally. They come in groups with short plain gaps, are anti-aliased, and fade towards the nose tip. One draw call per car, no textures.
  - **Base colour**: still each player's own colour (D44); the reference's red is P1's red, and AI cars are orange.
  - **Shape**:
    - a carbon lower body (survival cell, nose and sidepod undercut);
    - wider, sculpted sidepods;
    - a front wing that sweeps up towards its tips, with neon endplates;
    - a painted top flap on the rear wing, with rounded corners and neon endplate bands;
    - bigger, wider tyres (rear radius 0.70 m, front 0.60 m) with yellow sidewall bands and lettering marks.
  - **Sponsors**: the reference's words, which are generic or the game's own: VELOCITY (large on the sidepods), HYPER, AGILE, KARTRONIX (rear wing), RAPID TYRES (front wing) and NEXTGEN (beam wing). Text is white or neon yellow with a dark outline. Numbers show as "#1" to "#5" for players, matching the reference's "#7" style.
  - **Podium**: the top three characters stand on their steps instead of their cars. Each wears a racing suit in their car's colour with white stripes, gloves and boots, with their own face showing.
    - **Winner**: jumps with both arms up.
    - **2nd and 3rd**: bounce and wave.
    - **Grand Prix**: the trophy still turns above the champion.
  - **Comparison**: `npm run car-sheet` now compares with `kart-v2.jpg`.
- **Why**: Your request.

### D50 · Performance pass (2026-11-19, phase 13)
- **Q**: Do we meet section 12.8's budgets, and how is that checked?
- **A**:
  - **`npm run perf`** (`tools/perf.ts`): runs the host in Chrome on the GPU with vsync off at 1920 × 1080 on Frosty Peaks (the heaviest track). It records frame time, draw calls, triangles and simulation ms for 1, 3 and 5 views, plus the shadow-pass share, then runs a leak check: 8 races over all four tracks, with GPU geometries, textures and shader programs and the JS heap after a forced GC.
  - **Results** (GTX 1650):

    | Views | Median frame | p95 | Draw calls | Simulation |
    |---|---|---|---|---|
    | 1 | 3.6 ms | 9.3 ms | 78 | 0.05 ms |
    | 3 | 5.0 ms | 11.8 ms | 275 | 0.06 ms |
    | 5 | 6.7 ms | 10.9 ms | 384 | 0.08 ms |

    Section 12.8 budgets: rendering at most 12 ms with 5 views and simulation at most 2 ms. Draw calls stay under 400 (D39's target).
  - **Draw-call cut**: with 3 or more views only the car body casts a shadow (the wheels and driver are too small to matter): 480 → 384 calls with 5 views.
  - **Leak fixed**: the kerb material's two canvas textures were never freed when the track changed (freeing a material does not free its textures). Textures now hold at 61 to 65 across 8 races; geometries, programs and the 51 MB heap are flat.
  - **Automatic quality** (section 6.3): if frames average over 18 ms for 2 s, the pixel ratio drops in steps to 0.75. If it is still slow, the post tier is forced to Low (bloom and grain off), and then real-time shadows go off (the cars keep their blob shadows). With headroom it restores in reverse order. Q still overrides the tier.
  - **Debug overlay** (D or `?debug=1`):
    - **Stats**: FPS, CPU ms, simulation ms, draw calls, triangles, pixel ratio, quality tier and any automatic reduction.
    - **Per player**: phone type, ping, inputs per second, and estimated input latency (ping / 2 plus the measured wait until a simulation step uses the input). Your iPhone's 54 ms ping gives about 35 ms, within the 50 ms target.
    - **In the 3D view**: velocity vectors, headings, the checkpoint gates and the start line.
- **Why**: Section 12.8.


### D51 · Festive podium ceremony (2026-11-19, your request with a reference)
- **Q**: How should the podium look, given the 2 × 2 reference of festive podiums (one per track)?
- **A**: The podium is rebuilt in `host/src/art/celebration.ts`. The camera angles and the results card position stay the same.
  - **Stage** (always there):
    - a deep blue base and a white top with a neon edge in the track's colour: green on Meadows, orange on Canyon, cyan on Frosty, blue on Sepang;
    - gold, silver and bronze steps in polished, marble-veined metal with glowing frames;
    - chrome poles with gold finials and pennants, and a gold bar reading ★ VICTORY ★;
    - on Frosty Peaks, snow caps and drifts on the steps and icicles under the stage edge.
  - **Celebration** (only during the podium):
    - bunting along the bar and from the pole tops out to the sides and to the front;
    - swaying balloon clusters, and two championship banners with a trophy and stars in the track's colours;
    - fireworks behind the stage (peony, gold willow with trails, ring and crackling shells);
    - sparkler fountains at the stage front and on the ground, and twinkling stars round the bar;
    - foil confetti that tumbles, settles and fades, plus curly ribbons; confetti cannons from both poles at the start;
    - searchlights sweeping the sky; falling snow on Frosty Peaks;
    - on Sunny Meadows, a stand of cheering animal fans behind the steps and a stadium light tower.
  - **Characters**: spacesuit details (shoulder and knee pads, a chest panel with status lights, a metal neck ring, a life-support pack, a glowing buckle) and vinyl-toy heads.
  - **Results card**: framed in the track's theme:
    - Meadows: gold with twinkling stars;
    - Canyon: sun gold with a zig-zag band;
    - Frosty: icy, with snow and icicles;
    - Sepang: green with leaves and a green RACE AGAIN.
    - All themes: a glowing frame, a gold title, and glossy buttons with a light sweep.
  - **Cost**: the stage is 4 draw calls at all times; the celebration adds about 14 while the podium shows, and nothing during a race. 60 FPS on all four tracks at 1080p. `tools/podium-shot.ts` captures each track's podium.
- **Why**: Your request. The reference's look comes from bloom, particles and colour, so glowing materials and particles do the work here; no real-time lights were added, because adding lights would recompile every material.

### D52 · Softer podium glow; modern, professional typography (2026-11-19, your request)
- **Q**: Tone down the podium's glow, and give the game modern, professional typography.
- **A**:
  - **Podium glow**: about half as strong everywhere:
    - the stage's neon edge and the step frames;
    - the VICTORY bar, the banners and the light tower.
    - The silver step is lighter, so it still reads as silver without the glow.
  - **Typefaces**: Fredoka (rounded and playful) is replaced by two typefaces, bundled offline like before:
    - **Inter** for all interface text: names, lists, hints, labels and settings. Lap times, standings and splits use tabular figures, so the digits line up.
    - **Barlow Condensed** (bold or extra-bold, uppercase, with a slight racing italic) for display text in the style of motorsport TV graphics: the logo, place, lap, speed, the countdown and messages, FINISHED, the results and pause titles, the intro card, the room code and the big buttons.
  - **Text treatment**:
    - The cartoon outlines and hard offset shadows are replaced by soft shadows.
    - Labels are in small caps with wide letter-spacing.
    - The logo is no longer tilted.
    - Canvas-drawn text (car sponsor decals, name tags, track signs and the VICTORY bar) uses the new typefaces, which are loaded before anything is drawn.
  - **Phone**: Inter is wider than Fredoka, so on a landscape phone the settings labels and the one-line summary are slightly smaller. READY stays on screen.
- **Why**: Your request.

### D53 · Closer race camera (2026-11-19, your request)
- **Q**: Make the race camera a little closer.
- **A**: The chase camera is about 15% closer and a little lower (`host/src/camera.ts`):
  - distance: 9.8 → 8.3 m, plus up to about 1.7 m at top speed (was about 2 m);
  - boost pull-back: 1.4 → 1.2 m;
  - height: 4.0 → 3.5 m.
  - The countdown swing-in, the drift framing and the field of view are unchanged.
  - Before and after: `docs/screens/phase14/camera/before-after.jpg`.
- **Why**: Your request. The car fills more of the screen, and there is still enough road ahead to see corners coming.

### D54 · Broadcast-style chase camera (2026-11-19, your reference; replaces D53)
- **Q**: Make the race camera look like your reference screenshot of a TV-style racing game: low and tight behind the car.
- **A**: Changes in `host/src/camera.ts`:
  - **Position**: 7.9 m behind the car's centre (about 4.5 m behind the rear wing), plus up to about 0.8 m at top speed. The camera is 2.55 m high, just above the roofline, and aims 16 m down the road at 1.25 m, so the horizon sits about 40% down the screen.
  - **Speed-independent framing**: the camera's smoothing used to leave it about speed ÷ 8 metres further back than intended (4 m at 100 km/h). It now leads by 65% of that, so the framing barely changes with speed. A little trailing is kept for the sense of speed.
  - **Lens**: 6° narrower than before. It still widens with speed and boost, and still widens for split-screen views.
  - **Result**: the car's rear sits in the lower middle at about a quarter of the screen width, as in the reference.
  - The countdown swing-in and the drift framing are kept. Tested in 1 to 5 player split-screen at 60 FPS.
- **Why**: Your request.

### D55 · Higher chase view from the second reference; softer sun (2026-11-19, your request; refines D54)
- **Q**: Match the second reference (a sports-car chase view from slightly above), make the view a little higher, and tone the sun down a little.
- **A**:
  - **Camera** (`host/src/camera.ts`):
    - **Position**: 3.3 m high (was 2.55 m) and 6.5 m behind the car's centre, plus about 0.5 m at top speed. It aims 12 m ahead at 0.9 m, so it looks down onto the roof and wing, and the horizon sits about a third of the way down.
    - **Speed trailing**: it leads by 82% of the trailing, so at speed the car keeps the reference framing: its rear in the lower middle, its bottom about 85% down the screen, and about 27% of the screen width.
    - **Drifts**: the camera eases back up to 1.8 m, because the car swings sideways.
    - **Spin-outs** (oil or hits): it eases back up to 3.2 m, quickly in and slowly out.
  - **Sun** (`host/src/renderer.ts`, `SUN_SOFT`, all tracks):
    - the disc and its glow in the sky at 70%;
    - the sun haze at 75%;
    - the lens flare at 55%;
    - the in-scattered sun colour at 88%.
  - **Capture tool**: shots taken right after a fast-forward now wait 0.6 s (`--settle`), so the camera has caught up. The old 0.12 s caught the camera mid-move and made drift shots look too close.
  - **Results**: tested in 1 to 5 player split-screen at 60 FPS, with no errors. Screens: `docs/screens/validation/race-view-v3/`.
- **Why**: Your request.

### D56 · Shimmer fix: multisampling, far grass, fence coverage, road mip bias, tunnel z-fighting (2026-11-19, phase 14)
- **Q**: "Aliasing and shimmer" was the only scorecard item below 4 (3 since phase 1). What causes it, and how is it fixed without losing the look or 60 FPS?
- **Measurement**: a new tool, `tools/shimmer.ts`, freezes a race and renders it five times, turning the camera a quarter of a pixel each time. A clean picture slides smoothly; a shimmering one flickers. It reports the share of pixels that flicker (second difference above 24 of 255), skips pixels that change with no camera movement (flames, smoke), and saves a heat map. It runs on 4 tracks at 2 race moments each, at 1920 × 1080.
- **Causes** found in the heat maps:
  - **No real anti-aliasing in races.** Since D45 the scene renders into an HDR target that was not multisampled, so only SMAA smoothed the edges. SMAA cannot fix details thinner than a pixel.
  - **Far grass blades** (9 cm wide) are thinner than a pixel past about 60 m.
  - **The catch-fence wires** were cut out with a hard alpha test, so at a distance they popped in and out.
  - **The asphalt's stones** sparkled in the mid-distance.
  - **Z-fighting in tunnels**: the tunnel walls sat exactly on the barrier line (Canyon).
- **A**:
  - **MSAA on the scene target** (`host/src/post.ts`): 4× on High, 2× on Medium and Low. Three.js resolves after each view's render call, and the resolve obeys the scissor, so split-screen views survive. SMAA stays on for edges inside textures. `?msaa=N` overrides it for testing (`0` is a debug switch only, because the fence then needs multisampling).
  - **Grass** (`host/src/art/nature.ts`): past 22 m the blade roots widen with distance, keeping them about a pixel wide. From 55 to 90 m the tufts sink into the ground, where the terrain's grass texture carries the colour.
  - **Catch fence**: alpha-to-coverage instead of the alpha test, so far wire fades smoothly.
  - **Road**: a 0.6 mip bias on the asphalt colour and normal maps. The stones still read close up.
  - **Tunnels**: the walls and ceiling sit 0.3 m outside the barrier line.
- **Results** (`docs/screens/phase14/shimmer/`):
  - **Flicker pixels**: 2.32% → **1.01%** (−56%). The mean second difference went from 2.00 to 1.18. The Canyon tunnel went from 3.06% to 0.67%.
  - **Frame time** (`docs/screens/phase14/perf.json`, uncapped): 1 view p50 3.6 → 4.3 ms; 5 views p50 6.7 → 7.7 ms and p95 10.9 → 15.3 ms. Still under 16.7 ms, so a locked 60 with vsync. The automatic quality steps still apply.
  - No leaks, and no errors.
- **Why**: Section 13 target (every item at 4 or higher) and acceptance check 14 (no jaggies or shimmer).

---

## Gate 0 status
All decisions are settled (D1 to D16). **You confirmed a shared understanding on 2026-11-16. Gate 0 is closed.**
