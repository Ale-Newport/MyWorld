/** Bridges and ramps, for the road-clearance probe's exclusions.
 *
 * Both are things that stand in a carriageway ON PURPOSE, so the probe
 * has to know them by shape rather than by name. ROTATION AND WIDTH
 * matter and are emitted for both: the ramps used to be excluded as a
 * disc of `length / 2 + 8`, which for the 41 m east ramp is a 28 m
 * blind spot centred on the coast — and the east coast road passes
 * three metres from that centre, so a third of it was never examined.
 * An oriented box is the ramp; a disc round it is a hole in the check.
 *
 * One bridge on this island, not the old four. */
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const W = await import('../src/content/world.ts')
const E = await import('../src/content/world-environment.ts')
const out = {
  // `level` is the deck's own height, and the clearance probe needs it:
  // `Water.buildBridges` stands a railing collider at level + 1.9 down
  // each side, and a railing is only scenery while the carriageway runs
  // down the middle of the deck.
  bridges: E.BRIDGES.map((b) => ({ id: b.road, x: b.x, z: b.z, length: b.length, width: b.width, rotation: b.rotation, level: b.level })),
  ramps: W.ramps.map((r) => ({ id: r.id, x: r.x, z: r.z, length: r.length, width: r.width, rotation: r.rotation })),
  /* PORTALS — the gate landmarks, which are arches a road goes UNDER.
     `Landmarks.buildGate` stands two posts eight metres either side of
     the centre along the gate's own X, and lays a lintel across them
     eight metres up: the probe sees a nine-metre obstruction sitting
     in the middle of the road that arrives at the labyrinth.

     `length` is the SPAN and it is deliberately twelve rather than the
     arch's sixteen, so the excused ground stops two metres short of
     each post. A lintel over the carriageway is a gateway; a post in
     the carriageway is an obstruction, and both read as "something
     eight metres tall" to a height probe — the only thing that tells
     them apart is where they stand. */
  portals: W.landmarks
    .filter((l) => l.visual === 'gate')
    .map((l) => ({ id: l.id, x: l.x, z: l.z, length: 14, width: 7, rotation: l.rotation ?? 0, clearance: 6 })),
}
// An empty exclusion table is survivable; a table that has quietly lost
// its rotations is not, because the box test then reads every ramp as
// axis-aligned and excuses the wrong ground.
for (const item of [...out.bridges, ...out.ramps, ...out.portals]) {
  if (!Number.isFinite(item.rotation) || !Number.isFinite(item.width) || !Number.isFinite(item.length)) {
    throw new Error(`[_extra] "${item.id}" is missing a rotation, width or length`)
  }
}
console.log(JSON.stringify(out))
