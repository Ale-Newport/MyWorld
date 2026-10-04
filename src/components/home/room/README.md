# The home room

The homepage's backdrop: a white classical hall, fixed to the viewport, that
ivy and moss take back as the visitor scrolls. It replaces the earlier SVG
"botanical" background. Everything is procedural; no image, model or texture
file is loaded, apart from two fallback stills that are rendered from this same
scene (see [Fallback](#fallback)).

## Where it lives

| File | Responsibility |
| --- | --- |
| `HomeRoom.tsx` | The layer's life: mounting a canvas, sizing (large viewport height), measuring the copy, following the scroll, pausing, tearing down. Mounted by `Journey.tsx` on the home journey only. |
| `room.module.css` | The fixed, pointer-transparent layer at `z-index: 0`, and the fallback still. |
| `config.ts` | **The tuning surface** (seed, growth range, vine and moss density, leaf scale, clearances, light, quality tiers). |
| `growth.ts` | Scroll progress → growth `G` (0..1), from chapter boundaries. |
| `engine.ts` | The WebGL renderer and the redraw policy: what is rebuilt, relit, redrawn — and when nothing is. |
| `scene/compositions.ts` | One hall and lens per layout class (wide, desktop, tablet, portrait, short landscape). |
| `scene/architecture.ts`, `scene/profiles.ts`, `scene/builder.ts` | The hall as real geometry: swept moulding profiles (entablature, skirting, Attic bases, Tuscan capitals, niche surrounds; panel frames, which no composition currently uses), fluted pilaster shafts, niches, bevelled floor slabs. |
| `render/camera.ts` | The fitted lens (vertical lens shift, no tilt), pinned to the measured HUD and gutter. |
| `render/lighting.ts` | The lighting cache: ~250 shadow-mapped samples (an area key, a skylight, floor and wall bounce) accumulated once per layout. |
| `render/shaders.ts`, `render/natureShaders.ts` | Surfaces (stone, plaster, limestone, moss, damp, cracks), plants and their contact shadows, output. |
| `render/textures.ts` | Tileable noise for stone grain and plaster at real-world scale. |
| `nature/sprites.ts` | The prototype's leaf and moss painters, ported: pigment (albedo) separated from relief (normal map); no painted shadows. |
| `nature/botany.ts` | The prototype's `buildBotany`, moved onto the stone: stems, branches, leaves with their timing; pruning by the reading field. |
| `nature/relief.ts` | The back wall as a height field, so stems lie on the mouldings and wrap round pilasters. |
| `nature/fields.ts` | The prototype's `mossAt` and `buildWeather`, baked per surface: moss birth, cracks, damp streaks. |
| `nature/vegetation.ts` | Instanced leaves, one merged stem buffer, their shadows, fallen leaves — every candidate built once per hall; pruning rewrites two attributes. |
| `layout/readingField.ts` | Where the copy is, measured from the DOM, as a time-aware field. |
| `view.ts` | The room's fitted lens, published for the canopy. |
| `canopy/plan.ts` | The portal's canopy: the room's ivy, come loose of the wall and grown out towards the lens in layers of depth, planned in screen terms. |
| `canopy/renderer.ts`, `canopy/shaders.ts` | The canopy's own small WebGL context (transparent, above the page): the room's plants, painted back to front, lit by the hall's key and sky; frozen into plain canvases when full. |
| `canopy/CanopyCover.tsx`, `canopy/canopy.module.css` | The cover in the root layout (via `botanical/GardenCover`): grows with the portal's charge, survives the route change, parts on /world2. |

## How it works

**Fixed, not scrolled.** The layer is `position: fixed` at the root of the
journey (a sibling of `<main>`, outside every sticky stage and transformed
ancestor), `100lvh` tall so mobile toolbars never resize it, and
`pointer-events: none`. The camera never moves; only growth changes.

**Growth.** `G` runs from the start of the prelude to the start of the contact
chapter (`config.growth`), from a non-zero floor so the hall opens already
inhabited. It is a pure function of scroll progress, so any position has one
look, reached forward, backward or by a jump; jumps larger than
`SNAP` land in one frame. Each stem's tip, each leaf's unfurling, each moss
tuft, crack and damp streak has its own birth on that timeline, from a fixed
seed. Reduced motion holds one settled state (`growth.reducedMotion`) and no air.

**Light.** Because the camera is fixed, the bare architecture is lit once per
layout to convergence (soft key shadows, skylight occlusion, bounce) and cached
as an irradiance image. Surfaces, moss and plants then read that cache —
plants at their own pixel, so a leaf under the cornice is in the cornice's shade.

**Reading.** The copy's line boxes are measured relative to their pinned stages
(every chapter at once) plus the fixed HUD, inflated by type size and blurred
into a field. Words a reveal has not yet slid into place are measured where they
will stand; the HUD's footer at both of its places (above a mobile toolbar and
below it); a slot that fills on interaction (`data-room-reserve`, the Toolbox
readout) as if it were full; a label whose words change with the chapter
(`data-room-reserve-text`, the HUD's chapter title) at its longest. Growth born at `G` keeps clear of the chapters
still on screen at or after `G`; held growth (reduced motion, a pinned value,
the stills) keeps clear of every chapter. Stems are not clipped: each is followed from its root and stops at
its last clear node, ending in a natural tip. Moss, damp and cracks are delayed
under the field. The lens is fitted to the DOM too: the plain architrave carries
the HUD's row, the pilasters sit in the copy's gutter, and the wall's foot falls
between rows of low copy.

**Redraw policy.** Nothing is drawn while nothing changes. A growth change
redraws the surfaces (one geometry pass) and the plants; ambient sway redraws
only the plants over the cached room (one render call), at `swayFps`, and only
for `swayLinger` seconds after the last scroll or resize before the air
settles. Preparation is staged over idle callbacks and aborts if the layer is
torn down; light accumulates a number of samples per frame scaled to the
pixel count. A frame-time watchdog steps the quality tier down after sustained
slow frames (fewer pixels, no MSAA at the lowest tier, fewer leaves); a resize
is applied once the window settles, and a change of screen pixel density is
picked up too.

**Failure.** No WebGL2, or no renderable float colour buffer: the still is
shown. A lost context shows the still; if the browser gives the context back,
the layer starts again on a fresh canvas.

**The way out.** Pushing past the end of the page (the portal, in
`journey/WorldPortal.tsx`) charges it, 0..1. Nothing stands over the page
before that: at the foot, unpushed, the room alone frames it. As the charge
builds, the room is TAKEN OVER (`setTakeover`, complete at
`growth.takeoverAt`): stems the copy had stopped run on, held-back leaves
unfurl, the takeover's own ivy (`wildSpecs`) comes in over the central bay
from the frame inward, and moss and damp advance over the ground the copy
had kept clear. In front of the page, the CANOPY closes in: the same ivy,
loose of the wall, layer by layer towards the lens, the nearest last and
largest, over the dark of the leaves behind. When the charge is full the
canopy's last frame is frozen into six plain canvases (three depth bands,
each split down the middle by whole plants) and its context is released,
with the room's, before the route changes. On /world2 the ivy parts down the
middle — the near leaves first and furthest — by CSS transforms alone, so it
keeps its pace while the world starts.

The canopy is prepared on the approach (within 1.35 viewports of the foot) in
slices of idle time — the plan a layer at a time, then each layer, then its
programs — so that never stalls the scroll; a commit that arrives first finishes
it on the spot. Its leaves are painted back to front with premultiplied
blending (the lens never moves, so the order is fixed once), without depth or
multisampling. Once it stands over the page it takes the clicks, and at the
commit the page is made `inert`. The hand-off itself (contexts released, route
pushed) runs on timers of its own, so a setting changing mid-way cannot cancel
it; leaving by another way meanwhile takes the cover and the seam colour away.
A cold arrival on /world2 (a hard load that still holds the arrival key) gets
the canopy's dark alone, parting by fading: drawing a canopy there would compete
with the world's start-up.

## Tuning

Edit `config.ts`. A few useful knobs:

- `seed` — re-seeds everything at once; nothing else is random.
- `growth.fromChapter` / `toChapter` / `floor` — the growth range.
- `vines.leafScale`, `leafDensity`, `branchDensity` — the ivy.
- `moss.coverage` — how far moss spreads by `G = 1`; `moss.tile`,
  `tuftDensity`, `tuftSize` — the tuft sheet's scale on the stone.
- `vines.swayAmplitude`, `swayFps`, `swayLinger` — the air.
- `growth.takeoverAt` — the portal's charge at which the room's takeover is
  complete; `canopy.ambient`, `canopy.key` — the canopy's light. Its layers
  (depth, reach, timing, darkness) are at the top of `canopy/plan.ts`; its
  parting is in `canopy/canopy.module.css`.
- `clearance.*` — how much air the copy keeps (per type size).
- `light.*` — exposure, key window, skylight, bounces.
- `quality.*`, `maxMegapixels`, `samplePixelsPerFrame` — pixel ratio, MSAA,
  shadow map size, sample counts and leaf share per tier; the pixel budget.

Per-layout room proportions, lens distance and foliage scale are in
`scene/compositions.ts`.

## Development aids

- `/?room-g=0.5` pins growth; `/?room-still` holds the air still;
  `/?room-capture` frames the room for the fallback stills;
  `/?room-takeover=0.5` pins the portal's takeover.
- `/?room-debug=field` (dev only) overlays the reading field; `=irradiance`
  shows the lighting cache.
- `window.__room()` returns the engine's state (composition, growth, cache
  progress, stems and leaves kept, air, draw count, start-up timings — the
  `fields` figure is wall time across its idle slices — GPU resources).

