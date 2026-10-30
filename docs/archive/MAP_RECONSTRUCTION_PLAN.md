# MAP_RECONSTRUCTION_PLAN

> **The plan, at the scale it is built at today.** The tables below are
> regenerated from the live data, so they carry the 266 × 199.5 m island rather
> than the 380 × 285 one this plan was first written for. What the later pass
> changed, and why, is in [`WORLD_DENSITY_PASS.md`](WORLD_DENSITY_PASS.md).

**The hand-drawn map is the authoritative level design for `/world`.**
This document is the bridge between the photograph and the code: how the drawing
was digitised, what every feature's coordinates are in normalized drawing space
and in world metres, which of the current world's systems survive the move,
which physical experiences are deleted, and in what order the work happens.

Nothing in the world was moved until this was written. That is rule 2 of the
brief and it is also just sensible: the circuit alone is ninety-two control
points, and re-deriving them from a photograph twice would produce two different
tracks.

**The coordinates here are live.** They are regenerated from
`scripts/mapcal/plan.json`, which is the same file
`scripts/mapcal/emit-ts.mjs` compiles into `src/content/world-map.ts` — so this
document and the island cannot disagree. Where a feature moved DURING the
implementation, section 10 says which and why.

For what was actually built and what proves it, read
`DRAWING_MAP_IMPLEMENTATION.md`.

---

## 0. Source material

| Reference | Status |
|---|---|
| **A — the hand-drawn map** (`IMG_1101.HEIC`, 4032 × 3024) | Received. Rectified and digitised. This document. |
| **B — the bowling screenshot** | **Not attached to the message.** Only one file arrived. |

Reference B is missing, so the bowling work is driven by the written
specification instead (brief §23–§34, §57, §70–§73), which describes the
screenshot in enough detail to build against: vehicle beside the lane, one large
ball, ten physical pins, a narrow lane with low side rails, and a large physical
display beside the lane showing the pin arrangement and reacting live. If the
screenshot is supplied later the bowling pass can be re-run against it — the
venue is authored from one scale constant and a dozen offsets, so
re-proportioning it is cheap.

### How the drawing was digitised

The photograph is shot at an angle, so raw pixel positions are not proportional
to the drawing. The pipeline (kept in `scripts/mapcal/`) is:

1. **Rectify.** Four corners of the drawn ocean frame are picked and a homography
   maps them onto a 1200 × 900 canvas. This removes the keystone.
2. **Flatten illumination.** The paper is lit unevenly; dividing by a heavily
   blurred copy of itself makes crayon colour comparable across the sheet.
3. **Segment.** HSV thresholds split the sheet into asphalt / red barrier /
   blue water / green vegetation / yellow sand. The red barrier mask turns out
   to be the cleanest signal in the whole drawing and is what the circuit is
   traced from.
4. **Digitise into normalized space.** `u` runs 0→1 left to right, `v` runs 0→1
   top to bottom of the rectified drawing. Everything below is authored there.
5. **Verify by overlay.** `scripts/mapcal/overlay.mjs` draws the plan back onto
   the rectified photograph. Six iterations were run.
6. **Emit and compare.** `emit-ts.mjs` writes the TypeScript;
   `scripts/world-topdown.mjs` photographs the finished world from overhead and
   `scripts/mapcal/compare.mjs` puts the two side by side.

The drawing arrived already in the canonical orientation named in the brief:
race circuit on the left, bowling top-centre, social upper-centre, projects
upper-right, ramp right, landing central-right, time machine and maze
bottom-right. No rotation was applied.

---

## 1. Scale

```
MAP_WIDTH  = 266 m   (normalized u 0..1)
MAP_DEPTH  = 199.5 m (normalized v 0..1)

x = (u - 0.5) * MAP_WIDTH      →  x ∈ [-133, 133]    (+x east)
z = (v - 0.5) * MAP_DEPTH      →  z ∈ [-99.75, 99.75] (+z south)
```

The drawn island frame is 4:3, so the world is too.

