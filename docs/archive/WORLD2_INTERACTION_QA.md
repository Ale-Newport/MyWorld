# World 02 — interaction QA

Every row below was played, not inspected. The evidence is
`scripts/world2-interaction-qa.mjs`, which drives the real game through the
same `window.__world2` handle a developer has in the console: it starts races,
rolls the ball down the lane with a genuine impulse, rams the latrine with the
car at 24 m/s, and reads its assertions back out of live Rapier bodies and live
canvases. Nothing in it is stubbed.

```bash
npm run world2:interactions     # the gameplay suite (needs `npm run dev`)
npm run world2:routes           # /, /world and /world2 still boot clean
```

Screenshots and the machine-readable report land in
`.qa/world2-interactions/`.

**Last full run: 112 / 112 gameplay checks and 5 / 5 grip checks passed,
0 runtime errors, consecutive clean runs.**

The gameplay suite runs against the development build on purpose: a production
bundle deliberately ships no `window.__world2` handle, and the harness says so
rather than timing out if you point it at one. Production is covered by
`world2:routes`, which ran green against `next start` after `next build`.

---

## Per-area results

| Area | Tested | Start | Gameplay | Success | Reset | Exit | Replay | Result |
|---|---|---|---|---|---|---|---|---|
| **TNT / explosive crates** | yes | drove into a crate at 16 m/s | fuse lights, 0.4 s, blast with fireball, smoke, debris, flash and camera kick | 3 crates from one hit — the chain propagated by itself | all 23 crates back at their Blender transforms, drift 0.000 | n/a (no focused mode) | reset → detonated → reset again, clean | **PASS** |
| **Circuit** | yes — 4 races | trackside prompt; car placed on `refStart`, 0.00 m off | 3-2-1 countdown with the lights, driver locked; rails up; 8 gates in order; hazards sliding | finish at exactly 9 crossings; `00:04:900` in MM:SS:MMM; NEW BEST shown | rails down, camera and car returned, board written | ESC and the Exit button both end it | 3 races back to back, times 4.900 / 4.266 / 4.267 | **PASS** |
| Circuit — wrong order | yes | — | jumped from gate 4 straight to gate 7 | crossing count did not move (5 → 5) | — | — | — | **PASS** |
| Circuit — respawn | yes | mid-race R | put back 3 m through the last gate crossed, facing through it | 0.0000005 m from the authored respawn | — | — | — | **PASS** |
| Circuit — leaderboard | yes | — | three laps recorded | top-ten kept, sorted, persisted, drawn on `refLeaderboard` | "Clear best laps" prompt empties it | — | — | **PASS** |
| **Bowling** | yes — 5 frames | ball given a real impulse down the lane | ball rolls and spins, pins take it, 60°-tilt detection latches each one | 10 / 9 / 9 / 9 / 9 pins; a strike on the first frame | pins, ball, board and state all restored; ball 0.035 m from home | n/a | 5 consecutive frames, no drift | **PASS** |
| Bowling — board | yes | — | the authored `refDiscs` / `refCrosses` screen | board bytes matched the fallen pins exactly, 10/10 | cleared with the rack | — | — | **PASS** |
| Bowling — bumpers | yes | prompt | kinematic bumpers rise and retract | toggled | — | — | — | **PASS** |
| **Career** | yes | drove the road from the first stone to the last | stones rise 2.5 m and slide with the car; labels wipe in left to right; year plate counts | all six stages revealed in one walk; years ran 2023 → 2024 → 2025 → 2026 → 2027 | stones sink behind you unless the role is ongoing | n/a | left the area and came back — the reveal replayed | **PASS** |
| Career — content | yes | — | six stones, six real roles | KCL BSc · Focus · Pansofia/Grupo Newport · KCL GTA · Metaview · UCL MSc, in date order | — | — | — | **PASS** |
| **Projects** | yes | prompt at `refInteractivePoint` | cinematic camera takes upstream's pose, car parked, board lit | five Next steps gave five distinct projects; Previous stepped back correctly | — | Close returned camera, car and controls | re-opened cleanly | **PASS** |
| Projects — screen | yes | — | per-project drawn identity, animated, captioned | screen, flip-boards ×4 and attribute plates ×3 all bound to authored objects | — | — | attract cycle returns when you leave | **PASS** |
| **Performance** | yes | busiest corner of the island | projects board + career walk + social arc in one frustum | median 60 fps, 566 draw calls | — | — | — | **PASS** |
| **Social** | yes | drove up to the icons | a plate over each icon; a prompt on each | GitHub, LinkedIn, Email and CV, all from `src/content/profile.ts` | — | — | — | **PASS** |
| Social — legibility | yes | — | plates turn to the reader | every plate's face pointed at the car | — | — | — | **PASS** |
| Social — no foreign data | yes | — | checked every href | no URL matches bruno/simon; the six icons with no equivalent carry no label and no link | — | — | — | **PASS** |
| **Title** | yes | — | 16 letters, 16 rigid bodies, 0.2 kg each | reads ALEJANDRO NEWPORT; cap height 1.447 m vs the authored 1.45; depth 0.460 m | flattened the whole name, then reset: 16 standing, max drift 0.0095 m | n/a | — | **PASS** |
| **Altar** | yes | drove onto the pad | beam, toll, blast, the car is taken and respawns | offering counted 0 → 1 on the authored counter board; award unlocked | 6 s cooldown | n/a | — | **PASS** |
| **Cookie stand** | yes | prompt | cookies spawn as physics props and roll | 3 spawned, collected by driving over them, counter board updated | props cleaned up after 120 s or on collection | n/a | — | **PASS** |
| **Toilet** | yes | rammed the cabin at 24 m/s | 5 kg cabin tips | up-axis went to 0.002, award unlocked | world reset stands it back up | n/a | — | **PASS** |
| **Time machine** | yes | prompt | CRT paints; ramming it makes it flicker | opens the site this portfolio replaced, from the project data | screen returns after 1.4 s | n/a | — | **PASS** |
| **Behind the scenes** | yes | prompt | board rises out of the ground, faces the car | technical write-up of this world's own build | sinks back | toggled | — | **PASS** |
| **Lab** | yes | prompt | browses the authored second board | 11 real experiments and university projects | — | — | steps and wraps | **PASS** |
| **Achievements** | yes | prompt at the pillar | 27 glyphs orbit `refPillar`, lit as earned; pillar bobs | panel listed all 27 with progress | — | closes | 12 unlocked survived a page reload | **PASS** |
| **Jukebox** | yes | prompt | plays a phrase on the world synth | award unlocked | n/a | n/a | — | **PASS** |
| **Landing kiosks** | yes | two prompts | map and controls | both open | n/a | close | — | **PASS** |
| **Bonfire reset** | yes | prompt | resets letters, crates, pins, ball and every dynamic prop | everything home | — | n/a | — | **PASS** |
| **Prompts** | yes | drove from 14 m away to 1.2 m | nothing at range; the diamond opens with its label at 2.5 m | the right point fired, not a neighbour | — | closes on driving away | — | **PASS** |
| **Props** | yes | shoved benches, cones, fences | already dynamic; now counted | "shove twenty props" award tracks real displacement > 0.6 m | world reset returns them | n/a | — | **PASS** |
| **Race start** | yes | prompt | car placed on the grid | faces the first gate (alignment 1.00), podium hidden, one clock | podium returns at the finish | HUD clears when you drive away | — | **PASS** |
| **Panels** | yes | four prompts | map, controls, achievements, bumpers | all four toggle; the achievements panel arrives with all 27 rows | — | close | — | **PASS** |
| **Board keys** | yes | opened the board | ArrowLeft / ArrowRight / A / D | stepped forward twice, back once | — | Escape hands it back | — | **PASS** |
| **Grass** | yes | — | per-blade root-to-tip gradient, per-blade tint, two-wave wind | `bladeHeight` attribute present, material patched | — | — | — | **PASS** |
| **Map travel** | yes | clicked a place on the map | car driven to the nearest authored respawn | arrived 20 m from the anchor, unpaused | — | — | — | **PASS** |
| **Race camera** | yes | started a race and drove at 114 km/h | camera radius sampled every frame | never pulled in below the free-roam 21.4 m | — | — | — | **PASS** |
| **Race rails** | yes | fired the car at the outside of the track at 40 m/s | the guard rail is up during a race | car stopped after 23.5 m | down again at the finish | — | — | **PASS** |
| **Leaderboard** | yes | — | painted on the authored `refLeaderboard` sign | reads upright inside its 3D frame; the sign got real UVs | — | — | — | **PASS** |
| **Starting gantry** | yes | started a race | three authored lamp holes | one lamp per beat (1, 2, 3), all three green on GO | dark again between races | — | — | **PASS** |
| **Handling** | yes | controlled 85 km/h entry, full lock | grip 1.9, idle brake 0.14, damping 0.18 | 39° → 171° of turn; stopping 10.1 m → 7.5 m; no creep; no flipping | — | — | — | **PASS** |
| **Podium** | yes | before, during and after a race | hidden and unbodied | never visible, collider never enabled | — | — | — | **PASS** |
| **Control boards** | yes | both boards, live | three coplanar label variants | exactly one drawn per board; swaps on input device | survives the scenery toggle | — | — | **PASS** |
| **Career tracks** | yes | drove the whole 17 m walk | 4 authored lanes | 9 stops on 3 tracks, each on its own lane, chronological | one label per lane, 1.05 m apart | — | — | **PASS** |
| **Year plate** | yes | drove the walk | authored 7-segment digits | 2023 → 2027, every mask a real digit, nothing painted | — | — | — | **PASS** |
| **Circuit grip** | yes | same corner, tarmac vs island | `w2Category === 'roads'` | 4.0 on both halves of the tarmac, 1.9 elsewhere | 63 km/h full lock: 464° on road, 183° on grass | — | — | **PASS** |
| **Cookie mould** | yes | pressed the oven three times | `preventAutoAdd` template | template hidden, unbodied, unbatched; 3 of 3 collected | — | — | — | **PASS** |
| **Social plaza** | yes | — | 6 unowned marks + 5 statuary meshes | all 11 hidden AND unbodied; GitHub, LinkedIn, mail kept | AN monogram, 4.2 m, on the dais | — | — | **PASS** |
| **Floor mass** | yes | read every fixed body | 277 of them | none under 1000; ribbon 5000, slabs 6282, terrain 7701 | — | — | — | **PASS** |
| **Boost launch** | yes | 1.2 s standing start on tarmac | boost ×0.6, ceiling 22, weight −0.8 | front wheels down 100 % of it, nose 4.6°, 168 km/h | — | — | — | **PASS** |
| **Braking attitude** | yes | full stop from 168 km/h | — | 7.3 m, nose inside 10° (was 12.1 m and 87.5°) | — | — | — | **PASS** |
| **Pitched travel test** | yes | launched off the authored ramp | — | 47 frames past 8° of pitch, none handed the handbrake, ratio 1.00 | — | — | — | **PASS** |

