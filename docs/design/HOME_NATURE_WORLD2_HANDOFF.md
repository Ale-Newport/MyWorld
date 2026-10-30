# The /world2 handoff — audit

Audit only. Nothing under `src/` was changed. `/world2` was read, not modified.
Measurements taken against the already-running dev server at `http://localhost:3000`
with Playwright (probe scripts left at `.qa/w2probe.mjs`, `.qa/w2probe2.mjs`,
`.qa/w2palette.mjs`; captures at `.qa/nature-audit/w2-firstpaint.png`,
`w2-ready.png`, `w2-entered.png`, `w2-network.json`).

---

## 1. THE SEAM

### What /world2 paints first

`src/app/world2/page.tsx` renders `<World2Route/>`. `src/world2/World2Route.tsx` is:

```tsx
const Experience = dynamic(() => import('./World2Experience'), { ssr: false, loading: () => <div className={styles.boot} role="status">Opening World 02…</div> })
export function World2Route() { return <main className={styles.route}><Experience /></main> }
```

`src/world2/world2.module.css`, first two rules:

```css
.route { position: fixed; inset: 0; z-index: 20; overflow: hidden; background: #dce3dc; color: #242b27; font-family: var(--font-geist-sans), sans-serif; }
.boot { height: 100%; display: grid; place-items: center; font-size: 12px; letter-spacing: .16em; text-transform: uppercase; }
```

Verified live. `curl http://localhost:3000/world2` already contains the string
`Opening World 02…` — the boot fallback is **server-rendered**, so it is in the
first HTML, not a hydration afterthought. Computed styles read off the live page
immediately after `waitUntil: 'commit'`:

```
main  background-color: rgb(220, 227, 220)   → #dce3dc
body  background-color: rgb(255, 255, 255)   → #ffffff   (globals.css --bg-primary)
body  innerText:        "OPENING WORLD 02…"
```

**The very first painted frame of /world2** is therefore: a full-bleed
`#dce3dc` field — a cool, slightly desaturated grey-green, a touch darker and
greener than the portfolio's `--paper` `#f4f2ee` — with one line of 12px
uppercase `#242b27` letter-spaced `.16em` type dead-centre. Nothing else. No
logo, no canvas, no white.

`.route` is `position: fixed; inset: 0; z-index: 20`, so the `#ffffff` on
`html, body` is completely covered **once /world2's tree has painted**. It is
not covered in the gap between the homepage tree unmounting and the /world2 tree
painting. That gap is where a white blink can appear, and it is the one real
hazard here — see the mitigation at the end of this section.

### What comes second

Once the `World2Experience` chunk resolves, `.boot` is replaced by the
experience, and the pre-entry screen is the `.loading` panel over the canvas:

```css
.loading { position: absolute; inset: 0; display: flex; align-items: center; padding: 90px 8%;
           background: linear-gradient(90deg, #edf0e9 0%, #edf0e9ed 33%, #edf0e91a 80%); }
```

and on narrow screens:

```css
@media (max-width: 700px) { .loading { padding: 80px 7%; background: #edf0e9dd; } }
```

So the left ~33% of the arriving screen is an essentially opaque `#edf0e9`
(sampled from the live screenshot at x=40: `#ecf0e8`, one unit of PNG profile
drift), fading to 10% alpha by 80% width, with the island showing through on the
right. Measured `readyAt` on localhost: **3641 ms** from navigation to
`[data-world2-ready="true"]` — so `#edf0e9` is the colour that occupies the
editorial third of the screen for roughly three and a half seconds.

### What the world itself looks like on the first drivable frame

This matters and was worth measuring, because the obvious assumption is wrong.
`World2Game.init()` pins the clock:

```ts
this.lighting = new Lighting(this.renderer, this.view, this.ticker, this.quality, this.bin)
this.lighting.duration = 0
```

With `duration = 0` the day never advances and `Lighting.phase` stays at its
initialiser `0.46`, which interpolates the keyframes at `0.38` (`#e6e9ea`) and
`0.50` (`palette.skyDay` = `#dfe4e8`) to a pale grey-blue sky — **which the
visitor never sees**, because the opening camera at `respawnLanding` is nearly
top-down and the island fills the frame edge to edge. Sampled dominant colours
of the real entered frame (`w2-entered.png`, 1440×900, every 7th pixel, bucketed
to 24-unit bins):

| share | colour | what it is |
|---|---|---|
| 10.1% | `#f0c0a8` | sand / path |
| 6.6%  | `#f0c090` | road, warmer sand |
| 4.4%  | `#903060` | magenta tree canopy |
| 3.9%  | `#d8a890` | shaded sand |
| 3.9%  | `#d8a878` | shaded road |
| 3.8%  | `#f0f0d8` | the giant ALEJANDRO letterforms, off-white |
| 3.7%  | `#906018` | timber |
| 3.6%  | `#78c0c0` | lagoon turquoise |
| 3.2%  | `#f0a860` | sand in sun |

