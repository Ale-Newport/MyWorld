# /world — level-design audit

What the island was, what was wrong with it, and what it is now. Written
against the state of the world before this pass and updated as each thing
moved; the "action" lines are all done unless they say otherwise.

The numbers here are measured, not estimated. The tools are:

| tool | what it measures |
|---|---|
| `node scripts/world-layout-check.mjs [--all]` | every pair of hard footprints that overlap, and every respawn on unusable ground |
| `node scripts/world-shore-check.mjs <url>` | gradient and depth either side of every waterline |
| `node scripts/world-water-drive.mjs <url>` | drives into and back out of every body of water |
| `npm run world:loop -- <url>` | drives every road end to end under power, no teleporting |
| `npm run world:clearance -- <url>` | asks Rapier what is actually standing in each carriageway |
| `npm run world:minigames -- <url>` | every mini-game, played three times |
| `npm run world:grass -- <url>` | the grass clipmap, at maximum zoom and the widest aspect |
| `node scripts/world-survey.mjs <url>` | screenshots and telemetry at an arbitrary list of places |
| SHIFT + L in development | draws every footprint the occupancy registry knows about |

---

## The thing that was actually wrong

The world was not short of content. It had nineteen districts, sixty-one
authored landmarks, twenty-two generated ones, a 780 m race circuit, twelve
play venues and eleven mini-games, and almost all of it was individually
good.

What it did not have was one place where "what is where" was written down.
Layout lived in `src/content/world.ts`, `src/content/world-environment.ts`,
a district-elevation table inside the renderer, the hub name's real size
inside `Playground.ts`, and each mini-game's own geometry. Three separate
copies of "may something be placed here?" were written against those files
with three different sets of numbers, so a rule fixed in one stayed broken
in the other two.

Everything below is downstream of that. A client tower stood in four metres
of Mirror Lake; a road ran through the middle of another lake with no
bridge; grass grew down the racing line; six respawn points were outside
the district they claimed to serve and three put the car inside a wall.
None of it was a mistake anybody made twice — it was the same mistake made
once, in a place where nothing could see it.

So the first change was `src/content/world-layout.ts`: every feature
declares the ground it OCCUPIES, as distinct from the radius it is
discoverable from, and everything that places anything asks it. The rest of
this document is what that turned up.

---

## Zones

### CENTRAL HUB
- **Position** (18, −2), radius 32, plate 30.
- **Footprint** paving to 37.5 m, plus the physical name.
- **Nearby** KCL to the north, DEBUG YARD south, FOCUS east. The junction of
  four roads.
- **Problems** Every road out of the hub met at (18, −2) — which is where
  ALEJANDRO NEWPORT stands. The name is twenty-five metres of movable
  letters, and three of the four roads ran straight through them: a car
  leaving northbound started wedged between an A and an N, and the
  automated tour could not complete `ring-north`, `hub-chess` or `spine`
  from a standing start. `hub-about` was a nine-metre solid wall 4.7 m off
  the ring road. `hub-welcome` was a ten-metre billboard on solid posts.
  Four features — the brackets jump, the 2026 plate, a ramp and the welcome
  sign — occupied the same few metres.
- **Road access** ring-north, ring-west, spine, hub-chess.
- **Water** none.
- **Action** Junction moved to (18, 8), on the forecourt south of the name,
  with the roads leaving around it. Letters reduced to 75% and their size
  moved into the manifest. `hub-about` shrunk to 6 × 3.8 with only its
  plinth solid. `hub-welcome` is a lectern with no collider.

### KING'S COLLEGE LONDON
- **Position** (−2, −40), radius 32, no plate.
- **Problems** `kcl-crypto` was a 13.2 × 6.9 × 0.5 solid slab — the most
  wall-like object in the world — standing where the road in arrives.
  `kcl-degree` was a billboard. The respawn comment described a cipher wall
  at (−126, −6); there is no feature there and never was.
- **Action** The cipher wall is three panels with two drivable gaps.
  `kcl-degree` is a lectern. Respawn re-derived to (−8.7, −58.7), on the
  road in, facing the campus.

### DEBUG YARD (teaching)
- **Position** (−4, 28), radius 20.
- **Problems** `teaching-role` was a billboard. `teaching-bugs` — which is
  where Playground puts the FAIL blocks — sat in the ring road.
- **Action** Both moved clear; the blocks are now west of the road inside
  the yard at (−17, 34).

### ALGORITHM FIELD
- **Position** (4, 68), radius 26. Five project monuments.
- **Problems** `algo-cinquillo` stood in `ring-west`.
- **Action** Moved 7 m east.

### FOCUS · GYM APP
- **Positions** (52, 22) r24 and (48, 62) r20, both on the spine.
- **Problems** The FOCUS respawn was 38 m from FOCUS and inside the GYM
  APP; the GYM respawn was inside PROJECT ARCHIVE. `focus-device` shared
  1.2 m of ground with a generated client tower. `focus-pipeline` and
  `focus-role` were in the road.
