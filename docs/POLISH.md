# Polish scorecard

Scores run from 1 to 5. The target is 4 or higher for every item by the end (section 13). A score may never drop from one phase to the next.

---

## Phase 1: prototype baseline (2026-11-16)

### How it was measured
- **Browser**: Chrome on the GTX 1650 (ANGLE / D3D11), headless with the hardware GPU confirmed by the WebGL renderer string. Driven by Playwright.
- **Screenshots**: `docs/screens/phase1/` (before the fixes) and `docs/screens/phase1/after/` (after).
- **Test driver**: the AI driving controller at skill 0.93, so the captures are repeatable.

### Rendering bugs found and fixed

| # | Bug | Cause | Fix |
|---|---|---|---|
| 1 | Every toon-shaded object rendered with a red cast: blue karts looked salmon, black looked maroon, green trees looked brown, and the blue podium looked pink | The toon gradient map was a `RedFormat` texture. `MeshToonMaterial` samples `gradientMap.rgb`, so all direct light became `(r, 0, 0)` | Store the same 3 steps as an RGBA texture |
| 2 | A kart passing near the camera showed a giant name tag across a third of the screen | Name tags are world-sized sprites, hidden only under 4 m | Fade out from 14 m to 9 m, hidden under 9 m |
| 3 | The countdown hint ("Press SPACE…") was unreadable | 17 px white text with a hard 3 px drop shadow over snowy mountains | Put the text on a dark pill background |

No console errors or warnings appeared in a full race.

### Issues noted but not fixed (the port or a later phase replaces this code)
- The camera can pass through item boxes; there is no camera collision (section 12.1).
- Name tags overlap when several karts bunch up in the distance (section 9: per-player tags).
- The far terrain ring shows a continuous white "snow band" along the horizon.
- On the podium screen, the results panel covers the podium.
- The look is flat: a 3-step toon ramp, no image-based lighting and a single hard PCF shadow (D5 moves to PBR).

### Performance baseline (1080p, vsync off, GTX 1650)

| Views | Median frame | p95 frame | Draw calls | Triangles |
|---|---|---|---|---|
| 1 (1600 × 900) | 1.4 ms | 2.3 ms | 65 | 132k |
| 1 (1920 × 1080) | 1.6 ms | 3.7 ms | 68 | 134k |
| 5, simulated with scissored viewports | 5.0 ms | 6.6 ms | 348 | **670k** |

With vsync on, it holds a steady 60 FPS. The 5-view case is already **over the 600k-triangle budget** (section 10.6) with only the short prototype track. Level of detail, distance culling and lighter shadow passes per viewport are required for the Low and Medium tiers.

### Gameplay baseline (headless, from `docs/DECISIONS.md`)
- Lap: 1,279 m, median **48.6 s** (test driver, Normal).
- Character spread: 2.66 %.
- AI gaps: Easy to Normal 3.6 %, Normal to Hard 2.9 %.
- No rescues and no unfinished karts in 120 races.

### Scores

Gameplay scores marked * come from metrics and code reading only. They still need a hands-on feel check (see gate question G1-1).

| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | Aliasing and shimmer | 3 | Native MSAA keeps edges clean, but the thin kerb and fence stripes shimmer at distance |
| Graphics | Lighting and shadow quality | 2 | Hard 3-step toon ramp, a single hard PCF shadow, no image-based lighting or ambient occlusion |
| Graphics | Road, kerb and terrain material | 2 | Flat canvas textures, flat kerb strips, faceted vertex-coloured terrain |
| Graphics | Texture tiling visibility | 3 | Low detail hides repeats, but the grass stripes repeat visibly |
| Graphics | Scenery density and variety | 2 | One theme and one prop kit everywhere, no sectors |
| Graphics | Kart and character detail | 2 | Boxy, no bevels, simple heads |
| Graphics | Effect quality | 3 | Sparks, rings, flames and skids all work, but they are chunky and opaque |
| Graphics | Readability at 1/5 screen | 3 | Karts stand out on the road; name tags overlap. Estimated from the 5-view test |
| Graphics | Colour harmony | 3 | Cheerful, consistent palette once bug 1 is fixed (it scored 1 before the fix) |
| Graphics | UI finish | 3 | Clean, chunky HUD; some overlays pop in without transitions |
| Gameplay | Steering smoothness | 3* | Digital input with a 7/s steering slew rate; no analog steering or response curve |
| Gameplay | Drift feel | 3* | The hop, three tiers and turbos all work; no tier-release bonus |
| Gameplay | Camera smoothness | 3 | Frame-rate-independent smoothing, but no collision; it passes through item boxes |
| Gameplay | Collision feel | 3* | Mass-based impulses and wall sliding, with no pinning in 120 races |
| Gameplay | Item fairness | 3* | Weighted by position, but no warnings for incoming projectiles |
| Gameplay | AI believability | 3* | No orbits, rescues or unfinished karts; the Normal-to-Hard gap is too small |
| Gameplay | Input latency | n/a | Local keyboard only; measured from phase 5 |
| Gameplay | Frame-time stability | 4 | p95 is 2.3 ms for 1 view and 6.6 ms for 5 views |

---

## Phase 3: logic port (2026-11-16)

### What changed
The game logic moved to `shared/` (TypeScript, seeded RNG, multi-human API). **No behaviour changed.**
- `tests/prototype-parity.test.ts` runs the prototype's own logic next to the port, in 6 configurations (seed, difficulty, items, character).
- Kart positions, speeds, laps, ranks, items, boosts and events are **bit-for-bit identical** at every step of full 3-lap races.
- The test catches a 0.001 m/s change to the boost speed within 5 seconds of race time.

### Capture
- **Screenshots**: none this phase, because the host does not render the game yet (phase 4).
- **Metrics**: `npm run sim-report`, saved to `docs/sim-report-phase3.json`.

| Items | Diff | Driver lap | AI lap | Driver place | Rescues / race | Items / race | Unfinished | Max stuck |
|---|---|---|---|---|---|---|---|---|
| off | easy | 48.2 s | 50.8 s | 1.85 | 0 | 0 | 0 | 0.1 s |
| off | normal | 48.7 s | 48.9 s | 2.95 | 0 | 0 | 0 | 0.1 s |
| off | hard | 48.8 s | 47.6 s | 5.10 | 0 | 0 | 0 | 0.1 s |
| on | easy | 48.7 s | 49.5 s | 2.50 | 0 | 77.7 | 0 | 0.1 s |
| on | normal | 49.3 s | 48.5 s | 3.70 | 0 | 78.1 | 0 | 0.1 s |
| on | hard | 49.1 s | 47.5 s | 4.90 | 0 | 80.2 | 0 | 0.1 s |

- **AI gaps**: Easy to Normal 4.0 %, Normal to Hard **2.7 %** (target 3 %; retuned in phase 11 per D9).
- **Character spread**: 2.67 %.
- **Simulation cost**: 0.005 ms per step on average (p99 0.024 ms), against a 2 ms budget.
- Driver places differ slightly from phase 1 because the default grid now puts humans last instead of 5th (see gate question G3-1).

### Scores
All scores are unchanged from phase 1, because the logic is identical by construction and no rendering changed. The three lowest items (lighting, road materials and scenery, all at 2) are art work that this logic-only phase cannot touch. See gate question G3-2.

---

## Phase 4: renderer port (2026-11-16)

### What changed
The prototype renderer is ported to Three.js 0.187 from npm, as TypeScript modules under `host/src/` (`art/*`, `renderer`, `camera`, `hud`, `session`, `audio`, `debug`).
- **Built for split-screen**: one `World` renders a list of views (scissored viewports); camera and HUD are per player.
- **Colour management**: sRGB output, with light intensities × π to match the prototype's pre-r155 lighting. Tone mapping stays off until the art pass.
- **Karts**: painted in the slot colour (P1 red, AI orange) per D11.
- **Reproducible captures**: scenery placement and effects use seeded generators.

