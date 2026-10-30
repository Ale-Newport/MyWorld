# HOME_NATURE_REDESIGN_AUDIT

The homepage is going to be reclaimed by a plant, and almost none of it has to move.

This is the audit that decides what changes. Nine agents measured the seven home
chapters and the systems under them against the running dev server at
`http://localhost:3000`, at 1440×900 and 390×844, on 2026-09-20. Nothing under
`src/` was touched. Every number below came out of a live measurement or out of
the source; where a number is asserted without one, it says so.

The companion document is [`HOME_NATURE_SYSTEM.md`](./HOME_NATURE_SYSTEM.md) — the
design system the implementation phase builds from. This one is the survey: what
is there, what stays, what each chapter gets, and what is still undecided.

Two audits were too large to return and were written to disk. They are the
primary sources for §10 and §11 and should be read before implementation:

- `HOME_NATURE_SYSTEMS_BRIEF.md` — scroll authority, mount points, layering,
  colour, performance, accessibility, and the eleven conflicts.
- `HOME_NATURE_WORLD2_HANDOFF.md` — the seam, the entry gate, preload,
  teardown, back navigation and foreshadowing.

**Both live inside `.qa/`, and `scripts/visual-qa.mjs` begins with `rm -rf .qa`.**
Move them or redirect that script's output before the first QA sweep.

---

## 0. The scroll map, measured

The home journey is 26 viewport-heights over seven chapters. Measured live at a
900 px viewport: `document.scrollHeight = 23400`, `innerHeight = 900`, so
`22500 px` of travel — 25 viewport-heights of scrolling across 26 of document.

| chapter | `vh` | height px | top px | start, `frame.progress` | end |
| --- | ---: | ---: | ---: | ---: | ---: |
| prelude | 3.2 | 2880 | 0 | 0.000 | 0.128 |
| about | 3.4 | 3060 | 2880 | 0.128 | 0.264 |
| toolbox | 3.4 | 3060 | 5940 | 0.264 | 0.400 |
| universe | 3.6 | 3240 | 9000 | 0.400 | 0.544 |
| kcl | 4.6 | 4140 | 12240 | 0.544 | 0.728 |
| ucl | 4.2 | 3780 | 16380 | 0.728 | 0.896 |
| contact | 3.6 | 3240 | 20160 | 0.896 | 1.000 |

The brief's eight nature bands land on those boundaries to within a point and a
half, so **chapter pacing does not change**. Nothing in this work alters a `vh`.

One trap, documented in full in `HOME_NATURE_SYSTEMS_BRIEF.md` §1.6 and repeated here because
it is the easiest way to get this wrong: `frame.progress` is **pixel-space**
(`lenis.scroll / (scrollHeight − innerHeight)`, denominator 25 vh) while the
store's `chapterRanges()` is **vh-space** (denominator 26 vh). They disagree by
up to **3.45 percentage points at the contact boundary — 0.86 of a viewport
height.** Band density keys off `frame.progress`. Chapter-bound compositions key
off `useChapterFrame`. Mixing them puts the palms on screen almost a screen
before the chapter they belong to.

---

## 1. The table

| CURRENT SECTION | CONTENT | CURRENT VISUAL | KEEP / MODIFY / REBUILD | NATURE INTENSITY | ANIMATION IDEA |
| --- | --- | --- | --- | --- | --- |
| **01 Prelude**<br>0.0 – 12.8 % | Name in two lines at `--fs-mega`; six cycling roles; the thesis `I BUILD INTELLIGENT SYSTEMS.`; four mono corner labels, two of them derived (`7 CHAPTERS / ~4 MINUTES`). No body copy, no image, no list. | Warm off-white, ink `#0c0c0d`. Occupied: name y 201–526, roles y 548, thesis y 617, corners at the 58 px gutter. `FieldScene` grid resolves behind it from `p ≈ 0.015`. The flora layer plants **nothing** here — earliest `t0` is 0.1245 at high tier. | **KEEP** | **TRACE** | No new subscription. A scripted-placement hatch in `Vegetation.tsx` puts two seedlings on the existing dash-reveal at global `t0` 0.015 and 0.075, plus one blurred leaf *shadow* that fades in once on mount and only creeps 10 px and 6 % of scale across the whole chapter. |
| **02 About**<br>12.8 – 26.4 % | Corner tag `02 / A LITTLE ABOUT ME`; one masked `h2` of `profile.summary` at 22ch on cols 2–8; four marker rows (SPAIN→LONDON …) on cols 2–5 capped at 400 px; corner-BR `THE PATH BELOW / IS THE TIMELINE`. | Two-column editorial, roughly 60 % untouched white. Cols 9–12 (x 956–1382) empty at every scroll position. The field shader's spine reads as a vertical line at x ≈ 720 and its horizon at y ≈ 595–663. | **KEEP** | **LOW** | Extend the existing `useChapterFrame('about')` callback — it already writes nine values a frame — with four group dash-offsets and one leaf unfurl, so plants and type share one clock. |
| **03 Toolbox**<br>26.4 – 40.0 % | Left column: tag row, masked `h2` `Tech toolbox`, one note, the `.evidence` readout. Right: 63 `TechTile` buttons in seven family sections with a label rail and a hairline rule each. | Warm off-white, no cards, accent only on the number and the count. `ToolboxScene`'s evidence lattice watermarks through the tile gaps. The five short families carve a descending white staircase x 831–1382 / y 565–796. | **KEEP** the layout; **MODIFY** `ToolboxScene`'s hover lift (see §11 and OQ-3) | **MEDIUM** (mobile: LOW) | Give the chapter the `useChapterFrame` it does not have. It is currently **pixel-identical for 3060 px of scroll**. Three writes: a vine dash-offset, a blade unfurl, and a ±14 px foreground parallax. |
| **04 Universe**<br>40.0 – 54.4 % | Head top-left with `42 OF 42 PROJECTS`; nine filter chips top-right on a fixed 420 px rail; one centred hover label; footer hint and the `.cross` link; a full-stage list alternative. | Full-bleed and centre-weighted — the opposite of every other chapter. `UniverseScene` fills x 200–1180 / y 60–800. Real voids: left x 0–290, right x 1180–1440, bottom y 800–900. | **KEEP** | **MEDIUM**, held at the low end | One chapter-scoped `useChapterFrame('universe')` writing at most eight values. Everything reactive — the chip tendril, the count curl — rides `data-filter` / `--archive-shown` attributes the component already has state for, as CSS transitions, not on the ticker. |
| **05 KCL**<br>54.4 – 72.8 % | Left: tag row, `King's College / London`, the degree, `FIRST CLASS HONOURS`, the dates. Right: five module rows, each a 44 px glyph plus name plus blurb on a `border-bottom`. | Two-column split, content y 267–633 of 900. Voids: a 170 px right strip, a 186 px top band, a 207 px bottom band, and a 732×327 bottom-left block. Five hairline rules at y 330 / 406 / 482 / 557 / 633. | **KEEP** content and layout; **MODIFY** `.module` to gain `position: relative` and an `aria-hidden` span | **HIGH** | The five rules *become* the vine. One extra custom property inside the callback that already loops the rows, crossfading `border-bottom-color` out under a drawn stem. It fills the measured dead hold at t 0.62–0.78 where nothing currently moves. |
| **06 UCL**<br>72.8 – 89.6 % | Head top-left over three masked lines; five module labels hand-placed as a constellation, not a grid; the closing statement bottom-left; two credentials bottom-right. | The most negative space on the route, and deliberately so — a five-year axis was removed to make it. Genuinely empty: the whole top-right quadrant, the right band, the left band, and bottom-centre. | **KEEP** | **HIGH** (mobile: MEDIUM-HIGH) | One new `useChapterFrame('ucl')` in a chapter-scoped layer, with windows deliberately offset from the chapter's own 0.09 module beat. **The plants do not join the 0.70→0.82 mass fade-out** — the type dissolves out from under them. |
| **07 Contact**<br>89.6 – 100 % | `WHAT'S NEXT? / LET'S BUILD IT.`; four link cells; the colophon; `<WorldPortal/>`. | One enormous centred line, a hairline link table at the foot, and four large voids — the biggest being the full-width band y 130–390. `ContactScene`'s dot core sits at x 430–1010 / y 240–620. | **KEEP** the page; **REBUILD** `hedge()` inside `WorldPortal.tsx`; **MODIFY** the portal's route target | **VERY HIGH** | One more property, `--canopy`, on the existing callback; every leaf derives its own growth in CSS with the `--end`/`--k`/`--grow` idiom `WorldPortal.module.css` already uses. The canopy is settled and dimming before the hedge starts. |

---

## 2. Prelude — 0.0 – 12.8 %

### The measured stage

At 1440×900 the only occupied regions are the name box (x 173–1268, y 201–526),
one line of roles at y 548, the thesis (x 476–964, y 617) and four mono labels at
the 58 px gutter, at y 81 and y 787–819. The real negative space is the full-width
band y ≈ 650–780 and the lower-right quadrant generally. At 390×844 the name sits
y 211–309, the thesis y 363–405, and the entire band y 420–735 is empty.

