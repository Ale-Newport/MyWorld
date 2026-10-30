# World2: Blender to browser

`folio-2025.blend` at the repository root owns the level. `/world` owns the driving mechanics. `/world2` composes both without modifying the existing engine or either existing route.

## Export

Open the root `folio-2025.blend` in Blender, edit the level, save it yourself, then run:

```sh
npm run world2:export
npm run dev
```

Open `http://localhost:3000/world2`. Production requires only `npm run build` and `npm start`; it never runs Blender.

The launcher uses `BLENDER_BIN`, `/Applications/Blender.app/Contents/MacOS/Blender` on macOS, or `blender` on PATH. For another installation:

```sh
BLENDER_BIN="/path/to/blender" npm run world2:export
npm run world2:export -- --render-reference
```

The optional reference render writes `.qa/world2/blender-top.png`. Blender runs in background with factory settings. Export does not call any save operation; it verifies the source SHA-256 before and after. All shader translations, evaluated meshes, and tree instances exist only in that Blender process. Keep the root file as the master, not the exported GLBs.

The supplied file was saved with Blender 5.0. The installed 4.5.13 LTS reads it with forward-version and legacy linked-node warnings. Its evaluated geometry was verified against the browser; the source is never downgraded/saved. Use Blender 5.0 or newer when editing the master. If a future node is unsupported, resolve it in a compatible Blender version rather than deleting the modifier.

## Source dependencies

Copying the blend away from its original `resources/` directory broke 24 relative image links. Exact files were recovered from a local `folio-2025` source copy whose blend has the **same SHA-256** as the master: `df5286df6141a6bece01abbd873d87a7f3d915cb685c6c989883cb7457474080`.

The export first respects existing Blender image paths, then uses `assets/world2-source/dependencies.json` and its bundled files. That manifest records original paths, upstream-relative paths, and checksums. All 24 dependencies are available locally; no download is needed during export. The exporter fails on missing dependencies instead of substituting invented terrain.

In particular, `terrainWater.exr` drives the terrain Geometry Nodes displacement (red × −1.5); `terrainGrass.exr` drives the authored grass distribution; `terrainFurniture.exr` and `slabs.png` contribute to the terrain material. The packed `terrainAlpha` image is not a height substitute. For a new texture, use a project-relative path that actually exists, or pack it into the blend.

## Collections and naming

| Source | Runtime use |
| --- | --- |
| `terrain/terrain` | Actual evaluated mesh: 192 × 192 m, 129 × 129 vertices, height −1.5…0 m. Same mesh feeds visuals and static collision. |
| `scenery.002/road.001` | `refRoad` ribbon, road edging and paths remain at source transforms. |
| `scenery.002/bridges`, `basaltRocks`, `slabs`, `rocks` | Original meshes and physical helpers. |
| `areas/*` | Landing, career, social, projects, lab, cookie, altar, toilet, bowling, circuit, behindTheScene, achievements, timeMachine. Source view-layer exclusions stay excluded. |
| Circuit `road`, `jump`, `rails`, `obstacles`, etc. | Original track, jump and props; scoring/timers and animated obstacles are deferred. |
| `birchTrees`, `oakTrees`, `cherryTrees` | Visual templates multiplied by exact reference matrices: 26 + 24 + 20 trees. Shared mesh data becomes GPU instances. |
| `bushes`, `flowers`, `grass` | Authored positions and evaluated geometry. Grass is one batch of 65,911 actual Blender triangles; no new scatter. |
| `respawns` | 17 original markers, including `respawnLanding`. |
| `map`, `vehicle`, archives | Editor/render duplicates and source vehicle templates, excluded from gameplay. The car comes from `/world`. |
| `refZone*`, `refInteractivePoint*` | Non-rendered metadata kept as named glTF nodes. |
| `whispersForbiddenAreas`, `tornado`, hidden construction curves | Audited reference data; not exported as scenery. |

The hidden `curveRoad` is an older guide extending outside the level. It is **not** the road source. QA navigation derives its centreline from shared edges of the visible `refRoad` quad ribbon. The gap between its ends is the authored jump, not a missing road to fill in.

## Coordinates and scale

One Blender metre is one engine metre: `WORLD2_SCALE = 1`. The glTF exporter performs the standard conversion `(x, y, z) → (x, z, −y)`. It preserves the complete parent matrix, including Blender parent-inverse transforms. There are no per-object corrective offsets, hand-maintained map positions, or independent scales.

The original source vehicle shell is about 2.707 m long; the reused chassis is 2.6 m long. The source road is wide enough for it at this scale. Known terrain, road, bridge, jump and grass bounds are included in the manifest and checked against GLB world-space vertices by the QA harness.

## Add objects and collisions