**It was 380 × 285 and is now 70% of that in every direction** — half the area.
The distribution is untouched: the drawing is normalized, so one pair of numbers
in the emitter moved every zone, every path, every lake and the coastline itself,
all by the same factor and all in the same relative places.

What did NOT shrink is anything a car touches, because the car did not shrink.
The emitter carries a `HOLD` table of built dimensions emitted in measured metres
instead of as fractions of the drawing: the ramp deck, the bridge deck, the
bowling lane, the letters' ground, the time machine, the black hole's crater and
the labyrinth's square. A ramp scaled to 28.7 × 6.8 m is a ramp the car falls off
the side of.

The two numbers that matter, measured on the finished island:

* **Race lap: 633 m.** Driven by `scripts/world-race-drive.mjs` at three paces:
  50.5 s careful, 44.3 s normal, 36.2 s on the boost, 25 gate crossings each and
  never more than 2.7 m off the racing surface. `targetLapSeconds` is 44.
* **Landing to everything else: 44–156 m** — 4 to 16 seconds of driving. The ramp
  is 44 m away, projects 50, the time machine 70, social 79, bowling 82, the maze
  94, the race start 100, achievements 104, the black hole 125 and the TNT yard
  156. That is the density the brief asks for: seconds, not minutes.

**The circuit had to get narrower to fit.** At 0.7 the closest two stretches of
the lap that are not the same stretch are 12.6 m apart centre to centre, so the
old 14 m track overlapped itself by 1.4 m. `CIRCUIT.width` is 10, which leaves
2.6 m of grass between the kerbs at that pinch — and because the relaxed
centreline's tightest corner is 11.4 m, the inner kerb runs at 6.4 m, *wider*
than the 5.9 m it had at 380 × 285.

---

## 2. Top-down diagram

Legend: `#` circuit · `~` water · `"` vegetation mass · `:` dirt path ·
`.` land · blank ocean.

```


               ......................................
         ................................................~~~~~~~~
        ......#########........====[BOWLING]====........~~~~~~~~~~~..
       ......##.......##.:"""................::.:::::...~~~~~~~~~~~ .
      ."""..##."""""""..#:""""................::....:::..~~~~~~~~~ ...
     .""""".#.."""""""".#:""".[SOCIAL].........:.......::.~~~~~~~ ....
    .......#..."[BH]"""..#:.........:.........::........::............
    ......##..."""""""...#:""""""..::::......::..........::...........
   .......#..............#"::""""".....:::..::.........[PROJECTS].....
   ..#####..............##"":""""".......::::..............:..........
   .##.."""............##"""""""""........::..~~~~~~~~~...:.::........
   ..#.""""...#########...""""""".........~~:~~~~~~~~~~...:...::......
   ..#.""""".##............."""........~~~~~[BRG]~~~~~~..:.....:.......
  ...#."""""##........................~~~~~~~~::........:::[RAMP>>]....
  ..##."""".#.....[ACHV].............~~~~~~~...::.......:.......:......
  ..#..."""##........................~~~~~......:ALEJANDRO......:".....
  ..#.......#######........""""".....~~~~......[LANDING]......."::"""..
  ..#.............###..::::::::::::::::::::::::...::::........""":"""..
  ..#................#.:.......................:::::..........""""""""..
  ..#.................#..........#####..............:.:.......""""""""..
   .#.........~~~~~[START].....###...##.............:..:::....""""""""..
   .#........~~~~~~~~~..##.....#......##.............:...:::..""""""""...
   .#[TNT]..~~~~~~~~~~...#.....#.......##.~~~~....."":"""..:::"""""""....
   ..#......~~~~~~~~~~""##.....###".....#~~~~~~~.""""::""""..::""""""....
   ..#.....~~~~~~~~~~"""#""""..."##....~~#~~~~~~"""""":"""""...::.........
   ..#...""~~~~~~~~~~"##""""""..""#....~~#~~~~~~"""""":""""""...:::::.....
    .#..""""~"""~~~~""#""""""""..##....~~#~~~~~~"""""":""""""..::.:.::....
    .#...""""""""""""##""""""""..#......~#~~~~~"""""""::""""".::..:........
     #....""""""""""""###"""""###.......##~~~..""""""""::"""".::...........
     #......""""""""""""######..........#.......""""""""::[TIME]...........
      #..........""""""..............###..........""""""""........[MAZE]...
      ####..........##################.....::.............................
         ###########........................::::::.......:::.............
                  ...............................::::::::..............
                             .................................
```