`FieldScene` draws an 80×70 plane at `y = -4.1` — a perspective ground grid whose
horizon lands at y ≈ 545 desktop — plus about 620 dust motes at `#8a8a8e`, opacity
0.18. It is gated by `preludeFade = clamp((frame.progress − 0.004) * 90)`, so the
very first painted frame is bare paper and the grid only resolves by `p ≈ 0.015`.

### Composition

Everything sits in the **lower-right quadrant**. The entire left half stays bare
paper, and that asymmetry is the composition. It also sets up the handover,
because the procedural arrangement starts filling the bottom edge left-of-centre
as About begins, so the eye reads a spread rather than a mirror.

- **The shadow** — the one opening clue, present in the first painted frame. A
  blurred silhouette of a young monstera blade entering from the right edge,
  centred near (1180, 690), extent about 420×260, blade pointing down-left,
  `--ink` at 3.5 % alpha, no stroke. A shadow has no veins, which is also why it
  cannot read as an icon. It passes behind the BR corner label and the HUD rail
  and dies before x 964, where the thesis ends. Phone: tip at (330, 600), extent
  ~250×180, never above y 460.
- **Seedling A** — a `sprout`, rooted at (1088, 712), height ~26 px, in
  `--flora-ink-far`. It stands on the field grid's ground plane, well behind the
  horizon, so it reads as the first thing growing out of the machine's floor.
- **Seedling B** — a `seedhead` at (1006, 766), height ~17 px, nearer and further
  down-left. Two plants in one cluster, not a row. Dropped below 720 px wide.

This is the one place in the journey where the late library appears as **light
rather than as drawing**, so the opening foreshadows the ending without spending
a leaf on it. Nothing from the late library may be drawn here.

### Occlusion

**May be overlapped, at the shadow's 3.5 % ink only**: the BR corner label, the
HUD progress rail and its readout, and the field grid lines — the seedlings
deliberately draw over the grid, which is what makes them stand on it.

**Must stay untouched at any opacity**: both lines of the name; the rotating
roles; the thesis — a soft grey smudge under 500-weight uppercase at 2.2rem reads
as a print defect, not as atmosphere; the TL and TR labels; and above all the BL
`SCROLL TO BEGIN` hint, which is the call to action for the entire journey and
must have nothing behind it. **No vegetation in the top half of this chapter.**

### Risks

- **Calibrate against the grid, not the type.** The grid draws at roughly 2–4 %
  ink. A sprig at the layer's default `--flora-ink` (30 % of `--signal`) would be
  conspicuously the darkest thing in the lower half. Target `--flora-ink-far`
  (16 %) and keep the shadow under 8 % ink.
- **There is no free corner.** All four hold mono labels, so the brief's literal
  "small plant detail low in a corner" cannot be honoured as written. The clue is
  composed in the margin beneath and behind the BR label instead. See OQ-5.
- **`FIRST_AT` must not simply be lowered to reach this chapter.** That would
  fill all four margins at once and destroy the opening.
- **The scripted entries must be gated by journey.** The flora layer is fixed and
  shared with `/projects`; entries keyed on global 0.015 would otherwise fire over
  Pansofia.
- **This is the LCP frame.** An SVG `feGaussianBlur` over a 420×260 region can
  cost a raster of the whole lower-right quadrant before the name composites. Use
  a gradient-filled path or a CSS `filter: blur()` on an isolated layer, and mount
  the shadow behind the same `requestIdleCallback` gate the canvas already uses.
- **Three faint systems in one quadrant.** The lower-right is also where the dust
  motes drift and where the grid's vanishing lines converge. Shift the seedling
  cluster left of the convergence point rather than touching `FieldScene`, which
  is shared with seven other chapters.
- **Reduced motion must pick one mark, not two.** Choose the shadow: it is the
  clue that does not depend on growth to mean anything.

---

## 3. About — 12.8 – 26.4 %

### The measured stage

`h2` at x 170–895 / y 269–477; four marker rows at x 170–570 / y 531–631 on a
28 px pitch, their bars in `--accent` vermilion — the only saturated ink in the
chapter; corner-BR label at x 1265–1382 / y 787–819. Columns 9–12 are empty from
the HUD down to the BR corner at every scroll position measured.

**The critical timing fact, measured not assumed**: the sticky stage releases at
global 22.4 %, which is local `t = 0.706` — exactly when the last marker finishes.
For the final 30 % of the chapter the whole stage rides upward out of the
viewport, and by global ~23.5 % the Toolbox tile grid has entered from below at
x 492–1382 / y 760–890.

### Composition — four plants, asymmetric by construction

All four render into the **body-level** bands, never into `shared.stage`.

- **Plant A, the vine.** A `tendril` rooted below the fold at x ≈ 600, climbing
  and leaning right to finish around (780, 470). x 600 is chosen precisely: 30 px
  right of the markers' right edge and 120 px left of the shader's spine, so it
  runs in the only vertical corridor in the lower half empty of both type and
  shader geometry. It crosses the horizon at an angle — a 2D hairline cutting the
  3D grid diagonally is the contrast the brief wants, where a vertical vine near
  x 720 would read as a second spine. Three nodes, three *alternate* leaflets
  (paired leaflets on a climber read as a fern), one unfurled crozier tip.
- **Plant B, the fern.** One frond rooted off-page at the right edge (x = w+4,
  y ≈ 300), growing leftward-and-down at about −78°, ~110 px, in
  `--flora-ink-far`. This is the plant a reader notices on their second visit.
- **Plant C, the monstera fragment.** Anchored at (w+60, h+40), rotated ≈ −34°,
  drawn at ~420 px across with only its lower-left third inside the viewport. It
  passes **behind** the corner-BR label `THE PATH BELOW / IS THE TIMELINE`. That
  overlap states the chapter in one image: the line announcing the timeline is the
  first piece of type on the site with something growing behind it. **Hard left
  bound x ≥ 1150**, so it never encroaches on where the Toolbox tiles land.
- **Plant D, the one near-layer touch.** A small tendril entering top-left at
  (40, −10), ~160 px, stopping at y ≈ 240 — in the dead band between the corner
  tag (ends y 91) and the `h2` (starts y 269), so at 1440×900 it overlaps no type
  at all. Its only job is to establish that a foreground layer exists this early,
  so that when a leaf crosses a heading at 40 % it is a progression and not a new
  rule. This is the mildest possible test of the front band, which is why it
  belongs here.

**Mobile (390×844).** There are no gutters — 20 px. The empty regions are
horizontal bands, not margins. Drop B and D. Keep A, re-rooted at x ≈ 300 and
climbing only to y ≈ 580 so it stops below the markers. Keep C at one lobe plus
midrib, anchored (w+30, h+20), reaching x ≈ 250 / y ≈ 700. Two plants. That is
the honest limit of this layout and, for this band, the correct answer.

### Occlusion

**Must stay fully legible**: the `h2` — it is the thesis of the whole page, set at
weight 500; all four marker rows including the 1 px vermilion bars, which are
hairlines and would be destroyed by any teal line crossing them; the HUD.

**Should be overlapped, from behind**: the corner-BR label, by Plant C. Behind,
not in front — the label is `--text-faint` mono at 9–10 px, and a hairline leaf
outline crossing it from the back is texture, while the same line in front is
illegible. The last line of the `h2` is likewise crossed from behind by Plant A's
upper stem.

### Risks

- **The stage releases at t = 0.706 and rides up.** This is invisible from the
  source and is the biggest trap in the chapter. Anything parented into the stage
  slides off the top while still half-drawn.
- **The Toolbox tiles arrive at global ~23.5 %, local t ≈ 0.79, while Plant C is
  still drawing.** Violate the x ≥ 1150 bound and the first thing a reader sees in
  Toolbox is a leaf behind the language tiles — Toolbox's decoration rather than
  About's residue.
- **The global budget gives this chapter almost nothing, and nothing at all below
  high tier.** Against the real constants, the first sprig germinates at global
  12.4 % on high, 16.5 % on medium and **24.4 % on low** — a low-tier device sees
  an entirely bare chapter. Plants A–D must be a guaranteed floor at every tier.
- **Colour collision.** Flora draws in `--signal`; the marker bars draw in
  `--accent`, and `tokens.css` states outright that vegetation never uses the
  accent. At a 28 px row pitch a teal hairline parallel to a vermilion one reads
  as a chart legend. Plant A must not enter x < 600 between y 520 and y 640.
- **Over-planting is the failure mode here, not under-planting.** The chapter's
  value to the progression is that it is still 60 % white. Four is the ceiling. If
  the implementation finds itself adding a fifth to balance the left gutter, that
  is the mirror-symmetry instinct the brief forbids; leave the gutter empty.

---

## 4. Toolbox — 26.4 – 40.0 %

