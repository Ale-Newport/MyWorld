# SYSTEMS BRIEF — the shared systems the botanical layer must live inside

Audit date: 2026-09-20. Measured live against the running dev server at `http://localhost:3000`
(1440×900, headless Chromium). No files under `src/` were changed.

Scope: the **shared** systems only — scroll authority, journey shell, the existing vegetation
layer, layering, colour, performance, accessibility, and collisions. Per-chapter work is another
agent's.

Probe scripts written for this audit (safe to delete, not production code):

- `/Users/alejandro/Projects/Portfolio/.qa/nature-audit/_probe.mjs` — DOM order, z-index, tokens, chapter geometry
- `/Users/alejandro/Projects/Portfolio/.qa/nature-audit/_flora-stats.mjs` — per-sprig SVG node cost
- `/Users/alejandro/Projects/Portfolio/.qa/nature-audit/_fps.mjs` — scroll FPS baseline

---

## 1. The scroll authority

### 1.1 The two loops

There are **two** `requestAnimationFrame` loops, not one.

| Loop | Owner | Started by | Writes |
|---|---|---|---|
| The **driver** | `src/hooks/useLenisScroll.ts` `tick()` | `useLenisScroll(true)` from `JourneyProvider` | `frame.*`, throttled `useJourney.setScroll` |
| The **ticker** | `src/lib/ticker.ts` `loop()` | first `subscribe()` call | nothing; it only calls subscribers |

The driver *produces* `frame`; the ticker *consumes* it. Ordering between the two is registration
order in the browser's rAF queue and is **not guaranteed**. In practice the driver registers first
(`JourneyProvider` effect) and the ticker registers when the first component subscribes, so
subscribers see the current frame's values — but a nature layer must be written so that reading a
one-frame-stale `frame.progress` is harmless. Never assume freshness; never write to `frame`.

`src/lib/ticker.ts` — the whole public surface:

```ts
type TickFn = (dt: number, now: number) => void
export function subscribe(fn: TickFn): () => void   // returns the unsubscribe
export const tickerSize: () => number                // dev overlay only
```

- `dt` is **seconds**, clamped to `0.05` (a 50 ms cap; first tick is exactly `1/60`).
- `now` is the raw rAF timestamp in **milliseconds** (`performance.now()` epoch).
- The loop is refcounted: it stops when the last subscriber leaves and restarts on the next
  `subscribe`. `last` is reset on restart, so the first tick after a restart is `1/60`, not a gap.
- Subscribers are iterated from an `Array.from` snapshot, so unsubscribing inside a tick is safe.

### 1.2 (a) Global scroll progress

```ts
import { frame } from '@/state/journey'
frame.progress   // number, 0..1, read-only for consumers
```

Definition, from `useLenisScroll.ts:56-57`:

```ts
const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight)
const p = clamp(lenis.scroll / max)
```

So progress is **pixel-space**: scrolled pixels over scrollable pixels. Measured live on `/`:
`scrollHeight = 23400`, `innerHeight = 900`, scrollable `= 22500` (25 viewport heights of travel
across 26 viewport heights of document).

This is the space the brief's band map is in. **Use this, and only this, to drive the nature layer.**

### 1.3 (b) Chapter-local progress

```ts
import { useChapterFrame, readChapterProgress } from '@/hooks/useChapterProgress'
import type { ChapterId } from '@/content/types'

useChapterFrame(
  id: ChapterId,
  cb: (t: number, active: boolean, dt: number) => void,
  opts?: { lead?: number; trail?: number },   // defaults 0.06 / 0.06, in units of chapter span
): void

readChapterProgress(id: ChapterId): number    // non-reactive, clamped 0..1
```

`useChapterFrame` subscribes to the ticker, resolves the chapter's range from
`useJourney.getState().ranges` every tick, and calls back with `t` extended to
`[-lead, 1 + trail]`. Outside that window it issues exactly one settling call with
`active = false` pinned to the nearest edge, then goes silent. The callback is held in a ref and
refreshed every render, so a closure over fresh props is fine; the effect re-runs only on
`id`, `opts.lead`, `opts.trail`.

**Do not use `useChapterFrame` to place nature bands.** See 1.6.

### 1.4 (c) Scroll velocity

```ts
frame.velocity   // number, signed
```

Computed at `useLenisScroll.ts:59-61`:

```ts
const rawVel = (p - lastProgress) / (dt || 1 / 60)
smoothedVel = damp(smoothedVel, rawVel, 8, dt)   // exponential, lambda = 8
```

Units are **progress units per second**, not "px/frame" as the comment on `JourneyState.velocity`
in `src/state/journey.ts:18` claims. That comment is wrong; fix it or ignore it, do not trust it.

Practical magnitudes on the home journey (22500 px of travel):

| Gesture | px/s | `frame.velocity` |
|---|---|---|
| slow read scroll | ~400 | ~0.018 |
| normal wheel | ~1200 | ~0.053 |
| fast flick | ~3000 | ~0.133 |
| keyboard PageDown | burst | spikes then decays over ~125 ms (λ=8) |

The existing layer saturates at `clamp(frame.velocity * 6, -1, 1)` — i.e. anything past
0.167 (≈3750 px/s) is full lean. Reuse that scaling for consistency.

`useJourney((s) => s.velocity)` exists and is fed from `setScroll`, but it is throttled to
changes of `> 0.0004` in progress and **re-renders React**. Never use it in the nature layer.

### 1.5 (d) Pointer position

```ts
frame.pointerX, frame.pointerY        // -1..1, damped, lambda = 5
frame.pointerTargetX, frame.pointerTargetY  // -1..1, raw, written on pointermove
```

Written from a `pointermove` listener registered by `useLenisScroll` (`{ passive: true }`),
normalised as `x = clientX/innerWidth*2-1`, `y = -(clientY/innerHeight*2-1)` — so **+Y is up**,
WebGL convention, not DOM convention. Damping happens inside the driver's tick, so the damped
values only move while the driver loop runs.

**Dead API — do not use:** `useJourney.getState().pointer` and the `setPointer` action are
declared in `src/state/journey.ts:46,50,117` and **nothing in the tree ever calls `setPointer`**
(verified by grep; all other `setPointer*` hits are `setPointerCapture`). The store's `pointer`
is permanently `{x:0, y:0}`.

**Also dead — do not read:** `frame.chapterProgress` and `frame.chapterIndex`
(`src/state/journey.ts:169-170`) are declared and **never written by anything**. They will read
`0` forever. Either delete them in the implementation phase or leave them, but do not build on them.

### 1.6 The drift between `frame.progress` and `ranges` — READ THIS

`chapterRanges()` in `src/content/chapters.ts:200` normalises by **total vh**:

```ts
const total = totalVh(quick, list)   // home = 26
start = cursor / total
```

`frame.progress` normalises by **scrollable pixels**, which is `total - 1` viewport heights
(26 − 1 = 25), because the last viewport-height of the document is never scrolled past.

The two spaces therefore disagree by a factor of 25/26, worst in the middle of the journey:

| chapter | store `range.start` (vh-space, = cum vh / 26) | true `frame.progress` at that boundary (px-space, = cum vh / 25) | drift |
|---|---|---|---|
| prelude | 0.0000 | 0.0000 | 0 |
| about   | 0.1231 | **0.1280** | +0.49 pp |
| toolbox | 0.2538 | **0.2640** | +1.02 pp |
| universe| 0.3846 | **0.4000** | +1.54 pp |
| kcl     | 0.5231 | **0.5440** | +2.09 pp |
| ucl     | 0.7000 | **0.7280** | +2.80 pp |
| contact | 0.8615 | **0.8960** | +3.45 pp |
| end     | 1.0000 | 1.0000 | 0 |

Verified live: `_probe.mjs` reports DOM-derived starts of
`[0, 0.128, 0.264, 0.400, 0.544, 0.728, 0.896]` — exactly the brief's map, to three decimals.

