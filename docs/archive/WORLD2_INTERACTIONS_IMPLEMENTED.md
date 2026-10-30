# World 02 — the interaction layer

`/world2` already had the map, the car, the camera and the physics. This
documents the layer that was added on top: what makes the island *do*
something.

The rule throughout: **Blender owns geometry, this code owns behaviour.** No
position, rotation, collider or span in `src/world2/interactions/` was typed by
hand. Every one is read from `folio-2025.blend`, either through the exported
`world.glb` or through `public/world2/interactions.json` for the handful of
references the export deliberately filters out.

---

## 1. The binding layer

```
folio-2025.blend
   │  scripts/export-world2-blender.py      (already existed)
   ├─► public/world2/models/world.glb       w2Source, w2Role, w2Body, w2Collections …
   │  scripts/gen-world2-interactions.mjs   (new)
   └─► public/world2/interactions.json      the references the GLB filters out
                    │
                    ▼
          World2Environment  ──►  References  ──►  one controller per area
                                      │
                                      └─► Prompts (the 3D interaction points)
```

**`src/world2/interactions/references.ts`.** Upstream finds its objects by
regex over sanitised glTF node names (`refLettersPhysicalDynamic.010` →
`refLettersPhysicalDynamic010` → key `letters`, index 10) and then relies on
`Area.setObjects` having mutated every child's `position` from area-local to
world. Our export is kinder: every node carries `w2Source`, the exact Blender
name, and `w2Collections`. So a lookup here is the authored name, and world
transforms come from `matrixWorld` rather than from an invisible in-place
mutation. `node()`, `series()`, `collection()`, `position()`, `transform()` and
`physical()` are the whole API.

**`scripts/gen-world2-interactions.mjs`.** The exporter drops query-only and
render-hidden objects. Four kinds of thing gameplay needs were in that set: the
eight race gates, the thirteen board hit targets, the six career text planes
and the sign curve. This script reads them out of `world2-blender-audit.json`
(itself written from the .blend), converts Blender Z-up to glTF Y-up with the
exporter's own basis change, and writes `public/world2/interactions.json`. No
Blender install needed, and it is reproducible from the same source hash.

**Reserved names.** `World2Environment.addPhysics` builds a body for anything
named `*Physical*` and a static trimesh for everything else big enough. Four
groups needed different treatment, so the interaction layer claims them before
the level builds anything: the title letters (replaced), the explosive crates
(must be light dynamic bodies, not scenery), the bowling pin template and ball
(the mini-game owns their mass and their reset), and anything named
`*KinematicPositionBased*` — the string contains no "dynamic", so the level's
name test made the circuit hazards and the bowling bumpers *static*, which is
why they could not move.

## 2. Interaction points

`src/world2/interactions/Prompts.ts`, ported from
`sources/Game/InteractivePoints.js`.

A diamond outline with a label that wipes out sideways and a key glyph that
pops in, drawn in the world at the authored `ref…InteractivePoint` empty, at a
fixed 45° yaw and −27° pitch, scale 0.85. Upstream's exact uniform values are
kept: threshold 0.5 / thickness 0.075 / offset 0.150 when open, 0.25 / 0.150 /
0.175 when concealed, 2.5 m proximity, 0.2 m movement gate.

Two deliberate changes. The TSL node materials are re-expressed as WebGL
`ShaderMaterial`s, because this renderer is not WebGPU. And `update()` picks
the **nearest** point in range: upstream declares `let distance = Infinity` and
never reassigns it inside the loop, so its test is always true and the last
point in insertion order wins — harmless with one prompt in range, wrong on the
social arc where several sit close enough to overlap.

The key glyph follows the input mode: an enter arrow for keyboard, an A button
for gamepad, and nothing at all on touch, where the HUD shows a labelled button
instead.

19 prompts are live across the island, and every one of them was walked up to
and pressed in the QA harness.

One bug worth recording: this class used to subscribe to the `interact` action
itself, *and* `World2Game.interact()` routed to it. Every callback fired twice.
That is invisible on a one-shot and fatal to a toggle — the map, the controls
panel, the achievements panel and the bowling bumpers all appeared dead.
`World2Game.interact()` is now the single entry point for the key, the gamepad
and the touch button.

## 3. TNT

`Explosions.ts` + `ExplosiveCrates.ts`, from `World/ExplosiveCrates.js`,
`Explosions.js` and `World/Fireballs.js`.

