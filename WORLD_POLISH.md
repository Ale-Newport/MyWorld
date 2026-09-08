# World polish and gameplay pass

## Baseline — 8 September 2026

The existing page was run at localhost:3000 (production), then localhost:3001
(development, for telemetry). `scripts/world-qa.mjs` drove in all 19 districts,
checked 22 respawns, and exercised acceleration, steering, boost, brakes, jump,
island jump, flip recovery, touch controls, overlays, and route teardown.
One boost/pile-up assertion reported 1/4 wheels down; the subsequent recovery
check passed. This is not grounds to retune the vehicle. Baseline logs and images
are in `.qa/baseline/`. SHA-256 hashes protect PhysicsVehicle.ts and View.ts.

World: circular 720 m island, rolling heightfield with flattened district plates
and painted road corridors. 83 landmarks, 346 dynamic props, 13 notes, 45
achievements. No vegetation system. Water is limited to the tunnel's decorative
channel and the low ocean-level physics threshold. No world streaming; props and
districts are constructed at load. Quality changes renderer costs and decorative
counts. Collision groups separate floors, props, and the vehicle's larger prop
bumper. The version-1 local save contains achievements, discoveries, settings,
best times, and aggregate driving progress, never object transforms.

Current race: overlapping closed spline, three laps, proximity-or-segment gates
without direction or elevation checks, terrain disabled globally while racing,
R cancels instead of returning to a checkpoint. Both baseline approach runs
stalled at gate 3. Its layout and lifecycle need replacement.

The additional `world-gameplay.mjs` harness attempts completion and a second run
of each existing game using keyboard-driven approaches. Teleports are explicitly
test fixtures between approaches, not claimed as continuous laps. Continuous
race driving and negative checkpoint tests are separate verification tasks.

## Current upstream study

Source: https://github.com/brunosimon/folio-2025 at
`41046b57eeed8d156d9c3fd7fa259900baef7816`, fetched into
`/tmp/portfolio-folio-2025`. Existing MIT notice and license remain in place.

- Trees: instanced trunks, composed instanced foliage references, simple cylinder
  colliders. Foliage uses merged leaf cards, directional colour and vehicle
  visibility treatment. Grass loops a bounded camera-centred blade field with a
  terrain mask and common wind. Leaves pool positions/velocities and react to
  vehicle velocity and radial explosions.
- WaterSurface: terrain-derived shore/ripple masks, weather-dependent rain/ice,
  bounded surface, optional scene-colour blur. The local WebGL implementation
  uses GLSL rather than importing upstream's WebGPU/TSL renderer.
- Bowling: ten bodies, tilt-latched down detection, ball reset, complete force/
  velocity reset, status texture, strike celebration, impact and rolling audio.
- Circuit: explicit states, staged countdown, ordered target gate, one reusable
  gate curtain, checkpoint respawn, result modal, reset objects, weather hold.
  Its proximity check and global floor disable are unsuitable for this map.
- ExplosiveCrates/Explosions: armed fuse, delayed explosion, disabled body,
  mass-scaled radial impulses and leaf disturbance. Reset must invalidate fuses.
- Title.js actually animates the browser tab title; it does not implement the
  physical name. Physical objects and reset patterns live in Objects.js.
- CookieArea dispenses pooled physical cookies from an oven; it is not a
  collectible hunt. Adapt this as an original chip dispenser/progression loop.
- ToiletArea rewards tipping a physical cabin. AltarArea responds to entering
  a sacrifice zone with beams, particles and respawn. Adapt as a cargo delivery
  ritual without its server dependency.
- TimeMachineArea opens the previous portfolio and changes a TV screen on impact;
  a local visual era/weather cycle is an original extension of that idea.
- EasterArea opens an event menu. BehindTheSceneArea has vehicle-reactive portal
  slabs and an information menu. AchievementsArea has a waterfall discovery zone.
