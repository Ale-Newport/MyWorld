# HOME_NATURE_SYSTEM

One number runs the whole thing, and every plant on the page is a pure function of it.

This is the design system for the botanical layer on `/`. The survey that produced
it — what each chapter holds, what may be covered, what is still undecided — is
[`HOME_NATURE_REDESIGN_AUDIT.md`](./HOME_NATURE_REDESIGN_AUDIT.md). The two
engineering sources behind both documents are
`HOME_NATURE_SYSTEMS_BRIEF.md` and `HOME_NATURE_WORLD2_HANDOFF.md`.

Everything below is stated as a rule with a value. Where a value came off the
running server it is marked *measured*; where it is a design decision it is
marked as one. There are no placeholders.

---

## 1. The plant library

### 1.1 The naming convention

Four rules, and they are not negotiable, because the debug overlay (§10) prints
these names and a name that means nothing on screen is worse than no overlay.

1. **Families are PascalCase: a plant noun, then the property that distinguishes
   it from its siblings.** `MonsteraLarge`, `PalmFrondArc`, `PhilodendronHeart`,
   `VinePrimary`, `FernClusterLeft`.
2. **Genuine siblings inside one composition take a trailing capital letter, never
   a digit.** `PalmFrondArcA`, `PalmFrondArcB`. A digit reads as an index into an
   array; a letter reads as a specimen.
3. **Placements are `<Chapter><Family><Role>`.** The family is the geometry; the
   placement is one instance of it with an anchor, a scale, a band and an
   activation window. `UclMonsteraMid`, `KclTrunkRight`, `AboutMonsteraFragment`,
   `ContactHedgePillarLeft`.
4. **Banned outright**: `leaf1`, `leaf2`, `plant-3`, `svgA`, `group0`, `el`,
   `item`, anything that would survive a search-and-replace to another project.

### 1.2 The existing six, kept exactly as they are

`src/components/vegetation/flora.ts` already ships `fern`, `frond`, `grass`,
`sprout`, `tendril`, `seedhead` as lowercase `FloraKind` strings. **These are the
early-journey plants and they do not change.** `WorldPortal.tsx` imports
`mulberry32`, `pickKind` and `sprig` from that module, so widening `FloraKind` or
touching `WEIGHTS` would grow monsteras in the portal's hedge.

Measured cost, 400 seeds each: fern 13.87 paths, frond 12.06, grass 5.51, sprout
5.00, tendril 2.00, seedhead 9.39 plus 8.39 dots. Weighted average **8.24 leaf
nodes, ≈11.4 DOM nodes per sprig** including the three group wrappers.

### 1.3 The new library

New geometry goes in a **new module** — `src/components/vegetation/canopy.ts` —
with its own `CanopyKind` union, deliberately unreachable from `pickKind`. Same
contract as `flora.ts` where it can be: every path carries `pathLength={1}` and is
ordered base → tip, and every plant is drawn on a local box with a known origin at
its own petiole base.

| Family | What it is | Chapters served | Band |
| --- | --- | --- | --- |
| `MonsteraShadow` | Fill only, no veins, no stroke, one fenestration. A cast shadow, not a plant — which is exactly why it cannot read as an icon. | prelude | shadow (2) |
| `MonsteraJuvenile` | Two lobes, one or two fenestrations, entire between them. The arrival of scale, not yet of drama. | about (cropped to a fragment), universe | back, mid |
| `MonsteraLarge` | Mature blade. Midrib, six to eight arching secondaries, tertiary cross-veins between them, three to five **asymmetric** fenestrations of differing size, one split reaching the margin, torn margins rather than punched holes. | toolbox, kcl, ucl, contact, gate | mid, front |
| `PalmFrondArc` | Long pinnate frond, six to nine leaflet pairs per side, uneven leaflet lengths, two torn leaflets, rachis drawn first so the dash reveal runs down the spine before the leaflets appear. | ucl, contact, gate | front |
| `PalmFrondLow` | Shorter, wider, seen more end-on. The outer pillars of the gate arch and the bottom-left mass. | contact, gate | front, close |
| `BananaBlade` | Entire blade, heavy midrib, closely spaced parallel secondaries meeting the margin at a shallow angle, two or three wind tears cut back **to** the midrib and not through it. The largest silhouette anywhere, and usually the faintest ink. | kcl, ucl, contact, gate | back, front |
| `PhilodendronHeart` | Heart blade, deep basal sinus, entire margin, five secondaries, a gentle curl showing a sliver of underside. Simple where the monstera is cut, so the pair reads as one plant at two ages. | toolbox, universe, contact | back, mid |
| `PhilodendronPinnate` | Deeply lobed, taller and narrower. Back layer of the UCL right-hand cluster, so that mass has two silhouettes instead of one repeated. | ucl | back |
| `VinePrimary` | The armature. A woody-thin trailing stem with alternating cordate leaves, visible nodes, aerial rootlets, internodes shortening toward the tip. Visually a line that occasionally becomes a leaf — which is the only thing that fits a 9 px row gap. | toolbox, kcl, ucl | mid |
| `VineTrailing` | The thin descending counterweight. Smaller leaves, no rootlets, lazy sine path. | about, universe, contact | back, mid |
| `IvyClimber` | Palmate three- to five-lobed leaves on a short clinging stem with visible adventitious rootlets. Chosen wherever the opposite side already has a `VinePrimary`, so the two sides are never the same plant. | kcl, contact | mid |
| `FernClusterLeft` | The existing `fern` builder at 1.4–1.8× as a three-frond cluster, used to root a large new leaf in something that has been growing since the prelude. | universe, kcl | back |

Everything else in every chapter composition is one of the existing six.

### 1.4 Placements, by chapter

Named instances, so the audit's compositions and the debug overlay speak the same
language. Full geometry is in the audit's per-chapter sections.

| Chapter | Placements |
| --- | --- |
| prelude | `PreludeLeafShadow`, `PreludeSeedlingA`, `PreludeSeedlingB` |
| about | `AboutVineRising`, `AboutFernRight`, `AboutMonsteraFragment`, `AboutTendrilNear` |
| toolbox | `ToolboxThreadLeft`, `ToolboxGridRunner`, `ToolboxMonsteraMass`, `ToolboxPhilodendronData`, `ToolboxHoverTendrilA..D` |
| universe | `UniverseStemLeft`, `UniverseMonsteraA`, `UniverseMonsteraB`, `UniverseFernRoot`, `UniverseVineRight`, `UniverseSeedheadStop`, `UniverseCountTendril`, `UniverseChipTendril`, `UniverseCrossStem` |
| kcl | `KclRowVineA..E`, `KclTrunkRight`, `KclBananaCrown`, `KclMonsteraCrown`, `KclIvyGutter`, `KclUndergrowth` |
| ucl | `UclMonsteraUpper/Mid/Lower`, `UclPhilodendronBackA/B`, `UclPalmCrown`, `UclBananaLeft`, `UclBottomRunner`, `UclModuleSproutA..E`, `UclTitleTendril` |
| contact | `ContactBananaBack`, `ContactCrownVineA/B`, `ContactPalmLeft`, `ContactPhilodendronLeft`, `ContactGutterVine`, `ContactMonsteraCorner`, `ContactFrontLeafletEmail`, `ContactFrontEdgeLower`, `ContactFrontIvyColophon` |
| gate | `ContactHedgePillarLeft/Right`, `ContactHedgeScatter`, `ContactHedgeUnderstory` |

---

## 2. Colour

### 2.1 What exists, and what may not move

`src/styles/tokens.css`, verbatim and verified:

```
--paper #f4f2ee   --accent #d4491f   --signal #2f6f5e
--ink   #0c0c0d   --bg-primary #ffffff
--flora-ink      color-mix(in oklab, var(--signal) 30%, transparent)
--flora-ink-far  color-mix(in oklab, var(--signal) 16%, transparent)
--flora-seed     color-mix(in oklab, var(--signal) 52%, transparent)
--flora-ink-near color-mix(in oklab, var(--signal) 62%, transparent)
--flora-hair     0.9px
```

**`--bg-primary` must not change.** `GlobalCanvas.tsx` hard-codes
`const GROUND = new THREE.Color('#ffffff')` to match it, with the comment that any
drift and the seam shows; the canvas is `alpha: false` and full-viewport. And
`--paper`, `--paper-2`, `--paper-3` are mirrored by name in
`src/world/core/palette.ts`, which decision 1 puts out of bounds. Adding tokens is
safe. Changing these is not.

