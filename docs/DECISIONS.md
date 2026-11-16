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

---

## Gate 0 status
All decisions are settled (D1 to D16). **You confirmed a shared understanding on 2026-11-16. Gate 0 is closed.**