---

## 3. Zones — normalized and world coordinates

| Zone | world (x, z) | footprint | from the LANDING |
|---|---|---|---|
| landing | (43.1, −7.6) | 72 × 52 m | — |
| nameLetters | (50.4, −14.0) | 49.4 × 12.0 m² | 10 m |
| bridge | (25.6, −30.0)¹ | 22.0 × 9.1 m² | 28 m |
| social | (−14.1, −61.8) | 35 × 28 m | 79 m |
| bowling | (−6.2, −71.0)³ | pad 74 × 30 m² | 82 m |
| bowlingLane | (−39.4, −78.8) → (1.3, −78.8) | 11.4 m wide² | — |
| projects | (72.9, −47.5) | 26 × 17 m | 50 m |
| ramp | (84.6, −21.9) | 30.0 × 9.7 m² | 44 m |
| timeMachine | (69.2, 57.5)⁴ | r 10.6 m² | 70 m |
| maze | (106.4, 62.2) | 46.0 m square² | 94 m |
| achievements | (−60.6, −17.6) | 30 × 15 m | 104 m |
| blackHole | (−70.0, −60.2) | r 12.0 m² | 125 m |
| tnt | (−110.1, 23.2) | pad 24 × 12 m³ | 156 m |
| raceStart | (−55.9, 9.0) | point | 100 m |

² A HELD dimension: emitted in measured metres by the map emitter's
`HOLD` table rather than as a fraction of the drawing, because the car
did not shrink. See §1.
³ Moved rather than scaled; see §10.

Notes on individual zones:

* **landing** — the spawn. Open, unplanted, path hub. The physical
  `ALEJANDRO NEWPORT` letters stand at its north-east side, south of the river.
* **bridge** — where the landing↔social road crosses the water, on the road's
  own tangent. It is the only crossing between the landing and the whole
  northern half, which is what makes it a landmark rather than scenery.
  ¹ The world coordinate is DERIVED, not drawn: the drawing's own bridge
  zone is at (36.6, −42.9), and the deck now stands at the point on the
  road nearest the middle of the river, 4.4 m west of it. See §10.
* **bowling** — a long east–west precinct along the north coast. The lane runs
  **east → west with the pins at the west end**, matching the drawing (red pin
  circles left, purple ball right). The car enters from the eastern lobe.
* **ramp** — points **east**, off the grass, over the beach and into the
  shallows. The drawing puts its lip past the waterline; shallow water there
  makes that a landing you drive out of rather than a death.
* **maze** — against the south-east beach. Axis-aligned: the drawing tilts it
  about 17°, but the maze generator is grid-aligned and a rotated wall set costs
  a rotated collider for every wall with no gameplay gain.
* **blackHole** — inside the upper circuit loop, at the deepest point of its
  infield. Its pull is confined to an interaction volume that does not reach the
  racing surface.
* **tnt** — on the infield verge of the far-left straight, beside the racing
  line rather than across it.
* **achievements** — the drawn brown-and-star ellipse in the circuit's
  upper-central interior, reachable from the link road, not from the track.

---

## 4. Race circuit

92 control points, closed, traversed in the direction the drawing's arrows give:

```
START/FINISH  →  north-west along the pit straight
  → the climb north (arrow at u 0.31, v 0.135 points up)
  → THE TOP LOOP, anticlockwise around the BLACK HOLE
  → the descent (arrow at u 0.14, v 0.20 points down)
  → the west hairpin
  → THE LONG WEST STRAIGHT, southbound, past TNT (arrow at u 0.055, v 0.50 down)
  → the south-west corner
  → THE SOUTH STRAIGHT, eastbound (arrow at u 0.33, v 0.855 points east)
  → the south-east sweeper, climbing north
  → THE TECHNICAL SECTION: a long right-hand arc, a very tight hairpin,
    a return west, a second hairpin north
  → back under the gantry
```