**The accent is never a plant.** `tokens.css` already states that vegetation does
not use `--accent`: the accent means *this answers you*, and a plant answers
nobody. The one exception, deliberately scoped, is the midrib of an active hover
tendril in Toolbox, where the thing genuinely is a response.

### 2.2 Why the flora tokens do not scale

Every existing flora token mixes toward `transparent`. At thirty sprigs in the
margins that is correct and invisible. At two hundred overlapping leaves it is
not: **transparency composites multiplicatively**, so three leaves at 30 % alpha
read as 66 % ink and the page goes grey-green exactly where the brief demands it
stay light.

**The rule: anything that can overlap itself mixes toward the page. Only veins,
edges and the shadow band are allowed to be transparent.**

### 2.3 The new tokens

Append a `/* ---- Nature ---- */` block. Eight hues, chosen so that no two
adjacent bands differ only in lightness, and deliberately desaturated — the
saturation ceiling is about half that of emerald, because a saturated green next
to `#d4491f` is a complementary clash and next to `--signal` is a muddle.

```css
  --nature-deep:   #22392e;  /* near-black forest — silhouettes only */
  --nature-forest: #34513f;  /* deep green — far plants              */
  --nature-palm:   #47654a;  /* palm green — the workhorse           */
  --nature-olive:  #6a6f47;  /* olive — the contrast against palm    */
  --nature-fresh:  #7d9a58;  /* fresh green — new growth             */
  --nature-lime:   #a2b06a;  /* muted yellow-green — edge lights     */
  --nature-stem:   #6b5942;  /* brown stem                           */
  --nature-stem-2: #8d7659;  /* lighter stem / dry tip               */

  /* Working fills — mixed toward the PAGE, never toward transparent. */
  --leaf-far:    color-mix(in oklab, var(--nature-forest) 12%, var(--bg-primary));
  --leaf-back:   color-mix(in oklab, var(--nature-palm)   20%, var(--bg-primary));
  --leaf-mid:    color-mix(in oklab, var(--nature-palm)   34%, var(--bg-primary));
  --leaf-front:  color-mix(in oklab, var(--nature-forest) 48%, var(--bg-primary));
  /* REVISED after the composition was measured. This was
     `--nature-deep` at 62 %, and the close band draws no midrib and no
     veins at all (`BAND_DETAIL`), so its one specimen had nothing to
     show but its outline — and against a near-black fill under the
     band's blur that outline read as a dark smear rather than as a
     leaf. It was also the single largest contributor to the page
     losing lightness over the last tenth of the journey. A green, six
     points heavier than `--leaf-front` instead of fourteen: still the
     strongest ink the system may produce, but `--leaf-edge` now has
     something to draw a margin against. */
  --leaf-close:  color-mix(in oklab, var(--nature-forest) 54%, var(--bg-primary));

  /* Gradient stops. Every large leaf is a two-stop linear gradient from
     base to tip along its own midrib; that, plus the veins, is most of
     what separates "hyper-detailed" from "icon". */
  --leaf-grad-a: color-mix(in oklab, var(--nature-olive)  26%, var(--bg-primary));
  --leaf-grad-b: color-mix(in oklab, var(--nature-forest) 40%, var(--bg-primary));
  --leaf-lit:    color-mix(in oklab, var(--nature-lime)   30%, var(--bg-primary));

  /* Line work — drawn ON the fill, so these stay transparent. */
  --leaf-vein:   color-mix(in oklab, var(--nature-deep) 26%, transparent);
  --leaf-vein-2: color-mix(in oklab, var(--nature-deep) 14%, transparent);
  --leaf-edge:   color-mix(in oklab, var(--nature-deep) 32%, transparent);
  --leaf-stem:   var(--nature-stem);
  --leaf-shadow: color-mix(in oklab, var(--nature-deep)  7%, transparent);
  --leaf-hair:   0.7px;

  /* The ground. Only the ALPHA of the wash is ever animated. */
  --ground-warm: #f6efe1;
  --ground-vignette: radial-gradient(120% 100% at 50% 40%,
      transparent 52%,
      color-mix(in oklab, var(--nature-olive) 9%, transparent) 100%);

  /* The seam. Must move with .route's background in world2.module.css —
     the same discipline src/world/core/palette.ts documents for --paper. */
  --world2-ground: #dce3dc;
```

Band → token mapping:

| band | fill | line work | gradient |
| --- | --- | --- | --- |
| shadow (2) | `--leaf-shadow` | none | none |
| back (3) | `--leaf-far` | `--leaf-vein-2`, midrib only | none |
| flora (4) | existing sprigs, `--flora-ink` / `--flora-ink-far` | unchanged | none |
| mid (12) | `--leaf-back` → `--leaf-mid` | `--leaf-vein` midrib + secondaries | `--leaf-grad-a/b` |
| front (20) | `--leaf-front` | midrib, secondary, tertiary, `--leaf-edge` | full |
| close (40) | `--leaf-close` | edge only — it is cropped and soft | `--leaf-grad-b` + `--leaf-lit` |

**Contrast floor: no nature fill may go below L\* 45.** `--leaf-front` is about
L\* 62 and `--leaf-close` about L\* 57 since the revision above; `--text-primary`
at L\* ≈ 4 clears 4.5:1
against both by an enormous margin. The binding constraint is the other direction:
`--text-muted` (`#75757c`, L\* ≈ 51) on a `--leaf-front` leaf is roughly 1.2:1, so
**no mid, front or close plant may cross a `--text-muted` or mono run.** That is
an exclusion rectangle, not a tint adjustment.

### 2.4 How the ground warms while the page stays light

Not by changing `--bg-primary`, and not by touching `html` or `body`. A single
fixed wash element above the opaque canvas, whose **opacity alone** is written —
one property per frame, quantised to 1/200, so it writes roughly thirty times
across the whole journey instead of fifteen hundred.

```css
.wash {
  position: fixed; inset: 0;
  z-index: var(--z-nature-wash);   /* 3, DOM-ordered before the back band */
  pointer-events: none;
  background: var(--ground-warm);
  opacity: 0;                      /* written by the ticker */
  will-change: opacity;
  contain: strict;
}
```

| band | `natureProgress` | wash opacity | apparent ground | L\* |
| --- | --- | ---: | --- | ---: |
| clean digital | 0.00 – 0.12 | 0.00 | `#ffffff` | 100 |
| first signs | 0.12 – 0.26 | 0.06 | `#fefcf9` | 99.3 |
| nature enters | 0.26 – 0.40 | 0.14 | `#fdf9f3` | 98.4 |
| interacts | 0.40 – 0.55 | 0.24 | `#fbf6ec` | 97.3 |
| dense framing | 0.55 – 0.73 | 0.36 | `#faf3e6` | 96.1 |
| merge | 0.73 – 0.86 | 0.48 | `#f9f0e0` | 95.0 |
| full immersion | 0.86 – 0.96 | 0.58 | `#f8eeda` | 94.0 |
| gateway | 0.96 – 1.00 | 0.62 | `#f8edd8` | 93.6 |

Interpolate with `easeInOutCubic` between anchors; **never step.** The floor is
L\* 93 — warmer than `--paper` at its deepest and still unmistakably light. The
brief's "must not become a dark jungle" is satisfied by construction: the darkest
surface the visitor ever sees is a cream, and only the *plants* get darker with
depth. `--ground-vignette` fades in as a second background layer on the same
element above `p > 0.86` only, which is what makes "partially overtaken" read as
depth rather than as dimming.

---

## 3. The layer model

### 3.1 The two hard constraints

- **`main.journey` is a stacking context at `z-index: 10`** (`globals.css:177-181`).
  Nothing rendered inside any chapter can paint above z 10 relative to the
  body-level layers, whatever z-index it gives itself.
- **`.stage` is `overflow: clip`** (`Chapter.module.css`). A leaf that must
  overhang a chapter boundary cannot live inside a chapter stage.

Therefore: background bands mount as siblings **before** `<main>`, where
`<Vegetation/>` already is. Midground, foreground and close bands mount as
siblings **after** `</main>` and before `<Hud>`.

