# /world — the level-design and polish pass

What changed, why, and what proves it. The companion documents are
`WORLD_LEVEL_DESIGN_AUDIT.md` (the island, zone by zone) and
`MINIGAME_QA.md` (fifteen games, and what each does on the third play).

---

## The one change everything else came out of

The world was not short of content. What it lacked was a single place
where "what is where" was written down. Layout lived in `world.ts`, in
`world-environment.ts`, in a district-elevation table inside the renderer,
in the hub name's size hardcoded inside `Playground.ts`, and in each
mini-game's own geometry. Three separate copies of *may something be placed
here?* were written against those files with three different sets of
numbers — the ecology used a 10 m coast margin and a 5 m track clearance,
the scenery details used 6 and 0, and a third in `world.ts` knew only about
play spots and threw away one of its two axes.

`src/content/world-layout.ts` is now the only answer. Every feature declares
the ground it OCCUPIES — as distinct from the radius it is discoverable
from, which is what the old code confused it with — and the ecology
scatter, the scenery details, the tower and island generators, the respawn
audit and a headless checker all ask the same registry.

What that immediately found: a client tower generated four metres under
Mirror Lake and six more 50–92 m from the city they belong to; archive
islands whose avoidance was discarded on one axis by up to 62 m; a ring
road through the middle of a lake; two identical play spots at the same
point; and twenty-three respawn problems, including one on a timeline plate
so that pressing R fired the TIME TRAVELLER secret.

    npm run world:layout                    # 223 conflicts → ~66
    npm run world:clearance -- <url>        # what is ACTUALLY in a road
    SHIFT + L in development                # draws all of it

---

## Map layout

The macro arrangement was already sound and is kept: a ring road through
the eastern half with every district on it, the race circuit given the
whole west, and the river as the seam between them. What was wrong was
local, and all of it is fixed.

**The junction moved off the name.** Four roads met at (18, −2), which is
where ALEJANDRO NEWPORT stands — twenty-five metres of movable letters,
with three of the four roads running straight through them. A car leaving
the hub northbound started wedged between an A and an N, and the automated
tour could not complete three roads from a standing start. The junction is
at (18, 8) now, on the forecourt south of the name.

**Roads pass landmarks rather than through them.** A probe casting against
fixed geometry down every carriageway found forty-five obstructions — most
of them district centrepieces, because the polylines were authored to reach
district CENTRES and a centrepiece is at the centre. Interior vertices are
nudged off solid footprints with junctions pinned; where the junction was
itself the problem, the landmark moved.

The worst of them was invisible to the registry entirely: the LABYRINTH.
Seven by five cells of 9.4 m corridor is 75 by 54 m of solid static
geometry, its south-east corner stood past the coastline, and the ring
road's whole north-east leg ran through the middle of it — because the
registry knew only about the district's 24 m plate. The maze is 5 x 3 now,
it declares its real extent, and the ring goes round it.

Six obstructions remain and only one is over 1.6 m: at a junction where two
road corridors overlap. The rest are knee-high furniture the car shoves.

**The circuit is no longer a dead end.** It hung off `circuit-link`, an
84 m spur — you reached the largest feature on the island by driving one
road and left by driving the same road backwards. `north-link` closes the
loop across the top, over the river on the wood bridge and into the chess
terminal.

**And there is a shortcut.** `lake-shortcut` runs forty metres of deck
straight across Mirror Lake between UCL and the spine, saving most of the
eastern ring. Nothing signposts it.

## The route

    hub → ring-north → ORBIT → EXCHANGE → AI LAB → TUNNEL
        → ring-east → LABYRINTH → UCL → SEED CHUNKS → CLIENT CITY → KEYFRAMES
        → ring-south → PROJECT ARCHIVE → ALGORITHM FIELD
        → ring-west → DEBUG YARD → hub

with the spine cutting north–south (FOCUS, GYM, ARCHIVE), a branch to KCL
and the CHESS TERMINAL, and two links out to the circuit and back.

---

## Water

Every waterline was a cliff, in two different ways.

Inland of the coast the ground was lifted 3.2 m by a rim term; one metre
outside it dropped to −0.5 by a separate formula that knew nothing about the
rim. At every bearing the beach was a 3.7 m step, and at the north-west
highland it was fifteen. Separately, `inlandWater` stopped answering about
two metres past a lake's mapped edge while the bank was blended over three
and a half, so every lake shore was truncated a third of the way down and
wore a ring cliff up to 5.7 m.