Whole-frame average: **`#ad9272`** — a warm mid-tan. The island reads warm and
sandy, not green and not blue. Any homepage foliage tuned to a cool forest green
will collide with it on arrival.

### What the homepage should fade to

**Fade to `#dce3dc`.** Not `#edf0e9`, and certainly not the current white.

Reasoning, in order of weight:

1. `#dce3dc` is the only colour *guaranteed* to be under the visitor's eye at
   the instant of arrival. It is painted by CSS that ships with the HTML, before
   any chunk, any fetch and any canvas. `#edf0e9` only exists once the
   `World2Experience` chunk has loaded, which on a cold cache is not the first
   frame.
2. The sequence `#dce3dc → #edf0e9` is a lift of +17/+13/+13 in RGB, about 5%
   lighter, in the same hue family. As a cross-fade under an arriving panel that
   reads as *light coming up as you step out of the leaves*. The reverse
   sequence — landing on `#edf0e9`, dipping to `#dce3dc` for a boot frame, then
   coming back up — is a dip, and a dip reads as a flicker, which is exactly the
   blink the brief wants gone.
3. `#dce3dc` is a green-grey, not a white. Arriving on it from a page that has
   just been overtaken by plants is the right story: the paper has stopped being
   paper. It is also cool where the island is warm, which gives the moment after
   `Start driving` somewhere to go.

Concretely, in `src/components/journey/WorldPortal.module.css` the veil already
has the right mechanism:

```css
--veil-ink: var(--bg-primary);   /* #ffffff */
.veil { background: var(--veil-ink); }
```

and `WorldPortal.tsx` already warms it across the charge, currently toward
`/world`'s ground:

```ts
const warmth = Math.round(easeOutCubic(pull) * 25) * 4
host.style.setProperty('--veil-ink', `color-mix(in oklab, var(--paper) ${warmth}%, var(--bg-primary))`)
```

The same line, retargeted, is the whole change: mix toward `#dce3dc` instead of
`var(--paper)`. Give it a token (`--world2-ground: #dce3dc`) in `tokens.css` so
it is not a literal buried in a component, and note in the token's comment that
it must move with `.route`'s background in `world2.module.css`, which is the
same discipline `src/world/core/palette.ts` already documents for `--paper`.

### The one remaining blink, and how to close it

`html, body { background: var(--bg-primary) }` is `#ffffff`, and the veil
element belongs to the homepage tree, which unmounts at the route swap. If the
new tree's first paint is even one frame late, white shows through.

Close it by painting the seam colour on `<html>` itself at commit time, before
`router.push`: `document.documentElement.style.background = '#dce3dc'`. `<html>`
is not re-created by an App Router navigation, so that colour survives the swap
and sits underneath `.route` (which then covers it anyway). It must be cleared
on back-navigation — see §5.

Separately, and as an owner decision rather than a recommendation, because it
touches `/world2`: `src/app/layout.tsx` exports `themeColor: '#ffffff'` and
`/world2/page.tsx` does not override it, so on mobile the browser chrome stays
white against a `#dce3dc` page. A `viewport` export on `/world2/page.tsx` with
`themeColor: '#dce3dc'` would fix it. That is one added export in a /world2
file; flagged, not done.

---

## 2. THE ENTRY GATE

### Yes. There is a hard ENTER button, and nothing outside /world2 can reach past it.

`src/world2/World2Experience.tsx`, in the `{!status.entered && ...}` block:

```tsx
<button className={styles.enter} disabled={!status.ready} onClick={() => game.current?.enter()}>
  {status.ready ? 'Start driving' : 'Preparing your drive'} <span>↗</span></button>
```

and `src/world2/World2Game.ts`:

```ts
enter(): void {
  if (!this.status.ready) return
  this.audio.resume(); this.update({ entered: true }); this.setPaused(false)
  this.canvas.focus()
}
```

`status.entered` gates the entire driving UI (`{status.entered && !overlay && ...}`),
and `setPaused` early-returns on `if (!this.status.entered) return`. Until that
click, the visitor sits on the `.loading` screen shown in
`.qa/nature-audit/w2-ready.png`: "A SECOND WORLD TO EXPLORE / Take the *scenic
route.*" with a progress bar and the button. It is a genuinely good screen — it
is editorial, it is the same typographic voice as the homepage, and the island
is already visible behind it. That matters to the recommendation below.

### Can it be bypassed without editing /world2?

**No.** Verified by search, not by inspection alone:

```
grep -rn "sessionStorage|localStorage|searchParams|location.hash|URLSearchParams|autoEnter" src/world2/
```

returns only `localStorage` reads and writes for **settings, achievements,
places and circuit records** (`World2Game.ts:33,42`, `interactions/Achievements.ts`,
`interactions/Places.ts`, `interactions/Circuit.ts`). Nothing in
`World2Route.tsx`, `World2Experience.tsx` or `World2Game.ts` reads the URL, a
query parameter, a hash or `sessionStorage` for anything resembling an arrival
signal. `enter()` is an instance method on a `World2Game` held in a `useRef`
inside `World2Experience`; the only global handle to it is dev-only:

```ts
if (process.env.NODE_ENV === 'development') {
  const target = window as unknown as { __world2?: World2Game }
  target.__world2 = this
```

so in production there is no object to call `enter()` on from outside.

The one bypass that requires no /world2 edit is a DOM hack: mount a small client
component in `src/app/layout.tsx` that watches for
`[data-world2-ready="true"]` (a real, authored, stable attribute —
`World2Experience` sets `data-world2-ready={status.ready}` and
`data-world2-entered={status.entered}` on the experience host) and then
synthesises a click on the enter button. It works. It is not recommended: the
only stable way to find that button is by its text (`Start driving`) or by the
CSS-module hash, both of which are content, not contract; it puts /world2's
behaviour in the root layout where nobody will look for it; and it makes the
homepage's most important moment depend on a selector.

### The single smallest change, if the owner wants the bypass

**Nine lines in `src/world2/World2Experience.tsx`, and nothing else.** It is
exactly the contract `/world` already honours, reusing the same key, so it
introduces no new concept:

```tsx
// mirrors src/components/journey/WorldPortal.tsx and src/components/world/WorldLoader.tsx
useEffect(() => {
  if (!status.ready || status.entered || status.fatal) return
  let raw: string | null = null
  try { raw = sessionStorage.getItem('portal:arrival'); sessionStorage.removeItem('portal:arrival') } catch {}
  if (raw !== null && Date.now() - Number(raw) < 30_000) game.current?.enter()
}, [status.ready, status.entered, status.fatal])
```

Notes on that change, so the owner can judge it:

- It does not skip the wait. If the level is still loading, the progress bar
  stands there saying so, exactly as `WorldLoader`'s docblock argues for /world:
  *"The promise is no needless wait, not no wait."*
- `enter()` calls `this.audio.resume()` without a user gesture on that page.
  This is safe here: `World2Save` defaults to `muted: true` and
  `this.status.muted = this.save.data.settings.muted`, so a suspended
  `AudioContext` costs nothing until the visitor presses the sound toggle, which
  *is* a gesture. `/world` has run the identical arrangement since the portal
  shipped.
- It must remove the key, as written. `WorldLoader.consumeArrival()` removes it
  and holds the answer for 2000 ms specifically so React Strict Mode's
  double-mount does not lose it; the effect above re-reads on a real remount
  instead, which is fine because a remount inside one navigation does not
  happen for this component (the `[status.ready]` dep guards re-entry).
- Today `/world2` never consumes `portal:arrival`, so if the homepage keeps
  calling `markArrival()` the key is left in storage. Harmless while nothing
  reads it; it becomes a correctness requirement the moment this lands.

### The honest alternative: do not bypass it

The `.loading` screen is `#edf0e9`, left-aligned editorial type, with the
top-down island showing through the right-hand two-thirds. If the homepage fades
to `#dce3dc` and the last chapter's foliage carries the visitor into it, arriving
on that screen does not read as a page change — it reads as the page resolving
into a place, with one deliberate button at the end of it. That is defensible,
costs no change to /world2, and keeps the visitor's last act a choice. My
recommendation is: **build the seam first, look at it, and only then decide
whether the gate is in the way.** It may well not be.

---

## 3. PRELOAD

### The measured critical path

From the live run (`.qa/nature-audit/w2-network.json`), in the order the network
actually saw them, localhost, warm dev server, **ready at 3641 ms**:

| # | what | where it is issued |
|---|---|---|
| 1 | `/world2` document | navigation |
| 2 | `src_world2_World2Experience_tsx_*.js` | `dynamic(() => import('./World2Experience'))` in `World2Route.tsx` |
| 3 | `src_world2_World2Game_ts_*.js` | `void import('./World2Game')` in `World2Experience`'s mount effect |
| 4 | `node_modules_three_build_three_module_*.js`, `three_core_*.js`, `three_examples_jsm_*.js` | pulled in by (3) |
| 5 | `/world2/world-manifest.json` — **22,583 B** | `await fetch(...)`, first line of `World2Game.init()` |
| 6 | `/world2/models/world.glb` — **5,707,840 B** | `environment.load(manifest.models[0], …)`, progress 0 → 45 |
| 7 | `node_modules_@dimforge_rapier3d-compat_rapier_es_*.js` ×2 | `const rapier = await import('@dimforge/rapier3d-compat')` at progress 48 |
| 8 | `/world2/interactions.json` — **9,529 B** | `await fetch('/world2/interactions.json')` |
| 9 | `/world2/models/vegetation.glb` — **7,405,756 B** | `environment.load(manifest.models[1], …)`, progress 65 → 95 |
| — | `renderer.precompile()`, then `ready: true, progress: 100` | end of `init()`, which then calls `this.start()` |

`world-manifest.json` confirms the two models and nothing else:
`models: ['/world2/models/world.glb', '/world2/models/vegetation.glb']`.

### Everything in public/world2, with sizes, and whether it is on the path

| file | bytes | on the critical path? |
|---|---:|---|
| `models/vegetation.glb` | 7,405,756 | **yes** — the largest single item, and the last thing before ready |
| `models/world.glb` | 5,707,840 | **yes** |
| `map.svg` | 2,730,866 | no — build-time source for `map.png` only (`scripts/world2-map.mjs`) |
| `map.png` | 1,134,019 | no — fetched only when the M modal opens (`<img src="/world2/map.png">`) |
| `textures/terrain-color.png` | 993,190 | **no — never fetched at runtime.** A Blender bake left in `public/` by `scripts/export-world2-blender.py:194`; the only code references are in that Python script. |
| `world-manifest.json` | 22,583 | yes |
| `interactions.json` | 9,529 | yes |
| `LICENSE.txt` | 1,067 | no |

`assets/` is Blender source, not shipped: `assets/world2-source/textures/` holds
three 2.0 MB `.exr` bakes (`terrainWater`, `terrainGrass`, `terrainFurniture`)
plus small PNGs. None of it is reachable from a URL. Do not touch it.

**Total speculative cost of a full asset warm: 13,146,708 bytes**, essentially
all of it in the two GLBs.

### What is safe to warm, at what point, and what must not be touched

Safe, from about 85% of homepage scroll (start of the contact chapter, which
begins at 89.6% — call it the last chapter plus a little lead-in):

- **`router.prefetch('/world2')`.** Zero side effects. This is the floor, worth a
  single wheel notch, exactly as the portal already treats `/world`.
- **`fetch('/world2/models/world.glb', { priority: 'low', mode: 'cors' })` and the
  same for `vegetation.glb` and `world-manifest.json`.** Pure network into the
  HTTP cache; no parse, no main-thread work, no globals touched. `World2Game`'s
  own `fetch`/loader calls then hit cache. **This is the single biggest win
  available and it is the thing the existing portal does not do** — 13.1 MB is
  most of the 3.6 s, and none of it is currently anticipated.
  Gate it on the existing `thrifty()` check (`performanceTier === 'low'` or
  `navigator.connection.saveData === true` → skip), and on a real fraction of
  the charge, not on merely reaching the foot. Fire and forget; discard the
  response.
- **`import('@/world2/World2Experience')`.** Downloads and evaluates a React
  module; `three` arrives via `World2Game`, not via this. Moderate. Reasonable at
  the portal's existing `WARM_AT = 0.35`.

Safe but **must be spent from `commit()`, not during the gesture**:

- **`import('@/world2/World2Game')`** — this is what drags in `three`, `Physics`,
  `PhysicsVehicle`, `Player`, `Renderer`, `Lighting`, `Audio`, `Inputs`,
  `World2Environment` and the whole `interactions/` tree. Evaluating it only
  defines classes: no WebGL context, no listeners, no loop. But it is megabytes
  of main-thread parse, and `WorldPortal`'s docblock already makes exactly this
  argument for `/world`: spend it once the latch has closed and the only thing
  still moving is a compositor transform.
- **`import('@dimforge/rapier3d-compat')`** — download and parse of a couple of
  megabytes of WebAssembly carried as base64. The module's top level does **not**
  instantiate; `rapier.init()` does, and `World2Game.init()` calls it itself at
  progress 48. Importing early and letting the game call `init()` is correct and
  costs nothing twice. This transfers **verbatim** from the existing portal —
  same package, same reasoning, same call site.

**Must not be touched early, under any circumstance:**

- **`new World2Game(canvas, element, publish)`.** Its constructor runs
  `probeDevice()`, constructs `Quality` (which installs an FPS governor),
  `Viewport` (a `ResizeObserver` on the host), `Inputs` (keyboard, pointer,
  gamepad listeners bound to a canvas) and `World2Save` (a synchronous
  `localStorage` read, and a `flush()` that writes). It also throws outright on
  `probe.unsupported`.