All six arrows on the sheet agree with this reading. Track width **14.4 m** as
drawn, built at 14 (the drawing's band is wider still — five car-widths, which
stops it reading as a circuit).

Centreline, world metres, `[x,z]`:

```
  [-79.8,12.8] [-88.2,0.0] [-96.9,-6.3] [-110.2,-8.6] [-123.5,-8.0] [-132.2,-10.8],
  [-133.8,-18.5] [-131.1,-27.1] [-128.1,-34.8] [-124.6,-41.3] [-117.8,-45.6] [-106.4,-47.6],
  [-93.1,-48.4] [-81.7,-49.9] [-72.2,-54.1] [-67.6,-61.3] [-67.3,-71.2] [-68.4,-81.2],
  [-70.3,-91.2] [-72.2,-99.8] [-76.0,-106.9] [-82.8,-111.7] [-92.0,-114.6] [-101.8,-115.1],
  [-111.3,-113.4] [-119.7,-109.7] [-126.2,-104.0] [-130.0,-96.9] [-133.0,-88.3] [-136.0,-79.2],
  [-139.5,-71.2] [-143.6,-65.0] [-150.1,-61.3] [-157.7,-59.9] [-164.2,-59.0] [-169.1,-54.7],
  [-166.4,-47.0] [-167.2,-34.2] [-168.0,-20.0] [-168.3,-2.9] [-168.3,14.3] [-168.0,31.3],
  [-167.2,48.5] [-166.4,62.7] [-165.3,77.0] [-162.6,88.4] [-158.5,96.0] [-149.7,101.7],
  [-137.6,103.7] [-118.6,104.0] [-98.8,102.6] [-76.0,101.5] [-53.2,100.3] [-34.2,99.2],
  [-19.0,97.5] [-5.7,94.9] [0.0,92.6] [7.6,84.9] [11.4,75.5] [12.5,65.5],
  [11.8,55.6] [9.9,45.6] [6.8,35.6] [2.3,26.2] [-3.8,18.5] [-6.8,13.7],
  [-16.0,11.4] [-24.7,12.8] [-31.5,17.1] [-36.1,23.4] [-38.4,30.2] [-37.2,36.5],
  [-32.7,40.8] [-26.6,42.2] [-22.8,46.5] [-22.0,53.6] [-23.9,61.3] [-27.4,69.0],
  [-32.7,75.2] [-39.9,79.2] [-48.6,81.5] [-57.8,82.4] [-67.6,81.5] [-76.0,78.4],
  [-82.5,73.2] [-84.4,67.0] [-81.7,60.4] [-76.0,54.1] [-71.1,46.5] [-67.6,37.9],
  [-67.6,28.5] [-72.2,20.5]
```

The elevation profile is re-authored against this line: a crest on the north
loop so the descent runs downhill into the west run, and a dip on that run so
its far end is a blind entry. Kept under 2.5 m — the top-down silhouette has to
stay dominant (§61).

---

## 5. Water

All inland water is shallow-banked and driveable at the edges (§17, §62): gentle
banks, a shallow shoreline, a gradually deeper centre, no trenches. The two
lakes bottom out around 2.4 m — deep enough to be lakes, and their aprons are
shallow enough that the car drives in and out of them. The river is the piece
the brief names, and it is 0.95 m at the deepest: under the 1.1 m at which the
car floats off its wheels, so it can be forded anywhere along its length.

| Body | Shape | Notes |
|---|---|---|
| **ocean** | outside the coast polygon | sea level −2.5 m, beach ≈ 10 m wide |
| **lakeWest** | three overlapping ellipses | inside the lower-left circuit region |
| **lakeSouth** | two ellipses | lower-central, east of the technical section |
| **river** | 8-point spline, 18 m wide | the landing river, crossed by the bridge; 0.95 m at the deepest, so it is a ford as well as a bridge |
| **bayNorthEast** | a notch cut into the coast | open to the sea, by Projects |
| **the islet** | its own landmass in the bay | the drawing's green crescent |

Coast polygon, world metres — 59 points, replacing the
old radial-harmonic `coastRadius()`:

```
  [-141.4,-124.8] [-114.0,-128.8] [-79.8,-131.1] [-41.8,-132.2] [-3.8,-132.2] [34.2,-131.1],
  [62.7,-128.8] [80.6,-126.0] [87.4,-119.7] [88.9,-110.6] [92.7,-100.9] [99.6,-92.3],
  [109.4,-87.2] [120.8,-85.5] [131.5,-87.8] [138.3,-94.6] [141.4,-103.2] [139.8,-112.3],
  [142.1,-116.9] [148.2,-112.9] [151.2,-100.9] [153.5,-86.6] [154.3,-71.2] [155.0,-54.1],
  [155.8,-37.1] [157.3,-20.0] [159.6,-2.9] [163.4,14.3] [168.0,31.9] [172.5,49.0],
  [175.6,65.5] [177.1,80.9] [175.6,94.0] [169.5,104.9] [157.3,112.9] [139.1,117.4],
  [116.3,120.3] [89.7,122.0] [60.8,123.1] [29.6,123.7] [-2.3,123.1] [-33.4,122.0],
  [-62.3,119.7] [-88.9,116.3] [-113.2,111.7] [-134.5,105.5] [-152.0,96.9] [-164.2,85.5],
  [-171.8,71.8] [-176.3,55.3] [-178.6,35.9] [-180.1,14.8] [-180.9,-6.3] [-180.9,-27.4],
  [-179.4,-48.4] [-176.3,-67.8] [-170.2,-86.1] [-161.1,-102.6] [-152.0,-115.1]
```

---

## 6. Vegetation masses

Trees are placed **inside these zones only** — no island-wide scatter. Density
is a multiplier on the zone's base rate.

| Zone | normalized | world (x, z) | size | density |
|---|---|---|---|---|
| `v1_nw_beach` | (0.105, 0.175) | (-150.1, -92.6) | 27 × 16 m | 0.5 |
| `v2_blackhole_interior` | (0.235, 0.192) | (-100.7, -87.8) | 40 × 35 m | 0.7 |
| `v3_race_infield_north` | (0.116, 0.372) | (-145.9, -36.5) | 23 × 44 m | 0.8 |
| `v4_north_cluster` | (0.350, 0.154) | (-57.0, -98.6) | 27 × 21 m | 0.7 |
| `v5_race_social_belt` | (0.378, 0.288) | (-46.4, -60.4) | 43 × 44 m | 1.0 |
| `v6_start_copse` | (0.378, 0.474) | (-46.4, -7.4) | 25 × 19 m | 0.7 |
| `v7_race_infield_south` | (0.250, 0.726) | (-95.0, 64.4) | 112 × 56 m | 0.65 |
| `v8_hairpin_islet` | (0.426, 0.664) | (-28.1, 46.7) | 17 × 22 m | 0.6 |
| `v10_south_forest` | (0.695, 0.723) | (74.1, 63.6) | 72 × 66 m | 1.0 |
| `v11_east_grove` | (0.850, 0.550) | (133.0, 14.3) | 42 × 66 m | 1.0 |
| `v12_bay_island` | (0.795, 0.130) | (112.1, -105.5) | 18 × 18 m | 0.9 |

Plus a ring of bank vegetation along the river, which is the drawing's green
surround.

### Exclusion zones (nothing procedural may plant here)

`RACE` (track corridor + verge) · `ROAD` (every dirt path) · `BRIDGE` ·
`WATER` (ocean, lakes, river, banks) · `LANDING` · `BOWLING` (the whole
precinct) · `PROJECTS` · `SOCIAL` · `MAZE` · `RAMP` (including its run-up and
landing) · `ACHIEVEMENTS` · `BLACK HOLE` · `TIME MACHINE`.

Grass follows the same masks and additionally keeps off sand.

---

## 7. Path network

Compact-earth tracks, not asphalt (§44):