```tsx
{canvasReady && <GlobalCanvas />}   {/* z 1  */}
<Cursor />                           {/* z 100 */}
<NatureBackdrop />                   {/* NEW: wash 3, shadow 2, back 3, flora 4 */}
<main id="journey" className="journey"> … </main>   {/* z 10 */}
<NatureForeground />                 {/* NEW: mid 12, front 20, close 40 */}
<Hud … />                            {/* z 60 */}
```

Between a background band and the content sit only the WebGL canvas and the
existing flora sheet. Between a foreground band and the content sits nothing.

### 3.2 The z-index scheme — additive, nothing renumbered

```css
  /* ---- Nature bands ---------------------------------------
     Six depth bands threaded through the layering that already
     exists. The canvas keeps 1, the existing flora keeps 4, the
     content keeps 10, the HUD keeps 60. The three bands above
     the content are siblings of <main>, not children of it. */
  --z-nature-shadow:  2;   /* blurred silhouettes, no veins, 4-8% ink */
  --z-nature-wash:    3;   /* the warming ground; DOM-ordered first   */
  --z-nature-back:    3;   /* far plants, flat fill, no gradients     */
  /* --z-flora (4) is unchanged: the shipped sprigs keep their place  */
  --z-nature-mid:    12;   /* overlaps content edges, never a headline */
  --z-nature-front:  20;   /* crosses content; the "overtaken" layer   */
  --z-nature-close:  40;   /* one or two enormous soft cropped leaves  */
```

`--z-nature-wash` is **3, not 0.** The canvas at z 1 is opaque and full-viewport,
so z 0 is permanently invisible. Wash and back share z 3 and are separated by DOM
order, wash first.

| z | band | what draws there | mounts |
| ---: | --- | --- | --- |
| 1 | canvas | the WebGL scene | before `<main>` |
| 2 | shadow | blurred silhouettes | before `<main>` |
| 3 | wash → back | the ground warming, then far plants | before `<main>` |
| 4 | flora | the shipped sprig layer, unchanged | before `<main>` |
| 10 | content | `main.journey` | — |
| 12 | mid | overlaps content edges | after `</main>` |
| 20 | front | crosses content | after `</main>` |
| 40 | close | cropped canopy | after `</main>` |
| 60 | HUD | on top of all nature | — |

The WebGL canvas stays at z 1 and every plant draws in front of it. That is also
the right editorial answer: the scene is the *content's* backdrop, and nature in
front of it is what makes the canvas feel like something being grown over.

### 3.3 Chapter-scoped layers

A composition built against one chapter's measured boxes **and** intended to ride
away with that stage may render inside the stage, at `shared.canvasLayer` depth,
below content. It then sits inside the z-10 context: above the body-level back
bands, below the body-level mid/front bands. That relationship is fixed and
correct; individual plants across the two have no z relationship, so a
chapter-scoped arrangement must stay out of the strata the fixed layer plants in.

Chapter-scoped is used by: universe, ucl, and contact's back/mid canopy.
Everything else is body-level.

### 3.4 Hosts, unconditionally

Every host: `pointer-events: none`, `aria-hidden="true"`, `contain: layout paint`.
Every `<svg>`: `role="presentation"`, `focusable="false"`. Nothing focusable, no
`<title>`, no `<desc>`, no text.

`chapters.module.css .stage` is `pointer-events: none` with
`> * { pointer-events: auto }`, so a layer added as a direct stage child inherits
`auto` and silently eats every click over it. **Re-declare `pointer-events: none`
explicitly on every new layer.** This is the single easiest way to break Universe
and Toolbox.

**No SVG `<filter>` at any tier.** `feGaussianBlur` re-rasterises its whole filter
region on every property change in the subtree, and on a full-viewport surface
that is the viewport, every frame. If a band must be soft, use CSS
`filter: blur()` on the band root only, make that root's transform the only thing
that ever changes so the result is cached and composited, and add
`will-change: transform`. A CSS filter also creates a containing block for fixed
descendants and a stacking context, so never apply it to a wrapper the fixed hosts
live inside.

---

## 4. `natureProgress`

### 4.1 One variable

```ts
import { frame } from '@/state/journey'

// 0..1, pixel-space, already computed by the single scroll driver:
//   max = documentElement.scrollHeight - innerHeight
//   p   = clamp(lenis.scroll / max)
const natureProgress = frame.progress
```

That is the whole derivation. `natureProgress` **is** `frame.progress`. There is
no second source, no smoothing, no separate accumulator, and nothing writes to it.

Measured on `/`: `scrollHeight 23400`, `innerHeight 900`, 22500 px of travel.

**It is pixel-space, and the store's `chapterRanges()` is vh-space.** They disagree
by up to 3.45 points at the contact boundary — 0.86 of a viewport height. Derive
the band table at runtime from the same vh data rather than typing it, so
`?quick` mode keeps working:

```ts
import { journeys, totalVh } from '@/content/chapters'

export function natureBands(quick: boolean) {
  const list = journeys.home.chapters
  const travel = totalVh(quick, list) - 1        // 25 at full length
  let cum = 0
  return list.map((c) => {
    const start = cum / travel
    cum += quick ? c.quickVh : c.vh
    return { id: c.id, start }
  })
}
```

At full length this yields exactly `[0, 0.128, 0.264, 0.400, 0.544, 0.728, 0.896]`
— *measured*, matching the DOM.

### 4.2 The density curve

Density is the fraction of the library that is fully grown. It is anchored at the
brief's eight band edges and interpolated with `easeInOutCubic` between them.

| `natureProgress` | band | `natureDensity` |
| ---: | --- | ---: |
| 0.00 | clean digital space | 0.00 |
| 0.12 | first signs of life | 0.04 |
| 0.26 | nature enters | 0.14 |
| 0.40 | nature interacts with content | 0.30 |
| 0.55 | dense botanical framing | 0.52 |
| 0.73 | digital and organic merge | 0.74 |
| 0.86 | full immersion | 0.92 |
| 0.96 | the gateway | 1.00 |
| 1.00 | — | 1.00 |

The shape sits between `p^1.4` and `p^1.55`. **This is deliberately less
back-loaded than the shipped `FILL_POWER = 1.9`**, which gives `count ≈ N·p^1.9`
and therefore 7.6 % density at 0.26 where this curve gives 14 %. The shipped curve
was tuned for thirty margin sprigs, where the early page being nearly bare is the
point; the new library has to have visibly arrived by the end of Toolbox. The
`p^1.9` shaping is **kept inside each band** for the ordering of plants within it.

### 4.3 Per-plant derivation

Every placement carries a threshold and a ramp **in density space, not in progress
space**. That decoupling is what lets the curve be retuned without replanting.

```ts
const d  = natureDensity(frame.progress)       // 0..1
const g  = clamp((d - plant.d0) / plant.ramp)  // 0..1, this plant's growth
```

- `d0` is assigned by rank within the plant's band, shaped by `p^1.9`, so the
  number fully grown at any moment is `≈ N · natureDensity`.
- `ramp` is `0.05..0.10` of density, randomised per plant from the shared seed —
  the same range the shipped layer uses, and the reason the arrangement never
  looks like a uniform stagger.
- `g` is a **pure function of scroll**. Scrolling back up ungrows every plant in
  the correct reverse order with no special case. That rule is inherited from the
  shipped layer and is not weakened anywhere.

### 4.4 Per-chapter derivation

```ts
const band = bandAt(frame.progress)                        // from natureBands()
const t    = (frame.progress - band.start) / band.span     // 0..1 within a chapter
```

Use this for anything keyed to a chapter but rendered body-level. Use
`useChapterFrame(id, cb)` **only** for a layer that lives inside that chapter's
sticky stage and is meant to ride away with it — there the vh/px drift is
irrelevant, because the same wrong-but-consistent number drives both the chapter
and the plant.

Bands overlap by about 4 points at each edge so no transition announces itself,
and deep links land slightly short of a boundary (`JourneyProvider` resolves them
in vh-space), so **every band gets a ramp and never a step.**

### 4.5 The single subscription

```ts
useEffect(() => {
  const nodes = /* collect every handle ONCE, here */
  return subscribe((dt, now) => {
    const p  = frame.progress
    const v  = frame.velocity      // progress per second, damped lambda 8
    const px = frame.pointerX      // -1..1, damped lambda 5
    const py = frame.pointerY      // -1..1, +Y is UP (WebGL convention)
    // write straight to nodes[i].style / setAttribute. Never read back.
  })
}, [/* deps that change the node set */])
```

