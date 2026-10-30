# World 02 — interaction audit

What this is: a full inventory of the interactive content in `folio-2025.blend`,
what `/world2` did with it before this pass, and what was done about it.

**How it was produced.** Three passes, cross-checked against each other:

1. **The level as shipped.** `world2-blender-audit.json` (1,507 objects, 120
   collections, written from the .blend by `scripts/world2_blender_audit.py`)
   against the node table of `public/world2/models/world.glb`.
2. **The level as it runs.** `/world2` driven in the browser with the
   development handle `window.__world2`, walking every area anchor and reading
   `environment.nodes`, `environment.dynamic` and the Rapier world back out.
3. **The behaviour it is supposed to have.** The upstream sources at
   `sources/Game/**` of Bruno Simon's folio-2025 (MIT), read controller by
   controller.

**The headline finding.** Almost nothing was missing from the export. Of the
things this pass needed, only four kinds of object were absent from
`world.glb`, all of them deliberately filtered by
`scripts/export-world2-blender.py`: the eight race gates and the board hit
targets (`archive or interaction/query-only reference`), the six career text
planes and the sign curve (`hidden in source render`). Every one of them is
recovered from the .blend by `scripts/gen-world2-interactions.mjs` into
`public/world2/interactions.json`. Nothing was re-modelled, and no coordinate
in the interaction layer was invented.

The second finding is the one that mattered most: **the circuit was walled
off**. `refRailsPhysicalFixed` is a 150 × 20 × 168 m trimesh ringing the whole
track. Upstream enables its collider only for the duration of a race; our
exporter keeps every authored collider live, so it stood as a permanent
invisible wall. That is why the circuit "could not be entered".

Status key: **DONE** activated · **PARTIAL** activated with a documented
difference · **N/A** not present or deliberately not retained.

---

## 1. The thirteen authored areas

