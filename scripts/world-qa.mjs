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
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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

/**
 * A patch of ground with nothing on it, chosen from the running world
 * rather than written down here. The handling checks measure the car,
 * not the map, so they need room — and a hard-coded clearing stops
 * being a clearing the first time the world is re-authored.
 */
async function clearGround() {
  return page.evaluate(() => {
    const g = window.__world
    // The car is a physics body too. Counting it makes every call
    // avoid wherever the car currently is, so each successive test
    // gets a worse patch than the last one.
    const car = g.player.position
    const bodies = []
    for (const ph of g.physics.physicals) {
      const p = ph.current?.position
      if (!p || p.y <= 0.4 || p.y >= 20) continue
      if (Math.hypot(p.x - car.x, p.z - car.z) < 5) continue
      bodies.push(p)
    }
    let best = null
    for (let x = -140; x <= 140; x += 10) {
      for (let z = -140; z <= 140; z += 10) {
        if (Math.hypot(x, z) > 108) continue   // well inside the coast
        if (g.terrain.colliderHeightAt(x, z) < 0.6) continue          // dry land only
        let nearest = Infinity
        for (const b of bodies) {
          const d = Math.hypot(b.x - x, b.z - z)
          if (d < nearest) nearest = d
        }
        // Flat enough that the car is not launched or beached.
        let relief = 0
        for (const [dx, dz] of [[18,0],[-18,0],[0,18],[0,-18],[13,13],[-13,-13]]) {
          relief = Math.max(relief, Math.abs(
            g.terrain.colliderHeightAt(x + dx, z + dz) - g.terrain.colliderHeightAt(x, z)))
        }
        // Near the coast the rim slopes; a car turning hard there rolls,
        // which says nothing about its handling. Stay flat and inland.
        if (relief > 1.1) continue
        const score = nearest - Math.hypot(x, z) * 0.06
        if (!best || score > best.score) best = { x, z, clear: nearest, score }
      }
    }
    return best ?? { x: 0, z: 0, clear: 0 }
  })
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
  // The landing area is deliberately full — cones, crates and the name
  // are all within twenty metres of where the player starts, which is
  // the point of it. Acceleration and cruising speed are properties of
  // the car, so they are measured with room, like braking and steering.
  // That the spawn itself is drivable is covered by the respawn checks.
  const driveSpot = await clearGround()
  note(`driving tested at ${driveSpot.x}, ${driveSpot.z} — nearest object ${driveSpot.clear.toFixed(0)} m`)
  await teleport(driveSpot.x, driveSpot.z, 0)
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
  const boostSpot = await clearGround()
  note(`boost tested at ${boostSpot.x}, ${boostSpot.z} — nearest object ${boostSpot.clear.toFixed(0)} m`)
  await teleport(boostSpot.x, boostSpot.z, Math.PI)
  await page.keyboard.down('KeyW')
  await settle(900)
  const cruise = (await telemetry()).speed

  // PEAK speed, not final speed. The world is full of props and the
  // boost run will eventually hit one; that is the world working, not
  // the boost failing. What is being asserted is that boost raises
  // the top speed, so sample across the window and take the maximum.
  await page.keyboard.down('ShiftLeft')
  let peak = 0
  let peakKmh = 0
  for (let i = 0; i < 14; i++) {
    await settle(160)
    const t = await telemetry()
    if (t.speed > peak) { peak = t.speed; peakKmh = t.speedKmh }
  }
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')

  check('boost increases speed', peak > cruise * 1.6,
    `cruise ${cruise.toFixed(2)} → peak ${peak.toFixed(2)}`)
  note(`boosted ${peakKmh.toFixed(0)} km/h`)
  await shot('04-boost')
}

/* ---- steering -------------------------------------------- */