### The measured stage

Head x 58–372 / y 104–271; board x 395–1382 / y 104–796, thirteen tile columns of
64 px plates at 1440; evidence readout x 58–372 / y ≈ 718–795; family row tops at
104 / 254 / 404 / 485 / 565 / 645 / 725. The ragged right ends are the whole
composition: AI/ML stops at x 1175, Data at 1038, Cloud & Infra at 831, Tooling at
900, Design & Web at 831, against a board that runs to 1382.

**The single most important finding: `Toolbox.tsx` does not import
`useChapterFrame`.** Screenshots at t 0.08, 0.25, 0.50, 0.75 and 0.94 are
pixel-identical in the DOM layer. For 3060 px of scroll — 13.6 % of the page —
nothing moves except the lattice's idle rotation and one sprig. Everything the
chapter animates is event-driven.

### Composition — three depths, all fitted to measured voids

- **Background.** One pothos runner enters at the left page edge around
  (0, 520) and travels only as far as x ≈ 130 — short of the note's measure and
  above the evidence readout. Two small leaves, `--flora-ink-far`. That is the
  left side's entire allocation: a thread. The existing bottom-left grass stays.
- **Midground, the grid vines.** A new layer inside `.board` at `z-index: 0` with
  the seven `.group` sections raised to `1`, so vines pass **behind** every plate.
  One continuous runner enters at the board's bottom-right inside corner and
  climbs up-left through the board's own gutters, using the real white lines: up
  the gap right of the last Design & Web tile, left along the row gap above its
  rule at y ≈ 720, up through the Tooling ragged end at x ≈ 900, left under the
  Cloud & Infra rule, stopping at about (1150, 420). It never reaches Frameworks
  or Languages, so the dense top two-thirds of the wall stays clean. Eight to
  twelve leaves, every one in a row gap or a ragged end, never over a mark.
- **Foreground, the mass.** The monstera/philodendron cluster roots outside the
  board at about (1400, 900) and climbs into the staircase void. One large
  fenestrated blade at x 850–1150 / y 600–790; one philodendron heart-leaf in the
  Data void at x 1060–1250 / y 490–560; a bare petiole terminating at (1200, 420).
  The cluster's left boundary is x ≈ 830 at every row — with exactly one
  deliberate exception: the monstera's lower-left lobe laps 10–14 px over the
  bottom-right corner of the **WordPress** tile (x 767–831 / y 733–796). That
  single overlap is the chapter's whole "nature over interface" moment, and it is
  placed on the least load-bearing mark on the wall.

### Occlusion

**Must stay fully legible**: all 63 plates and their marks — the wall exists to be
read, and a mark nobody can identify stops being evidence; the seven family labels
in the rail, already `--text-faint` at `--fs-nano`; the seven hairline rules, which
are what make seven lists read as one wall; the `h2` and note; the evidence
readout and every project button in it; the HUD.

**May be passed behind, freely**: every tile plate, by the midground vines. The
plates are opaque `--bg-secondary`, so a vine disappearing under one and
reappearing in the next gutter is exactly the depth read we want.

**Structurally occluded already, plan around it**: on mobile `.evidence` is
`grid-row: 1`, `align-self: stretch`, opaque, `z-index: 1` — tapping any tile
covers the entire head region. Nothing goes there.

**Interaction hazard**: `chapters.module.css .stage` is `pointer-events: none`
with `> * { pointer-events: auto }`. A plant layer added as a direct child of the
stage inherits `auto` and would silently eat clicks across the whole board. Every
new layer must re-declare `pointer-events: none` explicitly.

### Risks

- **The grid is too tight for a vine to literally thread it.** `.tiles` column gap
  is `0.3rem` — 4.8 px at 1440, 3.2 px at 390, against 64 px and 38 px plates.
  There is no room for a stem plus a leaf in 5 px. **Do not widen the gap**: the
  tile clamps were tuned to the largest plate that keeps the foot of the wall above
  the HUD scrubber at 375×667 and 360×640, and adding gap costs a column at some
  widths. Route through row gaps (~9 px) and ragged ends only.
- **Two systems are already drawing connections.** See §11 and OQ-3.
- **The wall dims to 0.26 on hover.** Anything the vines draw on hover is drawn
  over a near-white page. Stems and outlines at `--flora-ink`, only the active
  tendril midrib reaching `--accent`, never more than four tendrils at once.
- **Vine routing cannot be hard-coded.** `.tiles` is
  `repeat(auto-fill, minmax(var(--tech-tile), 1fr))` — thirteen columns at 1440,
  nineteen at 1920, twelve at 1280, seven at 390, and family row heights change
  with it. Every path must be built from measured rects and rebuilt on a debounced
  `ResizeObserver`. This is the bulk of the implementation cost.
- **At ≥ 1800×940 the tile captions come back** (`.name { display: block }`),
  adding a row of type under all 63 tiles and growing every family row by ~20 px.
  The staircase void shrinks. Re-measure at 1920×1080 specifically.
- **Below 900 px wide or 700 px tall the families dissolve entirely**
  (`.group, .tiles { display: contents }`): 63 tiles become one flat wall with no
  labels and no rules. Every routing assumption is false there. Detect it and
  render nothing but the single margin plant.
- **Growth must complete by about t = 0.62 and then hold.** A vine still visibly
  drawing at t = 0.95 reads as the chapter animating on exit — precisely the
  "announcing itself" failure the brief warns against.

---

## 5. Universe — 40.0 – 54.4 %

### The measured stage

`.head` at (58, 90) 250×150 with the count at y 224; `.filters` at (962, 90)
420×61 — the rail is exactly 420 px at every desktop width measured; `.footer`
spanning x 58–1383 at y 768; `.label` anchored at (720, 498). The constellation
occupies x 200–1180 / y 60–800. Real voids: a tall left column x 0–290 /
y 260–760 — the single biggest piece of negative space in the chapter — a right
column x 1180–1440 / y 170–760, and a bottom band.

`Universe.tsx` also does not import `useChapterFrame`; every measured box is
byte-identical at t 0.00, 0.08, 0.50, 0.92 and 1.00. All scroll behaviour lives in
the scene's `useFrame`.

### Composition

Depth is already free here: `--z-canvas: 1 < --z-flora: 4 < --z-content: 10`, so
vegetation at flora depth sits **in front of** the 42 nodes and **behind** every
piece of type. Plants over the archive, archive under the plants, type on top of
both. Express everything as viewport fractions so it survives 1280 → 1920.

- **Left, the mass.** A hairline stem roots off-canvas at (−0.02w, 1.02h) and
  climbs a slow S to (0.14w, 0.42h), with a second shorter stem dying back at
  0.68h so it is not one lonely line. Monstera leaf A: blade x 0.00–0.17w /
  y 0.58–0.82h, tilted ≈ −22°. Monstera leaf B, the largest thing on the page:
  blade x 0.02–0.22w / y 0.34–0.62h, tilted +14°, one fenestration. A fern cluster
  of three fronds roots at y 1.01h across x 0.03–0.09w.
- **Right, the counterweight, deliberately not a mirror.** A heartleaf vine
  emerges from behind the filter rail's right end at (0.99w, 0.17h), descends in a
  lazy sine to (0.93w, 0.62h) and trails off-canvas at (1.01w, 0.70h), four leaves
  alternating inward. **It must stay right of x 0.92w** — the rightmost
  constellation node measured at x 1069, i.e. 0.74w, so the vine never crosses a
  clickable target. One seedhead on a bare stalk at (0.96w, 0.78h). Left is broad,
  ascending, foreground; right is thin, descending, sparse.
- **The filter rail.** One hairline tendril, 0.035h long, hooks over the top-left
  corner of whichever chip is active, driven by a custom property written from the
  `filter` state the component already holds. Nature reacting to the work at zero
  per-frame cost, and it makes the vine's entry point read as having crawled out
  from behind the rail.
- **The count line.** A tendril runs beneath `42 OF 42 PROJECTS` and curls once
  past the final S. Its drawn length is `visible.length / projects.length`, so a
  narrowing filter retracts the curl toward the first digit.
- **The cross-link.** A thin stem lies 2 px below `.cross`'s existing
  `border-bottom` — beside it, not thickening it — runs its length and curls past
  the arrow. `.listToggle` stays completely clean: it is a bordered box and a
  plant on it would read as a sticker.
- **The centre — nothing, ever.** Hard exclusion: the ellipse x 0.30–0.70w /
  y 0.38–0.72h. That holds both the hover label and the hero-tier nodes, which sit
  at radius 3.0, dead centre by construction.

**Do not try to make plants track the 42 moving nodes.** They rotate at
`frame.time * 0.028` and re-project every frame; a plant that chases a node reads
as a toy. The per-item differentiation the brief asks for is delivered where DOM
and archive actually meet: one species per annotation role. Seven botanical
events, seven jobs, no repeated frame.

