import { chromium } from 'playwright'
const b = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader','--use-gl=angle'] })
const p = await (await b.newContext({ viewport: { width: 900, height: 600 } })).newPage()
await p.goto(`${process.argv[2]}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await p.waitForFunction(() => { const x=[...document.querySelectorAll('button')].find(y=>y.textContent?.trim()==='ENTER'); return x && !x.disabled }, { timeout: 120000 })
await p.getByRole('button', { name: 'ENTER', exact: true }).click()
await p.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await p.waitForTimeout(2500)
const roads = JSON.parse(process.env.ROADS_JSON)
const BRIDGES = JSON.parse(process.env.BRIDGES_JSON)
const RAMPS = JSON.parse(process.env.RAMPS_JSON)
const hits = await p.evaluate(({ roads, BRIDGES, RAMPS }) => {
  const g = window.__world
  const out = []
  for (const road of roads) {
    // Sample along the centreline and across the carriageway; anything
    // FIXED standing more than a kerb's height above the road is a wall.
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i-1], c = road.points[i]
      const len = Math.hypot(c[0]-a[0], c[1]-a[1])
      const steps = Math.ceil(len / 2)
      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const cx = a[0] + (c[0]-a[0])*t, cz = a[1] + (c[1]-a[1])*t
        const nx = -(c[1]-a[1])/len, nz = (c[0]-a[0])/len
        for (const off of [-road.width*0.35, 0, road.width*0.35]) {
          const x = cx + nx*off, z = cz + nz*off
          const o = g.physics.obstacleAt(x, z, 90, 220)
          if (o === null) continue
          const ground = g.terrain.colliderHeightAt(x, z)
          // A bridge deck stands above the terrain by design and the car
          // drives ON it; a ramp is a ramp. Neither is an obstruction.
          const onBridge = BRIDGES.some(b => {
            const dx = x - b.x, dz = z - b.z
            const along = Math.abs(dx*Math.cos(b.rotation) + dz*Math.sin(b.rotation))
            const across = Math.abs(-dx*Math.sin(b.rotation) + dz*Math.cos(b.rotation))
            return along < b.length/2 + 22 && across < b.width/2 + 6
          })
          if (onBridge) continue
          const onRamp = RAMPS.some(r => Math.hypot(x-r.x, z-r.z) < r.length/2 + 8)
          if (onRamp) continue
          if (o - ground > 0.9) out.push({ road: road.id, x: +x.toFixed(0), z: +z.toFixed(0), h: +(o-ground).toFixed(1) })
        }
      }
    }
  }
  return out
}, { roads, BRIDGES, RAMPS })
// Collapse to clusters so one wall is one line.
const seen = []
for (const h of hits) {
  const near = seen.find(s => s.road === h.road && Math.hypot(s.x-h.x, s.z-h.z) < 9)
  if (near) { near.n++; near.h = Math.max(near.h, h.h) } else seen.push({ ...h, n: 1 })
}
console.log(`\n${seen.length} obstruction(s) standing in a road\n`)
for (const s of seen) console.log(`  ${s.road.padEnd(14)} (${String(s.x).padStart(5)}, ${String(s.z).padStart(5)})  ${s.h} m tall  (${s.n} samples)`)
await b.close()
