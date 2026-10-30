# DRAWING_MAP_IMPLEMENTATION

> **A later pass changed the scale and much of the content.** This document is
> still the account of how the map was reconstructed from the drawing, and its
> §3 tables are regenerated from the live data — but the island is now 266 ×
> 199.5 m rather than 380 × 285, the bowling alley and the labyrinth have been
> rebuilt, and there is a great deal on the island that is not described here.
> See [`WORLD_DENSITY_PASS.md`](WORLD_DENSITY_PASS.md).

The hand-drawn map, built. This is the record of what was interpreted, what was
measured, what moved, what was deleted and what proves the result — the
companion to `MAP_RECONSTRUCTION_PLAN.md`, which is the plan this executes.

The short version: the island is now a compiled drawing. A photograph of a
crayon plan was rectified, digitised into normalized coordinates, verified
against itself by overlay, and emitted as `src/content/world-map.ts`. Everything
else on the route reads that file, directly or through one of the two content
layers below it. Nineteen districts became ten places; fifteen mini-games became
four; forty-one projects that used to be spread over twenty-six locations are
all reached from one terminal.

---

## 1. Reading the drawing

### The reference material

**The hand-drawn map** arrived as `IMG_1101.HEIC`, 4032 × 3024, photographed at
an angle on a desk. It arrived in the canonical orientation the brief names —
race circuit on the left, bowling top-centre, social upper-centre, projects
upper-right, ramp right, landing central-right, time machine and maze
bottom-right — so no rotation was applied.

**The bowling screenshot was not attached.** Only one file came with the
message. The bowling work is therefore built against the written specification
(§23–§34, §57, §70–§73), which describes that screenshot in enough detail to
work from: a vehicle beside the lane, one large ball, ten physical pins, a
narrow lane with low side rails, and a large physical display beside the lane
carrying a live pin diagram. Section 8 below is what was built and what it was
tested against. If the screenshot turns up, the venue is authored from one scale
constant and a dozen offsets, so re-proportioning it is a small job.

### The pipeline

`scripts/mapcal/` holds the whole of it, and it is repeatable:

1. **Rectify.** Four corners of the drawn ocean frame → a homography onto a
   1200 × 900 canvas. This removes the keystone from the photograph; without it
   the left side of the drawing is 6% larger than the right.
2. **Flatten the light.** The sheet is lit unevenly; dividing by a heavily
   blurred copy of itself makes the same crayon read the same colour across it.
3. **Segment.** HSV thresholds split it into asphalt / red barrier / blue water
   / green vegetation / yellow sand. The **red barrier mask** turned out to be
   the cleanest signal on the sheet, and the circuit is traced from it rather
   than from the pencil.
4. **Digitise** into `scripts/mapcal/plan.json`, in normalized `u, v` (0..1,
   left→right and top→bottom of the rectified drawing).
5. **Verify by overlay.** `scripts/mapcal/overlay.mjs` draws the plan back onto
   the photograph. The plan went through six rounds of this.
6. **Emit.** `scripts/mapcal/emit-ts.mjs` writes `src/content/world-map.ts`.
   Nothing downstream reads the JSON; the generated file is what ships.
7. **Compare.** `scripts/world-topdown.mjs` photographs the finished world from
   directly overhead and `scripts/mapcal/compare.mjs` puts it beside the drawing
   at the same scale with the same tenth-lines. That image is the acceptance
   test, and it lives at `.qa/world/compare.png`.

### What the drawing's arrows say

The circuit's direction was read off the six arrows on the sheet, and all six
agree: **down the west straight, east along the south straight, north through
the technical section, out of the pit straight heading west-north-west, north up
the east side of the top loop, and back down its west side.** One lap.

---

## 2. Scale

```
MAP_WIDTH  = 266 m        (drawing u 0..1)
MAP_DEPTH  = 199.5 m      (drawing v 0..1)

x = (u − 0.5) · 266       x ∈ [−133, 133]      +x east
z = (v − 0.5) · 199.5     z ∈ [−99.75, 99.75]  +z south
```

The drawn frame is 4:3, so the world is.

**The island is 70% of the size it was built at** — it was 380 × 285, which is
twice this area. Because the drawing is normalized, one pair of numbers in the
emitter moved everything at once and the distribution is exactly preserved: the
same map, drawn smaller, with everything closer together.