There is one continuous shore profile now: a dune that rises inland and
falls back to nothing before the sand, then dry sand, the waterline, a
fifteen-metre shelf 0.6 m under the surface, and only then the drop-off.
Lake reach and bank width are the same number; the depth curve is raised to
a power so the first few metres are ankle-deep; each lake eases the ground
around it into a hollow. The river is 1.6 m deep instead of 2.6, which
makes it fordable, and the drowning threshold moved from 0.45 m under for
1.2 s to 1.1 m for 2 s — it used to fire in water the car could plainly
drive out of. Water drag comes on over the first metre instead of snapping
to full the instant the origin crossed the line.

Beaches are painted as sand, out past the waterline. They used to render in
the off-map backdrop colour, so the beach read as the edge of the texture.

**Bridges are crossings.** All three stood in open country — the nearest
tarmac to any of them was 26–31 m, including the one typed `kind: 'road'` —
hard-locked to the world X axis with no rotation field, and the modern one
spanned a lake no road went near while its approach pads punched two sheer
2.93 m plateaus into the middle of it. Each is now on a road, at the point
where that road meets the water, built along the road's own tangent.

    node scripts/world-shore-check.mjs <url>   # 23 transects, all passing
    node scripts/world-water-drive.mjs <url>   # in and out of all of it

---

## Daylight only

The clock still runs, and weather, the sky dome, the secrets and the
headlights still read it — but it ping-pongs between phase 0.38 and 0.62,
which is late morning to early afternoon and nothing else. A full sweep out
and back takes ten minutes, so the light still moves at a pace you notice
over a visit and never once gets dark.

Three things depended on darkness and would have become unreachable:

- **NIGHT SHIFT** is **STORM SHIFT**, awarded for driving through rain.
- **The dev-room terminal** appears in rain rather than at night.
- **The TIME MACHINE** sweeps the sun from one end of the daylight range to
  the other instead of jumping the clock forward through dusk.

Shadows do more work now that the sun is always up: soft PCF instead of
hard, a shadow box sized to the texel budget (2048 over 58 m is 3.5 cm a
texel, which holds a kerb edge), a tighter far plane because the sun never
takes the dusk slant, and normalBias rather than a flat depth bias — acne
was showing on the long shallow slopes of the coast.

---

## Grass

Four separate faults, all visible from the driving camera.

**It was stretching, not bending.** A blade's tip was pushed sideways by a
fixed multiple of its own height and only dropped a little, so a 0.9 m tuft
became 2.2 m of spike and a parked car sat in a starburst of them. Plants
now ROTATE ABOUT THEIR ROOT: a vertex h above the root lands at
(h·sinθ, h·cosθ), which is the same h from the root that it started at. The
height is measured in world metres and converted back through the
instance's own scale, because these instances are scaled anisotropically —
rotating in local space and letting the instance matrix stretch the result
afterwards is the same bug one level down. The normal turns with the
geometry, which is what stops flattened grass reading as a scorch mark.

**Bushes lean, and grass does not lean like a bush.** A bush pivots about
its base rather than its centre, compresses slightly as it goes over, and
its leaves shake; grass hinges from the ground.

**The generation ring.** Foliage chunks switched on and off at fixed
distances measured to the CENTRE of a 64 m chunk, so the boundary between
drawn and not-drawn swept around the car as a visible circle. Instances now
shrink away over a band well inside the cull distance, and the cull is
measured to the chunk's nearest edge, updated three times as often. By the
time a chunk switches off, everything in it is already invisible.

**The field's own corner was in frame.** The GPU grass was one 72 m square
following a camera that stands off up to 39 m on a 25° lens. It is two
nested toroidal rings now — dense and fine to 31 m, sparse and coarse with
blades 2.35× the size out to 92 — each fading out radially, so there is no
boundary between them or at the outside. Nothing is allocated, streamed or
respawned, which is the property worth keeping from the original: the rings
are a clipmap, not a stream, so there is no popping to hide rather than
popping hidden well.

Verified at 2560 × 1080 — the widest aspect, which pushes the camera boom
out furthest — at maximum zoom-out on open ground, forest and coast.