- Career/Projects/Social areas use contextual content, animated chronology,
  cinematic project selection, physical gag dispensers and tipping rewards.

## Implementation and verification ledger

Order: repair current gameplay; replace race; ecology/placement; water/terrain;
physical name; TNT; bowling; additional interactions and original games; birds;
map; audio; performance; repeated playthroughs and production build.

Vehicle handling and camera tuning are protected. Environment integration is
limited to water, contact effects, explosions and checkpoint respawn routing.
New scenery uses shared geometry/materials, instancing, local collider activation,
and bounded particle pools. Low quality retains every gameplay mechanic.

### Existing game audit

The first broad harness also exposed several incorrect test approaches. Those
were corrected before classifying working games as broken. Baseline evidence:
`.qa/baseline-games/results.json` and `.qa/baseline-targeted/results.json`.

| Existing game | Baseline classification | Work performed |
| --- | --- | --- |
| Circuit | BROKEN; VISUALLY WEAK | Replaced overlapping course and lifecycle; retained the vehicle and stunt ramps. |
| Labyrinth | WORKS | Preserved maze and solving mechanics; verified two completions. |
| Chess | WORKS | Preserved physical terminal, engine move and cinematic; corrected the test approach. |
| Pipeline | WORKS | Preserved four processing stages; corrected the test approach. |
| Retrieval | PARTIALLY WORKS | Corrected terrain/collider alignment and shared result lifecycle; verified all retrieval rounds twice. |
| Order Rush | WORKS | Preserved gate order and time limit; corrected the test driving approach. |
| Gym Circuit | WORKS | Preserved stations and physical driving loop. |
| Three Body | WORKS | Preserved its simulation and nudge mechanics. |
| Packet Run | WORKS | Preserved ordered tunnel gates. |
| Debug blocks (previously outside the game registry) | MECHANICALLY WEAK | Replaced decorative duplicate blocks with one physical timed FAIL/PASS challenge; connected the original DEBUGGER achievement. |

### Finished systems

- Ecology: eight tree families, authored forest pockets, regional family bias,
  shared instanced trunks/crowns/bushes/grass/flowers/rocks, 64 m chunks, wind,
  vehicle bending, canopy visibility treatment, pooled drifting/impact leaves,
  occasional birds. A pool of 96 simple trunk colliders follows the player;
  low quality retains the same collision rules.
- Water: animated ocean, two lakes, one connected river, three physical bridge
  types, waterfall and accessible grotto. Terrain-derived depth, shoreline foam,
  flow, Fresnel sky approximation, sun glints, rain response, wake and wheel
  splashes. Low quality uses a simpler shader. Shallow shelves remain driveable;
  sustained deep immersion uses normal or race-checkpoint recovery.
- Physics playground: all 16 individual ALEJANDRO NEWPORT letters have compound
  stroke colliders and authored resets. Eighteen original voxel TNT crates use
  contact fuses, staggered chains, radial impulses and bounded effects. No
  Minecraft textures or upstream assets are redistributed.
- Bowling: an actual ball and ten individual pins, two throws, natural tilt
  scoring, latched fallen pins, strike/spare celebrations, world scoreboard,
  return/reset, persistent frame result and explicit restart/exit controls.
- Additional interactions: pooled chip dispenser, tipping forest cabin,
  deployment altar, time machine and three live laboratory instruments.
  Original challenges are Debug Dash, River Run, Chip Relay and TNT Domino;
  Deployment Altar adds a fifth scored activity. There are 15 registered games.
- Map and exploration: common road/water/bridge/forest/circuit data, activity
  discovery, completion markers, safe-return diamonds, player direction, and
  existing district travel. Benches, lamps, quarry fencing and direction signs
  frame selected stops. Existing secrets and portfolio content remain.
- Save/reset: version-1 key retained; additive defensive `completedGames` and
  top-five `raceHistory`; new achievements and discoveries persist. Physical
  transforms are never saved. Area resets and Reset World Objects restore
  authored poses, velocities, forces, enabled state, fuses and game state.

