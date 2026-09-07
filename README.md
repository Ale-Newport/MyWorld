# Alejandro Newport — Portfolio

A scroll-driven, single-world portfolio. One object — internally called **the Core** —
travels through fifteen chapters and transforms into whatever the chapter is about: a
timeline traveller, a rover, a browser, a phone, a skeleton, a data node, a chessboard
lattice, a trade stream, a star, and finally back into the capsule it started as.

The site is built so that a recruiter with ninety seconds and a visitor with ten minutes
both get what they came for. Every fact on it is traceable to a source (see
[CONTENT_STATUS.md](./CONTENT_STATUS.md)).

---

## 1. Overview

| | |
| --- | --- |
| **Structure** | 15 chapters, one continuous document scroll, no route changes |
| **3D** | A single persistent WebGL canvas behind the DOM — never one per section |
| **Content** | Fully data-driven from `src/content/`; no copy is hardcoded in components |
| **Projects** | 41 entries — 4 hero, 15 featured, 22 archive |
| **Accessibility** | Full server-rendered profile in the DOM; reduced-motion path; keyboard navigation throughout |
| **Modes** | Full experience (default) and Quick View (≈90 s), switchable from the index |

### The critical questions, and where they are answered

| Question | Answered by |
| --- | --- |
| Who is Alejandro? | Prelude + About (chapters 01–02), and `StaticProfile` in the DOM |
| What does he do? | Rotating roles → the thesis line, then every chapter |
| Where did he study? | KCL (03), UCL (14) |
| Where has he worked? | Pansofia (05), Teaching (06), Metaview (09) |
| Strongest projects? | Focus (07), Gym (08), Chess (10), Cinquillo 2.0, Stock (11) |
| What does he actually use? | Tech Toolbox (13) — every technology wired to real project evidence |
| How do I contact him? | Persistent index overlay, and the finale (15) |

None of those depend on WebGL, animation or scrolling: they all exist as plain,
crawlable, screen-reader-reachable DOM.

---

## 2. Architecture

```
src/
  app/                        Next.js App Router — layout, page, 404, sitemap, robots
  content/                    THE SOURCE OF TRUTH
      profile.ts              identity, roles, contact links, site config
      chapters.ts             the journey spine: order, scroll length, theme, Core state
      education.ts            KCL, UCL, credentials
      experience.ts           roles, dates, verified facts, metrics
      skills.ts               technologies ↔ project evidence graph
      projects/
          personal.ts         public GitHub + hero projects
          client.ts           Pansofia / Grupo Newport websites
          index.ts            aggregation, filters, content-health report
      types.ts                the whole data model
  state/journey.ts            zustand store + a separate frame-rate object
  hooks/                      scroll driver, chapter progress, canvas harness, sound, easter eggs
  lib/                        math, device tiering
  components/
      journey/                provider, chapter shell, the 15 chapter components
      navigation/             HUD, index overlay
      typography/             reveal modes, count-up
      project-visuals/        19 procedural motion graphics, one per project family
      ui/                     cursor, project overlay
  experience/
      canvas/GlobalCanvas     the single R3F canvas
      core/                   the Core mesh + its per-chapter morph targets
      scenes/                 8 lazily-mounted 3D scenes
      camera/                 one camera, one shot pair per chapter
      shaders/                GLSL for the Core and the field
```

### How the scroll journey works

There is **no scroll-jacking**. The page is an ordinary document.

1. `src/content/chapters.ts` declares each chapter's length in viewport heights
   (`vh`, and `quickVh` for Quick View). That array is the single source of pacing truth.
2. `Chapter.tsx` renders each chapter as a `<section>` of exactly that height, containing
   one `position: sticky` full-viewport stage. Native scrolling moves the document; the
   stage stays pinned while its section passes.