Anything a car touches was HELD at its measured size, through a `HOLD` table in
`scripts/mapcal/emit-ts.mjs`: the ramp deck, the bridge deck, the bowling lane,
the letters' ground, the time machine, the black hole's crater and the
labyrinth's square are emitted in metres rather than as fractions of the
drawing. The car did not shrink, so the things it drives on did not either.

The two numbers that decide whether the island is any good to drive, measured:

* **the lap is 633 m** — 50.5 s careful, 44.3 s normal, 36.2 s on the boost,
  driven by `scripts/world-race-drive.mjs`, 25 gate crossings and never more than
  2.7 m off the racing surface at any pace.
* **every place is 44–156 m from the LANDING** — four to sixteen seconds of
  driving. The ramp is 44 m, projects 50, the time machine 70, social 79, bowling
  82, the maze 94, the race start 100, achievements 104, the black hole 125, the
  TNT yard 156.

The circuit is 10 m wide now, not 14, and that is arithmetic rather than taste:
at 0.7 the two closest non-adjacent stretches of the lap are 12.6 m apart centre
to centre, so a 14 m track overlaps itself there by 1.4 m. Ten leaves 2.6 m of
grass between the kerbs at the pinch, and against a tightest corner radius of
11.4 m it gives an inner kerb of 6.4 m — wider than the 5.9 m the wider track
had on the bigger island.

---

## 3. Where everything is

Both frames are given: the world coordinate the code uses, and the normalized
drawing coordinate it was read from. The second column is the one to check a
feature against the photograph with.

### Districts

| id | label | world (x, z) | drawing (u, v) | radius | signposted |
|---|---|---|---|---|---|
| landing | LANDING | (61.6, -10.8) | (0.662, 0.462) | 42 / plate 22 | yes |
| circuit | NEWPORT CIRCUIT | (-79.8, 12.8) | (0.290, 0.545) | 30 | yes |
| social | SOCIAL | (-20.1, -88.3) | (0.447, 0.190) | 20 / plate 15 | yes |
| bowling | NEWPORT LANES | (-13, -112.6) | (0.466, 0.105) | 46 | yes |
| projects | PROJECTS | (104.1, -67.8) | (0.774, 0.262) | 28 / plate 12 | yes |
| achievements | ACHIEVEMENTS | (-86.6, -25.1) | (0.272, 0.412) | 24 / plate 15 | yes |
| maze | LABYRINTH | (152, 88.9) | (0.900, 0.812) | 28 | yes |
| timeMachine | TIME MACHINE | (109.4, 86.1) | (0.788, 0.802) | 16 / plate 10 | yes |
| blackhole | BLACK HOLE | (-100, -86) | (0.237, 0.198) | 16 | secret |
| tnt | TNT | (-149.3, 33.1) | (0.107, 0.616) | 14 | no |

### Venues

| venue | world (x, z) | drawing (u, v) | extent |
|---|---|---|---|
| bowling | (-26, -112.6) | (0.432, 0.105) | r 44 |
| tnt | (-149.3, 33.1) | (0.107, 0.616) | r 7.5 |
| timeMachine | (109.4, 86.1) | (0.788, 0.802) | r 11 |
| blackHole | (-100, -86) | (0.237, 0.198) | r 14 |

### Ramps

| ramp | world (x, z) | drawing (u, v) | geometry |
|---|---|---|---|
| ramp-east | (120.8, -31.3) | (0.818, 0.390) | 41 x 9.7 x 5.6 m @ 0.00 rad |
| ramp-circuit-jump | (-72.1, 101.3) | (0.310, 0.855) | 16 x 14 x 2.4 m @ -0.05 rad |
| ramp-landing | (88, 16) | (0.732, 0.556) | 12 x 7 x 2.2 m @ 1.32 rad |

The east ramp points **east, off the grass, over the beach and into the
shallows**, which is where the drawing's arrow points. The shelf there is 0.6 m
deep, so the landing is somewhere you drive out of — it is the only water on the
island you are meant to end up in.

### Paths

Compact earth, not asphalt (§44). The only tarmac on the island is the circuit,
and that is most of what makes the circuit read as a circuit from above.