Each crate is a 0.02 kg dynamic body with one 0.5-half-extent cuboid, asleep
until something touches it. A contact lights a 0.4 s fuse; then the crate
disappears and `Explosions.explode(at, 5, 8)` runs upstream's impulse formula
unchanged — a horizontal away-vector forced to 45° up, faded linearly from 1 m
to the blast radius, scaled by each receiving body's own mass.

**The chain reaction is not scripted.** The blast shoves the neighbours, the
neighbours register a contact, their own fuses light. That is exactly how
upstream does it and it is why the delay matters.

One difference: upstream sets `contactThreshold: 0`, so brushing a crate at
walking pace detonates it. A 2 N threshold is used instead — above a crate's
own 0.2 N resting weight, below anything a player would call driving into it.

The effects are rewritten rather than ported: upstream's fireball is a TSL node
material sampling a perlin texture in three planar projections, so the same
triplanar blend is done here with hashed value noise in GLSL and no texture at
all. Fireball, smoke, debris and flash are pooled and reused for the life of
the route; `clear()` drops everything on a world reset.

## 4. The circuit

`Circuit.ts`, from `World/Areas/CircuitArea.js`.

**The access bug.** `refRailsPhysicalFixed` is a 150 × 20 × 168 m trimesh
ringing the whole track. Upstream enables its collider only for the duration of
a race; our exporter keeps every authored collider live, so it stood as a
permanent invisible wall and the circuit could not be entered. Its collider is
now enabled only while a race runs, and it is never drawn — Blender marks it
`hide_render`. The barriers around the track itself are untouched; only this
guard moves.

**And its sting in the tail.** The level builds the rails in the `floor`
category, whose membership includes the `terrain` group — which is exactly
what the camera's obstruction ray queries. So raising them for a race put a
20 m wall a few metres from the lens and the camera pulled itself in from
21 m to 12, every time, which read as an unexplained zoom onto the car. The
rails are in the `object` category now: still solid to the chassis and to
every prop, and invisible to the camera probe.

Everything else is the authored level: the grid from `refStart`, eight gates
from `refCheckpoints.000–.007`, the lights from `refStartingLights`, the clock
from `refTimer`, the board from `refLeaderboard`, the five sliding hazards from
`refObstacles…`.

- **Gate geometry** reproduces upstream exactly: the line runs along
  `(cos(−rotY), sin(−rotY))` for `scale.x / 2` either side; the respawn sits
  3 m through the gate at `(sin rotY, cos rotY)` with heading `rotY + π/2`.
  Verified against the upstream reference table gate for gate.
- **Crossing** is upstream's 2-D segment-circle test at radius 2, and only
  against the *current* target, so you cannot skip most of the lap. Nine
  crossings are needed: gate 0, then 1–7, then gate 0 again.
- **Timer** is `MM:SS:MMM`, drawn on an in-world board that rides beside the
  car while racing and returns to `refTimer` afterwards.
- **Respawn** during a race goes to the last gate crossed, not the world spawn.
- **Leaderboard**: per browser, top ten, painted on the authored
  `refLeaderboard` sign itself. See §9.
- **Starting gantry**: the beam carries three lamp holes and
  `refStartingLights` is the plate behind them, so the housing gives the lamp
  its shape and the plate only has to fill it — one lamp per beat, all three
  green on GO. Upstream slides the same plate along Z to work its lights;
  ours is slid 0.12 m to seat it in the holes, because our exporter makes
  every material double-sided and the beam's own back face was covering it.
- **No podium.** It is authored beside the grid, on the racing line, for a
  ceremony this world does not hold. Hidden and unbodied.

## 5. Bowling

`Bowling.ts`, from `World/Areas/BowlingArea.js`.

Ten dynamic bodies at the authored `pin0`–`pin9` transforms, each carrying the
two cylinders stripped off the `refPinPhysicalDynamic` template, all drawn
through one instanced mesh. Masses and damping are upstream's: pins 0.02 kg,
friction 0.5, angular damping 0.5, contact events above 5 N. The ball is an
ordinary 0.38 kg dynamic sphere — the car hits it, it rolls, nothing about its
path is scripted.

A pin is **down** when its own up-axis, rotated by the body, has a world Y
below 0.5 — sixty degrees of tilt — and the state is latched until reset, which
is what stops a pin wobbling on its base from flickering the board.

