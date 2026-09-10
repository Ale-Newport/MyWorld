/**
 * EVERY CARRIAGEWAY, ONE AT A TIME.
 *
 *   ROADS_JSON=$(node scripts/_roads.mjs) \
 *     node scripts/world-loop-drive.mjs [baseUrl] [--headed] [--only=id,id]
 *
 * Drives each of the island's roads end to end under its own power,
 * with no unstuck and no respawning. The brief's rule is that a visitor
 * should meet the whole world by driving, so this is the per-road half
 * of the check that says whether they can — `world-tour.mjs` is the
 * other half, and drives the whole route in one go without ever putting
 * the car down. This one DOES put the car down, once per road, on
 * purpose: a road that is unreachable and a road that is undrivable are
 * different defects and this is the one that isolates the second.
 *
 * It steers by pure pursuit along each road's own polyline, aiming at a
 * look-ahead point and slowing for curvature — the same controller that
 * drives the circuit in `world-race-drive.mjs`, which on this island is
 * 954 m of one lap through 24 gates.
 *
 * WHAT IT CAN AND CANNOT TELL YOU. A road it finishes is definitely
 * drivable. A road it does not finish is EITHER blocked or badly
 * driven, and this cannot tell you which — it is an autopilot, not a
 * driver, and it loses the line on tight junctions where several
 * roads meet. `world-road-clearance.mjs` is the objective half of the
 * pair: it asks Rapier what is actually standing in each carriageway.
 * Read them together, and believe the clearance probe.
 *
 * The bar here is 90% of a road covered, not the final waypoint:
 * junction endpoints are shared between roads and the last few metres
 * of one are usually the first few of another. A road the ENGINE
 * finished — three failed unstuck hops end in `Player.respawn()` — does
 * not count as covered at all, and says so.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const ONLY = args.find((a) => a.startsWith('--only='))?.slice(7).split(',')
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

  The controller itself is the one from `world-race-drive.mjs`, which
  already drives the circuit's 954 m and 24 gates: it aims at a
  LOOK-AHEAD point rather than at the next waypoint, and picks a target
  speed from how much the route is bending. Steering straight at
  waypoints with a bang-bang throttle — which is what this did first —
  puts the car into the scenery on every bend and then reports the bend
  as impassable.
*/
await page.evaluate(() => {
  const g = window.__world
  window.__auto = { curve: null, length: 0, at: 0, done: false, stuck: 0, samples: [], progress: 0 }

  /*
    A road the ENGINE finished is not a road the car drove. Three failed
    unstuck hops end in `Player.respawn()`, which puts the car on the
    nearest respawn point — and on a short road that can be most of the
    way along it, so the coverage percentage jumps and the road reports
    as passable. `Player.respawn` fires an event; count it.
  */
  window.__autoRespawns = []
  g.player.events.on('respawn', (target) => window.__autoRespawns.push(target.name))

  window.__autoRoute = (points) => {
    const auto = window.__auto
    const path = points.map(([x, z]) => ({ x, z }))
    /*
      LINEAR between the control points, not a spline through them.
      The terrain paints these roads with `lineTo`, so the polyline IS
      the road; a Catmull-Rom through the same points bulges outside it
      at every corner. On the old island that bulge put the racing line
      nine metres into a district's physical name, and the harness spent
      thirty seconds wedged in an E reporting the road as impassable.
      The roads are narrower here — six metres on the maze spur, seven
      on three more — so there is less of the carriageway to lose.
    */
    const samples = []
    for (let seg = 0; seg < path.length - 1; seg++) {
      const a = path[seg]
      const b = path[seg + 1]
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.5))
      for (let k = 0; k < steps; k++) {
        const t = k / steps
        samples.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })
      }
    }
    samples.push({ x: path[path.length - 1].x, z: path[path.length - 1].z })
    let length = 0
    for (let i = 1; i < samples.length; i++) length += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].z - samples[i - 1].z)
    auto.samples = samples; auto.length = length; auto.at = 0; auto.done = false; auto.stuck = 0; auto.progress = 0
  }

  window.__autoCommand = () => {
    const a = window.__auto
    const p = g.player.position
    if (a.done || !a.samples.length) {
      return { throttle: 0, steer: 0, boost: false, done: true, at: a.at, of: a.samples.length, x: p.x, z: p.z, stuck: a.stuck, rescued: window.__autoRespawns.splice(0) }
    }
    // Nearest sample AHEAD of the furthest one reached, so the car
    // cannot satisfy the route by cutting back to the start.
    let closest = a.progress, best = Infinity
    for (let i = a.progress; i < Math.min(a.samples.length, a.progress + 60); i++) {
      const d = (p.x - a.samples[i].x) ** 2 + (p.z - a.samples[i].z) ** 2
      if (d < best) { best = d; closest = i }
    }
    a.progress = closest
    a.at = closest
    if (closest >= a.samples.length - 2) { a.done = true }

    // Twelve metres of look-ahead at 1.5 m a sample. Sixteen samples
    // was twenty-four, which on a fifteen-metre leg aims past the
    // corner entirely and cuts it.
    const look = Math.min(a.samples.length - 1, closest + 8)
    const target = a.samples[look]
    const ahead = a.samples[Math.min(a.samples.length - 1, closest + 18)]
    const here = a.samples[closest]
    // Curvature from the angle between the next stretch and the one after.
    const v1 = { x: target.x - here.x, z: target.z - here.z }
    const v2 = { x: ahead.x - target.x, z: ahead.z - target.z }
    const l1 = Math.hypot(v1.x, v1.z) || 1, l2 = Math.hypot(v2.x, v2.z) || 1
    const curvature = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.z * v2.z) / (l1 * l2))))

    let error = Math.atan2(target.z - p.z, target.x - p.x) - g.player.rotationY
    error = Math.atan2(Math.sin(error), Math.cos(error))
    const angular = g.vehicle.chassis.physical.body.angvel().y
    const steer = error + angular * 0.22
    const speed = g.vehicle.xzSpeed
    const wanted = Math.max(6.5, 13 - curvature * 6)

    if (speed < 1.5) a.stuck += 1 / 15
    else a.stuck = 0

    return {
      throttle: a.stuck > 2.5 && a.stuck < 4 ? -1 : speed > wanted + 1.2 ? 0 : 1,
      brake: speed > wanted + 1.2,
      steer: steer < -0.075 ? -1 : steer > 0.075 ? 1 : 0,
      done: a.done, at: closest, of: a.samples.length, x: p.x, z: p.z, stuck: a.stuck,
      speed: g.vehicle.xzSpeed, steerRaw: steer, wanted,
      y: p.y, ground: g.terrain.colliderHeightAt(p.x, p.z), wheels: g.vehicle.wheels.inContactCount,
      flipped: g.vehicle.upsideDown?.active ?? false, wedged: g.vehicle.stuck?.active ?? false,
      rescued: window.__autoRespawns.splice(0),
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
  await page.evaluate(({ route }) => window.__autoRoute(route), { route })
  const start = Date.now()
  let stalledAt = null
  let rescued = 0
  let end = { done: false, at: 0, of: route.length }
  while (Date.now() - start < budgetSeconds * 1000) {
    const c = await page.evaluate(() => window.__autoCommand())
    rescued += c.rescued?.length ?? 0
    end = { done: c.done, at: c.at, of: c.of }
    if (c.done) break
    await press('w', c.throttle > 0)
    await press('s', c.throttle < 0)
    await press('b', Boolean(c.brake))
    await press('a', c.steer < 0)
    await press('d', c.steer > 0)
    if (c.stuck > 6 && !stalledAt) stalledAt = `${c.x.toFixed(0)},${c.z.toFixed(0)} on leg ${c.at}/${c.of}`
    if (process.env.VERBOSE) console.log(`      at ${c.x.toFixed(0)},${c.z.toFixed(0)} leg ${c.at}/${c.of} v=${c.speed?.toFixed(1)} want=${c.wanted?.toFixed(1)} steer=${c.steerRaw?.toFixed(2)} thr=${c.throttle} stuck ${c.stuck.toFixed(1)} y=${c.y?.toFixed(1)}/${c.ground?.toFixed(1)} wheels=${c.wheels} flip=${c.flipped} wedge=${c.wedged}`)
    await page.waitForTimeout(70)
  }
  await release()
  const seconds = ((Date.now() - start) / 1000).toFixed(0)
  const covered = end.at / Math.max(1, end.of)
  // A road the engine carried the car along is not covered, however
  // far down it the respawn happened to land.
  const ok = (end.done || covered >= 0.9) && rescued === 0
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(22)} ${String(Math.round((end.at / Math.max(1, end.of)) * 100)).padStart(3)}% of the road in ${seconds}s` +
    `${stalledAt ? `  · stalled at ${stalledAt}` : ''}${rescued ? `  · RESPAWNED ${rescued}× — the engine finished this one` : ''}`,
  )
  await page.screenshot({ path: path.join(OUT, `${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`) })
  return ok
}

/*
  The roads. `_roads.mjs` is the source — it reads `roads` out of
  world.ts, ids hyphenated and `surface: 'dirt'` and all — but the
  fallback reads `geography.PATHS` out of the running world rather than
  crashing, because the failure mode that matters here is a harness
  that finds no roads and prints "0 road(s) the car could not cover".
*/
const ROADS = JSON.parse(process.env.ROADS_JSON ?? 'null')
  ?? await page.evaluate(() => window.__world.geography.PATHS.map((p) => ({
    id: p.id.replace(/_/g, '-'),
    points: p.points.map(([x, z]) => [x, z]),
  })))
if (!ROADS?.length) throw new Error('[loop] no roads to drive — see npm run world:loop')

const put = (x, z, rotation) => page.evaluate(({ x, z, rotation }) => {
  const g = window.__world
  const y = g.terrain.colliderHeightAt(x, z) + 2
  g.vehicle.moveTo({ x, y, z }, rotation)
  g.view.focusPoint.trackedPosition.set(x, y, z)
  g.view.snapToTarget()
}, { x, z, rotation })

console.log(`\nEVERY CARRIAGEWAY — ${ROADS.length} road(s), each driven end to end\n`)
let failures = 0
for (const road of ROADS.filter((r) => !ONLY || ONLY.includes(r.id))) {
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
  // The WHOLE polyline, not from the second point: the car starts a
  // quarter of the way along the first leg, and a route that begins at
  // the second vertex has the car twenty metres behind its own first
  // sample with nothing to measure progress against.
  if (!(await drive(road.id, road.points, Math.max(30, length * 0.34)))) failures++
}

console.log(`\n${failures} road(s) the car could not cover · see world-road-clearance.mjs for what is actually in them`)
console.log('and world-tour.mjs for whether they join up into a route a visitor can drive')
if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`)
await browser.close()
process.exit(failures ? 1 : 0)
