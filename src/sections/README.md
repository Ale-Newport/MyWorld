# Section animations

Three homepage sections offer a choice of five animations each:

| Section | Chapter | Options (ids) |
| --- | --- | --- |
| A little about me | `about` | `about.journey-ribbon`, `about.identity-assembly`, `about.profile-frame`, `about.interest-constellation`, `about.type-motion` |
| Project universe | `universe` | `universe.constellation`, `universe.orbits`, `universe.gallery`, `universe.mosaic`, `universe.layered-field` |
| End of journey | `contact` | `contact.botanical-gateway`, `contact.converging-paths`, `contact.stepping-path`, `contact.contour-horizon`, `contact.ribbon-aperture` |

- `catalog.ts` — ids, names, descriptions, defaults. Plain data, shared by the server (validation), the admin and the public page.
- `loaders.ts` — one dynamic import per option, so a page downloads only the options it shows.
- `SectionAnimation.tsx` — the slot a chapter renders in the region its layout reserves. It picks the option, preloads its chunk when the page is idle, mounts it a screen ahead, feeds it scroll progress and visibility, and contains failures.
- `types.ts` — the props every option receives.

## The contract every option keeps

1. **It fills its box and draws nothing outside it.** The root is `position: absolute; inset: 0` (or a canvas sized to the box). The chapter's layout decides where the box is at every screen size; the option never positions itself against the viewport.
2. **Text-safe.** About and Universe boxes are regions of their own: no text of the chapter is inside them. The Contact box is the whole stage, and `safe` lists the rectangles the closing words, links and labels occupy (with margin for their movement). Nothing an option draws may enter them, at any point of its motion, including sway and hover effects.
3. **Real content only.** Read `site` (projects, profile, education, experience, techNodes). Never hardcode names, numbers or milestones. Handle any count: 0 projects, 1 project, 300 projects; summaries of any length.
4. **No per-frame work while `active` is false.** Subscribe to the shared ticker (`@/lib/ticker`) when `active` turns true and unsubscribe when it turns false or on unmount. Never start a second requestAnimationFrame loop.
5. **Reduced motion.** When `reducedMotion` is true, render one composed, still state — the arrangement fully assembled — and keep interaction (focus, hover highlight without movement, click).
6. **Layout reads are rare.** Measure the box with a `ResizeObserver` (and `devicePixelRatio` for canvases); never call `getBoundingClientRect` or read layout every frame.
7. **Clean teardown.** Cancel subscriptions, observers, timers and listeners; release canvases and WebGL contexts.
8. **Knobs.** `intensity` (0–1) scales what `catalog.ts` says it scales for that option; `speed` (0.5–1.5) multiplies the option's own clock. Scroll-driven motion follows `progress` regardless of speed.
9. **Responsive.** It must compose well from a 320 × 140 box (phones, stacked layouts) to a 1600 × 900 box (ultrawide). Reduce density and simplify on small boxes; never just scale a desktop drawing down.
10. **Look like the site.** Palette from `src/styles/tokens.css` (cream ground `--bg-primary`, warm ink `--ink…--ink-4`, the single terracotta `--accent`, `--signal` teal, the nature greens `--nature-*` for anything botanical), Geist Sans for display type and Geist Mono for labels (`--font-display`, `--font-mono`), hairlines (`--hair`, `--border`, `--border-strong`), restrained motion (`--ease-out-expo`). The ground is a sunlit plaster wall in a classical hall: work with it, never paint an opaque panel over it.

Interactive options (Universe) render their project items as real `<button>`s (focusable, labelled with the project title, `Enter`/`Space` open it), report hover and focus through `onHover`, and open with `onOpen(slug)`. Filtering never removes items: those the filter leaves out stay in place, subdued, so the composition does not jump.

`?section-animation=<id>[,<id>…]` swaps in another option for one visit, for review and QA.