The board is the authored one. `refDiscs` and `refCrosses` each carry ten
symbols whose UVs address one texel of a 10 × 1 data texture, and the inactive
symbol is pushed 0.1 back along local Z so the screen casing swallows it —
upstream's trick, in GLSL rather than TSL. `refLabelStrike` blinks on a 1.5 s
cycle when all ten go down. The screen drifts along the lane with the player
and bobs, on a kinematic body, as upstream's does.

## 6. Career

`Career.ts` + `content/career.ts`, from `World/Areas/CareerArea.js`.

A stretch of road *is* the CV. Drive into a stone's span and it rises 2.5 m,
then slides with you for the length of that role while its label wipes in from
the left. A four-digit seven-segment plate rides alongside and counts the
years. Upstream's smoothing constants are kept (elevation lerp 3, slide lerp
10, 0.25 m lead-in and 0.5 m run-out).

**Three tracks, not one list.** Blender authors the walk as four parallel
lanes down a 6.56 × 17.73 m plate — world X 23.039 for the year, then 25.051,
27.064 and 29.054 — over 17.0 m of road running from z +6.532 to −10.465. An
earlier pass here sorted the six authored `refLine` empties by position and
poured one flat chronological list into them, which collapses three threads
into a zig-zag. Alejandro's career is three things running at once — a degree,
a job and a project are not alternatives — so each lane carries one KIND:

| Lane | Track | From |
| --- | --- | --- |
| 25.051 | Studies | `education.ts` — KCL BSc, then UCL MSc |
| 27.064 | Work | `experience.ts` — Focus, Pansofía, KCL GTA, Metaview |
| 29.054 | Projects | `projects/*` heroes — Chess Assistant, Gym App, Cinquillo 2.0 |
| 23.039 | Year | the authored seven-segment plate |

Every lane is measured against ONE time axis, which is what makes two stones
drawing level mean *these overlapped*. A stop shorter than 2.1 m of road —
Pansofía ran three months, which is 1.06 m — is grown around its own midpoint,
so the moment a stone is level with you stays honest even when its length is
not. A project carries a year and nothing finer, so its stone covers that
calendar year and its label says the year; two heroes sharing 2026 split it
between them rather than standing on the same spot.

**One lane speaks at a time.** Every raised stone used to keep its label
printed, which put four of them over each other wherever the tracks overlap —
and they overlap for most of this road. Each lane now shows only the stop the
driver is level with, and where two of those overlap the shorter one wins,
because it is the more specific answer to "what is happening here". Blender's
own per-lane label staircase is 0.585 / 0.72 / 1.151; the ORDER is kept and
the SPACING is not, because gaps of 0.14 m and 0.43 m cannot separate a label
0.91 m tall. They are spread to 0.6 / 1.65 / 2.7 — a full label plus air.

**The year plate is the authored one, driven the authored way.** An earlier
pass hid the digits and painted a canvas instead, on the belief that the plate
stood edge-on to the road. That was wrong: every vertex of every digit's
NORMAL attribute is (0, 1, 0) and all four digit meshes are perfectly flat, so
the readout lies face-up and is read from above — exactly how the camera sees
it. Each digit is seven hexagonal bars in one geometry and its SECOND UV set
says which bar a vertex belongs to: `uv1.x` sits on one of seven texel centres
(0.0732, 0.2112, 0.3578, 0.5014, 0.6444, 0.7890, 0.9335), so
`floor(uv1.x × 7)` is the segment index, in canonical A..G order. That index
is baked into a plain `segment` attribute rather than read through three's UV
plumbing, which only declares `uv1` when a material samples it. A lit bar
rises 0.42 local units out of the plate and burns; an unlit one stays sunk in
it and goes dark. Upstream pushes along Z because its plate stands up; ours
lies face-up, so the push is along Y.

**The labels are sized to be read at driving speed.** The old ones drew four
lines of at most 54 px type on a fixed 1024 × 256 canvas stretched over a
3.13 × 0.59 m plane — 327 px per metre across but 434 down, so every glyph was
1.33× too wide, and the headline stood 12 cm tall. Each label is now sized to
its own words at one density in both axes, with a 0.34 m headline knocked out
of a solid bar of the lane's colour and a 0.21 m subtitle under it. Two lines,
nothing else: the dates are what the year plate beside the road is for. The
authored frame is kept verbatim — 45° of yaw, 15° of lean, the anchor a
quarter-metre back from the stone and a little ahead of it.

