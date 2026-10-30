# World2 implementation plan

Written after reading the existing runtime, the installed Next.js routing/lazy-loading guides, and inspecting `folio-2025.blend` with Blender. The source file will never be saved by inspection or export scripts. Existing working-tree edits are preserved.

## Existing driving architecture

`src/app/world/page.tsx` mounts a client-only `WorldRoute` → `WorldExperience` → imperative `Game`. This route uses Three.js WebGLRenderer directly, **not R3F** (R3F is used elsewhere in the portfolio). Rapier is `@dimforge/rapier3d-compat` 0.17.3. Next.js 16.3.4 / React 19 / Three 0.185 / TypeScript are already installed; no new physics dependency is needed.

`Ticker` samples devices once per frame and uses a 1/60-second fixed accumulator, time scale 2, Rapier timestep 1/30, and raycast vehicle update 1/60. Fixed orders are Player intent 1, Vehicle forces 2, Physics 3, transform history 4, Vehicle measurement 5, Player measurement 6. Render orders: View 7, VisualVehicle 8, Lighting 9, Renderer 998. Keep these intact.

`PhysicsVehicle` has four raycast wheels, +X forward, +Y up, +Z axle, front-wheel steering. Chassis half extents 1.3 × .4 × .85, mass 2.5, centre of mass y=-.5; massless cabin and oversized object-only bumper. Engine force 300, steering .5, normal/boost speed parameters 5/40, boost multiplier 2, braking 35, idle .06, reverse brake .4, wheel radius .4, grip .9. Suspension low/mid/high .88/1.23/1.63, stiffness 20/30/40. Do not retune.

`Player` handles throttle, reverse braking, steering, boost, hydraulic jumps/corner controls, horn, recovery hops, automatic self-righting, respawn, and camera focus. `PhysicsVehicle.moveTo` resets body velocities and interpolation history. World2 adds complete wheel/input reset at the respawn boundary without changing handling. `Respawns` already accepts injected data; construct it with an empty list and add Blender markers.

`View` is the existing 25° perspective camera with magnetic focus (.25), two smoothing stages, 15–30 distance, .27π/.25π angles, speed zoom, roll spring, orbit/pan, pinch/wheel zoom, reset and collider obstruction queries. Game adds landing/impact kicks; copy that wiring. No OrbitControls.

`Inputs` / Keyboard / Pointer / Wheel / Gamepad / Nipple are instance-scoped and disposable. Reuse `ACTION_DEFINITIONS`: WASD/arrows, Shift boost, B/Ctrl brake, Space jump, 1–4/numpad hydraulics, R respawn, H horn, C camera reset, wheel zoom, M map, L mute, Escape pause, ? help, gamepad triggers/sticks/buttons, world-space touch steering and hold buttons.

`Physics` supplies floor/object/bumper/sensor groups, primitive/hull/trimesh/heightfield construction, contact-force events, ray queries, interpolation, gravity and teardown. Water height must be supplied from World2 geometry, overriding the old map's default. Reuse `Bin`, `Ticker`, `Tweens`, `Viewport`, `Quality`, `Physics`, `PhysicsVehicle`, `Player`, `View`, `Renderer`, `Materials`, `VisualVehicle`, `Lighting`, `Nipple` and `Respawns` through imports. No extraction or changes to `/world` are required. Do not instantiate old `World`, terrain, roads, map, ecology or minigames.

## Blender findings

Full per-object source audit: `world2-blender-audit.json` (1,507 scene objects: 910 meshes, 530 empties, 53 curves, 6 armatures, 2 cameras, 2 lights, 2 fonts, 2 metaballs). Units are metric, scale_length=1, metres. The file was saved in Blender 5.0; installed Blender 4.5.13 reads it with forward-version warnings, so modifiers/export must be checked explicitly.

Top-level collections include `areas`, `terrain`, `scenery.002`, `respawns`, `birchTrees`, `oakTrees`, `cherryTrees`, `bushes`, `flowers`, `grass`, `benches`, `bricks`, `fences`, `lanterns`, `poleLights`, `explosiveCrates`, `tornado`, `vehicle`, `map`, archives, and whisper exclusion helpers.

