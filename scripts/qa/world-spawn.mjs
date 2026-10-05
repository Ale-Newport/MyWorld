/* /world initial spawn: in the Central Plaza (not the old far-west field), on
   fixed drivable ground, overlapping nothing, a clear 4 m from anything that
   moves, facing open ground with the chase camera behind, and settling where
   it is put — no drop, no launch, no camera fly-in. The same world gives the
   same spawn. A spawn pinned in the world document wins; a pinned spawn that is
   no longer a valid place falls back to the plaza.
   QA_BASE=http://localhost:3404 node scripts/qa/world-spawn.mjs */
import zlib from 'node:zlib'
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const LEGACY = { x: -118.55, z: -31.36 }

/** Serves the world document with a pinned spawn ([x, north, height] in map coordinates). */
async function pinSpawn(page, variant) {
  await page.route('**/api/world/blob/*', async (route) => {
    const response = await route.fetch(), body = await response.body()
    let doc
    try { doc = JSON.parse(zlib.gunzipSync(body).toString('utf8')) } catch { return route.fulfill({ response, body }) }
    if (doc?.schema !== 2 || !doc.states?.['v4:world']) return route.fulfill({ response, body })
    Object.assign(doc.states['v4:world'].data.worldVariant, variant)
    return route.fulfill({ response, body: zlib.gzipSync(Buffer.from(JSON.stringify(doc))) })
  })
}

/** Everything about the car from the first ready frame for `ms`. */
const trace = (page, ms) => page.evaluate(async (ms) => {
  const A = globalThis.__archipelago, d = A.driving, v = d.vehicle, b = v.chassis.physical.body, rows = [], t0 = performance.now()
  while (performance.now() - t0 < ms) {
    const lv = b.linvel()
    rows.push({ t: performance.now() - t0, y: v.position.y, vy: lv.y, speed: Math.hypot(lv.x, lv.z), contacts: v.wheels.inContactCount, cam: A.camera.position.distanceTo(v.position), up: v.upward.y })
    await new Promise((r) => requestAnimationFrame(r))
  }
  return rows
}, ms)

const pose = (page) => page.evaluate(async () => {
  const A = globalThis.__archipelago, T = A.THREE, d = A.driving, v = d.vehicle, P = d.placement, M = await import('/archipelago/preview/runtime/placement.js'), body = v.chassis.physical.body
  const plaza = M.centralPlaza(A.root), area = M.areaOf(plaza), floor = area.box, p = v.position
  const s = P.surface(p.x, p.z), heading = d.flatHeading(), rot = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), heading)
  // The car's own body box, a little inflated, against everything but the car.
  const overlap = A.physics.world.intersectionWithShape({ x: p.x, y: p.y + .1, z: p.z }, { x: rot.x, y: rot.y, z: rot.z, w: rot.w }, new A.physics.rapier.Cuboid(1.45, .45, .95), A.physics.rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, null, body)
  let nearestMoving = Infinity
  A.physics.world.forEachRigidBody((b) => { if (b === body || b.isFixed()) return; const t = b.translation(); nearestMoving = Math.min(nearestMoving, Math.hypot(t.x - p.x, t.z - p.z)) })
  const cam = A.camera.position.clone().sub(p).setY(0).normalize(), forward = v.forward.clone().setY(0).normalize()
  return {
    x: p.x, y: p.y, z: p.z, heading, source: d.home?.source, ground: s?.y, groundFixed: !!s?.collider?.parent()?.isFixed(), groundIsSurface: !!s?.ground, wheelsOnFixed: v.wheels.items.every((w) => w.groundCollider?.parent()?.isFixed()),
    inPlaza: !!floor && p.x > floor.min.x && p.x < floor.max.x && p.z > floor.min.z && p.z < floor.max.z, plazaCentre: [area.x, area.z], fromCentre: Math.hypot(p.x - area.x, p.z - area.z),
    overlap: overlap ? (overlap.parent()?.userData?.physical?.node?.name ?? 'collider') : null, nearestMoving, run: P.run(p.x, s.y, p.z, heading),
    cameraBehind: -cam.dot(forward), cameraDistance: A.camera.position.distanceTo(p),
  }
})

