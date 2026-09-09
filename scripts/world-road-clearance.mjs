/**
 * Is anything standing in a road?
 *
 *   node scripts/world-road-clearance.mjs [baseUrl]
 *
 * Samples every carriageway across its width and asks Rapier, not the
 * layout registry, what is there. The registry only knows what has
 * declared a footprint; this knows what actually has a collider — and
 * the difference between the two is where the interesting bugs live.
 * It is how the labyrinth was found: a 75 m maze wall standing across
 * the ring road's north-east leg, which nothing had modelled because
 * the maze is much bigger than its district's plate.
 *
 * Two things it has to get right, both learned the hard way:
 *
 *   · A collider's ORIGIN is not where it is. A 75 m wall is centred
 *     forty metres from anywhere it blocks, so the search radius has
 *     to include the collider's own reach.
 *   · Trees only exist near the car. The ecology enables ninety-six
 *     trunk colliders and moves them to follow the player, so a probe
 *     run from the spawn sees no trees anywhere else in the world.
 *     The car is moved along the road as the probe walks it.
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
if (!roads) throw new Error('ROADS_JSON not set — see npm run world:clearance')
const extra = JSON.parse(process.env.EXTRA_JSON ?? '{"bridges":[],"ramps":[]}')

const hits = []
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
      const car = g.player.position
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
            if (Math.hypot(x - car.x, z - car.z) < 4) continue      // the car itself
            const o = g.physics.obstacleAt(x, z, 90, 220)
            if (o === null) continue
            const ground = g.terrain.colliderHeightAt(x, z)
            if (o - ground <= 0.9) continue
            // A bridge deck is meant to be above the ground, and a ramp
            // is a ramp. Neither is an obstruction.
            const onBridge = extra.bridges.some((br) => {
              const dx = x - br.x, dz = z - br.z
              const along = Math.abs(dx * Math.cos(br.rotation) + dz * Math.sin(br.rotation))
              const across = Math.abs(-dx * Math.sin(br.rotation) + dz * Math.cos(br.rotation))
              return along < br.length / 2 + 24 && across < br.width / 2 + 7
            })
            if (onBridge) continue
            if (extra.ramps.some((r) => Math.hypot(x - r.x, z - r.z) < r.length / 2 + 8)) continue
            out.push({ x: +x.toFixed(0), z: +z.toFixed(0), h: +(o - ground).toFixed(1) })
          }
        }
      }
      return out
    }, { road, sx, sz, extra })
    for (const f of found) {
      if (!hits.some((h) => h.road === road.id && Math.hypot(h.x - f.x, h.z - f.z) < 8)) {
        hits.push({ road: road.id, ...f })
      }
    }
  }
}

console.log(`\nROAD CLEARANCE — ${hits.length} obstruction(s) standing in a carriageway\n`)
for (const h of hits) {
  console.log(`  ${h.road.padEnd(14)} (${String(h.x).padStart(5)}, ${String(h.z).padStart(5)})  ${h.h} m above the road`)
}
// Anything over waist height stops the car; below that it is furniture
// the car shoves aside, and a world with none of that is a car park.
const walls = hits.filter((h) => h.h > 1.6)
console.log(`\n${walls.length} of them taller than 1.6 m\n`)
await browser.close()
process.exit(walls.length ? 1 : 0)
