/**
 * /world QA harness — drives the car and reports on it.
 *
 *   node scripts/world-qa.mjs [baseUrl] [--headed] [--only=name,name]
 *
 * The interactive world cannot be checked by looking at it. A car
 * that renders is not a car that drives, and a screenshot cannot
 * tell you whether the suspension settles, whether a ramp launches
 * or whether leaving the route frees the GPU.
 *
 * So this drives it: it presses keys, waits, and reads telemetry
 * back out of the running engine through `window.__world`, which
 * the Game exposes in development only.
 *
 * Screenshots land in `.qa/world/`. Anything that fails prints a
 * line beginning with FAIL and sets a non-zero exit code.
 */
import { chromium } from 'playwright'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const HEADED = args.includes('--headed')
const ONLY = args.find((a) => a.startsWith('--only='))?.slice('--only='.length).split(',')
const OUT = path.resolve('.qa/world')

const failures = []
const notes = []

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
    failures.push(name)
  }
}

function note(text) {
  console.log(`  note  ${text}`)
  notes.push(text)
}

/* ---------------------------------------------------------- */

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: !HEADED,
  args: [
    // Software WebGL in headless Chromium is available but slow;
    // these keep it deterministic rather than fast.
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--disable-frame-rate-limit',
  ],
})

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
})
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300))
})
page.on('pageerror', (e) => consoleErrors.push(`PAGEERROR ${String(e).slice(0, 300)}`))

/* ---- helpers --------------------------------------------- */

const telemetry = () =>
  page.evaluate(() => {
    const g = window.__world
    if (!g?.vehicle) return null
    const b = g.vehicle.chassis.physical.body
    return {
      elapsed: g.ticker.elapsed,
      fps: g.ticker.fps,
      substeps: g.ticker.substeps,
      x: g.player.position.x,
      y: g.player.position.y,
      z: g.player.position.z,
      speed: g.vehicle.speed,
      xzSpeed: g.vehicle.xzSpeed,
      speedKmh: g.vehicle.speedKmh,
      wheelsDown: g.vehicle.wheels.inContactCount,
      suspension0: g.vehicle.wheels.items[0].suspensionLength,
      upsideDown: g.vehicle.upsideDown.active,
      stuck: g.vehicle.stuck.active,
      linvel: b.linvel(),
      terrainY: g.terrain.colliderHeightAt(g.player.position.x, g.player.position.z),
      groundY: g.physics.groundAt(g.player.position.x, g.player.position.z),
      district: g.store.getState().district,
      bodies: g.physics.world.bodies.len(),
      colliders: g.physics.world.colliders.len(),
      drawCalls: g.renderer.instance.info.render.calls,
      geometries: g.renderer.instance.info.memory.geometries,
      textures: g.renderer.instance.info.memory.textures,
      programs: g.renderer.instance.info.programs?.length ?? 0,
      quality: g.quality.level,
    }
  })

const settle = (ms) => page.waitForTimeout(ms)

async function hold(key, ms) {
  await page.keyboard.down(key)
  await settle(ms)
  await page.keyboard.up(key)
}

async function shot(name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
}

async function teleport(x, z, rotation = 0) {
  await page.evaluate(
    ({ x, z, rotation }) => {
      const g = window.__world
      const y = g.terrain.colliderHeightAt(x, z) + 2.5
      g.vehicle.moveTo({ x, y, z }, rotation)
      g.view.focusPoint.trackedPosition.set(x, y, z)
      g.view.snapToTarget()
    },
    { x, z, rotation },
  )
  await settle(700)
}

const should = (name) => !ONLY || ONLY.includes(name)

/* ---- boot ------------------------------------------------ */

console.log(`\n/world QA — ${BASE}\n`)
console.log('BOOT')

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })

await page.waitForFunction(() => {
  const button = Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === 'ENTER',
  )
  return Boolean(button && !button.disabled)
}, { timeout: 120000 })
check('loader reaches ENTER', true)

await shot('01-loader')

await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await settle(1400)

await page.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 30000 })
const boot = await telemetry()
check('engine exposes telemetry', Boolean(boot))
check('render loop is running', boot.elapsed > 0.4, `elapsed ${boot.elapsed.toFixed(2)}s`)
note(`quality ${boot.quality}, ${Math.round(boot.fps)} fps, ${boot.bodies} bodies, ${boot.colliders} colliders`)

/* ---- the car falls and settles --------------------------- */

