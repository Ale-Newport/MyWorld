# Procedural road system

`road-system.js` is browser and Node compatible. It uses local Three.js only;
`planar.js` has no dependencies. Portfolio is not read or modified at runtime.

```js
import { createRoad, rebuildRoadNetwork, createJunction } from './roads/road-system.js';
const road = createRoad({
  id: 'Coastal road', points: [[-20, .205, 0], [0, .205, 4], [20, .205, 0]],
  width: 7, closed: false, type: 'road', conformToTerrain: true,
  rails: { left: false, right: true }
});
root.add(road);
// Rebuild once after adding or transforming a batch of roads.
rebuildRoadNetwork(root, { heightAt: (x, z) => terrainHeight(x, z) });
const crossing = createJunction('Crossroad', { width: 7, height: .205 });
```

`createRoad()` returns a Mesh. `rebuildRoad()` also supports a Group, in which
case its surface is a generated child. `createJunction()` returns a Group of
editable master curves. Presets: `T Junction`, `Crossroad`, `Roundabout`, `Merge`,
`Split`. Each preset is an actual union network, not overlapping flat road strips.

Definition lives in `userData.roadDefinition`. Legacy `road_points` (JSON string),
`road_width`, `road_closed`, `road_network`, `rail_left`, `rail_right`,
`road_conform` remain authoritative for compatibility with the existing editor
and Blender exporter. Rebuilding synchronizes the definition. A definition's
points are local coordinates; all boolean operations occur in world coordinates
and the resulting geometry returns to the object's local coordinates.

The master curve is centripetal Catmull–Rom, sampled at equal arc distances.
Segment rectangles and round join sectors define its footprint. A planar
arrangement sweep splits at every polygon vertex and edge intersection. Within
each resulting slab, union/difference interval runs produce disjoint trapezoids.
This resolves hairpins, self crossings, holes and multi-road junctions before
triangulation. There are no overlapping asphalt triangles. Earlier coplanar
roads own shared junction areas; later roads subtract those areas. Paint stops
at junctions. Separate road/race networks also avoid stacked surfaces but receive
an overlap diagnostic so the user can correct an unintended crossing.

Asphalt UV U = curve distance / 4 metres. Curbs are the difference between outer
and inner buffers and use a portable two-pixel repeat texture. Its U coordinate
is distance / (2 × curbLength), so the red and white pattern remains consistent
on edited curves. Surface, paint, curbs and rails are children of the same master
entity or its surface Mesh. Physics uses the same asphalt geometry; paint is
explicitly `collision:false`.

Race definitions accept `grid:true` and `gridCount:8`. Starting grid paint uses
the same distance samples, so moving or reshaping the race curve moves its grid.
Rails and curbs leave clear openings where a connecting pit lane joins the track.

Bridge groups marked `userData.drivableBridge:true` expose their deck as a child
named `Deck`. Rebuilding subtracts that deck's transformed footprint from nearby
coplanar asphalt and paint, leaving the actual wood or stone visible and physical.
A road completely covered by a deck may have an empty surface; it remains an
editable master curve but has `collision:false` until exposed again.

Use `smoothRoad(object)` followed by a network rebuild to round control points.
Severe turns remain flagged until their radius/spacing is safe. The boolean
surface prevents visual overlap even while warnings are present.

Editor integration:

- Call `migrateLegacyRoads(root)` once to retire independent v2 stripes/kerbs.
- After changes call `rebuildRoad(object, { root, heightAt })`.
- Rebuild the network once after restoring all Undo/Redo/JSON states.
- Rebuild after a whole road or bridge is moved, added or deleted so neighbouring
  surface ownership and bridge openings update together.
- Derived children have `proceduralDerived:true`; do not independently register
  or persist their transforms. They are included normally in final GLB exports.
- After changing terrain outside the sampled centreline, use
  `rebuildRoadNetwork(root, { heightAt, force:true })`.
- `createRoadDebug(root)` returns a separate editor-only Group. Add it to the
  editor scene, outside the export root. Cyan = centreline, yellow = boundary,
  magenta = clearance, green = collision wire, white = controls, red = warnings.
- `roadDiagnostics(root,{seaLevel,obstacles})` checks curve issues, distinct-network
  crossings, building footprints and submerged road points. Messages also live
  on `object.userData.roadDiagnostics`.
- `roadGeometryData(object)` exposes derived sampled data for validation only.

The generator handles roads on the ground plane, terrain conforming roads and
separate elevated road planes. Existing three-dimensional stunt-loop geometry
remains its own source asset; projecting a vertical loop to a planar union would
be invalid.

Run `node --loader ./tests/local-loader.mjs tests/v4-roads.mjs` from project root.
The test suite compares generated triangles with independent Shapely/GEOS unions,
checks nonoverlapping areas, coupled editing, metre UVs, five junctions, actual
Rapier ray heights, portable serialization and network removal/cache behavior.