**One `subscribe()` for the entire nature system**, driving all three hosts.
Never `getBoundingClientRect`, `getComputedStyle` or `getTotalLength` inside a
tick. Never `setState` inside a tick. Keep a per-node last-written cache with
integer quantisation and skip the write when nothing changed — the shipped layer's
`Float32Array grown` / `Int32Array wroteAngle` pattern is mandatory for every new
animated property.

---

## 5. Animation rules

### 5.1 What is scrubbed, and what is not

| behaviour | source | inertia? |
| --- | --- | --- |
| growth / unfurl | `natureDensity(frame.progress)` | none — pure scrub, fully reversible |
| band parallax | `frame.progress` | none |
| ground wash opacity | `frame.progress` | none |
| lean | `frame.velocity` | yes — damped, λ 6 |
| wind sway | `frame.time` | its own clock, never scroll |
| pointer parallax | `frame.pointerX/Y` | already damped at λ 5 by the driver |
| gate charge | `portal.pull` | the portal's own resistance curve |

Growth never has inertia. A plant that keeps growing after the reader stops
scrolling is a plant that is animating at them.

### 5.2 Reveal mechanics

- **Stroke-only art** (all six existing families, all vines, all veins) uses the
  shipped mechanism verbatim: `pathLength={1}`, `stroke-dasharray: 1 1`, an
  inherited `stroke-dashoffset` running 1 → 0, paths ordered base → tip. One
  property write draws a whole plant.
- **Filled art** cannot be revealed by a dash. Large leaves use a **clip-path
  wipe**: one `<clipPath clipPathUnits="objectBoundingBox">` per band holding a
  `<rect>` whose `height`/`y` is written per frame, so the leaf unfurls from its
  base. One attribute write per plant, no filter, compositor-friendly.
- **The two combine, and that combination is what sells the detail**: the fill
  arrives by clip wipe, and the veins draw on by dash **slightly behind it**, so a
  leaf is briefly a shape before it is a drawing.
- **Unfurl** is an SVG `transform` **attribute** on the leaf group — rotate about
  the petiole base plus a 0.86 → 1.0 scale — never a CSS transform. The attribute
  pivots about the group's own local origin with no `transform-box` argument; a
  CSS transform on a nested SVG group depends on how the engine reads
  `transform-box` against a viewBox the group did not establish.
- **Stroke width** stays `calc(var(--flora-hair) / var(--sprig-scale))`.
  `vector-effect: non-scaling-stroke` unscales the dash pattern and destroys
  `pathLength="1"`.

### 5.3 Wind

One global wind clock, two incommensurate sines so it never audibly repeats, plus
a slow gust envelope:

```ts
const wind =
  Math.sin(t * 0.21) * 0.62 +
  Math.sin(t * 0.37 + 1.7) * 0.38
const gust = 0.75 + 0.25 * Math.sin(t * 0.06 + 0.9)
const angle = wind * gust * plant.swayAmp + plant.phase
```

- `plant.phase` comes from the plant's own seed, so no two plants are in step.
- `swayAmp` by family: existing sprigs **0.28–0.90°** (unchanged); large leaves
  **0.6–1.4°** at 0.10–0.20 Hz, against the sprigs' 0.25–0.55 Hz — a banana blade
  that flickers at a sprig's rate reads as a rendering bug.
- The prelude's two seedlings are capped at **0.20–0.35°**: a 0.9° turn on a 26 px
  sprig is the only motion on an otherwise still screen and will catch exactly the
  eye it is meant to escape.
- **Things that never sway**: `MonsteraShadow` — a blurred 420×260 shape
  repainting at 12 Hz across the opening quadrant is the most expensive thing that
  could be added to the LCP frame; `KclRowVine*` — a hairline that is also a border
  cannot wobble without reading as a bug; anything that has a `--z-nature-close`
  blur applied to its band root.
- **Budget**: sway is `tier === 'high'` only, at the shipped `SWAY_IDLE_MS = 1000/12`
  idle cadence, with at most **six** large nodes swaying at once, and the ticker
  unsubscribed entirely on `document.hidden`.

### 5.4 Scroll velocity

```ts
const target = clamp(frame.velocity * 6, -1, 1)   // saturates at ~3750 px/s
lean = damp(lean, target, 6, dt)                  // settles in ~400 ms
```

Measured magnitudes: a slow read scroll is `≈0.018`, a normal wheel `≈0.053`, a
fast flick `≈0.133`. The `* 6` scaling is the shipped one and is reused for
consistency.

`lean` is one shared number for the whole system, multiplied per band —
back **0.4×**, mid **1.0×**, front **1.6×**, close **2.2×** — and applied as an
additional rotation on each plant's sway group, up to `1.4°` at 1.0×. **Velocity
never touches growth.** A plant that grows faster because you scrolled faster has
stopped being a function of position.

### 5.5 Pointer parallax

One translate per **band root**, never per plant:

| band | excursion at full deflection |
| --- | ---: |
| shadow, back | 2 px |
| flora (existing) | 0 — unchanged |
| mid | 5 px |
| front | 12 px |
| close | 22 px |

`frame.pointerX/Y` are already damped at λ 5 by the driver, so no further
smoothing. **+Y is up**, WebGL convention, not DOM convention — invert before
writing a CSS translate.

Hard cap: the maximum excursion of any band must be smaller than the narrowest
plant in it. It must read as depth, not as the page swimming. `FieldScene`'s 620
dust motes and `ContactScene`'s gravity well both already track the pointer; the
nature bands are the third system doing it, and three compounding parallaxes is
what "swimming" means. If it reads wrong at contact, halve the front and close
figures before touching either scene.

### 5.6 Plants must not move like UI cards

The rule the whole system is defended by. A plant may not:

- translate along a straight line with an ease-out and stop — that is a card;
- fade in with a lift — growth comes from a base, as a wipe or a draw;
- carry a CSS `transition` on `transform` or `opacity`, ever. Every value is a
  pure function of progress or of the wind clock. (The three exceptions are
  state-driven, not scroll-driven, and are named: the Universe chip tendril, the
  Universe count curl, and the Toolbox hover tendrils.)
- bounce, overshoot, or have a spring with a stiffness;
- share a stagger delay with its neighbours — the per-plant randomised `ramp` is
  what breaks the rhythm, and it is not optional;
- freeze into a final state. A plant that has finished growing keeps breathing at
  0.6–1.4°, which is the difference between a living thing and an illustration;
- rotate about its own centre. Rotation is always about the petiole base, because
  that is the only pivot a plant has.

---

## 6. Performance

### 6.1 Tiering