**Mobile** is two events and nothing more: the count tendril, and one monstera
blade from the bottom-left below the footer. It will be crossed by the HUD rule,
which draws over it at z 60 — fine, and a small early note of the merge.

### Occlusion

**May be overlapped, by construction rather than by luck**: the peripheral
archive-tier nodes and the thin shared-technology graph in the left and right
columns. The scene puts hero nodes at radius 3.0 and archive nodes at 9.0+, so the
marks the left mass covers are the smallest, least important dots in the archive.

**Must stay fully legible**: the head block including the count digits — the
tendril goes under the baseline, never across them; all nine chips, whose mono type
is 9–10 px, so only a hairline may come near and it hooks a corner rather than
crossing a label; the centre label with its up-to-40ch description; the hint; the
whole `.actions` row.

### Risks

- **Pointer events will kill the constellation if missed.** A flora `<svg>` added
  as a stage child becomes `pointer-events: auto` from the `> *` rule and, being
  full-bleed, swallows hover, click-to-open and drag-to-rotate on all 42 nodes.
  This is the single easiest way to break this chapter.
- **This is the heaviest scene on the home journey** — 42 instanced icosahedra,
  42 halo billboards and a line graph, all rewriting instance buffers every frame.
  Gate dash-offset writes on `|Δt| > 0.002`, never animate a gradient stop, and give
  the low tier the annotation tendrils and nothing broad-leaved.
- **MEDIUM reads heavier here than anywhere else.** Every other chapter has a
  white text column for vegetation to sit beside; this one is a full-bleed field
  with content in the corners, so a plant is always over something moving. If the
  first pass looks like a botanical poster, delete the seedhead and one heartleaf
  leaf — do not shrink everything.
- **Head clearance is width-dependent.** Leaf B's top edge at 0.34h clears the
  head by about 63 px at 1440×900, but `.head` is 250 px wide at 1280–1440 and
  322 px at 1920. Derive the clearance from the measured box at layout time.
- **Two vegetation layers can collide at the bottom-left.** The fixed layer already
  plants a sprig cluster around x 150–220 / y 790–900 at this depth. Reserve
  x < 0.09w at the foot for the chapter layer and leave the fixed arrangement alone,
  or the two grow through each other and read as one confused shrub.
- **The count tendril could tip into data-viz.** A stem whose length encodes a
  ratio is one step from a progress bar with a leaf on it. Hairline weight, no tick
  marks, no endpoint dot, no easing that draws attention to the change.
- **The filter chips are unfilled bordered boxes.** A vine behind one shows
  straight through and reads as passing *through* the control. Route along the
  outer edge of the rail; let only the corner-hooking tendril touch a chip.

---

## 6. KCL — 54.4 – 72.8 %

### The measured stage

Left column x 58–596: tag row at y 267, `King's College / London` at y 293–416,
the degree paragraph capped at 30ch, `FIRST CLASS HONOURS` at x 58–336 / y 478–494,
the dates at y 498–513. Right column x 732–1270: five module rows, 63 px tall on a
76 px pitch, rules at y 330 / 406 / 482 / 557 / 633, glyphs at x 732–776, the
longest blurb run ending near x 1040.

**The dead hold.** The last module finishes at t 0.62 and the sticky stage does not
un-pin until t ≈ 0.783 (4140 px section, 3240 px of sticky travel). That is a
~16 %-of-chapter hold — about 660 px of scroll — where absolutely nothing moves.
Filling it with growth is the single biggest win available in this chapter.

### Composition — five placements, right-heavy by about three to one

1. **The module rules become the vine.** Each `border-bottom` is crossfaded into a
   drawn pothos stem occupying the same 1 px band. The vine enters each row from
   its **right** end and grows leftward toward the glyph, so growth travels against
   the reading direction and the line is already familiar before it moves.
   Straightness decays with depth: row 1 deviates by at most 1 px and grows no
   leaves; row 5 deviates up to 4 px, carries a node every ~90 px and buds four
   leaves. **Leaves bud only in x 1100–1270** — measured, because that is the strip
   where neither the row's own blurb nor the row below's name has any glyphs. Row 5
   has 207 px of clear page under it and is allowed a trailing runner dropping
   60–80 px with three leaves and a terminal curl.
2. **The right-margin trunk.** The 170 px strip x 1270–1440 is the chapter's
   largest untouched rectangle and butts directly against the list's right
   terminus. One pothos trunk rooted below the fold at about x 1345 climbs the full
   height, reaching y ≈ 120 by the end. The five row-vines then read as branches off
   it. This is the structural claim of the chapter: the list is no longer a list, it
   is growing off something.
3. **The top-right crown.** One banana leaf at far-tier ink entering near
   (1440, 40), tip reaching y ≈ 230 — stopping 37 px clear of the tag row; and one
   monstera entering at (1330, 0), lowest lobe at y ≈ 200. The monstera is the one
   element permitted in the front band here, and at this chapter it occludes
   **nothing** — which is exactly right. The front band is established here so that
   UCL can start actually covering things without inventing a new depth plane.
4. **The left gutter climber.** One ivy rooted off the bottom-left corner at
   about x 36, topping out at y 520 — seven pixels below the date line and well
   clear of the accent credential. Two or three leaves cross x 58 and pass behind
   the dates. That is the entire left-hand intervention. Ivy rather than a second
   pothos, so the two sides of the page are not the same plant.
5. **The bottom band.** The 207 px band y 633–840 gets the existing small families
   at raised density, weighted toward x 700–1200 to meet the row-5 runner, thinning
   to almost nothing under the title column.

**Stays bare, non-negotiable**: the block x 58–732 / y 260–520, and the vertical
channel x 596–732 for its full height. That channel is the composition's spine of
negative space; nothing may bridge it.

### Occlusion

**May be overlapped, far-tier ink only**: the empty top band y 81–267; the right
margin; the bottom band; the left gutter and the first ~30 px of the text column
beside the date line.

**Must stay legible, nothing crossing at any tier**: the `h2` — the premise is that
the headline stays in clean white; the degree line and especially `FIRST CLASS
HONOURS`, which is the credential and already carries `--accent`; the tag row; all
five module names and blurbs; all five 44 px glyphs, which turn accent as each row
lights and are the chapter's own visual argument. A leaf over a glyph destroys a
meaning the page spent a module on.

Two measured collision hazards. (a) The row pitch is 76 px with 63 px rows, so only
~13 px separates a rule from the next row's name box — leaf buds are capped at
14 px and confined to x 1100–1270. (b) The vine must not thicken the rule: the
rules are 1 px at 14 % ink and the vine draws at `--flora-hair` 0.9 px in
`--flora-ink`, close enough that the crossfade reads as one line changing character
rather than two lines swapping.

### Risks

- **Mobile cannot carry this band.** At 390×844 content runs y 129–716, gutters are
  20 px, and the gap between the dates and the first module row is 48 px. There is
  no margin to frame and no corner deep enough for a 300 px leaf. Below 900 px drop
  everything except the row vines — which cost nothing, because they live on the
  rules — plus one banana silhouette from the top-right at far-tier ink, tip above
  y 120. Say so in the plan rather than discovering it in QA.
- **`FieldScene` sits directly under the lower two thirds and is already line
  work** — a perspective grid plus a warm accent spine. Ground plants must be
  far-tier or the region becomes an unreadable tangle of two unrelated line systems,
  and the vine must stay `--signal` and never `--accent`: the accent means "this
  answers you", and a plant answers nobody.
- **Chapter-local and global layers are on different depth planes.** A chapter
  layer using `shared.canvasLayer` inside the z-10 stage paints above the fixed
  layer at z 4 with no z relationship between individual plants. Keep the
  chapter-scoped arrangement out of the bottom-edge and left-gutter strata the
  global layer already plants in.
- **A monstera with fenestrations is 15–25 paths** if the veins are not batched;
  three crown leaves is most of a tier's current allowance. Gate them to high and
  medium.
- **Overfilling the dead hold makes the chapter announce itself.** Row 5's vine
  should still be finishing as the stage begins to un-pin, so the transition out is a
  plant mid-growth rather than a completed picture being taken away.
- **`Kcl.tsx` writes nothing at all under reduced motion** — the callback returns
  immediately and the CSS `@media` block does the work. Any new `--vine` variable
  needs a sane default *and* must be forced to 1 inside that same block, or
  reduced-motion users get lit glyphs, full text and five invisible vines.
- **The asymmetry has to survive 1280 and 1920.** At 1920 the right strip grows to
  ~250 px and the trunk starts to look like a deliberate border; at 1280 it narrows
  to ~150 px and the crown leaves crowd the module names. Only 1440 and 390 were
  measured.

---

## 7. UCL — 72.8 – 89.6 %

### The measured stage

Head (58, 90) → (419, 392). The five module labels, hand-placed as a constellation:
`MACHINE LEARNING` (799, 251) w138 · `APPLIED DEEP LEARNING` (1091, 338) w177 ·
`DATA ANALYSIS` (137, 424) w115 · `DATA MINING` (1038, 476) w99 · `VALIDATION AND
VERIFICATION` (243, 562) w224. Message (58, 670) → (321, 801). Credentials
(1197, 723) → (1382, 801), hidden below 800 px.