**The lane strips are redrawn, because the authored ones cannot serve.**
`Plane.018` is ONE mesh covering both the 27.064 and 29.054 runs and
`Plane.022` covers both 25.051 and 27.064, so hiding one hides two lanes; and
the export collapses blue, white and purple onto a single purple material. The
three are suppressed and each lane gets its own soft-edged strip in its
track's colour, over the full run of the road. The stones' own emissive tips
are repainted the same way, and each occupied socket in the plate gets a lit
pad, because a stone buried to its neck is otherwise just a hole.

## 7. Projects

`Projects.ts` + `screenMotion.ts` + `content/projects.ts`, from
`World/Areas/ProjectsArea.js`.

The authored board *is* the interface. `refImages` is the screen, `refTitle`
and `refUrl` are flip-boards that turn and swap their canvas at the midpoint,
`refPrevious`/`refNext` are the two wooden signs naming the neighbours,
`refPagination`'s tokens count the run, and the three `refAttributes` plates —
upstream's `role` / `at` / `with` — carry CATEGORY / YEAR / STACK.

Left alone the board runs an attract cycle through the featured work. Interact
and the camera takes upstream's cinematic pose (offsets `(4.65, 4, 4.85)` and
`(−3, 1.60, −4.60)` from the interactive point, unchanged), the car is parked,
and the input filter swaps so the same keys step through projects. Driving into
one of the wooden signs selects its project. Nothing opens over the world.

**The screen.** Upstream loads a KTX2 screenshot per project. This portfolio
has no screenshot for most of its work — several projects are private, and a
folder of stale PNGs would age badly — so each project gets a small drawn
identity instead: a chessboard being scanned with a best-move arrow, three
bodies orbiting, an order book filling, a maze solving, a packet tunnel, an
animation timeline, a rigged figure doing reps, a content pipeline. Same job as
a screenshot, nothing to rot, and it moves. The canvas is repainted at 20 Hz
and only while the board is open or within 26 m.

## 8. The physical name

`Title.ts` + `content/glyphs.json`, from `World/Areas/LandingArea.js#setLetters`.

Upstream's "BRUNO SIMON" is ten meshes baked in Blender from a Text object, one
dynamic body each, one cuboid collider each, mass 0.2, created asleep. The
*behaviour* is kept exactly. The geometry cannot be: the letters we need are
not the letters the .blend baked, and re-authoring someone else's source file
is not on the table.

So the glyphs are cut at build time from **Geist Bold** — the typeface this
portfolio already ships, under the SIL Open Font License — by
`scripts/gen-title-glyphs.mjs`, which parses the TrueType `glyf` table directly
and emits real contours with their quadratic curves intact. At runtime they
become `ExtrudeGeometry` with proper counters. No letter is assembled from
boxes, and the J is a J.

Everything that defines the *look* is measured off the authored letters rather
than invented: cap height (1.447 m against their 1.45), extrusion depth (0.460
against 0.46), the baseline's position and heading, the `palette` material, and
the single UV every authored letter shares — ours sample the same texel, so the
colour matches by construction.

**Two lines, ALEJANDRO over NEWPORT.** Nine letters set in Geist are narrower
than "BRUNO SIMON" was, so the name keeps the authored footprint instead of
sprawling across the landing; sixteen letters on one line would have been half
as wide again as the original.

`reset()` restores order, spacing, baseline and rotation; measured drift after
flattening the whole name and resetting is 0.0095 m.

## 9. Achievements

`Achievements.ts` + `content/achievements.ts`, from `Achievements.js` and
`World/Areas/AchievementsArea.js`.

27 awards across driving, places, games and mischief. Two kinds of progress, as
upstream: a counter, or a **set** of ids so the same crate cannot be counted
twice. One deviation — upstream assigns progress, which lets a careless caller
move it backwards; `set` here takes the maximum.

The display is upstream's: a ring of glyphs orbiting the authored `refPillar`,
laid out by a seeded generator so the arrangement is identical on every visit,
lit as each award lands. The pillar bobs. `K` or the prompt opens the list.

Bruno's personal awards are not retained — they are not achievable here.

## 10. The smaller places

