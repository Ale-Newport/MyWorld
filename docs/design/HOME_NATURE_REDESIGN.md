# HOME_NATURE_REDESIGN

The homepage is a minimal editorial page that a plant grows over, and almost none of
the page moved to make room for it.

This is the record of what shipped. Its two companions are
[`HOME_NATURE_SYSTEM.md`](HOME_NATURE_SYSTEM.md), which is the design system the work
was built from, and [`HOME_NATURE_REDESIGN_AUDIT.md`](HOME_NATURE_REDESIGN_AUDIT.md),
which is the survey of the seven chapters that decided what each one would get.
Neither of those describes the implementation. This one does: the real file names, the
real numbers, the decisions that were taken along the way, and the ones that were
reversed.

Where a number appears below it came out of the source or out of a harness in
`.qa/nature-proof/`. The harnesses are listed in
[`.qa/nature-proof/README.md`](.qa/nature-proof/README.md) with what each one proves
and how to run it.

---

## 0. What is where

| | |
| --- | --- |
| `src/components/home/nature/NatureController.tsx` | The single ticker subscription. The density and wash curves, the band transforms, growth, wind, the reduced-motion path, the debug switch. |
| `src/components/home/nature/NatureLayer.tsx` | The band hosts and the wash: inert markup, the parallax tables, and the overscan derived from them. |
| `src/components/home/nature/placements.ts` | Forty-six specimens, where each is rooted, when it arrives, when it withdraws; the exclusion rectangles; the low-tier cast; the nudge-or-drop solver. |
| `src/components/home/nature/plants/` | Seven modules, twelve families. |
| `src/components/home/nature/chapters/` | `ChapterFlora.tsx`, the shared host, and the five compositions bound to marks inside a chapter rather than to the page: About's riser, KCL's rule vines, UCL's module sprouts, Toolbox's grid vine and Universe's annotations. |
| `src/components/home/nature/NatureDebug.tsx` | The development overlay. Unreachable in a production bundle — see §11. |
| `src/components/vegetation/canopy.ts` | The large-leaf vocabulary: axes, width profiles, margins, venation, fenestrations, cordate bases. |
| `src/components/vegetation/canopy.module.css` | The reveal — the clip wipe, the dash, the pivot. |
| `src/components/vegetation/flora.ts`, `Vegetation.tsx` | The margin-sprig layer that already shipped, now absorbed as the z 4 band. |
| `src/components/journey/WorldPortal.tsx` | The gateway: the charge, the resistance, the threshold, the hedge, the preload ladder, the commit and the return. |

The layer is mounted once, in `src/components/journey/Journey.tsx`:

```
{journey === 'home' ? <NatureController /> : <Vegetation />}
```

`/projects` keeps the sprig layer exactly as it shipped and gains no nature bands. That
was OQ-6 and it was confirmed.

One thing about that route did change, and it is a subtraction. `Stock.tsx`, its last
chapter, used to mount the gateway — the veil, the charge and the threshold, exactly as
the home journey ends — which gave a second route a door only one route is supposed to
open, and printed fourteen specimens of a botanical threshold over the last screen of
the order book. The gateway belongs to the home journey alone. `/projects` now closes
the way the rest of the site closes a page: a hairline, "End of the projects", and one
link back to the portfolio, in the band above the HUD the gateway used to stand in. The
composition above it is untouched, and `--foot` is unchanged.

---

## 1. The visual concept

Nothing on the page was redesigned. The seven chapters keep their type, their layout
and their `vh`; the scroll map in the audit's §0 is unchanged. What changes across
twenty-six viewport-heights is how much has taken root around the reading.

Eight narrative bands carry it, and they are edges in progress space rather than
states:

| edge | 0 | 0.12 | 0.26 | 0.40 | 0.55 | 0.73 | 0.86 | 0.96 | 1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| | clean digital | first signs | nature enters | interacts | dense framing | merge | full immersion | gateway | |
| density | 0 | 0.04 | 0.14 | 0.30 | 0.52 | 0.74 | 0.92 | 1 | 1 |
| wash | 0 | 0.06 | 0.14 | 0.24 | 0.36 | 0.48 | 0.58 | 0.62 | 0.62 |

Both curves are interpolated with `easeInOutCubic` between those anchors and never
stepped, so no boundary announces itself and a deep link that lands slightly short of
one looks like nothing in particular.

Three things hold the concept up, and each is a constraint rather than an effect.

**The page keeps its paper.** The wash tops out at 0.62 of `#f6efe1` over white,
which measures `#f9f5ec` — L\* 96, a cream. The darkest ground any visitor sees is
lighter than most papers. Two layers above it foreshadow the gate and both had to be
pulled back hard: the vignette ran to a full 1.0 of a 9 % olive over the outer half
of the viewport and the bloom to 0.5 of a 46 % sand climbing most of the way up it,
and between them a bare pixel at the foot of the page landed twenty-odd levels off
the ground colour with nothing drawn on it. They ship at ceilings of 0.55 and 0.22.

**Nothing crosses a line of type.** `--text-muted` at L\* 51 under a `--leaf-front`
leaf is about 1.2:1, which is not a contrast, it is a smudge. Twenty-seven exclusion
rectangles (twenty-three on a phone) are tested at arrangement time against every
mid, front and close footprint, and a specimen that lands on one is moved or dropped.

**The vegetation enters from the margins.** That is what keeps the centre clear, and
it is also why acceptance criterion D had to be restated — see §12.

---

## 2. The `natureProgress` architecture

`natureProgress` is not a variable. It is `frame.progress`, which the scroll driver
already computes once per frame in pixel space, and the whole layer is a pure function
of it:

```
density = natureDensity(frame.progress)     // the anchored curve above
growth  = growthOf(plant, density)          // per specimen, reversible
```

