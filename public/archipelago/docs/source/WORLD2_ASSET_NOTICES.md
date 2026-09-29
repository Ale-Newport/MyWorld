# World2 asset provenance

The level is exported from the user-supplied root `folio-2025.blend`, originating in Bruno Simon's [folio-2025](https://github.com/brunosimon/folio-2025). Copyright © 2025 Bruno Simon, MIT License.

The root file is byte-identical to `resources/folio-2025.blend` in the available companion source copy. The recovered images in `assets/world2-source/` come from that same copy. `dependencies.json` records each original Blender path, bundled file, upstream-relative path and SHA-256. No replacement terrain or vegetation masks were painted.

The full original license is included at `assets/world2-source/LICENSE.md` and shipped with the browser assets at `public/world2/LICENSE.txt`. The loading screen also credits the level author. Existing vehicle and engine attribution remains in `THIRD_PARTY_NOTICES.md`.

World2 modifications are limited to exporting evaluated source geometry, adapting non-glTF shaders, baking the original terrain colour, reconstructing tree instances from source reference matrices, generating the map image, and connecting the resulting level to this project's existing driving engine. The Blender master is not rewritten.

## Generated assets

`src/world2/content/glyphs.json` holds glyph outlines for A–Z, 0–9 and a few
punctuation marks, extracted at build time from `Geist-Bold.ttf` by
`scripts/gen-title-glyphs.mjs`. Geist is © 2023 Vercel, in collaboration with
basement.studio, under the **SIL Open Font License 1.1** — the same font the
rest of the portfolio sets its type in, already a dependency of this project
(`node_modules/geist`, licence at `node_modules/geist/LICENSE.txt`). The
outlines are used to build the physical title in `/world2`; the OFL permits
this, including embedding in a derivative work, and the file records its source
and licence in its own header fields. Run `npm run world2:glyphs` to regenerate.

`public/world2/interactions.json` holds transforms for the Blender references
the level export deliberately filters out — the race gates, the career text
planes, the board hit targets and the sign curve. It is derived from the same
`folio-2025.blend` as the rest of the level, via `world2-blender-audit.json`,
and carries that file's SHA-256. Run `npm run world2:references` to regenerate.

No audio files were added. Every gameplay sound — explosions, fuses, pin
impacts, the race countdown, gate chimes, the finish fanfare, the award sting —
is synthesised by the existing WebAudio engine in `src/world/systems/Audio.ts`.