`Places.ts`, from LandingArea, ToiletArea, TimeMachineArea, AltarArea,
CookieArea, BehindTheSceneArea, LabArea and AchievementsArea.

| Place | What it does |
|---|---|
| Landing | Kiosk opens the map, the controls board opens the controls, the bonfire is the world's "Res(e)t" |
| Altar | A beam over the authored shrine; drive in and it takes the car, tolls and counts the offering on `refCounter` |
| Toilet | The 5 kg cabin tips when rammed and the world notices; the moon appears at night |
| Time machine | The CRT paints and flickers when rammed; the prompt opens the site this portfolio replaced |
| Cookie stand | The prompt spawns a physical cookie from `refSpawner`; drive over one to collect it; the counter board and the blower both move |
| Behind the scenes | A board rises out of the ground with an honest description of how this world is built |
| Lab | Browses the portfolio's eleven experiments and university projects on the authored second board |
| Achievements | The prompt opens the panel the pillar is already showing |
| Jukebox | Plays a phrase on the world's own synth |
| Bumpers | Raises and lowers the authored gutter bumpers |

## 11. Social

`Social.ts`, from `World/Areas/SocialArea.js`.

Upstream lays eight interactive points on a synthetic half-circle around
`refCenter`. Ours sit **on the icons the .blend already drew** —
`gitHubPhysicalDynamic`, `linkedInPhysicalDynamic`, `mailPhysicalDynamic` —
each with a world-space plate above it, because a visitor should be able to see
which is which before pressing anything. Every URL comes from `contact` in
`src/content/profile.ts`.

**The marks for accounts that do not exist are gone.** X, YouTube, Discord,
Twitch, Bluesky and OnlyFans were kept for a while as unlabelled scenery, on
the argument that a logo with no link claims nothing. That argument is wrong
in a plaza: a plinth with the Twitch mark on it in the middle of somebody's
contact page reads as an account, whatever the code intends. Their authored
pads stay; the marks do not.

Removal here is not `visible = false` plus a disabled body, which is what the
circuit's podium does. These are DYNAMIC bodies, so they sit in
`environment.dynamic`, and `Physics.reset` — which the bonfire's island reset
calls on every one of them — begins with `setEnabled(true)`: an invisible
Twitch logo would come back solid at the first reset. They are listed in
`Social.RETIRED`, which `reservedNames` feeds to the environment BEFORE
`addPhysics` runs, so no body is ever built and the environment's fallback
pass never fits a trimesh to a mesh nobody will see either.

**The centrepiece is the portfolio's own monogram.** The .blend stands the
level author, his cat, his dog with angel wings and an FWA trophy on the dais
— his life, his award. In their place stand the letters A and N, cut from
Geist Bold by the same `glyphs.ts` that cuts the name on the beach, stacked to
fill the 1.74 × 1.78 × 4.52 m the statue occupied, in the statue's own
material and the palette texel it spent most of its surface on. It is a FIXED
body: the name on the beach is meant to be knocked over, but a monument you
can shove off its plinth is just litter.

The CV, which has no icon in the .blend, takes the seat Twitch vacated. It
used to take the next free seat past the last owned icon, which put it 1.7 m
from Bluesky's pad — inside the 2.5 m a prompt answers from, so the
"Curriculum Vitae" plate read as Bluesky's label.

## 12. The control boards, and the props that were only ever moulds

`Blackboards.ts`, plus `Places.setCookie` and `Social.RETIRED`.

Two boards in the level say how to work a screen — one by the project board,
one in the lab — and Blender authors each of them THREE times over:
`refBlackboardLabelsMouseKeyboard`, `…GamepadXbox` and
`…GamepadPlaystation`, three flat label meshes sharing one `blackboardLabels`
atlas. They are not stacked; they are EXACTLY coplanar, within four
micrometres, so the depth buffer cannot separate them. That is not a mistake:
it is how the level ships a board that can speak three control schemes, and
the engine is supposed to draw the one that matches the pad in your hands.
Nothing did, so all three drew and the board read as a smear — NEXT with a
ghost of PREV through it, two arrows, two EXITs.