Consequences for the implementer:

1. **The brief's band map is px-space.** Hard-code it as a constant table keyed on
   `frame.progress`. Do not re-derive it from `chapterRanges()`.
2. 3.45 pp of the home journey is **0.86 viewport-heights of scroll** — nearly a full screen. A
   band boundary placed with `useChapterFrame` would fire almost a screen early at the contact
   chapter. That is the difference between "the transition never announces itself" and "the palms
   arrive before the chapter does".
3. `quickView` (`?quick` / `#quick`) changes every chapter's vh and therefore every boundary. The
   nature band table must be **derived at runtime from the same vh data**, not literally typed:

```ts
// canonical px-space boundary for the chapter at index i
import { journeys, totalVh } from '@/content/chapters'
function bandBoundaries(quick: boolean) {
  const list = journeys.home.chapters
  const travel = totalVh(quick, list) - 1        // 25 at full length
  let cum = 0
  return list.map((c) => {
    const start = cum / travel
    cum += quick ? c.quickVh : c.vh
    return start
  })
}
```

   At full length this yields exactly `[0, 0.128, 0.264, 0.400, 0.544, 0.728, 0.896]`.

4. If a nature element genuinely must be chapter-local (it sits inside a pinned stage and moves
   with that stage), `useChapterFrame` is still the right tool — the drift is irrelevant there
   because the same wrong-but-consistent number drives both the chapter and the plant.

### 1.7 Programmatic scroll

```ts
import { getLenis, scrollToProgress } from '@/hooks/useLenisScroll'
getLenis(): Lenis | null
scrollToProgress(p: number, opts?: { immediate?: boolean; duration?: number }): void
```

`scrollToProgress` measures against `document.documentElement.scrollHeight - innerHeight`, i.e.
the same px-space as `frame.progress`. Consistent. The nature layer should not need either.

### 1.8 The contract in one block

```ts
import { frame } from '@/state/journey'
import { subscribe } from '@/lib/ticker'

useEffect(() => {
  const nodes = /* collect element handles ONCE, here */
  return subscribe((dt, now) => {
    const p = frame.progress         // 0..1, px-space
    const v = frame.velocity         // progress/second, smoothed lambda 8
    const px = frame.pointerX        // -1..1, damped lambda 5
    const py = frame.pointerY        // -1..1, +Y up
    // ... write straight to nodes[i].style / setAttribute. Never read back.
  })
}, [/* deps that change the node set */])
```

Rules, all of which the existing layer already obeys and the new one must:
never call `getBoundingClientRect`, `getComputedStyle`, `getTotalLength` or any other layout read
inside a tick; never `setState` inside a tick; collect node handles once in the effect, not per
tick; keep a per-node "last written value" cache and skip the DOM write when it has not changed.

---

## 2. The journey shell

### 2.1 Sizing and pinning

`src/components/journey/Chapter.tsx`:

```tsx
<section id={`chapter-${id}`} data-chapter={id} tabIndex={-1}
         className={styles.chapter} style={{ height: `${vh * 100}vh` }}>
  {noPin ? children : <div className={styles.stage}>{children}</div>}
  {flow}
</section>
```

`src/components/journey/Chapter.module.css` — the whole file:

```css
.chapter { position: relative; width: 100%; }
.stage   { position: sticky; top: 0; height: 100svh; width: 100%;
           overflow: clip; display: flex; align-items: center; justify-content: center; }
```

- Scroll length comes from `vh` (or `quickVh`) in `src/content/chapters.ts` and from nowhere else.
- The stage is `position: sticky`, so it pins for `(vh − 1)` viewport-heights, then scrolls away.
- **`overflow: clip` on the stage**: anything a chapter draws is clipped to one viewport. A leaf
  that must overhang a chapter boundary cannot live inside a chapter stage.
- `height: 100svh` (small viewport height) vs the fixed nature layer's `100%` of the initial
  containing block — on mobile these differ by the address-bar height. Expect a few points of
  disagreement between a chapter's bottom edge and a fixed layer's bottom edge on iOS Safari.

Measured live geometry on `/` at 900 px viewport:

| chapter | vh | height px | top px | px-space start |
|---|---|---|---|---|
| prelude | 3.2 | 2880 | 0 | 0.000 |
| about | 3.4 | 3060 | 2880 | 0.128 |
| toolbox | 3.4 | 3060 | 5940 | 0.264 |
| universe | 3.6 | 3240 | 9000 | 0.400 |
| kcl | 4.6 | 4140 | 12240 | 0.544 |
| ucl | 4.2 | 3780 | 16380 | 0.728 |
| contact | 3.6 | 3240 | 20160 | 0.896 |

`document.documentElement.style.--journey-vh = 26` is written by `JourneyProvider`
(`JourneyProvider.tsx:135`). It is available in CSS if a layer wants to reason about document
length, but nothing currently consumes it in a way the nature layer can lean on.

### 2.2 Where a new full-viewport layer mounts

`src/components/journey/Journey.tsx:111-134` is the mount point. Live DOM order of
`document.body`'s element children, with computed position/z-index (from `_probe.mjs`):

| # | element | position | z-index | source |
|---|---|---|---|---|
| 1 | `div` (Next dev shell) | static | auto | — |
| 2 | `div.StaticProfile…host` | absolute | auto (300 on `:focus-within`) | `src/app/page.tsx` |
| 3 | `a.skip-link` | fixed | 200 | `Journey.tsx:117` |
| 4 | `div.GlobalCanvas…canvasHost` | fixed | **1** | `Journey.tsx:119` |
| 5 | `div.Cursor…host` | fixed | **100** | `Journey.tsx:120` |
| 6 | `div.vegetation…host` | fixed | **4** | `Journey.tsx:121` |
| 7 | `main#journey.journey` | **relative** | **10** | `Journey.tsx:123` |
| 8 | `div.Hud…hud` | fixed | 60 | `Journey.tsx:130` |
| 9 | `div.IndexOverlay…overlay` | fixed | 80 | `Journey.tsx:131` |
| 10 | `div.ProjectOverlay…overlay` | fixed | 85 | `Journey.tsx:132` |

**The load-bearing fact**: `globals.css:177-181` gives `main.journey`
`position: relative; z-index: var(--z-content)` — i.e. **it creates a stacking context at z 10**.
Nothing rendered inside any chapter can ever paint above z 10 relative to the body-level layers,
whatever z-index it gives itself. Therefore:

- **Background bands** mount as siblings **before** `<main>` (where `<Vegetation />` already is).
- **Midground / foreground / extreme-foreground bands** mount as siblings **after** `</main>` and
  **before** `<Hud>`, with z-indices between 11 and 59.

Concretely, in `Journey.tsx`:

```tsx
{canvasReady && <GlobalCanvas />}          {/* z 1  */}
<Cursor />                                  {/* z 100 */}
<NatureBackdrop />                          {/* NEW: z 0, 2, 4 — wash, shadow, background */}
<main id="journey" className="journey"> … </main>   {/* z 10, stacking context */}
<NatureForeground />                        {/* NEW: z 12, 20, 40 */}
<Hud … />                                   {/* z 60 */}
```

Between a background layer and the content there is: nothing but the WebGL canvas (z 1) and the
existing flora host (z 4). Between a foreground layer and the content there is: nothing.

Both new hosts must carry `pointer-events: none`, `aria-hidden="true"`, and
`contain: layout paint` (as `vegetation.module.css` already does on `.host`).

### 2.3 Lazy chapters do not matter to the nature layer

`Journey.tsx:56-79`: every chapter is a `next/dynamic` chunk, but each has a `loading` placeholder
built by `reserve(id)` that renders `<Chapter id={id} noPin>{null}</Chapter>` — **the same section,
the same `vh`, the same height, the same `id` anchor**. Document height and therefore the entire
px-space band map are stable from first paint regardless of chunk arrival. The nature layer never
has to wait for a chapter and must never key off a chapter component being mounted.