| Area / object | In world2? | Visible? | Physics? | Interaction before | Upstream controller | Problem found | Fix | Status |
|---|---|---|---|---|---|---|---|---|
| `landing` + `refLettersPhysicalDynamic.010–.019` | yes | yes | 10 dynamic bodies | none — inert letters reading BRUNO SIMON | `World/Areas/LandingArea.js#setLetters` | letters spelled someone else's name; no collision sound; no reset | 16 generated Geist Bold glyphs reading ALEJANDRO / NEWPORT, one dynamic body each, authored cap height / depth / mass / material | DONE |
| `landing` / `refKioskInteractivePoint` | yes | n/a (empty) | none | none | LandingArea | no prompt | prompt → island map | DONE |
| `landing` / `refControlsInteractivePoint` | yes | n/a | none | none | LandingArea | no prompt | prompt → controls panel | DONE |
| `landing` / `refBonfireInteractivePoint` | yes | n/a | none | none | LandingArea ("Res(e)t") | no prompt | prompt → world reset (letters, crates, pins, every dynamic prop) | DONE |
| `career` / `refLine`–`refLine.005`, `stone*`, `careerText*`, `refYear`, `digit0*` | yes (text planes recovered) | stones yes, text planes excluded | static scenery | none | `World/Areas/CareerArea.js` | stones inert; label planes absent; year plate blank — and its authored face is edge-on to the road | six stones rise + slide + wipe in their label; the year counts 2023 → 2027 on a painted plate at the authored transform (see the note in WORLD2_INTERACTIONS_IMPLEMENTED.md) | PARTIAL — the seven-segment geometry is hidden, not driven |
| `social` / `gitHubPhysicalDynamic`, `linkedInPhysicalDynamic`, `mailPhysicalDynamic` | yes | yes | dynamic props | none | `World/Areas/SocialArea.js` | icons were knockable but silent | world-space plates + prompts opening the real links | DONE |
| `social` / `xPhysicalDynamic`, `youtubePhysicalDynamic`, `discordPhysicalDynamic`, `twitchPhysicalDynamic`, `blueskyPhysicalDynamic.001`, `onlyfansPhysicalDynamic` | yes | yes | dynamic props | none | SocialArea | no Alejandro equivalent exists | left as physics props, deliberately unlabelled and unlinked | PARTIAL |
| `social` / `refOnlyFans`, `refFan` | yes | yes | static | none | SocialArea fan spawner | upstream's caption was a pun on an account name | kept the physical toy (prompt hops nearby props), dropped the caption | PARTIAL |
| `projects` / `board` collection (`refImages`, `refTitle`, `refUrl`, `refPagination`, `refPrevious`, `refNext`, `plane*`) | yes | yes | static | none | `World/Areas/ProjectsArea.js` | the whole browser was dead geometry | full browser: animated screen, flip-boards, pagination, adjacent signs, cinematic open/close | DONE |
| `projects` / `pole` collection (`refAttributes`, `role`, `at`, `with`) | yes | yes | static | none | ProjectsArea attribute plates | blank | CATEGORY / YEAR / STACK for the selected project | DONE |
| `projects` / `distinctions` (`awwwards`, `fwa`, `cssda`, `medal`) | yes | yes | static | none | ProjectsArea | three award logos assert someone else's career | the three logos hidden; the shelf and `medal` remain as scenery | PARTIAL |
| `lab` / `board.001`, `refImages.001`, `refTitle.001`, `refArrowNext/Previous`, `scroller` | yes | yes | static | none | `World/Areas/LabArea.js` (1,458 lines) | dead board | browses the portfolio's 11 experiments and university projects on the authored board | PARTIAL — upstream's full exhibit set is not reproduced; the board mechanic is |
| `cookie` / `refSpawner`, `refCounterLabel`, `refBlower.001`, `refInteractivePoint.002` | yes | yes | stand is fixed, blower dynamic | none | `World/Areas/CookieArea.js` | inert | prompt spawns a physical cookie; driving over one collects it; counter board; blower pulses | PARTIAL — upstream's counter was global via websocket, ours is per browser |
| `altar` / `refAltar`, `refCounter`, `physicalFixed.005` | yes | yes | fixed shell | none | `World/Areas/AltarArea.js` | inert shrine | beam shader; driving in takes the car, tolls, counts the offering on the authored counter board | PARTIAL — upstream's counter was a global "cataclysm" tally on a server |
| `toilet` / `refCabinPhysicalDynamic`, `refMoon` | yes | yes | dynamic, mass 5 | none | `World/Areas/ToiletArea.js` | tipped over but nothing noticed | tip detection + award; the moon shows at night | DONE |
| `bowling` / `pin0–pin9`, `refPinPhysicalDynamic`, `refBallPhysicalDynamic`, `screen` collection, `bumpers` | yes | yes | ball dynamic; pin template single static body | none | `World/Areas/BowlingArea.js` | one pin body at the template position, not ten at the authored spots; board dead | 10 dynamic pins, one instanced draw, 60°-tilt detection, live 10-pin board, strike, bumper toggle, reset | DONE |
| `bowling` / `refRestartInteractivePoint` | yes | n/a | none | none | BowlingArea | no prompt | hidden until the frame is live, then "Reset pins" | DONE |
| `circuit` / `refCheckpoints.000–.007` | **no** — filtered from the GLB | n/a | none | none | `World/Areas/CircuitArea.js` | gates absent from the export | recovered from the .blend into `interactions.json`; eight ordered gates | DONE |
| `circuit` / `refStart`, `refStartingLights`, `refTimer`, `refLeaderboard`, `refLeaderboardReset` | yes | yes | static | none | CircuitArea | no race at all | grid, lights, clock, board, clear-times prompt | DONE |
| `circuit` / `refRailsPhysicalFixed` | yes | **rendered, though hide_render in Blender** | fixed trimesh, always on | none | CircuitArea `setRails` | **an invisible 20 m wall around the whole track — the circuit access bug** | disabled and hidden except during a race | DONE |
| `circuit` / `refObstaclesPhysicalKinematicPositionBased.001–.005` | yes | yes | **static** — "KinematicPositionBased" contains no "dynamic" so the name test made them fixed | none | CircuitArea sliding hazards | could not move | rebuilt as kinematic bodies; slide ±5 m on the race clock | DONE |
| `behindTheScene` / `refCenter.001`, `refInteractivePoint.004` | yes | yes | props | none | `World/Areas/BehindTheSceneArea.js` | inert | a board rises out of the ground with how this world is actually built | PARTIAL — upstream's 36-slab iris portal is not reproduced; the reveal and the content are |
| `achievements` / `refPillar`, `refInteractivePoint.005`, `refWaterfallZone` | yes | yes | fixed | none | `World/Areas/AchievementsArea.js` | inert | 27 glyphs orbit the authored pillar, lit as they unlock; pillar bobs; prompt opens the list | DONE |
| `timeMachine` / `refTvPhysicalDynamic`, `refScreen`, `refInteractivePoint.006` | yes | yes | dynamic CRT | none | `World/Areas/TimeMachineArea.js` | inert | CRT screen paints; ramming it makes it flicker; prompt opens the site this portfolio replaced | DONE |
| `easter` collection | **no** — excluded from the source view layer | n/a | n/a | n/a | `World/Areas/EasterArea.js` | Bruno disabled it in the .blend AND never instantiates it upstream (`Areas.js` lists 13 areas, not 14) | not activated: there is no geometry in this world to activate | N/A |

