# WORLD_DENSITY_PASS

The island got thirty per cent smaller and several times fuller.

This is the record of the pass that followed
[`DRAWING_MAP_IMPLEMENTATION.md`](DRAWING_MAP_IMPLEMENTATION.md), which is still
the account of how the map was reconstructed from the drawing and is still
accurate about **where** everything is. This document is about what changed
after it: the scale, the two rebuilt mini-games, the decoration, the attractions
and the set dressing.

Both documents are generated from the live data and the measured runs. Where a
number appears below, a harness produced it.

---

## 0. What was asked for

Thirteen things, and each one is a section:

| # | The request | Where it landed |
|---|---|---|
| 1 | TNT crates on the circuit straight, timber barriers to dodge elsewhere | §5 |
| 2 | The world 30% smaller, same distribution | §1 |
| 3 | Flat floors for the labyrinth, the race and the bowling | §2 |
| 4 | Bowling at ground level, no walls, a floating pin-only screen | §3 |
| 5 | A lot of decoration, nearly all of it knockable | §6 |
| 6 | A much bigger, prettier labyrinth; no countdown; restart returns you | §4 |
| 7 | Many more playful interactions, unrelated to the CV | §7 |
| 8 | Fill the world | §6 |
| 9 | A better dirt-road texture | §2 |
| 10 | Themed dressing per district and mini-game | §8 |
| 11 | Bowling in the spirit of bruno-simon.com | §3 |
| 12 | The projects section in that spirit | §8 |
| 13 | The race circuit in that spirit | §5 |

**On 11, 12 and 13.** Those asked for "las mismas texturas y objetos 3D" as
bruno-simon.com. That site's models and textures are its author's own work, so
they are not copied here. What is reproduced is the IDIOM: flat-shaded low-poly
forms, saturated flat colour, toy-scale proportions, physical objects you knock
over rather than menus you click, and information carried by silhouette before
it is carried by text. Every asset in this repository is still generated in
code — there is no image file, no GLB, and no new dependency.

---

## 1. Thirty per cent smaller

`MAP_WIDTH` went 380 → 266 and `MAP_DEPTH` 285 → 199.5. Because the plan is
digitised in normalized coordinates, those two numbers moved every zone, path,
lake, vegetation mass and the coastline itself, all by the same factor: the same
map, drawn smaller. Half the area.

**What did not shrink is anything the car touches, because the car did not.**
`scripts/mapcal/emit-ts.mjs` grew a `HOLD` table of built dimensions emitted in
measured metres rather than as fractions of the drawing — the ramp deck, the
bridge deck, the bowling lane, the letters' ground, the time machine, the black
hole's crater and the labyrinth's square. A ramp scaled to 28.7 × 6.8 m is a
ramp the car falls off the side of.

**The circuit had to get narrower, and that is arithmetic.** At 0.7 the two
closest stretches of the lap that are not the same stretch are 12.6 m apart
centre to centre, so a 14 m track overlaps itself there by 1.4 m. `CIRCUIT.width`
is 10, which leaves 2.6 m of grass between the kerbs at that pinch — and against
a relaxed tightest-corner radius of 11.4 m the inner kerb runs at 6.4 m, *wider*
than the 5.9 m the wider track had on the bigger island.

The relaxation's own arguments changed with it. `minRadius` is an absolute
metre value (14 — the tightest corner the car can take, which did not shrink)
and is no longer passed the track width as a mnemonic. The knob that actually
binds at this scale is the drift limit, measured across a sweep:

```
limit  7  ->  tightest corner  8.8 m
limit  9  ->                   9.2 m
limit 10  ->                  11.4 m     <- this
limit 12  ->                  11.4 m
```

`PASSES` stays at 240 and is load-bearing: the same settings at 600 over-smooth
into a new pinch and give 8.1 m.

### What moved rather than scaled

Half the island's furniture needed re-placing, because a footprint held at its
measured size on a map that shrank is proportionally twice as large. The
occupancy registry went from 0 conflicts to 27 on the naive scale and back to 0
over about forty moves; these are the ones worth naming.

* **The bowling venue, 12 m east and 8 m south.** Naively scaled, its pad's two
  north corners were 1.7 m and 2.4 m OUT TO SEA and its south-west corner 4.4 m
  from the racing line.
* **The labyrinth, 27 m north-west, and its corridors from 5.2 m to 4.6.** Three
  of the four corners of its levelling pad were measured outside the coastline,
  the furthest by 20.2 m. The south-east corner of a 266 m island cannot hold a
  46 m square.