Nothing accumulates anywhere in the system. Scrolling back up ungrows the garden in
the correct reverse order with no special case, and a reader who stops scrolling is
not animated at.

Two traps were worth the trouble they caused.

**Pixel space against vh space.** `frame.progress` normalises by *scrollable* vh (25),
while the store's `chapterRanges()` normalises by *total* vh (26). They disagree by up
to 3.45 points at the contact boundary — 0.86 of a viewport height, enough to put the
palms on screen most of a screen before the chapter they belong to. `natureBands()` in
the controller therefore derives the chapter boundaries in the same space
`frame.progress` is in, from `journeys.home.chapters` and `totalVh()`, rather than
reading the store's. It is derived and not typed because `?quick` changes every
chapter's `vh` and therefore every boundary.

**What a chapter-bound plant keys on instead.** `placements.ts` names four kinds of
specimen it deliberately refuses to hold — KCL's five module rules, UCL's module
sprouts, the Toolbox hover tendrils, Universe's annotation tendrils — because each is
tied to a mark inside a chapter whose position is known only from that chapter's own
measured boxes, and every one of those boxes moves with the viewport. A table of
viewport fractions cannot hold them. They live in
`src/components/home/nature/chapters/` on `useChapterFrame`, where the vh/px drift is
harmless: the same wrong-but-consistent number drives both the chapter and the plant
growing on it. About's riser joined them for a different reason — it rises as the four
marker rows arrive, so it is keyed to the type and not to the page.

A chapter layer may read its own chapter's geometry, because it re-reads it on every
reflow. It may **not** overhang the chapter, because `.stage` is `overflow: clip`, and
it may not expect any z relationship with the body-level bands beyond the fixed one:
inside the z 10 stage it is above every band mounted before `<main>` and below every
band mounted after it. And it may not re-render while the page is moving — everything
in it either runs once, runs on a reflow, or runs on an event the visitor caused, and
the per-frame half is three property writes on a node the chapter already has a ref to.

### Why there is no GSAP ScrollTrigger

The repo already has exactly one scroll authority. Lenis drives one rAF loop, that
loop writes `frame`, and everything on the site — the chapters, the WebGL scenes, the
HUD, the sprig layer — reads it. ScrollTrigger brings its own scroll listener, its own
rAF and its own idea of when a frame begins, so adding it would mean two clocks
disagreeing by one frame about where the page is. The visible cost of that is not
jitter in the plants; it is plants and type that no longer agree, in a design whose
whole argument is that they grew together. One authority was already there and was
kept.

---

## 3. The SVG plant library

Twelve families in seven modules, registered once at import time by
`src/components/home/nature/index.ts` so `NatureLayer` can look a family up by name and
treat a missing one as a blank rather than as a crash.

| module | families |
| --- | --- |
| `plants/Monstera.tsx` | `MonsteraShadow`, `MonsteraJuvenile`, `MonsteraLarge` |
| `plants/Philodendron.tsx` | `PhilodendronHeart`, `PhilodendronPinnate` |
| `plants/Palm.tsx` | `PalmFrondArc`, `PalmFrondLow` |
| `plants/Banana.tsx` | `BananaBlade` |
| `plants/Vine.tsx` | `VinePrimary`, `VineTrailing` |
| `plants/Ivy.tsx` | `IvyClimber` |
| `plants/FernCluster.tsx` | `FernClusterLeft` |

`flora.ts` draws sprigs — small, open, stroke-only things that live in a margin and
are revealed by sweeping a dash. None of that machinery transfers to a blade big
enough to have an inside, so `canopy.ts` is a second vocabulary rather than an
extension of the first. A blade is an **axis** (the midrib), a **width profile**
(half-width along that axis) and a **margin** (the profile sampled, roughened and
smoothed into a closed outline). Veins are generated from the same axis, so they curve
with the leaf instead of being drawn on top of a shape that has forgotten them. That
one shared axis is what stops these reading as clip art: in real foliage every line on
a leaf is a consequence of the same growth.

The local frame is the petiole base at the origin, blade along +X, margins in ±Y.
A placement rotates and scales from that origin because that is the point a real leaf
pivots about. Nothing in `canopy.ts` is reachable from flora's `pickKind`: the
procedural margin layer must never spontaneously plant a banana leaf.

### Why a fill is a wipe and a stroke is a dash

`stroke-dashoffset` does nothing to a closed blade. So the two kinds of mark on a leaf
are revealed by two different mechanisms, declared in `canopy.module.css`:

- **the surface** by a **clip wipe** — a rect in the leaf's own local frame whose
  `scaleX` runs 0 → 1 with `--grow`, anchored at the petiole and travelling out along
  the leaf's own axis, which is the direction it grew;
- **the ink** by a **dash** — every vein carries `pathLength="1"`, so one inherited
  `--grow` drives an entire leaf's line work with a single property write whatever the
  real length of any individual path.

The ink is held a beat behind the surface deliberately. Reveal them together, or the
ink first, and what you are watching is a drawing being coloured in — which is exactly
the icon read this whole system exists to avoid. Held behind, the vein arrives just
after the tissue it describes, which is the order tissue actually appears in.

Base-to-tip ordering is as load-bearing here as it is in `flora.ts`, and every
generator honours it.

### Six defects found by rendering, not by reading

Each of these was invisible in the source, obvious on a proof sheet, and none of them
would have been caught by a type checker or a test. The proof sheets are
`.qa/nature-proof/library.mjs` and `vocab.mjs`; the evidence is `library.png`,
`vocab-all.png` and `honest-all.png`.