/* ---- 1. the default world: the Central Plaza ---- */
let page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
let errors = watch(page)
await openPlayer(page)
const settle = await trace(page, 2200)
const spawn = await pose(page)
await page.screenshot({ path: out('spawn-plaza.png') })
const first = settle[0], last = settle.at(-1), rest = spawn.ground + 1.1
assert(spawn.source === 'plaza' && spawn.inPlaza, `spawn is inside the Central Plaza (${spawn.x.toFixed(2)}, ${spawn.z.toFixed(2)}; ${spawn.fromCentre.toFixed(1)} m from its centre)`, results)
assert(Math.hypot(spawn.x - LEGACY.x, spawn.z - LEGACY.z) > 60, `the old far-west spawn is not used (${Math.hypot(spawn.x - LEGACY.x, spawn.z - LEGACY.z).toFixed(0)} m away)`, results)
assert(spawn.groundFixed && spawn.groundIsSurface && spawn.wheelsOnFixed, 'on fixed, drivable ground (support and all four tyres)', results)
assert(spawn.overlap === null, `the car's body overlaps nothing (${spawn.overlap})`, results)
assert(spawn.nearestMoving >= 4, `nothing that moves within 4 m (nearest ${spawn.nearestMoving.toFixed(1)} m)`, results)
assert(Math.abs(last.vy) < 0.3 && last.speed < 0.05, `settled after 2 s (|vy| ${Math.abs(last.vy).toFixed(3)} m/s, speed ${last.speed.toFixed(3)} m/s)`, results)
assert(Math.abs(last.y - rest) < 0.3, `at ride height (y ${last.y.toFixed(3)}, rest ${rest.toFixed(3)})`, results)
assert(Math.max(...settle.map((r) => r.y)) <= first.y + 0.05 && first.y - last.y < 0.15, `no launch and no drop (first ${first.y.toFixed(3)}, highest ${Math.max(...settle.map((r) => r.y)).toFixed(3)}, last ${last.y.toFixed(3)})`, results)
assert(settle.every((r) => r.contacts === 4 && r.up > 0.99), 'four wheels down and upright throughout', results)
assert(spawn.run >= 10, `facing open ground (${spawn.run.toFixed(1)} m clear ahead)`, results)
assert(spawn.cameraBehind > 0.6, `the chase camera is behind the car (cos ${spawn.cameraBehind.toFixed(2)})`, results)
assert(settle.every((r) => r.cam > 18 && r.cam < 25), `the camera starts at its normal distance, no fly-in (${Math.min(...settle.map((r) => r.cam)).toFixed(1)}–${Math.max(...settle.map((r) => r.cam)).toFixed(1)} m)`, results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await page.close()

/* ---- 2. a pinned spawn wins ---- */
page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
errors = watch(page)
const PIN = { x: -104.4, z: 0, heading: Math.PI / 2 }
await pinSpawn(page, { spawn: [PIN.x, -PIN.z, 1.3], spawnHeading: PIN.heading, spawnPinned: true })
await openPlayer(page)
await sleep(1500)
const pinned = await pose(page)
assert(pinned.source === 'pinned' && Math.hypot(pinned.x - PIN.x, pinned.z - PIN.z) < 1.5, `a pinned spawn wins (${pinned.source} at ${pinned.x.toFixed(2)}, ${pinned.z.toFixed(2)})`, results)
assert(Math.abs(Math.atan2(Math.sin(pinned.heading - PIN.heading), Math.cos(pinned.heading - PIN.heading))) < 0.05, `with its heading (${(pinned.heading * 180 / Math.PI).toFixed(1)}°)`, results)
assert(pinned.overlap === null && pinned.groundFixed, 'and is validated like any other placement', results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await page.close()

/* ---- 3. a pinned spawn that is no longer a place (in the sea) falls back to the plaza, identically ---- */
page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
errors = watch(page)
const warnings = []
page.on('console', (m) => { if (m.type() === 'warning' && /pinned drive spawn/i.test(m.text())) warnings.push(m.text()) })
await pinSpawn(page, { spawn: [-150, 0, 1.3], spawnHeading: 0, spawnPinned: true })
await openPlayer(page)
await sleep(800)
const fallback = await pose(page)
assert(fallback.source === 'plaza' && warnings.length === 1, `an invalid pinned spawn falls back to the plaza, with a warning (${fallback.source}, ${warnings.length})`, results)
assert(Math.hypot(fallback.x - spawn.x, fallback.z - spawn.z) < 0.01 && Math.abs(fallback.heading - spawn.heading) < 1e-3, `the same world gives the same spawn (Δ ${Math.hypot(fallback.x - spawn.x, fallback.z - spawn.z).toFixed(3)} m)`, results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
console.log('spawn', JSON.stringify({ x: +spawn.x.toFixed(2), z: +spawn.z.toFixed(2), heading: +(spawn.heading * 180 / Math.PI).toFixed(1), run: +spawn.run.toFixed(1), y: settle.filter((_, i) => i % 15 === 0).map((r) => +r.y.toFixed(3)) }))
await browser.close()
finish(results)