Empty: the whole top-right quadrant x 400–1440 / y 60–240; the right band
x 1290–1440 / y 90–700; the left band x 0–130 / y 400–700; bottom-centre
x 340–1190 / y 610–840; and the mid field x 400–780 / y 90–600.

**The handover dip.** At t = 0.82 the head is at 0.41, every module is at 0.00 and
the message is at 0.17 — the screen is very nearly blank. From t ≈ 0.88 only the
closing statement and the credentials exist. The emptiest moment of the chapter is
precisely where the brief wants peak density, heading into contact.

### Composition — three depths

1. **The right-hand mass, midground.** Rooted off-canvas with petioles converging
   around (1520, 640). Three monstera blades reaching in: upper to x ≈ 1200 at
   y ≈ 200, middle — the largest, ~520 px across — to x ≈ 1090 at y ≈ 360, lowest to
   x ≈ 1140 at y ≈ 560. Behind them two philodendron silhouettes at far-tier ink
   reaching only to x ≈ 1330. `APPLIED DEEP LEARNING` and `DATA MINING` then sit
   **on** the middle blade: the label reads as a coordinate pinned to a leaf. It
   must stop above y ≈ 700 or drop to far-tier alpha below it, because the
   credentials occupy (1197, 723) → (1382, 801).
2. **The palm frond, front band.** Enters above the crown at x ≈ 1150, arcs down
   and left, tip ending around (760, 300). The only front-band element in the upper
   half, and what makes the chapter read as overtaken rather than decorated. Its
   rachis clears `MACHINE LEARNING` by at least 24 px — the tip points at the label
   without touching it.
3. **The banana blade, front band, the counterweight.** Rooted off-canvas at about
   (−60, 980), a thick midrib rising steeply and turning right, blade opening
   between y ≈ 680 and y ≈ 400, outer edge reaching x ≈ 190 at most. Its upper tear
   crosses just behind `DATA ANALYSIS` — the loneliest of the five labels should be
   the one piece of text with a leaf behind it. **Hard constraint**: fully above
   y ≈ 660 by the time x exceeds 60, because the closing statement's box starts
   there.
4. **The bottom runner, front band, the merge motif.** A pothos creeping
   left-to-right along the bottom edge between y 800 and 900, from x ≈ 340 to
   x ≈ 1190. It passes **behind** the progress rail so the rail visibly cuts it, and
   behind the `06 UCL` label and the percentage readout. Leaves capped at 40 px.
   This is the element that reads as the interface and the plant occupying the same
   pixels.
5. **The module sprouts, trace scale.** Each accent `×` gets a two- or three-leaf
   sprig of 14–22 px unfurling from the mark itself, angled away from its own label.
   **Do not draw a vine between them.** The modules are a constellation, not a
   sequence; connecting them would fight the chapter's stated design. This is where
   the brief's "timeline becomes a vine" idea lands for UCL — each coordinate
   sprouts on its own.
6. **The title stays clean.** One hairline tendril descending from the crown at
   x ≈ 400–470 to y ≈ 310, far-tier, behind the right terminal of `ENGINEERING`.
   Nothing else within 40 px of that block.

**Asymmetry ledger**: right = three monstera + two philodendron + one palm. Left =
one banana. Bottom = one runner, entering from the left and petering out at 82 %
width. Top-left = one tendril. The constellation already spreads two labels left and
three right, so the vegetation must **not** also balance or the frame becomes a
wreath. The right-heavy mass is the deliberate correction.

**Negative space that survives at peak**: the mid field x 400–780 / y 90–600 stays
bare paper apart from the palm tip, and the region around the title stays bare.
Those two voids are what keep it premium rather than overdecorated.

### Occlusion

**May be overlapped**: the field grid and dust motes below y ≈ 545 — the runner and
the banana midrib crossing them is the point; bare paper in the mid field and the
top-right quadrant; the HUD progress rail and its hairline, but **not** the
percentage readout or the `06 UCL` label; the title's counters and descenders, by
the single hairline tendril and nothing more.

**Must stay fully legible — nothing above far-tier ink, no solid fill at any
alpha**: all five module labels with a 16 px pad; the closing statement, which is
the chapter's payoff and must land on clean paper; the credentials stack; the head
block including its tag row; the entire HUD bar and the `N` bubble.

**The fenestration rule.** Where the right-hand monstera passes under `APPLIED DEEP
LEARNING` and `DATA MINING`, a hole in the leaf must fall under the label box. That
is the one technique that lets a big leaf and small mono text occupy the same
rectangle without either losing. If a hole cannot be placed there, **move the blade,
not the label.**

### Risks

- **Vegetation must not join the 0.70 → 0.82 mass fade-out.** If the new layer
  copies the chapter's existing windows out of habit, the screen at t = 0.82 goes
  completely blank. Holding the plants through t = 1.0 is not a stylistic preference
  here; it is what stops the chapter having a hole in it.
- **Mobile cannot carry HIGH.** At ≤ 800 px drop to one monstera blade entering from
  the right between y 600 and y 780, keep the bottom runner, keep the sprouts at half
  scale, and drop the palm, the banana and the philodendron tier. Intensity comes
  from one large near-camera leaf, not from count. Honest reading: mobile lands at
  MEDIUM-HIGH, and the band is better served that way.
- **Pre-existing defect, to be worked around, not folded into this work**: at 390 px
  `APPLIED DEEP LEARNING` sits at left 293 with width 177, so it runs to x = 470 and
  is silently truncated by `html, body { overflow-x: clip }`. Keep the mobile right
  edge clear in y 300–360, or any plant there will look like it is causing the clip.
- **Field grid collision.** The lower third is already fine line work at the same
  stroke weight. Separate by **scale and ink**, not by count — and do not touch
  `FieldScene`, which is shared with seven chapters.
- **Double parallax.** The dust motes already translate with `frame.pointerX/Y`. If
  the leaves also read pointer, the two compound and the page starts to feel like it
  is swimming. Keep leaf parallax on scroll progress only.
- **Style drift at peak density.** Three monstera plus a palm is close to the line
  the brief draws against a generic jungle site. The protections are: line art first
  with fill arriving late; `--signal` ink and never `--accent`; the mid field kept as
  bare paper; the title block kept clean. If the frame starts reading as tropical
  rather than as a technical page being reclaimed, **cut the third monstera blade
  before cutting anything else.**

---

## 8. Contact — 89.6 – 100 %

### The measured stage

Corners y 81–129; headline box x 268–1173 / y 391–509; links table x 58–1383 /
y 628–702, `auto-fit minmax(190px, 1fr)` resolving to four columns in one row with
dividers near x 388 / 718 / 1048; colophon y 750–766; portal readout y 786–815;
HUD y 840–880. At 390×844 the links leave the absolute stack and become a static
single column x 20–370 / y 437–700.

`ContactScene` runs one `InstancedMesh` of about 500 icosahedra that springs into a
flattened sphere across t 0.05–0.5 and is pulled by a pointer gravity well. Its dense
core reads as a fine dot-field at roughly x 430–1010 / y 240–620 — centred on and
slightly overflowing the headline. Four genuinely empty regions: the full-width band
y 130–390, which at 1440×260 is the largest contiguous void on the site; the left slab
x 0–268; the right slab x 1173–1440; and the band y 510–628.

### Composition

Asymmetric on a bottom-left → top-right diagonal. The bottom-right stays deliberately
bare, so `ENTER MY WORLD` and the accent rule are the cleanest thing on the page.

- **Back.** A banana blade rooted below the fold near x ≈ −60 rising to y ≈ 520, and
  two vines descending from the crown between x 300–700 that stop dead above the
  headline cap line at y 391.
- **Mid.** A palm frond and a philodendron cluster filling the left slab x 0–260 /
  y 330–620 from the same bottom-left root; a pothos climbing the left gutter from
  y 700 to y 120 with leaves alternating inward; two of its tendrils reaching right
  across the y 510–620 void, passing behind the headline's descenders; a monstera
  hanging from the top-right corner at roughly x 1150–1440 / y −80 to 300, drooping
  inward and clear of the corner-TR chrome block, so the chrome reads in a notch the
  leaf leaves open.
- **Front, at most three elements.** One palm leaflet tip crossing over the top
  hairline of the EMAIL cell at reduced opacity, so the rule appears to run under a
  leaf; one philodendron edge clipping the bottom-left corner; one thin ivy tendril
  crossing the colophon's left end.

**Hard exclusion boxes, no ink of any layer**: x 255–1185 / y 380–520, the shared
question/answer grid cell — the two lines occupy the same grid area and cross-fade, so
size the box to the union of both states plus margin, and anything there is read as
part of the type; the ellipse x 430–1010 / y 240–620, the dot core, which the flora
layer would sit in front of and fight, and which the corner-TR copy explicitly invites
the visitor to play with; and x 1048–1440 / y 740–880, the colophon right, the readout
and the HUD.