`Blackboards` shows exactly one variant per board and swaps it on the input
stack's own `modeChange` and the pad layer's `typeChange`. Touch reads the
mouse-and-keyboard face, because the atlas has no touch variant and its words
— NEXT, PREV, OPEN, EXIT — are what the on-screen buttons say anyway; an
unbranded pad gets the Xbox face, because ABXY is what most third-party pads
print. The suffixes are shuffled between the two boards in the source file, so
the pairing is by COLLECTION and never by index.

**`refCookie` was never meant to be in the world.** Blender marks it
`preventAutoAdd`, which in this level means "I am a template, somebody clones
me". Nothing honoured that, so a metre-wide cookie hung in the air beside the
oven for the whole game while the oven handed out a plain brown cylinder built
in code. It is the mould now: hidden, and its geometry, material and measured
size pressed into every cookie the place gives away, with a cylinder collider
read off its own bounding box. Cookies come out on a ring just wider than a
cookie, stepping round it by the golden angle, so two presses in a row cannot
land inside each other.

Hiding a level mesh for good is `World2Environment.suppress`, not
`visible = false`. The validation panel's category checkboxes re-derive
visibility for every mesh in the level from its category alone, so a raw flag
brought back the two silent blackboard variants, the retired logos, the
replaced title letters and the cookie template together. `suppressed` is a
separate set from `reserved`: `reserved` is about PHYSICS, and a reserved node
is usually still drawn.

## 13. Where the content comes from

Nothing in the interaction layer retypes portfolio data.

| Shown | Source |
|---|---|
| Career stones, the year range | `src/content/experience.ts`, `src/content/education.ts` via `src/world2/content/career.ts` |
| Projects board, wooden signs, attribute plates | `src/content/projects/*` via `src/world2/content/projects.ts` |
| Lab board | `src/content/projects/*`, filtered to experiments and university work |
| Social links, the CV | `contact` in `src/content/profile.ts` |
| Time machine destination | the `personal-web` project's `liveUrl` |
| Metrics on the screen | each project's own `metrics[0]` — and nothing else. No figure on any board was written by this layer |

Change a date in `src/content/experience.ts` and the stone changes. The drive
and the page cannot disagree.

## 14. What replaces the parts that needed a server

Upstream talks to a websocket service (`sources/Game/Server.js`) that is not in
the public repository.

| Upstream | Here | Why |
|---|---|---|
| Global circuit leaderboard with three-letter tags and a daily reset | Top ten per browser, on the same authored `refLeaderboard` board, clearable from the authored reset board | Shipping an unauthenticated score endpoint to make a portfolio look busier is not a trade worth making |
| Global "cataclysm" counter at the altar | Per-browser offering count on the authored counter | Same |
| Global cookie counter | Per-browser count on the authored counter | Same |
| Whispers — other visitors' messages floating in the world | Not activated | There is nobody else here. A fake one would be a lie about that |

All four are per-browser `localStorage` under `alejandro-world2-*` keys and
clear with the rest of the site's storage.

## 15. Handling, for this island only

`World2Game.tuneHandling()`. The shared vehicle ships `frictionSlip: 0.9`,
which on this level reads as a car that pushes wide and keeps sliding:
measured at a controlled 85 km/h entry, full lock turned it 39 degrees in two
seconds, it crept at about 1.4 km/h with nothing pressed, and it carried too
much of a collision through.

`surfaceFriction` is the hook the vehicle already exposes for exactly this,
and `frictionSlip` is the only lever it has: Rapier's raycast vehicle never
reads the ground collider's own friction coefficient, so sweeping the road's
0.7 from 0.05 to 5.0 changes the measured yaw and drift by nothing at all.
`idleBrake` 0.14 and chassis linear damping 0.18 go alongside it, which is
what stopped the creep and the carried-through collision.

An earlier round raised grip everywhere to 1.9 and stopped, on a reading that
it "plateaus above about 2". That reading was an artefact: it measured a FINAL
heading, which wraps at 180 degrees, and the 171 degrees it quoted was nine
degrees short of the fold. Measured again with yaw accumulated per step, the
steady-state full-lock radius is 4.26 m at 1.9, 3.80 at 3.0, 3.52 at 4.0 and
3.49 from 5 upward — the plateau is at four to five. Roll never passes 3.2
degrees anywhere in that sweep, because the chassis centre of mass is pinned
half a metre low, so the usual reason to keep grip down does not apply here.