| path | width | points | from → to |
|---|---|---|---|
| landing-bridge-social | 9 m | 8 | (61.9,2) to (-9.9,-80.4) |
| social-bowling | 8 m | 4 | (-16,-75.8) to (-8.4,-92.3) |
| bridge-bowling-east | 8 m | 6 | (22.8,-59.9) to (34.2,-104.9) |
| bowling-projects | 8 m | 5 | (46.4,-108.3) to (97.3,-73) |
| landing-projects | 9 m | 6 | (61.9,2) to (99.6,-60.4) |
| landing-ramp | 8 m | 3 | (92.7,-36.5) to (111,-31.9) |
| east-coast-road | 7 m | 7 | (101.1,-61) to (131.5,-1.7) |
| landing-south-spine | 8 m | 8 | (61.9,2) to (91.2,82.7) |
| landing-maze-road | 8 m | 7 | (76,13.1) to (136.8,66.1) |
| timemachine-maze | 6 m | 5 | (120.1,86.1) to (149.7,60.4) |
| landing-racestart | 9 m | 9 | (61.9,2) to (-78.3,0) |
| south-shore-road | 7 m | 7 | (22.8,101.5) to (101.1,103.2) |
| bowling-west-spur | 7 m | 5 | (-67.6,-104.9) to (-50.2,-65.5) |

---

## 4. The circuit

Ninety-two control points, one closed lap of **633 m**, 10 m wide, **24
checkpoints** — one every 40 m. The old track was 546 m with twelve gates
hard-coded in eleven places; the count is data now (`CIRCUIT.gates`), because
this course has two hairpins and a tight esses that twelve gates would leave
uncovered.

**One lap, not two.** Two laps of 633 m is a commitment nobody asked
for. `CIRCUIT.laps` is 1 and the HUD drops the lap counter when it is.

The elevation profile is re-authored against the new line: a crest on the north
loop so the descent out of it runs downhill into the west run, and a dip in the
middle of that run so its far end is a blind entry. Capped at 2.2 m — the
corridor carries the ground around it up as well, and the top-down silhouette
has to stay the thing you recognise.

**TNT** stands on the verge between the west straight and the west lake, which
is twenty metres wide: beside the racing line, not across it. **THE BLACK HOLE**
sits at (−100, −86), the deepest point inside the north loop — 29 m from the
racing surface at the nearest, so its pull can never reach a car that is racing.
The pull is an interaction, four seconds long, from the prompt only.

---

## 5. Water

| Body | What it is | Depth |
|---|---|---|
| ocean | outside the coast polygon, sea level −2.5 m | beach → 0.6 m shelf → away |
| lake-west | three overlapping ellipses in the circuit's lower infield | 2.6 m |
| lake-south | two ellipses east of the technical section | 2.4 m |
| river | eight-point spline, 18 m wide, across the top of the LANDING | 1.5 m |
| north-east bay | a notch cut into the coast polygon | shelving |
| the islet | its own landmass inside the bay | — |

**The coast is a polygon now.** It was a radius-varies-with-bearing harmonic,
which can only draw a star-shaped island; the plan has a bay bitten out of its
north-east corner and an islet inside it, and neither is expressible that way.
`coastInset(x, z)` gives metres inside the coastline — the max over both
landmasses — baked into a 384² grid because the terrain asks for it about
800 000 times while it builds.

Everything is shallow-banked and drivable. `node scripts/world-shore-check.mjs`
walks every waterline in the running world and reports the steepest gradient the
car would meet and how deep the water is four metres in; the results are in
section 10.

---

## 6. Vegetation

Trees and scatter come from the drawing's green masses and nowhere else — there
is no island-wide spray.

| mass | world (x, z) | extent | density | clearing |
|---|---|---|---|---|
| v1_nw_beach | (-150.1, -92.6) | 27 x 16 m | 0.5 | no |
| v2_blackhole_interior | (-100.7, -87.8) | 40 x 35 m | 0.7 | no |
| v3_race_infield_north | (-145.9, -36.5) | 23 x 44 m | 0.8 | no |
| v4_north_cluster | (-57, -98.6) | 27 x 21 m | 0.7 | no |
| v5_race_social_belt | (-46.4, -60.4) | 43 x 44 m | 1 | yes |
| v6_start_copse | (-46.4, -7.4) | 25 x 19 m | 0.7 | no |
| v7_race_infield_south | (-95, 64.4) | 112 x 56 m | 0.65 | yes |
| v8_hairpin_islet | (-28.1, 46.7) | 17 x 22 m | 0.6 | no |
| v10_south_forest | (74.1, 63.6) | 72 x 66 m | 1 | yes |
| v11_east_grove | (133, 14.3) | 42 x 66 m | 1 | yes |
| v12_bay_island | (112.1, -105.4) | 18 x 18 m | 0.9 | no |

