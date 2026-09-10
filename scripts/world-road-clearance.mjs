/**
 * Is anything standing in a road?
 *
 *   ROADS_JSON=$(node scripts/_roads.mjs) EXTRA_JSON=$(node scripts/_extra.mjs) \
 *     node scripts/world-road-clearance.mjs [baseUrl]
 *
 * Samples every carriageway across its width and asks Rapier, not the
 * layout registry, what is there. The registry only knows what has
 * declared a footprint; this knows what actually has a collider — and
 * the difference between the two is where the interesting bugs live.
 * On the old island it was how the labyrinth was found, standing across
 * a road that nothing had modelled; the maze has moved to the far
 * north-east corner since, and the roads with it, which is why nothing
 * in this file names a coordinate.
 *
 * Three things it has to get right, all learned the hard way:
 *
 *   · A collider's ORIGIN is not where it is. A long wall is centred
 *     tens of metres from anywhere it blocks, so the search radius has
 *     to include the collider's own reach.
 *   · Trees only exist near the car. The ecology enables a fixed pool
 *     of trunk colliders and moves them to follow the player, so a
 *     probe run from the spawn sees no trees anywhere else in the
 *     world. The car is moved along the road as the probe walks it.
 *   · Ramps and bridge DECKS stand in a carriageway ON PURPOSE, so they
 *     are excused — but they are excused BY SHAPE and then NAMED in the
 *     output, and a bridge's railings are not a deck. The previous
 *     version excused a disc of `length/2 + 8` around each ramp, which
 *     for the 41 m east ramp is a 28 m blind spot; the east coast road
 *     passes within three metres of that centre, so a third of it was
 *     silently never examined.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage()
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await page.waitForTimeout(2500)

const roads = JSON.parse(process.env.ROADS_JSON ?? 'null')
if (!roads?.length) throw new Error('ROADS_JSON not set or empty — see npm run world:clearance')
const extra = JSON.parse(process.env.EXTRA_JSON ?? 'null')
if (!extra?.bridges || !extra?.ramps) throw new Error('EXTRA_JSON not set — see npm run world:clearance')

console.log(`\nwalking ${roads.length} carriageway(s), excusing ${extra.bridges.length} bridge(s), ${extra.ramps.length} ramp(s) and ${(extra.portals ?? []).length} arch(es)\n`)

const hits = []
const excused = []
for (const road of roads) {
  // Walk the road in twenty-metre strides, moving the car with the
  // probe so the ecology's trunk colliders exist where it is looking.
  const stations = []
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1]
    const b = road.points[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    for (let s = 0; s <= Math.ceil(len / 20); s++) {
      const t = Math.min(1, (s * 20) / len)
      stations.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, i, t])
    }
  }
  for (const [sx, sz] of stations) {
    await page.evaluate(({ sx, sz }) => {
      const g = window.__world
      const y = g.terrain.colliderHeightAt(sx, sz) + 3
      g.vehicle.moveTo({ x: sx, y, z: sz }, 0)
    }, { sx, sz })
    await page.waitForTimeout(140)
    const found = await page.evaluate(({ road, sx, sz, extra }) => {
      const g = window.__world
      const out = []
      // A bridge deck is meant to be above the ground and a ramp is a
      // ramp. Both are oriented boxes, tested in their own frame, with
      // a little slack for the abutments and the run-up.
      const inBox = (x, z, b, padAlong, padAcross) => {
        const dx = x - b.x, dz = z - b.z
        const along = Math.abs(dx * Math.cos(b.rotation) + dz * Math.sin(b.rotation))
        const across = Math.abs(-dx * Math.sin(b.rotation) + dz * Math.cos(b.rotation))
        return along < b.length / 2 + padAlong && across < b.width / 2 + padAcross
      }
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1]
        const b = road.points[i]
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
        const nx = -(b[1] - a[1]) / len
        const nz = (b[0] - a[0]) / len
        for (let s = 0; s <= Math.ceil(len / 2); s++) {
          const t = Math.min(1, (s * 2) / len)
          const cx = a[0] + (b[0] - a[0]) * t
          const cz = a[1] + (b[1] - a[1]) * t
          if (Math.hypot(cx - sx, cz - sz) > 12) continue
          for (const off of [-road.width * 0.34, 0, road.width * 0.34]) {
            const x = cx + nx * off
            const z = cz + nz * off
            /*
              NO EXCLUSION ROUND THE CAR. There used to be one — skip
              anything within four metres of the probe vehicle, "the car
              itself" — and it is both unnecessary and expensive.
              Unnecessary because `obstacleAt` raycasts with
              EXCLUDE_DYNAMIC, so the chassis cannot be hit by it.
              Expensive because the car is parked ON the carriageway
              every twenty metres and the sampling window is twelve, so
              a four-metre disc round each station fell in the gap
              between "too close to this station" and "too far from the
              next" — roughly two fifths of every road was never looked
              at. The bridge railing that puts the car in the river sits
              in one of those discs, and this probe reported the
              crossing clear.
            */
            const o = g.physics.obstacleAt(x, z, 90, 220)
            if (o === null) continue
            const ground = g.terrain.colliderHeightAt(x, z)
            if (o - ground <= 0.9) continue
            // A DECK is excused; a RAILING is not. `Water.buildBridges`
            // puts a collider a metre either side of the deck's edge
            // with its top at level + 1.9, and the only thing keeping
            // that out of the carriageway is the road running down the
            // middle of the bridge. When it does not — and on
            // `landing-bridge-social` it does not, it crosses the deck
            // at an angle and meets the north railing head on — the
            // rail is what the car hits, and a box exclusion that
            // swallows everything inside the bridge is a box exclusion
            // that hides the defect.
            const bridge = extra.bridges.find((br) => inBox(x, z, br, 24, 7))
            if (bridge && o <= bridge.level + 1.2) { out.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +(o - ground).toFixed(1), excused: `bridge ${bridge.id}` }); continue }
            if (bridge) { out.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +(o - ground).toFixed(1), excused: null, note: `${(o - bridge.level).toFixed(1)} m above the deck of ${bridge.id}` }); continue }
            const ramp = extra.ramps.find((r) => inBox(x, z, r, 8, 4))
            if (ramp) { out.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +(o - ground).toFixed(1), excused: `ramp ${ramp.id}` }); continue }
            // An ARCH is excused; a POST is not. What is over the road
            // at the labyrinth's gate is a lintel eight metres up, and
            // a road that goes under something is not a road that is
            // blocked by it — but only while the thing overhead really
            // is overhead, which is what the clearance test asks.
            const portal = (extra.portals ?? []).find((g) => inBox(x, z, g, 0, 0))
            if (portal && o - ground >= portal.clearance) { out.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +(o - ground).toFixed(1), excused: `arch ${portal.id}` }); continue }
            out.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +(o - ground).toFixed(1), excused: null, note: null })
          }
        }
      }
      return out
    }, { road, sx, sz, extra })
    for (const f of found) {
      const bucket = f.excused ? excused : hits
      if (!bucket.some((h) => h.road === road.id && Math.hypot(h.x - f.x, h.z - f.z) < 8)) {
        bucket.push({ road: road.id, ...f })
      }
    }
  }
}

console.log(`ROAD CLEARANCE — ${hits.length} obstruction(s) standing in a carriageway\n`)
for (const h of hits) {
  console.log(`  ${h.road.padEnd(22)} (${String(h.x).padStart(5)}, ${String(h.z).padStart(5)})  ${h.h} m above the road${h.note ? ` — ${h.note}` : ''}`)
}
// Anything over waist height stops the car; below that it is furniture
// the car shoves aside, and a world with none of that is a car park.
const walls = hits.filter((h) => h.h > 1.6)
console.log(`\n${walls.length} of them taller than 1.6 m`)

// Printed, not swallowed. A ramp across a road is intended, but WHICH
// road it crosses is a layout decision someone should get to see —
// `east-coast-road` running through the east ramp reads as a bug in a
// screenshot and as a design in this list.
console.log(`\n${excused.length} structure sample(s) excused by design\n`)
for (const h of excused) {
  console.log(`  ${h.road.padEnd(22)} (${String(h.x).padStart(5)}, ${String(h.z).padStart(5)})  ${h.h} m — ${h.excused}`)
}
console.log('')
await browser.close()
process.exit(walls.length ? 1 : 0)