Add a mesh to the appropriate runtime collection and position it in Blender. Its name, hierarchy, transform, useful custom properties, UVs, materials and evaluated modifiers are exported. Avoid adding new scenery to an excluded archive/map/vehicle collection.

The existing naming system is used without mass-renaming:

- A parent containing `PhysicalFixed`/`PhysicalStatic`/`physicalFixed` owns static colliders.
- `PhysicalDynamic` owns dynamic colliders and uses its `mass`, `friction`, `restitution` properties when present. Mass defaults to 1 only when absent. No dynamic triangle meshes are generated.
- Child empties beginning `cuboid`, `tube`, or `ball` describe primitives. Empty `display_size` and the complete world scale determine dimensions; Object.dimensions is zero for empties and must not be used.
- Hidden `hull`/`trimesh` meshes remain collision data. Their actual vertices are transformed into the physical parent's rigid frame.
- `COLLIDER_` is reserved as an additive convention for future extensions; use the supported primitive names or `hull`/`trimesh` today.
- Terrain and the road/jump use their actual static triangle geometry. Large visible scenery without authored helpers receives a static mesh collider. Small decoration, foliage, labels and query-only guides do not become obstacles.
- Trees collide using their original trunk geometry, not their leaf volumes. Bushes and grass do not obstruct the car.

For important gameplay objects, authored collision helpers are preferable to relying on the fallback. Check the development Colliders toggle after export. Materials and physical bodies are separate; hiding a visual category is only a debugging display operation.

## Spawn and area references

Place `respawn*` or `SPAWN_*` empties in the level. The manifest retains their source X/Z and heading; at boot Rapier measures the surface below each marker and releases the car 2.2 m above it. No marker is moved sideways. `respawnLanding` is the default. R uses the unchanged closest-respawn logic; velocities, interpolation, wheel contacts, boost and suspension state are cleared on reset.

To add an area, add a collection under `areas`, a same-named anchor empty, and optionally a child `refZoneBounding*` cube with the desired bounds. A `refInteractivePoint*` node can preserve a precise interaction anchor for future behaviours. Current interactions show a local area description; project/career/social areas link to the portfolio. Geometry and placement are retained for bowling and circuit, while scoring, timed laps, moving machinery and other specialised mini-game logic are intentionally deferred.

## Materials, water and map

Palette and image materials keep their recovered original textures. Blender-only terrain colour nodes are baked with Cycles EMIT into a 1024px colour texture using the existing UVs, without lighting or guessed terrain colours. Foliage volume polyhedra remain the source geometry, with species colours applied; grass keeps its authored green. Emission-only gradient effects use simple PBR emission. These are documented rendering translations, not changes to the map.

There is no separate global water mesh in this blend. The exact `terrainWater`-displaced triangles define its basins. World2 clips those triangles at the companion source's water level (−0.3 m) to render water within the authored boundaries. The original waterfall meshes remain where Blender placed them. No ocean or lake outline is hand-drawn.

`map.svg` is generated from the terrain bake and orthographic projections of evaluated meshes. `world2-map.mjs` rasterises it to `map.png`. Its bounds and player marker use the same source coordinates. Development Top-down shows the live scene; Colliders and classification toggles help compare it to Blender.

## Outputs and lifecycle

- `public/world2/models/world.glb`: required environment, physics helpers and named metadata.
- `public/world2/models/vegetation.glb`: original trees, bushes, flowers and grass.
- `public/world2/textures/terrain-color.png`: baked Blender terrain colour, also embedded in GLB.
- `public/world2/world-manifest.json`: source hash, scale, spawns, area node names, QA road centreline, measurements and counts.
- `public/world2/map.svg`, `map.png`: source-generated map UI assets.
- `world2-blender-audit.json`: complete source inventory, transforms, properties, original dependencies, exclusions and evaluated bounds.

World2 dynamically loads on its own route. It owns cancellable fetches, one canvas, one Rapier world, one RAF, input listeners, audio and GPU resources. Mount cleanup also handles navigation during loading and React Strict Mode. World2 audio settings write a separate storage key; original `/world` progress is untouched.

## Validation

```sh
npm run world2:qa                     # dev server on port 3000
npm run world2:qa:platform            # bridges, mobile, storage, cancellation
npm run world2:qa -- http://localhost:3002 # alternate DEVELOPMENT server
npm run lint
npm run typecheck
NEXT_DIST_DIR=.next-verify npm run build
NEXT_DIST_DIR=.next-verify npm run start -- --port 3001
npm run world2:qa:production          # built UI, no development hooks
```

The browser harness checks original source bounds, all authored respawns, actual driving inputs, hydraulics/jump, braking/boost, orbit/zoom/reset, map, source road coverage and driving, route navigation and remount. Reports and captures live in `.qa/world2/`. The development handle `window.__world2` is not exposed in production. See `WORLD2_VALIDATION.md` for the observed results and remaining limitations of this first implementation.