* **The time machine, 23 m west,** to make room for it.
* **The east ramp, 41 m of deck down to 30.** Held at its measured size, its
  registry disc — `length / 2` plus the run-up — reached the road-ramp respawn,
  the WELCOME billboard and the projects respawn at once.
* **The physical name, 3.9 m letters down to 3.1.** At 3.9 the name reserved a
  33 m ellipse that reached the river's near bank, the bridge deck and two
  respawns.
* **The LANDING plate, 22 down to 15,** because a plate paves out to `plate × 1.55`
  and at 22 that is 34 m, over the river.
* **Both maze spurs and both bowling roads, re-routed.** They ended INSIDE the
  venues they served: the clearance probe found four samples 2.6 m up, which is
  the labyrinth's own wall height.

---

## 2. Flat floors, and the roads

### The shore was eating the built world

`heightAt` composes the ground in eleven positional stages and the order is the
priority. The SHORE ran last, after every built stage, and took them back:
measured, **0.816 m of relief across the bowling pad** that is supposed to be
dead flat, and **3.10 m across the circuit's south-west corner**.

`heightAt` now accumulates a `built` scalar — the running maximum of the plate,
ramp-pad, circuit, road and play-spot flatten weights — and the shore is
weakened by it, with a safety valve so that built ground still loses to the
shore at or past the waterline. Measured before and after, relief across each
footprint's core:

| | before | after |
|---|---|---|
| labyrinth pad | 4.298 m | 0.000 m |
| bowling pad | 2.967 m | 0.016 m |
| projects plate | 4.395 m | 0.005 m |
| achievements plate | 1.126 m | 0.111 m |

**The lap is level.** The corridor's target is now a module constant derived as
the arc-length-weighted mean of the natural ground under the racing line, and
the authored elevation profile is gone. The cost is stated in the file: the
corridor carries its run-off 30 m either side, so the north loop is cut into its
landform bump and the south-west run is filled.

**Two pads, one venue.** The labyrinth levels its 41.8 m square and, separately,
the twelve metres of approach in front of its mouth — a rectangle is centred, so
growing the square northwards pulls its south edge inside the back wall. The
approach pad states what it levels TO: without that it held the natural ground
there, 3.4 m above the maze floor, and put a step across the only way in.

### The roads

They were a stroke on the ground canvas: one canvas covers the whole field, so a
texel is 0.24 m and an eight-metre road is thirty-three of them, with detail
features exactly one texel across. That is the pixellation.

The roads are now their own geometry — `src/world/world/Roads.ts` — walked along
each raw polyline, mitred at the joins, merged into ONE BufferGeometry for one
draw call, carrying no collider (the heightfield already holds their height).
The material is a procedurally generated seamless dirt albedo and normal tiled
every few metres, with wheel ruts, a lighter crown, an edge scuff that
alpha-fades into the ground and a second de-tiling sample at another scale.
Effective resolution is about 31× finer than the base map. The two sources of
one-texel noise on the base canvas — the grit pattern and the whole-canvas grain
pass — are deleted, and the canvas that no longer carries detail was dropped in
resolution to pay for it.

---

## 3. NEWPORT LANES, rebuilt

Four requirements, each now a check in `scripts/world-bowling-qa.mjs`:

| | before | after |
|---|---|---|
| the lane stands proud of the ground | 0.72 m | **0.060 m** |
| tallest collider on the venue | 2.25 m walls | **0.40 m** (one kerb) |
| the screen's normal against the lane | — | **0.0000** |
| the screen tracks the car | — | board at **4.0** and **35.8** |

* **Ground level.** The foundation cuboid — the plinth — is gone; the slab
  thickness is derived from a build-time ground probe so the undersides stay
  buried at the venue's lowest corner. The three floating marking heights that
  hovered 0.32 m over the bed are on it.
* **A skirt on all four sides,** built as one adaptive ring rather than four
  strips, because four strips leave four corner gaps and a corner gap in a floor
  is a hole. It carries a real collider.
* **No walls.** Both kickbacks, both approach rails, the masking unit, the
  ball-return alcove and the scoreboard's collider are deleted. The gutters are
  flush channels with a 3° cross-fall away from the lane. The one remaining
  vertical is a 0.40 m kerb behind the pin deck, which is what stops ten pins and
  a 1.35 kg ball reaching the coast.