`detectDevice()` in `src/lib/perf.ts` is a cached module singleton; the first
caller's environment wins for the session. `isMobile = width < 768 || (isTouch &&
width < 1024)`; `weakGpu` matches `/swiftshader|llvmpipe|software|angle \(intel\)?
?hd/i`, **which is why headless Chromium always reports `low`** and why any
Playwright measurement of this layer is a low-tier measurement unless the tier is
forced. Force it before screenshotting.

The FPS governor is `createFpsWatchdog`, wired in exactly one place — inside
`GlobalCanvas`'s `useFrame` — firing once after two consecutive 2-second windows
under 32 fps. **Do not add a second watchdog.** Subscribe to
`useJourney((s) => s.performanceTier)` and react to the downgrade the existing one
publishes.

**A downgrade must remove plants, not reshuffle them.** Today `arrange()` seeds on
`SEED + count * 7919` with `count` coming from the tier, so a mid-scroll downgrade
replants the entire garden. Generate one arrangement from `SEED` alone, sort by
importance, render `slice(0, budget[tier])`.

**The low tier is the exception, and it is named rather than sorted.** Importance
ranks what may be LOST, which is the right question when a budget has to cut
twenty plants out of forty-two and the wrong one when it has to leave six: six
plants also have to encode an order of ARRIVAL, and a set chosen by importance has
no reason to be spread across the journey. Sorted that way the low tier measured
0, 1, 2, 1, 2, 2, 4, 4 specimens across the eight sampled positions — the page
getting *emptier* between thirty and forty-five per cent, because two of the six
withdrew before their replacements had grown. So `LOW_TIER_CAST` in `placements.ts`
names six specimens in arrival order, one per chapter bar Universe, and nothing in
the cast withdraws. It counts 0, 1, 2, 3, 4, 5, 5, 6. Two constraints bind it:
every member must also be in the MEDIUM arrangement, or a downgrade would *plant*
something; and no member may be a front-band specimen at the foot of the page,
because at 390 px contact's closing stack leaves one nowhere to stand.

### 6.2 Budgets

Whole system, all bands, including the existing sprigs.

| | high | medium | low |
| --- | ---: | ---: | ---: |
| total SVG elements | **≤ 1800** | **≤ 1000** | **≤ 220** |
| — measured, all three layers, 1440×900 | 1673 | 916 | 194 |
| large plants (palm / monstera / banana / philodendron) | ≤ 26 | ≤ 10 | ≤ 4 |
| vine or climber runs | ≤ 8 | ≤ 3 | **0** |
| small sprigs (existing families) | ≤ 40 | ≤ 20 | **0 — layer not mounted** |
| gradient defs (shared, referenced many times) | ≤ 8 | ≤ 3 | 0 in this layer — flat fills |
| `<clipPath>` defs | one per drawn specimen — see below | | |
| — measured | 155 | 81 | 16 |
| SVG `<filter>` | **0** | **0** | **0** |
| CSS `filter: blur()` on a band root | ≤ 2 | 0 | 0 |
| per-frame DOM writes, all bands | ≤ 90 | ≤ 40 | ≤ 12 |
| per-plant sway | yes, 12 Hz idle | no | no |
| band parallax | yes | yes | no |

**The high and medium ceilings were raised, and the low one was not.** 1400 and
600 were written before the design existed — before the twelve families, before
the chapter-scoped layers and before the gate's hedge — and the finished page
measures 1673 and 916 across all three vegetation layers at 1440×900 (nature
bands + chapter flora + gate), stable to within a dozen elements at 1920×1080,
1280×800, 1024×1366, 880×680, 834×1112 and 390×844. Those are what this design
costs, and §6.3's own first rule is that node count is not the thing that hurts.
So the ceilings are the measured figures plus a stated headroom: **1800 is 1673
plus 7.6 per cent** and **1000 is 916 plus 9.2 per cent** — roughly one more
chapter layer each, which is the smallest unit anybody would add. They are
ceilings on this composition, not a licence for the next one.

**220 is unchanged, and the low tier was cut to it rather than excused.** It
measured 359 — sixty-three per cent over, with the nature bands alone at 261
before either of the other two layers was counted — and it is the one tier that
exists to protect a device that cannot cope. It now measures **194**, at every
viewport tested. Four whole cuts got it there, and every one of them removes
specimens rather than degrading the ones that remain:

- **The shipped sprig layer does not mount on the home page at the low tier**
  (−106, by far the largest). Seven sprigs and the prelude's two scripted openers
  cost very nearly half of everything a weak device may draw, for the faintest
  marks in the library, on the one tier whose whole composition is six named
  plants. `PreludeLeafShadow` is the prelude's opening clue there and is cheaper
  than either seedling. `/projects` is untouched: it mounts its own instance.
- **`ContactGutterVine` gives way to `ContactMonsteraCorner` in the cast**
  (−24). An ivy climber is 36 elements against a monstera crop's 12 and the two
  say the same thing at the same moment — the arrival, at the gate, of the first
  plant that is not behind the page. The run budget becomes a fourth large plant,
  which is not more raster: a long stroked hairline run with a dozen blades on it
  costs more to draw than the leaf that replaced it.
- **About's riser, Toolbox's grid vine and Universe's annotations do not mount at
  the low tier** (−19), following the precedent `UclModuleSprouts` already set.
  `leafBudget` already takes every leaf off those layers there, and a chapter
  layer stripped of the thing it was drawn for is not a cheaper version of
  itself. KCL's five row vines stay at every tier, because they *are* the drawing
  rather than its foliage.
- **A band with nothing planted in it is not mounted, and no band defines a
  gradient at the low tier** (−22). An empty sheet is five nodes and a promoted
  compositor layer for a picture of nothing; and the low column already read
  "flat fills", which the layer was not honouring.

**The `<clipPath>` line is restated rather than reduced, and the reason is that it
was never a budget.** Every blade in this vocabulary grows by a clip rectangle
travelling out from its petiole — that is what §5.2 means by a wipe, it is what
makes growth a pure, reversible function of density, and it is per specimen by
construction. Twelve was a guess at an absolute count for a design that had not
been drawn; the honest invariant is **one `clipPath` per drawn specimen and never
more**, which the measured 155 / 81 / 16 satisfy exactly. A clip rectangle is not
a filter: it costs a rectangle intersection at raster time, it never
re-rasterises a region on change, and the number of them is the number of plants
— which is what the rows above are for. Reducing it would mean giving up the
wipe, and the wipe is the growth.

Per-chapter caps that matter, from the audit: Toolbox's precomputed hover tendrils
are 63 tiles × at most 4 edges = **252 `d` strings, built once on mount and on a
debounced resize**, never per hover — a pointer sweeping the wall then costs
attribute toggles and nothing else. Contact caps at ~10 mid/back leaves plus 3
front at high, ~5 and 1 at medium, back band only at low. KCL's chapter layer gets
9/5/0 margin plants, with all five row vines at every tier, since they are five
short paths inheriting a transform that already exists — and at the low tier they
are the *only* chapter layer left, for the reason above.

### 6.3 Rules behind the numbers

- **The real cost is rasterised area × repaint frequency, not node count.** One
  1200×900 gradient leaf costs more per repaint than two hundred hairline sprigs.
  Budget both.
- **Batch the veins.** A hyper-detailed leaf is 40–70 nodes with one `<path>` per
  vein, or **8–14** with the secondaries and tertiaries batched into two or three
  compound paths of `M … Q …` subpaths. It renders identically and costs one node
  and one style resolution instead of thirty.
- Gradients live in `<defs>` with `gradientUnits="objectBoundingBox"`, defined once
  per surface, referenced by every leaf regardless of size. Never inline per leaf,
  and **never animate a gradient stop.**
- Keep `contain: layout paint` on every host and `contain: strict` on the wash.
- Keep the `document.hidden` unsubscribe.
- Gate dash-offset writes on `|Δt| > 0.002`. Dash-offset forces a path repaint.
- **A band with no plants in it is not mounted.** Five SVG nodes, a viewBox to
  keep in sync on every resize and — above the low tier — a promoted compositor
  layer, all for a sheet with nothing drawn on it. The test is emptiness and not
  the tier, because `minWidth` can empty a band on a narrow laptop at any tier.
- **Nothing in this layer paints over type that is moving.** A chapter's sticky
  stage is pinned for all but the last viewport-height of its own scroll and then
  rides up through a fixed layer of plants, so for six windows of one viewport
  each the exclusion table in `placements.ts` — which describes where the type is
  while the stage is pinned — is describing type that has left. For the length of
  each of those windows the three foreground bands take a z-index below
  `--z-content` and the words paint over the leaves, exactly as the HUD already
  does. It costs **three attribute writes twice per chapter boundary**, twelve
  across the whole page, and not one per frame; the depth changes only at the ends
  of the window, where the stage is still pinned and the exclusion pass guarantees
  there is no overlap for it to show in. The last chapter is excluded because
  Contact's stage reaches the moment it would begin to lift exactly as the
  document stops scrolling: it never rides, and the frame at a hundred per cent is
  untouched.

### 6.4 Measured baseline, to beat

Today, headless, low tier, 1440×900: 7 sprigs, 70 SVG elements, scroll FPS over
the whole journey min 39 / p10 50 / median 58, idle 61.

Write `scripts/nature-density.mjs` on the pattern of `scripts/world-density.mjs`:
step `frame.progress` 0 → 1 in fifty steps, record
`document.querySelectorAll('[data-nature] *').length`, the count of plants with
non-zero opacity, and a 500 ms FPS sample; fail if any step exceeds the tier budget
or drops below 50 fps p10 on a non-headless high-tier run.

`scripts/visual-qa.mjs` begins with `rm -rf .qa`. Redirect its output or move the
briefs first.

---

## 7. Mobile

**The narrative is identical. The density is lower. Nature is never disabled.**

A phone still travels from one barely-noticeable clue to a frame that is partially
overtaken, and still ends at the gate. It simply gets there with three plants where
a desktop uses nine. Cutting the progression on a phone would delete the page's
central idea for most of its visitors.

### 7.1 What is actually different

- **There are no gutters.** At 390 px the gutter is 20 px and content is
  full-bleed on all twelve columns. Every side-entry idiom the shipped layer relies
  on is unavailable; the existing code already zeroes crowns and halves the per-side
  counts below `NARROW = 720`.
- **The empty regions are horizontal bands, not margins.** Compositions are
  therefore **rewritten, not scaled**. A desktop composition scaled to 390 px puts a
  stem under running text.
- `100svh` on the stage versus the fixed layer's 100 % of the initial containing
  block differ by the address-bar height on iOS Safari. Expect a few points of
  disagreement between a chapter's bottom edge and a fixed layer's bottom edge, and
  never anchor a hard constraint to that seam.
- The replant hysteresis is `|Δw| ≥ 24` or `|Δh| ≥ 140`; the 140 is the address-bar
  allowance and must survive any rework of `syncSurface()`.

### 7.2 Per-chapter mobile intensity

| chapter | desktop | phone | what the phone gets |
| --- | --- | --- | --- |
| prelude | TRACE | TRACE | `PreludeLeafShadow` at 250×180 from the right edge, tip near (330, 600); `PreludeSeedlingA` at (296, 690). `PreludeSeedlingB` dropped — below 720 px the side band makes two sprigs read as a clump. |
| about | LOW | LOW | `AboutVineRising` re-rooted at x ≈ 300, stopping at y ≈ 580 below the markers; `AboutMonsteraFragment` at one lobe plus midrib. Two plants. |
| toolbox | MEDIUM | **LOW** | The grid-vine layer is dropped entirely. One philodendron runner and one thread vine in the back band, where the opaque tile plates swallow and re-reveal them, plus one hanging tendril in the crown at far-tier ink. |
| universe | MEDIUM | LOW | The bottom band, worked: a rising stem, a cross stem, a fern root and one monstera blade below the footer at y 0.88–0.99h. No right-side vine — the gutter is 20 px. |
| kcl | HIGH | LOW-MEDIUM | The crown and both margins: a banana silhouette off the top-right, a crown tendril, the trunk and the climber up the two gutters, the undergrowth at the foot, and one `MonsteraLarge` at MID ink entering the left margin below the module rows. |
| ucl | HIGH | **MEDIUM-HIGH** | At ≤ 800 px: one `MonsteraLarge` entering from the right between y 600 and y 780, the bottom runner, the module sprouts at half scale. Palm, banana and the philodendron tier dropped. Intensity comes from one large near-camera leaf, not from count. |
| contact | VERY HIGH | VERY HIGH | No front band and no close band — the gate's own two close-band palms carry the near-lens read here. A crown cluster in the y 120–255 void, the gutter vine and a philodendron crossing y 336–430 while the link rows are still at opacity 0, and the palms in the left margin. |

**REVISED, and here is why.** The first phone pass read the row above as a licence
to drop, and what went out was a page whose on-screen box coverage was 30 against
the desktop's 238 — at sixty per cent the KCL screen was bare paper with a faint
trace at two corners, and at a hundred the contact screen had two pale shapes at
the right edge. That is not "the same narrative at lower density", it is the
narrative deleted, which the sentence at the head of this section forbids
outright. Ten placements that had been dropped on the phone were given phone
anchors instead, and the anchors that were parked off-canvas were pulled in so
that a blade rooted in the margin actually reaches the page — half a blade's box
hanging off the side of a 390 px viewport is the difference between a composition
and a rumour of one.

On the corrected count — one row per specimen, and the gate's own flora left out
of it — the phone now measures **64** at the foot and **29** at KCL against the
desktop's 167 and 103, with the median specimen at 25 per cent of the viewport's
width and zero collisions at every position.

The density is still lower — it always was meant to be. What is no longer true is
that the gate has to carry the whole phone by itself.

### 7.3 Mobile-specific hazards

- **Toolbox's `.evidence` is `grid-row: 1`, opaque, `z-index: 1` on mobile.**
  Tapping any tile covers the entire head region. Nothing is drawn there.
- **Below 900 px wide or 700 px tall the Toolbox families dissolve**
  (`.group, .tiles { display: contents }`): 63 tiles become one flat wall with no
  labels and no rules, and every routing assumption about family rows is false.
  Detect it and render the single margin plant only.
- **UCL has a pre-existing clip at 390 px**: `APPLIED DEEP LEARNING` sits at left
  293 with width 177, running to x = 470, truncated by `html, body { overflow-x:
  clip }`. Keep the mobile right edge clear in y 300–360, or a plant there will look
  like it is causing the clip. Fixing the label is a separate change.
- **UCL's credentials block is `display: none` below 800 px**, so the region it
  occupies on desktop is free on a phone — one of the few places where the phone has
  *more* room.

---

## 8. Reduced motion

`prefers-reduced-motion` does **not** stop the scroll pipeline.
`useLenisScroll` only sets `duration: 0, lerp: 1, smoothWheel: false` — Lenis
becomes a pass-through, `frame.progress` still updates every frame, and the ticker
still runs. **Scroll-driven reveal continues to work.** What must stop is motion
that is not a direct response to the reader's own scroll.

The layer keeps its **own** `matchMedia` subscription in addition to the store, as
`Vegetation.tsx` already does, because it mounts on more than one route and must
answer the question without depending on a provider having run:
`still = reducedMotion || systemStill`.

| | animated | reduced motion |
| --- | --- | --- |
| density versus scroll | continuous, 60 Hz | **kept**, quantised to the eight bands as a step function cross-faded by opacity — and global transitions are already killed to 0.001 ms, so it snaps |
| ground wash | continuous ramp | **kept**, quantised to the eight band anchors |
| per-plant sway | high tier, 12 Hz | **off** |
| band parallax | on | **off** |
| pointer parallax | on | **off** |
| lean | damped from velocity | **off** |
| clip wipe / dash draw | on | **off** — plants render fully grown from React inline style |
| counts | tier budget | ≈ **40 %** of the tier budget — an arrangement that arrives all at once is a lot of plant |
| ticker subscription | yes | **still yes**, but the callback compares the current band index against the last and does nothing when they match: one integer comparison per frame |

Do **not** freeze the layer at zero density — that deletes the brief's central idea
for these users. Do **not** freeze it at maximum — that buries the early pages.

Chapter specifics: the prelude's still path renders **`PreludeLeafShadow` alone**,
because it is the clue that does not depend on growth to mean anything. Contact
renders a still, fully-drawn canopy **and** a still gate arch — today reduced motion
strips the gate completely bare (`WorldPortal` returns early and renders no flora,
`.question` is `display: none`), which makes the chapter meant to be densest the
emptiest one on the route. KCL's `--vine` custom property needs a sane default of 0
**and** must be forced to 1 inside the existing `@media (prefers-reduced-motion)`
block, or reduced-motion readers get lit glyphs, full text and five invisible vines.

**`scripts/reduced-motion-qa.mjs`'s `DELIBERATELY_HIDDEN` allowlist (lines 46-52) is
a regex over CSS-module class names and must gain every new nature module**, or the
sweep reports false failures on plants that are legitimately invisible at a given
scroll position.

`StaticProfile` goes to `z-index: 300` on `:focus-within`, above everything. Nothing
here reaches that, which is correct — a keyboard visitor who tabs into the summary
gets a clean white document with no foliage on it.

---

## 9. The gateway, end to end

Everything below happens in `WorldPortal.tsx` and its callers. `/world` is not
touched; `/world2` is not touched except by OQ-1, which is the owner's call.

### 9.1 The intent threshold — unchanged

The portal arms only at the true foot: Lenis `targetScroll` within `ARM_PX` and
rendered scroll within `SETTLE_PX`. It accumulates wheel and touch intent against
`resistance = 1 - 0.55 * pull²`, so the last stretch genuinely costs more, and
returns `DRAG_GIVE = 0.28` of each spent pixel as visible drag on the stage, capped
at 64 px and relaxed at `DRAG_RELAX = 7`. Ten haptic milestones fire across the
charge. The readout swaps "Keep scrolling" → "Entering" through a mask over
pull 0.7–0.9. At `pull ≥ 1` it seals, warms fully, and pushes after
`COMMIT_MS = 560`.

None of that changes. It is already the mechanic the brief describes.

Two custom properties are written on the stage every frame — `--portal-dim` and
`--portal-drag` — and `portal = { pull, drag }` is exported as module state. The
body-level front and close bands **read `portal.pull` from the shared ticker**,
translate with the veil and fade out over the last 20 % of the charge. That is how
they avoid floating over a closing sheet without the portal being modified: the
veil is at `z-index: 1` **inside** the contact stage, i.e. inside the z-10 context,
so every band at z ≥ 12 would otherwise paint on top of it.

### 9.2 Preload

Measured critical path for `/world2`, localhost, warm dev server, **ready at
3641 ms**: route document → `World2Experience` chunk → `World2Game` chunk and
three → `world-manifest.json` (22,583 B) → `world.glb` (**5,707,840 B**) → rapier
→ `interactions.json` (9,529 B) → `vegetation.glb` (**7,405,756 B**) → precompile.

**Total speculative cost of a full asset warm: 13,146,708 bytes**, essentially all
of it in the two GLBs.

The existing four-rung ladder transfers in shape, in `WARM_AT = 0.35`, in the
`thrifty()` gate (`performanceTier === 'low'` or `navigator.connection.saveData`),
in the `.catch(() => {})` on every speculative import, and in the decision to spend
the heavy rungs from `commit()`. What it needs:

| rung | when | what | change |
| ---: | --- | --- | --- |
| 1 | first wheel notch at the foot | `router.prefetch('/world2')` | retarget |
| 2 | `pull > 0.35` | `import('@/world2/World2Experience')` | retarget |
| **2.5** | `pull > 0.35`, behind `thrifty()` | low-priority `fetch` of `world-manifest.json`, `world.glb`, `vegetation.glb` — fire and forget, discard the response | **new; the single biggest win available** |
| 3 | `commit()` | `import('@/world2/World2Game')` | retarget |
| 4 | `commit()` | `import('@dimforge/rapier3d-compat')` | unchanged — /world2 imports the same package |

Rung 2.5 is pure network into the HTTP cache: no parse, no main-thread work, no
globals touched. `World2Game`'s own loader calls then hit cache. 13.1 MB is most of
the 3.6 seconds and nothing currently anticipates it.

**Never early, under any circumstance**: `new World2Game(...)` — its constructor
probes the device, installs an FPS governor, opens a `ResizeObserver`, binds
keyboard/pointer/gamepad listeners and reads `localStorage`, and throws outright on
an unsupported probe; and `game.init()` — which creates a **second live WebGL
context**, instantiates the rapier WASM, builds and steps the physics world,
constructs an `AudioContext` and opens a rAF loop. Also never: `map.png` (1.1 MB,
demand-loaded by the map modal) and `textures/terrain-color.png` (993 KB, **not
fetched at runtime by anything**).

### 9.3 The seam

**Fade the veil to `#dce3dc`, not to white and not to `#edf0e9`.**

