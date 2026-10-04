/**
 * Measures how the car actually corners, on the circuit tarmac and on plain
 * island ground, and names the surface its wheels were standing on while it
 * did. Nothing here is simulated twice: it drives the live `window.__world2`.
 *
 * Run: node scripts/world2-grip-qa.mjs [http://localhost:3000]
 */
import { chromium } from 'playwright'

const base = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:3000'
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const failures = []
const check = (name, pass, detail) => {
  console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail))
  if (!pass) failures.push(name)
}

await page.goto(`${base}/world2`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__world2 !== 'undefined', { timeout: 180000 })
await page.waitForFunction(() => window.__world2?.status.ready, { timeout: 180000 })
await page.getByRole('button', { name: 'Start driving' }).click()
await page.waitForTimeout(1500)

/**
 * One corner, taken the same way every time: accelerate straight to a target
 * speed, then hold full lock for two seconds. Yaw is ACCUMULATED per sample —
 * a final heading wraps at 180 degrees, which is exactly the trap that made an
 * earlier round conclude grip stops helping at 2.
 */
const corner = (x, z, facing) => page.evaluate(async ([x, z, facing]) => {
  const g = window.__world2
  const wait = ms => new Promise(r => setTimeout(r, ms))
  g.vehicle.moveTo({ x, y: 1.2, z }, facing)
  await wait(400)
  const drive = (steer, accelerate) => {
    // Player.updatePrePhysics rewrites the vehicle input every fixed step, so
    // the only way to hold a control is to hold the ACTION the player reads.
    const set = (name, active) => {
      const action = g.inputs.actions.get(name)
      if (action) { action.active = active; action.value = active ? 1 : 0 }
    }
    set('forward', accelerate)
    set('left', steer < 0)
    set('right', steer > 0)
  }
  const heading = () => Math.atan2(g.vehicle.forward.z, g.vehicle.forward.x)
  drive(0, true)
  await wait(2600)
  const speed = g.vehicle.speedKmh
  const start = { x: g.player.position.x, z: g.player.position.z }
  let last = heading()
  let yaw = 0
  const surfaces = new Set()
  drive(1, true)
  for (let i = 0; i < 60; i++) {
    await wait(33)
    const now = heading()
    let step = now - last
    while (step > Math.PI) step -= Math.PI * 2
    while (step < -Math.PI) step += Math.PI * 2
    yaw += step
    last = now
    for (const wheel of g.vehicle.wheels.items) {
      const body = wheel.groundCollider?.parent()
      const owner = body?.userData?.physical?.owner
      if (typeof owner === 'string') surfaces.add(owner)
    }
  }
  const end = { x: g.player.position.x, z: g.player.position.z }
  drive(0, false)
  return {
    entrySpeed: Math.round(speed),
    yawDeg: Math.round(Math.abs(yaw) * 180 / Math.PI),
    travelled: Math.round(Math.hypot(end.x - start.x, end.z - start.z) * 10) / 10,
    surfaces: [...surfaces],
  }
}, [x, z, facing])

const grip = await page.evaluate(() => {
  const g = window.__world2
  // `refRoadPhysicalFixed` is an authored body; `refRoad` is a visual mesh the
  // environment fits a trimesh to in its fallback pass, which never reaches
  // `environment.physicals`. Both are found by the owner tag they share.
  const at = name => {
    const physical = g.physics.physicals.find(p => p.owner === name)
    const collider = physical?.body.collider(0)
    return collider ? g.vehicle.surfaceFriction(collider) : null
  }
  return { road: at('refRoadPhysicalFixed'), ribbon: at('refRoad'), island: g.vehicle.surfaceFriction(null) }
})
check('the circuit tarmac grips harder than the island', grip.road > grip.island, grip)
check('both halves of the tarmac carry the same grip', grip.road === grip.ribbon, grip)

// A long straight on the circuit, and an open stretch of island beside it.
// The grid, which is on the racing line by definition. Its own heading comes
// with it, so the run starts down the track rather than across it.
const grid = await page.evaluate(() => {
  const g = window.__world2
  const t = g.interactions.references.transform('refStart')
  if (!t) return null
  const forward = new (t.position.constructor)(1, 0, 0).applyQuaternion(t.quaternion)
  return { x: t.position.x, z: t.position.z, facing: Math.atan2(forward.z, forward.x) }
})
const onRoad = await corner(grid.x, grid.z, grid.facing)
const onIsland = await corner(-6, 36, 0)
check('the car turns in on the circuit', onRoad.yawDeg >= 120, onRoad)
check('the wheels were actually on the tarmac', onRoad.surfaces.some(s => /road/i.test(s)), onRoad.surfaces)
check('the island still drives like the island', onIsland.yawDeg > 0, onIsland)
console.log(`\n${failures.length ? `${failures.length} FAILED` : 'all checks passed'}`)
await browser.close()
process.exit(failures.length ? 1 : 0)
