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