| Path | pts | from → to |
|---|---|---|
| `landing_bridge_social` | 8 | (61.9, 2.0) → (-9.9, -80.4) |
| `social_bowling` | 4 | (-16.0, -75.8) → (-8.4, -92.3) |
| `bridge_bowling_east` | 6 | (22.8, -59.9) → (34.2, -104.9) |
| `bowling_projects` | 5 | (46.4, -108.3) → (97.3, -73.0) |
| `landing_projects` | 6 | (61.9, 2.0) → (99.6, -60.4) |
| `landing_ramp` | 3 | (92.7, -36.5) → (111.0, -31.9) |
| `east_coast_road` | 7 | (101.1, -61.0) → (131.5, -1.7) |
| `landing_south_spine` | 8 | (61.9, 2.0) → (91.2, 82.7) |
| `landing_maze_road` | 7 | (76.0, 13.1) → (136.8, 66.1) |
| `timemachine_maze` | 5 | (120.1, 86.1) → (149.7, 60.4) |
| `landing_racestart` | 9 | (61.9, 2.0) → (-78.3, 0.0) |
| `south_shore_road` | 7 | (22.8, 101.5) → (101.1, 103.2) |
| `bowling_west_spur` | 5 | (-67.6, -104.9) → (-50.2, -65.5) |

The world tour these make possible (§45):

```
LANDING → bridge → SOCIAL → BOWLING → PROJECTS → RAMP
        → TIME MACHINE / MAZE → back to LANDING
        → ACHIEVEMENTS → RACE START → the lap
        (TNT and the BLACK HOLE are seen from the track)
```

---

## 8. What is kept, what is moved, what is deleted

### Systems retained unchanged (coordinate-independent)

Vehicle physics and handling (`PhysicsVehicle`, `Player`, `VisualVehicle`) —
explicitly not to be touched. Renderer, quality tiers, LOD, ticker, disposal,
input (keyboard / gamepad / touch / wheel), camera and view modes, the tween and
event core, materials and palette, the grass shader architecture, the tree
instancing system, the water shader, weather (daylight only), the interaction
prompt UI, the achievement engine, the save engine, spatial audio, and the
`Minigame` base class.

### Physical experiences retained (relocated)

| Was | Becomes |
|---|---|
| `hub` district + `hub-name` letters | **LANDING** + the physical name |
| `circuit` district + `CircuitRace` | **RACE** + **RACE START** |
| `bowling` play spot + `Bowling` | **BOWLING**, rebuilt |
| `labyrinth` district + `Labyrinth` | **MAZE**, square |
| `tnt` play spot + TNT DOMINO | **TNT**, its own file |
| `timeMachine` play spot | **TIME MACHINE** |
| `gravityWell` play spot | **BLACK HOLE**, rebuilt |
| stunt ramp | **RAMP**, pointed at the sea |
| — (new) | **SOCIAL** (camera sculpture, four links) |
| — (new) | **PROJECTS** (consolidated hub) |
| — (new) | **ACHIEVEMENTS** |

### Physical experiences REMOVED

Districts deleted (geometry, colliders, plates, signage, roads, respawns, dev
notes, map markers, audio emitters and interaction triggers all go with them):

`lab` (AI LAB) · `kcl` · `ucl` · `teaching` (DEBUG YARD) · `algorithms`
(ALGORITHM FIELD) · `focus` · `gym` · `client` (CLIENT CITY) · `chess` ·
`stock` (EXCHANGE) · `voxel` (SEED CHUNKS) · `network` (TUNNEL) · `studio`
(KEYFRAMES) · `orbit` (THREE BODIES) · `archive` (PROJECT ARCHIVE) · `void` (404)

Play spots deleted: `deployment` · `debugDash` · `riverRun` · `chipRelay` ·
`particleField` · `procedural` · `cabin`.

Mini-games deleted as physical experiences: `GymCircuit` · `OrderRush` ·
`PacketRun` · `Retrieval` · `VideoPipeline` · `ThreeBody` · `ChessPuzzle` · and
four of the five `IslandChallenges` (DEBUG DASH, RIVER RUN, CHIP RELAY,
DEPLOYMENT ALTAR — TNT DOMINO survives because the drawing has TNT).

Every one is recoverable from git; none of them is portfolio *content*.

### Content preserved

