# /world · Archipiélago

`/world` is the island built in HelloWorld (source revision 4ccab18), served entirely by this site:

- **The runtime** lives in `public/archipelago/preview` and is plain ES modules with an import map:
  - the player and the world studio
  - physics, driving, terrain, car and plane modes
  - the World2 activities
- **The world document** (the editor's save, about 17 MB gzipped) and **the asset definitions** are stored as revisions in the content store and served by `/api/world/release` and `/api/world/blob/<sha>`.
- **Before the first save,** the site serves the seed in `content/seed/world/archipelago`.

Nothing depends on HelloWorld's development server, on a path on this Mac or on a symbolic link. HelloWorld remains the upstream of the editor and the player; it is not modified by anything here.

## Changes made in the portfolio

The copied runtime was originally byte-identical to HelloWorld. It is no longer: the portfolio extends it (see the comments at the head of each file).

- **Readiness.** The player tells the host page how loading is going and when its first prepared frame is on screen. The leaf transition waits for that signal, never for a timer (`main.js`).
- **Jump.** <kbd>Space</kbd> jumps with real physics: once per press, never in mid-air, never while typing or in the plane (`runtime/jump.js`, `runtime/vehicle-input.js`).
- **Plane.** The propeller spins about its own axis with motion blur, and the plane banks into turns (`runtime/plane-visual.js`, `runtime/vehicle-mode.js`).
- **Ice props.** The penguins and cones are individual rigid bodies. The ice alone is slippery (`pushables.js`).
- **The M map.** It is a photograph of the real scene from above, framed by the world's bounds, with markers taken from the scene (`atlas.js`).
- **Saving into the portfolio.** The admin's studio saves and publishes through the content store (`cms-storage.js`, `world-storage.js`).
- **Activities.** The infield slalom and the penguin round-up (`activities.js`). Their four achievements are in `portfolio/world2/content/achievements.js`.

## Editing the world

Use `/admin/world`. The editor is the HelloWorld studio, with a save and publish bar on top. See [ADMIN.md](ADMIN.md#world-editor).

To make the published world the one the repository ships:

```sh
node scripts/world/export-seed.mjs
```

The seed currently contains:

- the HelloWorld island
- the ice props as physics bodies
- four areas built through the studio by `scripts/world/author-areas.mjs`:
  - **Infield slalom** — the north infield of the circuit
  - **Penguin round-up** — the ice lake
  - **Paddock grove** — the north-west infield
  - **Coastal lookout** — the south-east pocket

Repeated static decoration is drawn through the player's instancing pass, which you can check with `scripts/qa/world-batching.mjs`.

## Checks

The scripts in `scripts/qa/` drive a real browser against the dev server on port 3210:

| Script | What it checks |
| --- | --- |
| `world-jump.mjs` | Jumping |
| `world-plane.mjs` | The plane |
| `world-ice.mjs` | The ice props |
| `world-map.mjs` | The M map |
| `world-activities.mjs` | Both activities, start to finish |
| `world-terrain.mjs` | Land painted in the studio collides; erased land is sea again |
| `world-editor-e2e.mjs` | Save, publish and the map |
| `transition.mjs` | The leaf transition |
| `transition-edges.mjs` | Its edge cases |