### Capture (`npm run capture -- --phase phase4`, GTX 1650, 1600 × 900)
`docs/screens/phase4/`: title, countdown, race start, mid-drift, mid-boost, 40 s, 75 s and podium. The capture logged no console errors.

| | Prototype (phase 1) | Port (phase 4) |
|---|---|---|
| Median frame, 1080p, vsync off | 1.6 ms | 1.6 ms |
| p95 frame, 1080p, vsync off | 3.7 ms | 3.4 ms |
| Draw calls (single view) | 65–68 | 87–133, depending on view |
| Triangles | 134k | 168k |

The draw-call increase comes from the shadow pass: each kart casts shadows from 5 separate meshes (41 shadow casters in total). The fix (merged kart parts, a cheaper shadow tier) is scheduled for phase 13 and is needed before 5 viewports can fit the 400-call budget.

### Fixes this loop (the 3 lowest items this phase can touch, per D27)
1. **Readability of name tags.** Tags are now sized by distance, so far tags stay readable and near ones small. They fade in at 9–14 m and fade out at 48–60 m (section 9), and are evaluated per viewport.
2. **UI finish.** On wide screens the results panel sits beside the podium, and the podium camera frames the ceremony left of centre. Overlays fade in instead of popping.
3. **Camera after a fast-forward.** The chase camera snaps after a simulation jump. The capture tool showed it trailing 60 m behind before this fix.

### Scores (compared with phase 3)
| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | Aliasing and shimmer | 3 | Same as before: MSAA, with thin far stripes still shimmering |
| Graphics | Lighting and shadow quality | 2 | Deferred to the art pass (D27) |
| Graphics | Road, kerb and terrain material | 2 | Deferred to phase 9 |
| Graphics | Texture tiling visibility | 3 | Unchanged |
| Graphics | Scenery density and variety | 2 | Deferred to phases 8–10 |
| Graphics | Kart and character detail | 2 | Deferred to the art pass |
| Graphics | Effect quality | 3 | Ported 1:1; flame flicker is now deterministic |
| Graphics | Readability at 1/5 screen | 3 | Tags improved; split-screen is not built yet, so this is not measurable until phase 6 |
| Graphics | Colour harmony | 3 | Slot paint reads clearly; five orange AI karts lose some variety (accepted in D11) |
| Graphics | UI finish | 3 | Better: the podium is visible beside the results and overlays fade in. The HUD is still the prototype's |
| Gameplay | Steering smoothness | 3* | Logic unchanged (parity test) |
| Gameplay | Drift feel | 3* | Unchanged |
| Gameplay | Camera smoothness | 3 | Same smoothing; snaps correctly after jumps. No collision yet (phase 11) |
| Gameplay | Collision feel | 3* | Unchanged |
| Gameplay | Item fairness | 3* | Unchanged |
| Gameplay | AI believability | 3* | Unchanged |
| Gameplay | Input latency | n/a | Phase 5 |
| Gameplay | Frame-time stability | 4 | p95 3.4 ms (1080p, vsync off); a steady 60 FPS with vsync |

No score dropped. Your keyboard feel check (D19) is due at this gate.

---

## Phase 5: networking and phone controller (2026-11-16)