* **The screen floats and follows.** It is a child of the venue group with its
  yaw set once, so parallelism is structural rather than a number kept in step.
  It slides along the lane to stay level with the car within 34 m and eases back
  to a rest position beyond that, with a bob and a micro-roll and no collider.
* **The screen is ten indicators and nothing else** — a pin where one stands, a
  cross where one is down. No score, no frame, no state text; those were always
  in the HUD.
* **A leaner that goes over late is still a pin that went over.** `standing`
  latches during a roll so that ten bouncing bodies do not make the diagram
  flicker — but everywhere else the deck is simply the truth, and the board
  paints the live deck unless a ball is rolling. Reading the latch instead left
  a one-frame window in which a pin that had just tipped was still lit: the
  harness caught seven such samples across five sets, then one, then none.

---

## 4. The labyrinth, rebuilt

* **Seven by seven cells, not five by five** — 49 against 25, in a 41.8 m square
  of 4.6 m corridors between 1.2 m walls. The side length is written in three
  places and they must agree: the generator, `MAZE` in `world-layout.ts`, and
  `ZONES.maze.size` through the emitter's HOLD table.
* **The seed was chosen by search, not by taste.** Seeds 1..9999 were swept
  through this exact carve. Maximising route length alone is a trap — every seed
  that hits the maximum does it with a single snake, which is a queue and not a
  maze — so the pick is from the Pareto front of route length against dead ends:
  **seed 5236**, 83 grid steps, **265.6 m of corridor on the shortest route
  against the old maze's 37 m**, 7 dead ends, 7 junctions, 7 decision points on
  the solution.
* **No countdown.** The lead-in is dropped, so `Minigame.start()` goes straight
  to running and the clock starts in the same fixed step the mouth zone fires.
  The mouth zone came down from 5 m to 2.2 so the clock starts within half a car
  length of the threshold instead of five metres early.
* **Restart and finish both return the car to the start**, from exactly three
  places — an explicit restart, `fail()` and `finish()` — and never from
  `reset()` or `cancel()`, which the manager fires on ESCAPE, on the map key, on
  the respawn event and on any overlay opening.
* **Prettier**, within the two lights this world has: hedge facing merged over
  the walls, corner obelisks that show above it, junction lanterns as
  breadcrumbs, a fountain at the centre, entrance topiary, dead-end signs, and a
  you-are-here board drawn from the generator's own grid.

---

## 5. The circuit

* **Twelve TNT crates on the west straight**, on the racing surface, at 0.8 kg
  each. The site is derived rather than written down: the lap is scanned for
  stretches that never turn tighter than 45 m through a 14 m window, and the
  crates go on whichever contains the lap point nearest the TNT quarry. Every
  inner face lands 2.80 m from the centreline. They fuse on a hard contact, burn,
  burst, and chain to their neighbours — with a deliberately smaller blast than
  the quarry's, because the quarry's number rolls a car off the straight.
* **Four timber barriers across the drop out of the sweeper**, 6 kg each, so a
  clip costs most of your speed and then the barrier breaks and scatters planks.
  The break is gated on the CAR'S speed, not on contact force: a 6 kg barrier
  leaned on at a standstill out-reports a fast clip of a 0.8 kg crate.
* **Dressing**: tyre walls on the hairpins as one instanced mesh with one
  collider per run, a grandstand on the west straight, pit boxes, a start light
  tree that reuses the countdown's own light handles, marshal posts and a
  sponsor gantry.
* The trackside barriers that were `type: 'fixed'` and stopped the car dead are
  dynamic now.

---

## 6. Decoration, and why the island was empty

It was empty by arithmetic. `World.scatterProps` made 270 placement attempts and
landed 117; **153 were discarded in silence**, including all seventeen of
SOCIAL's props and every one of the landing's six balls. Whole sets vanished and
nothing reported it.

The replacement is four files — a pure-data manifest and planner in
`src/content/world-decor.ts`, procedural geometry in `decorGeometry.ts`, a
builder in `Decor.ts`, and a headless checker in `scripts/world-decor-check.mjs`
(`npm run world:decor`). It places through the same `isFree` oracle the ecology
and the scenery details use, and **it counts and prints every rejection by
reason**:

```
WORLD DECOR — 809 placed of 1204 asked for (67%), 16,621 candidates tested
  theme          placed / asked  yield   rejected by
  landing            79 /   110    72%   road 573, water 264, landmark 189, …
  bowling            68 /    72    94%   water 181, road 112, spacing 74, …
  …
  21 instanced meshes, one draw call each · closest pair 1.00 m · 0 failures
```