1. **The fish.** `MonsteraShadow` is the first botanical mark on the site, it has no
   vein work to argue with, and it came back as a fish with a gill slit. The cause was
   a one-point cordate base: two corners either side of a wide V is a tail, and once
   the eye has been given a tail it goes looking for a body. No width profile can fix
   it, because no width profile can add points to an outline. `cordateBlade()` builds
   the base out of **arcs** — five points a lobe, so the curve closes round them
   instead of turning a corner — with the sinus as a narrow **slot** rather than a wide
   V, because a real cordate base has its lobes very nearly touching.
2. **Veins finishing outside the margin.** Every generator that launches something
   from the midrib at an angle needs the same answer — how far can this travel before
   it leaves the leaf — and each one guessed it the same wrong way, as a fraction of
   the half-width *at its own origin*. That is only correct for a vein leaving at 90°
   on a blade of constant width, and this vocabulary has neither: the spread runs from
   78° at the base to 32° at the tip. On a tapering blade the outer secondaries
   finished outside the margin, which is the whiskery tip that gives a
   drawn-from-memory leaf away. One shared ray-to-margin solver replaced three private
   corrections.
3. **The chain-link palm.** A leaflet was five points closed by a Catmull-Rom. A
   closed Catmull-Rom takes its tangent at a point from the points either side of it,
   so the curve leaving the last edge point shot off at a length scaled to a control
   halfway to the tip and went straight past the base it was meant to close across.
   Every leaflet base came out as a small **ring** on the rachis, and at the front
   band, where the margin is stroked as well as filled, a palm crown was strung like a
   chain. A heel point was not enough — the ring merely became a bow tie — because the
   fault was in the interpolation and not in the samples. The outline is now three
   explicit quadratics, each control placed so the curve passes exactly through the
   point the old sampling passed through: the silhouette already judged, on the narrow
   attachment a pinna actually has.
4. **The midrib spur.** Every width profile reaches exactly zero at t = 1, so the last
   stretch of axis runs through tissue narrower than the rib's own stroke and a round
   line cap hangs a visible spur out past the point of the blade. That is the "midrib
   outliving its leaf" tell, and it is the one thing a viewer notices without being
   able to name. `midribPath` now stops short of the apex by default. Both the monstera
   and the banana had written the same local fix before it was folded back into the
   vocabulary.
5. **Fenestrations as blobs along the spine.** The same origin-half-width mistake in
   the other direction: on a widening blade a fenestration asking to reach the margin
   fell short of it, so every split closed into a punched hole and the library came
   back with entire margins and two neat rows of slots inside them — the icon of a
   monstera rather than a monstera. A fenestration is a *slot running outward* that
   tears the margin, placed in the channel between two secondaries, because that is
   where the tissue was thinnest.
6. **`IvyClimber` drew cannabis.** Ivy is palmate, so its margin is built in polar
   coordinates rather than off an axis, and the first version cut its sinuses back to
   three-fifths with a central lobe half again as long as its neighbours. Five narrow
   fingers radiating from a point is a row of unmistakable cannabis leaves threaded
   along a stem, on a portfolio. Hedera is the opposite plant: shallow sinuses, a blade
   that stays connected as a broad triangular sheet, bluntly triangular lobes. Three
   quarters is the number that reads as ivy. The same sheet also caught the earlier
   starfish, where each lobe was wider halfway out than at its base — a finger, not a
   leaf — fixed by sampling each flank so that `radius · sin(Δangle)` falls
   monotonically from sinus to tip.

The lesson generalises and is the reason `.qa/nature-proof/` exists at all: the
geometry builders are exported separately from the components precisely so a node
script can call them, render a sheet, and be looking at exactly the paths the browser
will get.

---

## 4. Plant layering

Five depth bands, plus the wash and the absorbed sprig layer. The z-indices are
tokens in `src/styles/tokens.css`:

| band | z | what it is | line work |
| --- | ---: | --- | --- |
| shadow | 2 | blurred silhouettes, no veins | none |
| wash | 3 | the warming ground, DOM-ordered first | — |
| back | 3 | far plants, flat fill | midrib only |
| flora | 4 | the shipped margin sprigs, unchanged | stroke only |
| mid | 12 | overlaps content edges, never a headline | + secondaries, gradient |
| front | 20 | crosses content; the "overtaken" layer | + tertiaries, stroked margin |
| close | 40 | one or two enormous soft cropped leaves | margin and gradient only |

z 0 is unusable: `GlobalCanvas` clears an opaque white across the whole viewport at
z 1. The wash and the back band share z 3 and are separated by DOM order alone, which
is why they are rendered inline, in order, next to each other.

### The three foreground depths are not constant

12, 20 and 40 are where mid, front and close stand while a chapter is being read. For
the length of every chapter transition they stand down: `data-ceded` on the host swaps
`--nature-z` for `--nature-z-ceded`, which is `calc(var(--z-content) - 5 | -4 | -3)`,
and all three paint UNDER `main.journey` instead of across it.

The reason is that a chapter's exit lift is the one stretch of the page no exclusion
rectangle can guard. The stage rides one viewport-height and every line of type on it
moves at scroll rate, so a leaf placed clear of a headline at rest is not clear of it
while the headline is travelling — the arrangement is measured against a pinned stage
and the type has left. Ceding the foreground for the duration is the same answer the
HUD already gives: the words paint over the leaf.

The flip is made while the stage is still pinned, which is exactly when the exclusion
pass guarantees no plant overlaps any line box, so at the moment the depth changes
there is not one pixel on the page where it could show. There is no transition on the
property and there must not be — animating it would invent the pop it exists to avoid.
The last chapter is excluded, so the gate frame is untouched. It costs three attribute
writes twice per boundary, six times down the page; no rAF loop and no render, and
reduced motion gets the same thing from a single store read.

### Why the bands are siblings of `<main>`