**So grip is per-surface.** The circuit — the one surface built to be driven
hard — gets 4.0, and the rest of the island keeps 1.9, which suits grass and
sand. The tag comes from Blender: the exporter puts every road, ramp and
bridge in the `roads` category. Both halves of the tarmac have to carry it,
because the level ships the track twice — `refRoad`, the visible ribbon, and
`refRoadPhysicalFixed`, thirteen slabs whose top face is at exactly the same
height — and the wheel ray swaps between them several times a second; tagging
one and not the other makes grip flicker at walking pace. The map is resolved
once at build time and keyed on the `Physical`, not on a collider handle,
because Rapier recycles freed handles and this world removes bodies while it
runs. `scripts/world2-grip-qa.mjs` drives the same corner on both surfaces and
names the collider the wheels were standing on while it did it.

### The pedals that cut out

Grip was never the whole story. Three more things were measured after it, all
of which read from the driver's seat as the same complaint — *the car keeps
its momentum, carries straight on, and the pedals stop answering for a few
thousandths*. None of them was caused by the grip change; two of them are not
even about the circuit.

**A floor has to weigh something.** Rapier derives a fixed body's mass from
its colliders and the raycast vehicle resolves a wheel's BRAKE against that
body's INVERSE mass — so a floor that weighs nothing cannot slow the car
down. A trimesh fitted to a flat authored surface encloses no volume, which
is exactly nothing: `refRoad` (the visible circuit ribbon), `carpet`, the
career lane strips and thirty-odd other flat pieces all came out at mass 0
and an inverse mass of 5704, where the terrain — which has relief — comes out
at 2701 and the authored road slabs at 1282. The circuit is where it showed,
because the level authors that road TWICE and coplanar: a wheel swaps between
the ribbon and the slabs under it about twenty-eight times a second, and on
the ribbon the brake impulse it delivered was 0.0001 against the slabs'
0.1633 — which is exactly what `idleBrake` asks for. Throttle was unaffected,
because engine force is applied directly. Every fixed body this level builds
is now given a mass in the terrain's range (`World2Environment.anchor`).

**The travel test has to be a ground test.** `PhysicsVehicle` decides
throttle-or-handbrake from `forwardRatio = direction.dot(forward)`, taken in
three dimensions. A car with its nose in the air has a velocity vector
pointing partly at the sky, so that ratio fell under the 0.5 the handbrake
branch tests while the car was going dead ahead — zero engine force and 0.467
of brake, for 17 to 83 ms at a time. Both vectors are flattened now. Over a
ramp launch the ratio holds 0.97 where it used to bottom out at 0.72. This
one is in the shared vehicle, because it is wrong in both worlds.

**And the nose.** See below.

Every one of these is an instance property of this game's vehicle. `/world`
constructs its own and is untouched, apart from the shared `forwardRatio`
fix, which it gains.

## 16. The nose, and where the weight sits

`World2Game.lowerCentreOfMass()` and the boost tune beside it.

Engine force arrives at each wheel's contact patch, and those sit below the
chassis centre of mass, so hard acceleration turns the car about that lever
and the nose comes up. At the upstream boost that is not a lean, it is a
launch — and the two front wheels are the only ones this vehicle steers, and
a wheel with nothing under it passes on neither engine force nor brake. So
for two-thirds of a boost the car went where it was already going and the
pedals did nothing.

Measured over a 1.2-second standing start on flat tarmac, three reps a run
and reproducible to the percent:

| | a front wheel off | nose | top |
| --- | --- | --- | --- |
| boost ×2, ceiling 40, weight at −0.5 | **65 %** | 12.4° | 191 km/h |
| boost ×0.8, ceiling 22 | 19 % | — | — |
| boost ×0.6, ceiling 22 | 0 % | 10.3° | 145 km/h |
| boost ×0.6, ceiling 22, weight at −0.8 | **0 %** | **4.6°** | **168 km/h** |

Two levers, and both were needed. The boost's FORCE is what lifts the nose,
so it comes down hard; its CEILING is what makes boost worth pressing, so it
only comes down enough to stop the car outrunning its own track. 0.6 is the
floor rather than a taste: below it the car can no longer clear the authored
ramp — driven the way `scripts/world2-qa.mjs` drives it, from a standing
start four metres short, it lands 9.8 m past the far edge at 0.6 and 0.7 m
SHORT at 0.4, against the metre the check asks for.