### 2.4 Other shell facts

- `html, body { overflow-x: clip }` (`globals.css:17`). A fixed `inset: 0` layer cannot create
  horizontal scroll, but a plant that overhangs must be clipped by the SVG surface, not by letting
  the element grow.
- `history.scrollRestoration = 'manual'`; deep links are resolved by `JourneyProvider.tsx:148-158`
  via `scrollToProgress(r.start + 0.0015, { immediate: true })` — note that **this uses the
  vh-space `r.start`** and therefore lands slightly early (see 1.6). Pre-existing; out of scope,
  but a deep-linked visitor arrives with `frame.progress` a little short of the chapter, and the
  nature state must not look wrong there. Give every band a ramp, never a step.
- `JourneyProvider` is also where `detectDevice()` is first called and where
  `html[data-reduced]` is set.
- `<Journey>` is rendered by **both** `/` and `/projects` (`src/app/page.tsx`,
  `src/app/projects/page.tsx`). Anything added to `Journey.tsx` unconditionally appears on
  `/projects` too. Gate on `journey === 'home'` or on `useJourneyRoute().id === 'home'`.

---

## 3. The existing vegetation layer

Files: `src/components/vegetation/flora.ts` (252 lines),
`src/components/vegetation/Vegetation.tsx` (536 lines),
`src/components/vegetation/vegetation.module.css` (107 lines).

### 3.1 `flora.ts` — the generator

```ts
export type FloraKind = 'fern' | 'frond' | 'grass' | 'sprout' | 'tendril' | 'seedhead'
export interface FloraSprig { kind: FloraKind; paths: string[]; dots: {x,y,r}[]; mass: number }

export function mulberry32(seed: number): () => number
export function sprig(kind: FloraKind, seed: number): FloraSprig
export function pickKind(rand: () => number): FloraKind
export const floraKinds: FloraKind[]
```

Contract: every sprig is drawn on a **0–100 box anchored at (50, 100), growing upward**, as **open
stroke paths ordered base → tip**, so a single inherited `stroke-dashoffset` from 1 to 0 draws the
whole plant on when every `<path>` carries `pathLength={1}`. No `getTotalLength()`, no layout read.

Weights (`flora.ts:240-243`): `sprout .26, grass .24, seedhead .17, tendril .15, frond .11, fern .07`.

Measured cost per kind (400 seeds each, `_flora-stats.mjs`):

| kind | avg `<path>` | avg dots | avg `d` chars |
|---|---|---|---|
| fern | 13.87 | 0 | 484 |
| frond | 12.06 | 0 | 411 |
| grass | 5.51 | 0 | 168 |
| sprout | 5.00 | 0 | 169 |
| tendril | 2.00 | 0 | 348 |
| seedhead | 9.39 | 8.39 | 228 |

Weighted average leaf nodes per sprig: **8.24**. Plus 3 `<g>` wrappers per plant (placement /
sway+scale / the `translate(-50 -100)` origin shift) and 1 more `<g>` for seedhead dots:
**≈11.4 DOM nodes per sprig**.

### 3.2 `Vegetation.tsx` — the placement and growth model

**Arrangement (`arrange(w, h, count)`, lines 129-227).** Four zones, one shared seed
`SEED = 0x5eed17`, RNG seeded `mulberry32(SEED + count * 7919)`.

| zone | share of count | placement | rotation | scale | opacity |
|---|---|---|---|---|---|
| `bottom` | `count − 2·perSide − crowns` | stratified x across full width, `y = h + rand(1..9)` | ±9° | `h·rand(.105..0.2)/100`, ×`(1 − 0.42·middle)` | `rand(.55..1)·(1 − 0.5·middle)` |
| `left`/`right` | `round(count·0.19)` each (`0.1` under 720 px) | inside a band `clamp(w·0.1, 46, 150)` | 66–92°, mirrored | `band·rand(.62..1.02)/100` | `rand(.4..0.85)` |
| `crown` | `round(count·0.1)`, 0 under 720 px | `x` in the outer 20 % each side, `y = rand(−4..2)` | 152–196°, mirrored | `h·rand(.06..0.1)/100` | `rand(.3..0.6)` |

The whole geometry trick: `flora.ts` always draws upward, and the placement rotation θ decides what
upward means — growth direction is `(sin θ, −cos θ)`. Side and crown plants need no separate art.
`middle = 1 − min(1, |x/w − 0.5| / 0.3)` keeps the centre 60 % of the bottom edge short and pale so
running text stays legible. Crown zone draws only from `HANGING = ['tendril','grass','sprout']`.

**Growth thresholds (lines 220-226).** Each draft gets
`order = mass·0.62 + ZONE_LATENESS[zone] + rand()·0.42` with
`ZONE_LATENESS = { bottom: 0, left: .28, right: .28, crown: .55 }`. Drafts are sorted by `order`,
then rank-mapped onto a threshold:

```ts
t0 = FIRST_AT + FILL_SPAN * Math.pow((rank + 0.5) / n, 1 / FILL_POWER)
// FIRST_AT = 0.02, FILL_SPAN = 0.9, FILL_POWER = 1.9
```

i.e. `count(p) ≈ N·p^1.9` — the early page is nearly bare, the last third does most of the filling.
Each plant additionally gets `ramp = rand(RAMP_MIN=0.05 .. RAMP_MAX=0.1)` of progress to finish.
Growth is `g = clamp((frame.progress − t0) / ramp)`, fully **reversible** — scrolling up retracts.