`main.journey` is a stacking context at z 10. Nothing drawn inside a chapter can paint
above it, whatever z-index it claims — so mid, front and close cannot live in a
chapter. `Chapter.module.css .stage` is `overflow: clip`, so a leaf that must overhang
a chapter boundary cannot live in one either. Three bands therefore mount before
`<main>` and three after it, and the plants that cross a headline are in the second
group.

The second group reaches `<body>` through `createPortal`. The alternative — a second
component mounted after `</main>` — works, but then one of the two components owns the
subscription and the other has to be handed its nodes: two mount points, one clock, and
a standing invitation for the next person to give the second one a ticker of its own.
The portal keeps the whole system in one component with one arrangement and one
callback. DOM order between the three foreground hosts does not matter, because their
z-indices are all distinct.

### The band box is bigger than the viewport

Every host was `inset: 0` with a surface exactly the size of the viewport, and the
owner's mid-scroll screenshot came back with a hard straight cut along the top and
left. It was never a mask or a crop. A surface is clipped to its own SVG viewport and
`contain: paint` clips to the host, and both of those clips are on the element the
parallax then **translates** — so a viewport-sized sheet slid twenty-four pixels left
brings its right-hand clip edge twenty-four pixels inside the window.

So each band's box overhangs the viewport by everything that can ever move it:

```
BAND_OVERSCAN[band] = ceil(pointer + |scroll| / 2 + veilLift) + 8
```

and the plants keep their viewport coordinates because the overhang is folded into the
viewBox **origin** rather than into the scale. The parallax tables and the overscan
derived from them are declared next to each other in `NatureLayer.tsx` on purpose: they
are the same fact written twice and they must not drift apart.

The same file holds the other half of the lesson `Vegetation.tsx` already learned. The
arrangement re-plants only on a **coarse** change of viewport — 24 px of width or 140
px of height, the 140 being a phone's address bar — while the drawing surface tracks
the live viewport exactly, every frame it needs to. An SVG whose viewBox has drifted
from its box does not sit there quietly; it rescales and re-centres, and every plant
rooted below the fold shows the cut stem it was rooted there to hide. Width, height
and viewBox are all written in CSS pixels so one user unit stays one CSS pixel, and the
drift is taken up by the origin: xMidYMax alignment at a fixed scale. The foot is
anchored rather than the middle because most specimens are rooted below the fold, and a
stub of stem hanging in mid-air is the failure everyone would see.

---

## 5. The scroll animation architecture

**React must never re-render while the page is moving.** A plant is static markup.
Everything that moves arrives through inherited CSS custom properties that a single
ticker subscription writes straight to the DOM, once a frame, and never reads back.

There is exactly one `subscribe()` for the entire nature system. Five band hosts, the
wash and the absorbed sprig layer all ride it, and there is no second rAF loop anywhere
in the tree.

### Why the properties and not props

A prop is a render. Forty-six specimens re-rendered at 60 Hz across twenty-six
viewport-heights is the entire budget of the page spent on reconciliation for values
that are pure functions of one number the driver already has. Custom properties invert
it: the controller writes `--grow` on a plant's own root and the whole subtree —
the clip wipe's `scaleX`, every vein's `stroke-dashoffset` — follows in CSS with no
JavaScript involved per path. `--wind` and `--lean` are folded into one property
because they are the same rotation about the same pivot, which halves the writes.

Two details are easy to lose. The write target is the family's own `.plant` root and
not the wrapper above it, because `canopy.module.css` *declares* `--grow`, `--wind` and
`--lean` on `.plant`, and a declaration shadows an inherited value however far above
it that value was set. And node handles are collected once, when the subscription is
built, and never queried inside a tick.

`.qa/verify/static-markup.mjs` measures the rule rather than asserting it: it hashes
the vegetation subtrees across a full ride of the journey with every per-frame custom
property stripped, and gets **one distinct markup** across six scroll positions.
`.qa/verify/rerender.mjs` measures the listener and rAF counts.

### What each frame actually does

```
if nothing moved, nothing swung, nothing is charging and nothing is owed → return
ground      one quantised opacity write, plus vignette and bloom past 0.88 / 0.93
lean        damped from velocity; it never touches growth
bands       one transform per band root, never one per plant
flora       the absorbed sprig layer's own tick, driven from here
growth      a cursored pass over the specimens, capped by the write budget
wind        at most six nodes, at 12 Hz, on its own clock
```

Standing still with nothing to breathe costs four comparisons a frame and not one DOM
write. Velocity is damped into `lean` and is never allowed near growth: a plant that
grows faster because you scrolled faster has stopped being a function of position.

A canopy breathing in a background tab is pure waste, so the subscription detaches on
`visibilitychange` and re-attaches on the way back. Nothing is lost — every value is a
function of absolute time and `frame.progress`, both read fresh — and leaving is also
the only thing that lets the shared rAF loop cancel itself on the way to `/world2`.

### Reduced motion

No subscription at all and no rAF. The progression is kept, because freezing the layer
at zero density deletes the brief's central idea for these readers and freezing it at
maximum buries the early pages, but it is quantised to the eight narrative bands and
arrives as a step, which the global 0.001 ms transition kill turns into a snap. The
store's `progress` is already throttled to changes above 0.0004 and the selector
reduces that to one integer, so React renders at most eight times across twenty-six
viewport-heights.

---

## 6. The performance strategy

| tier | write budget / frame | specimens | tendrils | parallax | blur | sway |
| --- | ---: | ---: | ---: | --- | --- | --- |
| high | 90 | full table | 12 | yes | shadow and close | 6 nodes |
| medium | 40 | sliced by importance | 5 | yes | no | no |
| low | 12 | a named cast of six | 2 | no | no | no |

Every specimen carries an `importance`. The arrangement is generated once from the
table, sorted by importance and then sliced by tier — and the tier never reaches a
seed, so an FPS downgrade mid-session drops the least important plants instead of
replanting the garden under a reader.