## Console

The suite fails if a single uncaught error or console error appears during the
whole run. It ends with **0 errors**. Three real defects were caught this way
and fixed:

- `vLocalY` was declared in the fireball's vertex shader but not its fragment
  shader: the fireball silently never rendered.
- `active` is a reserved word in GLSL ES; the year plate's seven-segment
  vertex shader refused to compile and the digits stayed blank.
- TrueType winds outer contours *clockwise*, the opposite of PostScript.
  Treating positive area as the body gave eight letters instead of sixteen and
  turned every `O` into just its counter.
- Canvases bound onto glTF meshes rendered 180° rotated: Blender puts v = 0 at
  the top, and some of those quads are UV-mirrored as well. Both are now
  derived per mesh rather than assumed — see `src/world2/interactions/bindCanvas.ts`.
- The career labels were paired to their stones by position in the sorted run
  rather than by name, so five of six sat above the wrong stone.

A second pass, driven by play, found six more:

- **Every prompt callback fired twice.** `Prompts` subscribed to the `interact`
  action *and* `World2Game.interact()` routed to it. Harmless on one-shots;
  it cancelled every toggle, so the map, the controls panel, the achievements
  panel and the bowling bumpers all looked dead.
- **The dialog's close button carried `autoFocus`**, so the same Enter press
  that opened a panel landed on Close as soon as React rendered it. Focus now
  goes to the dialog itself.