**No project data is deleted.** `src/content/projects/*`, `experience.ts`,
`education.ts`, `profile.ts`, `skills.ts` and `chapters.ts` are untouched, and
the 2D scroll journey at `/` keeps rendering all of it. What changes is that the
world stops giving each project its own district and gives them all one place.

---

## 9. Migration strategy

Order matters: geometry that other systems measure against has to move first.

1. **Author the layout.** `src/content/world-map.ts`, generated from the plan.
2. **Terrain and water.** Polygon coast, new lakes, new river, new beach band.
3. **Circuit.** New centreline, elevation, checkpoints, barriers, kerbs.
4. **Zones and occupancy.** Rewrite `world-layout.ts`'s `zones()`.
5. **Delete districts,** then grep for orphans.
6. **Build the new places.**
7. **Paths.** New `roads`, dirt surface.
8. **Ecology and grass.** Vegetation zones + exclusion masks.
9. **Respawns.** Regenerate against the registry.
10. **Save migration.** Bump the schema; drop what no longer exists.
11. **UI.** Rebuild the in-game map; prune removed districts everywhere.
12. **Calibration mode.** Dev-only top-down with the plan overlaid.
13. **QA.** Layout, shore, clearance, tour, race, bowling, top-down comparison.

### Risks

* **Ghost geometry.** A collider or trigger left behind under the new terrain.
  Mitigated by the occupancy registry: `validateLayout()` enumerates every
  footprint and `scripts/world-layout-check.mjs` runs it.
* **Terrain contract.** Many systems call `coastRadius`. Keeping the signature
  and changing only the implementation avoids a shotgun edit.
* **Race feel.** The new circuit is longer with more corners; checkpoint density
  has to rise with it or the anti-shortcut logic goes loose.
* **Vehicle handling.** Not to be touched. Terrain material and collider
  parameters stay exactly as they are.

---

## 10. What moved during implementation, and why

A plan that quietly disagrees with the code is worse than no plan, so the
tables above are regenerated from the live data and these are the deliberate
departures from the first digitisation:

* **lakeSouth, ~19 m east.** The drawing has it abutting the circuit's east
  climb. The corridor needs 10.4 m of clearance either side, so the lake was
  moved out of it — the alternative was a lake with a racing line through it.
* **lakeWest's first lobe, tightened.** It reached the verge the TNT stack
  stands on, leaving nowhere between the track and the water to put it.
* **The TNT stack, re-laid.** Nine crates abreast was a thirty-metre row on a
  twenty-metre verge: its west end stood on the racing surface and its east end
  was in the lake. Three abreast and six deep, along the verge.
* **The black hole, ~14 m north-west,** to the deepest point inside the north
  loop (29 m from the racing line rather than 18).
* **The physical name, ~12 m east and south,** clear of the bridge's deck and
  the road junction. The junction itself moved south of the name, which is where
  the roads have to meet if a car leaving the landing is not to start wedged
  between an A and an N.
* **The bowling venue, 8 m east.** The circuit's top loop carries its run-off
  shoulder 42 m, which reached the venue's west end and overwrote its own
  ground.
* **The maze, un-rotated,** and re-cut from five-by-three cells of 9.4 m to
  five-by-five of 7 m, so it is the square the drawing draws.
* **The bridge, moved onto the road it carries.** It stood on the
  drawing's own bridge zone with the drawing's own rotation, which put
  the road's centreline 4.2 m off the deck's — on a deck 9.1 m wide,
  that is 0.35 m inside the downstream edge. Every crossing put one
  side of the car over the water and most of them ended in the river.
  It is now derived: the point on `landing_bridge_social` closest to the
  centre of the river, at that road's own tangent.
* **The maze's mouth, moved from the south face to the north face.** The
  generator opened it on the far side, which on this island is three metres
  from the waterline: the approach marks, the arch and the START prompt were
  all in the sea, and the only way in was to swim the last of it. The road
  arrives from the north, and now so does the opening.
* **The north-east bay, deepened** from 26 m to 42 m. At 26 the whole inlet was
  inside the beach band and read from above as a pale notch in the sand rather
  than as water.