The big void y 130–390 is where the density actually lives — the crown vines, the
monstera's fall and the top of the palm — and it stays at most half covered.

### The gate

`hedge()` in `WorldPortal.tsx` is the payoff and needs the biggest change. Today it
plants 5/10/16 sprigs by tier, stratified uniformly across the full width at 26–76 px.
Confirmed live at `pull = 0.545`: the sheet has already climbed past the headline and
the hedge is a row of about five sprigs ~30 px tall — the gate currently reads as a
plain white sheet with an almost invisible fringe.

Rewrite it so that:

- **x is edge-weighted** — heavy mass in 0–28 % and 72–100 %, a thin scatter in
  28–72 %, and **nothing between 42–58 %**, behind the `Entering` word and the accent
  rule.
- **size runs 60–110 px in the centre scatter and 180–380 px at the two edges.**
- **family is chosen by charge rank**: ranks below ~0.55 keep today's grass, sprout
  and fern — the understory, arriving first; ranks above draw palm, banana and
  monstera — the pillars, arriving last.

The visitor's last gesture then replays the whole journey's progression, sprigs to
canopy, in one push, and the leading edge becomes a dense arch framing a clear centre
instead of the lawn it is now.

**Mobile is a different composition, not a scaled one**: no front layer at all, a crown
cluster in the y 120–255 void, the left-gutter vine, and two tendrils crossing the
y 336–430 void that the link rows later arrive on top of — the rows are at opacity 0
until t ≈ 0.66, so the band genuinely is empty while the plants grow. All mobile
density is delivered by the gate.

### Occlusion

**May be overlapped**: the corner-TL tag row and corner-TR mono block, by thin vines
behind them, never across the glyphs; the empty bands; the hairline top border of the
EMAIL cell and the left end of the colophon, one front-layer leaf each at reduced ink;
both gutters.

**Must stay fully legible and untouched**: the question/answer cell at every moment of
the cross-fade; all four link rows' label and value text and their hit areas — they are
the chapter's only interactive elements and the stage hands `pointer-events` back per
child, so the canopy host must set `pointer-events: none`; the portal readout, its
`ENTER MY WORLD` link and the accent charge rule; the HUD. On mobile the answer line
and the whole 263 px link stack are effectively the entire screen, so nothing may cross
them.

### Risks

- **Frame budget.** `ContactScene` already runs the heaviest per-frame work on the home
  journey, and it peaks in the same chapter. Canopy fully drawn by t ≈ 0.62,
  transform-only afterwards, hard caps of ~10 mid/back leaves and 3 front leaves at high
  tier, ~5 and 1 at medium, back layer only at low.
- **Two ideas of density competing at the foot.** The page canopy and the veil hedge are
  both at maximum in the last few hundred pixels. If both peak at once the moment reads
  as mud. The canopy must be settled and dimming via `--portal-dim` before the hedge
  starts, so the eye hands off from one to the other.
- **Reduced motion currently strips the gate bare**: the portal renders no flora at all,
  `.question` is `display: none`, and the flora layer falls back to 6–12 still sprigs.
  The chapter meant to be the densest becomes the emptiest. Render a still, fully-drawn
  canopy and arch instead of nothing.
- **Occluding the WebGL cloud.** Every back-layer leaf draws over the particle sphere.
  The exclusion ellipse is not optional.
- **No room in the lower half.** The bottom 280 px is four stacked bands. This layout can
  only deliver full immersion in the upper two thirds and at the two vertical edges. Be
  honest about it.
- **Changing the hedge's x distribution replants the gate entirely.** That is intended,
  but the charge must be re-eyeballed at 5, 10 and 16 sprigs — the low tier gets a
  five-plant arch and could easily read as two lumps and a gap.
- **The gateway points at the retired route.** See §9.3.

---

## 9. What already exists and is being kept

This is an evolution of a layer that already ships, not a rewrite. Roughly two thirds
of the mechanism below is reused verbatim.

### 9.1 The scroll architecture — unchanged, and nothing is added to it

Lenis smooths native scroll in `src/hooks/useLenisScroll.ts`, which runs one rAF loop
writing into the `frame` object at the bottom of `src/state/journey.ts`. Components
subscribe with `subscribe()` from `src/lib/ticker.ts` and write straight to the DOM.
React never re-renders on scroll.

The nature system takes **one** `subscribe()` for all its bands. It does not add a
scroll library, it does not add a second rAF loop, and it does not add GSAP
ScrollTrigger — which would be a second competing scroll authority, the thing the brief
itself warns against.

Two dead APIs to avoid, verified by grep: `useJourney().pointer` / `setPointer` (nothing
ever calls the setter) and `frame.chapterProgress` / `frame.chapterIndex` (never
written; they read zero forever).

### 9.2 The vegetation layer — absorbed, not replaced

Kept exactly as it is:

- **`flora.ts`'s six sprig builders and `mulberry32`.** These *are* the brief's
  early-journey plants. Every sprig is drawn on a 0–100 box anchored at (50, 100)
  growing upward, as open stroke paths ordered base → tip.
- **The `pathLength={1}` + inherited `stroke-dasharray: 1 1` / `stroke-dashoffset: 1→0`
  reveal**, for stroke-only art. One property write draws a whole plant with no
  `getTotalLength()` and no layout read.
- **`stroke-width: calc(var(--flora-hair) / var(--sprig-scale))`** and the reasoning in
  `vegetation.module.css` about why `vector-effect: non-scaling-stroke` cannot be used —
  it unscales the dash pattern and destroys `pathLength="1"`.
- **The nested-group transform convention**: placement on the outer `<g>` as a transform
  *attribute*, sway and scale on the inner one, `translate(-50 -100)` innermost.
  Attributes, not CSS transforms, because a CSS transform on a nested SVG group depends
  on `transform-box` against a viewBox the group did not establish.
- **`syncSurface()` and the resize hysteresis, verbatim.** One `<svg>` whose width,
  height and viewBox are all written in CSS pixels from the live viewport, so one user
  unit is one CSS pixel, and drift is absorbed by the viewBox *origin* rather than by
  rescaling. Replant only on `|Δw| ≥ 24` or `|Δh| ≥ 140`, that 140 being the mobile
  address-bar allowance.
- **The `document.hidden` unsubscribe, the write-caching guards and the integer
  quantisation** before comparison.
- **Reversible growth.** Every value is a pure function of `frame.progress`, so scrolling
  back up ungrows in the correct reverse order with no special case.
- **The `(sin θ, −cos θ)` rotation identity**, which is why a side plant is just an
  upward sprig rotated and no separate art is needed.

Reused with changes: `arrange()` keeps its stratification and its `middle` text-safety
falloff but its four *margin zones* become *depth bands* plus an anchor edge; the single
global germination rank becomes per-band windows with the `p^1.9` shaping kept inside
each band; and the tier-seeded arrangement becomes one arrangement sliced by tier.

### 9.3 The portal — kept as a mechanism, retargeted as a destination

`WorldPortal.tsx` already does, and keeps doing, everything the finale needs: it arms
only at the true foot, accumulates wheel and touch intent against
`resistance = 1 − 0.55·pull²`, gives `DRAG_GIVE 0.28` of each spent pixel back as visible
drag so the effort is seen, fires ten haptic milestones, swaps the readout through a
mask over pull 0.7–0.9, warms the route in four rungs, and commits once after
`COMMIT_MS = 560`. Two custom properties (`--portal-dim`, `--portal-drag`) are written
on the stage every frame, and `portal = { pull, drag }` is already exported as module
state — which is how the body-level front bands will follow the veil without the portal
being changed.

What changes: `hedge()`'s distribution (§8), and the destination. Verified live —
`router.prefetch('/world')` at line 276, `import('@/components/world/WorldExperience')` at
277, `import('@/world/Game')` at 282, `router.push('/world')` at 342 and
`<Link href="/world">` at 613. A full charge in Playwright lands on `/world`'s loader.
Decision 1 makes `/world2` the reward, so **the finale currently opens the retired
route.** `/world`'s own code is not touched by any of this.

`WorldPortal` is also mounted by `Stock.tsx`, the `/projects` finale. Decision 3 removes
it from there.

### 9.4 The measured scroll map, the chapter content and every layout

No chapter's `vh` changes. No content moves between routes. No column, no clamp and no
gap is altered, with the single exception of `.module` in KCL gaining `position:
relative` and an `aria-hidden` span — which is additive and invisible. Every "KEEP" in
the table above means the audit looked for something to cut and did not find it.

---

## 10. Where the audits disagreed, and how it was resolved

The nine agents could not see each other's work. Six genuine disagreements came back.