**Per-tick writes (lines 401-448).** Per plant, at most: `node.style.strokeDashoffset`,
`node.style.opacity`, the seed group's opacity, and `stem.setAttribute('transform',
rotate(a) scale(k))`. Guards: `grown[i]` skips writes under 0.001 change; `wroteAngle`/`wroteScale`
are integer-quantised caches (angle ×100, scale ×1e4); `g === 0` skips the transform entirely.
Nothing is ever read back from the DOM.

**Sway budget.**
- `swaying = tier === 'high'` only. Medium and low grow but never breathe.
- Idle cadence `SWAY_IDLE_MS = 1000/12`: with no scroll movement the sway updates 12×/s, not 60.
- `document.hidden` → unsubscribe from the ticker entirely; resubscribe on visibility.
- One shared `lean = clamp(frame.velocity * 6, ±1) * 1.4` degrees for the whole layer.

**Tier budgets.**

```ts
const COUNT       = { high: 30, medium: 16, low: 7 }   // animated
const STILL_COUNT = { high: 12, medium: 10, low: 6 }   // reduced motion
```

Current totals: **≈342 / 183 / 80 DOM nodes.** Live check on `/` in headless Chromium (which
detects `low` because of SwiftShader): 7 `g[data-flora]`, 41 `<path>`, 22 `<g>`, 7 `<circle>`,
70 SVG elements total. Matches.

**Surface maths (lines 288-296, the part worth stealing verbatim).** One `<svg>` whose `width`,
`height` and `viewBox` are all written in **CSS pixels from the live viewport**, so one user unit
is one CSS pixel. Drift between the planted viewport and the live one is absorbed by the viewBox
**origin**, not by rescaling:

```ts
svg.setAttribute('width', String(w))
svg.setAttribute('height', String(h))
svg.setAttribute('viewBox', `${(planted.w - w) / 2} ${planted.h - h} ${w} ${h}`)
```

This is `xMidYMax` alignment at a *fixed* scale — the ground line stays welded to the bottom edge
and the arrangement stays centred, at any viewport, without replanting. `viewport()` reads
`document.documentElement.clientWidth/Height`, **not** `window.innerWidth`, because a classic
scrollbar would otherwise cost the right gutter.

**Resize hysteresis (lines 304-332).** The surface follows every resize event; a *replant* only
happens when `|Δw| ≥ 24` or `|Δh| ≥ 140`. That 140 is the mobile address-bar allowance.

### 3.3 Keep / change / replace

**Keep as-is (do not rewrite):**

- `flora.ts`'s six sprig builders and `mulberry32`. They are the brief's *early-journey* plants.
- The `pathLength={1}` + inherited `stroke-dasharray: 1 1` / `stroke-dashoffset: 1..0` reveal for
  **stroke-only** art.
- The `stroke-width: calc(var(--flora-hair) / var(--sprig-scale))` trick and the reasoning in
  `vegetation.module.css:61-80` about why `vector-effect: non-scaling-stroke` cannot be used
  (it unscales the dash pattern and destroys `pathLength="1"`).
- The nested-group transform convention: placement on the outer `<g>` as a **transform attribute**,
  sway+scale on the inner `<g>` attribute, `translate(-50 -100)` on the innermost. Attributes, not
  CSS transforms, because a CSS transform on a nested SVG group depends on `transform-box` against
  a viewBox the group did not establish.
- `syncSurface()` and the resize hysteresis, verbatim.
- The visibility-change unsubscribe and the write-caching guards.
- Reversible growth (`g` is a pure function of `frame.progress`, no one-way state).

**Reusable with changes:**

- **`arrange()`** — the stratification, the `middle` text-safety falloff and the
  `(sin θ, −cos θ)` rotation identity all survive; the four-zone margin model does not. Replace
  `Zone` with a **depth band** (see 4.2) plus an **anchor edge**. A palm frond that enters from the
  top-right corner at 40 % of the viewport width is not a "crown" plant.
- **The threshold model.** `t0 = f(global rank)` is one monotone sequence across the whole journey.
  The brief needs **per-band windows**: each species has a `[enter, full]` pair inside its band, and
  bands overlap by ~4 pp so nothing announces itself. Keep the `p^1.9` shaping *within* a band; drop
  the single global rank.
- **`COUNT` keyed on tier.** The problem is `mulberry32(SEED + count * 7919)`: the tier is part of
  the seed, so an FPS downgrade mid-scroll **reshuffles the entire garden**. Fix by generating the
  full high-tier arrangement once from `SEED` alone, sorting by importance, and rendering
  `slice(0, budget[tier])`. A downgrade then *removes* plants instead of replacing them.
- **`far` / `--flora-ink-far`** — a two-step depth model superseded by the six-band scheme. Keep the
  token, remap it onto the new band tokens.

**Must be replaced:**

1. **The reveal mechanism for filled art.** `stroke-dashoffset` reveals *strokes*. The brief's
   hyper-detailed leaves are **filled** shapes with gradients, edge irregularity and tears — a dash
   cannot reveal a fill. Options, in order of preference:
   - **Clip-path wipe**: one `<clipPath clipPathUnits="objectBoundingBox">` per band holding a
     `<rect>` whose `height`/`y` is written per frame; the leaf unfurls from its base. One attribute
     write per plant, no filter, compositor-friendly.
   - **Scale-from-base + opacity** on the existing inner `<g>` (`scale(1, k)` about the base). Cheapest;
     reads as growth rather than unfurling. Good for the mid/background bands where detail is low.
   - Keep the dash for the **veins and midribs drawn as strokes on top of the fill** — this is what
     actually sells "hyper-detailed": fill appears by clip wipe, veins draw on by dash, slightly behind.
2. **One surface.** A single `<svg>` cannot be both behind and in front of `main.journey`. The layer
   becomes **three hosts** (backdrop, midground, foreground), each with its own `<svg>` running the
   same `syncSurface()` maths, all driven by **one** ticker subscription in a shared controller.
   Three hosts, one `subscribe()` — not three subscriptions.
3. **`ZONE_LATENESS` / `HANGING`.** Band-specific species tables replace both.
4. **The per-plant sway loop as the only motion.** Parallax must be **one transform per band**
   (`translate3d(0, ±p·k, 0)` on the band's root `<g>`), not per plant. Per-plant motion stays
   capped at the existing sway budget and stays `high` tier only.

---

## 4. Layering

### 4.1 What exists today

`src/styles/tokens.css:124-133` — verbatim, and verified live:

```css
--z-canvas:   1;
--z-flora:    4;
--z-content:  10;
--z-hud:      60;
--z-overlay:  80;
--z-cursor:   100;
```

Consumers found by grep:

| z | element | file |
|---|---|---|
| `--z-canvas` (1) | `.canvasHost` | `src/experience/canvas/GlobalCanvas.module.css:4` |
| `--z-flora` (4) | `.host` | `src/components/vegetation/vegetation.module.css:31` |
| `--z-content` (10) | `main.journey` | `src/styles/globals.css:179` |
| `--z-hud` (60) | `.hud` | `src/components/navigation/Hud.module.css:4` |
| `--z-overlay` (80) | `.overlay` | `src/components/navigation/IndexOverlay.module.css:4` |
| `calc(--z-overlay + 5)` (85) | `.overlay` | `src/components/ui/ProjectOverlay.module.css:4` |
| `--z-cursor` (100) | `.host` | `src/components/ui/Cursor.module.css:4` |
| literal 200 | `.skip-link` | `src/styles/globals.css:143` |
| literal 300 | `.StaticProfile .host:focus-within` | `StaticProfile.module.css` |
| literal 1 | `.WorldPortal .host[data-phase]` | `WorldPortal.module.css:27` — **inside the contact stage** |

Free bands: **0 and below**, **2–3**, **5–9**, **11–59**, **61–79**, **86–99**.

### 4.2 Proposed scheme — additive only, nothing renumbered

Append to the `/* ---- Layering ---- */` block in `src/styles/tokens.css`:

```css
  /* ---- Nature bands --------------------------------------
     Six depth bands threaded through the layering that already
     exists. Nothing above is renumbered: the canvas keeps 1, the
     existing flora keeps 4, the content keeps 10, the HUD keeps 60.
     The three bands above the content are siblings of <main>, not
     children of it: main.journey is a stacking context at z 10 and
     nothing inside a chapter can paint above it. */
  --z-nature-wash:    0;   /* the warming ground wash — see §5.4 */
  --z-nature-shadow:  2;   /* background shadow: soft, blurred, no detail */
  --z-nature-back:    3;   /* background plants: far, pale, low detail   */
  /* --z-flora (4) is unchanged and becomes the NEAR-background band:
     the existing sprigs keep their exact place in the stack.      */
  --z-nature-mid:    12;   /* midground: overlaps content edges          */
  --z-nature-front:  20;   /* foreground: crosses content freely         */
  --z-nature-close:  40;   /* extreme foreground: huge, soft, cropped    */