- **Action** Both respawns re-derived. The tower generator no longer
  produces that overlap (see CLIENT CITY). Landmarks moved off the road.

### CLIENT CITY
- **Position** (108, 32), radius 24. Fifteen generated towers.
- **Problems** The generator placed towers on three fixed rings and nudged
  them radially six metres at a time, twelve times, against play spots
  only — so it knew nothing about water, roads, plates or each other.
  `aula-impulsa` was generated 4.2 m under Mirror Lake. Six of the fifteen
  finished 50–92 m from the city; `esenfuer` was nearer the ALGORITHM
  FIELD than to CLIENT CITY.
- **Action** Rings tightened to 17/27/37 m and the generator now sweeps
  either side of each tower's authored bearing for genuinely free ground,
  remembering what it has already placed. Furthest is now 53 m, none is in
  water, none overlaps another.

### AI LAB · CHESS TERMINAL · EXCHANGE · TUNNEL
- **Positions** (48, −96), (−6, −80), (66, −72), (76, −100).
- **Problems** The CHESS respawn was 24 m outside a 14 m district; the
  EXCHANGE respawn was inside the AI Lab's corpus; the TUNNEL respawn was
  5.8 m inside the EXCHANGE. The `network` district contains none of its
  own landmarks — `vpn-node-a` and `vpn-node-b` are 22–41 m outside it.
- **Action** Respawns re-derived. The TUNNEL's landmark placement is
  unchanged and remains a known oddity: the two nodes are a tunnel's two
  ends and are meant to be far apart, but the district disc does not
  describe that. Left as it is; noted rather than fixed.

### UCL · LABYRINTH · SEED CHUNKS
- **Problems** `ucl-ml-revision` and `voxel-seed` were two monuments 1.8 m
  apart with a respawn between them. Two UCL module monuments stand in
  Mirror Lake. The VOXEL respawn was under a nine-metre voxel stack.
- **Action** The monuments are separated and off the road; the respawn is
  re-derived and baked. The two lake monuments are unchanged — they read as
  deliberate, standing in shallow water at the lake's edge, and the lake's
  new wadeable rim means you can drive to them.

### LABYRINTH
- **Position** was (98, −66); now (92, −62), radius 22, plate 24.
- **Problems** The maze is not its plate. Seven by five cells of 9.4 m
  corridor separated by 1.2 m walls is 75 × 54 m of solid static geometry
  — the second-largest structure on the island after the circuit — and the
  registry knew only about the 24 m plate. Two things followed. Its
  south-east corner stood 164 m from the origin against a coastline of
  156, so part of the maze was in the sea. And the ring road's whole
  north-east leg ran through the middle of it: the roads were authored to
  reach district centres, and the centre of this district is the middle of
  the maze. `ring-east` was a road into a wall and had been since the maze
  was built. The PARTICLE FIELD and the DEPLOYMENT ALTAR were inside it
  too, and the lake shortcut clipped its north-west corner.
- **Action** 5 × 3 cells (54 × 33 m), moved west and north, and its real
  extent declared in the registry. `ring-east` goes round its eastern
  side, through the gap between it and the coast where the island is
  widest. Both neighbours moved out.

### RACE CIRCUIT
See **The circuit** below. The district at (−42, 88), its start-gantry
landmark and the actual track geometry were in three different places.

### PROJECT ARCHIVE
- **Problems** `archiveIslands` computed an avoided X and then wrote Z back
  from the *un-avoided* polar coordinate — up to 62 m of correction thrown
  away on one axis, which is how two islands ended up in other districts.
- **Action** Rewritten against the occupancy registry with self-avoidance.

---

## Water

Every waterline in the world was a cliff, in two different ways.

**The coast.** Inland of the coastline the ground was lifted 3.2 m by a rim
term; one metre outside it dropped to −0.5 by a separate formula that knew
nothing about the rim. At every bearing the beach was a 3.7 m step, and at
the north-west highland it was fifteen. Seven places in `Terrain.ts`
re-derived that rim inline to work out what height a district, a play spot
or a ramp should flatten to.

**Lakes.** `inlandWater` stopped answering about two metres past a lake's
mapped edge while the bank was blended over three and a half, so every shore
was truncated a third of the way down and wore a ring cliff up to 5.7 m.

**Action.** One continuous shore profile: a dune that rises inland and falls
back to nothing before the sand, then dry sand, the waterline, a
fifteen-metre shelf 0.6 m under the surface, and only then the drop-off.
Lake reach and bank width are the same number now, the depth curve is raised
to a power so the first few metres are ankle-deep, and each lake eases the
ground around it into a hollow. The river is 1.6 m deep instead of 2.6,
which makes it fordable. The drowning threshold moved from 0.45 m under the
surface for 1.2 s to 1.1 m for 2 s — it used to fire in water the car could
plainly drive out of.