**The car is 2.5 kg, and that is the whole design.** Anything above about 6 kg
reads as a wall and anything above 12 kg stops it dead, so every dynamic
decoration is authored against the chassis rather than against reality: a hay
bale is 3 kg here. The checker hard-fails on any dynamic kind over 12 kg.

Ten district themes and four biomes for the ground between them, all authored in
fractions of a district radius and per-square-metre densities rather than
coordinates. The existing static furniture that stopped the car — the lanterns,
the benches, the picnic tables and the nine signpost posts — is knockable or
non-colliding now.

**A sleeping body pays nothing.** `Physics.step` walked every non-static body
every fixed step to compute water damping, with no sleep gate: five ellipse tests
and a polyline distance for a settled crate on the far side of the map, sixty
times a second. That is the change that had to land before the bodies did.

---

## 7. Fourteen things to do that are not about the work

`src/world/world/Attractions.ts` and its data in `src/content/attractions.ts`:
a klaxon, a firework battery, a car wash that repaints the car, a catapult, a
piñata where the catapult throws you, a giant football and a goal, a harbour
bell, trampolines, a skittle yard, bumpers, a twelve-key piano road, a weather
lever, a seesaw and a turntable. Six carry a prompt; the other eight are driven
into, over or through.

Every position is a BEARING AND A DISTANCE from something already on the map,
never a coordinate, and each is resolved through the same occupancy gate. Thirteen
new achievements were added in a `playground` group — every one reachable, which
is the rule `completionist` depends on.

**Touch was broken and is not any more.** Tapping the on-screen prompt called
`openLandmark(id)`, which returns silently for any id that is not a landmark — so
every prompt the world registers itself (the mini-games, the playground, the
black hole) was already dead on a phone, and all fourteen of these would have
been. Both inputs now go through one `interactions.trigger()`.

---

## 8. Themed, district by district

`src/world/world/dressing/` — one file per district, built through a shared kit
that accumulates static geometry into buckets by material and flushes one merged
mesh each, so a district of ten pieces costs two or three draw calls rather than
thirty.

* **LANDING** — an arrivals hall: an arch you drive under, bunting on catenary
  strings, tyre stacks, a luggage trolley, planters, a monogram disc, and a wind
  sock that yaws to the weather.
* **SOCIAL** — a broadcast set: softboxes raked at the camera (which is how you
  fake studio lighting in a scene that cannot have another light), a
  clapperboard, film reels, a boom mic, cable drums, a director's chair, an ON
  AIR sign that brightens as you arrive, and a step-and-repeat backdrop.
* **PROJECTS** — the archive, and the answer to request 12: the work displayed
  physically at driving scale rather than as a menu. Large angled exhibition
  boards along the approach carrying the collection names, server racks with a
  light-chase driven by one shared material, a satellite dish that yaws, an
  overhead cable tray, filing crates mid-unpack, a plotter with a banner curling
  out of it, and a blueprint table — framing the eight project plinths that were
  already there.
* **ACHIEVEMENTS** — a podium yard: three tiers you can drive up, a rosette wall,
  a laurel arch, star decals, spotlight cans with fake beams, and **medal posts
  that change material as you complete each achievement group** — the one place
  in the world where progress changes geometry.
* **TIME MACHINE** — clockwork: a huge flat clock face on the ground, a gnomon
  that tells the truth because the lighting drives a real sun azimuth,
  counter-rotating gears, a pendulum with no collider below head height, an
  hourglass and a flip calendar.
* **BLACK HOLE** — the void: monoliths leaning inward, an orbiting debris ring,
  a lamppost bent towards the core, a torn road end, a fence you drive straight
  through, gravity arrows and a dome of star specks.
* **TNT** — a quarry: a plunger detonator, a fuse line with a spark that runs it,
  a sandbag blast wall on the racing-line side, a watchtower with a rotating
  beacon, hazard signs, a wheelbarrow, a scorch ring and a barrel rack.

BOWLING, the CIRCUIT and the LABYRINTH dress themselves, because their dressing
has to know venue-local coordinates this layer cannot supply.

---

## 9. Defects this pass found and fixed

The harnesses were the point. In order of how badly they mattered:

1. **`lineDistance` returned NaN for a degenerate segment.** The occupancy
   registry describes a venue's pad as a capsule between two points, and a SQUARE
   pad puts both in the same place — so the labyrinth's pad and its approach were
   invisible to `isFree` and to `validateLayout`. The decoration pass laid a run
   of pallets across the only way into the maze and every check reported clean.