```

Resulting stack, bottom to top:

| z | band | what draws there | DOM sibling position |
|---|---|---|---|
| 0 | wash | the ground warming (§5.4) | **not usable** — see below |
| 1 | `--z-canvas` | **the WebGL canvas** (`alpha: false`, opaque) | before `<main>` |
| 2 | shadow | blurred silhouettes, 4–8 % ink, no veins | before `<main>` |
| 3 | back | far plants, flat fill, no gradients | before `<main>` |
| 4 | `--z-flora` | the existing sprig layer, unchanged | before `<main>` |
| 10 | `--z-content` | `main.journey` — stacking context | — |
| 12 | mid | plants that overlap content edges but never cross a headline | after `</main>` |
| 20 | front | plants that cross content; the layer that says "overtaken" | after `</main>` |
| 40 | close | one or two enormous, soft, cropped leaves at the very end | after `</main>` |
| 60 | `--z-hud` | HUD stays on top of all nature | — |
| 80/85 | overlays | — | — |
| 100 | cursor | — | — |

**Where the WebGL canvas sits: at z 1, and it should stay there.** Two facts force it:

- `GlobalCanvas.tsx:46` sets `gl: { alpha: false }` and `gl.setClearColor(GROUND, 1)` with
  `GROUND = new THREE.Color('#ffffff')`. The canvas is **opaque and full-viewport**. Anything at
  z 0 is invisible, permanently. `--z-nature-wash: 0` is therefore reserved/documented but the
  actual wash must be implemented at **z 3.5** — practically, as a `::before` on the `--z-nature-back`
  host, or as its own host at a value between 3 and 4. Use `--z-nature-wash: 3` and put the back
  plants at `3` too, ordering them by DOM order within the same z (wash first).
- The canvas is `pointer-events: none` and `aria-hidden`, so it cannot steal interaction from
  anything above it.

Editorially this is also the right answer: the WebGL scene is the *content's* backdrop, and the
plants frame the whole composition including that scene. Nature in front of the canvas is what
makes the canvas feel like something being grown over.

**Two hard constraints an implementer will otherwise trip over:**

1. `main.journey` is a stacking context at z 10. A plant rendered *inside a chapter* can never
   appear in the mid/front/close bands, and is additionally clipped by `.stage { overflow: clip }`.
   Large overhanging plants **must** live in the body-level hosts.
2. The `WorldPortal` veil is at z 1 **inside** the contact stage, i.e. inside the z-10 context. It
   therefore paints **below** every band at z ≥ 12. When the portal charges and the veil climbs, the
   mid/front/close plants would sit on top of it — the exact opposite of "the page is being covered".
   Fix **without touching `WorldPortal.tsx`**: the foreground controller subscribes to the already-
   exported module state

   ```ts
   import { portal } from '@/components/journey/WorldPortal'  // { pull: 0, drag: 0 }
   ```

   and, for `portal.pull > 0`, drives the front bands with the veil — translate them up with
   `REST_PCT/TRAVEL_PCT` semantics and fade them out over the last 20 % of the charge, or hand them
   to the veil as the hedge's upper storey. Reading `portal.pull` from the shared ticker costs one
   property read per frame and requires no change to the portal.

**Filter warning.** A CSS `filter` (including `blur()`) on an element creates a containing block
for `position: fixed` descendants **and** a stacking context. Apply blur only to leaf `<g>`s or to
a host that contains no fixed descendants, never to a wrapper the fixed hosts live inside.

---

## 5. Colour

### 5.1 What exists today — `src/styles/tokens.css` in full (values verbatim)

**Reference palette** (mirrored by `src/world/core/palette.ts`; moving these moves `/world`):

```
--paper   #f4f2ee   --paper-2 #eceae5   --paper-3 #e2dfd8
--void    #0a0a0b   --void-2  #111113   --void-3  #1a1a1d
```

**Ink:** `--ink #0c0c0d`, `--ink-2 #3a3a3e`, `--ink-3 #75757c`, `--ink-4 #a6a6ad`
**Chalk (on dark):** `--chalk #f2f1ee`, `--chalk-2 #b8b7b3`, `--chalk-3 #7c7b79`, `--chalk-4 #4a4a4c`

**Accent / signal:**

```
--accent      #d4491f   /* burnt vermilion */
--accent-soft #e8734d
--accent-deep #a13415
--signal      #2f6f5e   /* muted teal, secondary */
```

**Flora (added last pass), all derived from `--signal`:**

```
--flora-ink      color-mix(in oklab, var(--signal) 30%, transparent)
--flora-ink-far  color-mix(in oklab, var(--signal) 16%, transparent)
--flora-seed     color-mix(in oklab, var(--signal) 52%, transparent)
--flora-ink-near color-mix(in oklab, var(--signal) 62%, transparent)   /* the portal hedge */
--flora-hair     0.9px
```

**Surfaces — literals, deliberately not aliases:**

```
--bg-primary   #ffffff        --bg-secondary #fafafa     --bg-tertiary #f2f2f3
--text-primary var(--ink)     --text-secondary var(--ink-2)
--text-muted   var(--ink-3)   --text-faint var(--ink-4)
--border        color-mix(in oklab, var(--ink) 14%, transparent)
--border-strong color-mix(in oklab, var(--ink) 30%, transparent)
--overlay       color-mix(in oklab, var(--bg-primary) 82%, transparent)
```

`color-scheme: light`. There is no dark theme and no `[data-theme]` block any more.

### 5.2 The problem with the current flora palette at scale

Every flora token is `color-mix(… , transparent)`. At 30 sprigs in the margins that is correct and
invisible. At 200+ overlapping leaves it is not: **transparency composites multiplicatively**, so
three overlapping leaves at 30 % alpha read as 66 % ink and the page goes grey-green exactly where
the brief demands it stay light. The new tokens must mix toward **the paper**, not toward
transparency, for anything that can overlap itself.

### 5.3 Proposed additional tokens

Append a `/* ---- Nature ---- */` block. `--signal` stays exactly as it is and remains the colour
of the existing sprigs and the portal hedge.

```css
  /* ---- Nature ---------------------------------------------
     Six greens and two browns, chosen so that no two adjacent
     bands differ only in lightness. Deliberately desaturated:
     the saturation ceiling here is about half that of emerald,
     because a saturated green next to --accent (#d4491f) is a
     complementary clash and next to --signal is a muddle. */
  --nature-deep:   #22392e;  /* near-black forest — silhouettes only */
  --nature-forest: #34513f;  /* deep green — far plants              */
  --nature-palm:   #47654a;  /* palm green — the workhorse           */
  --nature-olive:  #6a6f47;  /* olive — the contrast against palm    */
  --nature-fresh:  #7d9a58;  /* fresh green — new growth, highlights */
  --nature-lime:   #a2b06a;  /* muted yellow-green — edge lights     */
  --nature-stem:   #6b5942;  /* brown stem                           */
  --nature-stem-2: #8d7659;  /* lighter stem / dry tip               */

  /* Working fills. Mixed toward the PAGE, not toward transparent,
     so overlapping leaves do not accumulate into grey. Only the
     veins and the shadow band are allowed to be transparent. */
  --leaf-far:    color-mix(in oklab, var(--nature-forest) 12%, var(--bg-primary));
  --leaf-back:   color-mix(in oklab, var(--nature-palm)   20%, var(--bg-primary));
  --leaf-mid:    color-mix(in oklab, var(--nature-palm)   34%, var(--bg-primary));
  --leaf-front:  color-mix(in oklab, var(--nature-forest) 48%, var(--bg-primary));
  --leaf-close:  color-mix(in oklab, var(--nature-deep)   62%, var(--bg-primary));

  /* Gradient stops. Every large leaf is a two-stop linear gradient
     from base to tip along its own midrib — that, plus the veins,
     is most of what separates "hyper-detailed" from "icon". */
  --leaf-grad-a: color-mix(in oklab, var(--nature-olive) 26%, var(--bg-primary));
  --leaf-grad-b: color-mix(in oklab, var(--nature-forest) 40%, var(--bg-primary));
  --leaf-lit:    color-mix(in oklab, var(--nature-lime)  30%, var(--bg-primary));

  /* Line work. These stay transparent: they are drawn ON the fill
     and must darken whatever they cross. */
  --leaf-vein:     color-mix(in oklab, var(--nature-deep) 26%, transparent);
  --leaf-vein-2:   color-mix(in oklab, var(--nature-deep) 14%, transparent);
  --leaf-edge:     color-mix(in oklab, var(--nature-deep) 32%, transparent);
  --leaf-stem:     var(--nature-stem);
  --leaf-shadow:   color-mix(in oklab, var(--nature-deep) 7%, transparent);
  --leaf-hair:     0.7px;   /* secondary/tertiary veins, thinner than --flora-hair */
```

Band → token mapping:

| band | fill | line work | gradient |
|---|---|---|---|
| shadow (z 2) | `--leaf-shadow` | none | none |
| back (z 3) | `--leaf-far` | `--leaf-vein-2` on midrib only | none |
| `--z-flora` (4) | existing sprigs, `--flora-ink` / `--flora-ink-far` | unchanged | none |
| mid (z 12) | `--leaf-back` → `--leaf-mid` | `--leaf-vein` midrib + secondaries | `--leaf-grad-a/b` |
| front (z 20) | `--leaf-front` | full: midrib, secondary, tertiary, `--leaf-edge` | full |
| close (z 40) | `--leaf-close` | edge only (it is cropped and soft) | `--leaf-grad-b` + `--leaf-lit` |

Contrast check: `--leaf-front` against `#ffffff` is roughly L\* 62 — plants are clearly visible but
`--text-primary` (`#0c0c0d`, L\* ≈ 4) still clears 4.5:1 by an enormous margin wherever it sits on
a leaf. `--leaf-close` at L\* ≈ 48 is the darkest thing the nature layer may produce and body text
on it still passes. **No nature fill may go below L\* 45.**

### 5.4 Warming the ground without going dark

The constraint that decides the implementation: **`GlobalCanvas.tsx:19` hard-codes
`const GROUND = new THREE.Color('#ffffff')` to match `--bg-primary`, and the canvas is opaque
(`alpha: false`) across the whole viewport at z 1.** If `--bg-primary` warms and the clear colour
does not, a seam appears wherever the canvas ends. If both warm, `/world`'s palette mirror and
every literal `#ffffff` in the tree have to be chased.

**Therefore: do not touch `--bg-primary`, and do not warm `html`/`body`.** Warm with a wash element
that sits *above* the canvas.

```css
.wash {
  position: fixed; inset: 0;
  z-index: var(--z-nature-wash);      /* = 3, DOM-ordered before the back band */
  pointer-events: none;
  background: var(--ground-warm);
  opacity: 0;                          /* written by the ticker */
  will-change: opacity;
  contain: strict;
}
```

```css
  --ground-warm: #f6efe1;   /* the single warm tone; only its ALPHA is animated */
```

One property write per frame (`wash.style.opacity`), quantised to 1/200 so it writes roughly 30
times across the whole journey rather than 1500.

Ramp, keyed on `frame.progress` in the brief's bands, with the resulting apparent page colour:

| band | progress | wash opacity | apparent ground | approx L\* |
|---|---|---|---|---|
| clean digital | 0.00 – 0.12 | 0.00 | `#ffffff` | 100 |
| first signs | 0.12 – 0.26 | 0.06 | `#fefcf9` | 99.3 |
| nature enters | 0.26 – 0.40 | 0.14 | `#fdf9f3` | 98.4 |
| interacts | 0.40 – 0.55 | 0.24 | `#fbf6ec` | 97.3 |
| dense framing | 0.55 – 0.73 | 0.36 | `#faf3e6` | 96.1 |
| merge | 0.73 – 0.86 | 0.48 | `#f9f0e0` | 95.0 |
| full immersion | 0.86 – 0.96 | 0.58 | `#f8eeda` | 94.0 |
| gateway | 0.96 – 1.00 | 0.62 | `#f8edd8` | 93.6 |

Interpolate with `easeInOutCubic` between band anchors; never step. The floor is **L\* 93** — the
page is warmer than `--paper` (`#f4f2ee`, L\* ≈ 95) at its deepest and still unmistakably light.
The brief's "must not become a dark jungle" is satisfied by construction: the darkest surface the
visitor ever sees is a cream, and only the *plants* get darker with depth.

A second, optional token for the very last band — a barely-there vignette that pulls the corners in
without darkening the centre, which is what makes "partially overtaken" read as depth rather than
as dimming:

```css
  --ground-vignette: radial-gradient(120% 100% at 50% 40%,
      transparent 52%,
      color-mix(in oklab, var(--nature-olive) 9%, transparent) 100%);
```

Apply it on the same wash element as a second background layer, faded in only above `p > 0.86`.

---

## 6. Performance

### 6.1 `src/lib/perf.ts` — what it actually does

```ts
export interface DeviceProfile {
  tier: 'low'|'medium'|'high'; isMobile: boolean; isTouch: boolean
  dpr: number; density: number; shadows: boolean; postProcessing: boolean; physics: boolean
}
export function detectDevice(): DeviceProfile        // cached module singleton, first call wins
export function scaled(count: number, floor = 8): number
export function createFpsWatchdog(onDowngrade: () => void): { tick(): void; stop(): void }
```

Tiering (`perf.ts:47-49`):

```ts
let tier = 'high'
if (isMobile || cores <= 4 || memory <= 4 || maxTexture < 4096 || weakGpu) tier = 'medium'
if ((isMobile && (cores <= 4 || memory <= 3)) || cores <= 2 || memory <= 2 || weakGpu) tier = 'low'
```

`isMobile = width < 768 || (isTouch && width < 1024)`. `weakGpu` matches
`/swiftshader|llvmpipe|software|angle \(intel\)? ?hd/i` — which is why **headless Chromium always
reports `low`**, and why any Playwright measurement of this layer is a *low-tier* measurement
unless the tier is forced.

`density`: `low 0.28`, `medium 0.55`, `high 1`. `scaled(n, floor)` multiplies by density with a floor.
`detectDevice()` is called from `JourneyProvider.tsx:111` and `GlobalCanvas.tsx:35`; the cache means
the first caller's environment wins for the session.

`createFpsWatchdog`: 2-second windows; two consecutive windows under **32 fps** fire `onDowngrade`
once and then deactivate permanently. It is wired in exactly one place —
`GlobalCanvas.tsx:21-32`, inside a `useFrame`, calling `setPerformanceTier('low')` and
`gl.setPixelRatio(1)`.

**Two consequences the nature layer must respect:**

1. The watchdog only runs while the R3F canvas is mounted and rendering. `GlobalCanvas` is deferred
   behind `requestIdleCallback` (`Journey.tsx:91-96`) and unmounts on WebGL context loss
   (`GlobalCanvas.tsx:70-73`), and `frameloop` is `'demand'` under reduced motion. **Do not add a
   second watchdog** — two independent downgraders fighting is worse than one that sometimes sleeps.
   Subscribe to `useJourney((s) => s.performanceTier)` and react to the downgrade the governor
   publishes.
2. A downgrade is a **React re-render** of `Vegetation` (tier is a store selector). Today that
   re-seeds `arrange()` because `count` is in the seed and replants the whole garden mid-scroll.
   The new layer must generate one arrangement from `SEED` alone and slice by tier, so a downgrade
   drops plants instead of shuffling them.

### 6.2 Measured baseline (today, headless, low tier, 1440×900)

```
sprigs rendered: 7
scroll FPS over the whole journey (40 steps, 140 ms dwell): min 39, p10 50, median 58
idle FPS with no scroll: 61
SVG element count in the flora surface: 70 (41 path, 22 g, 7 circle)
document: 23400 px tall, 22500 px scrollable
```

Rerun with `node .qa/nature-audit/_fps.mjs` after any implementation step.

### 6.3 Realistic SVG budgets

The real cost of this layer is **rasterised area × repaint frequency**, not node count — a single
1200 × 900 leaf with a gradient costs more per repaint than 200 hairline sprigs. Node count is the
proxy that is easy to assert on, so budget both.

Measured cost anchors: 11.4 DOM nodes per existing sprig; a hyper-detailed tropical leaf as
specified (outline + midrib + 8–14 secondary veins + 20–40 tertiary veins + 2–4 tears + gradient)
is realistically **40–70 nodes** if every vein is its own `<path>`, or **8–14 nodes** if the
secondary and tertiary veins are batched into 2–3 compound `<path>` elements with `M…` subpaths.
**Batch the veins.** One `<path>` holding thirty `M x y Q …` subpaths renders identically and costs
one node and one style resolution instead of thirty.