- **`game.init()`.** Creates the `Renderer` — a **second live WebGL context**
  while the homepage's R3F canvas still holds one — calls `rapier.init()`
  (WASM instantiation), builds the physics world and steps it
  (`this.physics.world.step()`), constructs `Audio` (an `AudioContext`), and
  ends with `this.start()`, which opens a `requestAnimationFrame` loop. Every
  one of the things the brief says not to start early is in this method.
- **`Audio`** in any form. /world2 builds it in `init()` and resumes it in
  `enter()`; the homepage's own `useSound` `AudioContext` should be going the
  other way at this moment (see §4).
- **`/world2/map.png` (1.1 MB)** — demand-loaded by the map modal. Preloading it
  buys nothing and competes with the GLBs.
- **`/world2/textures/terrain-color.png` (993 KB)** — not on the path at all.
  Preloading it would be 993 KB spent on a file /world2 never asks for.

### What the existing WorldPortal already does here, and how much transfers

`WorldPortal.warm(level)` is a four-rung ladder:

```ts
if (from < 1) router.prefetch('/world')
if (from < 2 && level >= 2) void import('@/components/world/WorldExperience').catch(() => {})
if (level < 3 || thrifty()) return
if (from < 3) void import('@/world/Game').catch(() => {})
if (from < 4 && level >= 4) void import('@dimforge/rapier3d-compat').catch(() => {})
```

with rungs 1 and 2 spent during the charge (`warm(pull > WARM_AT ? 2 : 1)`,
`WARM_AT = 0.35`) and rungs 3 and 4 spent from `commit()`.

**Transfers unchanged:** the ladder shape, `WARM_AT`, the `thrifty()` gate, the
`.catch(() => {})` on every speculative import, the decision to move the heavy
rungs into `commit()`, and rung 4 literally — `/world2` imports the same
`@dimforge/rapier3d-compat`.

**Needs retargeting:** rung 1 → `/world2`, rung 2 → `@/world2/World2Experience`,
rung 3 → `@/world2/World2Game`.

**Is missing entirely:** the assets. `/world`'s heavy parts are JavaScript;
`/world2`'s heavy parts are two GLB files totalling 13.1 MB that the current
ladder never anticipates. A rung 2.5 that low-priority-fetches
`world-manifest.json`, `world.glb` and `vegetation.glb` behind the `thrifty()`
gate is the highest-value addition in this whole audit.

---

## 4. ROUTE TRANSITION, AND WHAT MUST BE TORN DOWN

### The navigation itself

Keep what already works: `useRouter()` from `next/navigation`, and
`router.push('/world2')` fired from `commit()` on a timer sized to the veil, as
the portal does today:

```ts
timer = window.setTimeout(() => router.push('/world'), COMMIT_MS)   // COMMIT_MS = 560
```

`push`, not `replace` — §5 depends on there being a history entry to come back
to. Do not use `<Link>` for the scroll-driven path (the `<Link href="/world">`
in the readout is the keyboard/no-JS fallback and should simply be retargeted to
`/world2`, `prefetch={false}` kept). Do not call `router.prefetch` and `push` in
the same frame; the prefetch should already have happened during the charge.

The one ordering change worth making: **unmount the WebGL canvas before the
push, not with it.** See item 4 below.

### Everything the homepage currently registers

Module-level, i.e. **survives the route change in the same JS context** — these
are the real leak risks:

| where | what | cleaned up? |
|---|---|---|
| `src/lib/ticker.ts` | one shared `requestAnimationFrame` loop plus a module `Set` of subscribers; `cancelAnimationFrame` only when the set empties | self-cancelling, **but only if every subscriber unsubscribes**. Subscribers on the homepage: every `Chapter`, `Hud` (`:37`), `Cursor` (`:63`), `Vegetation` (`:459`), `WorldPortal` (`stop` from `subscribe`). One missed cleanup keeps a rAF loop running for the whole of /world2, competing with `World2Game`'s own loop. |
| `src/hooks/useLenisScroll.ts` | `lenisInstance` module singleton; its own rAF (`raf = requestAnimationFrame(tick)`); `pointermove` on `window` | cleanup cancels the rAF, removes the listener, calls `lenis.destroy()` and sets `lenisInstance = null`. Correct today. Must stay correct — `WorldPortal.atFoot()` reads `getLenis()`, and a stale instance on a back-navigation would read a dead scroll. |
| `src/state/journey.ts` | the `frame` object (`progress`, `velocity`, `time`, pointer) | never reset. Harmless but untidy; reset it at commit so a back-navigation does not start from the last frame of the old page. |
| `src/components/journey/WorldPortal.tsx` | `export const portal = { pull: 0, drag: 0 }` | reset in the effect's cleanup and at effect start. Correct. |
| `<html>` attributes | `data-reduced` (JourneyProvider), `--journey-vh` (JourneyProvider), `data-konami` (`useEasterEggs`), `history.scrollRestoration = 'manual'` | none are reverted. `--journey-vh` and `data-reduced` are harmless on /world2 (nothing reads them). `scrollRestoration = 'manual'` is **global and sticky** — it is what makes §5 the homepage's problem rather than the browser's. |