3. `useLenisScroll` runs **one** rAF loop for the whole site. It smooths the scroll with
   Lenis, computes normalised progress, and writes it to two places:
   - the mutable `frame` object (every frame, zero React renders),
   - the zustand store (only when progress moves ≳0.04%, and only chapter-level fields).
4. Anything animating per-frame — the camera, the Core, particle systems, HUD progress,
   chapter parallax — reads `frame` directly inside `useFrame`/rAF. React re-renders only
   when the *chapter* changes.
5. Every animation is a pure function of progress, so scrubbing backwards is exact and
   nothing has to be "reset".

Adjusting pacing means editing one number in `chapters.ts`. Nothing else changes.

### The Core

`src/experience/core/Core.tsx` mounts once and never unmounts. `coreStates.ts` holds one
target transform per `CoreState`; the Core damps toward the active chapter's target, so
every transformation is continuous and reversible. Adding a chapter means adding a
`CoreState` and one entry in that record.

### Scene mounting

`SceneManager` keeps a scene alive only while the active chapter is within one step of a
chapter that owns it — so the next scene is warm on arrival and old GPU memory is released.
Each scene is a separate lazy chunk.

---

## 3. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Next.js 16 (App Router), React 19, TypeScript strict | SSR for the crawlable profile, RSC for the static layer |
| 3D | Three.js + React Three Fiber + custom GLSL | One canvas, instanced everything |
| Scroll | Lenis | Smoothing only — native scroll semantics are preserved |
| State | Zustand + a plain mutable frame object | Chapter-level reactivity; per-frame values never touch React |
| Motion graphics | Canvas 2D, hand-written | 19 components, no charting or animation library |
| Styling | CSS Modules + design tokens | No UI kit, no utility framework, no card component |
| Fonts | Geist Sans + Geist Mono (self-hosted) | No network font request |
| Sound | Web Audio, synthesised | Zero audio bytes shipped |
| Capture | Playwright + sharp | Client screenshots → AVIF/WebP |

GSAP is **not** used: ScrollTrigger's job here is done by ~40 lines of progress mapping,
and dropping it saved a dependency that would have earned nothing.

---

## 4. Install, run, build

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
npm start          # serve the production build
npm run lint
npm run typecheck
```

Useful URLs:

- `/?quick` — open directly in Quick View
- `/#project/chess-assistant` — deep-link any case study
- Press <kbd>I</kbd> anywhere for the index

### Content scripts

```bash
npm run content:status     # regenerate CONTENT_STATUS.md from the data model
npm run capture:clients    # re-capture the client website screenshots
```

---

## 5. Deployment

The app is a standard Next.js build with no server-side data fetching, so any Node host works.

**Vercel (recommended)**

```bash
npx vercel --prod
```

**Any Node host**

```bash
npm ci
npm run build
npm start           # binds PORT, defaults to 3000
```