**Exclusion.** The baked mask covered roads and district plates but not the
RACE CIRCUIT, so grass grew down the racing line: the terrain flattened a
corridor for it and the ecology kept its scatter off it, but the dense field
— the one you actually see — had never been told the track was there.

---

## Roads

Painted in `palette.concrete` (#cfcbc2), which is lighter than the grass
either side. From the driving camera the network did not read at all.

Now: a compacted-dirt shoulder, tarmac, coarse aggregate so it is not a flat
fill under a directional light, two polished wheel tracks (a road is lighter
where it is driven, not darker), bone edge lines and a centre dash. The
shoulder is laid before the district plates, so a lane crossing a paved
forecourt does not carry a gravel verge over it. The dirt run out to the
stunt ramp stays unsurfaced — a lane-marked highway to a jump would be a
worse joke than no road at all.

District plates are a warm concrete rather than near-white paper, which is
what they had to become once the roads stopped being nearly white.

---

## The circuit

**Was** a 780 m four-lane serpentine. It read as a slalom; two of its lanes
merged into a single slab of tarmac in the north-west; the start/finish line
sat on a 0.8 m-radius cusp where the closed spline turned back on itself, so
a lap began mid-hairpin; and it had no painted surface at all — the terrain
flattened a corridor and the checkered flag stood at one end of it, but the
racing line was the same yellow-green as the field around it.

**Is** 546 m with 25 corners between 5 m and 112 m of radius: a 55 m
start/finish straight beside the link road, a long fast right onto the west
side, an 80 m fast run, a hairpin at the north end, a descent, an esses
section into a technical infield, and an east straight with the jump on it.
Gradients are authored, because the island's west side is level and a flat
circuit has no character — a crest before the esses so the fast descent runs
downhill into the slowest corner.

The jump is 2.1 m over 13 m, about nine degrees: a car at racing speed
clears it without being flipped and a car arriving slowly drives over it.
It is signposted from both sides, because a jump you cannot see coming is a
crash.

Surface, kerbs, gravel run-off and a racing line are painted into the
ground; barriers have colliders that match what you can see; the two dead
guard clauses in the trackside builder are gone — one tested a coordinate
from a world twice this size and had excluded nothing, anywhere, since the
island was rescaled.

**Timing and results.** MM:SS:MMM, started on GO and stopped at the finish,
correct across pause, restart and respawn. Checkpoint detection is a swept
plane rather than a radius, so it survives any speed. The leaderboard keeps
ten times with the date each was set, and survives the save version bump
that added it — `coerce` used to discard the entire blob on any version
mismatch, so adding a field would have wiped every visitor's progress. The
end screen sets the TIME large rather than the word FINISH, flags a new
personal best, and offers restart, the board and exit.

The lap count was stated three different ways and one of them was wrong; so
was the SPEED DEMON hint, which named a time nobody could set for a two-lap
race.

    node scripts/world-race-drive.mjs <url>   # slow, normal and boost laps

---

## Bowling

A blocker where stale hard-coded venue coordinates made the game
auto-complete without the ball ever moving. Pins that were not a standard
ten-pin triangle and were badly under-scaled against their own lane and
ball. No gutters, no pin deck, no pit, no backstop, and rails outside the
playing surface. A pin-down test that was tilt-only, so a pin knocked clean
off the deck while upright counted as standing. And no score model: one
frame, no running total, and a "best time", which is not a thing bowling
has.

It now has a lane with gutters, a deck and a backstop; lathe-built pins with
a neck stripe rather than cylinders; a correct triangle at 2.12 m spacing
with nothing overlapping; a physical scoreboard showing PINS DOWN n / 10;
strike detection; and per-frame scoring with running totals.

---

## Interaction

Seven ten-metre billboards stood in the landscape on solid posts, carrying
the portfolio's text as physical signage you could crash into — plus a
nine-metre ID card and a thirteen-metre cipher wall, both solid from the
ground up, both beside roads.

The billboards are lecterns now: waist-high, angled, with no collider at
all. The cipher wall is three panels with two drivable gaps. The ID card's
face is pass-through and only its plinth is solid.

The information moved to a small contextual popup at the landmark — the
NAME set large, one line saying what kind of thing it is, then the key and
the verb:

    ┌──────────────────────────┐
    │ CHESS ASSISTANT          │
    │ CAMERA → CNN → FEN →     │
    │ STOCKFISH                │
    │ ─────────────────────    │
    │ [ENTER]  Play            │
    └──────────────────────────┘

It used to be the other way round — the verb in large type with the name
beneath — so every landmark on the island introduced itself as "READ". The
card flips below its anchor near the top of the frame instead of being
clipped, and it is never a collider.

The prompt also stopped being rebuilt sixty times a second: it allocated a
fresh object and pushed it into the React store every frame it was on
screen. Selection now scores by how far inside a trigger you are, with a
handicap for whatever is already showing, so overlapping points stop
flickering. District notices replace each other instead of stacking — you
can only be in one district, and driving through three in ten seconds used
to leave three "you have arrived" cards on screen, two about places you had
already left.

**The name** is 3.9 m instead of 5.2 — 75%, as asked — and its size lives
in the manifest rather than in four unrelated literals, one of which was
the collider half-extents. It is still sixteen movable letters and still
the largest thing at the hub.

---

## Correctness found along the way

- **The world did not build the same way twice.** `World.ts` and
  `Landmarks.ts` each held a module-level seeded RNG, which keeps its
  position across mounts — so the second time /world was built in a tab
  every scattered prop and landmark detail came out somewhere else.
- **`Physics.waterElevation` was a second copy of OCEAN_LEVEL** sitting in
  the middle of the physics step, with a comment claiming the world set it
  at boot. Nothing did.
- **`Respawns.validate()` had never moved a point in its life.** It was
  handed a terrain-only raycast as its "is there a structure here" probe,
  so it compared the heightfield with itself; before that it ran before
  anything had stepped, so every ray returned null and it logged "no clear
  ground within 56 m" for all twenty-two points on every load. Working, it
  found three points inside structures — all three corrected in the data.
- **Every respawn took its height from a literal `y = 4`**, whatever the
  terrain underneath.
- **The Labyrinth took the world down on boot** by calling through
  `game.playground`, which is built after the mini-games.

---

## Vehicle physics

Unchanged. `PhysicsVehicle.ts`, `Player.ts` and `View.ts` are untouched by
this pass. The only physics edits are environmental: graded water drag
instead of a step, `waterElevation` reduced to one constant, and a
fixed-body-only obstacle raycast added for the respawn audit.

---

## The state at the end of the pass

| check | result |
|---|---|
| `npm run world:layout` | 186 footprints, 0 respawn problems |
| `npm run world:clearance` | 1 obstruction over 1.6 m in ~1 km of road |
| `npm run world:shore` | 23 transects, 0 failing |
| `npm run world:water` | in and out of the beach, all three lakes and the river; the open sea recovers the car |
| `npm run world:grass` | rings cross, far ring wraps, grass reaches 92 m against 29 m of visible ground |
| `npm run world:minigames` | 15 of 15 through play / exit / replay / leave / replay |
| `npm run world:loop` | 8 of 11 roads covered; the whole ring at 96–99% |
| `scripts/world-race-drive.mjs` | both paces finish, never more than 4.1 m off the racing line, leaderboard survives a reload |
| `npm run lint`, `npm run typecheck`, `npm run build` | clean |

---

## Remaining limitations

- **`world-layout-check.mjs` still reports about sixty-six conflicts.**
  Most are a road passing close to a district's centrepiece; its threshold
  (footprint + half the carriageway + 1.4 m) is deliberately conservative,
  and the measured obstruction probe — which casts against real colliders —
  is down to five, all trackside furniture.
- **The automated tour does not cover every road.** It is a look-ahead
  autopilot, not a driver, and it loses the line at the tight junctions
  where four roads meet. `world-road-clearance.mjs` is the objective half
  of that pair — it asks Rapier what is standing in each carriageway, and
  reports one thing over 1.6 m across the whole network. Where the two
  disagree, believe the clearance probe.
- **The `network` district contains none of its own landmarks.** Its two
  nodes are the ends of a tunnel and are meant to be far apart; the
  district disc does not describe that, and this pass did not change it.
- **Audio is verified from the code path, not by listening.**
- **The map viewport spans ±164 m** and the void island is at z = −233, so
  it is off the map. That is the secret working as intended, but it does
  mean the map is not the whole world.
