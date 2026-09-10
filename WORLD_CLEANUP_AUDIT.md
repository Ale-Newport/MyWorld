# World cleanup audit

**Status: audit complete, nothing fixed yet.** This document is the survey that the
cleanup pass is aimed at. Every number in it was measured against the running world
at `/world`, not read off the source and not estimated. Where a claim could not be
measured it says so.

---

## How this was measured

Three new harnesses were written for this pass, and all three are in `scripts/`:

| script | what it measures |
| --- | --- |
| `world-surface-audit.mjs` | cross-track relief on the circuit, cross-carriageway relief on every road, relief over every play-spot pad, terrain protrusion through every ramp deck, scatter standing on gameplay surfaces, props off their ground, and a scene census |
| `world-viewpoints.mjs` | sixteen fixed camera positions — the twelve the brief asks for plus a top-down and an oblique — so a change can be judged by looking |
| `_stage-blame.mjs` | given a coordinate, which of `heightAt`'s ordered stages claims that ground, and with what weight |

`world-surface-audit.mjs` takes `--assert` and becomes a gate: it exits 1 on any
failure **and on any coverage floor miss**. That second half matters more than the
first. Its own vegetation check shipped with a name filter that matched nothing and
printed `ok`, having examined zero instances — the exact failure mode
`scripts/_roads.mjs` was written to end. Three defects in these harnesses were found
and fixed before their numbers were trusted:

- the vegetation check examined **0** instances and reported a pass; it now examines
  8,499 and the gate fails if that count ever drops to zero;
- the ramp deck was sampled in the **wrong handedness** (`+la*sin` instead of
  `-la*sin`), so `ramp-landing` was measured on open ground beside the ramp; its
  reported 0.242 m protrusion was fiction, and the true figure is −0.01 m;
- the prop report **capped the list at 60 and printed the cap as the total**. The
  real figure is 950 of 8,289 examined.

---

## The verdict in one paragraph

The world is in better shape than it looks, and its problems are concentrated. The
mini-game venues themselves are largely excellent — the bowling deck is flat to
0.000 m across its whole 54 × 11.7 m rectangle, all ten pins sit at −0.001 m against
it, the labyrinth's pad is the only perfectly level surface on the island (0.02 m),
and `world-bowling-qa` passes 26/26 over three played sets. The shore profile is
good: all 39 transects pass with margin. There is no z-fighting between water planes,
and no duplicate terrain. What is wrong is almost entirely **one architectural fault
repeated in nine places**, plus four independent defects that were each invisible
because the thing that should have caught them was not looking.

---

## The architectural fault: `built` is written by thirteen stages and read by one

`Terrain.heightAt(x, z)` is a pure function composed of thirteen ordered blend
stages. Order is priority: a later stage overwrites an earlier one. As it runs it
accumulates a scalar called `built` — the running maximum of every flatten weight —
which means *"this ground is spoken for by something constructed"*.

**Exactly one of the six stages that run after it reads that scalar.** The shore
does. The lake aprons, the river apron, the water carve and the bridge approaches
all still win unconditionally over ground that a district plate, a road corridor, a
ramp pad or a venue pad has already claimed and levelled.

That single fact explains, in measured metres:

| symptom | metres | the stage that takes it back |
| --- | ---: | --- |
| `landing-projects` cross-carriageway camber | 4.03 | river apron (its **end-cap disc**, on dry land) |
| projects district plate relief | 4.50 | river apron end cap |
| `bowling-projects` camber | 3.66 | river apron end cap |
| `east-coast-road` camber | 3.46 | river apron end cap |
| TIME MACHINE venue out of level | 2.08 | lake-south-1 apron (2.38) + water carve (1.23) |
| `ramp-east` deck footprint cross-slope | 1.82 | river apron, inside the ramp's own pad |
| TNT pad out of level | 1.63 | lake-west-0 apron at full weight across the whole verge |
| `bridge-bowling-east` camber | 1.64 | river apron's sideways reach |
| `landing-bridge-social` camber | 1.46 | river apron's sideways reach |

The river apron alone accounts for six of the eleven failing carriageways. Its worst
behaviour is a geometric accident: both it and `inlandWater`'s river branch key on
`lineDistance(x, z, RIVER.points)`, which is the distance to a **capsule**, not to a
strip — so past the polyline's last vertex the apron becomes a **28.4 m disc of
"flatten to 0.80 m" centred on dry inland ground**, right on the hillside the
PROJECTS district stands on.

**This is the fix that closes the most defects for the least risk**, and it does not
require moving a single authored coordinate.

---

## The six things that were invisible

Each of these was missed because the check that should have caught it was not
actually looking at the thing it claimed to check.

1. **All ten PROJECTS set-dressing stands fail placement at boot.** 571 lines of
   `dressing/projects.ts` render nothing. `arrivalBearing` averages the unit vectors
   of every road whose id contains `projects`; those two roads are **112.3° apart**,
   so their mean points at neither of them — it points out over the river and the
   west coast. Every `at(along, across)` in the file is measured on an axis that runs
   into water. The district is the emptiest place on the island and the console says
   so on every boot: `[dressing] projects: 10 stand(s) found no free ground`.

2. **Thirteen of the sixteen name letters are not resting on the ground.** Waking
   them — which the first car contact does — drops the word by up to **2.29 m**.
   Nothing samples the ground under a letter; `at.y` is one scalar for all sixteen.

3. **The name stands in both carriageways out of the landing.** The O of ALEJANDRO
   is 1.11 m from the centreline of a 9 m road. `world-layout.ts:677` has a *blanket*
   `letters + road` exemption, unlike the `play + road` and `landmark + road` rules
   immediately above it which require the road only to **arrive** — so
   `validateLayout()` reports 0 conflicts on a word straddling two roads.

4. **13 props are falling through the world forever**, at y = −149 to −262 m and
   still descending at 20 m/s. `Decor` and `SceneryDetails` pass the terrain height
   as the rigid body's **origin**, not its base, so a crate spawns 0.52 m inside the
   heightfield and Rapier's penetration recovery ejects ~11% of them *downward*
   through a one-cell-thick heightfield. `World.scatterProps` already knew and
   compensates with a blind `+ 0.6`; the other two callers use `+ 0.03`.

5. **`vegetationSuppressed()` has no clause for the circuit, the roads or the
   bridges.** At (−43.4, −40.3) it returns `false` while the point is 4.69 m from the
   centreline of a 10 m track — 0.31 m inside the kerb.

6. **The labyrinth cannot be completed.** The weather lever's 2.4 × 1.8 m *static*
   plinth stands at (61.08, 47.38) — grid cell (1,8), in the west corridor, on the
   unique route to the centre. An autopilot driving the solution stops dead against it
   and never gets past waypoint 14 of 84 in 500 simulated seconds. Remove that one
   collider and the same autopilot drives the whole 83‑step route to the fountain in
   51.6 s. The maze grid itself is sound; an attraction was placed through it, because
   the maze registers with the layout registry as a 23.9 m **disc** inscribed in its
   47.8 m square (RC‑7), and the plinth landed in the corner that disc does not cover.

---

## The open decision: the lower-left circuit corner

This is the defect the brief calls out by name, and it is the one place where the
audit produced **two incompatible fixes**. It needs a decision before work starts.

**What is actually there.** The racing line runs outside the drawn coastline. Over
21 m of arc the *centreline* is out to sea (worst: coastInset −2.55 m at
(−110.6, 67.4)); the *outer kerb* reaches −7.7 m. Over 63 m of lap the racing surface
carries 0.49–2.93 m of cross-track relief. Placing the car there put it at
y = −1.02 with ground at −2.23: it is in the water. The shore stage is not
malfunctioning — its `built` valve, `smoothstep(inset, −2, 8)`, is ~90% open at
negative inset, and holding the track level there would build a **plateau standing in
the sea**, which is precisely what the valve exists to prevent.

**Fix A — move the coast.** Push three coast vertices in `scripts/mapcal/plan.json`
about 20 m seaward and re-emit. Measured requirement: the outer kerb needs
coastInset ≥ 12 for the valve to shut, so 19.5 m of new land at the apex tapering to
4.75 m. Nothing in `world-layout.ts` references the coast polygon, and
`validateRespawns` only asks for coastInset ≥ 6, which improves. Lap length, corner
radius and every zone are untouched.

**Fix B — move the racing line.** Push the line inland over the arc. Maximum shift
needed is 10.55 m.

**Fix B does not survive measurement.** I checked the room independently: the west
run has **0.22 m** of registry clearance to the TNT quarry, which itself has 0.81 m
to lake-west-0; and walking inland from the failing stations hits inland water at
10–21 m or the parallel lap leg at 25 m (which must stay ≥ 12.6 m away). There is
nowhere for the line to go.

**Recommendation: Fix A, held to the minimum.** It is the smaller change to what the
player experiences, and the only one the island has room for. It does alter the drawn
island outline, which is why it is flagged here as a decision rather than assumed —
see *Decisions for Alejandro* at the end.

Separately, and independently of that decision: **1.22 m of the west run's 1.50 m of
relief is not the shore at all** — it is the play-spot pad shoulder and the lake
aprons reaching across the track, and it can be removed by the stage-ordering fix
above **without touching a single coordinate**.

---

## What the survey found, in one table

| | count |
| --- | ---: |
| areas audited | 12 |
| findings | 120 |
| blockers | 16 |
| majors | 59 |
| root causes shared by two or more areas | 10 |
| pairs of proposed fixes that contradict each other | 10 |

Sixteen blockers across twelve areas sounds like a world in trouble. It is not:
**ten root causes account for most of the 120 findings**, and the two largest of
them are single edits to `Terrain.heightAt`.

---

## The ten root causes

**RC‑1 — one 28.4 m disc at (50, −34.7) is a blocker in four areas.**
`lineDistance` measures to a *capsule*, so past the river polyline's terminal vertex
both the apron and `inlandWater`'s river branch project a half‑disc of *"flatten to
0.80 m"* onto dry ground, after every stage that writes `built`. Four areas measured
this same disc and named four different causes. It is 4.03/3.66/3.46 m of camber on
three roads, 4.50 m out of the projects plate, the projects respawn sitting 5.72 m
below the terminal, and — measured at ramp‑east's toe, 20.5 m past the last vertex —
the ramp defect too. **One end‑fade closes all of it.** This is the single
highest‑value change in the pass.

**RC‑2 — `built` is written by seven stages and read by one.** Described above. The
fix is three parts that must ship *together*: reorder the play‑spot pads above the
aprons, give every landscape stage the shore's valve, and split the pad claim into
core and shoulder so only the shoulder is weakened. Shipping the valve alone
*regresses* TNT from 1.63 m to 4.22 m.

**RC‑3 — a normalised ellipse radius used as a distance in metres.** A "13 m" apron
is 30.2 m on lake‑west‑0 and 42.0 m on lake‑west‑2. Never ship alone: today's
over‑long apron is accidentally holding the TNT verge flat.

**RC‑4 — a field sampled at one point, then applied to an object that spans metres.**
Two shapes. *(a)* a blend factor evaluated at the sample point instead of on the
owning centreline — the ramp pad, the circuit's road crossing, the bridge's `dry`
term (which varies 0.20→0.77 across a deck the river crosses at 67°, and is both the
0.49 m step and the 1.13 m corner). *(b)* one terrain sample placing extended
geometry — sixteen letters hung off one `origin.y`, district rings with 5.87 m of
spread, ten of twenty marker rings dipping underground, `buildRamps` sampling the
foot a metre inside the footprint.

**RC‑5 — the circuit's north‑west arc is outside the island.** Three areas measured
the same 55–65 m of lap from three angles. See the decision below.

**RC‑6 — there is no shared answer to "may this sit here, and at what height".**
Five scatter systems, four oracles, two consulting none. `World.scatterProps` has no
water test and no coast test; `SceneryDetails`' 1,800 reeds call nothing. The
*vertical* half has no home at all, which is why 13 props are falling forever.

**RC‑7 — a square pad degenerates to the disc inscribed in it.** `zones()` computes
`hx = (length/2 − width/2)·cos`, identically zero when length equals width, so the
labyrinth's 47.8 m square registers as a 23.9 m disc — 490 m² of unreserved corner,
six props inside the maze walls, and the largest structure on the island drawn as a
single point in the debug view.

**RC‑8 — constants baked from an abandoned size, and prose that outlived its
constants.** Letter collider half‑thickness is `5.2 × 0.16/2` on a 3.1 m letter.
`Labyrinth.ts`'s prose describes 5.2 m corridors it has not had for two passes.

**RC‑9 — the instruments cannot fail, and two measure the wrong frame.** Fixed
during this audit; see the top of this document.

**RC‑10 — five proposals edit a generated file.** `world-map.ts` is emitted by
`scripts/mapcal/emit-ts.mjs`. Any change to it must go through `plan.json` and a
re‑emit in the same commit, or the next emitter run reverts it.

---

## The ten conflicts, and who wins

Ten pairs of proposed fixes contradict each other. Left unreconciled, whoever ships
second silently reverts the first — the bridge `dry` term had two different
replacement expressions proposed for the same line.

| # | conflict | resolution |
| --- | --- | --- |
| C‑1 | move the coast **vs** move the racing line | **the coast**, if an exception is granted — see below |
| C‑2 | three incompatible valves on the lake apron | `built`, damped past the first 4 m of bank, **after** the TNT pad moves |
| C‑3 | three incompatible gates on the pad shoulder | core/shoulder split; subsumes the other two |
| C‑4 | three incompatible gates on the river apron | symmetric end fade; both ends are inland, so there is no "mouth" to preserve |
| C‑5 | time machine moves east **vs** maze grows west, into the same ground | neither: shrink `flat` to 6 and leave the maze square this pass |
| C‑6 | four different numbers for "how far above the ground" | two rules: 0.25 m for rigid slabs, conforming ribbons exempt |
| C‑7 | move ramp‑east west **vs** fix it in place | shorten the shoal instead; moving it west moves it *toward* the river cap |
| C‑8 | the proposed prop gate can never go green | 992 of 1,016 "floating" are canopies and flags; gate against the prop registry only |
| C‑9 | widen the projects plate **vs** measure it after RC‑1 | re‑measure first; the 5.39 m of relief is the disc |
| C‑10 | extract 420 lines of `heightAt` **vs** edit those exact lines | do it first as a pure move, or not this pass |

---

## Order of work

Nothing that stands on the ground can be judged until the ground stops moving.

- **Phase 0 — instruments.** Done during the audit: handedness, exit code, coverage
  floors, uncensored prop count. Still to do: name the 84 instanced meshes, add the
  bowling frustum assertion, add `world:gate`. **Decide C‑1 here.**
- **Phase 1 — terrain height.** RC‑1's end fade → reorder the pads → move the TNT
  pad and settle the time machine → the `built` valve and the core/shoulder split →
  metric apron reach → centreline sampling → shoal length.
- **Phase 2 — everything that reads terrain height.** Ramp foot from the toe edge,
  ramp‑landing's 8 m move, the letters seated per‑letter, conforming decals,
  bowling clearance, prop seat heights.