## 2. World-level interactive systems

| System | In world2? | Physics before | Interaction before | Upstream | Problem | Fix | Status |
|---|---|---|---|---|---|---|---|
| `explosiveCrates` (23) | yes | static trimesh scenery | none | `World/ExplosiveCrates.js` | crates were solid furniture | dynamic 0.02 kg bodies, 0.5 half-extent cuboid, contact fuse, 0.4 s delay, blast, chain reaction, reset | DONE |
| Explosions | n/a | n/a | n/a | `Explosions.js`, `World/Fireballs.js` | no effect system | upstream's impulse formula unchanged; fireball, smoke, debris, flash, camera kick, all pooled | DONE |
| `fwa` collection crates (`explosiveCrates.005–.011`) | **no** — `refFwaPhysicalDynamic` excluded from the view layer | — | — | ExplosiveCrates | disabled in the .blend | not activated | N/A |
| Interactive points (`refInteractivePoint*`, `ref*InteractivePoint`) | yes (7 + 6 named) | none | none | `InteractivePoints.js` | no prompt system at all | full 3D diamond + sliding label + key glyph, 2.5 m proximity, keyboard/gamepad/touch glyphs | DONE |
| Achievements | n/a | n/a | none | `Achievements.js`, `data/achievements.js` | none | 27 World2 awards, counters and unique sets, per-browser persistence, unlock cards | DONE |
| `jukebox` / `refJukeboxInteractivePoint` | yes | dynamic | none | BowlingArea | inert | prompt plays a phrase on the world's synth | DONE |
| `bumpers` / `refBumpersInteractivePoint.001` | yes | static | none | BowlingArea | inert, and the bumpers could not retract | kinematic body; prompt raises and lowers them | DONE |
| Physical props: `benches` (7), `fences` (18), `cones` (7), `barrels` (8), `cups`, `furnitures`, `lightGenerators`, `icons`, `controls`, `anvil`, `grinder`, `oven`, `cauldron`, `tv`, `blackBoard` | yes — 103 dynamic bodies | already dynamic | none | `Objects.js` | worked, but nothing watched them | left exactly as they were; a "shove twenty props" award now notices | DONE |
| `bricks` collection (30 `Cube.*`) | yes | static | none | `World/Bricks.js` | these are wall courses in built structures, not loose bricks | left static: making load-bearing walls dynamic would collapse the buildings they form | N/A — documented |
| `Respawns` (17 authored points) | yes | — | already working | `Respawns.js` | none | unchanged, plus race checkpoints take over during a lap | DONE |
| Map | yes | — | image + player arrow | `Map.js` | did not show the places | the 13 authored area anchors are now pinned on it | DONE |
| Audio | yes | — | engine, impacts, horn | `Audio.js` | no gameplay sounds | explosions, fuses, pin impacts, countdown, gate chimes, finish fanfare, award sting — all through the existing synth, no new files | DONE |
| Whispers | no | — | — | `World/Whispers.js` | needs a websocket server carrying other visitors' messages | not activated: there is no server, and a fake one would be a lie about other people being here | N/A — documented |
| Leaderboard (online) | no | — | — | `Server.js` | websocket backend absent from the public repository | replaced with a per-browser top-ten on the authored `refLeaderboard` board | PARTIAL — documented |
| Konami code, `Easter.js`, `BlackFriday` | no | — | — | `KonamiCode.js`, `Easter.js`, `BlackFriday/` | seasonal / promotional hooks with no geometry in this world | not activated | N/A |
| Tornado, Weather, Cycles | no | — | — | `Tornado.js`, `Weather.js`, `Cycles/` | out of scope: this pass is gameplay, and `/world2` has its own lighting | not activated | N/A |

## 3. Things that were checked and found already correct

The vehicle, its handling and its physics; the camera and its orbit, zoom and
cinematic modes; every input path; the terrain, road, bridge and ramp
colliders; vegetation instancing; the water surface and its damping; all 17
authored respawns; the loading, pause, map and controls UI. None were changed
except where an integration genuinely required it, and the two changes that
did touch shared files are additive:

- `World2Environment` gained `physicals`, `reserved`, `collection()` and
  `collidersFor()`. Nothing existing changed behaviour.
- Two World2-only input actions (`boardPrevious`, `boardNext`) are registered
  from `World2Game`, not added to the shared `ACTION_DEFINITIONS` table that
  `/world` also reads.

`/` and `/world` were re-tested after every stage; see
[WORLD2_INTERACTION_QA.md](WORLD2_INTERACTION_QA.md).