**R1 — The name and value of the foreground z-index.** About proposed
`--z-flora-near: 12`, Toolbox proposed `11`, KCL said "between 10 and 60", UCL said
"around z 14", Contact just said "front". **Resolved in favour of the systems brief's
six-band scheme**, adopted whole: shadow 2, wash and background 3, the existing flora
sheet unchanged at 4, midground 12, foreground 20, extreme foreground 40. Nothing is
renumbered. Four chapters inventing four names for one plane is exactly how a codebase
ends up with three depth models, and the band names carry meaning that `near` does not.
Full token block in `HOME_NATURE_SYSTEM.md` §3.

**R2 — Which clock drives a plant.** About insisted plants must live on the fixed sheet
because the About stage releases at t 0.706 and rides up. Universe and KCL both designed
chapter-scoped layers inside the sticky stage. The systems brief said band placement must
key off `frame.progress` because `useChapterFrame` is in vh-space and drifts by up to
3.45 points. **Resolved: both are right about different things, and the rule is now
explicit.** Band density and everything body-level keys off `frame.progress`. A
composition that is built against one chapter's measured boxes *and* is meant to ride
away with that stage may use `useChapterFrame` — the drift is irrelevant there, because
the same wrong-but-consistent number drives both the chapter and the plant. Anything that
must survive a handover, or must overlap content, is body-level. About's Plants A–D are
therefore body-level; Universe's and UCL's chapter layers stay chapter-scoped; About's
Plant C in particular is body-level precisely *because* the intended effect is that the
type leaves and the plant stays.

**R3 — The Contact canopy versus the veil.** Contact's audit put the canopy inside the
contact stage so the rising veil would cover it and so it would inherit `--portal-drag`
for free. The systems brief pointed out that the veil is at `z-index: 1` *inside* the
z-10 stage, so every body-level band at z ≥ 12 paints on top of the closing sheet — the
exact opposite of the page being covered. **Resolved by splitting the layer.** Contact's
back and mid canopy lives inside the contact stage, below content, covered by the veil,
inheriting the drag — exactly as that audit wanted. The body-level front (20) and close
(40) bands read the exported `portal.pull` from the shared ticker and are translated up
with the veil and faded out over the last 20 % of the charge. No change to
`WorldPortal.tsx`'s veil, and no band ever floats over the sheet.

**R4 — Whether the existing `Vegetation` layer runs alongside the new system.** Left
implicit by every chapter audit; called out by the systems brief. **Resolved: it is
absorbed as the z-4 near-background band and driven by the new controller.** Two
full-viewport fixed SVGs both ticking is a straight doubling of the layer's cost for no
gain, and absorbing it preserves the margin sprigs the brief says to keep. The new bands
are gated to `journey === 'home'`, which keeps `/projects` visually unchanged for free.

**R5 — The prelude's scripted seedlings versus the tier budget.** The prelude audit asked
for an explicit decision: additive to `COUNT[tier]`, or carved out of it. Additive means
the low tier quietly gets nine; carved out means the low tier might lose its only plant.
**Resolved by the systems brief's replacement for the seeding model.** Generate one
arrangement from `SEED` alone, sort by importance, and render `slice(0, budget[tier])`.
The scripted prelude entries sort first by importance, so the low tier keeps them and the
count is still honoured. This also fixes an unrelated bug: today `arrange()` seeds on
`SEED + count * 7919` with `count` coming from the tier, so an FPS downgrade mid-scroll
reshuffles the entire garden. Under the new model a downgrade *removes* plants instead.

**R6 — Mobile intensity.** KCL, UCL and Contact each independently concluded that the
phone lands one band below the desktop figure and each worried that saying so was an
admission of failure. **Resolved: it is the rule, not a failure.** The brief asks for the
same narrative at lower density, and it is satisfied — the phone still goes from a trace
of nature to a frame that is partially overtaken; it simply gets there with three plants
instead of nine. What is forbidden is a phone path that turns nature off, and nothing here
proposes one. Stated as a rule in `HOME_NATURE_SYSTEM.md` §7.

---

## 11. Where an audit was wrong

**C1 — UCL's sprig count.** The audit reports "21 of 22 sprigs visible by t = 0.65". 22 is
not a tier budget: `COUNT` is `{ high: 30, medium: 16, low: 7 }` and `STILL_COUNT` is
`{ high: 12, medium: 10, low: 6 }`. At UCL t 0.65 — global `p ≈ 0.837` — the germination
curve `N·((p − 0.02)/0.9)^1.9` gives about **25 of 30 on a real high-tier machine** and
**7 of 7 in headless Chromium**, which reports `low` because `weakGpu` matches SwiftShader.
The observation that this chapter looks sparse today is right; the figure is not.

**C2 — Every headless measurement in this audit under-reports density.** `detectDevice()`
resolves to `low` in headless Chromium, so the screenshots in `.qa/nature-audit/` show an
emptier page than a real desktop gets — seven sprigs instead of thirty. Two audits noticed
this and one did not. **The implementation phase must force the tier in the store before
screenshotting**, or it will conclude the chapters are barer than they are and over-plant
to compensate. Over-planting is the failure mode the brief names.

**C3 — `--z-nature-wash: 0` is unusable.** The systems brief proposes the token and then
corrects itself two paragraphs later: `GlobalCanvas` sets `gl: { alpha: false }` and clears
to an opaque `#ffffff` across the whole viewport at z 1, so anything at z 0 is permanently
invisible. The wash is implemented at **z 3, DOM-ordered before the background band**. The
token is documented with that constraint rather than left at 0 for someone to trip over.

**C4 — Toolbox's "two systems drawing connections" is a real conflict, not a style note.**
`ToolboxScene`'s hover lift takes edge opacity from 0.10 to 0.55 with `EDGE_LIT #d4491f`
rays and produces a grey-and-rust scribble across x 490–1180 / y 370–560 — visible in
`.qa/nature-audit/toolbox-1440x900-hover.png`. Layering vines on top gives the chapter two
competing answers to one question. The audit's recommendation — keep the resting watermark,
drop the hover lift, hand the hover job to the vines, which live in the grid's own space —
is the right call and contained to the `+ lit * 0.45` and `+ lit * 0.5` terms in one
`useFrame`. It is nonetheless a change to a shipped interaction the owner may like, so it is
**OQ-3** rather than a decision.

**C5 — The README's project counts are stale.** It says 41 projects, 4 hero, 15 featured,
22 archive; the live UI reads `42 OF 42 PROJECTS`; the Universe audit says 4 / 8 / 30; a
grep of `importance:` gives 4 / 16 / 23. Nothing in this work depends on the tier split, so
it is noted and left alone — but the README line should be regenerated at some point, and
whoever does it should trust `src/content/projects/index.ts`, not any of the three prose
figures.

**C6 — "Vegetation is barely present" is true of the whole journey, not of one chapter.**
Three chapter audits independently described the existing layer as sparse where they were
looking. It is sparse *everywhere* until late: `FILL_POWER = 1.9` means
`count(p) ≈ N·p^1.9`, so at high tier the first sprig germinates at global **12.4 %**, only
about three of thirty have appeared by 31 %, and the last third of the page does most of the
filling. That curve is deliberate and is kept — it just means no chapter before KCL can
lean on the ambient layer for anything.

---

## 12. Open questions

These would change the implementation materially and are not the implementer's to decide.

**All eight were answered during the build.** Each question is kept exactly as it was
asked, with the decision recorded beneath it, because the reasoning is the value: a
question with only its answer left behind reads as an arbitrary rule the next time
somebody wants to change it. What shipped is described in
[`HOME_NATURE_REDESIGN.md`](./HOME_NATURE_REDESIGN.md).

**OQ-1 — Does `/world2` gain the nine-line auto-entry effect?**
`/world2` has a hard `Start driving` gate. Nothing outside it can reach past that button:
no URL parameter, no hash, no `sessionStorage` read, and the only global handle to the game
is dev-only. The smallest honest change is a nine-line `useEffect` in
`src/world2/World2Experience.tsx` reading the existing `portal:arrival` key with its
30-second TTL, exactly the contract `/world` already honours. **This contradicts decision 4
("/world2 is not to be modified"), which is why it is a question and not a plan.** The
alternative — the visitor charges the portal, the veil closes, and they arrive on /world2's
loading screen and press one button — is genuinely defensible: that screen is editorial, in
the same typographic voice, with the island already visible behind it. Recommendation: build
the seam first, look at it, then decide. It may well not be in the way.

> **RESOLVED — yes, and it is one of exactly two edits `/world2` receives.** The seam was
> built and looked at, and it was in the way: a visitor who has just spent nine hundred
> pixels of deliberate effort arriving at a button that asks them to press it is the
> gesture being charged for twice. The effect is in `src/world2/World2Experience.tsx`,
> reading `portal:arrival` with its 30-second TTL and removing the key as it reads it. It
> skips the click and not the wait — if the level is still loading, `enter()` refuses and
> the progress bar stands there saying so. Decision 4 is narrowed rather than overturned:
> two micro-edits, both named here, and no third.