`/world2`'s first painted frame is a full-bleed `#dce3dc` field — *measured*
`rgb(220, 227, 220)` — with one line of 12 px uppercase `#242b27` type dead centre.
That boot fallback is **server-rendered**: `curl http://localhost:3000/world2`
already contains `Opening World 02…`. The `#edf0e9` loading panel only exists once
the `World2Experience` chunk resolves, which on a cold cache is not the first frame.

The sequence `#dce3dc → #edf0e9` is a 5 % lift in the same hue family and reads as
light coming up as you step out of the leaves. The reverse — landing on `#edf0e9`,
dipping to `#dce3dc` for a boot frame, coming back up — is a dip, and a dip is a
flicker.

The mechanism already exists. `WorldPortal.tsx` warms the veil across the charge:

```ts
host.style.setProperty('--veil-ink',
  `color-mix(in oklab, var(--paper) ${warmth}%, var(--bg-primary))`)
```

Retarget it at `var(--world2-ground)`. That token (§2.3) must move with `.route`'s
background in `world2.module.css` — the same discipline
`src/world/core/palette.ts` already documents for `--paper`.

One blink remains: `html, body { background: var(--bg-primary) }` is `#ffffff`, and
the veil belongs to the homepage tree, which unmounts at the swap. Close it by
painting the seam colour on `<html>` at commit, before the push —
`document.documentElement.style.background = '#dce3dc'`. `<html>` is not re-created
by an App Router navigation, so the colour survives the swap and sits under
`.route`. **Clear it on the return path** (§9.5), or the homepage's overscroll
gutter is `#dce3dc` in a place nobody will think to look.

