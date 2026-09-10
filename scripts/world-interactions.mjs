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
 * The list is ENUMERATED from `window.__world.interactions`, the
 * landmark registry and the mini-game registry, never written down: a
 * hard-coded list of places is a list that keeps photographing the old
 * island. Anything with no drivable approach is reported and makes the
 * run fail, because a place a car cannot reach is content that does
 * not exist.
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
const errors = []
page.on('pageerror', (e) => { errors.push(String(e).slice(0, 160)); console.log('PAGEERROR', String(e).slice(0, 160)) })

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
  // The four PLAY_SPOTS. Each one registers a prompt of its own, so
  // most are already above — but a spot whose venue failed to build
  // registers nothing, and that is precisely the case worth seeing.
  for (const spot of g.geography.PLAY_SPOTS) out.push({ id: `spot-${spot.id}`, x: spot.x, z: spot.z })
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
const stranded = []
for (const place of places) {
  // Stand off and look in: the arrival view, not a plan view.
  const from = await page.evaluate(({ x, z }) => {
    const g = window.__world
    const geo = g.geography
    const ground = g.terrain.colliderHeightAt(x, z)
    /*
      Approach from whichever side a car could actually be on. The
      picker this replaces took the HIGHEST of eighteen bearings that
      had ground above 0.1 m under them, which on the drawn island is
      two separate mistakes: 0.1 m is dry land here — the LANDING
      forecourt sits at 0.32 — so the sea passed the test wherever the
      shelf had not fallen far enough, and "highest" deliberately
      chooses the steepest bank around a place instead of the flat
      side you drive in on.

      Inside-ness is `coastInset` and the waterline is whichever of
      `inlandWater` and OCEAN_LEVEL applies, both read off
      `window.__world.geography`; of the bearings that pass, the one
      nearest the place's own height wins.

      `inlandWater` answering at all is not the test. It reaches one
      BANK_WIDTH past the mapped edge so the shore can blend, so a
      truthy answer covers eight metres of perfectly dry bank — and
      rejecting on it alone declared every bearing around the TNT
      stack impassable. Ground above the local water level is ground.
    */
    let best = null
    for (let a = 0; a < 360; a += 20) {
      const r = a * Math.PI / 180
      const px = x + Math.cos(r) * 17
      const pz = z + Math.sin(r) * 17
      if (geo.coastInset(px, pz) < 3) continue
      const y = g.terrain.colliderHeightAt(px, pz)
      if (!Number.isFinite(y)) continue
      const level = geo.inlandWater(px, pz)?.level ?? geo.OCEAN_LEVEL
      if (y <= level + 0.2) continue
      const step = Math.abs(y - ground)
      if (!best || step < best.step) best = { px, pz, y, step, rot: Math.atan2(-(z - pz), x - px) }
    }
    if (!best) return null
    g.vehicle.moveTo({ x: best.px, y: best.y + 1.4, z: best.pz }, best.rot)
    g.view.focusPoint.trackedPosition.set(best.px, 0, best.pz)
    g.view.spherical.theta = Math.atan2(-Math.cos(best.rot), Math.sin(best.rot))
    g.view.spherical.targetTheta = g.view.spherical.theta
    g.view.spherical.radius.edges.min = 26
    g.view.spherical.radius.edges.max = 26
    g.view.spherical.targetPhi = Math.PI * 0.34
    g.view.snapToTarget()
    return { step: best.step }
  }, place)
  if (!from) {
    stranded.push(place.id)
    console.log(`  ${place.id} — NO DRIVABLE APPROACH within 17 m`)
    continue
  }
  await page.waitForTimeout(1000)
  await page.screenshot({ path: path.join(OUT, `${String(++shot).padStart(2, '0')}-${place.id}.png`) })
  console.log(`  ${place.id}${from.step > 4 ? ` — approach is ${from.step.toFixed(1)} m below/above it` : ''}`)
}

console.log(`\n${shot} framed, ${stranded.length} unreachable${stranded.length ? `: ${stranded.join(', ')}` : ''}`)
console.log(`screenshots → ${OUT}\n`)
await browser.close()
process.exitCode = stranded.length || errors.length ? 1 : 0