**Depth by blur is a top-tier luxury and it goes on the band root**, so the result is
rasterised once and composited from then on. That is only true while the root's
transform is the single thing about it that ever changes, which is why nothing inside a
blurred band is allowed to sway. SVG `<filter>` is banned outright at every tier:
`feGaussianBlur` re-rasterises its whole filter region on any change in its subtree, and
on a full-viewport surface that region is the viewport.

**`will-change: transform` is scoped to the tiers that actually parallax.** Six
promoted full-viewport layers on a device already deemed weak enough to have parallax
switched off is thirty megabytes of compositor memory bought for nothing.

**The write cap is a cap, not a truncation.** A frame that runs out of budget leaves
the growth cursor where it stopped and the next frame picks it up, so no specimen is
ever starved.

### The low-tier bug that made the whole layer invisible

That promise is only kept if there *is* a next frame. The tick had a gate at the top —
nothing moved, nothing swung, nothing charging, so return — and a reader who arrives by
a **jump** rather than by a scroll moves the progress once and then stands still. The
index overlay, a restored scroll position and every QA harness all arrive that way. So
a single frame's budget was all the growth the entire page ever got, and at the low
tier that budget is twelve writes, of which the wash and the five band roots claim most.
The result was a page that warmed up correctly with nothing growing on it: the layer
was invisible on weak devices, and in headless Chromium, which is every screenshot
anybody had taken of it.

The fix is a `settling` flag. A growth pass that walked every specimen without running
out owes the page nothing; one that stopped short is the reason the next frame happens
at all. Unfinished is now a reason to tick, on the same footing as moving.

This is also why `?nature-tier=high` exists. Headless Chromium reports SwiftShader,
`perf.ts` scores that as a weak GPU, and a QA run that forgets the parameter is a QA
run measuring a composition no visitor will ever be shown. It is read identically by
`NatureController` and by `WorldPortal`, and it is development-only in both: a
production page takes the tier the device earned.

### The low tier's cast of six

Three large, one run and two tendrils is what the budget leaves, and for every other
tier the importance sort answers which three. At six it cannot, for a structural
reason: importance ranks what may be **lost**, and six plants also have to encode an
order of **arrival**. Sorting by the first and hoping for the second gave a weak device
the specimen counts `0, 1, 2, 1, 2, 2, 4, 4` across the eight sampled positions — the
page getting *emptier* between thirty and forty-five per cent, which is the one thing
the whole progression may not do.

So the low tier is handed a named cast in arrival order, nothing in it withdraws, and
it counts `0, 1, 2, 3, 4, 5, 5, 6`. It climbs and it never falls. Two rules were
learned by measuring: no member may be a front-band specimen at the foot of the page
(`UclBottomRunner` survives on a laptop and has nowhere to stand at 390×844), and no
member may be outside the medium arrangement, because a downgrade must remove plants
and never plant one.

---

## 7. The mobile strategy

The phone is a rewrite, not a scale. At 390 px the gutters are 20 px and the empty
regions are horizontal **bands** rather than margins, so a desktop composition scaled
down puts a stem under running text.

Every specimen may therefore carry a `mobile` override — `x`, `y`, `scale`, `rotate`,
or `drop: true` — and a `minWidth` below which it is not planted at all. **Forty of the
forty-six are re-anchored on a phone**, three are dropped outright, and twenty-three
carry a `minWidth`, so a 390 px page is not a smaller version of a 1440 px page; it is a
different composition drawn from the same library. There is a second exclusion table,
`PHONE_EXCLUSIONS`, with twenty-three rectangles of its own, because the boxes that
matter at 390 px are not the boxes that matter at 1440.

The sprig layer makes the same concession below 720 px: the per-side share falls from
0.19 of the arrangement to 0.10 and the crown zone goes to zero, because the gutters
collapse to twenty pixels and a plant that size is a smudge. The side band is tied to
the viewport rather than to `--gutter` for the same reason.

One structural concession: below the full-table width the back band stops withdrawing.
A back-band plant is behind every word on the page, so keeping it for the rest of the
journey can never cover anything — and keeping it is the whole of how the specimen
count stops falling on a device that cannot carry replacements.

---

## 8. The final `/world2` unlock

The journey ends at the foot of the document, so the last gesture anyone makes is the
one that opens the world. Keep pushing past the end and a veil the colour of the place
the visitor is going climbs over everything behind it.

There is no ring, no vortex and no glow. The commit is a camera walking forward into
leaves: the frame scales toward the reader, every specimen swings away from the centre
about its own root, the opening between them widens onto `/world2`'s own ground colour,
and the route changes while the last of that movement is still on the compositor.

| | |
| --- | ---: |
| wheel pixels for a full charge, before resistance | 900 |
| touch gain | ×1.6 |
| threshold specimens, by tier | 4 / 9 / 14 |
| charge quantisation before it reaches CSS | 200 steps |
| walk through the leaves before the route swaps | 1150 ms |
| canvas released before the push | 850 ms |
| return position | 0.93 |
| disarm window on return | 500 ms |

Five things make the effort honest rather than decorative.

**The page is held back while the charge is spent.** A hundred pixels of wheel buy
visibly fewer than a hundred pixels of movement, and fewer still the closer the charge
gets to full, because the give is multiplied by the same curve the charge uses. Nothing
else the visitor can do at the foot of the page moves anything, so the resistance is
what makes the work visible instead of merely felt.