`GlobalCanvas` names its clear colour `GROUND` with the comment that it has to be
exactly the white the DOM paints behind the canvas. If the ground warms during the
last chapter — and the wash does exactly that — the wash must stay **above** the
canvas, never underneath it, or the seam shows inside the homepage before the
navigation happens. That is §2.4's whole reason for existing.

### 9.4 Transition and cleanup

Keep `router.push` on a timer sized to the veil. **`push`, not `replace`** — §9.5
depends on there being a history entry to come back to. The `<Link>` in the readout
stays as the keyboard and no-JS fallback, retargeted, `prefetch={false}` kept. Do
not `prefetch` and `push` in the same frame; the prefetch happened during the charge.

**One ordering change: unmount the WebGL canvas at `commit()`, not with the push.**
Set `canvasReady` back to `false` (or lift a `leaving` flag into `Journey`) so
`GlobalCanvas` unmounts during the 560 ms the veil is closing. It is free — the
canvas is behind an opaque sheet by then — and it is the difference between one
live WebGL context and two at the exact moment `/world2` wants all the GPU it can
get. Confirm with `getExtension('WEBGL_lose_context')` in a Playwright run that
R3F's unmount actually releases it; if it does not, `onCreated` already has the
`gl` and can dispose it explicitly.

Module-level state, which survives the route change in the same JS context — the
real leak risks:

| where | what | status |
| --- | --- | --- |
| `src/lib/ticker.ts` | one shared rAF plus a module `Set`; cancels only when the set empties | self-cancelling **only if every subscriber unsubscribes**. Homepage subscribers: every `Chapter`, `Hud`, `Cursor`, `Vegetation`, `WorldPortal`, and now the nature controller. One missed cleanup keeps a rAF loop running for the whole of /world2, competing with its own. |
| `useLenisScroll.ts` | `lenisInstance` singleton, its own rAF, a `pointermove` on `window` | correct today — cancels, removes, `destroy()`s, nulls. Must stay correct: `atFoot()` reads `getLenis()`, and a stale instance on return reads a dead scroll. |
| `state/journey.ts` | the `frame` object | never reset. Reset it at commit so a return does not start from the last frame of the old page. |
| `WorldPortal.tsx` | `portal = { pull, drag }` | reset at effect start and in cleanup. Correct. |
| `<html>` attributes | `data-reduced`, `--journey-vh`, `data-konami`, `history.scrollRestoration = 'manual'` | none reverted. The first three are harmless on /world2. `scrollRestoration` is global and sticky, which is what makes §9.5 the homepage's problem. |