Nothing may grow on the built ground the drawing leaves white. That is nine
suppression polygons — the landing forecourt, the bowling precinct, the projects
terrace, the social plate, the maze floor, the ramp's run-up, the achievements
pavilion, the time machine and the black hole — enforced in three places that
have to agree: `vegetationSuppressed()` for the trees and the scatter, the
terrain mask's green channel for the GPU lawn, and a `noveg` zone in the
occupancy registry.

`noveg` is deliberately **soft** in that registry. It covers roads, venues and
spawn points by design, so treating it as an obstacle reported every one of them
as a collision and told the validator the LANDING spawn was standing inside
something.

---

## 7. What was removed

### Districts

`lab` (AI LAB) · `kcl` · `ucl` · `teaching` (DEBUG YARD) · `algorithms`
(ALGORITHM FIELD) · `focus` · `gym` · `client` (CLIENT CITY) · `chess` ·
`stock` (EXCHANGE) · `voxel` (SEED CHUNKS) · `network` (TUNNEL) · `studio`
(KEYFRAMES) · `orbit` (THREE BODIES) · `archive` (PROJECT ARCHIVE) · `void`
(the 404 island)

Removing a district is a multi-file change, and all of it was done: the entry,
its landmarks, its respawn, its elevation, its prop scatter, its map marker, its
chapter cross-link and its mini-game. `DistrictId` is a closed union, so
TypeScript found every reference — that is why the union exists.

### Mini-games

Deleted as physical experiences: `ChessPuzzle`, `GymCircuit`, `OrderRush`,
`PacketRun`, `Retrieval`, `ThreeBody`, `VideoPipeline`, and four of the five
`IslandChallenges` (DEBUG DASH, RIVER RUN, CHIP RELAY, DEPLOYMENT ALTAR). Every
one of them was played in a district the drawing does not have.

**TNT DOMINO survives** because the drawing has TNT. It was one branch of a
five-way switch inside `IslandChallenges`; it is now `minigames/TntDomino.ts`,
because a five-way switch with one live branch is worse than a file.

### District set pieces

`districts/AnimationStudio.ts`, `districts/VoxelField.ts`,
`districts/LabInstallations.ts` — 2 070 lines. The last of those hard-coded
three instrument centres at (−78, −229), (−75, −169) and (67, −197), between 185
and 242 m from the origin on an island whose coastline was 143–153 m at those
bearings. They had been off the map for some time.

### Other geography

The waterfall and its grotto, the three old lakes, the old river, three of the
four bridges, the void island, the stunt ramp that reached it, `void-run`,
`RELAY_POINTS`, the client-tower generator and the archive-island generator.

### And what did NOT go

**No project data was deleted.** `src/content/projects/*`, `experience.ts`,
`education.ts`, `profile.ts`, `skills.ts` and `chapters.ts` are untouched, and
the scroll journey at `/` renders all of it exactly as before.

---

## 8. The two rebuilds

### PROJECTS — one place instead of twenty-six

A terminal you press ENTER on, eight plinths around it carrying the featured
work, and an overlay that holds the whole archive: 41 projects in eight
collections (FEATURED, AI & ML, SOFTWARE, WEB, 3D, UNIVERSITY, CLIENT WORK,
EXPERIMENTS). A project appears in FEATURED *and* in its category — the overlay
is a browser, not a partition.

`PROJECT_GROUPS` derives those collections from the inventory, and a
development-time check in `world.ts` warns if any project ends up in none of
them. The whole justification for deleting nine districts is that every one of
their projects is still reachable; that is a claim about a filter chain, and a
filter chain is exactly the thing that silently drops an entry when a category
is renamed, so it is checked rather than asserted.

### BOWLING — NEWPORT LANES, rebuilt

What was already right and was kept: the single scale constant that makes the
ball, the pins and the lane agree; the USBC pin silhouette, lathed into the
model, the physics hull and the score diagram from **one** list of radii; the
frame scoring; the sweep beat.

