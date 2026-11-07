# Responsive checks

The site has to compose on a 280 px fold cover, a phone with its address bar up, a tablet either way up, a laptop, a 4K
display, an ultrawide and a page zoomed to 300 %. This is how that is checked, and the rules the checks protect.

## Rules

**A pinned stage is sized in `svh`, never `vh`.** Every chapter pins one stage that is `100svh` tall. On a phone `1vh` is a
hundredth of the *large* viewport (address bar and toolbar hidden), which is a quarter taller than the visible one the
stage is pinned to, so anything sized in `vh` inside the stage (a tile, a gap, a font) grew past it: the Tech Toolbox's
icon wall ran under the footer on every phone, and no desktop browser shows it (there `vh` equals the viewport). Use
`svh` for sizes inside a stage and `100svh` for the stage. Two places keep `100vh` on purpose, the room and the canopy
(`home/room/room.module.css`, `canopy.module.css`): they stand behind the page and are meant to fill the large viewport.
A chapter's scroll length (`Chapter.tsx`) is in `vh` too, because it is a length of scrolling, not a size inside the stage.

**A control gets a finger-sized hit area even when it is drawn small.** On `(pointer: coarse)` a small control (the HUD's
mark, sound and index buttons, the scrub, a project page's links, the picture chips, the portal's link) carries an invisible
`::after` extension of its hit area. The gaps between controls are wider than what the extensions take, so neighbours do
not overlap. Do not enlarge the drawing to fix a tap target.

**Words that do not fit travel; they are never cut.** A stage whose words are taller than the band between the HUD's header
and footer lets them travel through it as the chapter scrolls (`journey/stageFit.ts`). A grid row that is squeezed to
what is left (`minmax(0, 1fr)`) defeats that: the words overflow the row and run behind what is below it. On a short screen
make the row `auto`.

## The checks (`scripts/qa`)

Serve a production build (`npx next build && npx next start`, or the deployed site) and point `--base` at it.

| Script | What it checks |
| --- | --- |
| `responsive-shots.mjs` | Every chapter of a journey at given viewports: sideways overflow, clipped text, text cut by a box, text over text, content outside the HUD's band, small touch targets, the stage's travel ends. `--sizes 390x664` gives exact viewports; `--large-ratio 1.27` simulates a phone's large viewport for `vh` (a desktop browser has no toolbars, so without it a `vh` mistake cannot show) |
| `device-matrix.mjs` | The above across the devices in its table (visible viewports of phones with the bar up, phones on their side, tablets, laptops, desktops, ultrawides, zoomed pages), in Chromium, WebKit or Firefox |
| `project-pages.mjs` | Every project page (and the 404) for overflow, wide media, clipped text and small touch targets |
| `overlays-devices.mjs` | The index overlay and the project case study at phone, tablet and desktop sizes |
| `world-devices.mjs` | `/world`'s controls inside the screen, clear of one another, big enough to tap (real GPU) |

A check that cannot fail proves nothing: `QA_INJECT_CSS` adds a stylesheet after load, so a fix can be undone to see the
check fire. Screenshots of every capture are written next to the report; the checks find what is measurable, and a
contact sheet of one device's chapters (`magick a.png b.png +append sheet.png`) is how the rest is looked at.