- **Reserving a body hid its mesh.** `World2Environment` set `visible = false`
  on anything the interaction layer claimed, which is why the bowling ball,
  its score screen and the gutter bumpers were invisible.
- **The race grid used the authored empty's own yaw**, which points across the
  track: the car started sideways. The heading now comes from the line to the
  first gate.
- **The lap clock rode beside the car.** At 4.2 m wide, a metre from a chase
  camera and billboarded, it read as the camera zooming in — and it duplicated
  the HUD timer. It stays on its authored board now.
- **The HUD could get stuck on a finished race**, because the throttle on
  `publishGameplay` could swallow the last publish. State changes force it.

And two more after that:

- **Starting a race pulled the camera from 21 m to 12.** The rails are a 20 m
  invisible wall and the level builds them in the `floor` category — exactly
  what the camera's obstruction ray queries. Raising them for a race put a
  wall in front of the lens. They are in the `object` category now: still
  solid to the car and to every prop, invisible to the camera probe. The
  camera easing OUT with speed is the View's normal framing and is unchanged.
- **`formatLap` could print `00:04:1000`.** Rounding the fractional part on
  its own can reach 1000; the time is rounded to whole milliseconds first now.

A third pass, again from play:

- **The leaderboard stood on its side, through its own sign.** `refLeaderboard`
  is a 5 × 5 plane lying in its own YZ plane; a Screen of ours carried an XY
  quad, so copying that transform turned the panel 90°. It is painted on the
  authored surface now — and that surface needed a mapping first, because
  everything using the `palette` atlas has every vertex on one texel.