What changed:

* **Orientation.** The lane runs **east to west with the pins at the west end**,
  as drawn. There was no yaw anywhere in the file — the venue was authored with
  the bowler at +Z and everything, including the fallen-pin test, written in
  world coordinates. Static geometry is now built in venue-local space inside a
  child group that carries the transform; the eleven loose bodies stay in world
  space, because physics hands their positions back that way and a transformed
  parent would apply the yaw twice.
* **Length.** The lane bed went from 12 units to 32 — four lane-widths. At 12
  the ball was close enough to the pins that aiming was the whole game and
  rolling was not part of it.
* **The screen.** Twelve units wide, beside the lane on the bowler's left,
  outside the kickback and angled back at the approach. On the masking unit it
  was forty metres from the mark and edge-on to the chase camera for most of the
  throw. It carries the ten-pin diagram in the rack's own order, a state chip
  (READY / BALL IN PLAY / PINS DOWN / STRIKE / RESETTING), the three-frame
  scoresheet, PINS DOWN n/10 and the last throw's result.
* **The settle test.** A pin knocked into the pit lands on a flat channel and
  never quite sleeps, so with every fallen pin voting on "are the pins still
  moving" the answer was always yes and **every** throw ran to the fourteen
  second timeout instead — half a minute a ball. Only pins still on the deck
  count now.
* **Between balls the rack is re-read.** `standing` latches during a roll so the
  diagram does not flicker while ten bodies bounce off each other, which is the
  debounce §31 asks for. The cost was that anything happening to a pin after the
  throw resolved never reached the board, and the player lined up against a
  diagram showing a pin that was no longer there.
* **The ground.** The venue declares a rectangular `pad` rather than a `flat`
  radius: it is 62 m long and 12 wide, and a disc big enough to hold it levels
  fourteen thousand square metres of the north coast. It is also flattened
  **after** the circuit and the roads now — the top loop's run-off shoulder
  reaches 42 m and was overwriting the venue's own pad, which set the deck six
  metres above the lane and put the car inside the foundation.

---

## 9. Save migration

The schema went to version 3 with a v2 → v3 branch in `coerce()`, following the
existing v1 → v2 pattern: a version-gated fix-up applied after the generic field
coercion, never a wholesale discard. It drops district ids, landmark ids, note
ids, secret ids and mini-game ids that no longer exist, filters the `explorer`
set against the surviving signposted districts, and **keeps settings, race times
and every achievement that is still reachable**.

A returning visitor cannot be spawned into removed terrain: nothing spatial is
persisted except discovery sets, and the spawn is resolved from `SPAWN_RESPAWN`
at boot.

Every achievement was audited against a live trigger. The ones whose trigger
went away are gone (`debugDash`, `riverRun`, `chipRelay`, `deployment`, `chess`,
`pipeline`, `retrieval`, `orderRush`, `gymCircuit`, `threeBody`, `packets`,
`phoneHop`, `hiddenIsland`, `waterfall`, `cabin`, `chips`, `debugger`,
`shipIt`, `labPlay`), two were added for new places (`airborne` on the east
ramp, `blackHole` inside the north loop), and the counted ones were retuned to
the data: `explorer` to the eight signposted districts, `archivist` to the eight
plinths. `completionist` requires every other achievement, so one unreachable id
makes it permanently unreachable — that is the failure this audit exists to
prevent.

---

## 10. What proves it

Every number below was measured on the finished island, by a harness that drives
it. Nothing here is asserted from the data files.

### The picture

`node scripts/world-topdown.mjs <url>` parks the camera 700 m straight up over
the middle of the island and saves one frame; `node scripts/mapcal/compare.mjs`
puts it beside the photograph at the same aspect with the same tenth-lines.
Circuit on the left with its double loop, the black hole inside the top one,
bowling top-centre, social under it, projects upper-right, the ramp on the east
coast, the landing central-right with the name across it, the time machine
bottom-right and the maze in the corner, two lakes and a river with one bridge,
sand all the way round and sea beyond it. That is the drawing.

### The harnesses