**A trackpad fling must not fire it.** This is the rule the gesture lives or dies on,
and it is not satisfied by making the threshold larger — a larger threshold is simply a
longer fling. It is satisfied by telling inertia apart from a hand. Inertia has one
signature nothing a hand does has: it only ever gets smaller. Six consecutive
non-increasing notches, once a burst is past its own peak, is scored as coasting and
worth 0.3 of its pixels. The fraction is not zero, because a visitor who flicks and
then keeps pushing should not feel the page ignore the overlap, and the moment a delta
rises again the run resets and full value returns.

**The threshold is real plants and it bends outward.** Fourteen specimens from the
same library stand around a clear centre, and they lean away as the charge rises, so
the last scroll is a thing being pushed through rather than a bar being filled. The
approach is worth only 34 % of the threshold's growth and the charge the rest —
deliberately a minority share, because the page has to look *finished* when the reader
reaches the foot. At the foot and unspent it is a few stems at the edges of the screen
and nothing over any type. The reveal is measured over 1.35 viewport-heights from the
foot rather than from a progress figure, so it survives `?quick`, a different
`--journey-vh` and a phone hiding its address bar.

**A hedge grows along the sheet's leading edge**, drawn on base to tip, because the
thing being pushed open should look alive. Positions are stratified so nothing clumps
but the order of appearance is shuffled against position: growing them left to right
would read as a wipe, and the point is a thicket closing in from everywhere at once.

**A phone ticks under the finger** at ten milestones that crowd together toward the
end, so the wrist feels the charge accelerating where the eye cannot separate one per
cent from the next. The commit is two short knocks and a long one — a pattern nothing
else in the charge uses.

The charge itself is module state, `export const portal = { pull, drag }`, on the same
pattern as `frame`. Three systems read it: the contact chapter retreats ahead of the
veil from its own frame loop, the nature controller lifts its two nearest bands out of
the veil's way and fades them from the shared ticker, and the portal's own loop draws
the threshold. Three subscribers sharing one number is far better behaved than three
loops fighting over the same inline styles.

The two nearest bands have to be lifted because the veil is at z 1 *inside* the contact
stage — inside the z 10 context — so front and close would otherwise paint on top of a
closing sheet, which is the exact opposite of the page being covered. They travel up
with it and are gone before it seals.

### Arrival

`sessionStorage['portal:arrival']` is written at commit with a 30-second life, and
`src/world2/World2Experience.tsx` spends it once. A visitor who pushed their way
through has already made the gesture that screen asks for, so they land driving instead
of pressing a button they have just pressed. It does not skip the wait, only the click:
if the level is still loading, `enter()` refuses and the progress bar stands there
saying so. The key is removed as it is read, so reloading `/world2` afterwards shows
the normal gate to someone who arrived by typing the URL.

sessionStorage rather than a query parameter or module state: a parameter would be
visible, shareable and re-fired by a reload, and module state is lost the moment the
visitor arrives by a hard navigation.

---

## 9. The preload strategy

`/world2` measures ready at 3641 ms on a warm localhost, and 13.1 MB of that — a 5.7 MB
`world.glb`, a 7.4 MB `vegetation.glb` and the manifest naming them — is network and
nothing else. The charge is where that wait goes.

| rung | what it fetches | when |
| ---: | --- | --- |
| 1 | `router.prefetch('/world2')` | any notch at the foot; pointer or focus on the index link |
| 2 | `import('@/world2/World2Experience')` | — |
| 3 | the manifest and the two GLBs, `priority: 'low'`, thrown away | charge past 0.35 |
| 4 | `import('@/world2/World2Game')`, `import('@dimforge/rapier3d-compat')` | at commit, not during the charge |

A visitor who merely brushes the foot of the page gets the route prefetch and nothing
else. A single wheel notch is worth a prefetch, not a chunk.

Rung three is the largest single win available to the page and it costs no parse, no
main-thread work and no global: the bytes land in the HTTP cache and the engine's own
loader calls hit it.

**Rung four is deliberately not part of the gesture.** `import()` downloads *and
evaluates*, and what it evaluates here is three.js and a couple of megabytes of
WebAssembly carried as base64 — main-thread work that would otherwise land in the last
two hundred pixels of the charge, while the veil is animating, the ticker is drawing
the hedge and the contact stage is being dragged. There is no comment that turns those
into an idle-priority `link rel=prefetch`, either: Turbopack honours `webpackIgnore`,
`turbopackIgnore` and `turbopackOptional`, and nothing resembling webpack's
`webpackPrefetch`. So the evaluation is spent from `commit`, once the latch has closed
and the only thing still moving is a compositor transform. The world still gains most
of a second on its own imports, and a visitor who charges to nine tenths and scrolls
back up has downloaded a route and a chunk rather than an engine.

Rapier's WebAssembly is imported but **not** initialised. The import is the download
and the parse, which is the expensive part and the part worth doing early; `init()`
compiles an instance, and the engine's own `init()` would compile a second one over the
top of it moments later.

Never, at any rung: `new World2Game(...)`, which probes the device, installs an FPS
governor, opens a `ResizeObserver` and binds input; or `game.init()`, which opens a
second live WebGL context, instantiates the physics WASM, steps a world, builds an
`AudioContext` and starts a loop.

**Who is spared the heavy half.** A device the tier check has already called slow, and
a browser asking for saved data, get rung one and nothing above it. Neither is shut out
of the world; they pay for it once, on arrival, instead of speculatively here and then
again there. The forced tier is honoured in that check too, or a headless run would
measure a ladder that never fires — a true statement about that browser and a false one
about the page.

---

## 10. Route transition cleanup

Four things have to be let go of in the right order, and the order is the whole of it.

**The WebGL context, 850 ms before the push.** R3F disposes its scene graph on unmount,
but a `WebGLRenderer` only truly hands the context back when it is told to, and
browsers cap how many may live at once — `/world2` is about to want one for thirteen
megabytes of geometry. `commit` dispatches `journey:leaving`, `ContactScene` is
listening, and the homepage is down to zero live contexts by the time the route
changes. A beat *before* rather than *with* the navigation, and late enough that the
frames it stops drawing are frames behind an opaque sheet.