- **The starting gantry never lit.** Its three lamp holes are cut in a beam,
  and the plate behind them was hidden by that beam's own back face, because
  our exporter makes every material double-sided. The plate is seated in the
  holes and drives three lamps: one per beat, all green on GO.
- **The car pushed wide and would not settle.** Measured at a controlled
  85 km/h entry, full lock turned it 39° in two seconds; it also crept at
  about 1.4 km/h with nothing pressed.
- **The podium was removed.** It stood on the racing line for a ceremony this
  world does not hold.

A fourth pass, again from play, and again every one of these was measured
before it was touched:

- **Both control blackboards were an illegible smear.** Blender authors each
  one three times over — mouse-and-keyboard, Xbox, PlayStation — and the three
  label meshes are not stacked but EXACTLY coplanar, within four micrometres,
  so the depth buffer cannot separate them. Nothing chose between them, so all
  three drew.
- **The career walk was one list poured down four lanes.** Blender authors it
  as three parallel tracks plus a year lane; the code sorted six empties by
  position and zig-zagged a flat chronology through them.
- **The year plate was painted on a canvas, on a false premise.** The comment
  said the authored plate stands edge-on to the road. Every vertex of every
  digit's normal is (0, 1, 0) and all four digit meshes are perfectly flat:
  the readout lies face-up and is read from above.
- **The career labels were a third of the size they should be, and stretched.**
  A fixed 1024 x 256 canvas over a 3.13 x 0.59 m plane is 327 px per metre
  across and 434 down, so every glyph was 1.33 times too wide, and the
  headline stood 12 cm tall.
- **Four labels printed over each other.** Every raised stone kept its label,
  and on this road a degree, a job and a project overlap almost everywhere.
- **The car slid on the circuit.** Not because the road is low-friction —
  Rapier's raycast vehicle ignores a ground collider's friction entirely,
  measured by sweeping it 0.05 to 5.0 for identical results. The global 1.9
  was set on a reading that grip "plateaus above 2", which was a wrapped-angle
  artefact; the real plateau is 4 to 5.
- **A metre-wide cookie hung in the air.** `refCookie` is marked
  `preventAutoAdd` — a template — and nothing honoured it, so it rendered, and
  the environment's fallback pass fitted a static trimesh to it.
- **The plaza advertised six accounts that do not exist**, and its centrepiece
  was the level author, his cat, his dog and his award.

A fifth pass, on one report — *the car keeps its momentum on the road, carries
straight on, and the pedals stop answering for a few thousandths*. It turned
out to be three separate faults with one symptom, and the obvious suspect was
not among them:

- **A floor that weighs nothing cannot brake.** Rapier derives a fixed body's
  mass from its colliders and the raycast vehicle resolves the brake against
  that body's inverse mass. A trimesh fitted to a FLAT surface encloses no
  volume, so `refRoad` — the visible circuit ribbon — came out at mass 0 and
  delivered a brake impulse of 0.0001 where the authored slabs beneath it
  delivered 0.1633. The two are coplanar and a wheel swaps between them about
  twenty-eight times a second.
- **The travel test was taken in 3D.** `forwardRatio = direction.dot(forward)`
  with the nose in the air reads as travelling sideways, so the vehicle handed
  the driver the handbrake instead of the throttle: zero engine force and
  0.467 of brake, for 17 to 83 ms at a time.
- **The boost was a launch, not a lean.** A front wheel off the ground 65 % of
  a standing start, and those two are the only ones that steer.
- **And the same fault under braking.** A car carrying its weight 0.5 m under
  the body origin stands on its nose to stop: pitch to 87.5 degrees over
  12.1 m, with the driven wheels in the air.
- **Not the cause, measured:** the per-surface grip (0 % lift at 0.9, 1.9 and
  4.0 with no boost; a flat 65 % at all three with it) and the doubled road
  surface (eighty-odd collider swaps per five seconds, zero lost frames).

## Performance

Measured in the busiest corner of the island — the projects board, the career
walk and the social arc inside one frustum — on software GL:

| | |
|---|---|
| Median frame time, driving | **16.7 ms** (60 fps) |
| 95th percentile frame time | 17.9 ms |
| Cost of one explicit render | 1.2 – 2.8 ms |
| Draw calls | 348 – 523 (was 409 – 613) |
| Of which the interaction layer | 17 – 34 |
| Rigid bodies | 441 |
| Colliders | 576 |

Four things were found and fixed after the world was reported as feeling
heavy. None of them showed up as a low frame rate; they showed up as hitches.

- **A save every two seconds while driving.** Distance-driven progress was
  reported every frame, which kept the achievement save permanently dirty. It
  is reported every five metres now.
- **Twenty React re-renders a second.** The gameplay HUD was republished on a
  timer whether or not anything in it had changed. It is compared first.
- **The level draws itself in hundreds of tiny calls** — 371 scenery meshes
  averaging 212 triangles each. The static ones are merged per material per
  26 m cell, the way the vegetation already was; anything the interaction
  layer looked up is left alone, because something is going to move it.
- **Idle effect work.** The explosion system walked 320 smoke slots and every
  debris pool on quiet frames; the career walk, the lane, the plates and the
  achievement pillar all ran their animation from across the island.

The projects screen is now a 960 × 540 canvas repainted at 12 Hz, and only
while the board is open or within 26 m.

## Routes

`npm run world2:routes` against `next start` on a production build:

| Route | Console errors | Renders |
|---|---|---|
| `/` | 0 | Alejandro Newport — Software & AI Engineer |
| `/world` | 0 | World — Alejandro Newport |
| `/world2` | 0 | World 02 — Alejandro Newport |

`npm run lint`, `npm run typecheck` and `npm run build` all pass.

## Teardown

Leaving `/world2` was checked explicitly: after navigating away,
`window.__world2` is `undefined` and the audio context is no longer running.
The physics world, the RAF loop, every ticker subscription, every listener,
every canvas texture and every mini-game timer are owned by the route's `Bin`
and disposed with it.

## Known differences, deliberately

These are not failures; they are decisions, and each is argued in
[WORLD2_INTERACTIONS_IMPLEMENTED.md](WORLD2_INTERACTIONS_IMPLEMENTED.md).

- The circuit leaderboard is per browser. Upstream's is a websocket service
  that is not in the public repository.
- The altar and cookie counters are per browser for the same reason.
- Whispers are not activated: they carry other visitors' messages, and there is
  no server. A fake one would be a lie about other people being here.
- The six social icons with no Alejandro equivalent are scenery — no label, no
  link.
- The three award logos on the projects shelf are hidden. A badge is a claim.
- The `bricks` collection stays static: those are wall courses in built
  structures, not loose bricks.
- The `easter` and `fwa` collections are disabled in the .blend itself and
  absent from the export, so there is nothing to activate.
- The career year is painted rather than driven through the authored
  seven-segment geometry: that plate faces along the road the driver travels,
  so its bars are never legible from the car.