Effect-scoped, i.e. each has a cleanup and unmounts with its component —
enumerated so the teardown can be checked rather than assumed:

- `Journey.tsx:105` — `keydown` on `window` (the `i` index shortcut).
- `useEasterEggs.ts:47,57` — `keydown` and `hashchange` on `window`, plus a
  7000 ms `setTimeout` at `:45` that removes `data-konami`. The timeout is *not*
  cleared on unmount; if it is in flight at commit it fires harmlessly on a dead
  document, but it is the one timer with no owner.
- `useSound.ts:106` — a delegated `click` on `document`, plus an `AudioContext`
  built by `ensureContext()`. **Suspend or close that context at commit**:
  /world2 builds its own `Audio` and two live contexts is one too many, and on
  iOS the second one can fail to start.
- `JourneyProvider.tsx:117` — `matchMedia('(prefers-reduced-motion: reduce)')`
  `change` listener; `:154` — a `requestAnimationFrame` for the `#chapter-…`
  deep link, cancelled in cleanup.
- `Vegetation.tsx:245,327,471` — `matchMedia` `change`, `resize` on `window`,
  `visibilitychange` on `document`, and a ticker subscription at `:459` that is
  itself started and stopped by the visibility handler. Three cleanups to get
  right, in the layer the new brief is about to make much bigger.
- `Cursor.tsx:63,73–77` — a ticker subscription plus `pointermove`,
  `pointerdown`, `pointerup` on `window` and `mouseleave`, `mouseenter` on
  `document`.
- `Hud.tsx:37,59,60` — a ticker subscription plus `pointermove` and `pointerup`
  on `window` (the scrub drag).
- `IndexOverlay.tsx:70` and `ProjectOverlay.tsx:56` — `keydown` on `document`.
- `Prelude.tsx:53` — a `window.setInterval`.
- `Universe.tsx:34`, `ToolboxScene.tsx:49`, `UniverseScene.tsx:209` — custom
  event listeners (`universe:hover`, `toolbox:hover`, `universe:filter`) on
  `window`.
- `useCanvas2D.ts:71,77,85,95` — a `ResizeObserver`, an `IntersectionObserver`
  and a per-canvas `requestAnimationFrame`. Used by the 2D chapter canvases;
  each instance is a loop of its own.
- `WorldPortal.tsx:512–516` — `wheel`, `touchstart`, `touchmove`, `touchend`,
  `touchcancel` on `window`, plus the `COMMIT_MS` `setTimeout` (cleared).

### The one that needs an explicit decision: the WebGL canvas

`Journey.tsx` mounts `GlobalCanvas` (`{canvasReady && <GlobalCanvas />}`), which
is an R3F `<Canvas>` with `frameloop={reducedMotion ? 'demand' : 'always'}` and
`gl.setClearColor(new THREE.Color('#ffffff'), 1)`. /world2 then constructs a
`Renderer` of its own inside `init()`. Unmounting the React tree disposes R3F's
scene graph, but a `WebGLRenderer` only truly releases its context on
`dispose()` / `forceContextLoss()`, and browsers cap simultaneous contexts.
While the homepage's context is still alive, /world2 is parsing 13 MB of GLB
into a second one.

Recommendation: at `commit()`, set `canvasReady` back to `false` (or lift a
`leaving` flag into `Journey`) so `GlobalCanvas` unmounts during the 560 ms the
veil is closing, several hundred milliseconds before the route swaps. It is free
— the canvas is behind an opaque veil by then — and it is the difference between
one context and two at the exact moment /world2 wants all the GPU it can get.
Worth confirming with `gl.getContext().getExtension('WEBGL_lose_context')` in a
Playwright run that R3F's unmount actually releases it; if it does not, the
`onCreated` handler already has the `gl` and can dispose it explicitly.

Note also that `GlobalCanvas` names its clear colour `GROUND` with the comment
*"It has to be exactly the white the DOM is painting behind the canvas — any
drift and the seam shows"*. If the homepage's ground moves toward `#dce3dc`
during the last chapter, that constant has to move with it, or the seam shows in
the other direction — inside the homepage, before the navigation.

---

## 5. BACK NAVIGATION

### What happens today

