/**
 * Photograph every interactive place in the world.
 *
 *   node scripts/world-interactions.mjs [baseUrl]
 *
 * Visits each mini-game entrance, play spot and interactive point and
 * frames it the way a player arriving by car would see it — camera
 * behind the vehicle, looking where the vehicle looks. A review shot
 * taken from an arbitrary bearing says nothing about whether the place
 * reads on arrival, which is the only thing that matters here.
 *
 * Writes to `.qa/interactions/`.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = path.resolve('.qa/interactions')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage()
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 160)))

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 180000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForTimeout(2500)

// Every place worth arriving at, read off the running engine.
const places = await page.evaluate(() => {
  const g = window.__world
  const out = []
  for (const [id, mg] of g.minigames.items ?? []) {
    const p = mg.startPosition
    if (p) out.push({ id: `game-${id}`, x: p.x, z: p.z })
  }
  // `points` is private to TypeScript, which is a compile-time notion;
  // at runtime it is just a Map, and this is a review tool.
  const points = g.interactions.points
  if (points) {
    for (const [id, point] of points) {
      if (!point.position) continue
      out.push({ id: `point-${id}`, x: point.position.x, z: point.position.z })
    }
  }
  for (const [id, handle] of g.world.landmarks) {
    if (handle.landmark.interaction === 'none') continue
    out.push({ id: `mark-${id}`, x: handle.landmark.x, z: handle.landmark.z })
  }
  // One place per spot: several of these sit on top of each other.
  const seen = []
  return out.filter((p) => {
    if (seen.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 9)) return false
    seen.push(p)
    return true
  })
})
console.log(`framing ${places.length} places\n`)

let shot = 0
for (const place of places) {
  // Stand off and look in: the arrival view, not a plan view.
  await page.evaluate(({ x, z }) => {
    const g = window.__world
    // Approach from whichever side has ground under it.
    let best = null
    for (let a = 0; a < 360; a += 20) {
      const r = a * Math.PI / 180
      const px = x + Math.cos(r) * 17
      const pz = z + Math.sin(r) * 17
      const y = g.terrain.colliderHeightAt(px, pz)
      if (y < 0.1) continue
      if (!best || y > best.y) best = { px, pz, y, rot: Math.atan2(-(z - pz), x - px) }
    }
    const from = best ?? { px: x + 17, pz: z, y: g.terrain.colliderHeightAt(x + 17, z), rot: Math.PI }
    g.vehicle.moveTo({ x: from.px, y: from.y + 1.4, z: from.pz }, from.rot)
    g.view.focusPoint.trackedPosition.set(from.px, 0, from.pz)
    g.view.spherical.theta = Math.atan2(-Math.cos(from.rot), Math.sin(from.rot))
    g.view.spherical.targetTheta = g.view.spherical.theta
    g.view.spherical.radius.edges.min = 26
    g.view.spherical.radius.edges.max = 26
    g.view.spherical.targetPhi = Math.PI * 0.34
    g.view.snapToTarget()
  }, place)
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${place.id}.png`) })
  console.log(`  ${place.id}`)
}

console.log(`\nscreenshots → ${OUT}\n`)
await browser.close()
