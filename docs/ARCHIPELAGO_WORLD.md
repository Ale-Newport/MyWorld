# /world · Archipiélago

`/world` is the island built in HelloWorld (source revision 4ccab18), served entirely by this site:

- **The runtime** lives in `public/archipelago/preview` and is plain ES modules with an import map:
  - the player and the world studio
  - physics, driving, terrain, car and plane modes
  - the World2 activities
- **The world document** (the editor's save, about 17 MB gzipped) and **the asset definitions** are stored as revisions in the content store and served by `/api/world/release` and `/api/world/blob/<sha>`.
- **Before the first save,** the site serves the seed in `public/archipelago/seed` (static assets; hashes in `src/server/world-seed.json`).

Nothing depends on HelloWorld's development server, on a path on this Mac or on a symbolic link. HelloWorld remains the upstream of the editor and the player; it is not modified by anything here.

## Changes made in the portfolio

The copied runtime was originally byte-identical to HelloWorld. It is no longer: the portfolio extends it (see the comments at the head of each file).

- **Readiness.** The player tells the host page how loading is going and when its first prepared frame is on screen. The leaf transition waits for that signal, never for a timer (`main.js`).
- **Placement.** One module decides where the car may be put down, and one method puts it there, for the spawn, map travel, <kbd>R</kbd> and every recovery (`runtime/placement.js`, `Driving.place` in `runtime/driving.js`). A place must be fixed drivable ground under the whole car, near level, dry, clear of buildings and props (with a wider margin for anything that moves) and inside the island.
- **Spawn.** The car starts in the Central Plaza, at the best validated spot of its paving: clear of the fountain, benches, palms, letters and crates, facing open ground with the camera behind it, and put down at its ride height so it settles without a drop. A spawn pinned in the studio wins.
- **Jump.** <kbd>Space</kbd> jumps with real physics: once per press, never in mid-air, never while typing or in the plane. Held, it keeps all four wheels extended, as in /world2, and lets the car down when released (`runtime/jump.js`, `runtime/vehicle-input.js`).
- **Recovery.** Off the coast, into the void or stuck on its roof, the car comes back near where it went wrong: a few metres back along its recent trail, else on the nearest suitable recovery anchor on the same landmass, upright and still. <kbd>R</kbd> uses the same recovery. Races keep their own gate respawn (`runtime/recovery.js`).
- **Plane.** The propeller spins about its own axis with motion blur, and the plane banks into turns (`runtime/plane-visual.js`, `runtime/vehicle-mode.js`).
- **Ice props.** The penguins and cones are individual rigid bodies. The ice alone is slippery (`pushables.js`).
- **The M map.** It is a photograph of the real scene from above, framed by the world's bounds, with markers taken from the scene (`atlas.js`). Its places are buttons: selecting one, or any point of the island, travels there. The sea and other places a car cannot stand are refused with the reason, where they were clicked. A drag pans and never travels. <kbd>Tab</kbd> moves through the places and <kbd>Enter</kbd> travels.
- **Touch.** On a phone or a tablet the car is driven with /world2's joystick on the ground: press on the world and drag. The distance from the car is the throttle, the bearing is the steering, and behind the car it reverses. A tap on the car jumps, and two fingers turn and zoom the camera (`portfolio/world/input/Nipple.js`, compiled from `src/world/input/Nipple.ts`; `runtime/touch-joystick.js`, wired in `Driving`). While the last input was a finger, short touch hints replace the key hints, and a column of buttons appears: **JUMP** (the same press, hold and release as <kbd>Space</kbd>), **BACK ON YOUR WHEELS** (the recovery <kbd>R</kbd> uses) and **CAR / PLANE** (<kbd>Space</kbd> twice). The interact button becomes <kbd>E</kbd> itself (`touch-controls.js`, `player.css`). In the plane, a finger held left or right of centre turns and above or below climbs or dives. The map, travel, every recovery, car ↔ plane, a run that holds the car, a blur and a hidden tab let go of a finger as they let go of a key. On a touch screen the speed readout and the activity HUD let a finger through to the world. A mouse, a key or a pad brings the keyboard HUD back. The studio never shows the touch HUD.
- **Saving into the portfolio.** The admin's studio saves and publishes through the content store (`cms-storage.js`, `world-storage.js`).
- **Activities.** The infield slalom and the penguin round-up (`activities.js`). Their four achievements are in `portfolio/world2/content/achievements.js`.

## Editing the world

Use `/admin/world`. The editor is the HelloWorld studio, with a save and publish bar on top. See [ADMIN.md](ADMIN.md#world-editor).

The inspector's **Drive spawn · recovery** section has two tools:

- **Set drive spawn here** pins where `/world` and DRIVE start: at the selected object, or the centre of the view, on the nearest valid spot within 10 m. The pin is an undoable edit, saved with the world as `worldVariant.spawn` (`[x, north, height]`), `spawnHeading` and `spawnPinned: true`. **Use the plaza** removes it. Documents without the pin start in the Central Plaza.
- **Show recovery anchors** draws the anchors for the world as edited. Anchors are never stored: each drive derives them from the scene.

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

The scripts in `scripts/qa/` drive a real browser against the dev server on port 3210 (another port with `QA_BASE`, for example `QA_BASE=http://localhost:3404`):

| Script | What it checks |
| --- | --- |
| `world-spawn.mjs` | The spawn in the Central Plaza; a pinned spawn; a pinned spawn that is no longer valid |
| `world-jump.mjs` | Jumping, and holding <kbd>Space</kbd> to keep the wheels raised |
| `world-teleport.mjs` | Travel from the M map: places, points, the sea refused, drags, the keyboard, touch, the plane |
| `world-touch.mjs` | A phone held upright and on its side: driving and steering with the joystick, the tap jump, JUMP held, BACK ON YOUR WHEELS, CAR / PLANE and the plane by touch, map travel by tap, pinch zoom, a run letting go of a finger, a key or a pad taking over; the buttons clear of the rest of the HUD at five sizes; nothing of it with a mouse or in the studio |
| `world-recovery.mjs` | Recovery off three coasts, from the void, by <kbd>R</kbd>, and when overturned |
| `world-studio-drive.mjs` | The studio's drive spawn and recovery anchors (no admin session needed) |
| `world-plane.mjs` | The plane |
| `world-ice.mjs` | The ice props |
| `world-map.mjs` | The M map |
| `world-activities.mjs` | Both activities, start to finish |
| `world-terrain.mjs` | Land painted in the studio collides; erased land is sea again |
| `world-editor-e2e.mjs` | Save, publish and the map |
| `transition.mjs` | The leaf transition |
| `transition-edges.mjs` | Its edge cases |