`JourneyProvider.tsx:110`:

```ts
if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
```

with the comment *"Own scroll restoration: the browser dropping the visitor into
the middle of a pinned chapter reads as a broken page."* So on `history.back()`
from /world2 the browser restores **nothing** — the homepage remounts at scroll
0, at the top of the prelude, having thrown away the entire journey. That is the
worst possible landing: the visitor spent 26 viewport-heights getting to the
gateway and is returned to the first screen of it.

### It cannot auto-re-enter, but it can nearly do so

`WorldPortal`'s `sealed` is a `useRef`, so a remount gets a fresh `false`, and
`pull` starts at 0 and only rises on a positive `charge(delta)`. It cannot fire
on its own. The real hazard is **inertial scroll**: a trackpad fling or an iOS
momentum scroll that was still in flight when the navigation happened continues
to deliver `wheel` events to the restored page. If the restore puts the visitor
exactly at the foot, `atFoot()` is true on the first frame, `armed` is true, and
those residual events are real charge against a portal the visitor is not
touching.

### What the homepage should do

1. **Record the position at commit, not at unmount.** In `commit()`, alongside
   `markArrival()`, write the journey progress:
   `sessionStorage.setItem('journey:return', String(frame.progress))`. Use
   `frame.progress` (the normalised 0..1 the whole system already speaks) rather
   than `window.scrollY`, so the restore survives a viewport resize or a
   different `--journey-vh`.

2. **Detect the return, and only then restore.** On mount, treat it as a return
   if the key exists, or if
   `(performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming)?.type === 'back_forward'`.
   Consume the key either way.

3. **Restore after the document has its height, not before.** This is already a
   solved problem in this codebase and the solution must be copied exactly.
   `JourneyProvider`'s `#chapter-…` deep-link effect carries the warning:
   *"we resolve it ourselves, once, after the document has been given its height
   — otherwise the target progress is measured against a one-screen-tall page
   and everything lands at the bottom."* So: one `requestAnimationFrame` after
   the `--journey-vh` effect has run, then
   `scrollToProgress(p, { immediate: true })`.

4. **Land short of the foot, deliberately.** Restore to roughly the start of the
   contact chapter plus a little — the range table puts contact at 89.6–100, so
   something like `0.93` — rather than to `1.0`. This does three things at once:
   `atFoot()` is false on arrival so no residual inertia can charge anything; the
   gateway is on screen, so the visitor immediately sees where they were and that
   the door is still there; and the last scroll to re-enter is a real gesture
   rather than a resumption. If the stored progress is below 0.93, restore the
   stored value verbatim — that visitor did not come back from the gate.

5. **Disarm the portal for a beat regardless.** Belt to the braces of (4): hold
   `armed = false` for ~400 ms after mount, or until one `wheel`/`touchstart`
   event arrives whose timestamp is after mount. `portal.pull` and `portal.drag`
   are already reset at effect start, which is correct; this only adds a
   lock-out window.

6. **Clean up the seam.** If §1's `document.documentElement.style.background`
   guard was set at commit, clear it on mount — otherwise the homepage's
   overscroll gutter is `#dce3dc` on the way back, which is a wrong colour in a
   place nobody will think to look.

7. **Clear `portal:arrival` on return.** Its 30-second TTL means a visitor who
   enters and comes straight back still has a live key; if §2's bypass is ever
   implemented, a plain click on the readout's `<Link>` within that window would
   skip the gate for someone who did not spend the effort. Remove it on the
   homepage's return path as well as on /world2's consume.

---

## 6. FORESHADOWING

### What /world2 actually looks like, so the hint is truthful

From §1: a nearly top-down camera over warm sand and roads (`#f0c0a8`,
`#f0c090`, `#f0a860`), moss-green low-poly canopies, magenta blossom trees
(`#903060`), a turquoise lagoon (`#78c0c0`), off-white letterforms
(`#f0f0d8`), frame average `#ad9272`. No sky in frame. No horizon. Warm, flat,
graphic, seen from above.

That last point is the one worth building on: **/world2 is a place seen from
above, not a place seen into.** The honest hint is not "depth behind the
foliage" as a vanishing point — it is *ground, warm, a long way down, glimpsed
through a gap*. Which is also the cheapest thing to draw.

### What actually exists in the repo, and what it is worth

- **`ContactScene`** — `src/experience/scenes/ContactScene.tsx`, already
  registered in `SceneManager.tsx:26` as `{ id: 'contact', chapters: ['contact'], Comp: ContactScene }`,
  already rendering in the already-running R3F canvas, at exactly the chapter the
  gateway lives in. It draws every entity the visitor passed as one instanced
  particle in a pointer-gravitational structure, on a palette of
  `['#d4491f', '#6e6c67', '#2f6f5e', '#93908a']`. **"Distant particles" already
  exists.** Nothing new needs to be started to have them. Retuning that palette
  toward the island's warm tans over the last few per cent of scroll is a
  content-scale change in a scene that is already on screen, and it costs one
  more `useFrame` read of `frame.progress`, which it already does.