if (should('settle')) {
  console.log('\nSETTLE')
  await settle(1500)
  const rest = await telemetry()
  const rideHeight = rest.y - rest.terrainY
  check('car is on the ground', rest.wheelsDown === 4, `${rest.wheelsDown}/4 wheels`)
  check(
    'ride height is sane',
    rideHeight > 0.9 && rideHeight < 1.9,
    `${rideHeight.toFixed(2)} m above terrain`,
  )
  check('car is at rest', Math.abs(rest.linvel.y) < 0.4, `linvel.y ${rest.linvel.y.toFixed(3)}`)
  check('collider matches heightfield', Math.abs(rest.groundY - rest.terrainY) < 0.05,
    `ray ${rest.groundY?.toFixed(3)} vs field ${rest.terrainY.toFixed(3)}`)
  await shot('02-settled')
}

/* ---- acceleration ---------------------------------------- */

if (should('drive')) {
  console.log('\nDRIVE')
  const before = await telemetry()
  await hold('KeyW', 2500)
  const after = await telemetry()
  const travelled = Math.hypot(after.x - before.x, after.z - before.z)
  check('accelerates forward', travelled > 12, `travelled ${travelled.toFixed(1)} m in 2.5 s`)
  check('reaches cruising speed', after.speed > 3.5, `speed ${after.speed.toFixed(2)}`)
  note(`cruise ${after.speedKmh.toFixed(0)} km/h`)
  await shot('03-driving')

  await settle(2200)
  const coasted = await telemetry()
  check('coasts to a stop', coasted.speed < 0.6, `speed ${coasted.speed.toFixed(3)}`)
}

/* ---- boost ----------------------------------------------- */

if (should('boost')) {
  console.log('\nBOOST')
  await teleport(0, 60, Math.PI)
  const before = await telemetry()
  await page.keyboard.down('KeyW')
  await settle(700)
  const cruise = (await telemetry()).speed
  await page.keyboard.down('ShiftLeft')
  await settle(2200)
  const boosted = await telemetry()
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  check('boost increases speed', boosted.speed > cruise * 1.6,
    `${cruise.toFixed(2)} → ${boosted.speed.toFixed(2)}`)
  note(`boosted ${boosted.speedKmh.toFixed(0)} km/h`)
  void before
  await shot('04-boost')
}

/* ---- steering -------------------------------------------- */

if (should('steer')) {
  console.log('\nSTEER')
  await teleport(0, 40, 0)
  await page.keyboard.down('KeyW')
  await settle(900)
  const before = await telemetry()
  await page.keyboard.down('KeyA')
  await settle(1800)
  const after = await telemetry()
  await page.keyboard.up('KeyA')
  await page.keyboard.up('KeyW')

  const headingBefore = Math.atan2(before.linvel.z, before.linvel.x)
  const headingAfter = Math.atan2(after.linvel.z, after.linvel.x)
  let delta = headingAfter - headingBefore
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  check('steering turns the car', Math.abs(delta) > 0.5,
    `heading changed ${(delta * 180 / Math.PI).toFixed(0)}°`)
  check('car stays upright while turning', !after.upsideDown)
  await shot('05-steering')
}

/* ---- braking --------------------------------------------- */

if (should('brake')) {
  console.log('\nBRAKE')
  await teleport(0, 60, Math.PI)
  await hold('KeyW', 1600)
  const rolling = await telemetry()
  await hold('KeyB', 900)
  const braked = await telemetry()
  check('brake sheds speed', braked.speed < rolling.speed * 0.55,
    `${rolling.speed.toFixed(2)} → ${braked.speed.toFixed(2)}`)
}

/* ---- jump ------------------------------------------------ */

if (should('jump')) {
  console.log('\nJUMP')
  await teleport(0, 20, 0)
  await settle(600)
  const before = await telemetry()
  await page.keyboard.down('Space')
  await settle(240)
  let peak = before.y
  for (let i = 0; i < 14; i++) {
    await settle(60)
    const t = await telemetry()
    peak = Math.max(peak, t.y)
  }
  await page.keyboard.up('Space')
  check('jump leaves the ground', peak - before.y > 0.55,
    `rose ${(peak - before.y).toFixed(2)} m`)
  await settle(1600)
  const landed = await telemetry()
  check('lands back on its wheels', landed.wheelsDown >= 3 && !landed.upsideDown,
    `${landed.wheelsDown}/4 wheels`)
  await shot('06-jump')
}

/* ---- collisions ------------------------------------------ */