## QA scripts

All need a running server (default `http://localhost:3000`).

- `node scripts/home-room-contrast-qa.mjs [base] [viewports]` — measures every
  visible line of text against the pixels actually rendered behind it, per
  chapter and scroll position, at seven viewports (WCAG 4.5:1 / 3:1).
- `node scripts/home-room-lifecycle-qa.mjs [base] [chromium|webkit|firefox]` —
  fixed layer, pointer inertness, scroll determinism, jumps, idle, resize,
  context loss, navigation away and back, portal hand-off, deep link, reduced
  motion.
- `node scripts/home-room-perf.mjs [base] [WxH]` — frame intervals while
  scrolling and idle, draw counts, GPU resources, context release.
- `node scripts/home-room-stills.mjs [base]` — re-renders the fallback stills.
- `node scripts/home-portal-qa.mjs [base] [WxH]` — the way out, driven for
  real: nothing over the page at the foot, the takeover, full cover at the
  commit, the hand-off (contexts released, no light frame), the parting and
  the arrival on /world2. `PORTAL_VIDEO=1` records the run.

## Fallback

If WebGL2 is unavailable or its context is lost, the layer shows
`public/home-room/still-{landscape,portrait}.webp`: stills rendered from this
scene by `scripts/home-room-stills.mjs`, early in the growth and with the
entablature just out of frame (a still is scaled to screens it was not fitted
to, so nothing dark stands where a HUD might). They are requested only in that
case.

## Known limits

- The hall has blind arched niches, but on the standard layouts they sit in
  side bays outside the frame, and the central bay has no panel: the copy
  reaches across the whole width in some chapter, and a dark recess or a
  moulding line behind small type would break its contrast.
- Phones show the pilasters only as slivers at the edges, for the same reason.
- The light is computed once per layout: resizing within a class re-accumulates
  it (the previous frame is shown, stretched, meanwhile).