### Important repairs

Rapier's heightfield buffer was transposed relative to the rendered terrain.
The upload now matches its Z-contiguous storage, and placement uses the same
triangle interpolation as the collider. An isolated asymmetric Rapier fixture
confirmed this independently. A 1 mm retry handles vertical ground rays that
miss exactly on a Rapier 0.17 heightfield row seam.

The race never disables terrain. Twelve directional swept gates reject reverse,
out-of-order, out-of-width, out-of-height and teleport crossings. Three laps
require 37 crossings including the first launch crossing. `performance.now()`
owns the clock; overlays and hidden tabs freeze the body and clock together.
R returns to the previous checkpoint with progress intact. The course leaves the
original void-jump ramp and its run-up clear.

The shared game lifecycle invalidates stale result callbacks, releases controls
on exit/reset, and preserves custom finish screens. The existing QA command was
updated for 15 games and the race's intentional Escape-to-pause behavior. Its KCL
fixture now enters along the road instead of spawning inside the module stack.
River Run's finish card now measures departure from the finish location, so its
long route cannot dismiss its own result. CLEAN SWEEP now counts unique cone
impacts near the moving car; settling props during loading no longer unlock it.

## Verification results

All game completion tests drive with real keyboard input after placing the car
at a documented approach. They do not set scores, achievements, pin state or
checkpoint progress. Race laps are continuous keyboard driving without those
placement fixtures. Browser contexts are disposable and never replace the
visitor's own save.

| Check | Result / evidence |
| --- | --- |
| Eight preserved games | Two successful completions each, `.qa/games-final/results.json`. |
| New scored activities | Bowling, Debug Dash, Chip Relay, TNT Domino, Deployment Altar and River Run each completed twice; logs in `.qa/final-logs/`. |
| Bowling | Two first-ball strikes; two 9-pin first throws followed by genuine second-ball spares; return, restart, scoreboard and achievements verified. |
| Name | All 16 letters toppled through car impacts; global reset restored exact authored positions (`letterMax: 0`). |
| TNT | Two complete 18-crate chain reactions, then reconstruction with no armed fuses or exploded bodies left behind. |
| Other attractions | Twelve chips collected from the 12-body pool; cabin tipped/reset twice; time machine used twice; all three lab instruments used repeatedly; grotto achievement and discovery saved. |
| Cone achievement | Zero cone progress while idle after loading; actual keyboard-driven impacts unlock CLEAN SWEEP (23 distinct cones in the test). |
| Water | Heightfield/render probes agree, including asymmetric coordinates and the ray seam; continuous wooden-bridge crossing; real shallow-wheel splashes without recovery; deep-water recovery; two River Run completions after the result-card fix. |
| Race contracts | Countdown input lock and pause, reverse/skip/width rejection, boost sweeps, R recovery preserving progress, exact pause position/time, resume, restart, explicit exit and leaving the area all pass. |
| Persistence | A newly earned circuit best and top-five history survive reload; new discoveries/achievements survive reload; existing v1 notes/bests are retained; corrupt JSON recovers safely. |
| Driving regression | Acceleration, boost, steering, braking, jumping, collision recovery, hidden-island jump, flip recovery, controls and respawn pass; all 19 districts and 22 respawns checked. |
| Touch / lifecycle | Phone joystick and action controls work without overflow or page errors; repeated route teardown/remount leaves a working game and releases the previous handle. |
| Source checks | Production build and TypeScript pass. ESLint: no errors, two pre-existing warnings in `eslint.config.mjs` and `scripts/.tb-drag.mjs`. `git diff --check` passes. |
| Protected handling/camera | Both hashes match `.qa/baseline/protected-physics.sha256`; `PhysicsVehicle.ts` and `View.ts` are unchanged. |

Continuous three-lap race results:

| Driving mode | Finish time | Gate crossings | Maximum distance from centreline |
| --- | ---: | ---: | ---: |
| Slow | 82.179 s | 37 | 2.22 m |
| Normal, final verification | 73.941 s | 37 | 2.82 m |
| Boost | 52.685 s | 37 | 3.99 m |

All finished without checkpoint recovery. An earlier normal run also finished
in 73.610 s. Timing includes the run from GO through the final crossing, excludes
the countdown and pauses, and is independent of the simulation time scale.

### Performance

Final authored ecology has 920 trees, 299 bushes, 20,992 grass tufts (nine blades
per tuft), and 4,265 flowers/microplants. Draw density is reduced at runtime.
There are at most 160 simulated leaves, six birds, 96 active trunk-collider
slots, 12 dispenser bodies and 18 TNT bodies; fragments use the existing bounded
particle pool. No new rigid body is created for a leaf, grass blade or explosion.

The table is a local Chromium sample at 1440 × 900 in the cabin woodland. Each
tier ran for 4.5 seconds; steady frame/GPU percentiles use the final 150 samples.
Renderer counters include all passes. The same medium-loaded physics world was
retained while changing quality. This is a measured scene sample, not a promise
for every device, weather state or view.

| Tier | FPS | Frame p95 | GPU p95 | Draw calls | Triangles | JS heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Low | 60.0 | 16.8 ms | 3.17 ms | 74 | 160,338 | 46.0 MB |
| Medium | 60.0 | 16.7 ms | 3.76 ms | 117 | 197,317 | 43.5 MB |
| High | 60.0 | 16.8 ms | 5.74 ms | 138 | 204,445 | 52.0 MB |

The sample retained 712 physical objects, with 62 nearby trunks enabled. Browser
CPU script time over each full window was 1.82 / 0.90 / 1.03 seconds; the first
window includes warm-up. The longest traced V8 GC slice was 14.44 ms. Heap figures
exclude GPU and WebAssembly allocations. The GPU timer extension was available.
Raw metrics: `.qa/runtime/results.json`; CPU/GPU/GC timeline:
`.qa/runtime/performance-trace.json` (Chrome trace format).

### Visual review and deliberate limits

Reviewed screenshots cover the hub, close driving view, woodland/cabin, both
lake areas, waterfall, bridge, bowling lane, TNT quarry, circuit, time-machine
garden, three live lab instruments and map. They are in `.qa/polish/`; spare
results are in `.qa/attractions/`; race results are in `.qa/race/`. Wider framing
was used for some inspection shots; the production camera was not altered.
Review caught and corrected overlapping water surfaces, a disconnected lake
mouth, sparse waterfall composition and an overly steep shallow-water bank.

Water reflections are a shader approximation, not planar scene capture. Trees
use original composed low-poly geometry; they are solid trunks with reactive
foliage, not destructible rigid-body trees. Vegetation is built once and culled
in chunks rather than streamed from a server. The new systems keep their
gameplay at low quality. Seasons and expensive volumetric/reflection effects
were not added. Existing weather remains active and drives wind/rain response.

### Reproduce

Start `npm run dev -- --port 3001`. QA scripts default to that address except
the older general suite, which takes it explicitly:

```sh
node scripts/world-qa.mjs http://localhost:3001
node scripts/world-gameplay.mjs http://localhost:3001
node scripts/world-polish-qa.mjs http://localhost:3001
node scripts/world-attractions-checks.mjs http://localhost:3001
node scripts/world-achievement-checks.mjs http://localhost:3001
node scripts/world-race-drive.mjs http://localhost:3001
node scripts/world-runtime-checks.mjs http://localhost:3001
npm run build
npm run typecheck
npm run lint
```

The scripts accept targeted environment selections (`WORLD_GAMES`,
`POLISH_TESTS`, `RACE_MODES`) where appropriate. Run the performance suite by
itself to avoid competing browser workloads. `.qa/` artifacts are intentionally
ignored by Git; the procedures and implementation are source files in the working tree.