Dropping the weight is the better half of the fix, because it costs nothing.
The same throttle that used to turn the car now pushes it: top speed goes UP,
from 145 km/h to 168. And it fixes the mirror image of the same fault —
a car carrying its weight high stands on its NOSE when you stop it, which
lifts the driven wheels off the road just as thoroughly. Braking from speed
used to pitch to 87.5° over 12.1 m; it now stays inside 10° over 7.3 m.

Nothing else it touches gets worse: full-lock yaw over two seconds goes from
413 to 436 degrees, peak roll from 3.9 to 0.6, and the hydraulic jump clears
the same 1.78 m. The one cost is self-righting from the roof, which takes 26
frames instead of 16 — still automatic, just less eager, which is the honest
price of a car that no longer wants to tip.

What is NOT the cause, because both were measured and neither is: the grip
change (0 % lift at 0.9, 1.9 and 4.0 with no boost, and a flat 65 % at all
three with it) and the coplanar double road (eighty-odd collider swaps per
five seconds, and not one frame of lost contact).

## 17. The grass, and the frame

`src/world2/World2Grass.ts`. Blender generates every blade and the export keeps
them — one merged mesh, 65,911 triangles — but a glTF material cannot carry
what makes grass read as grass. A pass at load writes a `bladeHeight`
attribute (within each triangle: 0 at the two base vertices, 1 at the tip,
which is exactly what a blade is) and the standard material is patched through
`onBeforeCompile`, so it keeps the scene's lighting and shadows while gaining a
root-to-tip gradient, a per-blade tint and a two-wave wind that bends from the
root.

`World2Environment.batchScenery` merges the level's static scenery into one
mesh per material per 26 m cell — the same treatment the vegetation already
had. The rule that keeps it safe: anything `References` has looked up is left
alone, because if gameplay asked for a node, something is going to move it,
hide it or repaint it, and a merged copy would not follow. Physics is
untouched; every collider was built from the originals before this runs.

Measured while driving: 16.7 ms median frame, 17.9 ms at the 95th percentile,
1.2–2.8 ms for an explicit render. See
[WORLD2_INTERACTION_QA.md](WORLD2_INTERACTION_QA.md) for what was found and
fixed.

## 18. Files

```
src/world2/interactions/
  references.ts      name → node, collection, transform, body
  Prompts.ts         the 3D interaction points
  Screen.ts          a canvas on an authored surface
  Explosions.ts      impulse + fireball/smoke/debris/flash pools
  ExplosiveCrates.ts TNT
  Circuit.ts         the race
  Bowling.ts         the lane
  Career.ts          the CV walk
  Projects.ts        the board
  screenMotion.ts    per-project screen identities
  Social.ts          the contact icons and the AN monogram
  Blackboards.ts     one control scheme per board, not three at once
  Title.ts           ALEJANDRO NEWPORT
  glyphs.ts          Geist Bold outlines to extruded geometry
  Achievements.ts    awards + the pillar
  Places.ts          altar, toilet, time machine, cookie, lab, kiosks, jukebox
  Interactions.ts    builds them all, owns the lifetimes

src/world2/content/
  achievements.ts    the 27 awards
  career.ts          three tracks over experience, education and projects
  projects.ts        adapter over the project inventory
  glyphs.json        Geist Bold outlines, generated

scripts/
  gen-world2-interactions.mjs   the references the GLB filters out
  gen-title-glyphs.mjs          TrueType outline extraction
  world2-interaction-qa.mjs     the gameplay suite
  world2-grip-qa.mjs            the same corner, on tarmac and on grass
  world2-routes-qa.mjs          /, /world, /world2
```

Everything is owned by the route's `Bin`. Leaving `/world2` disposes the
physics world, the RAF loop, every ticker subscription, every listener, every
canvas texture and every mini-game timer; `window.__world2` is `undefined` and
the audio context is stopped. Verified in
[WORLD2_INTERACTION_QA.md](WORLD2_INTERACTION_QA.md).

## 19. QA

112 / 112 gameplay checks, 5 / 5 grip checks and 6 / 6 route checks pass, plus
`scripts/world2-qa.mjs` with no failures, across consecutive runs.
See [WORLD2_INTERACTION_QA.md](WORLD2_INTERACTION_QA.md) for the per-area
table, and [WORLD2_INTERACTION_AUDIT.md](WORLD2_INTERACTION_AUDIT.md) for the
inventory this pass started from.