`areas` contains landing, career, social, projects, lab, cookie, altar, toilet, bowling, circuit, behindTheScene, achievements, timeMachine and easter. Parent empties encode area transforms; refZoneBounding/refZoneFrustum encode extents. Preserve hierarchy and names. `physicalFixed*`, `*PhysicalFixed*`, `physical*` plus child cuboid/cylinder/etc. empties encode collisions. Custom properties include mass (49 objects), booleans, restitution, category, preventFrustum, preventAutoAdd, texture, size and color. These must survive in extras/audit.

`terrain`: 192 × 192 m, 129 × 129 vertices. Its Geometry Nodes modifier displaces Z using the red channel of external `terrainWater.exr`; the raw mesh is flat. **That image is absent**, so a blind evaluated export would incorrectly flatten the world. The grass node uses external `terrainGrass.exr` and currently evaluates empty. Terrain material also uses `terrainFurniture.exr`, `terrainWater.exr`, `terrainGrass.exr`, and slabs texture. Packed `terrainAlpha` exists but is not a substitute for the height/water/grass data. Resolve exact corresponding assets before claiming terrain fidelity.

`scenery.002/road.001` contains `refRoad` (actual 272-vertex road ribbon at z≈.02, bounds x≈-84.395…62.364, y≈-75.480…87.549), `curveRoad` (hidden path reference), and authored raised road pieces. Circuit includes `road`, `jump`, `zigzag`, `obstacles`, `rails`, checkpoints, cones and barrels. Two `bridgePhysicalFixed` meshes have authored collision empties. Preserve their geometry/elevations.

Birch/oak/cherry collections separate visual templates, archives and reference trunks: 26/24/20 exact placements. `map` has duplicate tree render proxies and a presentation vehicle; exclude that editor/render collection, use the canonical vegetation references and templates once. Keep source prototype geometry away from the runtime origin. Bushes/flowers are already authored placements.

17 `respawn*` empties exist, including `respawnLanding` at Blender (39.528980, -37.825230, .5). Use its world matrix and heading; sample imported solid surface for safe release height. Other markers remain authored, with unsafe markers flagged rather than relocated into invented positions.

24 external image dependencies are absent (see image/material audit), including `palette.png`, label/carpet/sign textures and terrain masks. Look for exact counterparts locally and in the source asset repository; record provenance and checksums, never silently invent height data. Special Blender shader graphs need baking or a documented compatible PBR translation. Small emissive effects may remain static in this first pass.

## Export and coordinates

`scripts/export-world2-blender.py` will open the root file, refresh the machine audit, resolve dependencies, evaluate modifiers, extract metadata, and export GLB in `public/world2/models/`. An npm launcher locates Blender without a production dependency. Scripts never call save_mainfile. Keep source/audit transforms; use glTF's standard conversion (x,y,z) → (x,z,-y) once. `WORLD2_SCALE=1`: source metres match the 2.6 m chassis, source vehicle painted shell measures about 2.707 m long, and road ribbon width is about 8 m. No per-component rescaling.

Export environment and vegetation separately where useful, preserving original names/hierarchy and glTF extras; omit archives, old vehicle models, map-render duplicates, cameras/lights, exclusion guides and source prototypes. Export primitive collision metadata from helper world matrices (including empty display size) and static triangle geometry for terrain/roads/ramps where accurate. Static meshes never become dynamic triangle bodies. Repeated vegetation uses shared geometry / GPU instances at source matrices. Export only needed spawn/area/collider/path metadata into a manifest, not a second hand-maintained map.

## New architecture and verification

`src/app/world2/page.tsx` → isolated client shell / experience under `src/world2/`. `World2Game` composes the unchanged engine classes with a GLB-backed environment. Loading stages show file progress and physics readiness. Start by displaying the exported map, then add colliders and the existing car. Add source-derived map UI, development top-down and classification/collider toggles, authored area interactions, touch controls and audio once driving works. All effects, RAF, input, fetches, audio, GPU and Rapier resources are owned by the mount and released on navigation/failed boot.

Validate evaluated Blender vs GLB bounds and landmark matrices numerically; capture Blender and browser top views. Drive real inputs for acceleration/reverse/steering/brake/boost/jump/hydraulics/reset/camera. Traverse source road paths, ramps, bridges and authored area approaches, checking ground contact, falls and collision alignment. Record limitations honestly. Verify `/`, `/world`, `/world2`, unmount/remount, responsive layout, lint, typecheck and an isolated production build. Preserve baseline hashes of existing source files and the blend.
