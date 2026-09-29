# Third-Party Notices

This project incorporates material from the projects listed below. The original
copyright notices and licence terms are reproduced in full.

---

## 1. folio-2025 — Bruno Simon

**The `/world` interactive experience is a derivative work of Bruno Simon's
`folio-2025`.** Its game loop, physics layer, ray-cast vehicle model, camera
("View") model, input action system, event system and several gameplay systems
are ported and adapted from that project. The engine underneath Alejandro
Newport's world is Bruno Simon's engine. That is not incidental and it is not
hidden: without `folio-2025` this route would not exist.

| | |
| --- | --- |
| **Author** | Bruno Simon |
| **Project** | folio-2025 |
| **Source** | <https://github.com/brunosimon/folio-2025> |
| **Licence** | MIT |
| **Copyright** | Copyright (c) 2025 Bruno Simon |
| **Upstream commit studied** | `41046b57eeed8d156d9c3fd7fa259900baef7816`, September 2026 |

### Licence

```
MIT License

Copyright (c) 2025 Bruno Simon

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

A verbatim copy also lives beside the ported code at
[`src/world/vendor/LICENSE-folio-2025.md`](./src/world/vendor/LICENSE-folio-2025.md),
and every ported file carries a `PORTED FROM` header pointing at its upstream
origin.

### What was ported, adapted, or written fresh

| Area | Relationship to upstream |
| --- | --- |
| `src/world/core/Events.ts` | **Ported.** Ordered pub/sub, upstream `sources/Game/Events.js`. |
| `src/world/core/Ticker.ts` | **Ported and changed.** Upstream `Ticker.js` + `Time.js`, including the `scale = 2` time dilation that defines the game's pace. Converted to a fixed-timestep accumulator so physics is frame-rate independent. |
| `src/world/core/maths.ts` | **Ported.** `sources/Game/utilities/maths.js`. |
| `src/world/physics/Physics.ts` | **Ported.** `sources/Physics/Physics.js` — collision groups/categories, the physical description factory, contact-force event fan-out. |
| `src/world/physics/PhysicsVehicle.ts` | **Ported, near-verbatim.** `sources/Physics/PhysicsVehicle.js`. Every tuning constant (engine force, top speeds, brake amplitudes, suspension heights and stiffnesses, wheel friction/suspension settings, flip impulse and torque) is upstream's. This is the file that makes the car feel the way it does, and deviating from it would defeat the purpose. |
| `src/world/player/Player.ts` | **Ported.** Input→intent mapping, hydraulics/suspension state machine, unstuck/flip-back logic, respawn, distance-driven accounting. |
| `src/world/view/View.ts` | **Ported and extended.** Upstream's focus-point magnet, spherical offset, speed-reactive zoom and spring "roll" kick. Orbit-on-drag and collision avoidance were added for this project. |
| `src/world/input/*` | **Ported.** The action-map/category/filter input system, keyboard, pointer, wheel, gamepad and the touch joystick ("nipple") maths. |
| `src/world/systems/*` | **Adapted.** Achievements, notifications, interactive points, map, zones, respawns, day cycle, weather, tracks and objects follow upstream's architecture with original content, presentation and persistence schema. |
| `src/world/world/Ecology.ts` | **Adapted techniques, original implementation/art.** Chunked instances, reactive foliage and pooled leaves informed by upstream Trees, Bushes, Foliage, Grass and Leaves. |
| `src/world/world/Water.ts` | **Adapted techniques, original GLSL/art.** Terrain-derived shore depth, wind and ripples informed by WaterSurface. |
| `src/world/world/Playground.ts` | **Adapted mechanics, original content/art.** Bounded dispenser, tipping cabin, radial explosions and reset patterns informed by CookieArea, ToiletArea, AltarArea, Objects and ExplosiveCrates. |
| `src/world/minigames/Bowling.ts` | **Adapted mechanics, original lane and rules.** Physical ball/pins, latched tilt detection, settling and reset informed by BowlingArea. |
| `src/world/minigames/CircuitRace.ts` | **Adapted presentation, original track/detection.** Countdown, gate curtain and checkpoint recovery informed by CircuitArea; directional swept checks and the non-crossing layout are original. |
| Other district geometry, text, signs and challenges | **Original.** Written for Alejandro's projects and island. |
| `src/world/audio/*` | **Original.** Fully synthesised with the Web Audio API. No upstream sound files are used. |
| Art, models, textures, fonts, sounds | **Original.** No asset from `folio-2025` is redistributed here. All geometry is procedural; all audio is synthesised; typography is Geist. |

### What was deliberately not taken

- Bruno Simon's name, branding, biography, projects, links, contact details and
  written copy.
- The `static/` and `resources/` asset trees: models, textures, KTX2/Basis
  files, fonts and the sound library. None of it is copied or served.
- The upstream world layout, districts and landmarks.
- The server component (whispers, global leaderboard). It is not in the public
  repository, and this project replaces it with local-only equivalents.

---

## 2. Runtime dependencies

These are consumed as unmodified npm packages and are not redistributed in
source form here. Full licence texts ship inside `node_modules/<pkg>/`.

| Package | Licence | Copyright |
| --- | --- | --- |
| [three](https://github.com/mrdoob/three.js) | MIT | Copyright © 2010–2026 three.js authors |
| [@dimforge/rapier3d-compat](https://github.com/dimforge/rapier.js) | Apache-2.0 | Copyright © 2021 Dimforge |
| [next](https://github.com/vercel/next.js) | MIT | Copyright © 2026 Vercel, Inc. |
| [react](https://github.com/facebook/react), react-dom | MIT | Copyright © Meta Platforms, Inc. and affiliates |
| [zustand](https://github.com/pmndrs/zustand) | MIT | Copyright © 2019 Paul Henschel |
| [gsap](https://gsap.com) | Standard "No Charge" GreenSock licence | Copyright © GreenSock |
| [lenis](https://github.com/darkroomengineering/lenis) | MIT | Copyright © 2024 darkroom.engineering |
| [@react-three/fiber](https://github.com/pmndrs/react-three-fiber), [@react-three/drei](https://github.com/pmndrs/drei) | MIT | Copyright © 2019–2026 Poimandres |
| [geist](https://github.com/vercel/geist-font) | SIL Open Font License 1.1 | Copyright © 2023 Vercel, Inc. |

Rapier is Apache-2.0, which requires that the licence and any `NOTICE` be
carried with redistributions of the code. The compiled WebAssembly module is
bundled into the `/world` route's JavaScript; its licence text is retained at
`node_modules/@dimforge/rapier3d-compat/LICENSE` and reproduced by this notice.

---

## 3. Asset provenance

Every asset served by this site is either produced by Alejandro Newport or
generated by this repository's own code.

| Asset class | Source | Licence position |
| --- | --- | --- |
| `/world` geometry | Generated procedurally at runtime from code in `src/world/world/` | Original |
| `/world` audio | Synthesised at runtime by `src/world/audio/Synth.ts` (Web Audio oscillators and noise buffers — zero audio files) | Original |
| `/world` typography in 3D | Extruded from vector outlines generated in `src/world/world/Type.ts` | Original |
| `public/assets/client-work/*` | Screenshots of live public client websites captured by `scripts/capture-clients.mjs` | Used to describe Alejandro's own delivered work; see `CONTENT_STATUS.md` |
| Fonts | Geist Sans / Geist Mono via the `geist` package | SIL OFL 1.1 |

No third-party 3D model, texture, sound file, music track or font beyond the
above is bundled, downloaded or served.

---

## 4. If you are Bruno Simon

Thank you. The engineering in `folio-2025` — particularly the ray-cast vehicle
tuning and the focus-point camera — is the reason this page is fun rather than
merely functional. If anything here misrepresents the relationship or you would
like the attribution worded differently, the contact details are on the
[home page](https://alejandronewport.com).

---

## 5. Simple Icons — the marks in the tech toolbox

The Tech Toolbox chapter draws every technology as an app icon. Where a
technology has a published brand mark, the path geometry comes from Simple
Icons: it is extracted once by `scripts/gen-tech-logos.mjs` and pinned into
`src/content/tech-logos.ts`, so the page never fetches a third-party asset at
runtime and the icon set cannot change under the site's feet.

| | |
| --- | --- |
| **Project** | Simple Icons |
| **Source** | <https://github.com/simple-icons/simple-icons> |
| **Licence** | CC0-1.0, for the icon geometry |
| **Generated file** | [`src/content/tech-logos.ts`](./src/content/tech-logos.ts) |
| **Generator** | [`scripts/gen-tech-logos.mjs`](./scripts/gen-tech-logos.mjs) |

### Licence

```
CC0 1.0 Universal (CC0 1.0) Public Domain Dedication

The person who associated a work with this deed has dedicated the work to the
public domain by waiving all of his or her rights to the work worldwide under
copyright law, including all related and neighboring rights, to the extent
allowed by law.

You can copy, modify, distribute and perform the work, even for commercial
purposes, all without asking permission.

Full text: https://creativecommons.org/publicdomain/zero/1.0/legalcode
```

### Trademarks

CC0 covers the drawings, not the marks they depict. Every logo in the toolbox
remains the trademark of its owner. They are used here nominatively — to name
the technologies this site's work is built with — and imply no endorsement,
sponsorship or affiliation, in either direction. Where a technology has no
public project behind it, its tile is dashed and dimmed and the readout says
"no public repository yet", so a mark on this wall is never a claim about the
mark's owner. If you own one
of these marks and would rather it were not shown, the contact details are on
the [home page](https://alejandronewport.com).

### Where a mark stands in for a relative

A few tiles wear the mark of the project a technology belongs to rather than
one of its own, because that is the mark that exists: Java shows OpenJDK,
"C / C++" shows C++, "TensorFlow / Keras" shows TensorFlow, "CI / GitHub
Actions" shows GitHub Actions, and React Native shows the React mark it
shares officially. Each tile carries the technology it actually stands for in
its accessible name and its tooltip, so nothing is passed off as something
else.

Node.js and Express used to share one tile under the Node mark. They are two
tiles now, each with its own mark, because Simple Icons carries both and a
runtime is not its web framework.

### Where there is no mark

Simple Icons does not carry a mark for a concept — "Deep Learning", "Search &
MCTS", "Cryptography" — and does not carry every trademark. Those tiles are
drawn by hand in `src/components/tech/TechTile.tsx`, in the same line-art
vocabulary as `src/components/motion/ModuleGlyph.tsx`. No logo is invented,
approximated or reconstructed from memory: a technology either has its own
mark here or it has a house drawing of the idea.