2. **The river's east bank was a 53° wall.** The lakes get an easing apron and
   the river never did; on a 380 m island the ground either side was within a
   metre of its level, and at 0.7 the eastern landform sits 30% closer. The tour
   put the car on its roof against it three legs running.
3. **The east ramp could not be jumped.** A road flattened after a ramp drags its
   pad down wherever it passes, and one runs seven metres off the ramp's foot:
   the pad held 4.70 m and the deck's low end sat at 3.69, a metre of step
   exactly where the car arrives. Ramps are built from their FOOT now, their pads
   are re-asserted after the roads, and the deck is a metre taller to pay for it.
4. **Four of twelve respawns could not be driven away from**, one of them ending
   on its roof — decoration authored with a 6 m clearance against a hundred props
   and then run against a thousand. Respawns get ten metres.
5. **The maze respawn was inside the maze**, eight corridors deep.
6. **The jump ramp was 30.8 m off the racing line** — scaled with everything else
   rather than re-derived, when the relaxer had changed the line's shape too.
7. **Nine signposts were invisible walls** — a 0.16 m post with a collider
   against a 2.5 kg car.
8. **Touch prompts were dead** for everything outside the content layer.
9. **The `info` toast was captioned NOTE.**
10. **`eslint .` was linting the production bundle** — 156 errors and 9,400
    warnings of Turbopack's own output, burying the handful about this repo.

---

## 10. What proves it

Every number measured on the finished island.

| What it asks | How | Result |
|---|---|---|
| Nothing inside anything else | `npm run world:layout` | **100 footprints, 0 conflicts, 0 respawn problems** |
| Nothing standing in a road | `npm run world:clearance` | **0 obstructions** |
| Decoration placed, and what was refused | `npm run world:decor` | **809 of 1,204 (67%), 0 failures**, rejection histogram per theme |
| A production build | `next build` | Passes. Five routes, all prerendered static. |
| The whole island, driven, no teleports | `npm run world:tour` | **10 of 10 stops, 0 teleports**, 553 m, every leg 2-11 s |
| The circuit at three paces | `node scripts/world-race-drive.mjs` | **all three finish**, 25 gates each. Times vary widely now — the autopilot is a bang-bang controller and the straight has TNT on it. |
| Every mini-game, three times each | `npm run world:minigames` | **4 mini-games, 0 failing** |
| Bowling, five sets | `node scripts/world-bowling-qa.mjs --sets=5` | **all checks passed** |
| The beach on every bearing | `npm run world:shore` | **0 failing transects** |
| Grass with no visible edge | `npm run world:grass` | **0 views with a boundary** |
| The race under a hostile driver | `node scripts/world-runtime-checks.mjs` | **22 records, 0 failing** |
| Physics, ramp, respawns, touch, teardown | `npm run world:qa` | **ALL CHECKS PASSED** — 26 landmarks, 975 props, 47 achievements, 1,361 bodies, 1,478 colliders |
| Frame budget, three quality tiers | `world-runtime-checks` | **22 records, 0 failing. 60 fps at all three**; HIGH 287 draw calls / 853k triangles / **2.5 ms GPU of a 16.7 ms frame** / 1,361 bodies |

```bash
npm run world:layout && npm run world:decor      # headless, instant
npm run world:tour                                # the acceptance test
node scripts/world-bowling-qa.mjs <url> --sets=5
```

### Known and unfixed

* **The open coast is a one-way trip on some bearings.** Wading in from the beach
  works; on about one bearing in eight the car drifts off the shelf while
  reversing and the drowning rule fishes it out. That is the designed behaviour
  of the deep.
* **`world-water-drive`'s river ford is flaky, and the river is not.** The
  harness derives its own approach bearings and the one it picks for the ford
  sometimes starts the car on the landing's prop field, where it reports "never
  moved". Sampled directly along the river's whole length at six stations, it is
  **at most 0.57 m deep** with banks no steeper than **21°** — the car floats at
  1.1 m and climbs far worse than that. Both lakes, the ramp's landing and the
  deep-water recovery pass on every run.
* **Two harness fixtures are flaky, and both are the autopilot rather than the
  world.** `world-polish-qa`'s `name` drives at each of the sixteen physical
  letters in turn and sometimes leaves one standing after three passes;
  `world-bowling-qa` occasionally spends its twelve-ball budget without
  finishing three frames. Both pass on most runs and neither has ever failed on
  a claim about the world's geometry.
