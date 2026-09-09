/**
 * THE GRAND TOUR.
 *
 *   node scripts/world-loop-drive.mjs [baseUrl] [--headed]
 *
 * Drives the intended route — the ring, the spine, the branches and
 * the two links out to the circuit — under its own power, with no
 * teleporting, no respawning and no unstuck. The brief's rule is that
 * a visitor should meet the whole world by driving, so this is the
 * check that says whether they can.
 *
 * It steers by pure pursuit along each road's own polyline, which is
 * how it can tell "the road is blocked" from "the driver is bad": if
 * the car cannot make progress along a segment for four seconds, the
 * road has something standing in it, and the report says where.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const OUT = path.resolve('.qa/loop')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await page.waitForTimeout(2500)
await page.locator('canvas').click({ position: { x: 640, y: 620 } })

/*
  The autopilot is SPLIT. The page works out what it wants — because
  only the page knows where the car is — and Node presses the keys,
  because a `KeyboardEvent` dispatched from inside the page is not
  trusted and the input layer ignores it. The first version of this
  did it all in the page and reported that the car could not finish a
  single road, when in fact it had never moved.
*/
await page.evaluate(() => {
  const g = window.__world
  window.__auto = { route: [], at: 0, done: false, stuck: 0 }
  window.__autoCommand = () => {
    const a = window.__auto
    const p = g.player.position
    if (a.done || !a.route.length) return { throttle: 0, steer: 0, done: true, at: a.at, of: a.route.length, x: p.x, z: p.z, stuck: a.stuck }
    const target = a.route[a.at]
    const dx = target[0] - p.x
    const dz = target[1] - p.z
    const distance = Math.hypot(dx, dz)
    if (distance < 10) {
      a.at++
      a.stuck = 0
      if (a.at >= a.route.length) a.done = true
    }
    /*
      The car faces (cos r, +sin r) where r is `player.rotationY` —
      MEASURED, not assumed. Note this is the opposite sign to the
      rotation `vehicle.moveTo` takes, which is why `put()` below
      negates. Getting it backwards makes the car drive in circles and
      the report say every road on the island is impassable.
    */
    const forward = { x: Math.cos(g.player.rotationY), z: Math.sin(g.player.rotationY) }
    // NORMALISED by distance, so these are the sine and cosine of the
    // angle to the target rather than a number that grows with how far
    // away it is. Unnormalised, the deadband was effectively zero and
    // the car sawed left-right the whole way down every road.
    const cross = (forward.x * dz - forward.z * dx) / (distance || 1)
    const ahead = (forward.x * dx + forward.z * dz) / (distance || 1)
    if (g.vehicle.xzSpeed < 1.5) a.stuck += 1 / 60
    else a.stuck = 0
    return {
      // Reverse briefly when wedged, then try again.
      throttle: a.stuck > 2.5 && a.stuck < 4 ? -1 : ahead < -0.35 ? -1 : 1,
      steer: Math.abs(cross) < 0.09 ? 0 : cross > 0 ? 1 : -1,
      done: a.done, at: a.at, of: a.route.length, x: p.x, z: p.z, stuck: a.stuck,
    }
  }
})

const held = new Set()
async function press(key, down) {
  if (down === held.has(key)) return
  if (down) { held.add(key); await page.keyboard.down(key) }
  else { held.delete(key); await page.keyboard.up(key) }
}
async function release() {
  for (const key of [...held]) await press(key, false)
}

async function drive(name, route, budgetSeconds) {
  await page.evaluate(({ route }) => {
    const a = window.__auto
    a.route = route; a.at = 0; a.done = false; a.stuck = 0
  }, { route })
  const start = Date.now()
  let stalledAt = null
  let end = { done: false, at: 0, of: route.length }
  while (Date.now() - start < budgetSeconds * 1000) {
    const c = await page.evaluate(() => window.__autoCommand())
    end = { done: c.done, at: c.at, of: c.of }
    if (c.done) break
    await press('w', c.throttle > 0)
    await press('s', c.throttle < 0)
    await press('a', c.steer < 0)
    await press('d', c.steer > 0)
    if (c.stuck > 6 && !stalledAt) stalledAt = `${c.x.toFixed(0)},${c.z.toFixed(0)} on leg ${c.at}/${c.of}`
    if (process.env.VERBOSE) console.log(`      at ${c.x.toFixed(0)},${c.z.toFixed(0)} leg ${c.at}/${c.of} stuck ${c.stuck.toFixed(1)}`)
    await page.waitForTimeout(70)
  }
  await release()
  const seconds = ((Date.now() - start) / 1000).toFixed(0)
  const ok = end.done
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(16)} ${end.at}/${end.of} waypoints in ${seconds}s${stalledAt ? `  · stalled at ${stalledAt}` : ''}`)
  await page.screenshot({ path: path.join(OUT, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) })
  return ok
}

// The roads, read from the world so the route can never go stale.
const roads = await page.evaluate(() => window.__worldRoads ?? null)
const ROADS = roads ?? JSON.parse(process.env.ROADS_JSON ?? 'null')

const put = (x, z, rotation) => page.evaluate(({ x, z, rotation }) => {
  const g = window.__world
  const y = g.terrain.colliderHeightAt(x, z) + 2
  g.vehicle.moveTo({ x, y, z }, rotation)
  g.view.focusPoint.trackedPosition.set(x, y, z)
  g.view.snapToTarget()
}, { x, z, rotation })

console.log('\nTHE GRAND TOUR — driven, not teleported\n')
let failures = 0
for (const road of ROADS) {
  const first = road.points[0]
  const second = road.points[1]
  // A quarter of the way along the first leg, not on the vertex: road
  // vertices sit on district centres, and several district centres
  // have the district's main structure standing on them.
  const startX = first[0] + (second[0] - first[0]) * 0.25
  const startZ = first[1] + (second[1] - first[1]) * 0.25
  await put(startX, startZ, Math.atan2(-(second[1] - first[1]), second[0] - first[0]))
  await page.waitForTimeout(700)
  // Budget: 3 s per 10 m of road, which is a very relaxed 3.3 m/s.
  let length = 0
  for (let i = 1; i < road.points.length; i++) {
    length += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][1] - road.points[i - 1][1])
  }
  if (!(await drive(road.id, road.points.slice(1), Math.max(30, length * 0.34)))) failures++
}

console.log(`\n${failures} road(s) the car could not finish`)
if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`)
await browser.close()
process.exit(failures ? 1 : 0)