### What changed
- **Server**: rooms and slots, with join, reconnect by token, leader, unique characters, a 30 s lobby grace period and expiry 10 minutes after the host leaves. Phone input is validated, rate-limited to 60 per second, and relayed as volatile emits.
- **Host**: the QR lobby (section 6.1). Phones drive karts, a stale input (over 500 ms) falls back to throttle-only, and a dropped phone's kart goes to the AI. A host refresh resumes the same room.
- **Phone**: the controller built from the reference (D3, D14), with join, waiting and results screens, a settings sheet and a leave confirmation. It has haptics (vibrate, or the iOS switch trick), fullscreen and orientation lock on Android, wake lock or a tip, and Add to Home Screen.
- **Tools**: `npm run e2e` checks the multiplayer path with emulated phones; `npm run bots` adds simulated phones to a room.

### Capture and checks
- **Multiplayer path**: `npm run e2e -- --phase phase5` passed **14/14** (`docs/screens/phase5/e2e.json`): join, room full, leader start, per-phone input routing, multi-touch steer and drift, AI takeover, reconnect to the same kart, host refresh keeping the room, and the rotate overlay.
- **Single-player rendering**: `npm run capture -- --phase phase5` gave the same numbers as phase 4 (60 FPS, 121 calls, 168k triangles), so there is no regression.
- **Controller vs reference**: `docs/screens/controller-vs-reference.png`.