Effect-scoped listeners each have a cleanup and unmount with their component; the
full inventory — about twenty entries, including the one timer with no owner
(`useEasterEggs`'s 7000 ms `setTimeout`, uncleared) — is enumerated in
`HOME_NATURE_WORLD2_HANDOFF.md` §4.

**Suspend the homepage's `AudioContext` at commit.** `useSound.ts` builds one via
`ensureContext()`; `/world2` builds its own in `init()`, and two live contexts is
one too many — on iOS the second can fail to start.

### 9.5 Back navigation

`history.scrollRestoration` is `'manual'`, with the stated reason that the browser
dropping the visitor into the middle of a pinned chapter reads as a broken page. So
`history.back()` from `/world2` currently returns them to **scroll 0**, having
discarded 26 viewport-heights of journey.

1. **Record at commit, not at unmount.** Alongside `markArrival()`, write
   `sessionStorage.setItem('journey:return', String(frame.progress))`. Use
   `frame.progress`, not `window.scrollY`, so the restore survives a resize or a
   different `--journey-vh`.
2. **Detect the return** by the key's presence, or by
   `performance.getEntriesByType('navigation')[0]?.type === 'back_forward'`.
   Consume the key either way.
3. **Restore after the document has its height, not before.** One
   `requestAnimationFrame` after the `--journey-vh` effect has run, then
   `scrollToProgress(p, { immediate: true })`. This is already solved in this
   codebase and the solution must be copied exactly — `JourneyProvider`'s deep-link
   effect carries the warning that otherwise the target progress is measured against
   a one-screen-tall page and everything lands at the bottom.
4. **Land at 0.93, short of the foot.** Three things at once: `atFoot()` is false on
   arrival, so residual inertia cannot charge anything; the gateway is on screen, so
   the visitor sees where they were and that the door is still there; and re-entry is
   a real gesture rather than a resumption. If the stored progress is below 0.93,
   restore it verbatim — that visitor did not come back from the gate.
5. **Disarm for a beat regardless.** Hold `armed = false` for ~400 ms after mount, or
   until one `wheel`/`touchstart` arrives with a timestamp after mount. A trackpad
   fling still in flight at the navigation keeps delivering events to the restored
   page.
6. **Clear the `<html>` background guard** set in §9.3.
7. **Clear `portal:arrival`.** Its 30-second TTL means a visitor who enters and comes
   straight back still has a live key, so a plain click on the readout's `<Link>`
   inside that window would skip the gate for someone who did not spend the effort.

### 9.6 Foreshadowing

`/world2` is a place **seen from above**, not seen into: near top-down over warm
sand and roads (`#f0c0a8`, `#f0c090`, `#f0a860`), moss canopies, magenta blossom
(`#903060`), a turquoise lagoon (`#78c0c0`), off-white letterforms, **frame average
`#ad9272`**. No sky, no horizon. Any foliage tuned to a cool forest green will
collide with it on arrival.

So hint with **light and a gap, not a picture**. Three things, none of which needs a
new canvas or a new asset:

1. **A warm bloom behind the foliage.** Over the last ~8 % of scroll, one large very
   low-opacity radial gradient in the island's sand tone rising from the bottom of the
   viewport behind the leaf bands — as if light is coming off a ground that is below
   and beyond the page. One element, one gradient, opacity from `frame.progress` on
   the existing ticker. It is the warm/cool contrast against the `#dce3dc` the veil is
   heading for that makes it read as *somewhere else* rather than as a glow effect.
2. **The gap, not the glow.** Where the leaf bands overlap at peak density, leave one
   deliberate opening — a slot 40–80 px wide between two overlapping fronds — and let
   the bloom show through it at higher opacity than anywhere else. A hint of ground
   through an opening is exactly the brief, and the opening is free: it is an absence
   in a layer that is already being drawn.
3. **The motes are already running.** `ContactScene` is registered for this chapter
   and already draws every entity the visitor passed as one instanced particle. Warming
   a handful toward `#f0c090`/`#78c0c0` and slowing a few to a drift over the last few
   per cent gives "distant particles" and "a small moving light" with no new system at
   all, at the cost of one more read of `frame.progress` in a `useFrame` that already
   does it.

**Do not** mount a second `<Canvas>`, render a low-poly proxy of the island, preload a
GLB in order to show a frame of it, or put `map.png` on the homepage. Whether a real
downsampled image of the island ships at all is OQ-4.

---

## 10. Debug mode

Development only — `process.env.NODE_ENV === 'development'`, so the whole component
and its styles are dead code in a production build. Toggled by `?nature-debug` on the
URL or by pressing `n` twice within 400 ms, and persisted for the session so a reload
during tuning does not lose it.

It renders one fixed overlay at `z-index: 55` — above every nature band, below the HUD,
so it never hides the thing being debugged.

**The readout**, top-left, mono nano, updated at 12 Hz and not at 60:

```
natureProgress  0.6412        band  kcl        chapterT  0.529
natureDensity   0.608         wash  0.41       tier  high   (forced)
plants  grown 38 / 62         writes/frame  71 / 90
velocity  +0.0183             lean  +0.11      pointer  -0.42, +0.18
```

`tier` prints `(forced)` whenever it has been overridden, because forgetting a forced
tier is the way a QA run lies to you.

**Per-plant annotation**, drawn on a sibling SVG at the same surface maths as the band
it annotates:

- the **placement name** (`UclMonsteraMid`, not `leaf-7`) at the plant's anchor point;
- the **anchor box** — the plant's own bounding rect — as a 1 px dashed outline,
  coloured by band: shadow grey, back `#7aa6b8`, flora teal, mid `#6a9a55`,
  front `#b8823a`, close `#b04a4a`. One glance tells you which depth something is on,
  which is the question that actually comes up;
- the **anchor origin** as a 3 px cross at the petiole base — the pivot every rotation
  uses, and the thing that is wrong when a leaf swings oddly;
- the **activation range** as a small horizontal bar under the name showing
  `[d0, d0 + ramp]` against the 0–1 density axis, with a marker at the current density.
  A plant that never grows and a plant that grew too early look completely different on
  that bar, and identical without it.

**The band strip**, bottom edge: the eight nature bands drawn to scale across the
viewport width with the current `natureProgress` marked, the seven chapter boundaries
ticked, and each band's live plant count printed in it. This is where a band boundary
firing early — the vh/px drift — becomes visible immediately.

**Exclusion geometry**, toggled with `shift`: every "must stay legible" rectangle from
the audit drawn as a translucent red fill. A plant overlapping one is the single most
common way this work goes wrong and it should be a picture, not a review comment.

The overlay costs nothing when off: the component returns `null`, subscribes to
nothing, and the per-plant annotation nodes are only created when it is first enabled.

---

## 11. The acceptance criteria

Five claims, measured rather than looked at, by
`.qa/nature-proof/compose-check.mjs`. The harness sweeps eight scroll positions at
one viewport and prints a verdict beside the readings; a run that is clean says so
in one line. Remember `?nature-tier=high` — headless Chromium reports SwiftShader,
`detectDevice()` scores that as a weak GPU, and a run that forgets measures the
low tier and reports a page with six plants on it.

| | criterion | test, at every sampled position |
| --- | --- | --- |
| **A** | the page keeps its paper | at least **75 %** of pixels still light |
| **B** | no specimen dominates the frame | median specimen width **≤ 30 %** of the viewport width, maximum **≤ 60 %** |
| **C** | nothing above the text crosses a line of it | **zero** intersections between any mid / front / close plant and any text run |
| **D** | the page is mostly empty, in one piece | total bare ground **≥ 40 %**, largest contiguous bare region **≥ 25 %** |
| **E** | the progression climbs and never dips | specimen count **non-decreasing** across the sweep |

B and E count only the plants this layer composes. The gate's own flora, which
`WorldPortal` places under section 9, is reported separately: it is deliberately
the densest and nearest thing on the page, it is full-strength on every device,
and judging the body-level arrangement by it would be measuring the wrong file.
E is the only criterion that is a property of the sweep rather than of a frame.

### 11.1 D is a restatement, and the reasoning is the point

D used to demand **two contiguous bare regions of fifteen per cent each**. That is
unachievable by design rather than by accident, and both the composition work and
an independent measurement reached the same conclusion separately.

Vegetation enters from the margins and leaves the centre clear — which is exactly
what the per-chapter audit asks for, chapter after chapter. The paper a reader is
left with is therefore topologically **one** region with arms reaching between the
plants, and it measures 57 to 86 per cent of the viewport. To split it into two
islands you would have to run a band of vegetation across the middle of the
running text, which section 2.3 forbids outright. The original criterion asked the
composition to fail one rule in order to pass another.

So D now says what the brief actually wants, which is two separate things about
the same emptiness: that **most of the page is still paper**, and that the paper
is **in a piece big enough to read as a held silence** rather than as gaps between
leaves. Forty per cent total and twenty-five per cent in one region. At 1440x900
the page measures 60 to 85 per cent total with a largest region of 42 to 83; at
390x844, 54 to 86 with a largest of 38 to 86.

### 11.2 What the harness had to learn to measure

Three corrections, all of which had been quietly wrong:

- **One row per specimen.** `Palm` and `Banana` put a `data-plant` of their own on
  the root they draw *inside* the wrapper this layer names, so every palm and
  every banana was counted, measured and averaged twice. Only the outermost
  `data-plant` is a specimen.
- **The bands move.** A footprint is computed in still viewport coordinates and
  the band is then translated every frame. `placements.ts` now pads every
  exclusion rectangle by its band's own excursion, and pads it *directionally*:
  the three scroll-parallax figures are positive and every chapter this guards is
  past the middle of the journey, so a mid, front or close band can only travel
  **down**. Padded symmetrically it lost the whole foot of the page.
- **The contact footer is anchored to the bottom.** Its rectangles are written as
  a gap from the foot in CSS pixels, the way the stylesheet writes them, rather
  than as a fraction of the viewport. See the `foot` field on `Exclusion`.