if (should('collide')) {
  console.log('\nCOLLIDE')
  // Drive into the world edge slope and make sure nothing tunnels.
  await teleport(0, 0, 0)
  const start = await telemetry()
  await page.keyboard.down('KeyW')
  await page.keyboard.down('ShiftLeft')
  await settle(6000)
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  const end = await telemetry()
  check('never falls through the world', end.y > end.terrainY - 1.5,
    `y ${end.y.toFixed(2)} vs terrain ${end.terrainY.toFixed(2)}`)
  check('travelled a long way under boost',
    Math.hypot(end.x - start.x, end.z - start.z) > 80,
    `${Math.hypot(end.x - start.x, end.z - start.z).toFixed(0)} m`)
  await shot('07-far')
}

/* ---- respawn --------------------------------------------- */

if (should('respawn')) {
  console.log('\nRESPAWN')
  await page.keyboard.press('KeyR')
  await settle(1200)
  const respawned = await telemetry()
  check('respawn puts the car on solid ground',
    Math.abs(respawned.y - respawned.terrainY) < 6,
    `y ${respawned.y.toFixed(2)} vs terrain ${respawned.terrainY.toFixed(2)}`)
  check('respawn is not stuck', !respawned.stuck)
}

/* ---- upside-down recovery -------------------------------- */

if (should('flip')) {
  console.log('\nFLIP RECOVERY')
  await page.evaluate(() => {
    const g = window.__world
    const b = g.vehicle.chassis.physical.body
    const t = b.translation()
    b.setTranslation({ x: t.x, y: t.y + 2, z: t.z }, true)
    // Roll it onto its roof.
    b.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true)
    b.setLinvel({ x: 0, y: 0, z: 0 }, true)
    b.setAngvel({ x: 0, y: 0, z: 0 }, true)
  })
  await settle(900)
  const flipped = await telemetry()
  check('detects being upside down', flipped.upsideDown)
  await shot('08-upside-down')
  // Player waits 3 s, then hops it back over. Give it two attempts.
  await settle(9000)
  const recovered = await telemetry()
  check('rights itself without input', !recovered.upsideDown)
}

/* ---- overlays -------------------------------------------- */

if (should('ui')) {
  console.log('\nUI')
  await page.keyboard.press('Escape')
  await settle(500)
  check('escape opens the pause menu',
    await page.getByText('Back to portfolio', { exact: false }).isVisible())
  await shot('09-pause')

  const drivingBlocked = await page.evaluate(() => {
    const g = window.__world
    return g.inputs.filters.has('ui')
  })
  check('pause blocks driving input', drivingBlocked)

  await page.keyboard.press('Escape')
  await settle(400)
  const resumed = await page.evaluate(() => window.__world.inputs.filters.size)
  check('closing the menu restores driving', resumed === 0)
}

/* ---- teardown -------------------------------------------- */

if (should('teardown')) {
  console.log('\nTEARDOWN')
  const before = await telemetry()
  await page.evaluate(() => {
    const g = window.__world
    window.__teardown = {
      geometriesBefore: g.renderer.instance.info.memory.geometries,
      texturesBefore: g.renderer.instance.info.memory.textures,
    }
  })
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await settle(2500)
  const cleaned = await page.evaluate(() => ({
    handle: Boolean(window.__world),
    canvases: document.querySelectorAll('canvas').length,
  }))
  check('game handle is released on leaving', !cleaned.handle)
  note(`${before.geometries} geometries and ${before.textures} textures were live before leaving`)
  note(`${cleaned.canvases} canvas element(s) on the home page after returning`)

  // Go back in and make sure a second world starts cleanly — the
  // case that a shared canvas or a leaked singleton would break.
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.textContent?.trim() === 'ENTER',
    )
    return Boolean(b && !b.disabled)
  }, { timeout: 120000 })
  await page.getByRole('button', { name: 'ENTER', exact: true }).click()
  await settle(2500)
  const second = await telemetry()
  check('a second visit starts cleanly', Boolean(second) && second.elapsed > 0.4,
    second ? `elapsed ${second.elapsed.toFixed(2)}s` : 'no telemetry')
  await shot('10-second-visit')
}

/* ---- report ---------------------------------------------- */

console.log('\nCONSOLE')
const realErrors = consoleErrors.filter(
  (e) => !/DevTools|preloaded using link preload|deprecated parameters/i.test(e),
)
check('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '))

await writeFile(
  path.join(OUT, 'report.json'),
  JSON.stringify({ base: BASE, failures, notes, consoleErrors: realErrors }, null, 2),
)

await browser.close()

console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
console.log(`screenshots → ${OUT}\n`)
process.exit(failures.length === 0 ? 0 : 1)