### Fixes this loop (the 3 lowest items this phase can touch)
1. **UI: tips covering controls.** The "Add to Home Screen" and auto-lock tips covered the driving controls and, on an iPhone SE, the JOIN button. Tips now appear only on the waiting screen, at the top. (The tip had also been knocked off-centre by its rise animation's `transform: none`.)
2. **UI: icon style.** Colourful emoji on BRAKE, DRIFT, settings and sensitivity clashed with the reference's grey, blue-glow style. They are now grey line icons that glow blue when pressed.
3. **UI: lobby.** The close-up preview camera put a penguin's head between the logo and the cards, and name tags showed through. The lobby now uses a wide, high orbit over the grid, and tags show only while racing. The slot subtitle had been centred by a style clash.

### Scores (compared with phase 4)
| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | UI finish | **4** (was 3) | New lobby and phone controller: consistent, animated and readable. The in-race HUD is still the prototype's |
| Graphics | Readability at 1/5 screen | 3 | 5 viewports render; HUD and tags still need sizing for small views (phase 6) |
| Gameplay | Input latency | n/a | Emulated phones measure about 1 ms round trip on the same machine. The real iPhone over Wi-Fi is at this gate |
| (all others) | | unchanged | No regressions; the race renders exactly as in phase 4 |

### Phase 5 gate: your iPhone test (2026-11-18)
- **Result**: connected at 54 ms; haptics felt. Steering **2**, drift **2**, camera **2**. Controls too small; drift felt like hopping.
- **Fixes (D35)**: low drift hop plus a sideways slide and slide angle; a camera that follows the direction of travel; tap-to-correct steering ramp; a much larger cross pad and slider.
- **Checks after the fixes**: 40 tests pass; sim-report lap times unchanged (48.2–48.7 s); e2e 14/14 (`docs/screens/phase5-feel/`); capture 60 FPS, 121 calls. The drift shot `docs/screens/phase5-feel/04-mid-drift.png` shows the kart angled across its line.
- **Your retest**: steering **3**, drift **4**, camera **4**; the cross pad size is good; you prefer the slider.
- **Second round (D36, D37)**: karts 12% faster, sharper turning, a near-linear slider that reaches full lock at 85%, slider as the default, and PAUSE on the phone. sim-report: laps about 44 s, no rescues, AI gaps 3.3% and 2.9%, character spread 3.67% (still within 4%). e2e **15/15**, including the new pause check (`docs/screens/phase5-feel2/`).
- **Your third test**: steering **4**; speed "a little bit slower"; pause and resume work from the phone. Speed set to +8% (laps about 45.5 s; AI gaps 3.4% and 2.9%; character spread 3.72%).
- **Gate result**: steering 4, drift 4, camera 4. **The phase 5 gate is closed** (2026-11-18).

---

## Phase 6: split-screen (2026-11-18)

### What changed
- **Shared minimap and live standings** (D39): in the side gaps for 3 and 5 players, a compact centre panel for 2 and 4, and the corner for 1 player. Human karts show as large ringed dots.
- **Per-view HUD**: player-colour frame and name chip; mirrored layout for right-hand views; minimum scale 66%; larger speed text; a reconnecting badge; and a FINISHED banner, after which the view switches to a wide orbit.
- **Cameras**: FOV goes up smoothly as views get narrower. Another kart right next to a view's camera is hidden in that view.
- **Range**: shorter fog and draw distance with more than 3 views. Draw calls are now counted over all views (the debug overlay and the capture report used to show one view only).
- **Tests**: `tests/layout.test.ts` checks every player count at 3 screen sizes: inside the screen, no overlaps, equal-size views, and the section 6.2 table.
- **Capture**: `npm run capture` now also shoots and measures 2, 3, 4 and 5 views, a dropped phone and a finished player.

### Capture (`npm run capture -- --phase phase6`, GTX 1650)
| Views | FPS (vsync) | Median frame, 1080p, vsync off | p95 | Draw calls | Triangles |
|---|---|---|---|---|---|
| 1 | 60 | 1.8 ms | 3.7 ms | 134 | 169k |
| 2 | 60 | 2.4 ms | 4.3 ms | 207 | 329k |
| 3 | 60 | 2.6 ms | 4.4 ms | 308 | 495k |
| 4 | 60 | 3.0 ms | 5.0 ms | 374 | 650k |
| 5 | 60 | 3.7 ms | 5.8 ms | 535 | 825k |

Shots: `docs/screens/phase6/split-2.png` to `split-5.png`, `split-5-offline.png`, `split-5-finished.png`.

### Fixes this loop (the 3 lowest items this phase can touch)
1. **Readability at 1/5 screen: karts behind the camera.** At the start grid, karts sitting between a camera and its player filled half of that view. They are now hidden in that view only.
2. **Readability at 1/5 screen: HUD.** Every view repeated a minimap, and the speed text was about 15 px. There is now one shared panel, a 66% minimum scale, larger speed text, and a name chip and colour frame per view.
3. **UI finish: finished players.** A 2.4 s message, then the normal chase view. Now there is a lasting banner and a wide orbit. The first orbit was so close that the kart filled the view under the banner; it was widened and eased in. The centre panel's standings overflowed and sat under the view frames; it now fits its rows and sits above the frames.

### Scores (compared with phase 5)
| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | Readability at 1/5 screen | **4** (was 3) | One shared map and standings, frames and name chips, a 66% minimum HUD scale, no karts filling a view |
| Graphics | UI finish | 4 | Finished banner, reconnecting badge and shared panel all fade or animate in |
| Gameplay | Steering smoothness | **4** (was 3*) | Your iPhone test (D35, D36) |
| Gameplay | Drift feel | **4** (was 3*) | Your iPhone test (D35) |
| Gameplay | Camera smoothness | **4** (was 3) | Your iPhone test; the finish orbit eases in. Camera collision is still phase 11 |
| Gameplay | Input latency | **4** (was n/a) | Your iPhone shows a 54 ms round trip on Wi-Fi, so input arrives in about 27 ms (under the 50 ms target) |
| Gameplay | Frame-time stability | 4 | 5 views at 1080p: p95 5.8 ms |
| (all others) | | unchanged | Art items wait for phases 9–10 (D27, D38); mechanics items for phase 11 |

---

## Phase 7: phone feedback (2026-11-18)

### What changed (D40)
- **During the race**: a 3-2-1-GO countdown with vibration on every phone, a FINAL LAP alert, place-change pops and a WRONG WAY chip.
- **Finishing**: a finish card on the phone the moment you cross the line, then the results. On landscape phones the results use two columns with rank numbers.
- **Reconnecting**: the "Reconnecting…" card adds a hint and a RELOAD button after 10 s.
- **Server**: relays only known haptic kinds.
- **Tests**: `npm run e2e` now has **18 checks** (was 15). The new ones: the finish card shows place and time; results show RACE AGAIN for the leader and "Waiting for the leader" for others; RACE AGAIN restarts and the phones count down to GO.

### Capture
- `npm run e2e -- --phase phase7`: **18/18**. Shots: `phone-finished.png`, `phone-results-leader.png`, plus the earlier set.

### Fixes this loop (the 3 lowest items this phase can touch)
1. **UI: results on a landscape phone.** Six rows pushed RACE AGAIN and LOBBY off the bottom of an iPhone held sideways, so the leader could not see them without scrolling. They now use two columns.
2. **UI: nothing on the phone at the finish.** The phone kept showing the controls and "FINISHED" in small text until the whole race ended. Now a finish card appears straight away.
3. **Game feel: no start signal on the phone.** Phones got a single tick when the countdown began and nothing on GO, against section 6.4. Now they count 3-2-1-GO, with vibration.

### Scores (compared with phase 6)
| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | UI finish | 4 | The phone screens now cover the whole race: countdown, alerts, finish card and results |
| (all others) | | unchanged | |

---

## Phase 8: tracks and lap length (2026-11-18)

### What changed (D41)
- **Tracks**: `TrackDef` data, a builder for the physics tables, and three full-length tracks with sectors, gates, surfaces, pads, item rows, a jump ramp, tunnels, arches, a river and bridge, and shortcuts.
- **Look**: a theme per track: sky, light, ground, walls, mountains and scenery.
- **HUD**: sector splits. **Feedback**: jump and landing.
- **Lobby**: a track picker (chip or T).
- **Tools**:
  - `npm run track-view` draws each layout to `docs/screens/tracks/`.
  - `npm run sim-report -- --track canyon` measures any track.
  - `npm run capture -- --track frosty` also shoots every landmark (`feat-*.png`).

### Headless metrics (sim-report, 10 races per row, 2 laps, items off)
| Track | Length | Normal AI lap | Easy→Normal | Normal→Hard | Character spread | Rescues | Unfinished |
|---|---|---|---|---|---|---|---|
| Sunny Meadows | 3.95 km | 117.7 s | 5.9% | 2.9% | 6.0% | 0 | 0 |
| Dusty Canyon | 4.11 km | 120.3 s | 6.3% | 2.8% | 5.6% | 0 | 0 |
| Frosty Peaks | 4.05 km | 120.3 s | 6.0% | 2.8% | 6.0% | 0 | 0 |

- **Robustness**: 150 seeded races per track (section 15, `ROBUST_RACES=150`): every kart finishes, and none is pinned for 5 s. The default test run uses 12 per track.
- **Off the road**: the AI is off the road under 1% of the time, mostly in the hairpins when the pack is pushed wide.

### Capture (GTX 1650, 1600 × 900, vsync)
| Track | 1 view | 5 views |
|---|---|---|
| Meadows | 60 FPS, 128 calls, 190k tris | |
| Canyon | 60 FPS, 130 calls, 181k tris | |
| Frosty | 60 FPS, 127 calls, 213k tris | 60 FPS, 519 calls, 1.02M tris |

### Fixes this loop (the 3 lowest items this phase can touch)
1. **Layout: hairpins.** After scaling the tracks up for lap length, the tightest turn was only 108 to 143° within 120 m, so there was no real hairpin. Each is now a U with parallel legs (167 to 175°). `tests/tracks.test.ts` checks for at least 160° within 200 m.
2. **Gameplay: the jump ramp sat on a bend.** Karts reached the lip wide and missed the launch. That stretch of the Canyon is now straight.
3. **Graphics: shortcut entrances.** The road's grass verges were drawn across the corridor, hiding the dirt path and leaving a raised edge. Walls and verges now have a gap where a corridor crosses. Also, Frosty's ice shortcut saved about 100 m at full speed, so it is now a slower snow trail worth about 1 s.

### Scores (compared with phase 7)
| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | Scenery density and variety | **3** (was 2) | Three themes, sector landmarks (tunnel, arches, bridge, village, mesas) and themed scenery. Real materials wait for phases 9 and 10 |
| Graphics | Colour harmony | 3 | Each theme is consistent; Frosty's twilight and Canyon's warm haze read well. Toon lighting is unchanged (phase 10) |
| Gameplay | AI believability | 3* | No rescues or unfinished karts on any track, but the AI rarely drifts on the wider corners and ignores shortcuts (phase 11) |
| Gameplay | Frame-time stability | 4 | 5 views on the heaviest track: a steady 60 FPS with vsync |
| (all others) | | unchanged | |

Open for phase 11: AI drifting, AI shortcuts, the character spread (target 4%) and the Normal→Hard gap (target 3%).

---

## Phase 9: surfaces and materials (2026-11-18)

### What changed (D43)
- **Speed and lengths**: karts 13% faster; tracks 13% longer, so laps stay about 2 minutes.
- **Grass on the road**: fixed. Verges and other roadside art fit inside corner radii and the clearance between road sections, and the ground mesh is kept under the road.
- **Textures and materials**: generated texture sets, a physically based road (wear, rubber line, worn paint, Frosty puddles), raised ridged kerbs, a splat ground material with no seam at the verges, gravel traps with stones, and textured shortcut paths and ice.
- **Trackside**: concrete walls or Armco plus catch fences, marshal posts, light poles, distance boards, sponsor billboards and grid slots.
- **Reflections**: a sky reflection for all PBR surfaces.

### Capture (GTX 1650)
- **1 view, vsync**: 60 FPS on every track, 124 to 145 draw calls, 290k to 310k triangles.
- **Frosty, the heaviest, at 1920 × 1080 with vsync off**:

  | Views | Median frame | p95 | Draw calls | Triangles |
  |---|---|---|---|---|
  | 1 | 3.0 ms | 6.5 ms | 133 | 297k |
  | 5 | 4.9 ms | 8.6 ms | 481 | 1.43M |

- **Shots**: `docs/screens/p9-meadows/`, `p9-canyon/`, `p9-frosty/`, `p9-sepang/`, `phase9-canyon/`.
- **Checks**: e2e 18/18; 60 tests.

### Fixes this loop (the 3 lowest items this phase can touch)
1. **Road, kerb and terrain material** (2): flat canvas colours. Now real asphalt with wear, raised textured kerbs, and splat terrain.
2. **Texture tiling visibility** (3): textures sampled in world space with macro variation, and no visible repeats in the captures. The first grass texture had a regular grid of dark dots; that noise layer was replaced.
3. **"Grass on the road"** (your report): roadside strips folded over the road. Fixed as above. On the way, three mistakes from this pass were caught in the captures:
   - Upside-down ribbons were culled: the left kerbs vanished and the grid slots did not draw.
   - The same ribbons were read as cliffs and painted with rock.
   - Puddles rendered black because there was nothing to reflect.

### Scores (compared with phase 8)
| Area | Item | Score | Reason |
|---|---|---|---|
| Graphics | Road, kerb and terrain material | **4** (was 2) | Believable asphalt, kerbs, verges, gravel and terrain up close |
| Graphics | Texture tiling visibility | **4** (was 3) | World-space sampling with macro variation; no repeats visible in the captures |
| Graphics | Scenery density and variety | **4** (was 3) | Barriers, fences, posts, boards, billboards and grid slots on every track |
| Graphics | Lighting and shadow quality | 2 | The sky reflection helps, but tone mapping, soft shadows and AO are phase 10 |
| Gameplay | Frame-time stability | 4 | 5 views at 1080p: p95 8.6 ms |
| (all others) | | unchanged | |