**The seam.** `html, body` is white and the veil belongs to a tree that unmounts at the
swap, so one late frame flashes white between two greens. `<html>` is not re-created by
an App Router navigation, so `commit` paints `--world2-ground` on it and the colour
survives underneath `/world2`'s own fixed route. `/world2/page.tsx` exports
`viewport: { themeColor: '#dce3dc' }` for the other half of the same seam: the root
layout's global `#ffffff` would otherwise put a white bar of browser chrome across the
top of a phone at the exact instant the seam is meant to be invisible. That value moves
with `.route`'s background and with `--world2-ground` in `tokens.css`, which is the
discipline `src/world/core/palette.ts` already documents for `--paper`.

**The charge, at unmount and not at commit.** Zeroing `portal.pull` in `teardown()`
would drop a full canopy back over the walk for the frame or two before the route
swaps, because the nature bands read it from the shared ticker and they are body-level,
above everything in the chapter. The unmount that follows the push resets it, which is
the moment it stops being read.

**The ticker.** The nature subscription detaches on `visibilitychange` and on unmount;
the band handles are handed back symmetrically, `onHost(band, null)`, because
module-level state survives a route change in the same JS context and one handle left
behind is one band being written to after it has gone. When the last subscriber leaves,
the shared rAF loop cancels itself.

### Coming back

`history.scrollRestoration` is `'manual'` for the whole site — the browser dropping
someone into the middle of a pinned chapter reads as a broken page — so Back from
`/world2` would land at scroll zero with twenty-six viewport-heights of journey thrown
away. `frame.progress` is recorded at commit and spent on the way back, capped at
**0.93**: the gateway is on screen, the visitor sees where they were, and `atFoot()` is
false, so the tail of an inertial fling still in flight when the navigation happened
cannot charge a door nobody is touching. A 500 ms disarm window sits on top of that for
the fling that arrives anyway.

The restore waits for a document taller than a handful of screens before it fires, and
gives up rather than guessing if one never arrives — a progress figure resolved against
a one-screen-tall page puts everything at the bottom. The seam colour painted on
`<html>` is cleared here, because on the way back it is the colour of the homepage's
overscroll gutter, which is a wrong colour in a place nobody would think to look.

The arrival key is cleared on the way back as well. It has a thirty-second life and a
visitor who went through and came straight back still holds a live one; left in place,
a plain click on the index link inside that window would skip the world's own gate for
someone who had not spent the effort.

The return is read once and then held for two seconds, because Strict Mode mounts every
effect twice in development: the first pass would take the key out of storage and the
second would find nothing and put the visitor back at the top of the prelude, which is
the precise failure the mechanism exists to prevent. `WorldLoader` solves the same
problem the same way.

---

## 11. The debug overlay

Development only, and it is worth being precise about what that means, because the
claim is load-bearing.

`NatureDebug` is loaded through `next/dynamic` with `ssr: false`, so it is its own
chunk. It is rendered only when `debug` is true, and `debug` comes from
`useSyncExternalStore(subscribeDebug, readDebug, serverDebug)` where `readDebug()`
begins `if (process.env.NODE_ENV !== 'development') return false` and `serverDebug()`
returns a flat `false`. The keyboard toggle effect returns immediately outside
development, so nothing can set the override either. `process.env.NODE_ENV` is inlined
at build time, so in a production bundle the branch is statically false: `readDebug`
minifies to `return false`, the component is unreachable, its chunk is never requested
and none of its styles are ever parsed. See §13 for how that was checked.

It costs the running system nothing even when it is open. There is no second ticker
subscriber and no rAF: the overlay samples the controller's published `natureFrame` on
its own 12 Hz interval, because a readout that updates sixty times a second is
unreadable anyway.

**How to open it.** Either:

- add `?nature-debug` to the URL, or
- press **`n` twice within 400 ms** anywhere that is not a text field.

The state is remembered in `sessionStorage['nature:debug']` so a reload during tuning
does not lose it; press `n` twice again to close it. Hold **Shift** to draw the current
chapter's exclusion rectangles over the page.

It shows the progress and band readout, density and wash, the chapter and its local
`t`, grown-against-total and writes per frame, the tier and whether it is forced, a
dashed anchor box per specimen coloured by band, a cross at each petiole base, an
activation bar showing `[t0, t0 + ramp]` against the density axis with the live density
marked, and a strip along the foot with the eight narrative bands to scale and the
seven chapter boundaries ticked.

It answers, as pictures rather than numbers: which depth is that thing on; where is it
pivoting; why has it not grown yet, or why did it grow so early; and is a band boundary
firing early. A plant that never grows and a plant that grew too soon look completely
different on that activation bar and identical without it.

---

## 12. Decisions, including the reversed ones

**Acceptance criterion D was restated mid-project.** It demanded two contiguous bare
regions of fifteen per cent each, and that is unachievable by design rather than by
accident. Vegetation enters from the margins and leaves the centre clear — which is
exactly what the per-chapter audit asks for — so the paper the reader is left with is
topologically **one** region with arms reaching between the plants. Splitting the page
into two islands of empty paper would mean running a band of vegetation across the
middle of the type, which §2.3 forbids outright. The criterion was measuring connected
components of something the brief describes as an *area*. It now says what the brief
actually wants: total bare ground at least forty per cent, and a largest single
contiguous region of at least twenty-five, so the paper reads as a held silence rather
than as gaps between leaves. Both the composition work and an independent measurement
arrived at that answer separately.