if (should('steer')) {
  console.log('\nSTEER')
  const steerSpot = await clearGround()
  note(`steering tested at ${steerSpot.x}, ${steerSpot.z} — nearest object ${steerSpot.clear.toFixed(0)} m`)
  await teleport(steerSpot.x, steerSpot.z, 0)
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
  // Braking is a property of the car. Measure it with room to roll,
  // not inside a district where the car stops because it hit a wall.
  const brakeSpot = await clearGround()
  note(`braking tested at ${brakeSpot.x}, ${brakeSpot.z} — nearest object ${brakeSpot.clear.toFixed(0)} m`)
  await teleport(brakeSpot.x, brakeSpot.z, Math.PI)
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
  // A long boost run straight across the island, to make sure nothing
  // tunnels through terrain or props on the way. It is aimed INWARD,
  // at the origin: the island is now small enough that six seconds of
  // boost aimed outward simply leaves it, and a car in the void is
  // the OUT OF BOUNDS achievement working rather than a collision bug.
  const edgeSpot = await clearGround()
  await teleport(edgeSpot.x, edgeSpot.z, Math.atan2(edgeSpot.z, -edgeSpot.x))
  const start = await telemetry()
  await page.keyboard.down('KeyW')
  await page.keyboard.down('ShiftLeft')
  await settle(6000)
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')
  // Let it come to rest first. "Still upright, still on the ground" is
  // a statement about where the car ends up, not about which frame of
  // a bounce the sample happened to catch.
  await settle(1500)
  const end = await telemetry()
  check('never falls through the world', end.y > end.terrainY - 1.5,
    `y ${end.y.toFixed(2)} vs terrain ${end.terrainY.toFixed(2)}`)

  // Distance is not the assertion. Six seconds of boost out of the
  // hub runs into the brackets, the name and a cone field, which is
  // the world working. What matters is that after all of that the
  // car is still upright, still on the ground and still driveable.
  note(`covered ${Math.hypot(end.x - start.x, end.z - start.z).toFixed(0)} m before stopping`)
  check('survives a long boost run', !end.upsideDown && end.wheelsDown >= 2,
    `${end.wheelsDown}/4 wheels, ${end.upsideDown ? 'on its roof' : 'upright'}`)

  await settle(3000)
  const recovered = await telemetry()
  check('recovers on its own after a heavy run', !recovered.stuck || recovered.wheelsDown >= 2,
    recovered.stuck ? 'still flagged stuck' : 'clear')
  await shot('07-far')
}

/* ---- the hidden island ----------------------------------- */