**Docker**

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
```

**Before the first deploy**, set the real domain in `src/content/profile.ts`:

```ts
export const siteConfig = {
  url: 'https://your-real-domain.com',   // ← OpenGraph + sitemap depend on this
  ...
}
```

and replace the three links flagged `needsVerification: true` in the same file.

---

## 6. Content data model

Everything the site says lives in `src/content/`. The model is in `types.ts`; the shape
that matters most is `Project`:

```ts
{
  id, slug, title, shortTitle?, year, dates?,
  source: 'personal' | 'university' | 'client' | 'professional',
  organisation?, category, subcategory?,
  importance: 'hero' | 'featured' | 'archive',   // drives layout weight and Universe size
  shortDescription,                              // ≤110 chars, used on hover
  description, contribution?,
  verifiedFacts: string[],                       // ONLY things read from a primary source
  metrics: Metric[],                             // ONLY numbers found in that source
  technologies: string[],
  repository?, liveUrl?, chapter?, timelinePosition,
  presentation: { type, motionComponent, concept, interaction, duration },
  assets: { screenshots, videos, models, textures, audio },
  assetStatus: 'real' | 'generated' | 'placeholder' | 'none-required',
  dataStatus: 'verified' | 'partially-verified' | 'placeholder' | 'needs-review',
  privateSource: boolean,
  needsReplacement?: boolean,
  featured: boolean,
  accent?: string
}
```

`dataStatus` and `assetStatus` are the honesty mechanism. They are surfaced in
`CONTENT_STATUS.md` and never shown to visitors — the site does not print the word
"placeholder", it just doesn't claim things it cannot support.

---

## 7. Adding a new project

1. Add an entry to `src/content/projects/personal.ts` (or `client.ts`).
   Set `dataStatus: 'placeholder'` until you have read the source.
2. Pick a `presentation.motionComponent`. If nothing fits, use
   `'GenericProjectMotion'` — it is data-driven and works for any project.
3. If the project deserves its own graphic, create
   `src/components/project-visuals/MyMotion.tsx` following the contract in
   `project-visuals/types.ts`, and register it in `ProjectVisual.tsx`.
4. If it should appear in the drivable playground, add it to `INSTALLATIONS` in
   `src/experience/scenes/PlaygroundScene.tsx`.
5. Wire its technologies in `src/content/skills.ts` — the `evidence` array is validated
   against real project ids in development and warns on a typo.
6. `npm run content:status`.

It will appear automatically in the Project Universe, the archive list, the JSON-LD, the
sitemap and the static profile. Nothing else needs touching.

---

## 8. Replacing project assets

### Placeholder → real

Find the project in `src/content/projects/`. Then:

```ts
assets: {
  screenshots: ['/assets/projects/<slug>/hero.webp'],
  videos: [], models: [], textures: [], audio: [],
},
assetStatus: 'real',        // was 'placeholder' or 'generated'
dataStatus: 'verified',     // once the facts are confirmed
needsReplacement: false,    // or delete the key
```

Drop the files under `public/assets/projects/<slug>/`. `ProjectOverlay` shows a real image
whenever `assets.screenshots` is non-empty, and falls back to the procedural graphic
otherwise — no component change needed.

### Client website screenshots

```bash
npm run capture:clients
```

Re-visits the fifteen public sites, captures desktop (1440×2200) and mobile (390×1400),
encodes AVIF + WebP into `public/assets/client-work/`, and writes a `manifest.json`
recording what succeeded. To add a site, add it to the `SITES` array in
`scripts/capture-clients.mjs` **and** to `seeds` in `src/content/projects/client.ts`.

### 3D models

Put `.glb` files in `public/assets/models/`. Draco/meshopt-compress them first:

```bash
npx gltf-transform optimize in.glb public/assets/models/out.glb --compress meshopt
```

The Gym chapter is the first place a real model should land — see
`src/components/project-visuals/GymMotion.tsx` and item 1 in `CONTENT_STATUS.md`.

### Sound

There are no audio files: `src/hooks/useSound.ts` synthesises every cue with the Web Audio
API. To use samples instead, drop them in `public/assets/audio/` and swap the `play()`
implementation — the call sites (`'chapter' | 'click' | 'open' | 'close' | 'pulse'`) stay
the same.

---

## 9. Performance tiers

`src/lib/perf.ts` probes cores, device memory, pointer type, viewport and the WebGL
renderer string once, and returns a profile:

| Tier | Trigger | Effect |
| --- | --- | --- |
| `high` | Desktop, ≥8 cores, ≥8 GB, real GPU | DPR ≤ 2, full particle counts, shadows, all post-processing |
| `medium` | Mobile, ≤4 cores, ≤4 GB, or small texture limit | DPR ≤ 1.5, 55% density, no shadows |
| `low` | ≤2 cores, ≤2 GB, or a software renderer | DPR 1, 28% density, no shadows, physics disabled |

Every particle and instance count is written as `Math.round(N * device.density)`, so one
number governs the whole site's load.

A runtime watchdog (`createFpsWatchdog`) samples FPS every two seconds; two consecutive
readings under 32 fps drop the tier to `low` and clamp the pixel ratio, live.

Other measures: one WebGL context for the entire site; scenes lazily mounted in a window
around the active chapter; every project graphic in its own chunk, fetched only when shown;
`IntersectionObserver` pausing every Canvas2D loop that is off screen; instanced geometry
for the Universe, Toolbox and finale; no per-frame React state anywhere; WebGL deferred to
`requestIdleCallback` so the opening is interactive immediately.

---

## 10. Mobile

Mobile tells the same story with a lighter budget — nothing interesting is hidden.

- Density drops to ~28–55%; shadows and heavy post-processing are off.
- The playground swaps WASD for an on-screen joystick (`playground:touch` event).
- Every hover interaction has a tap equivalent: Universe nodes tap to open, Toolbox chips
  tap to pin, the client gallery scrolls natively.
- Chapter grids collapse from twelve columns to one; corner labels shrink or drop.
- The Metaview beats stack vertically instead of cross-fading in place.
- `overflow-x: clip` on `html, body` plus `overflow: clip` on every pinned stage, so no
  transform can produce a horizontal scrollbar.

---

## 11. Accessibility

- `StaticProfile` renders the complete profile — experience, education, all 41 projects with
  metrics, the full technology list and contact details — server-side, in the DOM, in the tab
  order. It is visually hidden but reveals itself on focus.
- `prefers-reduced-motion` removes camera sweeps, parallax and per-frame transforms. Every
  project graphic renders a meaningful static end-state instead of animating, and the reveal
  components render plain text.
- Focus is trapped in the index and project overlays, `Escape` closes both, and focus returns
  to the trigger.
- The progress timeline is a real `role="slider"` with arrow-key chapter navigation.
- The custom cursor is disabled entirely on touch devices and under reduced motion, and never
  covers native controls.
- Semantic headings throughout; skip-to-content link; visible focus rings on everything.

---

## 12. Privacy and sources

The `Grupo-Newport` repositories are private and **were never accessed**. Client entries
were built exclusively from the live public websites. No source code, infrastructure detail,
credential, environment value, internal URL or client-sensitive information from any private
repository appears anywhere in this project.

Every claim about a public repository in `verifiedFacts` was read out of that repository.
Where a number comes only from the CV, the data says so and the note is shown next to it.

---

## 13. Notes for whoever works on this next

A few things that are load-bearing and not obvious:

**R3F clones the `uniforms` prop.** Passing a memoised uniforms object to
`<shaderMaterial uniforms={u}>` and then mutating `u.uTime.value` in `useFrame`
silently animates nothing — the material holds a clone. Every shader scene here
keeps a `ref` on the material and writes through `mat.current.uniforms`. If a
shader stops animating, check this first.

**One rAF loop, not nineteen.** `src/lib/ticker.ts` is the only
`requestAnimationFrame` outside R3F. Chapters, the HUD, the cursor and the theme
lerp all subscribe to it. Adding a new per-frame effect means calling
`subscribe()`, not opening another loop.

**Two state objects, deliberately.** `useJourney` (zustand) holds things that
should re-render React — the active chapter, the theme, whether an overlay is
open. `frame` (a plain mutable object in the same file) holds things that change
sixty times a second. Putting scroll progress in the store would re-render
fifteen chapters per frame; putting the active chapter in `frame` would mean
nothing ever updates. Keep the line where it is.

**No tone mapping.** The WebGL clear colour has to match the DOM's `--paper`
token exactly or a seam appears at the edge of every pinned stage. ACES would
pull it off by ~30%.

**CSS Modules reject bare element selectors.** `kbd { … }` fails the build;
`.keys kbd { … }` is fine.

**The React Compiler lint rules are scoped off in two directories** — see the
comment in `eslint.config.mjs` for why, and what to do if the compiler is ever
switched on.
