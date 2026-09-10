/**
 * scripts/mapcal/nudge-coast.mjs — push a run of coastline seaward.
 *
 *   node scripts/mapcal/nudge-coast.mjs            # report only
 *   node scripts/mapcal/nudge-coast.mjs --apply    # rewrite plan.json
 *
 * THE RACING LINE IS DRAWN ON THE BEACH.
 *
 * Over an arc of the north-west sweeper the traced racing line runs
 * outside the traced coastline: the centreline reaches 2.6 m out to
 * sea and the outer kerb 7.5 m. The shore stage in `Terrain.heightAt`
 * then does exactly what it is supposed to do — it carries the ground
 * down to the waterline — and takes 2.9 m out of the racing surface
 * doing it. Placed there, the car sits at y −1.02 on ground at −2.23.
 *
 * There are two ways to end that and only one of them fits. Moving the
 * racing line inland needs 10.55 m at the worst station and the island
 * has 1.00 m to give: the west run has 0.22 m of registry clearance to
 * the TNT quarry, which itself has 0.81 m to lake-west-0, and walking
 * inland from the failing stations meets water at 10–21 m. So the
 * coast moves instead.
 *
 * This is a deliberate, authorised departure from the drawing, and it
 * is written as a script rather than as edited numbers so that the
 * departure is legible: the vertices it touches, the distance each
 * moved and the reason are all here, and re-running it against a
 * re-digitised plan reproduces the same headland.
 *
 * It moves vertices along the polygon's own outward normal, tapered
 * from a peak so the coastline stays fair — a lump with corners in it
 * would read as damage rather than as a headland. Nothing else in the
 * plan is touched: the racing line, the lakes, the zones and the paths
 * are all left exactly as drawn.
 */
import fs from 'node:fs'

const PLAN = new URL('./plan.json', import.meta.url)
const MAP_WIDTH = 266
const MAP_DEPTH = 199.5
const APPLY = process.argv.includes('--apply')

/*
  THE HEADLAND, as a peak and a taper.

  Index 46 (−106.4, 67.8) and 47 (−114.9, 59.9) are the two vertices
  the racing line actually crosses. 45 and 48 carry the shoulder and
  44 and 49 return the coast to the drawing, so the new ground joins
  the old on a tangent rather than at a step.

  The distances are the measured deficit plus margin, not a guess: the
  outer kerb needs coastInset ≥ 8 m for the shore's `built` valve to
  shut completely, and it is at −7.5 m today.
*/
const PUSH = {
  44: 5,
  45: 13,
  46: 21,
  47: 21,
  48: 13,
  49: 5,
}

const plan = JSON.parse(fs.readFileSync(PLAN, 'utf8'))

/*
  THE DRAWING IS KEPT, AND IT IS WHAT THIS READS.

  `coast` is the shipping coastline; `coastDrawn` is the trace off the
  photograph, written the first time this runs and never written again.
  Every nudge is computed from the DRAWN vertices, so running this
  twice produces the same headland rather than a headland twice as far
  out, and re-tracing the map means deleting `coastDrawn` rather than
  unpicking an edit nobody can see.
*/
if (!plan.coastDrawn) plan.coastDrawn = plan.coast.map((p) => [...p])
const source = plan.coastDrawn
const toWorld = ([u, v]) => [(u - 0.5) * MAP_WIDTH, (v - 0.5) * MAP_DEPTH]
const toPlan = ([x, z]) => [x / MAP_WIDTH + 0.5, z / MAP_DEPTH + 0.5]

const world = source.map(toWorld)
const n = world.length

// The polygon's centroid, to orient "outward" without assuming a winding.
const centroid = world.reduce(
  (acc, [x, z]) => [acc[0] + x / n, acc[1] + z / n],
  [0, 0],
)

/** Outward unit normal at a vertex: the bisector of its two edges. */
function outwardNormal(i) {
  const [px, pz] = world[(i - 1 + n) % n]
  const [cx, cz] = world[i]
  const [nx, nz] = world[(i + 1) % n]
  // Normal of each adjacent edge, rotated from its direction.
  const edge = (ax, az, bx, bz) => {
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    return [-dz / len, dx / len]
  }
  const a = edge(px, pz, cx, cz)
  const b = edge(cx, cz, nx, nz)
  let vx = a[0] + b[0]
  let vz = a[1] + b[1]
  const len = Math.hypot(vx, vz) || 1
  vx /= len
  vz /= len
  // Point it away from the middle of the island.
  if ((cx - centroid[0]) * vx + (cz - centroid[1]) * vz < 0) {
    vx = -vx
    vz = -vz
  }
  return [vx, vz]
}

const moved = []
for (const [key, distance] of Object.entries(PUSH)) {
  const i = Number(key)
  const [vx, vz] = outwardNormal(i)
  const [x, z] = world[i]
  const to = [x + vx * distance, z + vz * distance]
  moved.push({ i, from: [x, z], to, distance, normal: [vx, vz] })
  world[i] = to
}

console.log(`\ncoast nudge — ${moved.length} of ${n} vertices\n`)
for (const m of moved) {
  console.log(
    `  [${String(m.i).padStart(2)}]  (${m.from[0].toFixed(1).padStart(7)}, ${m.from[1].toFixed(1).padStart(6)})`
    + ` → (${m.to[0].toFixed(1).padStart(7)}, ${m.to[1].toFixed(1).padStart(6)})`
    + `   ${m.distance} m along (${m.normal[0].toFixed(2)}, ${m.normal[1].toFixed(2)})`,
  )
}

/* How much land did this actually add? Shoelace, before and after. */
const area = (poly) => {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i]
    const [x2, z2] = poly[(i + 1) % poly.length]
    a += x1 * z2 - x2 * z1
  }
  return Math.abs(a) / 2
}
const before = area(source.map(toWorld))
const after = area(world)
console.log(
  `\n  island area ${before.toFixed(0)} → ${after.toFixed(0)} m²`
  + ` (+${(after - before).toFixed(0)} m², +${(((after - before) / before) * 100).toFixed(2)}%)\n`,
)

if (!APPLY) {
  console.log('  report only — pass --apply to rewrite plan.json\n')
  process.exit(0)
}

plan.coast = world.map(toPlan).map(([u, v]) => [
  Number(u.toFixed(6)),
  Number(v.toFixed(6)),
])
fs.writeFileSync(PLAN, `${JSON.stringify(plan, null, 1)}\n`)
console.log('  plan.json rewritten — now re-run scripts/mapcal/emit-ts.mjs\n')