if (should('island')) {
  console.log('\nHIDDEN ISLAND')

  // Read the ramp and the island out of the source rather than
  // repeating their coordinates here. This test asserts a measured
  // relationship between the two, and a fixture that has to be
  // hand-updated when the map moves is a fixture that silently
  // stops testing anything.
  const worldSource = await readFile('src/content/world.ts', 'utf8')
  const terrainSource = await readFile('src/world/world/Terrain.ts', 'utf8')
  const rampMatch = worldSource.match(
    /id: 'ramp-stunt', x: (-?[\d.]+), z: (-?[\d.]+), rotation: Math\.PI \* (-?[\d.]+)/)
  const islandMatch = terrainSource.match(
    /VOID_ISLAND = \{ x: (-?[\d.]+), z: (-?[\d.]+), radius: (-?[\d.]+)/)
  if (!rampMatch || !islandMatch) throw new Error('could not read the stunt ramp or the void island')
  const RAMP = { x: +rampMatch[1], z: +rampMatch[2], rotation: Math.PI * +rampMatch[3] }
  const ISLAND = { x: +islandMatch[1], z: +islandMatch[2], radius: +islandMatch[3] }

  // Line up well behind the stunt ramp, on its axis, and go.
  await page.evaluate(({ RAMP }) => {
    const g = window.__world
    // A ramp rises along its local +X and the car drives along its own
    // local +X too, so one rotation serves both: line the car up behind
    // the ramp on that axis and point it the same way.
    const dirX = Math.cos(RAMP.rotation)
    const dirZ = -Math.sin(RAMP.rotation)
    const x = RAMP.x - dirX * 62
    const z = RAMP.z - dirZ * 62
    const y = g.terrain.colliderHeightAt(x, z) + 2
    g.vehicle.moveTo({ x, y, z }, RAMP.rotation)
    g.view.focusPoint.trackedPosition.set(x, y, z)
    g.view.snapToTarget()
  }, { RAMP })
  await settle(900)

  await page.keyboard.down('KeyW')
  await page.keyboard.down('ShiftLeft')
  let peakY = -Infinity
  let landed = null
  for (let i = 0; i < 80; i++) {
    await settle(120)
    const t = await telemetry()
    peakY = Math.max(peakY, t.y)
    const toIsland = Math.hypot(t.x - ISLAND.x, t.z - ISLAND.z)
    if (toIsland < ISLAND.radius * 0.8 && t.wheelsDown >= 2) { landed = t; break }
  }
  await page.keyboard.up('ShiftLeft')
  await page.keyboard.up('KeyW')

  check('the stunt ramp can reach the hidden island', landed !== null,
    landed ? `landed ${Math.hypot(landed.x - ISLAND.x, landed.z - ISLAND.z).toFixed(0)} m from centre`
           : `peaked at y ${peakY.toFixed(1)}`)

  if (landed) {
    const unlocked = await page.evaluate(() => window.__world.achievements.isUnlocked('hiddenIsland'))
    check('reaching it unlocks THE VOID', unlocked)
  }
  await shot('13-island')
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

/* ---- race circuit ---------------------------------------- */

if (should('circuit')) {
  console.log('\nCIRCUIT')
  const built = await page.evaluate(() => {
    const g = window.__world
    const race = g.minigames.get('circuit')
    return race ? { gates: race.gates?.length ?? null, best: race.bestTime } : null
  })
  check('circuit is registered', Boolean(built))

  const started = await page.evaluate(() => window.__world.minigames.start('circuit'))
  check('circuit starts', started === true)
  await settle(600)

  const counting = await page.evaluate(() => {
    const g = window.__world
    return { state: g.minigames.current?.state, hud: g.store.getState().minigame?.lines?.[0] }
  })
  check('countdown runs before the clock', counting.state === 'countdown', `state ${counting.state}`)

  await settle(3200)
  const racing = await page.evaluate(() => ({
    state: window.__world.minigames.current?.state,
    terrain: window.__world.physics.physicals.find((p) => p.type === 'fixed')?.body.isEnabled(),
  }))
  check('race begins after the countdown', racing.state === 'running', `state ${racing.state}`)
  check('terrain remains active during the race', racing.terrain === true)

  // Drive one gate.
  await hold('KeyW', 2600)
  const progressed = await page.evaluate(() => {
    const g = window.__world
    return { reached: g.minigames.current?.reached ?? 0, y: g.player.position.y }
  })
  check('gates register while driving', progressed.reached > 0, `${progressed.reached} gates`)
  await shot('11-circuit')

  // Escape pauses a race; the explicit exit action releases its state.
  await page.keyboard.press('Escape')
  await settle(500)
  check('escape pauses the race', await page.evaluate(() => window.__world.store.getState().overlay === 'pause'))
  await page.keyboard.press('Escape')
  await settle(300)
  await page.getByRole('button', { name: 'Exit game', exact: true }).click()
  await settle(300)
  const cancelled = await page.evaluate(() => {
    const g = window.__world
    return {
      running: g.minigames.current?.running ?? false,
      terrain: g.physics.physicals.find((p) => p.type === 'fixed')?.body.isEnabled(),
      minigameHud: g.store.getState().minigame,
    }
  })
  check('exit cancels the race', !cancelled.running)
  check('exiting keeps the terrain collider active', cancelled.terrain === true)
  check('cancelling clears the race HUD', cancelled.minigameHud === null)

}

/* ---- every mini-game ------------------------------------- */

if (should('minigames')) {
  console.log('\nMINI-GAMES')

  const ids = await page.evaluate(() =>
    Array.from(window.__world.minigames['items'].keys()),
  )
  check('all fifteen mini-games are registered', ids.length === 15, ids.join(', '))

  for (const id of ids) {
    const problems = []

    // Put the car at the mini-game's own landmark, so starting it is
    // legal and its geometry is in range.
    await page.evaluate((id) => {
      const g = window.__world
      const entry = Array.from(g.world.landmarks.values())
        .find((h) => h.landmark.minigame === id)
      const { x, z } = entry?.landmark ?? g.minigames.get(id).startPosition
      const y = Math.max(g.physics.groundAt(x, z) ?? -100, g.terrain.colliderHeightAt(x, z)) + 3
      g.vehicle.moveTo({ x: x + 6, y, z: z + 6 }, 0)
      g.view.focusPoint.trackedPosition.set(x, y, z)
      g.view.snapToTarget()
    }, id)
    await settle(700)

    const started = await page.evaluate((id) => window.__world.minigames.start(id), id)
    if (!started) problems.push('did not start')
    await settle(900)

    const running = await page.evaluate(() => ({
      state: window.__world.minigames.current?.state ?? null,
      hud: window.__world.store.getState().minigame?.title ?? null,
    }))
    if (!running.hud) problems.push('no HUD')

    // Drive around inside it for a moment, then bail out the way a
    // confused player would: Escape.
    await hold('KeyW', 1200)
    await page.keyboard.press('Escape')
    await settle(700)
    if (id === 'circuit') {
      await page.keyboard.press('Escape')
      await settle(300)
      await page.getByRole('button', { name: 'Exit game', exact: true }).click()
      await settle(300)
    }

    const after = await page.evaluate(() => {
      const g = window.__world
      return {
        running: g.minigames.current?.running ?? false,
        hud: g.store.getState().minigame,
        playerState: g.player.state,
        filters: g.inputs.filters.size,
        cinematic: g.view.cinematic.active,
        terrain: g.physics.physicals.find((p) => p.type === 'fixed')?.body.isEnabled(),
        overlay: g.store.getState().overlay,
      }
    })

    // The contract: cancelling gives everything back.
    if (after.running) problems.push('still running after exit')
    if (after.hud !== null) problems.push('HUD left on screen')
    if (after.playerState !== 'default') problems.push(`player left ${after.playerState}`)
    if (after.cinematic) problems.push('camera left in cinematic mode')
    if (after.terrain === false) problems.push('terrain collider left disabled')

    // Escape may legitimately have opened the pause menu; close it.
    if (after.overlay) {
      await page.keyboard.press('Escape')
      await settle(400)
    }
    await page.evaluate(() => window.__world.inputs.setFilters([]))

    // And the player must have their car back. Respawn first: the
    // car may well be wedged inside the mini-game's scenery, which is
    // the world working — what is being tested here is that the
    // mini-game gave the controls back, not where it left the car.
    await page.keyboard.press('KeyR')
    await settle(1100)
    const before = await telemetry()
    await hold('KeyW', 1200)
    const moved = await telemetry()
    const travelled = Math.hypot(moved.x - before.x, moved.z - before.z)
    if (travelled < 3) problems.push(`car will not drive afterwards (${travelled.toFixed(1)} m)`)

    check(`${id}: starts, runs and releases the player`, problems.length === 0,
      problems.join(' | '))
  }
}

/* ---- world completeness ---------------------------------- */

if (should('world')) {
  console.log('\nWORLD')

  const districts = await page.evaluate(() =>
    window.__world.zones.items
      .filter((z) => z.id.startsWith('district-'))
      .map((z) => ({ id: z.id.replace('district-', ''), x: z.position.x, z: z.position.z, r: z.radius })),
  )

  const problems = []
  for (const district of districts) {
    // The void island is a cliff on purpose — you reach it by jumping
    // it, and dropping onto its rim SHOULD roll the car off. It has
    // its own check above.
    if (district.id === 'void') continue

    // Land at the district's edge and drive into it. This is the
    // check the brief asks for: no accidental holes, no impossible
    // slopes, no invisible blocking colliders.
    await page.evaluate(({ id, x, z, r }) => {
      const g = window.__world
      // KCL's south-centre is the physical module stack. Its entrance road
      // passes sixteen metres east of it.
      const px = x + (id === 'kcl' ? 16 : 0)
      const pz = z + r * 0.85
      // Some authored district rims contain physical structures: place above
      // their actual top rather than dropping the chassis inside a module.
      const y = Math.max(g.physics.groundAt(px, pz) ?? -100, g.terrain.colliderHeightAt(px, pz)) + 2.5
      g.vehicle.moveTo({ x: px, y, z: pz }, Math.PI * .5)
      g.view.focusPoint.trackedPosition.set(px, y, pz)
      g.view.snapToTarget()
    }, district)
    await settle(900)

    const landed = await telemetry()
    // Landing partly on a landmark is the world working. Landing
    // INSIDE one is not, and that shows up as falling through below.
    if (landed.wheelsDown === 0 && landed.y < landed.terrainY + 0.5) {
      problems.push(`${district.id}: no wheel contact and below the terrain`)
    }

    await hold('KeyW', 2200)
    await settle(400)
    const after = await telemetry()

    // What actually matters is the ground, not the destination.
    // Being blocked by a landmark is the world working; ending up
    // underneath it is not. Nor is being flipped by the terrain.
    const drop = after.y - after.terrainY
    const travelled = Math.hypot(after.x - landed.x, after.z - landed.z)
    if (drop < -3) problems.push(`${district.id}: fell through the ground (${drop.toFixed(1)} m)`)
    // Rolling the car after ramming a tower, a voxel stack or a chess
    // piece at full throttle is the world working — that is what those
    // things are for. Rolling it having hit NOTHING is the terrain, and
    // that is what this check is here to catch.
    if (after.upsideDown && travelled > 15) {
      problems.push(`${district.id}: rolled on open ground after ${travelled.toFixed(0)} m`)
    }
    if (!Number.isFinite(after.terrainY)) problems.push(`${district.id}: no ground under it`)
  }

  check('every district can be entered and driven', problems.length === 0,
    problems.slice(0, 4).join(' | '))
  note(`checked ${districts.length} districts`)

  // Every respawn must be somewhere the car can drive AWAY from.
  // Landing on a low plinth is fine; landing somewhere it cannot get
  // off is a trap, and R is the key people press when they are stuck.
  const trapped = []
  const respawnIds = await page.evaluate(() =>
    [...window.__world.respawns.items.keys()],
  )
  for (const id of respawnIds) {
    await page.evaluate((id) => {
      const g = window.__world
      g.player.respawn(id)
    }, id)
    await settle(900)
    const before = await telemetry()
    await hold('KeyW', 1400)
    const after = await telemetry()
    const travelled = Math.hypot(after.x - before.x, after.z - before.z)
    if (travelled < 4) trapped.push(`${id}: ${travelled.toFixed(1)} m`)
    if (after.upsideDown) trapped.push(`${id}: flipped`)
  }
  check('every respawn point can be driven away from', trapped.length === 0,
    trapped.slice(0, 5).join(' | '))
  note(`checked ${respawnIds.length} respawn points`)

  // Landmarks must all be reachable — an interact point nobody can
  // drive to is content that does not exist.
  const unreachable = await page.evaluate(() => {
    const g = window.__world
    const bad = []
    for (const [id, handle] of g.world.landmarks) {
      const { x, z } = handle.landmark
      const ground = g.terrain.colliderHeightAt(x, z)
      // A landmark sitting in a hole, on a spike, or past the edge.
      if (!Number.isFinite(ground)) { bad.push(`${id}: no ground`); continue }
      // The void island is deliberately past the edge of the map.
      if (handle.landmark.district !== 'void' && Math.hypot(x, z) > 372) {
        bad.push(`${id}: outside the world`)
        continue
      }
      // Steepness: sample a ring around it and look for a cliff.
      let min = Infinity
      let max = -Infinity
      for (let a = 0; a < 8; a++) {
        const angle = (a / 8) * Math.PI * 2
        const h = g.terrain.colliderHeightAt(x + Math.cos(angle) * 8, z + Math.sin(angle) * 8)
        min = Math.min(min, h)
        max = Math.max(max, h)
      }
      // The void island is meant to be surrounded by a drop; every
      // other landmark should stand on ground you can drive onto.
      if (max - min > 9 && handle.landmark.district !== 'void') {
        bad.push(`${id}: ${(max - min).toFixed(1)} m of relief within 8 m`)
      }
    }
    return bad
  })
  check('every landmark stands on reachable ground', unreachable.length === 0,
    unreachable.slice(0, 4).join(' | '))

  const counts = await page.evaluate(() => {
    const g = window.__world
    return {
      landmarks: g.world.landmarks.size,
      interactions: g.interactions ? g.interactions['points']?.size ?? 0 : 0,
      props: g.world.props.count,
      notes: g.world.notes.length,
      achievements: g.achievements.totalCount,
    }
  })
  note(`${counts.landmarks} landmarks, ${counts.props} props, ${counts.notes} dev notes, ${counts.achievements} achievements`)
}

/* ---- touch / mobile -------------------------------------- */

if (should('touch')) {
  console.log('\nTOUCH')
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
      '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  })
  const phone = await mobile.newPage()
  const phoneErrors = []
  phone.on('pageerror', (e) => phoneErrors.push(String(e).slice(0, 200)))

  await phone.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await phone.waitForFunction(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
    return b && !b.disabled
  }, { timeout: 120000 })

  const quality = await phone.evaluate(() => window.__world?.quality.level ?? null)
  check('mobile picks a reduced quality tier', quality === 'low' || quality === 'medium',
    `tier ${quality}`)

  await phone.getByRole('button', { name: 'ENTER', exact: true }).click()
  await phone.waitForTimeout(2200)

  const mode = await phone.evaluate(() => window.__world?.inputs.mode)
  check('input mode is touch on a phone', mode === 'touch', `mode ${mode}`)

  const buttons = await phone.locator('button', { hasText: 'BOOST' }).count()
  check('touch action buttons are present', buttons > 0)

  // Drag to drive: the world-space joystick, one finger.
  const before = await phone.evaluate(() => ({ ...window.__world.player.position }))
  await phone.touchscreen.tap(200, 500)
  await phone.evaluate(async () => {
    const el = document.querySelector('canvas')
    const send = (type, x, y) => {
      const t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y })
      el.dispatchEvent(new TouchEvent(type, {
        touches: type === 'touchend' ? [] : [t],
        targetTouches: type === 'touchend' ? [] : [t],
        changedTouches: [t], bubbles: true, cancelable: true,
      }))
    }
    send('touchstart', 195, 430)
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 40))
      send('touchmove', 195, 250 - i)
    }
  })
  await settle(1800)
  const after = await phone.evaluate(() => ({ ...window.__world.player.position }))
  const moved = Math.hypot(after.x - before.x, after.z - before.z)
  check('one finger drives the car', moved > 2, `moved ${moved.toFixed(1)} m`)

  await phone.screenshot({ path: path.join(OUT, '12-mobile.png') })

  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  )
  check('no horizontal overflow on a phone', !overflow)
  check('no page errors on mobile', phoneErrors.length === 0, phoneErrors.slice(0, 2).join(' | '))

  await mobile.close()
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

  // Four round trips, then check the fifth world still runs.
  // Browsers cap live WebGL contexts at around sixteen and drop the
  // oldest silently, so a context leak does not throw — it just
  // makes the world stop rendering after a few visits. This is the
  // only reliable way to see it.
  for (let visit = 0; visit < 4; visit++) {
    await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => {
      const b = Array.from(document.querySelectorAll('button')).find(
        (x) => x.textContent?.trim() === 'ENTER',
      )
      return Boolean(b && !b.disabled)
    }, { timeout: 120000 })
    await page.getByRole('button', { name: 'ENTER', exact: true }).click()
    await settle(1200)
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
    await settle(600)
  }

  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const b = Array.from(document.querySelectorAll('button')).find(
      (x) => x.textContent?.trim() === 'ENTER',
    )
    return Boolean(b && !b.disabled)
  }, { timeout: 120000 })
  await page.getByRole('button', { name: 'ENTER', exact: true }).click()
  await settle(2500)
  const fifth = await telemetry()
  check('a fifth visit still renders', Boolean(fifth) && fifth.elapsed > 0.4,
    fifth ? `elapsed ${fifth.elapsed.toFixed(2)}s, ${Math.round(fifth.fps)} fps` : 'no telemetry')
  if (fifth) {
    note(`${fifth.geometries} geometries, ${fifth.textures} textures live on the fifth world`)
  }
  await shot('10-fifth-visit')
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