Per-tier totals for the whole nature system (all bands combined, including the existing sprigs):

| | high | medium | low |
|---|---|---|---|
| total SVG elements | **≤ 1400** | **≤ 600** | **≤ 220** |
| large plants (palm / monstera / banana / philodendron) | ≤ 26 | ≤ 10 | ≤ 3 |
| vine / climber runs | ≤ 8 | ≤ 3 | ≤ 1 |
| small sprigs (existing families) | ≤ 40 | ≤ 20 | ≤ 8 |
| `<linearGradient>` / `<radialGradient>` defs | ≤ 8 (shared, referenced many times) | ≤ 3 | 0 (flat fills) |
| `<clipPath>` defs | ≤ 12 (one per band + reused) | ≤ 4 | ≤ 1 |
| `<filter>` / `feGaussianBlur` | **0** | **0** | **0** |
| CSS `filter: blur()` on a band root | ≤ 2 | 0 | 0 |
| per-frame DOM writes (all bands) | ≤ 90 | ≤ 40 | ≤ 12 |
| per-plant sway | yes, 12 Hz idle cadence | no | no |
| band parallax (1 transform per band) | yes | yes | no |

Rules behind those numbers:

- **Never an SVG `<filter>`.** `feGaussianBlur` re-rasterises its whole filter region on every
  property change in the subtree; on a full-viewport surface that is the entire viewport, every
  frame. If a band must be soft, use CSS `filter: blur(Npx)` on the **band root only**, ensure that
  root's transform is the *only* thing that ever changes (so the blurred result is cached and
  composited), and add `will-change: transform`.
- Gradients are `<defs>` referenced by `fill="url(#…)"`, defined **once per surface**, never inline
  per leaf. `gradientUnits="objectBoundingBox"` so one def serves every leaf regardless of size.
- The existing write-caching pattern (`Float32Array grown`, `Int32Array wroteAngle/wroteScale`,
  integer quantisation before comparison) is mandatory for every new animated property.
- Everything is on the **one shared ticker**. One `subscribe()` for the whole nature system.
- Keep `contain: layout paint` on every host, and `contain: strict` on the wash.
- Keep the `document.hidden` unsubscribe.

### 6.4 QA harness that can be reused as-is

| script | what it gives this work | notes |
|---|---|---|
| `scripts/visual-qa.mjs` | 5 viewports (1920, 1440, 1280, 834×1112, 390×844), a screenshot at the mid-point of every chapter, console errors, horizontal overflow, CLS, slow frames. Writes to `.qa/`. | `BASE` defaults to `localhost:3000`. **It `rm -rf`s `.qa/` on start** — it would delete this brief. Pass a different out dir or move the brief before running it. |
| `scripts/perf-check.mjs` | bytes transferred by resource type, DCL/load/paint, and scroll FPS as `{min, p10, median}` over 40 steps. | defaults to port **3100**; pass `http://localhost:3000`. |
| `scripts/reduced-motion-qa.mjs` | the one that matters for §7: emulates `prefers-reduced-motion: reduce`, walks every chapter at 1440×900 / 390×844 / 375×667, and asserts nothing is invisible, clipped or overprinted. `RM_QA_MOTION=no-preference` sweeps the animated path; `RM_QA_OUT` redirects output. | **Action required**: its `DELIBERATELY_HIDDEN` allowlist (lines 46-52) is a regex over CSS-module class names. Any new nature module whose elements are legitimately invisible at a given scroll position must be added, or the sweep will report false failures. |
| `scripts/world-density.mjs` | the pattern for a counting probe — teleport, `page.evaluate`, count instances, tabulate. | Copy its shape for a `nature-density.mjs` that walks `frame.progress` in 2 % steps and asserts the per-tier node budgets in §6.3. |

Recommended new probe (write it in the implementation phase, at
`scripts/nature-density.mjs`): step `frame.progress` from 0 to 1 in 50 steps; at each step record
`document.querySelectorAll('[data-nature] *').length`, the count of plants with non-zero opacity,
and a 500 ms FPS sample; fail if any step exceeds the tier budget or drops below 50 fps p10 on a
non-headless high-tier run.

---

## 7. Accessibility and reduced motion

### 7.1 How the codebase handles it today

Four independent mechanisms, all of which the nature layer inherits:

1. **`JourneyProvider.tsx:114-117`** — `matchMedia('(prefers-reduced-motion: reduce)')`, applied on
   mount and on `change`, into `useJourney.setReducedMotion`.
2. **`JourneyProvider.tsx:128-130`** — mirrors it onto the document as
   `html[data-reduced="true"|"false"]`, so CSS can key off it without a media query (used by
   `Hud.module.css:123`).
3. **`globals.css:159-166`** — the global kill switch:
   `animation-duration: 0.001ms !important`, `animation-iteration-count: 1 !important`,
   `transition-duration: 0.001ms !important` on `*, *::before, *::after`.
4. **`Vegetation.tsx:241-249`** — the layer keeps its **own** `matchMedia` subscription in addition
   to the store, because it mounts on more than one route and must answer the question without
   depending on a provider having run. `still = reducedMotion || systemStill`. Copy this pattern.

Per-component handling is widespread (23 `@media (prefers-reduced-motion: reduce)` blocks across
chapter CSS modules) and the convention is consistent: **a reduced-motion state is a complete,
legible, static composition — not an empty one.**

**The critical non-obvious fact:** reduced motion does **not** stop the scroll pipeline.
`useLenisScroll.ts:33-42` only sets `duration: 0, lerp: 1, smoothWheel: false` — Lenis becomes a
pass-through, `frame.progress` still updates every frame, the ticker still runs, and
`useChapterFrame` still fires. **Scroll-driven reveal continues to work under reduced motion.** What
must stop is motion that is *not* a direct response to the reader's own scroll.

### 7.2 What the nature layer must do

**Markup, unconditionally:**

- Every host: `aria-hidden="true"`, `pointer-events: none`.
- Every `<svg>`: `role="presentation"`, `focusable="false"` (the IE/Edge legacy attribute is still
  needed to keep SVG children out of the tab order in some engines).
- Nothing focusable, no `<title>`, no `<desc>`, no text.
- No information conveyed only by plants. The density *is* the progress indicator's job
  (`Hud`), and the HUD is unchanged.

**Contrast, unconditionally:** `--text-primary` is `#0c0c0d`. Against the darkest permitted nature
fill (`--leaf-close`, L\* ≈ 48) that is well past 7:1. The binding constraint is the *other*
direction — `--text-muted` (`#75757c`, L\* ≈ 51) on a `--leaf-front` leaf is only about 1.2:1.
Therefore: **no mid/front/close plant may cross a `.label`, `.mono` or `--text-muted` run.** Extend
the existing `middle` text-safety falloff (`Vegetation.tsx:179`) into a real corridor — a
per-viewport rectangle around the content column that the front bands treat as exclusion geometry,
not merely as a scale multiplier.

**Under reduced motion** — keep the idea, remove the ambient motion:

| | animated | reduced motion |
|---|---|---|
| density vs. scroll | continuous, 60 Hz | **kept**, but quantised to the 8 bands (a step function, cross-faded by opacity — and the transitions are already killed to 0.001 ms, so it snaps) |
| per-plant sway | high tier, 12 Hz idle | **off** |
| band parallax | on | **off** |
| clip-path unfurl / dash draw | on | **off** — plants render fully grown |
| ground wash | continuous ramp | **kept**, quantised to the 8 band anchors |
| counts | tier budget | the `STILL_COUNT` analogue: roughly 40 % of the tier budget, because an arrangement that arrives all at once is a lot of plant |
| ticker subscription | yes | **still yes**, but the callback only compares the current band index against the last one and does nothing when they match — one integer comparison per frame |