**`scale` was a hopeful convention and became a fact.** Every spec passed `length: 100`
and trusted that a family drew itself inside a hundred units, which is true of the
blades and false of everything with a run: `VinePrimary` takes `length` as the size of
one *leaf* and lays it along a 320-unit stem, so a nominal `scale: 0.87` read 2359 px on
a 1440 px page. `FAMILY_SPAN` — the measured extent of each family in its own units,
divided back out — makes `scale` mean on the page exactly what the table says.

**The exclusion table was documentation and became code.** It used to say in as many
words that nothing read it at runtime: that it was a picture for the debug overlay,
because a plant overlapping one of these rectangles is the commonest way this work goes
wrong. It was a picture, the work went wrong, and a KCL module row went out under a
leaf. `arrangeNature` now tests every mid, front and close footprint against it and
moves or drops what lands on one. The solver is deliberately dull — eight directions,
sixteen distances, smallest first, first clear answer wins — because a cleverer one
would produce a different composition every time a rectangle moved by a pixel, and the
whole value of the table is that the same page comes back tomorrow. Past fourteen per
cent of the viewport the specimen is no longer the one that was composed, so it is
dropped instead, loudly in development.

**The guard window is the effective exit, not the authored one.** The low tier keeps
all six of its plants to the end and the phone keeps its back band, and a specimen that
has stopped withdrawing is over the next chapter's type for longer — so the set of
chapters it is guarded against has to widen with it, or the suppression buys a
collision.

**`vector-effect: non-scaling-stroke` was removed from `.ink` and `.stem`.** It had
been checked once by looking at on-screen stroke weight, found not to apply, and left
in place. Stroke weight was the wrong thing to look at: it unscales the dash pattern
and destroys `pathLength="1"`, which is the single property the whole reveal is built
on.

**`transform-box` was set to `fill-box` with a comment claiming the petiole as the
pivot.** `fill-box` measures `transform-origin: 0 0` from the corner of the group's own
bounding box, which on a leaf that reaches back behind its petiole and hangs below it is
nowhere near the stem. Rendered side by side, `fill-box` put the pivot three units up
and three across and `view-box` put it exactly on the attachment. It is back at its
initial value.

**The sprig layer was absorbed rather than replaced.** Same markup, same arrangement,
the same place in the stack at z 4, and the same growth — but driven from the nature
system's single callback instead of one of its own, because two full-viewport fixed
SVGs both ticking is a straight doubling of the layer's cost for no gain. On
`/projects` nothing changed: that route mounts it exactly as it always has, with its own
subscription, and the scripted openers the home controller asks for are gated on a
`scripted` prop and built from their own seeds after the procedural pass so they cannot
disturb its RNG stream.

**`scripts/visual-qa.mjs` used to own `.qa/` and empty it.** It began `rm -rf .qa`, so a
single run deleted every other harness's evidence along with its own — including the
proof sheets and live captures this redesign was being judged against. It now owns
`.qa/visual-qa` and wipes only that, overridable through `VISUAL_QA_OUT`.

**The audit's eight open questions** were all answered; the resolutions are recorded in
place in `HOME_NATURE_REDESIGN_AUDIT.md` §12 rather than deleted, because the reasoning
is the value. In short: `/world` is retired from the interface but still answers at its
own URL; `/world2` gained two micro-edits and no more; the Toolbox hover lift was
reduced to a watermark rather than deleted; `/projects` keeps today's sprig layer and
gains no bands; there is no bitmap of the island; the prelude's corner label stays and
the clue is composed behind it; Back restores to 0.93.

---

## 13. Verification

Two things in this document were checked by hand rather than taken from a report.

**No `console.log` survives in the nature, vegetation or portal code paths.** A grep
across `src/components/home/nature/`, `src/components/vegetation/` and
`WorldPortal.tsx` returns exactly one `console` call: a `console.warn` in
`placements.ts` reporting a specimen that could not be placed clear of its chapter's
type, wrapped in `if (process.env.NODE_ENV === 'development')`. It is the "dropped
loudly" half of the nudge-or-drop rule and it stays.

**The debug overlay cannot ship.** There are four ways in and all four are closed
outside development. `readDebug()` opens with
`if (process.env.NODE_ENV !== 'development') return false`, *before* it consults the
override, so neither the URL parameter nor `sessionStorage` nor a set override can
reach it. `serverDebug()` is a flat `false`, so the first HTML never has one and
hydration never disagrees. The `n`-twice keydown effect returns immediately outside
development, so nothing can set the override in the first place. And `NatureDebug`
itself is a `next/dynamic` import with `ssr: false`, so it is a separate chunk that is
only fetched if it is rendered. With `process.env.NODE_ENV` inlined at build time
`readDebug` minifies to `return false`, `debug` is a constant false, and the import is
never called.

That is the static argument, and the sign-off build bears it out with one correction
worth making, because an earlier draft of this paragraph said the opposite. A real
`next build` DOES emit the overlay: its two unique strings (`natureProgress ` and
`writes/frame`) are in a 3.8 KB chunk of its own, reached only through the lazy loader
`next/dynamic` compiles the import into. That is what `ssr: false` plus a dynamic
import is supposed to produce, and it does not weaken the claim — the loader is called
only when `debug` is true, and `debug` is a constant false in that bundle, so the chunk
sits on the server and is never requested. The earlier draft was grepping a `.next`
that pre-dated the layer entirely, which was evidence of nothing.

The acceptance harness is `.qa/nature-proof/compose-check.mjs`, which returns a verdict
rather than a description: page lightness against the ground colour as the wash
actually holds it, the distribution of specimen extents, every text-run collision
reported *with the text it covers*, and the largest contiguous patches of bare ground.
`.qa/nature-proof/README.md` says what the rest of them do and how to run them,
including the `?nature-tier=high` gotcha, which is the difference between measuring the
page and measuring SwiftShader.
