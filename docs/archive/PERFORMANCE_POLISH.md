# Portfolio performance and polish

## Findings and changes

- CPU sampling identified the road sampler as the largest startup cost: every terrain vertex searched every road segment. An exact AABB spatial index preserves nearest-segment results, including tie ordering. A randomized equivalence test covers curved, crossing and degenerate roads.
- Homepage first-frame artwork used a different camera from the live room, and reading-field measurements included active text transforms. Responsive opening frames now use the live camera; measurements remove animation translations and ignore counter-only mutations.
- The second, otherwise empty R3F canvas now loads near its first homepage scene. Initial homepage loading makes no world requests.
- The canopy prepares progressively, responds to the first continuing input at the page end, and shares one transition with the entry links. Both the footer dwell gate and initial 500 ms input lockout are removed; page-end and momentum checks remain. Coverage and world readiness are verified before revealing. Parting finishes from actual browser animation completion.
- Direct URLs and history navigation use the same foliage mask. Batched hide/show transitions receive a fresh cover identity. Error and slow-load notices render above the cover so recovery remains usable.
- Coverage spans WebKit's mobile viewport correctly and sits above the chapter index. Verification checks that the cover actually wins hit-testing at the visible corners and center.
- Safe scenery batching removes 38 draw calls in the measured starting scene. Texture uploads yield between batches. Hidden tabs and open dialogs stop world rendering and simulation.
- The world inherits the homepage's live colors, fonts, controls and surfaces. Map dimensions are bounded and centered across desktop, ultrawide, tablet and phone layouts; touch controls share the same palette.
- The leaderboard texture uses the authored reading side instead of the car's temporary spawn position. Title, subtitle, ranks and dynamic records were visually checked. Track fabric uses muted terracotta, teal and ochre with no logo textures.

## Loading priorities

| Priority | Work |
| --- | --- |
| P0 | Homepage text, fonts, opening room frame and live room |
| P1 | Homepage section chunks; R3F canvas one chapter before its scene |
| P2 | Canopy code after room readiness; invisible canopy preparation after the opening chapter |
| P3 | World bytes after 55% progress or explicit link intent; at most two low-priority warm downloads, without executing the world |
| P4 | Remaining runtime assets and lazy map UI when required |

Automatic world warming respects Save-Data and 2G hints. Explicit entry can still load the world. Downloads populate the normal HTTP cache without retaining duplicate ArrayBuffers.

## Quality and fidelity

High quality retains the existing 1.5 DPR cap and 2048-pixel sun shadows. Sustained expensive frames lower DPR, pixel budget and shadow resolution, with a longer healthy interval before promotion. Lower tiers use DPR caps of 1.2/0.85, pixel budgets of 2.4M/1.2M and shadows of 1024/512 pixels. Initial hardware hints are only a starting point; viewport size and user-agent strings do not select a device tier.

Important geometry, vegetation and interactive content remain. The existing constrained-device canopy budget remains available. Reduced motion uses a short cover fade and stops decorative grass/model animation while preserving driving and interaction. No new libraries or service worker were added.

## Measured evidence

Local production build, cold browser contexts, 1440×900, real GPU. These are developer-machine observations, not field percentiles or physical-phone measurements.

| Measurement | Before | After |
| --- | ---: | ---: |
| World ready, excluding the script's 5-second observation period | ~14.9 s | ~6.5 s |
| Cold homepage JavaScript transfer | 535 KB | 472 KB |
| Longest world startup task | 11.23 s | 2.84 s |
| Starting-scene draw calls | 1,323 | 1,285 |
| GPU geometries | 495 | 457 |
| Early-scroll frame median / p95 | 16.7 / 16.8 ms | 16.7 / 16.8 ms |
| Observed homepage layout shifts | 0 | 0 |

The final isolated homepage sample reported 52 ms first contentful paint, 705 ms live-room readiness and no startup long tasks. Timing varies with hardware and cache state; transfer-size and structural improvements are more repeatable.

At 390×844 with Chrome's 4× CPU slowdown and 1.6 Mbps / 150 ms network emulation, content painted in 1.03 seconds and the live room was ready in 5.21 seconds. There were 10 startup long tasks (longest 151 ms, total blocking time 409 ms), and no world requests. This deliberately constrained case remains slower; the opening artwork and readable content appear before WebGL is ready.

Profiling and browser evidence are saved under `.qa/runs/polish-*.json` and associated screenshots. Reproduction scripts live in `scripts/qa/polish-{profile,cpu,flows,compat}.mjs`; use a production preview on port 3210 or set `QA_BASE`.

## Validation

- Production build, TypeScript and ESLint on changed TypeScript/React files passed. The repository-wide lint command traverses unrelated `.claude/worktrees`, so the changed files were checked directly.
- All 34 unit tests passed, including exact road-query equivalence and quality hysteresis.
- All 30 main browser-flow assertions passed: early scrolling at five sizes, immediate end-scroll response, both entry paths, one runtime only, driving, centered map at four sizes, repeated map resource counts, both dialogs, leaderboard and fabric, return and re-entry.
- Installed Chrome: 13/13 assertions passed, including direct arrival, keyboard driving, responsive resize, browser history, reduced-motion phone entry, touch styling and a forced runtime failure followed by a successful real retry click.
- Playwright WebKit: 10/10 compatibility assertions passed, including direct arrival, dialogs, font loading, responsive resizing, history, reduced-motion phone entry and touch styling. No uncaught exceptions or failed resources in the normal test flows.
- Transition edge cases: 11/11 passed, including a fast jump to the footer followed by one continuing input, reversal of a partial charge, viewport resizing while covered, history restoration and load-failure recovery.
- Screenshots were inspected for the opening room, world HUD/dialogs, map layouts and the leaderboard's dynamic text. Geometry/texture counts remained stable across repeated map use.

## Remaining costs and limits

The published world document is already gzipped and still approximately 17.25 MB; asset definitions add approximately 4.30 MB. Existing compressed GLBs total approximately 9.56 MB. Preparation can hide much of the network wait during reading, but direct cold entry on a slow connection remains substantial. Further reduction requires changing the authored/exported asset representation and validating editor round-tripping.

Road polygon operations and restoration still create multi-second startup tasks under the cover. Moving those operations into workers or baking validated road geometry is a separate, higher-risk change. The scene still renders approximately 1.64M triangles and 1,285 draw calls at the measured starting view. Adaptive resolution helps GPU pressure but cannot guarantee smoothness on every device.

The console retains existing Rapier/Three initialization and texture/deprecation warnings; browser test logs preserve them for follow-up. WebKit coverage is engine-level automation, not physical iOS/Safari certification.

## Admin World boards and production publication

- Admin World → Carteles edits every Projects and Next experiment card: text, links, metadata and uploaded PNG/JPG/WebP illustrations. Projects also offers animated illustrations.
- Images are resized to 1280 px and stored in the world's root metadata. Existing draft saves, revision history, undo/redo and publication carry the edits together with the world.
- The public lower-left driving HUD now contains only speed and KM/H; editor driving diagnostics remain available.
- Validation: 36 unit tests, production Next/OpenNext builds, and 9 browser assertions covering editor changes, images, undo/redo, driving, fresh release restoration, and desktop/mobile HUD. Browser tests use isolated release data and never write to the published world.