| What it asks | How | Result |
|---|---|---|
| Does anything stand inside anything else? | `npm run world:layout` | 100 footprints, **0 conflicts**, **0 respawn problems** |
| Is anything standing in a road? | `npm run world:clearance` | **0 obstructions**; 11 samples excused by design (1 bridge deck, 3 ramps, the labyrinth arch) |
| Can a visitor meet the whole world without being teleported? | `npm run world:tour` | **10 of 10 stops reached, 0 teleports**, 932 m driven, 2 stalls (both while turning round under the labyrinth's arch, both recovered without help) |
| Is the circuit drivable at three paces? | `node scripts/world-race-drive.mjs` | **all three finished** — 75.6 / 65.6 / 47.0 s, 25 crossings each, never more than 4.0 m off the racing surface |
| Can every mini-game be started, played, left and replayed? | `npm run world:minigames` | **4 mini-games, 0 failing** — start, play, exit, clean HUD, second run, third run |
| Does bowling work five times running? | `node scripts/world-bowling-qa.mjs --sets=5` | **all checks passed** — ten pins on their authored spots to 1 mm before every set, three frames played out each time, and the screen never showed a pin that was not standing |
| Can the car drive into water and out again? | `npm run world:water` | 7 of 8: both lakes, both river fords, the ramp shallows and the deep-water recovery all pass. See below. |
| Is the beach drivable everywhere? | `npm run world:shore` | **0 failing transects** — steepest approach 22°, and no step at any waterline |
| Does the grass end anywhere you can see? | `npm run world:grass` | **0 views with a visible boundary** |
| Does the collision mesh match the ground you see? | `node scripts/world-polish-qa.mjs terrain` | sampler and physics agree to six decimal places at six probes; the transposed pair of each reads metres apart, so a transposed heightfield could not pass |
| Does the race behave under a hostile driver? | `node scripts/world-runtime-checks.mjs` | **22 records, 0 failing** — the countdown locks the car, reversed and skipped gates are rejected, the clock pauses and resumes, restart and exit are clean, a corrupt save boots fresh, and all three quality tiers hold 60 fps |
| Is every prompt reachable? | enumerating `game.interactions` in the running world | **25 prompts, 0 overlapping pairs** — no two trigger circles share a centre, so nothing is shadowed by a neighbour |
| Does the whole world still work end to end? | `npm run world:qa` | **all checks passed** — physics, recovery, the ramp, every district driven, every respawn driven away from, all four mini-games, touch, five mounts, no console errors |

### What the QA found, and what was done about it

The harnesses were not a formality — they found ten real defects in the world
this pass built, and each one is fixed rather than excused:

* **The bridge was not on its road.** The deck stood on the drawing's bridge
  zone at the drawing's rotation, 4.2 m and 7° off the road it carries, so the
  centreline ran 0.35 m inside the downstream edge of a 9.1 m deck. The tour put
  the car in the river on every run. `BRIDGES[0]` is now derived from the road:
  the point on `landing_bridge_social` closest to the middle of the river, at
  that road's own tangent. The crossing is 0.0 m off-centre.
* **The labyrinth opened onto the sea.** The generator cut its mouth in the
  south face, three metres from the waterline, while the signposted gate stood
  on the north one: the START prompt was in the water and the only way in was
  from the wrong side. The mouth is on the north face now, where the road
  arrives.
* **The labyrinth stood on a hillside.** Its 42 m square straddled the fall to
  the south-east beach — 2.8 m across it and an 11.8° cross-slope through the
  middle — and a seven-metre corridor on a side-slope rolls a car into a wall.
  The district has a plate now: 0.12 m of relief across the whole maze.
* **A car on its roof between two walls stayed there.** The recovery kicked the
  car with an impulse and a roll torque and tried again for ever; in a corridor
  there is nowhere to roll to. After three kicks the car is now set back on its
  wheels where it stands — no respawn, no teleport, and it cannot fail.
* **The bowling respawn could not be driven away from.** It faced west down the
  lane at a bed standing 0.81 m proud of the pad two metres in front of it: 3.5 m
  of travel in 1.4 s against 11–19 m at every other respawn, and because R lands
  on the same point, the mini-game sweep failed with it. It faces out now.
* **The ramp could not be driven onto.** Its approach road ends ten metres
  inside the ramp's own footprint, and a road corridor is applied after the
  ramp's pad — so the road cut the pad back down to road level and left the
  ramp's low end **3.5 m in the air**. `world-qa.mjs` measured 1.7 m of air off
  a 5.6 m ramp, because the car was climbing a wall rather than a slope. A road
  that runs into a ramp now climbs its pad, the same way a road that runs into a
  district climbs its plate, and the pad's shoulder is 16 m so the climb is 13°
  rather than 26°. The same run now peaks 6.7 m above the ground.
* **The ramp always drowned you.** `world.ts` claimed "the shelf there is 0.6 m
  deep, so you drive out again"; the general beach shelf is, for fifteen metres,
  and a full-boost launch off 5.6 m flies seventy-eight. Every use of the
  island's one big jump ended eleven metres under. A seaward ramp now carries a
  shoal: 0.85 m of water out to 85 m past the lip, fading over the thirty after
  that.
* **The river could not be forded.** It was 1.5 m at the middle and the car
  floats at 1.1, so anything that stopped mid-stream had nothing to push
  against. 0.95 m now — the bridge is the sensible crossing because fording is
  slow, not because the alternative is drowning.
* **The beach shelf was shorter than the run-out of a car.** Fifteen metres,
  which a car entering the sea at any speed is past before it can reverse.
  Twenty-four now.
* **The time machine undid itself.** It assigned `lighting.phase` directly;
  `Lighting.update` recomputes that from an accumulator the assignment never
  moved, so the sun swept out and snapped back the moment the animation ended.
  It calls `setPhase`, which exists for exactly this.

Two duplicate prompts were also removed. `blackhole-core` and `black-hole` stood
at the same point, as did `maze-entry` and `labyrinth-start` — the nearest
prompt wins, so one of each pair was unreachable and which one was a coin toss.
The black hole is `Playground`'s alone now; the labyrinth's arch is scenery and
the mini-game keeps the prompt. `maze-entry` was also carrying
`achievement: 'labyrinth'`, which is not an achievement id — the labyrinth's is
`pathFound`, awarded at the centre where it is earned.

### Types, lint and the production build

`tsc --noEmit` is clean under `strict`. `eslint .` reports no errors (one
pre-existing warning in `eslint.config.mjs` itself, about its own anonymous
default export). `next build` compiles and prerenders all five routes as static
content. Build with `NEXT_DIST_DIR=.next-verify` if a dev server is running:
they share `.next` otherwise and the build restarts the server mid-compile.

### What is still true and known

* **The `name` fixture in `world-polish-qa.mjs` is flaky at the last letter.**
  It drives at each of the sixteen physical letters in turn and knocks them
  over; on some runs one letter — usually the R — is left standing after three
  passes and the check reports 15 of 16. The letters and the RESTORE THE NAME
  prompt are all there (they were not, until this pass: the builder was looking
  up a landmark id that no longer existed); this is the harness's driving, not
  the world.


* **The open coast is a one-way trip on some bearings.** Wading in from the
  beach works; on about one bearing in eight the car drifts off the shelf while
  reversing and the drowning rule fishes it out. That is the designed behaviour
  of the deep — "going further is a decision" — and it is why the recovery
  exists, but it is a rescue, not a drive. Every piece of water the brief names
  (both lakes, both river fords, the ramp's landing) passes.
* **`south_shore_road` and `bowling_west_spur` are not joined to the network.**
  Both come straight from the drawing, both drive fine, and neither can be
  reached from another road without crossing open ground. The island is 266 m
  across and driving on grass is not a penalty, so they are left as drawn.

---

## 11. Development tools

* **SHIFT+M — map calibration.** Parks the camera where the plan was drawn from
  and lays the plan itself over the world at 40%, with the plan's tenth-lines.
  `[` and `]` fade it, `\` hides it. Development-only: the class is constructed
  behind `process.env.NODE_ENV === 'development'` and the image lives in
  `public/dev/`, fetched on the first toggle, so a production visitor never
  requests it.
* **SHIFT+L — layout debug.** Draws every footprint the occupancy registry knows
  about and prints its conflict report.
* `node scripts/world-layout-check.mjs` — the registry census and both
  validators, with no browser.
* `node scripts/world-topdown.mjs <url>` then `node scripts/mapcal/compare.mjs`
  — the drawing and the world, side by side.
* `node scripts/world-bowling-qa.mjs <url> --sets=5` — five sets, played with
  the car, comparing the screen against the bodies on every sample.
* `node scripts/_relayout.mjs` — for anything the registry says is stacked,
  sweeps a ring around its authored position for the nearest free ground.