Measured after: 23 transects, every one under 30° at the waterline, every
one under 0.8 m deep four metres in. `world-water-drive.mjs` drives into and
reverses out of the beach on two bearings, all three lakes and the river in
two places, and the open sea still recovers the car.

**Bridges.** All three stood in open country — the nearest tarmac to any of
them was 26–31 m, including the one typed `kind: 'road'`. They were hard
locked to the world X axis with no rotation field, so a crossing on any
other bearing could not be expressed. The modern one spanned a lake no road
went near, and its approach pads punched two sheer 2.93 m plateaus into the
middle of it. Each is now on a road, at the point where that road meets the
water, built along the road's own tangent.

---

## Roads

- **Surface.** Painted in `palette.concrete` (#cfcbc2) — lighter than the
  grass either side. From the driving camera the network did not read at
  all. Now: shoulder, tarmac, aggregate, worn wheel tracks, edge lines and
  a centre dash, in a warm mid grey.
- **The race circuit had no painted surface whatsoever**, and was missing
  from the grass mask entirely, so grass grew down the racing line.
- **Roads drove into water.** `ring-south` ran through the middle of Willow
  Lake; `circuit-link` clipped the last four metres of the river and
  dropped into the trench the water carve made.
- **The circuit was a dead end.** It hung off `circuit-link`, an 84 m spur:
  you reached the largest feature on the island by driving one road, and
  left by driving the same road backwards.
- **Action.** Willow Lake moved into the bay south of the ring road.
  `circuit-link` re-cut to cross the river squarely at a bridged point.
  `north-link` added, closing the loop off the circuit's north-east corner
  over the river into the chess terminal. `lake-shortcut` added: forty
  metres of deck across Mirror Lake between UCL and the spine, unsignposted.

## The primary loop

    hub → ring-north → ORBIT → EXCHANGE → AI LAB → TUNNEL
        → ring-east → LABYRINTH → UCL → SEED CHUNKS → CLIENT CITY → KEYFRAMES
        → ring-south → PROJECT ARCHIVE → ALGORITHM FIELD
        → ring-west → DEBUG YARD → hub

with the spine cutting north-south through it (FOCUS, GYM, ARCHIVE), a
branch south-west to KCL and the CHESS TERMINAL, `circuit-link` and
`north-link` out to the circuit and back, `lake-shortcut` as a shortcut, and
`void-run` as the dirt track to the stunt ramp.

---

## The circuit

**Was.** A 780 m four-lane serpentine with 33 control points. It read as a
slalom rather than a track; two of its lanes merged into a single slab of
tarmac in the north-west; the start/finish line sat on a 0.8 m-radius cusp
where the closed spline turned back on itself, so a lap began mid-hairpin.
No painted surface. No jump. The landmark that starts the race built nothing
and stood 32 m from the start line. The lap count was stated three different
ways and one of them was wrong.

**Is.** 546 m, 25 corners between 5 m and 112 m of radius, laid out as a
road course: a 55 m start/finish straight beside the link road, a long fast
right onto the west side, an 80 m fast run, a hairpin at the north end, a
descent, an esses section into a technical infield, and an east straight
with a signposted jump on it. Gradients are authored, because the island's
west side is level — a crest before the esses so the fast descent runs
downhill into the slowest corner.

Verified by `scripts/_circuit.mjs`: no self-crossings, no two parts of the
lap within a track width and a half of each other, 18 m of coast margin at
its closest.

---

## Vegetation

- Grass was deforming by TRANSLATION, not rotation: a blade's tip was pushed
  sideways by a multiple of its own height and only dropped a little, so a
  0.9 m tuft became 2.2 m of spike and a parked car sat in a starburst.
- Foliage chunks switched on and off at fixed distances measured to the
  CENTRE of a 64 m chunk, so the boundary between drawn and not-drawn swept
  around the car as a visible ring.
- The GPU grass field was one 72 m square following a camera that stands off
  up to 39 m on a 25° lens, so its own corner was in frame.
- The baked grass mask excluded roads and district plates but not the race
  circuit, so grass grew on the racing line.

All four fixed; see `WORLD_POLISH_PASS.md` for what replaced them.

---

## Known and deliberate

- **`hub-name` still stands where roads reach it.** The letters are a
  playground you are meant to drive into. The junction moved south of them
  so that no road runs *through* the name, but the ring still arrives at
  it, which is the point of it.
- **The `network` district contains none of its own landmarks.** Its two
  nodes are the two ends of a tunnel and are meant to be far apart.
- **Two UCL module monuments stand in Mirror Lake's shallows.** They read as
  deliberate and the lake's new rim means you can drive to them.
- **The void island is off the map.** It is at z = −233, past the edge of a
  map that spans ±164, and reaching it is the secret.
- **`world-layout-check.mjs` still reports conflicts.** Most are a road
  passing close to a district's centrepiece — the checker's threshold
  (footprint + half the carriageway + 1.4 m) is deliberately conservative,
  and the automated tour is the authority on whether a road is actually
  drivable. The count is down from 223 to about 70.