**OQ-2 — What happens to `portal:arrival` if OQ-1 is declined?**
The key is written by `WorldPortal.tsx` and read by `src/components/world/WorldLoader.tsx`.
If the portal retargets to `/world2` and `/world2` never consumes it, the write becomes dead
code and the arrival optimisation is silently lost. Options: keep writing it and accept dead
code; stop writing it and delete the branch in `WorldLoader`, which is `/world` code and out
of bounds; or implement OQ-1. It should not be dropped without the owner seeing it.

> **RESOLVED by OQ-1 — the key is consumed, so nothing is dead.** `/world2` now holds the
> other half of the contract and `WorldLoader` is untouched: `/world` keeps reading the same
> key for its own arrivals, and nothing on the site sends anyone there any more. Two things
> followed that were not in the question. The key is cleared again on the way BACK from
> `/world2`, because a visitor who went through and returned still holds a live one, and a
> plain click on the index link inside that thirty-second window would skip the world's own
> gate for someone who had not spent the effort. And `/world` is retired from the
> interface rather than from the codebase — it still answers at its own URL for anyone who
> kept the link, but the index overlay's world link now points at `/world2`, because two
> doors onto two worlds is one door too many and the second island is the one the gateway
> was built for.



**OQ-3 — `ToolboxScene`'s hover lift: delete, reduce, or keep the lattice and drop the hover
vines?** See C4. Three viable answers and they produce visibly different chapters. Deleting
the lift is the recommendation; reducing the lit terms to roughly a third is the compromise;
keeping the lift and dropping the vines is legitimate and makes the chapter MEDIUM-LOW
instead of MEDIUM.

> **RESOLVED — the compromise: reduced to a watermark, with the vine carrying the
> connection.** The lift ran the edges from 0.10 to 0.55 in rust rays, which drew a
> grey-and-vermilion scribble across x 490–1180 / y 370–560 of a near-white page — and the
> vine that now threads the tile wall's own gutters answers the same hover in the grid's own
> space. Two systems were answering one question. In
> `src/experience/scenes/ToolboxScene.tsx` the three `lit` terms drop to roughly a third
> (0.45 → 0.15, 0.50 → 0.17, 0.55 → 0.18) and the resting strengths are untouched: enough
> that the lattice is visibly the thing being asked, quiet enough that it stays a watermark
> and the plant is what the eye follows. Deleting the lift was the audit's own
> recommendation and was not taken — with the lift gone the hover has no answer at all in
> the 3D layer, and the chapter loses a depth cue rather than a duplication.

**OQ-4 — Does the homepage ship a real image of the island?**
The truthful hint is warm light and a gap, not a picture — /world2 is a place seen from
above on warm sand, frame average `#ad9272`, and `public/world2/map.png` (1.1 MB) would
violate the style rule on sight. But a build-time 32×32 or 64×64 blurred, desaturated
downsample of `terrain-color.png`, inlined as a data URI under 2 KB, is genuinely the
island's own colour and at that resolution reads as light and ground rather than as a
picture of a jungle. It is cheap and truthful. It is also the only proposal in this work
that puts a bitmap on a page whose whole argument is that it is drawn. Owner's call.

> **RESOLVED — no bitmap.** The last sentence of the question answered it: a page whose
> whole argument is that it is drawn does not get a photograph of anywhere, however small,
> however truthful its average colour. The hint that shipped is light and a gap, both of
> them drawn. The veil is `--world2-ground` itself, mixed into the sheet with
> `color-mix(in oklab, var(--world2-ground) N%, var(--bg-primary))` as the charge rises, so
> the colour the visitor is about to arrive on bleeds up through the page before the page
> leaves; the bloom at the foot is a glow off somewhere below the viewport; and the opening
> between the threshold's leaves widens onto that same ground colour rather than onto an
> image of it. `public/world2/map.png` stays where it is, unreferenced by the homepage.



**OQ-5 — Does the prelude's BR corner label move?**
All four prelude corners are occupied by mono labels, so the brief's literal "small plant
detail low in a corner" cannot be honoured as written. The proposal composes the clue in the
margin beneath and behind `7 CHAPTERS / ~4 MINUTES`. If a bare corner is wanted, the only
honest answer is to move that label — and it is derived content (`chapters.length` and
`totalVh() * 0.15`) that earns its place. Recommendation: leave it and compose behind it.

> **RESOLVED — the label stays and the clue is composed behind it.** `PreludeLeafShadow` is
> a shadow-band silhouette at 3.5 % ink in the lower right, passing behind
> `7 CHAPTERS / ~4 MINUTES` and dying before the thesis ends. Nothing moved. Two things
> made the recommendation easy to accept once it was on screen: a shadow carries no line
> work at all, so it cannot compete with a mono label for the same reading; and it is the
> cheapest mark in the library, which is why it is also the one plant the low tier gets
> first. `SILHOUETTE_ONLY` in `plants/Monstera.tsx` enforces the no-veins rule structurally,
> so a shadow placed at some other depth by mistake still cannot sprout any.



**OQ-6 — Does `/projects` get any of this?**
Decision 3 removes its portal. It is silent on vegetation. The recommendation is that
`/projects` keeps today's `Vegetation` layer exactly as it ships and receives none of the new
bands — the gateway's exclusivity is what makes finishing the home journey mean something,
and the same argument applies to the canopy. Confirm, because the alternative is a `/projects`
that now looks barer than the homepage rather than merely different.

> **CONFIRMED — `/projects` keeps today's sprig layer and receives no bands.** `Journey.tsx`
> reads `journey === 'home' ? <NatureController /> : <Vegetation />`, so the route mounts
> the layer exactly as it always has, with its own subscription, its own cadence and its own
> visibility handling. The arrangement it plants is identical to yesterday's: the scripted
> prelude openers the home controller asks for are gated behind a `scripted` prop and built
> from their own seeds AFTER the procedural pass, so they cannot disturb its RNG stream.
> It does look barer than the homepage, and that is the answer rather than a cost — the two
> routes are a journey and an archive, and the archive is where the work is read rather than
> where it is staged.



**OQ-7 — `themeColor` on mobile.**
`src/app/layout.tsx` exports `themeColor: '#ffffff'` globally and `/world2/page.tsx` does not
override it, so mobile browser chrome stays white against a `#dce3dc` page at the exact moment
the seam is supposed to be invisible. Fixing it means adding a `viewport` export to a /world2
file — a second small edit inside a route decision 4 puts out of bounds. Cosmetic, mobile
only, and it either matters or it does not.

> **RESOLVED — it matters, and it is the second of the two `/world2` edits.**
> `src/app/world2/page.tsx` exports `viewport: { themeColor: '#dce3dc' }`. The gateway
> spends its whole last second fading to exactly that colour so the swap has no seam in it;
> a white bar of browser chrome across the top of the screen at that instant is the seam,
> moved rather than closed. The value must move with `.route`'s background in
> `world2.module.css` and with `--world2-ground` in `tokens.css` — the discipline
> `src/world/core/palette.ts` already documents for `--paper` — and the export carries that
> warning in a comment beside it. The other half of the same seam is on the homepage's
> side: `commit` paints `--world2-ground` onto `<html>`, which an App Router navigation does
> not re-create, and the return clears it again.

**OQ-8 — Back navigation: where does the visitor land?**
`history.scrollRestoration` is `'manual'`, so `history.back()` from /world2 currently returns
the visitor to **scroll 0, the top of the prelude**, having discarded 26 viewport-heights of
journey. The proposal records `frame.progress` at commit and restores to about **0.93** rather
than the foot — so the gateway is on screen, the visitor sees where they were, and residual
inertial wheel events cannot charge a portal nobody is touching. Landing at the foot is the
other defensible answer and makes re-entry a single notch. Pick one; the current behaviour is
not a third option.

> **RESOLVED — 0.93, as proposed.** `frame.progress` is recorded in
> `sessionStorage['journey:return']` at commit and restored on the way back, capped at
> `RETURN_TO = 0.93`: the gateway is on screen, the visitor sees where they were, and
> `atFoot()` is false, so the tail of an inertial fling still in flight when the navigation
> happened cannot charge a door nobody is touching. Landing at the foot was rejected for
> exactly that reason once it was driven — re-entry being a single notch is the same thing
> as re-entry being an accident.
>
> Three things had to be added around it that the question did not anticipate. A 500 ms
> disarm window on top of the position, for the fling that arrives anyway. The restore waits
> for a document taller than a handful of screens before it fires and gives up rather than
> guessing if one never arrives, because a progress figure resolved against a
> one-screen-tall page puts everything at the bottom — the same warning
> `JourneyProvider`'s deep-link effect already carries. And the stored value is read once
> and then held for two seconds, because Strict Mode mounts every effect twice in
> development: the first pass would take the key out of storage and the second would find
> nothing and put the visitor back at the top of the prelude, which is the precise failure
> the whole mechanism exists to prevent. `WorldLoader` solves it the same way.
