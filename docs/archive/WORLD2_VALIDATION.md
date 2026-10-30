# World2 validation — 11 September 2026

The level runs at `/world2`. Geometry comes from the root `folio-2025.blend`; vehicle, player, input, camera, physics, rendering, lighting, audio, tracks and particles import the existing `/world` modules. Their tuning and fixed-update order were retained. No existing source module was edited.

## Source integrity and geometry

- The 265 baseline files under `src/`, `scripts/`, plus the Blender master were checked against their pre-implementation SHA-256 values: **zero changes**. Existing uncommitted work remains intact. `package.json` only gains World2 commands.
- Source SHA-256: `df5286df6141a6bece01abbd873d87a7f3d915cb685c6c989883cb7457474080`. The exporter verifies this remains unchanged by export.
- Blender inspection: 1,507 scene objects; complete inventory, materials, hierarchy, transforms, hidden state, dependencies and exclusions in `world2-blender-audit.json`.
- Exact external image dependencies recovered from the byte-identical companion source; no substitute height/grass masks. See `assets/world2-source/dependencies.json` and `WORLD2_ASSET_NOTICES.md`.
- Global scale 1. Terrain is 192 × 192 m and retains its −1.5…0 m elevation range, 16,641 vertices and 32,768 triangles.
- GLB world-space bounds agree with evaluated Blender geometry: terrain and grass exactly; road, both bridges and jump within **0.00000382 m**. This compares every vertex's transformed extrema, not estimated screen positions.
- All 70 source tree references are present: 26 birch, 24 oak, 20 cherry. All 17 respawn markers and 13 active area anchors are present.
- Blender and browser top views were visually compared. Road bends, jump, bridge orientation, water basins, vegetation groups, bowling lanes, area landmarks and map orientation correspond. Blender Workbench's grey road/grass display differs from the browser's material rendering; it is a geometry reference, not a colour reference.

Captures: `.qa/world2/blender-top.png`, `browser-top.png`, `drive-spawn.png`, `map.png`.

## Driving checks

`npm run world2:qa` completed **40 checks with no failures or browser errors**. The harness loads the exported GLBs and actual shared vehicle controller.

| Check | Observed result |
| --- | --- |
| Default spawn | Settles on four wheels at the source landing marker. |
| Every source respawn | All 17 settle on a physical surface; no sideways correction of their source positions. |
| W / S / D / B | Acceleration, reverse, steering and braking respond through real browser keyboard input. |
| Shift | Boost increases speed with unchanged engine tuning. |
| Space / wheel hydraulics | Hydraulic jump leaves the ground; individual suspension mapping works. |
| R | Clears motion, boost, wheel contact state and suspension state. |
| Camera | Mouse orbit, wheel zoom and C reset work; shared chase camera retained. |
| Map | M opens the source-generated map; Escape returns to driving. |
| Road surface coverage | All 136 extracted ribbon cross-sections have a physical surface. |
| Entire source road ribbon | Driven continuously through 516 sampled waypoints, using proportional driver intent through Player and the real fixed-step physics. 3,200 driver steps, zero rescues, no falling through the ground. |
| Authored jump | Boosted approach from 4 m before the source ramp endpoint launches the car and lands beyond the gap on the road. |
| Navigation / remount | Home and original world remain accessible; World2 disposes on client navigation and remounts with one canvas. |

The ribbon is open at the authored one-way jump. The road drive and the jump are tested separately in their appropriate directions. QA waypoints derive from `refRoad` quad adjacency; the hidden legacy `curveRoad` extends outside the map and is deliberately not used. Collision-aware driving offsets go around visible track props without moving or removing them. The full ribbon drive uses fixed-step simulation; individual controls, bridges and ramp use browser input and wall-clock playback.

## Platform, performance and cleanup

`npm run world2:qa:platform` completed **12 checks with no failures or browser errors**:

- Both actual bridge decks were driven across: approximately 24.2 m and 26.2 m of forward travel, without falling through either deck.
- 390 × 844 mobile viewport: visible buttons, no horizontal overflow, controls dialog fits, real touch drag produces throttle/steering intent, boost presses register and touch cancellation releases them.
- Original world local storage is unchanged after World2 use and navigation.
- Navigating away during delayed GLB loading cancels safely.
- 67 vegetation instancing batches observed. A representative driving view measured approximately 60 fps, 531 draws, 373 geometries and 14 textures in headless Chromium with SwiftShader. This is a local software-rendering sample, not a real-phone performance claim. The development top-down view renders an additional scene pass and is not a production benchmark.

Core GLB: 5,707,840 bytes (5.44 MiB). Vegetation GLB: 7,405,756 bytes (7.06 MiB). The terrain colour and palette textures are embedded; production needs no Blender installation or network asset recovery.

Each route mount owns its RAF, physics world, listeners, audio, loader abort controller and scene. Cleanup explicitly releases GPU instance buffers, decoded image bitmaps, materials, textures and geometry. The same teardown also handles React Strict Mode and cancelled loading. Visibility changes suspend the loop and mute audio; graphics-context loss presents a recoverable error screen.

## Build and production

- `npm run lint`: pass.
- `npm run typecheck`: pass.
- `NEXT_DIST_DIR=.next-verify npm run build`: pass; `/world2` is included in the static route output.
- `npm run world2:qa:production`: **10 checks passed** against `next start`, using public UI only. `/`, `/world`, `/world2` return 200; keyboard driving and map work; navigation cleans up; no development engine handle or debug controls are exposed; no browser errors.

Machine-readable reports are under `.qa/world2/`: `qa-report.json`, `platform-report.json`, `production-report.json`. Scripts accept an alternate base URL. The regular and platform harnesses require a development server; the production harness does not.

### Existing-route regression result

The original `scripts/world-qa.mjs --only=settle,drive,boost,steer,brake,jump,respawn,teardown` passes every selected gameplay assertion, including four-wheel landing and a fifth successful visit. Its overall exit status is **1** because its console check sees a missing development chunk, `/_next/static/chunks/_0rztula._.js`, during home/world navigation. The generated React loadable manifest associates this chunk with the existing `src/components/journey/chapters/Contact.tsx` dynamic entry. This also occurs after regenerating `.next/dev`; the generated cache was preserved in a temporary backup. Original source hashes still match the baseline, and the production public-UI checks are clean. No existing route source was changed to work around that development-server issue. The original harness report remains at `.qa/world/report.json`.

## First-version limits

- Bowling scoring, timed circuit races, achievements, animated machinery and specialised mini-game behaviours are deferred. Their source geometry and placement remain. Area interactions currently provide descriptions and portfolio links.
- Foliage uses the original low-poly volume geometry and species colours. Blender-only shaders are translated or baked; the original specialised GPU foliage/water effects are not reproduced in full.
- High-speed jumps can overshoot or roll the car, as with the unchanged existing controller. The authored ramp was tested at a controlled approach speed; its angle and layout were not altered.
- Physical gamepad hardware and real iOS/Android devices were unavailable. Existing gamepad mappings are reused unchanged; automated proportional driver input and Chromium touch emulation were exercised. No separate air-rotation mechanic was added: hydraulics and self-righting remain the existing Player behaviour.
- The source was saved in Blender 5.0; the available Blender 4.5.13 LTS emits forward-version/linked-node warnings. Required evaluated geometry and export bounds passed. Use Blender 5.0+ when editing the master.

See `WORLD2_BLENDER_WORKFLOW.md` for editing, export, naming and collision conventions, and `WORLD2_IMPLEMENTATION_PLAN.md` for the initial architecture and source investigation.