- **Phase 3 — layout and registry.** Rect footprints, the single placement oracle,
  the maze plinth, restart/exit, the projects arrival bearing and terminal rotation.
- **Phase 4 — render and paint.** Water beds → road strokes → the precision‑safe
  hash → sand → shadows → the bowling board reframe.

---

## Coverage gaps the twelve audits left, and what they measure

A completeness critic ran the missing measurements rather than asserting the gaps.

- **BLACK HOLE had zero coverage** — the string appears in none of the twelve
  reports. It is the only district with no `plate`, and it carries **3.40 m of relief
  across its core**, a 31.2° approach face (against the car's 34° climbing limit) and
  **14.4% of its dressing underground** — 651 of 4,526 vertices, worst 1.95 m.
- **ACHIEVEMENTS had zero coverage.** 0.114 m of core relief, 60 buried vertices.
  Small — but nobody produced the numbers, and `world-achievement-checks.mjs` exists
  and was never run.
- **SOCIAL had zero coverage, and it is the cleanest district on the island**
  (0.016 m, nothing buried). That is *why* its absence matters: SOCIAL is the control
  that proves the plate stage works when nothing overwrites it.
- **TIME MACHINE is covered by two flatten stages, and only one was scored.** It has
  both a district `plate: 7` and a venue `flat: 11`. Every relocation proposed for it
  was measured against one of the two.
- **TNT's pad was audited three times and the place not once.** The venue core
  carries 1.53 m of relief and 210 buried dressing vertices. **`TntDomino.ts` was not
  audited by anyone.**
- **Restart and exit were audited for one game out of four**, and the maze's
  framework bug was framed as a maze bug. Measured across all four:

  | game | restart returns you? | exit returns you? |
  | --- | --- | --- |
  | circuit | yes | **no** — leaves you on the grid |
  | bowling | yes | **no** — leaves you in the lane |
  | labyrinth | **no** | **no** |
  | domino | **no** | **no** |

  Two behaviours, four games, no rule. Worse: `minigames.start()` returns **true with
  the car 130 m from the venue** — there is no proximity precondition anywhere, and
  `world-minigame-qa.mjs` teleports the car to the venue first, so the suite
  structurally cannot see it.
- **Physics state after teleport was never checked.** `moveTo` zeroes linear
  velocity, angular velocity and the stuck and flip state, but never `airborneSince`.
  So teleporting the car mid‑fall fires `land` carrying 1.2 s of stale airtime: a
  camera kick, a dust burst, a full‑volume landing sound, and it **grants the
  `takeoff` achievement**. One line.
- **Audio cleanup is inapplicable, and that is worth writing down.** There is no
  positional audio in this engine at all — no `PositionalAudio`, no `PannerNode`, and
  every one‑shot disconnects on `onended`. There is no leaked‑emitter failure mode.
  The real defect is stale amplitude: a bird call plays at full volume regardless of
  where the listener is. Recorded here so the next pass does not spend a day looking
  for panners.

---

## Decisions for Alejandro

**1. The circuit's north‑west arc — the corner you reported. This needs your call.**

The racing line runs outside the drawn coastline. Neither fix is free:

- **Move the coast** (~20 m seaward at the apex, tapering to ~5 m). Fixes it
  completely. Lap length, corner radius and every zone are untouched. **But it
  redraws the island outline**, which is the thing the previous pass existed to be
  faithful to, and it moves the beach, the painted shore bands and every consumer of
  `coastInset`. This is the largest single change proposed anywhere in the audit.
- **Move the racing line** — rejected on measurement. There is **1.00 m** of inland
  budget at the pinch against the 10.55 m required.
- **Do neither.** The stage reordering still takes the west run from 1.50 m to
  ~0.28 m *for free*, and the corner keeps its 2.93 m as documented, accepted
  behaviour of a stage that every area agrees is doing the right thing.

My recommendation is **move the coast, held to the minimum that shuts the valve** —
it is the only option that actually fixes what you saw. But it edits the drawing, so
I am not doing it without you saying so.

**2. The labyrinth's corridor width — I recommend deferring the widening.**

You asked for significantly wider corridors, and the measurement supports you: a
4.6 m corridor allows a no‑reverse 90° turn only below 6.2 m/s against a natural
cruise of 6.7 m/s. But widening means `CORRIDOR` 4.6→5.5 and `WALL` 1.2→0.8, which
grows the square 3.1 m against **3.0 m** of measured clearance, and forces a
coordinated edit to the generated `ZONES.maze.size`, the layout registry and the
maze centre — a rebuild of the largest structure on the island.

Meanwhile **the maze's actual blocker is not the width**: a static plinth from the
weather‑lever attraction stands in the only route to the centre, and an autopilot
driving the solution stops dead against it. Remove that one collider and the same
autopilot completes the 83‑step route in 51.6 s. I would fix the blocker, the
restart/exit teleports and the respawn‑inside‑the‑maze this pass, and take the
widening as its own change with its own measurements.

Tell me if you would rather have the widening now and I will do it properly.

---

## Findings by area

Every row below is measured unless its confidence says otherwise. `STATUS` is `open`
for all of them — nothing has been fixed yet.

### TERRAIN

> `heightAt` is not broken as a function — it is broken as an *ordering*. Thirteen ordered blend stages compute a running `built` scalar, and exactly one of the six stages that follow it (the shore) reads it; the lake aprons, the river apron, the water carve and the bridge approaches all still win unconditionally over every gameplay floor. Every measured failure traces to one of three specific stages, and I proved each by instrumenting the stages in isolation: the play-spot pads are eaten by the LAKE APRONS (tnt 1.628 m, timeMachine 2.075 m) and the RIVER APRON (bowling 0.613 m); the circuit's 2.92 m is the SHORE, and it is the shore because 17 of 480 racing-line stations sit 0.6-2.6 m *outside* the coastline, where the shore's safety valve is deliberately at full strength. Separately I found a larger defect nobody has measured: the river apron and carve are round-capped at the…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The river's apron and carve are round-capped at the polyline's ends, projecting a 28.4 m disc of "flatten to RIVER.level + 1.5 = 0.80 m" into dry inland ground. It takes 4.499 m out of the PROJECTS district plate and puts 4.046 m / 3.664 m / 3.470 m of… | physics | src/world/world/Terrain.ts:928-936 (river apron) and src/content/world-environment.ts:630-644 (`inlandWater` river branch) both key on `lineDistance(x, z, RIVER.points)`, which is a distance to a… | In Terrain.ts, multiply the river apron's `inside` and the river branch of the water carve's `bank` by a span factor that fades to zero past the drawn ends, measured along the polyline's own end tangents: `spanFactor = (1 -… | open |
| 2 | **BLOCKER** — The circuit's 2.925 m cross-track relief at (-105, 71) is THE SHORE, and it is unavoidable there because the racing line itself runs outside the coastline: coastInset at that station is -2.3 m, and -2.6 m at the worst station (-110.6, 67.4). | gameplay | Not a bug in Terrain.ts. `RACE_LINE` in src/content/world-map.ts puts the sweeper's outer edge past the traced coastline between arc 280 m and 373 m. The shore stage (Terrain.ts:836-841) is doing… | Move the racing line inland, in src/content/world-map.ts's RACE_LINE, over the arc 280-373 m. Measured requirement: the largest inward normal shift needed to bring every station to coastInset >= 8 m (where `built` fully suppresses the… | open |
| 3 | major — The TIME MACHINE venue is 2.075 m out of level because its 8.8 m core overlaps lake-south-1's water and apron: the LAKE APRONS take 2.377 m out of it and the WATER CARVE a further 1.228 m. | gameplay | src/world/world/Terrain.ts:899-908 (lake aprons) and :938-955 (water carve) both run after the play-spot pads and neither reads `built`. The aprons' non-weakening is a documented, measured decision;… | Move the venue in src/content/world-map.ts's ZONES.timeMachine so its core clears lake-south-1's water reach, and shrink `flat` in PLAY_SPOTS to match. Measured under today's ordering: (52,62) flat 11 -> 1.032 m, (56,62) flat 11 -> 0.771… | open |
| 4 | major — The TNT pad is 1.628 m out of level, and lake-west-0's APRON — not its water — is the reason: the apron holds weight 1.00 across the entire 21 m verge between the racing line and the lake, and does not drop below 0.5 until x = -117, which is on the racing… | gameplay | src/world/world/Terrain.ts:899-908. The apron reach is authored as `13 / Math.min(lake.rx, lake.rz)` in NORMALISED ellipse units; for lake-west-0 (rx 13.8, rz 9.6) that is 30.2 m past the mapped… | Two changes together, both measured. (1) Move the play-spot pad stage to run AFTER the lake and river aprons and BEFORE the water carve. (2) Move the TNT pad west and narrow it so its core clears the water's 8 m reach (which ends at x =… | open |
| 5 | major — `built` — the running maximum of every flatten weight, and the only mechanism the file has for "this ground is spoken for" — is read by exactly one of the six stages that run after it. | physics | src/world/world/Terrain.ts:836-841 is the only place `built` appears on the right-hand side. The scalar is computed correctly by every stage above it (:625, :641, :678, :707, :716, :757, :768) and… | Give every landscape stage the same shape of valve the shore already has, expressed in TRUE metres from the feature that stage exists to protect, and leave the water carve alone. Concretely, after the built stages compute `built` and… | open |
| 6 | major — The road-proof ramp pad is re-asserted at the sample point instead of at the road centreline, so it puts a 2.078 m cross-carriageway camber into `landing-projects` — a road that merely passes through ramp-east's 16 m pad shoulder and is not the road that… | physics | src/world/world/Terrain.ts:762-770. Stage 4 already does this right — it samples `rampPadAt(near.px, near.pz)` on the road's own centreline, so the corridor climbs the pad while staying level… | Track the strongest road corridor weight and its centreline point during stage 4 (`bestRoad = { on, px, pz }`), then in stage 5 blend the pad claim toward the centreline-sampled pad by that weight: `pad = mix(rampPadAt(x,z,LIST),… | open |
| 7 | minor — The bowling deck's 0.613 m is the RIVER APRON reaching 24 m from the river polyline into the venue's south-east core corner. | gameplay | src/world/world/Terrain.ts:928-936. The river apron's 28.4 m reach from a 12.8 m river is more than twice the river's own width, and it flattens to an absolute 0.80 m rather than easing toward the… | Covered by the priority reordering: with the play-spot pad stage moved after the aprons, the bowling pad measures 0.000 m relief (from 0.613). No pad move is needed — bowling's core is nowhere near mapped water, so the carve never touches… | open |
| 8 | minor — Lake apron and bank reach are authored as metres but applied as normalised ellipse radii, so a "13 m" apron is 42.0 m on lake-west-2 and a "BANK_WIDTH = 8" bank is 16.0 m on the same lake. | physics | src/world/world/Terrain.ts:901-904 and the identical formula in src/content/world-environment.ts:622. This is the same error the LAKE APRONS comment already identifies in its rejected option (b) —… | Derive a true outward distance from the ellipse: `rdir = hypot(x - lake.x, z - lake.z) / normalised` is the metres from the centre to the mapped edge along this ray, so `outward = (normalised - 1) * rdir` is metres past the edge, and the… | open |
| 9 | minor — Each end of the river has a dry trench: the bed is carved 0.62 m below RIVER.level for about 13 m past the last drawn point, where the water surface mesh has already stopped. | visual | Same root as the first finding: `lineDistance`'s capsule semantics in `inlandWater` (world-environment.ts:630-644) carve a half-disc of full-depth bed past each terminus, while the visible surface… | The carve end fade proposed in the first finding (carveEndFade 6 m) closes this: it lifts the ground at 4 m past the end from -0.73 to +0.53 and at 6 m from -0.70 to +2.62, so the bed meets the natural ground where the water mesh stops.… | open |
| 10 | minor — There is no stated clearance rule for anything laid on the ground, and the drawn terrain mesh stands up to 0.234 m ABOVE the collider it is generated from at low quality. | visual | src/world/world/Terrain.ts:1204-1215 draws the visible plane at 384/200/128 segments by quality and samples `colliderHeightAt` at its lattice, so between lattice points the drawn surface is a flat… | Adopt 0.25 m as the standard gameplay-surface clearance and put it in Terrain.ts as an exported constant next to `surfaceHeightAt` — `SURFACE_CLEARANCE = 0.25`. Derivation: 0.234 m is the worst case the drawn ground rises above the… | open |

METHOD. I re-implemented `heightAt` verbatim in node (importing the real content tables through scripts/_ts-loader.mjs) with per-stage instrumentation and per-stage disable flags: /tmp/claude-501/audit-heightfn/stages.mjs. It reproduces the live `colliderHeightAt` to within 0.013 m at all nine coordinates the surface audit reported, so every attribution below is arithmetic, not inference. Probes probe1..probe20.mjs in the same directory. No file under src/ or scripts/ was touched. === 1. THE STAGES OF heightAt, IN ORDER === Format: stage — flattens to — shoulder — feeds `built`? — what can undo it (measured worst \|delta\| and area, island-wide scan of 24,827 cells). 0. BASE…


### RACE CIRCUIT

> The 207 failing stations are not one defect but four, in seven contiguous stretches, and only one of them is the shore. 63 m of lap (sta 238-286) really is broken: the centreline crosses the drawn coastline at (-110.6, 67.4) and runs up to 2.6 m out to sea for 21 m of arc, so the shore stage correctly turns the racing surface into a 27° beach face — the outer kerb at the apex stands at -2.44 m, 0.06 m above sea level, while the inner kerb is at +0.49. The other three causes are all "a later flatten stage overwrites the circuit corridor": the TNT quarry's pad shoulder puts a 1.22 m ridge down the middle of the west run (sta 193-237), lake-west-0's and lake-south's aprons lift the pit straight and the sweeper 0.14-0.88 m off CIRCUIT_LEVEL, and the lake bank carve reaches the kerb at (-55.6, 42) and (8, 38). The jump, the spline-vs-corridor alignment and the good sections all measured…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The lower-left corner is drawn on the beach: over 63 m of lap (sta 238-286, m 314-377) the racing surface carries 0.49-2.93 m of cross-track relief, worst 2.925 m at centre (-105, 71) where the outer kerb sits at -2.44 m and the inner at +0.49. The… | visual | src/world/world/Terrain.ts:826-830. `const onShore = smoothstep(over, -BEACH.sand-12, -BEACH.sand+4) * (1 - built * smoothstep(inset, -2, 8))`. With BEACH.sand=15 the shore stage begins 27 m inland… | Move the COAST, not the line. In scripts/mapcal/plan.json push the three coast vertices that bound this arc — world (-114.9,59.9), (-106.4,67.8), (-94.2,73.8), plus one neighbour either side to keep the curve fair — about 20 m seaward,… | open |
| 2 | major — The west run is not flat and it is not the shore: a 1.22 m ridge runs down the middle of it. Stations 193-237 (m 255-313, 58 m of arc, from (-117.7,-9.2) to (-116.1,48.8)) carry 0.06-1.50 m of cross-track relief; the centreline peaks at 1.835 m at (-117.8,… | physics | src/world/world/Terrain.ts:751-782 — the play-spot pad stage runs AFTER the circuit corridor and wins over it, and its shoulder fades over 18 m beyond a rectangle that is only 12 m wide. So a 24x12… | Give the circuit's own corridor weight a name (it is already computed as `on` at Terrain.ts:660) and carry it forward as a separate `roadbed` scalar alongside `built`. Then weaken the play-spot pad shoulder — and the lake aprons below it… | open |
| 3 | major — The west run cannot be moved inland at all: the circuit's footprint has 0.22 m of clearance to the TNT quarry's, and the quarry has 0.81 m to lake-west-0. To put the outer kerb at coastInset >= 12 the centreline needs to move 8.75-11.75 m east over sta… | gameplay | Geometric, not a code defect: src/content/world-map.ts ISLAND, LAKE_WEST[0] and src/content/world-environment.ts PLAY_SPOTS 'tnt' between them consume the whole west shelf. Both are generated from… | Do not move the racing line here. Fix the west run entirely in the terrain stage order (the roadbed exclusion corridor in the TNT finding), which removes 1.22 m of the 1.50 m relief without touching a single coordinate. The residual 0.28… | open |
| 4 | major — Lake aprons reach the racing surface across three separate stretches — 88 stations in total — because the apron is keyed on NORMALISED ellipse radius, not distance. On lake-west-0 (13.8 x 9.6) the apron limit n = 1 + (8+13)/9.6 = 3.187 becomes 44 m from… | visual | src/world/world/Terrain.ts:897-906. `const scale = Math.min(lake.rx, lake.rz); const reach = 1 + BANK_WIDTH/scale; const apron = reach + 13/scale` — a normalised radius is not a distance on an… | Two changes in the same block. (a) Key the apron on true distance to the ellipse rather than normalised radius: iterate the closest point on the ellipse (or use the polygon-edge helper already in world-map.ts) so the apron is BANK_WIDTH +… | open |
| 5 | major — The lake bank CARVE — not the apron — cuts into the racing surface in two places, and this one cannot be fixed by any exclusion corridor. At (-55.6, 42) the outer kerb is 5.6 m from lake-west-2's mapped edge, inside BANK_WIDTH=8, and the surface falls to… | physics | src/world/world/Terrain.ts:940-965 — the water carve runs after everything and is deliberately not weakened by `built` (the river fords depend on that). BANK_WIDTH is 8 m, so any water whose mapped… | This is the one place where the Terrain comment's advice is right, but it names the wrong file (see the next finding). Shrink lake-west-2, not the racing line: LAKE_WEST[2] is {x:-79.3, z:39.9, rx:12.8, rz:6.4} in… | open |
| 6 | minor — The bowling-west-spur road corridor climbs off the racing surface 3 m inside the kerb, over 20 m of lap (sta 83-98, m 109-129), worst 0.30 m at (-47.3, -51.9). The ROADS_ON_CIRCUIT correction that is supposed to prevent exactly this only partially fires here. | physics | src/world/world/Terrain.ts:711-715. The correction reads `const track = closestOnPolyline(near.px, near.pz, CIRCUIT_TRACK)` — the distance is measured from the ROAD's projected centreline point, not… | Compute the track distance at the sample point: `const track = closestOnPolyline(x, z, CIRCUIT_TRACK)`. That makes the road take CIRCUIT_LEVEL wherever the sample is on the racing surface, independently of where the road's centreline… | open |
| 7 | minor — The source comment that this pass is being asked to act on names the wrong file. Terrain.ts says the fix "lives in `world-environment.ts`", but CIRCUIT.points is `RACE_LINE.map(...)` and RACE_LINE lives in src/content/world-map.ts, whose first line reads… | gameplay | The comment predates the mapcal pipeline, or was written against the older hand-authored CIRCUIT.points. | Correct the comment to point at scripts/mapcal/plan.json and note that emit-ts.mjs must be re-run. Do this as part of whichever geometry change the pass makes, so the next reader is not sent to a generated file. | open |
| 8 | minor — 19 of 28 nominal Armco slots are filled and the two longest unprotected stretches are 92.0 m and 68.7 m of lap. The 92 m gap (arc 334.7 -> 426.7) covers the whole exit of the lower-left corner, the jump, and the west half of the south run — the fastest part… | gameplay | src/world/minigames/CircuitRace.ts:309-311 and 324-355. `offset = CIRCUIT.width/2 + 5` = 10 m, and `trackFurnitureUsable` uses coastMargin 4, so a slot survives only where the centreline has… | Do not touch CircuitRace.ts. Fix the coastline clearance (the blocker) and re-run; the slots come back on their own because the mirroring at line 340 already recovers the infield side once either side is legal. Re-check the console line… | open |
| 9 | minor — All eight PIT / RESET cones are laid down lake-west-0's bank rather than on level ground: their ground heights run +0.18, +0.16, 0.00, -0.18, -0.28, -0.29, -0.21, -0.04, a 0.47 m fall over 16 m, and the lowest four stand 0.41-0.42 m above the lake surface,… | visual | src/world/minigames/CircuitRace.ts:444-449. The lane offset `CIRCUIT.width/2 + 8` = 13 m is checked against the layout registry per the comment, but the loop itself never calls… | Add the same ground test the rest of the furniture uses: for each cone, if `!this.trackFurnitureUsable(at.x, at.z)` skip it, or pull the whole lane in to the largest `lane` in [width/2+5, width/2+8] for which all eight positions pass. The… | open |

ANSWERS TO THE SIX QUESTIONS, with the numbers behind them. 1. THE 207 STATIONS ARE SEVEN CONTIGUOUS STRETCHES, NOT ONE. Lap 633.2 m, 480 stations at 1.32 m. CIRCUIT_LEVEL measured at 0.618 m (288 of 480 centreline samples read exactly 0.62). A. sta 463-479 + 0-30 (m 611-632 and 0-40, 61 m of arc, 48 stations), (-48,28.2) through the start/finish to (-87.8,-7.8). Worst 0.247 m at (-86.4,-5.6). CAUSE: lake-west-0's apron, weight 0.13-0.68, plateau at exactly 0.80 = lake level -0.7 + 1.5. Beside a lake, 13-18 m from its mapped edge. B. sta 83-98 (m 109-129, 20 m), (-47.2,-45.3) to (-49.4,-64.9). Worst 0.30 m at (-47.3,-51.9). CAUSE: crossed by a road — bowling-west-spur, 5.0 m from the…


### ROADS

> The thirteen carriageways are not the problem — the stages that run after them are. Every one of the eleven measured cross-carriageway failures is a later blend stage reaching across a road that had already been flattened: six are the RIVER APRON (three of those its 28.4 m end-cap disc, which sits on top of the projects junction and puts 4.03 m — 24° — of camber across it), three are the LAKE APRON, one is the BOWLING play-spot pad's 18 m shoulder, one is the river's own head-cap bank. The ribbon geometry itself is in good shape (constant 0.035 m lift at every one of 8,900 vertices, no collider, sound polygon-offset margin against the terrain), but it double-draws 464 m² of carriageway where roads overlap — 204.8 m² of that is landing-south-spine and timemachine-maze being the same road for 45 m — and that doubling is the one z-fighting artefact that is actually visible on screen. The…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The river apron's end cap puts 4.03 m of cross-carriageway camber (24.1° of side slope) on landing-projects at (69, -40.5), 3.66 m on bowling-projects at (68.1, -51.1) and 3.46 m on east-coast-road at (70.8, -42.7) — the three worst roads on the island, all… | physics | src/world/world/Terrain.ts:929-935 — the river apron keys on `lineDistance(x, z, RIVER.points)`, which clamps at the polyline's endpoints, so the apron becomes a disc of radius 28.4 m centred on the… | In the river-apron block (Terrain.ts:928-937), taper the apron past the polyline's ends. Compute the overrun — how far past the first/last vertex the nearest point projects — and multiply `inside` by `1 - smoothstep(overrun, bankStart -… | open |
| 2 | major — landing-south-spine and timemachine-maze are the same road for 45 m: their centrelines come within 0.04 m of each other at (50.1, 31.3) and stay within 3.4 m from z=15 to z=60, against a combined half-width of 7 m. The result is 204.8 m² of doubled ribbon,… | visual | Two causes stacked. (a) src/content/world-map.ts:166,168 (generated from scripts/mapcal/plan.json) digitises the drawing's spine and its time-machine-to-maze track as two separate polylines that… | Fix it in Roads.ts, not in the map. In `build`, before pushing a quad, drop it if its centre lies inside an EARLIER road's carriageway (`closestOnPolyline(x, z, other.points).distance < other.width * 0.5`), applying the test only to the… | open |
| 3 | major — The road steps UP 0.494 m onto the bridge deck at the west end and 0.500 m at the east end, and there is a 0.47 m trench at the foot of both ends: the ground is 0.506 m at the deck edge, rises to 0.977 m four metres out, then falls away. The deck is at 1.0 m. | physics | src/world/world/Terrain.ts:990 — the approach blend is multiplied by `dry = 1 - smoothstep(waterHere.edge, -BANK_WIDTH, 0)`. At the deck's own ends the deck edge is only ~3.6 m outside the river's… | Replace the `dry` factor with one keyed on the WATER SURFACE rather than the bank: fade the approach out only where the ground would end up below the water level, i.e. compute the blended height first and clamp `blend` so it never raises… | open |
| 4 | major — The road ribbon does not stop at the bridge: 200 of its vertices lie inside the deck's 22 x 9.1 m footprint and dive to y = -1.259 m — 2.26 m below the deck and 0.56 m below the river surface — so a strip of dirt road is drawn on the river bed, sticking… | visual | src/world/world/Roads.ts:build() walks each road's full polyline with no knowledge of BRIDGES. `Terrain.heightAt` carves the river out from under the road corridor (the water carve at… | In Roads.ts, skip stations whose position falls inside a bridge's deck rectangle plus a small margin — import BRIDGES from '@/content/world-environment' and, in `build`, drop any station with \|along\| < bridge.length/2 + 1 and \|across\|… | open |
| 5 | major — The BOWLING play-spot pad's 18 m shoulder reaches 24 m past its own rectangle and tilts bowling-west-spur 1.25 m across a 7 m carriageway (10.1° of camber) at (-36.4, -47.2), and accounts for 0.67 m of bridge-bowling-east's 1.64 m. | physics | src/world/world/Terrain.ts:753-790 — PLAY_SPOTS pads are applied AFTER the road stage (deliberately, per the comment at 741-752, because the circuit's run-off used to overwrite the bowling deck),… | Weaken the pad shoulder — not the pad itself — by `built`, in the same shape the shore uses: after computing `inside`, split it into core and shoulder and apply `inside = core + shoulder * (1 - built)` where `core` is the part of the… | open |
| 6 | major — The river apron's sideways reach (not the end cap) tilts bridge-bowling-east 1.64 m at (23.7, -51.9) and landing-bridge-social 1.46 m at (3.9, -48.6), on ground 18.5-27.2 m from the river. | physics | Same block as the top finding — src/world/world/Terrain.ts:928-937. The apron reaches 28.4 m from the centreline (bankStart 14.4 + 14 m of easing) and is not weakened by `built`, so it claims road… | The `built` valve proposed in the top finding covers this: `inside *= 1 - built * smoothstep(along, bankStart - 4, bankStart + 4)`. Roads 18-28 m out are fully defended; the bank itself, where the apron has to ease the ground to the… | open |
| 7 | minor — The road ribbon self-folds on 98 triangles covering 41.0 m², more than double the 18.1 m² the file's own comment documents, and the worst single fold is 3.01 m² against the documented 0.95 m². The sharpest turn on the island is 88.1°, not the 50° the comment… | visual | src/world/world/Roads.ts:377-397 — `walk` mitres at every polyline vertex but nothing limits the fold when the adjacent segment is shorter than the mitred offset. At the 88.1° vertex the outer edge… | Two parts, both small. (a) In `walk`, clamp the mitre by the shorter adjacent segment as well as by MITRE_LIMIT: `mitre = Math.min(MITRE_LIMIT, 1 / Math.max(0.2, cos), Math.min(previous.length, segment.length) / (outer \|\| 1))` — that… | open |
| 8 | minor — The lake apron reaches 13 m past the bank and tilts three roads: landing-south-spine 0.36 m at (49.4, 24.8), south-shore-road 0.65 m at (42.6, 77.8), timemachine-maze 0.45 m at (47, 40) — the last one with the lake's own carve bank contributing as well. | physics | src/world/world/Terrain.ts:900-906 — the lake apron runs after the roads and is deliberately NOT weakened by `built`; the file records four measured attempts at weakening it (Terrain.ts:871-899)… | Same shape as the river fix and no more: `inside *= 1 - built * smoothstep(normalised, reach - 4/scale, reach + 4/scale)` — the apron is undamped for the first 4 m past the bank (which is where the 43-65° approaches the block exists to… | open |
| 9 | minor — landing-racestart's south verge is dropped 1.36 m at (3.5, -1.7) by the river's HEAD cap: the water body has a 6.4 m round cap at its first vertex (4.3, -14), so its bank reaches within 1.4 m of the carriageway edge. | physics | `inlandWater` (src/content/world-environment.ts:630-633) tests `lineDistance(x, z, RIVER.points) < RIVER.width/2 + BANK_WIDTH`, which gives the river a 6.4 m round cap at each end. The carve at… | Least destructive is a small positional change, not a stage change: move landing_racestart's second point in scripts/mapcal/plan.json (emitted to src/content/world-map.ts:169 as [28.2, 0] / [12.8, -1.2]) about 3 m north so the carriageway… | open |
| 10 | minor — Every dirt road is painted twice: once as geometry (the Roads.ts ribbon) and once as two strokes on the terrain's own 1536² ground canvas, and the painted carriageway stroke is 100% occluded by the ribbon. | visual | Historical: the paint predates the ribbon and Terrain.ts:1712-1723 keeps it deliberately as 'the colour underneath', for the skirt's dissolve and the far field. That reasoning holds for the SHOULDER… | Drop the `pass === 'surface'` stroke for roads where `dirt(road)` is true (Terrain.ts:1725-1727), keeping the shoulder stroke at 1598-1610. Nothing is a duplicated SURFACE here — it is one texture on the terrain mesh, so there is no extra… | open |
| 11 | minor — The ribbon's vertical clearance is exactly constant, not variable: every one of the 8,900 vertices sits precisely 0.035 m above the drawn ground. It is never negative at a vertex. It goes negative only inside triangles — 234 of 16,036 centroids at high… | visual | By design — src/world/world/Roads.ts:74 LIFT and 233 `terrain.surfaceHeightAt(x, z) + lift`, with the `refine` pass at 306-341 splitting spans that sag along the road. The residual negatives are the… | No fix needed for the clearance itself; the design is sound and the measured numbers are within the tolerances the file states. If the -0.108 m dip is worth closing, the cheap lever is SAG_TOLERANCE (Roads.ts:79, currently 0.03) rather… | open |
| 12 | minor — Road-versus-terrain z-fighting is not a live defect, and the anisotropy and texel density hold up at every angle the camera can reach. Reported so the pass does not spend effort here. | visual | n/a — this is a clean bill of health for the lift/offset scheme and the material's sampling settings. | Change nothing here. If anisotropy is ever touched, 4 would be measurably sufficient; 8 is safe and costs little. If the depth margin ever needs improving, the lever is the camera's near plane (0.1 with far 800 is an 8000:1 ratio and… | open |

Three things other areas need to know. (1) COMPLETE ACCOUNTING OF THE ELEVEN ROAD FAILURES, so nobody has to re-derive it: river apron end-cap disc — landing-projects 4.032, bowling-projects 3.659, east-coast-road 3.457, landing-ramp 0.487 (audit says 0.789 at a vertex where the section orientation differs). River apron sideways reach — bridge-bowling-east 1.638, landing-bridge-social 1.459. Bowling play-spot pad shoulder — bowling-west-spur 1.253, plus 0.671 of bridge-bowling-east. Lake apron — landing-south-spine 0.360, south-shore-road 0.649, timemachine-maze 0.451 (with the lake's carve bank). River head-cap carve — landing-racestart 1.364. Not one of them originates in Roads.ts or in…


### RAMP

> Only one of the three ramps works. `ramp-circuit-jump` is genuinely clean (0.005 m through the deck, 0.01 m approach relief, 3/3 drive runs cleared the lip and landed upright). `ramp-east` — the island's flagship jump — is unusable: the river apron, a stage that runs after the ROAD_PROOF_RAMPS re-assert and is not weakened by `built`, cuts 1.13 m out of the ramp's own pad at the toe and tilts the footprint 1.82 m across its 9.7 m width; driven at full speed from the reserved 11 m run-up the car loses 47% of its speed on the toe, is thrown 17–24 m sideways off the deck, and cleared the lip in 0 of 3 runs. `ramp-landing` has a clean deck plane (the 0.242 m protrusion in .qa/surface-audit.json is a probe bug — the audit samples the ramp frame with the wrong handedness), but its 14 m run-up is the East Sea: the ground 10 m behind its foot is at coastInset -4.4 and 15 m behind it is at…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The RIVER APRON overrides ramp-east's pad inside the ramp's own footprint: it cuts 1.134 m out of the pad at the toe centreline and tilts the deck footprint 1.824 m across its 9.7 m width (10.65 deg cross-slope), which is where the 0.599 m of ground through… | physics | src/world/world/Terrain.ts:911-936 (the RIVER APRON block). It blends towards RIVER.level+1.5 for every point within RIVER.width/2 + BANK_WIDTH + 14 = 31 m of the river centreline, it runs AFTER the… | In src/world/world/Terrain.ts, gate the river apron by the ramp pad's claim, the same shape the shore already uses for `built`: `const inside = (1 - smoothstep(along, bankStart, apron)) * (1 - rampPadAt(x, z).inside)`. Modelled by… | open |
| 2 | **BLOCKER** — Driven at full speed from the 11 m run-up the registry reserves for it, ramp-east cleared its own lip in 0 of 3 runs: the car loses 6.91 m/s (47%) on the toe, is bounced airborne by the step, drifts 16.7–23.6 m sideways off a 9.7 m wide deck and falls off… | gameplay | The same river-apron override as the finding above (src/world/world/Terrain.ts:911-936). It produces both the 0.31 m vertical step at the toe edge (deck plane 3.873 vs ground 3.565) that costs the… | Fix the apron gate as above, then re-run /tmp/claude-501/audit-ramps/probe-drive.mjs at 11 m and require: speed loss at the foot under 1 m/s, lateral drift under 2 m, clearedLip true in 3 of 3. The modelled approach after the gate is 1.26… | open |
| 3 | **BLOCKER** — ramp-landing's 14 m run-up is open sea. The ground 10 m behind its foot is at coastInset -4.4 m and 1.33 m below sea level; 15 m behind it the collider is at -2.503 m, which is OCEAN_LEVEL. Two of three full-speed runs from the reserved 11 m capsule ended in… | gameplay | src/content/world.ts:657 — `{ id: 'ramp-landing', x: 104, z: 8, rotation: Math.PI * 0.92, ... }`. rotation Math.PI*0.92 makes the uphill direction (cos, -sin) = (-0.9686, -0.2487), so the ramp faces… | Move it and turn it round, in src/content/world.ts:657. Best site measured inside a 15 m radius (probe-inplace.mjs, a search over 11 centres x 24 bearings scoring run-up relief, gradient, coastInset and landing): centre (104, 16),… | open |
| 4 | major — The `maze` and `mazeApproach` play-spot pads overwrite ramp-landing's own pad, pulling its deck footprint from its target of ~3.86 m down to between 1.802 and 3.317 m — 1.48 m of cross-slope (12.0 deg) across a 7 m deck, and a -0.66 m step at the toe. | physics | src/world/world/Terrain.ts:744-792 — the PLAY_SPOTS pad loop runs after the ROAD_PROOF_RAMPS ramp-pad re-assert at Terrain.ts:720-728, and takes the ground unconditionally.… | In src/world/world/Terrain.ts, gate the play-spot pad blend by the ramp pad's claim: `const inside = (...) * (1 - rampPadAt(x, z, ROAD_PROOF_RAMPS).inside)` in both branches of the PLAY_SPOTS loop. A ramp is a built surface with a mesh… | open |
| 5 | major — ramp-landing's deck footprint is 99% full-density grass in the ground mask (green channel 255/255 at 371 of 375 samples), so the GPU grass field grows through the deck where it is close to the terrain — which along one rail is 0.038 m. | visual | src/content/world-environment.ts:544 — VEGETATION_EXCLUSIONS carries exactly one hand-written ramp polygon, `rectangle(ZONES.ramp.x, ZONES.ramp.z, ZONES.ramp.length + 40, ZONES.ramp.width + 14,… | Derive the ramp exclusions from the `ramps` table instead of naming one zone, in src/content/world-environment.ts: replace the single `ramp` entry with `...ramps.map((r) => ({ id: `ramp-${r.id}`, polygon: rectangle(r.x, r.z, r.length +… | open |
| 6 | major — The `.qa/surface-audit.json` ramp block samples the deck in the wrong handedness, so its ramp-landing numbers are measured off the ramp. Its reported 0.242 m protrusion at (106.6, 4.8) is at local Z 3.75 on a deck whose half-width is 3.5 — a quarter of a… | visual | scripts/world-surface-audit.mjs:258-261, the RAMPS block's local-to-world mapping. The same file's `foot` derivation two lines above it is correct, so the two halves of one block disagree. | In scripts/world-surface-audit.mjs, change the deck sampling to `const x = r.x + la * cos - lc * sin; const z = r.z - la * sin - lc * cos`, matching World.buildRamps. Re-run and expect ramp-landing's protrusion to fall to ~0.00 and its… | open |
| 7 | major — World.buildRamps samples the foot one metre INSIDE the footprint, so on any pad that is not perfectly level the base plane sits above the ramp's own toe. On ramp-east the toe edge is at 3.565 m and the base plane is at 3.873 — a 0.308 m vertical step at the… | physics | The one-metre inset is arbitrary and the single sample cannot see across the deck's width, so a pad with any cross-slope defeats it. On ramp-east the pad has 1.824 m of cross-slope and the sample is… | In src/world/world/World.ts:284-291, take the minimum over the toe EDGE rather than one point one metre in: sample colliderHeightAt at localX = -length/2 across localZ in [-width/2, +width/2] at, say, 0.5 m, and use the lowest of those… | open |
| 8 | minor — The 'short flat lip at the top' in rampGeometry does nothing. The two extra hull points are strictly inside the convex hull of the other six on all three ramps, so every deck is the plain knife-edged wedge the comment says it is avoiding. | physics | The lip's height fraction (0.86) and its setback (height*0.5) are both expressed in terms of `height`, so the test they encode is a ratio against `height`, not against `length` — and every ramp in… | In src/world/world/geometry.ts:179-180, set the lip back from the top by a fraction of LENGTH rather than of height, so the flat is flat for any ramp: e.g. `new THREE.Vector3(hl - length * 0.08, height - length * 0.08 * (height / length)… | open |
| 9 | minor — LANDING_SHOALS derives a seaward ramp's lip with the opposite handedness to the ramp's mesh, and applies the shoal along the same wrong axis. It is harmless today only because the single ramp it selects has rotation 0. | physics | Two independent hand-written frames for the same rotation, in a file whose own comments record three shipped bugs from exactly this pattern. | In src/world/world/Terrain.ts, use one helper for the ramp frame — the one rampPadAt already implements — and call it from LANDING_SHOALS' lip derivation and from the shoal loop. No measurable change to the current world; it is a latent… | open |
| 10 | minor — The QA harness's own RAMP check starts the car at the bottom of the river valley, 3.85 m below the ramp it is testing, which is why its air measurement has never been reproducible. | gameplay | The 11 m run-up is taken from the zone registry's reserved capsule, and nothing checks that the capsule is on ground the ramp's own pad holds. It is not: at 11 m out the ramp pad's claim has fallen… | Once the river-apron gate lands, re-measure. The modelled ground 11 m in front of ramp-east's toe rises from 0.85 m to ~1.7 m and the approach becomes monotonic, so the harness should start reporting a stable figure. If it still does not,… | open |

Two things another area needs to know. MAZE / PLAY SPOTS: the `mazeApproach` pad (src/content/world-environment.ts:484-495) is 24x24 and picks up the play-spot loop's 18 m shoulder, so it levels ground towards the labyrinth floor (0.35 m) out to 30 m in every direction from (79, 14.1) — x 49 to 109, z -16 to 44. Combined with the `maze` pad's own 41.9 m reach it means every point within 15 m of ramp-landing's authored position sits at play-spot weight 1.0. Its comment says it exists for 'the twelve metres of approach in front of the mouth'. If the maze area shrinks that shoulder, my finding 4 gets much cheaper and the relocation in finding 3 gets more choices. Do not shrink it and gate it…


### BOWLING

> The venue's ground surfaces are excellent — terrain under the whole 54 x 11.7 m venue rectangle is flat to 0.000 m, the deck stands 0.060 m proud, all ten pins sit at -0.001 m against the deck, and scripts/world-bowling-qa.mjs passes 26/26 checks over three played sets. Two things are badly wrong. First, the floating screen is not merely "too far": at 1280x800 AND 1920x1080, at all four moments of a real throw, 0 of its 4 corners and 0 of the 10 pins are inside the view frustum — the board centre projects to NDC y = 1.85..2.15 (the top of frame is 1.0) and the angular separation between the pin deck and the board at the camera is 42-53 degrees against a 39-43 degree horizontal FOV. Second, GUTTER_DROP (0.12) is larger than CLEARANCE (0.06), so both gutter channels are buried 0.017-0.103 m under the terrain for their whole 40.6 m length: what the player sees either side of the lane bed…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The floating screen is outside the view frustum at every moment of a throw: 0/4 corners visible at all four sampled moments, at both 1280x800 and 1920x1080. Board centre NDC y = 2.09 / 1.94 / 1.85 / 2.07 (top of frame is 1.0); NDC x = 0.90 / 1.15 / 1.28 /… | visual | src/world/minigames/Bowling.ts:146,149 — SCREEN_X = HALF_W + 4.2 = 10.035 and SCREEN_Y = 5.0. The View camera's azimuth is fixed (src/world/view/View.ts:80-82, theta = 0.25*PI, phi = 0.27*PI) and… | Move the board to the camera's own flank and shrink it, all in Bowling.ts. (1) SCREEN_X: +10.035 -> -6.5 (bowler's right / world +Z, the side the camera sits on). (2) SCREEN_Y: 5.0 -> 4.4, which puts the bottom edge 3.03 m over the deck,… | open |
| 2 | major — Both gutter channels are buried under the terrain for their whole length: gutter mesh top ranges 3.328-3.414 while terrain is 3.431 and the deck is 3.491. The player sees two 1.66 x 40.6 m strips of grass-coloured terrain either side of the lane bed, and a… | visual | src/world/minigames/Bowling.ts:100 and :106 — CLEARANCE = 0.06 but GUTTER_DROP = 0.12. floorY is defined as highestTerrain + CLEARANCE (line 326), so the gutter's top face is at highestTerrain +… | Raise CLEARANCE from 0.06 to 0.22 in Bowling.ts:100, leaving GUTTER_DROP at 0.12. That makes the channel centre 3.531, inner edge 3.574 (0.077 below the bed — a real recess) and outer edge 3.488 (0.057 above the terrain — visible and… | open |
| 3 | major — The pins and pin deck are never in the view frustum during a throw: 0/10 pins framed at all four moments. The pin deck sits 32.6 / 31.2 / 27.3 / 23.8 degrees off the camera axis horizontally, against a 19.5 degree half-FOV. | gameplay | Not a bug in Bowling.ts. It is the interaction of src/world/view/View.ts:80-82 (theta fixed at 0.25*PI, phi 0.27*PI, fov 25 deg, radius 15-30) with src/content/world-environment.ts:408 (bowling… | Nothing inside this area's files can fix it without violating the brief (rotating the venue 45 degrees is a map-layout change; tripling the camera radius is a camera change). The in-area mitigation is the screen fix above: with the board… | open |
| 4 | minor — The screen's canvas is 38% empty: the ten-pin diagram is drawn into 637 x 514 px of a 1024 x 560 canvas, so 4.15 of the board's 11 world units carry nothing but background. | visual | src/world/minigames/Bowling.ts:172-176. BOARD_PX_W = 1024 was inherited from the old board that carried a header, a scoresheet and three text lines beside the diagram; when paint() was cut down to… | Re-cut the canvas to the picture: BOARD_PX_W 1024 -> 700, DIAG_CX 512 -> 350, everything else unchanged. The board then becomes 700 x 560, aspect 1.25, and BOARD_W can drop to 6.4 for the same on-board pin size — which is 1.4 units of… | open |
| 5 | minor — The STRIKE neon and its backing panel float unsupported: the lettering's lowest point is 2.316 m above the terrain and the panel behind it 1.810 m, with nothing beneath either. | visual | src/world/minigames/Bowling.ts:966-977. The neon is positioned at floorY + 2.4 and its backing box at floorY + 2.4 + neonSize/2 with height neonSize * 2.0 = 2.6, so the panel's bottom lands at… | Give the panel a leg, in the same `metal` bucket as the rail masts: put(metal, new THREE.BoxGeometry(0.3, panelBottom - groundAt(dx, dz) + 0.4, 0.3), ...) at the panel's own x/z, running from groundAt - 0.2 up to the panel. That is one… | open |
| 6 | minor — scripts/world-bowling-qa.mjs passes all 26 checks over three sets while the screen is entirely off-screen, because it never tests that the board is visible — only that it is parallel to the lane and that nothing solid is near it. | gameplay | scripts/world-bowling-qa.mjs:283-325 reads the board's matrixWorld only to compute a normal-vs-lane dot product and a nearest-collider distance. It never touches g.view.camera, so nothing in the… | Add one check to the same block: project the board's four corners through g.view.camera's projectionMatrix * matrixWorldInverse at the mark and again mid-roll, and assert all four land inside \|x\|<=1, \|y\|<=1 with w>0. The boilerplate… | open |

THE SCREEN TRANSFORM AS BUILT TODAY (Bowling.ts:141-162, 764-828, 1422-1437). Stand-off: SCREEN_X = HALF_W + 4.2 = 10.035 units from the lane centreline, i.e. 4.70 from the outer gutter edge, 4.20 from the venue edge, 1.20 from the skirt's outer edge. Height: floorY + 5.0 = world 8.491, plus a sin(t*1.1)*0.14 bob. Size: BOARD_W 11 x BOARD_H 6.0156 (derived from the 1024x560 canvas), frame 11.6 x 6.62 x 0.3, under-glow 11.6 x 0.18. Yaw: screen.rotation.y = -PI/2 inside a venue group yawed +PI/2, so the world yaw is 0 and the plane's normal is world +Z, pointing at the lane — measured parallel to 0.0000. Lean: board.rotation.x = -0.06 rad (-3.44 deg), tipping the face down toward the viewer.…


### MAZE

> The labyrinth is not solvable today: the WEATHER LEVER's 2.4 x 1.8 m static plinth stands in the west corridor at (61.08, 47.38), grid (1,8), directly on the only route to the centre, and an autopilot driving the solution stops dead against it and never gets past waypoint 14 of 84 in 500 simulated seconds. Remove that one collider and the same autopilot drives the whole 83-step route to the fountain in 51.6 s with 5 shunts, so the maze grid itself is sound. Separately the corridors really are too tight — measured, a 4.60 m corridor permits a 90-degree turn without reversing only below ~6.2 m/s and only with the car dead-centred and touching both hedges, against a natural no-boost cruise of 6.7 m/s — and neither RESTART nor EXIT moves the car: both HUD buttons call minigames.cancel(), which by design never teleports, so the only teleporting restart is a prompt 32.6 m away outside the…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The WEATHER LEVER's plinth — a 2.4 x 1.8 x 1.8 m fixed collider at (61.08, 47.38) — stands inside the labyrinth's west corridor, grid cell (1,8), which is on the unique solution path. The maze cannot be completed. | gameplay | src/content/attractions.ts:152 anchors weatherLever to the timeMachine district at bearing -0.77, distance 21, which resolves to (61.09, 47.39) — 18.1 m from the maze centre, inside the maze's 23.9… | Re-author the anchor in src/content/attractions.ts:152 so the wish starts outside the maze pad — e.g. bearing -2.2 (west/south-west of the time machine) at distance 21, or anchor:{kind:'spot',id:'timeMachine'} with a bearing pointing away… | open |
| 2 | major — Two of the four crates standing in maze corridors are FIXED bodies, not props: 0.86 x 0.96 x 0.86 m immovable boxes at (65.24, 59.40) grid (3,12) and (67.82, 58.07) grid (3,11), both on the solution path, plus two more at grid (1,13). Two dynamic barrels… | gameplay | The decoration/prop scatter places these inside the maze square. The maze registers with the layout registry as kind:'play' (src/content/world-layout.ts:309) at radius pad.width/2 = 23.9 m, so any… | Add the maze square (not the pad disc) as a hard exclusion for the prop/decor scatter, the same way VEGETATION_EXCLUSIONS already carries `{ id: 'maze', polygon: rectangle(ZONES.maze.x, ZONES.maze.z, size+8, size+8) }` at… | open |
| 3 | major — The corridor is 4.60 m. Measured, the car needs 4.98 m to turn 90 degrees without reversing at its natural full-throttle cruise of 6.7 m/s, and that figure assumes it is dead-centred in both corridors with zero clearance. Today's 4.60 m caps a no-reverse… | physics | src/world/minigames/Labyrinth.ts:139 CORRIDOR = 4.6, cut from 5.2 to make the square fit the coast (the comment at lines 122-138 says so). The whole file's prose still describes 5.2 m corridors and… | Take CORRIDOR to 5.5 m and WALL from 1.2 to 0.8 m: 7 x 5.5 + 8 x 0.8 = 44.9 m, which is +3.1 m of square and fits the measured 3.0 m of west clearance if the centre also moves 1.5 m east (see the pad finding). 5.5 m clears the measured… | open |
| 4 | major — RESTART does not put the car back at the maze start. The HUD Restart button calls minigames.cancel() then minigames.start('labyrinth'); neither teleports, so the clock restarts with the car still nine corridors deep. | gameplay | src/world/minigames/Labyrinth.ts returnToStart() is called only from restart(), finish() and fail(), and restart() is only bound to the in-world prompt's onInteract. The base class Minigame.start()… | Give Minigame an optional protected hook — e.g. `protected returnOnRestart(): boolean { return false }` plus a `protected placeAtStart(): void {}` — and have Minigames.start() call placeAtStart() when the game asks for it. Labyrinth… | open |
| 5 | major — EXIT does not put the car back either. Both the HUD 'Exit game' button and ESC/pause/map call minigames.cancel(), which leaves the car exactly where it was — in the middle of the maze, with no timer and no prompt in reach. | gameplay | By design: the Labyrinth.returnToStart() doc comment explicitly forbids calling it from reset() or cancel(), because cancel is bound to ESC, pause, the map key, player respawn and any overlay… | Distinguish the reasons. cancel() already takes 'player' \| 'strayed' \| 'respawn'; add 'exit' and have only the HUD Exit button and the ESC action pass it, then let Labyrinth override cancel() to call returnToStart() for 'exit' only.… | open |
| 6 | major — The 'maze' respawn point stands INSIDE the maze, in an open corridor 18 grid steps from the centre, at (80, 2.55, 40) — grid cell (7,5). Pressing R inside the labyrinth drops you back into the labyrinth and cancels the run. | gameplay | src/content/world.ts:362 `{ id: 'maze', x: 80, z: 40, rotation: 0.25, district: 'maze' }`. The comment block above it (lines 350-361) describes a point 'OUTSIDE THE WALLS, on the spur ... west of… | Move the point onto the approach, outside the north face: x = ZONES.maze.x, z = ZONES.maze.z - ZONES.maze.size/2 - 14, rotation pointing at the gate (about 1.571 for a car facing +z), so it tracks any change of size. That is the… | open |
| 7 | major — The maze's 30 static bodies — 29 merged wall runs and the fountain cylinder — are created with game.physics.add() and never registered with the Bin, never stored, and never removed. There is no leak today only because the maze never rebuilds; the first… | perf | src/world/minigames/Labyrinth.ts buildWalls and buildCentre: the Physical returned by physics.add is dropped on the floor. The design comment at the top of the file ('THE WALLS ARE SOLID, ALWAYS ...… | Collect every Physical that buildWalls and buildCentre create into a `private bodies: Physical[]`, and register `this.bin.add(() => { for (const b of this.bodies) this.game.physics.remove(b); this.bodies.length = 0 })`. Then give the… | open |
| 8 | major — The chase camera loses the car behind the hedges over 20.8% of the driveable lane area inside the maze, and the camera's own obstruction probe cannot see maze walls at all because it starts above them. | visual | WALL_HEIGHT = 2.6 (src/world/minigames/Labyrinth.ts:141) against a camera fixed at 41.4 degrees elevation and a 4.6 m corridor. Nothing is wrong with the camera; the walls are simply taller than the… | Level geometry, not camera code. Take WALL_HEIGHT from 2.6 to 2.0 m and WALL from 1.2 to 0.8 m alongside the corridor widening: the sightline then clears once lateral gap + WALL ≥ (2.0 − 0.55)/0.881 × 0.7071 = 1.16 m, i.e. 0.36 m of gap,… | open |
| 9 | minor — TIME_LIMIT's arithmetic is wrong twice over. The shortest route is 240.7 m, not the 265.6 m the comment computes, and the achievable speed through 4.6 m corridors is about 4.7 m/s, not the 8-9 m/s the comment assumes. | gameplay | src/world/minigames/Labyrinth.ts:168-181, written when CORRIDOR was 5.2 and never re-derived when it became 4.6. | Recompute TIME_LIMIT from the widened geometry once CORRIDOR is settled: measure the perfect-route time with the autopilot probe at the new width, then set the limit to roughly 2.2x that. Better, derive it: keep the 90 s only if a… | open |
| 10 | minor — Labyrinth.ts's prose describes a maze that does not exist: 5.2 m corridors, a 46 m square, a 265.6 m route, a 3.8 m neighbouring-corridor edge and 1.1 m of clearance either side of the fountain. The real values are 4.6, 41.8, 240.7, 3.5 and 0.68. | visual | CORRIDOR was cut from 5.2 to 4.6 and CELLS from 5 to 7 in separate passes; the constants moved, the prose did not. | When CORRIDOR/WALL/CELLS change for the widening, regenerate every derived number in the comments from the new constants in one pass, and prefer expressing them as expressions (CORRIDOR/2 + WALL) rather than as evaluated literals so they… | open |
| 11 | minor — The 'YOU ARE HERE' board at the mouth draws the complete 15 x 15 plan with the mouth and the centre both marked in the accent colour. It gives away the route, which is the opposite of the brief's 'obvious on arrival without revealing it'. | gameplay | A deliberate design decision that predates the brief's section 19. | Keep the board but drop the solved plan: draw only the outline of the square, the mouth and the centre disc, so it reads as 'here is the way in and there is the thing you are looking for' without the corridors. That preserves the object,… | open |
| 12 | minor — returnToStart() moves the car but not the camera, so a fail or a finish sweeps the chase camera 33 m across the maze through the hedges instead of cutting. | visual | returnToStart was written before it was used for teleports of this length (its own comment notes the mark used to sit on the terrain because 'nothing teleported to it'). | Add `this.game.view.focusPoint.trackedPosition.copy(this.startPosition); this.game.view.snapToTarget()` to returnToStart(), matching Player.respawn. Two lines, no new state. | open |

HOW MUCH THE MAZE CAN GROW (brief item 8), all measured live. The pad is a 41.8 m square at (79,45) plus 6 m of margin = 47.8 m, and it is the only perfectly level pad in the world (0.018 m relief; all four pad corners on land at h 0.35-0.36). The coast is NOT the binding constraint: marching from the centre, the waterline is 50.0 m east, 45.5 m south, 52.75 m south-east, 57.25 m north-east and beyond 130 m north; a 76 m square (70 m including its +6 pad) still lands entirely on ground above sea+0.4. What actually binds is the TIME MACHINE district at (46, 62) radius 10.6, whose edge is 1.50 m from the square's west face — the +6 pad already overlaps it by 1.5 m. So symmetric growth is…


### PROJECTS

> The projects district is the emptiest place on the island and nobody noticed: all ten set-dressing stands in `dressing/projects.ts` fail placement at boot (`[dressing] projects: 10 stand(s) found no free ground`), so 571 lines of avenue, racks, dish, plotter, cable tray and crates render nothing — the district is a screen on a stick, eight scattered plinths and bare hillside. The screen itself already exists (4.2 x 2.6 m ink frame, 3.8 x 2.2 m unlit `emissiveSignal` plane, unrotated) and is a good size for motion graphics, but it faces world +Z (bearing 90 deg) while the two roads arrive at 121.6 deg and -143.1 deg, so from the bowling road the player meets its black back. Under it, the ground is not level: the terminal's 2.4 x 2.0 m base spans 1.00 m of relief, its 4 m marker ring hangs 2.10 m in the air on the south-east side, the level apron radius is 0 m, and the district respawn…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — Every one of the ten set-dressing stands in the PROJECTS district fails placement, so the whole 571-line dressing/projects.ts renders zero geometry: no avenue of six boards, no rack row, no cable tray, no crates, no cable drum, no satellite dish, no plotter,… | visual | src/world/world/dressing/projects.ts:78 `arrivalBearing` averages the unit vectors of every road whose id contains 'projects'. Measured, those two roads are 112.3 deg apart (bowling-projects vertex… | In src/world/world/dressing/projects.ts, replace `arrivalBearing`'s mean-of-all with a PRIMARY-road bearing: take the road whose last vertex is nearest the district centre and is not the coastal loop — that is `landing-projects`, ending… | open |
| 2 | major — The projects terminal screen faces world +Z (bearing 90 deg) with no rotation authored, so a car arriving on `bowling-projects` meets the black back of the screen at 126.9 deg off-normal. | visual | src/content/world.ts:494 — `projects-terminal` was authored without a rotation, so it inherits 0 and points at whatever world +Z happens to be. The default was never checked against the roads that… | Add `rotation: -1.3823` to the `projects-terminal` landmark in src/content/world.ts. That is `Math.PI/2 - 2.9531`, the yaw whose +Z normal points along the bisector of the two arrivals (169.2 deg), leaving the screen 47.7 deg off-axis… | open |
| 3 | major — The terminal stands on ground that is 1.00 m out of level across its own 2.4 x 2.0 m base, and its 4 m marker ring hangs 2.10 m in the air on the south-east side. | visual | src/content/world.ts:208 gives the projects district `plate: 9`, but the measured relief inside r = 9 m is 5.39 m (1.48 to 6.87) and the level-apron radius at an 8 deg tolerance is 0 m. The plate… | Two parts. (a) In src/world/world/Terrain.ts, find which stage after the district plate is cutting bearings 90-180 at this centre — the ordered list makes the shore/apron/water-carve group the candidates, and the terminal is 5.2 m from… | open |
| 4 | major — There is no level ground anywhere at the projects terminal to stop, turn or park in front of the screen: the level-apron radius is 0 m and the ground exceeds 20 deg within 1 m of the terminal on every bearing from 120 to 180 deg. | gameplay | The same failure as the footing: the district plate is not levelling the ground it claims. The terminal sits on the crown of a hill whose south-eastern quadrant is a 20-46 deg face, and the two… | Widen the projects district plate from 9 to ~16 m in src/content/world.ts:208 AND make it survive the later blend stages (see the previous finding). Sixteen metres gives an 8 m-radius level forecourt in front of a screen the player is… | open |
| 5 | major — The PROJECTS respawn point drops the car 5.72 m below the terminal, 12.6 m away, up a face reaching 34.1 deg — the car's measured climbing limit. | gameplay | The respawn was placed on the road corridor west of the district (src/content/world.ts:343, rotation -0.87) before the terrain under the terminal rose; nothing re-checked the height difference… | Move the projects respawn onto the levelled forecourt created by the plate fix — e.g. (68.5, -43.5), on the landing-projects carriageway 5-6 m out from the terminal at an arrival-facing rotation — so pressing R at PROJECTS puts you in… | open |
| 6 | major — The "ring of eight plinths around the terminal" is not a ring: radii run 19, 19, 19, 20, 29, 30, 40, 40 m, two pairs sit at identical bearings one behind the other, and the largest gap between neighbours is 112.5 deg. | visual | src/content/world.ts:887 `projectPlinths()` authors angle = i/8*2pi + 0.35 at radius 19 or 30, then hands each to `findNear` with clearance 3.5. `findNear` (world-layout.ts:552) sweeps the bearing… | In `projectPlinths()`, pass the already-placed plinths' BEARINGS as a constraint, not just their footprints: after `findNear` returns, reject a spot whose bearing from the centre is within ~22 deg of an already-placed one and retry with… | open |
| 7 | minor — Two of the sixteen client projects ship the same placeholder image as their screenshots — hotel-escuela-el-mirador and newport-media-films are byte-identical files, not captures of those sites. | visual | src/content/projects/client.ts lists real screenshot paths for all 16 clients; the capture run (scripts/capture-clients.mjs) evidently produced a blank/error page for these two and the result was… | Either re-capture those two sites with scripts/capture-clients.mjs, or set `assetStatus: 'placeholder'` on those two entries in src/content/projects/client.ts so any consumer — including the new screen — can skip them instead of showing a… | open |
| 8 | minor — `View.startCinematic` / `View.endCinematic` — a complete, damped camera-blend API — has zero callers anywhere in the codebase. | visual | The API was written for a cinematic that was never wired up; the mini-games all drive the camera directly instead. | Do not write new camera-easing code for the focused screen mode. `view.startCinematic(position, target)` with position = the screen's normal times ~11 m at screen height, target = the screen's centre, and `view.endCinematic()` on exit, is… | open |
| 9 | minor — The `fireworks` attraction and the `keyframes` project plinth register prompt circles 2.1 m apart, so one of the two prompts can never be reached; the fireworks itself then fails to place at all. | gameplay | `fireworks` is anchored to the bowling play spot at bearing -0.14, distance 58 (attractions.ts:143) and lands in the same field the keyframes plinth was pushed into by `findNear` growing its radius… | Fixing the plinth ring (capping the radius growth at 30 m) removes the keyframes plinth from that field and resolves this collision without touching the fireworks spec. If the plinth stays, move fireworks' bearing a few hundredths — it is… | open |
| 10 | minor — The roadside PROJECTS signpost at the landing hub is never built — the placement sweep finds no free ground on its bearing out to 40 m. | visual | Known and documented at SceneryDetails.ts:373. The hub-to-projects bearing threads between `landing-projects` and the river. | Nothing, and this matters for section 76: the PROJECTS wayfinding sign that DOES exist is the landmark `landing-sign-projects` at (44, -26) in src/content/world.ts:430, a `visual: 'sign'` with `interaction: 'none'`. It is 36 m from the… | open |

==================================================================== 1. THE PROJECTS EXPERIENCE AS IT EXISTS TODAY, STEP BY STEP ==================================================================== Everything below is the exhaustive removal/repurpose list. DRIVING UP - Zone entry. Game.bindDistricts (src/world/Game.ts:673-700) creates `district-projects`, a cylinder zone at (72.9, -47.5) r=20 from districtById.projects (src/content/world.ts:204-213). On enter it calls `store.setDistrict('projects')` and, because `signposted: true`, sets the `explorer` achievement. - Prompt registration. Game.bindLandmarks (Game.ts:552-593) walks `world.landmarks` and, for every landmark whose `interaction…


### LANDING

> The letters are not a typographic system: 16 independently-swept polyline glyphs with no shared baseline, no shared cap height, and a collider half-thickness (0.416) still hard-coded from the abandoned 5.2 m size. Measured live: the baseline scatters 1.459 m across the word (47% of the nominal 3.1 m cap), 13 of 16 letters float or are buried and collapse up to 2.29 m the instant anything wakes them, the J's bowl arc is swept the wrong way so it reads as a croquet hoop, and unclamped mitres grow 0.71 m spikes on A/N/W. Separately the whole word stands in both carriageways out of the landing (the O is 1.11 m from the landing-projects centreline) and validateLayout cannot see it, because the registered footprint sits 4.4 m east and 6.2 m south of the letters AND letters+road carries a blanket exemption. Size is the least of it: nominal 3.1 m, measured median ink height 3.60 m, so the…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — Thirteen of sixteen letters are not resting on the ground. Waking them (which the first car contact does) drops the word by up to 2.29 m: W -2.286, O -1.975, R -1.895, N -1.624, P -1.569, N -1.458, T -1.342, O -0.999, R -0.972; A/L/E are buried and get… | physics | src/world/world/Playground.ts:117 - at.y is origin.y (one scalar, the landing-name landmark's height at 46,-18) offset by that letter's own ink extent. Nothing samples the ground under the letter.… | In Playground.buildName compute at.x/at.z first, then at.y = this.game.world.terrain.colliderHeightAt(at.x, at.z) - bottom + 0.025. Least destructive and needs no Terrain change. Max resulting step between adjacent letters is 0.33 m (from… | open |
| 2 | **BLOCKER** — The name stands in both carriageways out of the landing. The O of ALEJANDRO is 1.11 m from the centreline of landing-projects (a 9.0 m road), 3.4 m inside the paved edge; the A of ALEJANDRO is 1.19 m from the centreline of landing-bridge-social and 3.64 m… | gameplay | Two causes. (a) src/content/world.ts:394 places the landing-name landmark at ZONES.nameLetters.x-4.4, z-4 with a comment saying the offset is for PLINTH clearance, but Playground.ts:99 uses… | Tighten the exemption first so the defect becomes visible: replace the blanket letters+road rule with the arrive-only test used for play+road at world-layout.ts:655-659. Then place the letters. Measured sweep… | open |
| 3 | major — There is no shared baseline and no shared cap line. Baseline world Y ranges 0.063 (J) to 1.522 (W), 1.459 m of scatter, 47% of the 3.1 m nominal cap. Ink tops range 3.163 (J) to 5.296 (N), 2.133 m, 69% of cap height. The nominal 3.1 m is a height no letter… | visual | src/world/world/Playground.ts:104-117. Each letter is bottom-aligned to its OWN ink extent: bottom is the min of its geometry bounding box and its own collider projections, and at.y = -bottom +… | Make the baseline the contract. Build every glyph with baseline at local y=0 and cap at local y=size (which a real font pipeline gives for free), then place at.y = groundY + 0.025 for all sixteen with no per-letter bottom term. Delete the… | open |
| 4 | major — The J is drawn as a croquet hoop, not a J. Its bowl is a semicircle swept ABOVE the baseline (peaking at y=0.56 in glyph units) instead of below it, so it reads as a short stem with an arch under it. Measured ink height 2.293 m against a 3.1 m nominal cap… | visual | A sign error in the one glyph whose bowl hangs below its start point. J is the only glyph in ALPHABET with a flipped arc; every other bowl (U, S, C, G, 5, 6) sweeps the correct way. | If the font pipeline lands, the glyph disappears with the rest of ALPHABET's role in the name. As a stopgap it is one character: arc(W*0.5, 0.28, W*0.5, 0.28, 0, -Math.PI, 8). That also fixes the J's height and its baseline (bowl bottom… | open |
| 5 | major — Unclamped mitre joins grow spikes on the pointed glyphs. N's ink extends 0.708 m above its cap AND 0.708 m below its baseline; W 0.743 m below baseline; A 0.732 m above cap. That is 23% of cap height, and it is why N and W are the tallest letters in the word… | visual | src/world/world/Type3D.ts:145, const scale = Math.min(3, 1 / Math.max(0.28, Math.abs(cos))). That is a mitre limit of 3, not a bevel. The file header claims joins are bevelled where the turn is… | Two structural options. (a) If Type3D keeps building the name, implement the bevel the comment promises: when 1/\|cos\| exceeds about 1.6, emit two offset points and a triangle between them instead of one mitred point, and fix the header… | open |
| 6 | major — Every letter's collider is 1.68x thicker than its ink. Collider half-thickness is the literal 0.416 in Playground; the visual stroke half-weight at LETTER_SIZE 3.1 is 3.1 x 0.16 / 2 = 0.248. 0.416 is exactly 5.2 x 0.16 / 2 - the constant was baked for the… | physics | A dimension written as a literal in the builder instead of derived from the size that lives in src/content/world-layout.ts, so it could not track the two size reductions. | Derive it: SIZE * WEIGHT / 2 with WEIGHT the same 0.16 the geometry uses, and hoist WEIGHT next to LETTER_SIZE in src/content/world-layout.ts so geometry and collider cannot drift again. The +.05 length padding and the .75 half-depth are… | open |
| 7 | major — The layout registry protects ground the letters do not stand on. The letters zone is centred at (50.4, -14) with rx 15.05; the letters actually span x 32.75 to 59.27 at z -17.25 and -21.71, centroid (46.0, -20.2). The registry is 4.4 m off in x and 6.2 m off… | gameplay | Two decouplings. LETTERS.x/z read ZONES.nameLetters while the built letters read the landmark's position, which world.ts:394 deliberately offsets by -4.4/-4. And the width is a magic 1.2 rather than… | Make one source. Either export the glyph metrics (GLYPH_WIDTH 0.72, GLYPH_SPACING 0.24) from the content layer so both alphabet.ts and world-layout.ts read them, or have world-layout export the run widths and Type3D read them. Then set… | open |
| 8 | minor — The size target as stated will overshoot. LETTER_SIZE is 3.1 m but no letter is 3.1 m tall: measured ink heights run 2.293 to 4.516 m, median 3.596, mean 3.633. A true-cap-height rebuild at 0.75 x 3.1 = 2.325 m would be 65% of what the eye currently reads,… | visual | LETTER_SIZE is fed to Type3D as a glyph-box height, but the swept geometry overshoots that box at mitred vertices and undershoots it wherever a glyph's ink does not reach y=0 or y=1. So the number… | Once every glyph has a true cap height, set LETTER_SIZE to 0.70-0.80 x the MEASURED median 3.596 = 2.52-2.88 m (81-93% of the current nominal 3.1). Scale rowPitch with it as today (x1.44). Layout validates across that whole band. Then… | open |
| 9 | minor — Extrusion depth is a hard-coded 1.5 m that does not scale with LETTER_SIZE - 48% of cap height, roughly twice the proportional depth of anything else built with Type3D (Landmarks' brackets 0.20, timeMachine numerals 0.11, Type3D's own default 0.28).… | visual | Same class of defect as the 0.416: a dimension written as a literal in the builder instead of derived from the size that lives in world-layout.ts. | Express depth as a ratio of cap height alongside LETTER_SIZE (0.30-0.35 gives a signage slab that still reads as type) and derive both the geometry depth and the collider half-depth from it. Stroke weight 0.16 should move there too: a… | open |
| 10 | minor — One word costs 16 draw calls and 16 material instances. Each letter gets its own new MeshStandardMaterial inside the loop even though there are only two colours, and 16 separate non-indexed geometries (1112 triangles total). The 122 stroke colliders are 8.3%… | perf | src/world/world/Playground.ts:107 constructs the material inside the per-letter loop. The geometries genuinely must be separate (each letter is its own rigid body), but the materials need not be. | Hoist two MeshStandardMaterials outside the loop (row 0 #33473d, row 1 #657c5b) and share them. Geometry count is irreducible; the collider count is not - a real glyph outline decomposed into 3-6 convex pieces per letter would take 122… | open |

RESET IS FINE - do not rebuild it. resetName() (Playground.ts:127) calls physics.reset(), which restores physical.initialState (Physics.ts:290-294), a snapshot of the transform actually handed to add() at build time, plus sleeping. Measured end to end (/tmp/claude-501/audit-letters/reset-test.mjs): after knocking all 16 over, reset restored every body's Y to its built value to three decimals, re-slept them, and the mesh tracked the body with a 0.000 m delta. Nothing can desync - a rebuild that changes the spawn transform automatically changes what reset restores. The one reset problem is downstream of finding 1: because the built transform is not an equilibrium, the solver moves the…


### VEGETATION

> The vegetation itself is clean: of 8,211 placed instances across 84 instanced meshes, ZERO plants (tree, bush, tuft, flower, rock, reed) stand on the racing surface, a road, a ramp, the bowling lane or the maze floor, and the closest tree trunk to any road edge is 5.77 m. Everything the surface audit reported as "vegetation on the racing surface" is something else — a Props cone, a Props ball, wind-blown leaves, weather particles, or CircuitRace's own TNT crates — which nothing could tell apart, because all 84 instanced meshes are unnamed and carry no userData. The real defects are in the PROP scatter, not the plant scatter: decoration is placed at ground height as the rigid-body ORIGIN, so every centre-origin kind spawns half-buried, and 13 of 975 props have been ejected through the heightfield and are falling forever at terminal velocity, while 66 more have drifted up to 9 m from…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — 13 of 975 props are falling through the world forever: after 12 s idle they are at y −149 to −262 m and still descending at a constant 20 m/s. 11 crates, 1 cone, 1 cog. | physics | src/world/world/Decor.ts:76-82 computes `y = terrain.colliderHeightAt(x,z) + 0.03 + placement.lift` and hands it to `props.addMany`, which reaches src/world/world/Props.ts:461 `position: { x, y, z… | Add `propSeatHeight(kind)` next to `decorStackHeight` in src/content/world-decor.ts, seeded with the measured medians (crate 0.55, ball 0.62, panel 0.61, domino 0.57, tyre 0.43, drum 0.36, barrier 0.20, plank 0.21, block 0.80 from its… | open |
| 2 | major — 66 of 832 decor placements have moved more than 3 m from the position planDecor authored, with nobody driving; every prop found on the racing surface, in the run-off or on a road got there by moving, and 4 props have ended up in the sea (2 of them 15 m… | physics | The same spawn interpenetration as the finding above: Rapier resolves a 0.5 m overlap with a large corrective impulse, so a crate is shot sideways and a ball (restitution 0.68, Props.ts:130) rolls… | Fix the seat height (previous finding) — that removes the impulse at source. Then add a settle assertion to the existing decor report in src/world/world/Decor.ts `report()`: after N seconds compare each instance's position to… | open |
| 3 | major — The labyrinth's 47.8 m square pad is registered as a disc of radius 23.9 inscribed in it, leaving 490 m² of corner unguarded; six decor props were PLACED inside the maze square (disturbed=false) and four of them stand inside a 2.95 m wall. | gameplay | src/content/world-layout.ts zones(), the PLAY_SPOTS loop (~line 280-310), turns every pad into a capsule: `hx = (pad.length/2 − pad.width/2)·cos`, `hz = …·sin`. For a SQUARE pad hx = hz = 0, so the… | Give `Zone` a `rect: { x, z, length, width, rotation }` member and add a rotated-rectangle branch to `distanceToZone` in src/content/world-layout.ts (transform into the rect's frame, take `max(\|dx\|−hl, \|dz\|−hw)` clamped in the usual… | open |
| 4 | major — `vegetationSuppressed()` has no clause for the circuit, the roads or the bridges: at (−43.4,−40.3) it returns false while the point is 4.69 m from the centreline of a 10 m track, i.e. 0.31 m inside the kerb. | gameplay | src/content/world-environment.ts:568 — `vegetationSuppressed` is a point-in-polygon test over an AREA list, and the file's own comment (line ~528) declares the omission deliberate: "The track, the… | Keep the polygon list for areas and add the corridors inside `vegetationSuppressed` itself, in src/content/world-environment.ts: `lineDistance(x, z, CIRCUIT_TRACK) < CIRCUIT.width / 2 + 1.4` and the same test per road at `width/2 + 1`,… | open |
| 5 | major — World.scatterProps places props with a fourth, hand-rolled copy of the placement oracle that has no coast test and tests venues by their discovery radius: 4 untagged crates stand outside the coastline (up to 5.9 m out to sea) and one cone stands on the… | gameplay | src/world/world/World.ts:479-529, `place()`. Its comment at line 492 states the choice: "this is a road test and not a call to `isFree`". It tests roads, the circuit corridor, `PLAY_SPOTS.some(p =>… | Replace the body of `place()` with a call to `isFree(x, z, { clearance: 1, coastMargin: 5, allow: ['plate'], margin: { road: 1, circuit: 1, ramp: 3, respawn: 6, play: 0 } })`, keeping the ramp landing-corridor test as an `extra` zone if… | open |
| 6 | major — Every one of the 84 instanced meshes in the scene is unnamed and none carries userData.kind, so nothing scattered on the ground can be attributed to a system by inspection — which is why the surface audit filed wind-blown leaves, weather particles and… | visual | Nothing sets `mesh.name` or `mesh.userData.kind` at any of the eight creation sites: Ecology.ts:~300 (per chunk per layer), Props.ts:364, SceneryDetails.ts:440, CircuitRace.ts:367/409/652/737/786,… | One line at each creation site. Names: `ecology/trunk\|crown\|conifer\|bush\|grass\|flower\|rock/<chunkX>_<chunkZ>`, `ecology/leaves`, `ecology/birds`, `props/<kind>`, `scenery/reeds`, `scenery/wood\|metal\|stone`, `race/tyre-wall`,… | open |
| 7 | minor — The TNT venue's 24 × 12 m levelled pad wears full-density GPU lawn, unlike every other venue pad on the island. | visual | src/world/world/Terrain.ts:1067 — the mask's play-spot fallback does `if ('pad' in spot && spot.pad) continue // its polygon is in VEGETATION_EXCLUSIONS`, which is true for bowling and maze and… | Stop hand-listing the padded venues. In src/content/world-environment.ts derive the pad entries of VEGETATION_EXCLUSIONS from PLAY_SPOTS — `PLAY_SPOTS.filter(p => 'pad' in p).map(p => ({ id: p.id, polygon: rectangle(p.pad.x, p.pad.z,… | open |
| 8 | minor — SceneryDetails' 1,800 reeds consult no placement oracle at all — neither isFree nor vegetationSuppressed — and 17 of them stand inside the circuit's 5–8.4 m run-off band. | visual | The reed loop was written against the water geometry only, and the water geometry is the one thing that crosses every corridor on the island. The river passes under two bridges and beside the… | Add the one call the rest of the file already makes: `if (!isFree(x, z, { clearance: 0.3, coastMargin: 4, dry: false, margin: { road: 1, bridge: 1.5, circuit: 1 } })) continue` before the matrix write, with `dry: false` because a reed is… | open |
| 9 | major — The island carries 39 trees against the ecology's own target of 150 at full quality — 26 % of what the code asks for. | visual | src/world/world/Ecology.ts:172-176. Each dart must clear `vegetationSuppressed`, then `allowed(x, z, 2.6)` — which is `isFree` with coastMargin 10, circuit margin 3, ramp 8, road 2.5 — and then a… | Do not raise `treeTarget` — the comment is right that it does nothing. Instrument first: have the tree loop count rejections by cause the way `planDecor` does (`vegetationSuppressed`, coast, circuit, road, water, spacing) and print them… | open |
| 10 | major — There is no shared answer to "where does this thing sit and may it sit there": five scatter systems consult four different oracles, and two of them consult none. | gameplay | world-layout.ts was written to be the one door and it succeeded for the horizontal question in five of seven systems, but it answers only "is this ground free". The vertical question ("what y does… | One module-level pair in src/content/world-layout.ts and src/world/world/Terrain.ts, per brief §53. (1) `isFree(x, z, rules)` stays the single horizontal oracle and gains the rect footprints and the corridor-aware `vegetationSuppressed`… | open |

CORRECTIONS TO THE BRIEF'S PREMISES, all measured. 1. The instances "on the racing surface at (-43.4,-40.3) and (-46.8,-40.7)" are NOT vegetation. They are a Props `cone` (tag 'cones', 65-instance mesh) and a Props `ball` (20-instance mesh), and both carry disturbed=true — they rolled there after being ejected at spawn. Zero plants stand on the racing surface, on a road, on a ramp, on the bowling lane or on the maze floor. `vegetationSuppressed()`'s circuit hole is real and worth closing, but it is latent, not the cause of what the audit saw. 2. The instances "on the mazeApproach pad at (67.9,6.4), (70.7,6.4), (80.4,2.6)" are not on anything. physics.obstacleAt equals the terrain height at…


### WATER

> The shore PROFILE is genuinely good — all 39 transects of world-shore-check.mjs pass with margin (worst ocean slope 27.8°, worst lake 23.4°, river 15.8°, and no waterline deeper than 0.41 m at 4 m in), and there is no z-fighting anywhere: four water meshes, no duplicates, and the only footprint overlap (the west lake's bed dipping below sea level) is currently discarded by the ocean's own coarse tessellation. What is wrong is everything the shore check does not look at: the bridge is 0.49 m out of level with its own road on the centreline and 1.13 m at the worst corner because its approach blend is damped by a river-distance field that is not aligned with the deck; the ground canvas paints no lake or river bed at all and its sand band is a normal-offset polygon that disagrees with the grass mask by up to 5 m; the east ramp's landing shoal reads as a rectangular pale tongue 33 m wide…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | major — The road meets the bridge deck at a 0.49 m step on the centreline and a 1.13 m step at the worst corner, and the deck's end corners are simultaneously buried 0.30 m on one side and floating 0.50-0.68 m clear of the ground on the other, at BOTH ends. | physics | src/world/world/Terrain.ts:990. The bridge-approach blend is `dry = 1 - smoothstep(waterHere.edge, -BANK_WIDTH, 0)`, where `waterHere` is `inlandWater(x, z)` at the sample point. The river crosses… | In the BRIDGES loop in `Terrain.heightAt` (src/world/world/Terrain.ts:982-996), evaluate `dry` on the deck's own CENTRELINE rather than at the sample point: project the point onto the deck axis (signed `s = dx*cos + dz*sin`) and call… | open |
| 2 | major — The east ramp's landing shoal is declared to reach 115 m past the lip and fade over the last 30, but the heightfield ends 75.4 m past the lip: 39.6 m of the shoal and its entire fade do not exist, and anything landing past 75.4 m has no collider under it at… | gameplay | src/world/world/Terrain.ts:231-233 (LANDING_REACH = 115, LANDING_FADE = 30) versus src/world/world/Terrain.ts:52 (FIELD_HALF = 175). The shoal's reach was chosen against the flight distance and… | Either shorten the shoal so it finishes inside the world — LANDING_REACH 70 with LANDING_FADE 22 puts the flat part at 48 m and the fade complete by 70 m past the lip, entirely inside x=175 — or, if the jump really does need 78 m, move… | open |
| 3 | major — The landing shoal renders as a hard-edged rectangular pale-mint tongue about 33 m wide running 75 m straight out to sea from the east coast, ending in a straight cut at the edge of the world, with 15 m deep water immediately either side. | visual | src/world/world/Terrain.ts:855-861. `sides = 1 - smoothstep(across, half, half + 12)` gives the shoal a fixed 12 m lateral fade regardless of how deep the natural sea bed has become. At the lip the… | Make the lateral fade proportional to the drop it has to cover instead of a constant 12 m: in the same block, compute the natural bed height at the corridor edge (the value of `height` before the shoal is applied is already in hand) and… | open |
| 4 | major — The ground canvas paints no lake bed and no river bed: both are painted the grass base and the woodland tint, and under 0.5-0.6 m of water that green shows through at ~43% opacity, so the river reads as a pale strip of lawn and the lake shallows read as green. | visual | src/world/world/Terrain.ts `paintGround` (lines ~1387-1500). It paints the ocean's beach bands from the ISLAND polygon and then fills everything inside coastPath(0) with dry sand and coastPath(-16)… | In `paintGround`, after the grass base fill and BEFORE the woodland-tint loop, paint the water beds: for each LAKE ellipse `ctx.ellipse(toPx(e.x), toPx(e.z), e.rx*scale, e.rz*scale, ...)` filled with a wet-sand/silt colour (the existing… | open |
| 5 | minor — The painted dry-sand band and the grass mask disagree around the whole island: full-density GPU grass grows on painted sand for a ~5 m band on some bearings, and on others the sand band is only 2 m wide. The painted band's width varies from about 2 m to 16 m… | visual | src/world/world/Terrain.ts:1471-1476. The dry-sand band is 'fill everything, then fill grass-green inside `coastPath(-16)`', and `coastPath` (via `shorePath`, line 1411) offsets each polygon VERTEX… | Draw the sand band as a STROKE on the coastline instead of the difference of two offset fills: fill the grass base inside `coastPath(0)`, then `ctx.strokeStyle = '#ded4ae'; ctx.lineWidth = 22 * scale; coastPath(0); ctx.stroke()` — a… | open |
| 6 | major — Seven props sit fully under water and seventeen more are partly submerged, including the landing's 26-piece domino run, which walks straight into lake-south with three dominoes completely under and eleven half-drowned. | visual | src/world/world/World.ts:494-528, the `place()` guard. It rejects a position that is in a carriageway, on the circuit, inside a PLAY_SPOT radius, within 6 m of a respawn, or on/near a ramp — and has… | Add one clause to `place()` alongside the existing ones: `const w = inlandWater(x, z); if (w && w.edge > -1) return;` and `if (coastInset(x, z) < 1) return;`. `inlandWater` and `coastInset` are already imported in World.ts. Rejecting a… | open |
| 7 | major — The circuit's outer racing edge is outside the coastline for 53 m of a 633 m lap, at worst 7.53 m out to sea where the ground is 0.07 m above sea level, and its centreline runs within 12 m of the coast for 172 m — 27% of the lap. | gameplay | src/content/world-environment.ts, the CIRCUIT control points. The plan's west-north-west run was traced against a coastline it now overhangs; the shore stage in Terrain.heightAt runs after the… | This belongs to the CIRCUIT area, not to mine — nothing in Water.ts or the shore stage should change to accommodate it. What this area needs from that fix is the constraint: any move must bring the OUTER edge back to coastInset >= +4 m… | open |
| 8 | minor — The ocean plane's per-vertex depth attribute is sampled on a 12.5 m grid, so the quantity that drives the water's colour ramp, its shore-foam band and its alpha is wrong by up to 1.35 m — 72% — in the shallow band, and the shader's discard edge sits 0 to 4.5… | visual | src/world/world/Water.ts:81. One 1600 m plane at 128 segments has to cover both the open sea (where 12.5 m is generous) and the 32 m shelf around the island (where it is four samples across the… | Do NOT add a second, finer water plane over the island — two transparent surfaces at the same y is the z-fighting failure mode this file's own comment (Water.ts:8-11) exists to avoid. Instead build the ocean as ONE geometry with two zones… | open |
| 9 | minor — About 54 square metres of the west lake's bed lies up to 0.83 m below OCEAN_LEVEL, so the ocean plane's footprint overlaps the lake plane's there with 1.80 m of vertical separation. It is invisible today only because the ocean's coarse grid discards those… | visual | LAKE_BODIES gives lake-west level -0.7 and depth 2.6 (src/content/world-environment.ts:265), so its deepest bed is -3.30, and OCEAN_LEVEL is -2.5 (line 253). The two numbers were chosen… | Raise lake-west's `depth` from 2.6 to 1.7 (bed floor -2.40, 0.1 m above sea level) in src/content/world-environment.ts:265, or lower OCEAN_LEVEL — the first is far less destructive, since OCEAN_LEVEL sets the width of every beach on the… | open |
| 10 | minor — The painted sand stops about 6 m before the shelf does, so a ring of sea bed still only 0.50-0.60 m deep, all the way round the island, is painted in the off-map backdrop colour instead of sand. | visual | src/world/world/Terrain.ts:1439. The `26` in `coastPath(26)` was chosen when BEACH.shelf was 15 and never moved when the shelf was widened to 24 (see the comment at Terrain.ts:218-227, which records… | Change `coastPath(26)` to `coastPath(34)` in src/world/world/Terrain.ts:1439 — BEACH.wade + BEACH.shelf + 2 m of margin — so the painted shelf ends where the sea bed actually drops away. One number. Better still, derive it:… | open |

Q1 — `node scripts/world-shore-check.mjs http://localhost:51262` exits 0 with 0 failing transects. Verbatim, transect by transect (thresholds: max slope 30 deg, wadeable 0.8 m at 4 m in): OCEAN, 12 bearings, all ok. 0deg 27.0deg at -4.4 m, +4m 0.05, +12m 0.31 \| 30deg 27.5 at -4.4, 0.05, 0.32 \| 60deg 24.8 at -5.0, 0.04, 0.27 \| 90deg 27.3 at -4.9, 0.06, 0.33 \| 120deg 25.7 at -4.4, 0.05, 0.29 \| 150deg 26.4 at -4.4, 0.05, 0.31 \| 180deg 27.3 at -4.4, 0.06, 0.33 \| 210deg 27.5 at -4.4, 0.06, 0.33 \| 240deg 24.7 at -4.4, 0.05, 0.28 \| 270deg 27.8 at -11.6, 0.07, 0.34 \| 300deg 25.9 at -5.0, 0.05, 0.31 \| 330deg 25.9 at -4.9, 0.05, 0.29. LAKE-WEST-0: 0deg 11.1/-7.3/0.14/2.10 \| 90deg…


### RENDER

> The render layer is architecturally sound — one WebGLRenderer, one composite pass, two lights, a shared material library, and the whole world drawing in 105 main-pass draw calls at 0.42 ms on an M2 Max. Three things are actually wrong. (1) Flat ground decals — the district boundary rings, the district name labels and every landmark marker ring — are positioned from a single terrain height sample at their centre, so they slice through the ground: one ring is 4.28 m underground on one side and 1.59 m in the air on the other, two labels are fully buried and invisible, and ten marker rings dip below the ground. (2) The road ribbon's alpha-tested verge dissolve is driven by a sin-based hash evaluated at world-metre coordinates up to 2018 lattice units, where fp32 sin has lost all its precision; instead of scattered earth it cuts the 2 m verge band into hard axis-aligned blocks with 1-cell…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — The roads ribbon's alpha-tested verge dissolve degenerates into hard axis-aligned blocks 1-4 m across with 1-cell horizontal stripes, covering the ~2 m dissolve band on both sides of every road on the island. It is the worst surface artefact in the world at… | visual | src/world/world/Roads.ts:532-533 — `float rdRagged = rdNoise(metres*1.4) + rdNoise(metres*5.1)*0.35; diffuseColor.a = (1.0-rdScuff)*1.6 + (rdRagged/1.35-0.5)*0.85;` against `alphaTest: 0.5`… | In src/world/world/Roads.ts, replace `rdHash` with a precision-safe integer hash — GLSL ES 3.0 is available here, so `uint h = uint(p.x)*747796405u ^ uint(p.y)*2891336453u; h ^= h>>16; return float(h & 0xffffffu)/16777216.0;` on the… | open |
| 2 | **BLOCKER** — District boundary rings and district name labels are flat geometry placed at a single terrain height sampled at the district centre, so they cut through the ground. The worst ring is 4.28 m below the terrain on one side and 1.59 m above it on the other — a… | visual | src/world/world/World.ts:410-411 and 425 — `const y = this.terrain.colliderHeightAt(district.x, district.z)` is sampled ONCE at the centre, then `ring.position.set(district.x, y + 0.04, district.z)`… | Build these two decals as conforming ribbons instead of rigid primitives, the way Roads already does. For the ring: generate the annulus as a triangle strip of 96 segments and set each vertex's y to `terrain.colliderHeightAt(x, z) + 0.04`… | open |
| 3 | major — `markerRing` — the vermilion ring under every interactive landmark — is placed 6 cm above the landmark group's origin, which is one terrain sample. Ten of the twenty rings dip below the ground, the worst by 1.58 m; several others float up to 2.2 m in the air. | visual | src/world/world/Landmarks.ts:171-188 — `markerRing` builds `new THREE.RingGeometry(radius, radius+0.22, 64)`, rotates it flat and does `mesh.position.y = 0.06`, i.e. 6 cm above whatever height the… | In src/world/world/Landmarks.ts, change `markerRing` to take the terrain and write per-vertex heights: build the ring as a non-indexed strip and set each vertex y to `terrain.colliderHeightAt(worldX, worldZ) - groupY + 0.06`. The helper… | open |
| 4 | major — Five pairs of surfaces are EXACTLY coplanar — 0.0000 m separation over 100% of sampled points — so they z-fight at any viewing distance, not just far away. | visual | Two independent causes with the same shape. The marker rings and district labels are placed at a height derived from the terrain, and the things they land on (the bowling slabs at… | Three small changes. (1) In src/world/world/materials.ts `flat()`, set `depthWrite: opacity >= 1` — a transparent unlit decal should never write depth. (2) Give the ground-decal layer one shared height ladder instead of ad-hoc constants:… | open |
| 5 | major — Texture memory is 152.3 MB across 120 textures, and 129.9 MB of that is 62 unbounded canvas label textures — a single sign is 2595x497 px (6.56 MB with mips) for 8 m of world, about 3x more texels than the screen can ever show. | perf | src/world/world/materials.ts:245-270 — `textTexture` sizes the canvas from the MEASURED TEXT: `canvas.width = ceil(contentWidth + padding*2)` where contentWidth is `measureText` at `size` px per… | Cap the canvas in `textTexture`: after computing canvas.width/height, if width exceeds a MAX (1024 is 4x the longest sign's screen width at this camera) scale `size`, `padding` and `letterSpacing` down by MAX/width and re-measure once.… | open |
| 6 | minor — The shadow pass costs more draw calls than the visible pass: 152 shadow draw calls against 105 for the whole scene, for 160k of the frame's 849k triangles. | perf | src/world/world/Lighting.ts:169-176 — the shadow camera is a 116 m box (shadowExtent 58 half-extent) centred on the player, while the main camera is a 25-degree lens. Everything with castShadow… | Do not shrink the box — the 5.7 cm/texel it gives is what keeps kerb edges readable. Instead cut the number of casters: set `castShadow = false` on anything whose shadow cannot be distinguished at this camera — the playground letters' 16… | open |
| 7 | minor — Shadows are detached from their casters by up to 15.7 cm along the light, which at the lowest sun the world reaches (35.5 degrees, phase 0.38) is 17.6 cm of horizontal peter-panning. The code comment describing the shadow texel size is also wrong by a factor… | visual | src/world/world/Lighting.ts:180 — `this.sun.shadow.bias = -0.0006`. The comment above it says normalBias was made to do the work instead of the constant bias, but the constant bias was left at a… | In src/world/world/Lighting.ts configureShadow(), drop the constant bias to about -0.0001 (2 cm of world depth over the 209 m range) and leave normalBias to handle the slope-dependent case, which is what the comment already says the… | open |
| 8 | minor — 185 redundant material objects exist across 20 duplicate signatures. The genuinely mergeable ones are 14 identical marker-ring materials, 9 identical district-ring materials, 16 playground-letter materials in two colours, and 5 identical circuit light… | perf | src/world/world/Landmarks.ts:174-182 and src/world/world/World.ts:415-424 each call `new THREE.MeshBasicMaterial(...)` inside a per-object loop and wrap it in `materials.own()`, which registers it… | Replace the inline `new THREE.MeshBasicMaterial` in `markerRing` (Landmarks.ts:174) and in buildDistrictFurniture (World.ts:415) with a cached lookup. `Materials.flat()` almost fits but does not carry side/depthWrite, so either add two… | open |
| 9 | minor — Six meshes are never visible: three amber turntable chevrons buried 0.74-1.44 m under the terrain, two district name labels buried 0.45 m under it, and one mesh with zero vertices. | visual | The chevrons are src/world/world/Attractions.ts:1116-1121: eight `chamferedBox` marks placed on the turntable pivot at a fixed `P.thickness*0.5 + 0.08` above the pivot origin. The pivot sits at one… | Fixing the district-furniture and turntable placement (see the conforming-decal findings) makes four of these five buried meshes visible again, which is the right outcome — they are content, not litter. For the turntable specifically, the… | open |
| 10 | minor — Shader programs are still being compiled while the player drives: 71 after precompile() at the landing, 78 at the circuit, 84 at the bowling alley. Each new program is a compile stall on the frame it happens. | perf | src/world/render/Renderer.ts:284 — `precompile()` calls `this.instance.compile(this.scene, this.view.camera)`. In three 0.185 `compile` walks the scene and compiles what it finds, but a material… | Call `renderer.compileAsync(scene, camera)` (three 0.185 has it) rather than the synchronous `compile`, and call it again once after each minigame's venue is built rather than only at the end of Game.init. Alternatively keep the single… | open |

PERFORMANCE BASELINE — the number the pass is compared against. 1280x800, devicePixelRatio 1, quality 'high' (shadowMapSize 2048, antialias on, postProcessing on), ANGLE Metal on Apple M2 Max, headless Chromium. Measured with renderer.info.autoReset off over 40 back-to-back renders with gl.finish, plus 120 rAF frames for wall-clock. Landing (54.4, 1.2, 6): 257 draw calls total / 105 main-pass, 849,122 triangles total / 689,032 main-pass, 179 GPU geometries, 12 GPU textures, 71 programs, 0.70 ms per render, 16.7 ms frame (vsync-capped, 59.9 fps). Circuit (-55.8, 1.8, 8.9): 240 / 117 calls, 861,877 / 705,561 triangles, 253 geometries, 16 textures, 78 programs, 0.67 ms. Bowling (-6.2, 4.5,…


### DEVTOOLS

> The debug visualisation and the harness suite are both real and both better than average — LayoutDebug is genuinely stripped from production (proved against the .next-verify build), the registry reports 100 footprints with 0 conflicts and 0 respawn problems, and several scripts carry explicit anti-vacuity guards written after being burned. But the pass's own instrument is blunt in three measurable ways: world-surface-audit.mjs has no exit code at all (it prints 200+ FAIL lines and returns 0), it censors its prop count at 80 when the true number is 1016, and LayoutDebug draws two whole categories of the section-61 list — grass exclusions and square gameplay pads — as zero-extent points (9 of 9 noveg outlines and 6 of 14 play outlines have dx=dz=0). Section 62's warnings have no home yet, and the evidence that they would fire already exists: two instanced objects stand 1.61 m and 4.69 m…

| # | Problem | Kind | Cause | Fix | Status |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCKER** — scripts/world-surface-audit.mjs — the audit this whole pass is aimed at — never sets an exit code. It prints 207 circuit FAILs, 11 road FAILs, 3 of 5 pad FAILs and 2 of 3 ramp FAILs and returns 0. | gameplay | scripts/world-surface-audit.mjs:562 — the script was written as a reporter (`written → .qa/surface-audit.json`) and never given the `process.exit(failures ? 1 : 0)` tail that… | Add an `--assert` flag (default on when a `--gate` is passed, so ad-hoc reporting still works) that walks the report it already built and exits 1 on any FAIL, and — crucially — on any COVERAGE FLOOR miss: circuit stations sampled !== 480,… | open |
| 2 | major — The prop report is censored at 80 and then prints the censored number as the total. The true count of instances off their ground is 1016 — 992 floating above, 24 buried below. | gameplay | scripts/world-surface-audit.mjs:398-433 — the cap was added to keep the JSON small and the count was taken from the capped array instead of from a separate counter. Compounding it, the check… | Two lines plus one narrowing. (1) Count into `let offenders = 0` incremented unconditionally and report `{ offenders, sample: bad }` so the printed total is the real one and the cap only truncates the sample. (2) Narrow the population to… | open |
| 3 | major — LayoutDebug draws every grass-exclusion zone as a zero-radius circle: 9 of 9 `noveg` outlines have zero extent in both axes, so the one item of section 61 that is nominally already covered is invisible on screen. | visual | src/world/world/LayoutDebug.ts:108-141 — `build()` has exactly two shapes: a `zone.points` corridor and an rx/rz/radius ring. A `noveg` zone is neither: world-layout.ts:369-377 gives it `polygon`,… | Add a third branch at the top of the loop, before the `zone.points` test, in src/world/world/LayoutDebug.ts:108: `if (zone.polygon) { const pts = zone.polygon.map(([x,z]) => new THREE.Vector3(x, lift(x,z), z)); pts.push(pts[0]);… | open |
| 4 | major — A square play-spot pad registers as a degenerate zero-length capsule, so the labyrinth's footprint is a 23.9 m disc inside a 47.8 m square — 9.9 m of each corner is unreserved ground — and the debug view draws the largest structure on the island as a single… | gameplay | src/content/world-layout.ts:293-313 — the capsule endpoints are `hx = (pad.length/2 - pad.width/2) * cos`, `hz = ... * sin`, which are identically zero when length === width. The comment above it… | In `zones()` at world-layout.ts:293, when `Math.abs(pad.length - pad.width) < 1e-6` emit a `polygon` (the four rotated corners) instead of a `points` capsule, so `distanceToZone`'s existing polygon branch (world-layout.ts:428-431) handles… | open |
| 5 | major — Three of section 61's seven layers are not drawn at all: the terrain mesh, platform heights, and the coastline / ocean boundary. | visual | src/world/world/LayoutDebug.ts:103 — the view's only input is `zones()`, which is an occupancy registry, not a terrain description. Height and the coast live outside it: heights in… | Smallest extension that closes all three, reusing what is there. (a) COAST: push two synthetic display-only zones built from ISLAND and ISLET polygons into the draw loop — with the polygon branch from the finding above they cost six lines… | open |
| 6 | major — Section 62's four warnings have no home, and at least one of them would fire today: two instanced objects stand on the racing surface, 1.61 m and 4.69 m from the centreline against a 5.00 m half-width. | gameplay | There is no validator that crosses the vegetation/decor inventory with the gameplay masks. `validateLayout()` compares authored footprint against authored footprint; the surface audit measures… | BOTH, but with the authority in one place. Add `validatePlacement(): LayoutConflict[]` to src/content/world-layout.ts beside `validateLayout()`, returning the same `{a, b, overlap, message}` shape, covering the three checks that are… | open |
| 7 | major — Ten harness scripts can report a pass having measured nothing — the exact failure mode scripts/_roads.mjs:15-22 was written to end. | gameplay | The suite has the guard idiom (_roads.mjs:19-22 throws, _extra.mjs:43-46 throws, world-minigame-qa.mjs:54 `if (!list.length) throw`, world-loop-drive.mjs:231, world-tour.mjs:206-211,… | One shared helper, mirroring _roads.mjs's voice, in a new scripts/_floor.mjs: `export const atLeast = (n, actual, what) => { if (actual < n) throw new Error(`[floor] ${what}: measured ${actual}, expected at least ${n}`) }`. Then one call… | open |
| 8 | major — There is no single npm script that gates this pass; the three checks that matter are spread across two commands and one that cannot fail. | gameplay | The surface audit was added after the npm script table was written and never joined it. | Add one script: `"world:gate": "node scripts/world-layout-check.mjs && node scripts/world-decor-check.mjs && node scripts/world-surface-audit.mjs --assert ${WORLD_BASE:-http://localhost:3000}"`. It should assert, in that order: (1)… | open |
| 9 | minor — Terrain.heightAt is a pure function with zero `this.` references, but it is a method on a class whose constructor needs Physics, Quality, Materials and a live WebGL context — which is why 22 of 24 world-* harnesses need Playwright and a ~2.5 s boot to ask… | perf | heightAt was written as a method because it lives beside the collider and mesh builders that consume it; nothing ever needed it outside the class until the harness suite grew. | Extract lines 580-1000 verbatim into a THREE-free module — src/content/world-height.ts, next to world-layout.ts and world-environment.ts, importing only maths helpers and the content tables it already reads — and leave `Terrain.heightAt`… | open |
| 10 | minor — LayoutDebug's header comment claims it 'registers no listeners and builds no geometry until the first toggle'; the constructor registers a window keydown listener unconditionally. | gameplay | The comment was written about the geometry and over-generalised to listeners. | Change the sentence to 'it builds no geometry until the first toggle' in src/world/world/LayoutDebug.ts:24-25. In a codebase where comments carry this much load, a comment that is wrong about its own class is worse than no comment. | open |
| 11 | minor — The production bundle ships a console banner telling visitors that `window.__world` is live, and the 88 KB dev-only map plan is deployed to public/ though it is never requested. | gameplay | printConsoleNote is an easter egg that ships on purpose; the __world lines inside it were copied from the dev handle's documentation. | In src/world/systems/Secrets.ts:246-249, wrap just the four `__world` lines in `process.env.NODE_ENV === 'development' ? ... : ''` so the achievement banner still ships and the dead instructions do not. Leave public/dev/map-plan.webp… | open |

ANSWERS TO THE FIVE QUESTIONS, with what I measured. 1. WHAT EXISTS AND IS IT STRIPPED. Two dev-only classes, both constructed only inside `if (process.env.NODE_ENV === 'development')` at src/world/Game.ts:429-431, both taking the Game's Bin so they tear down with it. - LayoutDebug (SHIFT+L, or `__world.layoutDebug.toggle()`): builds a THREE.Group at renderOrder 999 holding one Line per footprint, lifted 0.35 m over `colliderHeightAt`, depthTest:false, coloured by ZoneKind (13 colours, LayoutDebug.ts:28-42), with `district`/`forest`/`noveg` at 0.28 opacity and everything else 0.85. Corridors draw as centreline + both edges; circular/elliptical zones draw as 48-segment rings; respawns get a…