- **`public/world2/map.png`** — 1,134,019 B, 1024×1024, ships today, fetched
  only by the M modal. It is a saturated cartoon island map: tan roads, hard
  green blobs, orange shoreline, deep blue sea. Used raw it would violate the
  style rule on sight, and it costs 1.1 MB.
- **`public/world2/textures/terrain-color.png`** — 993,190 B, 1024×1024, the
  baked terrain colour: soft bands of tan, moss and turquoise with no objects on
  them. Closer to usable than `map.png`, and genuinely pretty when blurred. But
  **it is not fetched at runtime by anything** (only `scripts/export-world2-blender.py`
  names it), so using it on the homepage makes it a new 993 KB download on the
  critical path of the page that must stay minimal.
- **`assets/world2-source/palette.png`** — 4 KB, the Blender palette swatch.
  Tiny, and literally the island's colour authority. Not currently shipped
  (`assets/` is not under `public/`), but at 4 KB it could be, or its colours
  could simply be read off once and written into `tokens.css` as literals — which
  is exactly the discipline `src/world/core/palette.ts` already documents.
- **No screenshot, poster or still of /world2 ships.** The only images of it are
  the ones this audit just generated in `.qa/`, which are QA artefacts, not
  assets.

### The recommendation

**Hint with light and colour, not with a picture.** Three things, none of which
needs a new asset, a new canvas or a second world:

1. **A warm bloom behind the foliage.** Over the last ~8% of scroll, a single
   large, very low-opacity radial gradient in the island's sand tone
   (`#f0c090`) rising from the bottom of the viewport behind the leaf layer —
   as if light is coming off a ground that is below and beyond the page. One
   element, one `radial-gradient`, opacity driven from `frame.progress` by the
   existing ticker. It is the warm/cool contrast against the `#dce3dc` the veil
   is heading for that makes it read as *somewhere else*, not as a glow effect.

2. **The gap, not the glow.** Where the leaf layers overlap at peak density,
   leave one deliberate opening — a slot maybe 40–80 px wide between two
   overlapping fronds — and let the bloom show through it at higher opacity than
   anywhere else. A hint of ground through an opening is exactly the brief, and
   the opening is free: it is an absence in a layer that is already being drawn.

3. **The motes are already running.** `ContactScene`'s particles are live at
   this chapter. Warming a handful of them toward `#f0c090`/`#78c0c0` and
   slowing a few to a drift over the last few per cent gives "distant particles"
   and "a small moving light" with no new system at all.

If a real image of the island is wanted, the honest route — and the only one
that does not cost a megabyte or break the style rule — is a **build-time
downsample**. `scripts/world2-map.mjs` already runs `sharp` over
`public/world2/map.svg`; a sibling step that produces a 32×32 or 64×64 blurred,
heavily desaturated version of `terrain-color.png` and inlines it as a data URI
is under 2 KB, is genuinely the island's own colour, and at that resolution
reads as *light and ground*, not as a picture of a jungle. It is truthful,
cheap, and uses an asset that already exists.

**What not to do:** do not mount a second `<Canvas>`; do not render a low-poly
proxy of the island; do not preload a GLB in order to show a frame of it; do not
put `map.png` on the homepage.

---

## BLOCKERS — anything that needs a change inside /world2 or /world

1. **The ENTER gate.** Auto-entry is impossible without editing
   `src/world2/World2Experience.tsx`. The smallest change is the nine-line
   `useEffect` in §2, reusing `/world`'s existing `portal:arrival` key and
   30-second TTL. **Owner decision required.** The alternative — arriving on
   /world2's `.loading` screen and letting the visitor press *Start driving* —
   needs no edit at all and may be the better design.
2. **`themeColor: '#ffffff'`.** Set globally in `src/app/layout.tsx` and not
   overridden by `/world2/page.tsx`, so mobile browser chrome stays white
   against a `#dce3dc` page. Fixing it properly means adding a `viewport` export
   to a /world2 file. **Owner decision; cosmetic, mobile only.**
3. **Nothing else.** The seam colour, the preload ladder, the teardown, the back
   navigation and the foreshadowing are all entirely homepage-side.
   `/world` is untouched by every recommendation here; the only change involving
   it is that the readout's `<Link href="/world">` and `warm()`'s prefetch
   targets move to `/world2`, which is a change in `WorldPortal.tsx`, not in
   `/world`.