Do **not** freeze the layer at zero density (that deletes the brief's central idea for
reduced-motion users) and do **not** freeze it at maximum (that buries the early pages).

**Reaching `/world2` must never depend on any of this.** `WorldPortal.tsx:610-621` already renders
a real `<Link href="/world">…Enter my world…</Link>` that is present in *every* motion mode — the
charge mechanic is explicitly an enhancement on top of it (`WorldPortal.tsx:289` returns early
under reduced motion; `:557` sets `data-plain="true"`). Two requirements for this work:

1. That anchor's href becomes `/world2` (decision 1). Flagged in §8, not fixed here.
2. **No nature layer may cover it.** The anchor lives inside the contact chapter, i.e. inside the
   z-10 stacking context, so every band at z ≥ 12 paints over it. `pointer-events: none` keeps it
   clickable and focusable, but it must stay *legible*: the contact chapter's content rectangle is
   part of the exclusion corridor above, and the `close` band (z 40) must be entirely absent from
   the region the readout occupies. Verify with `scripts/reduced-motion-qa.mjs` against the
   `contact` chapter at 375×667, which is the tightest case.

Also: `StaticProfile` (`src/app/page.tsx`) is the server-rendered, crawlable, screen-reader-first
copy of the whole profile. It goes to `z-index: 300` on `:focus-within`, above everything. Nothing
in the proposed scheme reaches that, which is correct — a keyboard visitor who tabs into the
summary must get a clean white document with no foliage on it.

---

## 8. Duplication and conflicts

Ordered by how much damage each would do if missed.

1. **`src/components/vegetation/Vegetation.tsx` is the same idea, already shipped and mounted.**
   `Journey.tsx:121` renders it **unconditionally on both routes**. Running the new system alongside
   it means two full-viewport fixed SVGs both ticking. Decide explicitly: either (a) the existing
   layer *becomes* the `--z-flora` (z 4) near-background band of the new system and is driven by the
   new controller, or (b) it is gated to `/projects` and the home journey gets the new system only.
   **(a) is recommended** — it preserves the margin sprigs the brief says to keep, and keeps
   `/projects` visually unchanged for free.

2. **`frame.progress` (px-space) vs `chapterRanges()` (vh-space) drift up to 3.45 pp.** Fully
   documented in §1.6 with the boundary table and the runtime derivation. If the implementer keys
   bands off `useChapterFrame`, the contact-chapter band fires 0.86 viewport-heights early. This is
   the single easiest way to get this work subtly wrong.

3. **`WorldPortal.tsx` still points at `/world`** — `router.prefetch('/world')` (:276),
   `router.push('/world')` (:342), `<Link href="/world">` (:613). Decision 1 says every link goes to
   `/world2`. Not this agent's change; flagged. The dependent contract: `ARRIVAL_KEY =
   'portal:arrival'` is written by the portal (`:124`) and read by
   `src/components/world/WorldLoader.tsx:45`. If the portal retargets to `/world2`, either `/world2`
   honours that sessionStorage key or the key becomes dead code — but decision 4 says `/world2` is
   not to be modified, so expect the key to go unread and the arrival optimisation to be lost.
   Raise it with the owner; do not silently drop it.

4. **`flora.ts` is shared API with the portal.** `WorldPortal.tsx:10` imports
   `mulberry32, pickKind, sprig`. Changing `WEIGHTS`, any builder's geometry, or the `FloraKind`
   union changes the portal's hedge. **New large-leaf species must be additive** — a new module
   (`src/components/vegetation/canopy.ts` or similar) with its own type union, or new kinds
   deliberately excluded from `WEIGHTS`. Do not widen `FloraKind` and leave `pickKind` able to
   return a palm frond, or the portal's hedge will grow monsteras.

5. **`GlobalCanvas.tsx:19` hard-codes `#ffffff` to match `--bg-primary`.** Any attempt to warm the
   page by changing `--bg-primary` or `html/body { background }` produces a visible seam at the
   canvas edge, and `--paper`/`--paper-2`/`--paper-3` are additionally mirrored by
   `src/world/core/palette.ts` (which decision 1 puts out of bounds). §5.4's wash-above-the-canvas
   approach avoids all of it. Do not touch `--bg-primary`.

6. **`main.journey` is a stacking context at z 10** (`globals.css:177-181`) and
   `.stage { overflow: clip }` (`Chapter.module.css:11`). Any plant a chapter renders is trapped
   below z 10 and clipped to one viewport. Large overhanging plants must be body-level siblings.

7. **The `WorldPortal` veil is at z 1 inside that context** (`WorldPortal.module.css:27,42`), so
   every band at z ≥ 12 paints over the closing sheet. Handle it by subscribing to the exported
   `portal` module state (`{ pull, drag }`) from the foreground controller — see §4.2. No change to
   the portal.

8. **`scripts/visual-qa.mjs` starts with `rm -rf .qa`.** This brief lives at
   `.qa/nature-audit/SYSTEMS_BRIEF.md`. Move it, or run visual-qa with a redirected out dir, before
   the first QA sweep.

9. **`scripts/reduced-motion-qa.mjs`'s `DELIBERATELY_HIDDEN` allowlist** (lines 46-52) must gain the
   new nature module names, or the sweep reports false failures on plants that are legitimately
   invisible at a given scroll position.

10. **Tier changes reshuffle the garden.** `arrange()` seeds on `SEED + count * 7919`
    (`Vegetation.tsx:130`), and `count` comes from the tier. The FPS governor can change the tier
    mid-scroll. Generate once from `SEED`, slice by budget.

11. **Dead fields that will silently read zero**: `frame.chapterProgress`, `frame.chapterIndex`
    (`state/journey.ts:169-170`, never written) and `useJourney().pointer` / `setPointer`
    (`state/journey.ts:46,50,117`, never called). Do not build on any of them.

12. **The Konami easter egg** applies `filter: invert(1) hue-rotate(180deg)` to `body` and to every
    `canvas` (`globals.css:184-185`). A CSS `filter` on `body` makes `body` a containing block for
    fixed descendants — already true today, so the nature hosts behave the same as the existing
    flora host. No action, but do not add a *second* filtered ancestor.

13. **`--flora-ink-far` / the `.far` class** are a two-step depth model that the six-band scheme
    supersedes. Keep the tokens (the portal's `--flora-ink-near` is a sibling of them), remap the
    class.

14. **`/world` code is out of bounds** (decision 1) and `src/world/core/palette.ts` mirrors
    `--paper*` by name. Adding tokens is safe; changing the existing ones is not.

15. **Nothing in `src/` links to `/world2` today** — grep for `/world2` outside `src/app/world2`
    and `src/world2` returns nothing. Every gateway change is net-new work for the implementation
    phase, not a modification of an existing link.

---

## Appendix — the minimum an implementer needs on one screen

```ts
// progress, velocity, pointer — never re-renders React
import { frame } from '@/state/journey'          // .progress .velocity .pointerX .pointerY .time
import { subscribe } from '@/lib/ticker'         // subscribe((dt_seconds, now_ms) => {}): () => void

// chapter-local progress, only for things INSIDE a pinned stage
import { useChapterFrame, readChapterProgress } from '@/hooks/useChapterProgress'

// tier + reduced motion — React state, changes rarely
import { useJourney } from '@/state/journey'     // s.performanceTier, s.reducedMotion

// the portal's live charge, for the foreground bands
import { portal } from '@/components/journey/WorldPortal'   // { pull: 0..1, drag: px }
```

Band boundaries in `frame.progress` space, full length:
`prelude 0 · about .128 · toolbox .264 · universe .400 · kcl .544 · ucl .728 · contact .896 · end 1`

z-index: `wash/back 3 · existing flora 4 · content 10 · mid 12 · front 20 · close 40 · HUD 60`.
Background bands mount **before** `<main>`; mid/front/close mount **after** `</main>`, before `<Hud>`.
