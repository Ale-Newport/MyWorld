/**
 * Drives into every kind of water and tries to get out again.
 *
 *   node scripts/world-water-drive.mjs [baseUrl] [--headed]
 *
 * The brief's rule is that the world is playful, not an off-road
 * simulator: a river, a lake shore and a beach must all be somewhere
 * the car can enter and leave under its own power. Only the deep middle
 * of a lake, and the open sea, are allowed to be a trap — and the trap
 * is meant to fish you out, not hold you: `Water.update` respawns
 * anything more than 1.1 m under the surface for two seconds.
 *
 * WHERE IT DRIVES IS NOT WRITTEN DOWN HERE. The previous version named
 * seven waterlines by hand — "mirror lake", "willow lake", "cold tarn",
 * a ford at (-22, -22) — and this island has none of them: two lake
 * bodies made of five ellipses, one river, one bay. Every one of those
 * seven tests would have reported "never reached the water" and the run
 * would have passed by measuring nothing.
 *
 * So the entries are DERIVED. For each body of water the probe walks
 * bearings out of it until the ground comes up dry, then scores each
 * approach on the steepest step in it and on whether anything is
 * standing in the way, and drives in on the gentlest one it found. The
 * bearing it chose is printed, because "the shallow side is the north
 * one" is a fact about today's island and belongs in the output rather
 * than in the source.
 *
 * `world-shore-check.mjs` measures the ground. This drives it.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const OUT = path.resolve('.qa/water')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage()
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.vehicle), { timeout: 60000 })
await page.waitForTimeout(2500)
// Keyboard actions are bound to the canvas; without this the first
// key press goes to the button that started the world.
await page.locator('canvas').click({ position: { x: 640, y: 620 } })
await page.waitForTimeout(400)

/* ============================================================
   FINDING THE WATER

   All of this runs in the page, because only the page has the
   terrain — and `geography` is the world's own table, not a copy.
   ============================================================ */

await page.evaluate(() => {
  const g = window.__world
  const geo = g.geography

  const ground = (x, z) => g.terrain.colliderHeightAt(x, z)
  /** The surface of whatever water covers this ground, or null for dry land. */
  const levelAt = (x, z) => {
    const inland = geo.inlandWater(x, z)
    if (inland) return inland.level
    return geo.coastInset(x, z) < 0 ? geo.OCEAN_LEVEL : null
  }
  const under = (x, z) => {
    const level = levelAt(x, z)
    return level === null ? 0 : Math.max(0, level - ground(x, z))
  }
  window.__water = { ground, levelAt, under }

  /*
    Being fished out is not driving out. `Water.update` respawns
    anything more than 1.1 m under for two seconds, so a wade test that
    only looks at where the car ENDS UP passes when the world rescued
    it — the exact opposite of the claim being tested. `Player.respawn`
    fires an event, so this is counted rather than guessed at from how
    far the car moved between two samples.
  */
  window.__respawns = []
  g.player.events.on('respawn', (target) => window.__respawns.push(target.name))

  /**
   * March out from a point on a bearing and find somewhere to start a
   * run from: the first dry ground, plus a margin, with nothing
   * standing on the approach.
   *
   * Returns null when the bearing never comes ashore (the lake that
   * drains into a river), when the shore is a cliff, or when there is a
   * wall on the beach — all three of which are reasons this is not the
   * side to drive in from, and all three of which a hand-written
   * coordinate cannot notice.
   */
  const probeBearing = (cx, cz, angle, reach) => {
    const dx = Math.cos(angle)
    const dz = Math.sin(angle)
    let shore = null
    for (let r = 1; r <= reach; r += 1) {
      const x = cx + dx * r
      const z = cz + dz * r
      // Two consecutive dry metres, so the probe does not come ashore
      // on a rock in the middle of the lake.
      if (under(x, z) === 0 && under(cx + dx * (r + 1), cz + dz * (r + 1)) === 0) { shore = r; break }
    }
    if (shore === null) return null
    const MARGIN = 15
    let steepest = 0
    let blocked = null
    for (let r = shore; r <= shore + MARGIN; r += 1) {
      const x = cx + dx * r
      const z = cz + dz * r
      if (under(x, z) > 0) return null                     // a second body of water on the run-up
      steepest = Math.max(steepest, Math.abs(ground(x, z) - ground(cx + dx * (r - 1), cz + dz * (r - 1))))
      const obstacle = g.physics.obstacleAt(x, z, 90, 220)
      if (obstacle !== null && obstacle - ground(x, z) > 0.9) blocked = [Math.round(x), Math.round(z)]
    }
    if (blocked) return null
    return {
      from: [cx + dx * (shore + MARGIN), cz + dz * (shore + MARGIN)],
      shore: [cx + dx * shore, cz + dz * shore],
      shoreAt: shore, angle, steepest,
    }
  }

  /**
   * The ways in to a body of water centred here, gentlest first.
   *
   * A RANKED LIST, not a winner, because the obstacle test above is
   * half blind when it runs: the ecology only instantiates its trunk
   * colliders near the player, so a bearing chosen from the spawn
   * cannot see the wood it goes through. `lake-south` sits inside the
   * south forest and the first version of this picked an approach
   * straight through it, drove the car into a tree it had certified
   * clear, and reported the lake as never reached. Node drives the car
   * to each candidate in turn and re-tests from there.
   */
  window.__approachTo = (cx, cz, reach) => {
    const found = []
    for (let i = 0; i < 32; i++) {
      const one = probeBearing(cx, cz, (i / 32) * Math.PI * 2, reach)
      if (one) found.push(one)
    }
    if (!found.length) return []
    /*
      NEAR shores only, then gentlest. Ranking purely by gradient picks
      the flattest ground on the whole compass, and the flattest ground
      near the south lake is the circuit's tarmac twenty-five metres
      further out — so the first version started the car on the racing
      line, wedged it against a barrier block and reported the lake as
      never reached. Anything more than twenty-five metres further from
      the water than the closest shore is a different place.
    */
    const closest = Math.min(...found.map((f) => f.shoreAt))
    return found.filter((f) => f.shoreAt <= closest + 25).sort((a, b) => a.steepest - b.steepest)
  }

  /**
   * Is the run from here to there clear, NOW, with the car standing on
   * it? A CORRIDOR, not a centreline: the car is a bit over two metres
   * wide, and a line sampled every metre and a half walks between the
   * circuit's barrier blocks and its sign posts without touching either.
   */
  window.__runIsClear = (from, into) => {
    const len = Math.hypot(into[0] - from[0], into[1] - from[1]) || 1
    const dx = (into[0] - from[0]) / len
    const dz = (into[1] - from[1]) / len
    for (let r = 0; r <= len; r += 1) for (const off of [-1.4, 0, 1.4]) {
      const x = from[0] + dx * r - dz * off
      const z = from[1] + dz * r + dx * off
      // Half a metre, not the clearance probe's ninety centimetres: that
      // threshold is "would this stop a car on a road", and this one is
      // "would the car beach on it". The circuit's barrier blocks are
      // 0.8 m and the first version of this drove onto one and sat on
      // its belly with the throttle open.
      const o = g.physics.obstacleAt(x, z, 90, 220)
      if (o !== null && o - ground(x, z) > 0.5) return [Math.round(x), Math.round(z)]
    }
    return null
  }

  /** Every entry the tests need, derived from the geography table. */
  window.__waterSites = () => {
    const sites = []

    // LAKES. One entry per body, aimed at the deepest ellipse in it —
    // which is the one the shelf has to let you back out of.
    for (const body of geo.LAKE_BODIES) {
      const parts = geo.LAKES.filter((l) => l.body === body.id)
      let biggest = parts[0]
      for (const part of parts) if (part.rx * part.rz > biggest.rx * biggest.rz) biggest = part
      const reach = Math.max(biggest.rx, biggest.rz) + geo.BANK_WIDTH + 40
      sites.push({ name: body.id, kind: 'lake', into: [biggest.x, biggest.z], ways: window.__approachTo(biggest.x, biggest.z, reach) })
    }

    // THE RIVER, forded rather than bridged. Candidates along the
    // centreline, keeping clear of the bridge — driving under a deck
    // is not a ford, it is a collision.
    const bridge = geo.BRIDGES[0]
    const points = geo.RIVER.points
    const candidates = []
    for (let i = 1; i < points.length; i++) {
      for (const t of [0.25, 0.5, 0.75]) {
        const x = points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t
        const z = points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t
        if (bridge && Math.hypot(x - bridge.x, z - bridge.z) < bridge.length / 2 + 14) continue
        const ways = window.__approachTo(x, z, geo.RIVER.width / 2 + geo.BANK_WIDTH + 30)
        if (ways.length) candidates.push({ x, z, ways })
      }
    }
    candidates.sort((a, b) => a.ways[0].steepest - b.ways[0].steepest)
    // Two fords, far enough apart to be different places on the river.
    const fords = []
    for (const c of candidates) {
      if (fords.some((f) => Math.hypot(f.into[0] - c.x, f.into[1] - c.z) < 25)) continue
      fords.push({ name: `river ford ${fords.length + 1}`, kind: 'river', into: [c.x, c.z], ways: c.ways })
      if (fords.length === 2) break
    }
    sites.push(...fords)

    // THE BEACH. Bearings out of the middle of the island to the first
    // shoreline, then in from the land side — `coastRayDistance` picks
    // the FIRST crossing, which is what keeps the north-east bay from
    // being read as a headland straight across it.
    const shores = []
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2
      const d = geo.coastRayDistance(angle)
      // MARCH out, do not guess a margin. The shelf falls as
      // -(over * 0.12)^1.7, so it does not reach OCEAN_LEVEL until about
      // fourteen metres past the traced polygon: a fixed twelve-metre
      // step lands on dry sand on every bearing, and the first version
      // of this found no beach anywhere on the island.
      let wet = null
      for (let over = 4; over <= 44 && !wet; over += 2) {
        const x = Math.cos(angle) * (d + over)
        const z = Math.sin(angle) * (d + over)
        if (under(x, z) > 0.2) wet = [x, z]
      }
      if (!wet) continue
      const ways = window.__approachTo(wet[0], wet[1], 90)
      if (ways.length) shores.push({ angle, into: wet, ways })
    }
    shores.sort((a, b) => a.ways[0].steepest - b.ways[0].steepest)
    let beaches = 0
    for (const s of shores) {
      if (beaches === 2) break
      if (sites.some((v) => v.kind === 'beach' && Math.hypot(v.into[0] - s.into[0], v.into[1] - s.into[1]) < 80)) continue
      sites.push({ name: `beach ${(s.angle * 180 / Math.PI).toFixed(0)}°`, kind: 'beach', into: s.into, ways: s.ways })
      beaches++
    }

    return sites
  }

  /**
   * The shelf the east ramp throws you onto.
   *
   * `ramps` lives in world.ts rather than the geography module, so the
   * footprint comes from `ZONES.ramp` — the same record the ramp itself
   * is built from. Walk the flight line out over the water and report
   * how deep it gets, because "0.6 m so you drive out again" is a claim
   * about the terrain that nothing else checks.
   */
  window.__rampShelf = () => {
    const ramp = geo.ZONES.ramp
    const dx = Math.cos(ramp.rotation)
    const dz = Math.sin(ramp.rotation)
    const lip = ramp.length / 2
    const profile = []
    let waterline = null
    for (let r = lip; r <= lip + 60; r += 2) {
      const x = ramp.x + dx * r
      const z = ramp.z + dz * r
      const depth = under(x, z)
      if (depth > 0 && waterline === null) waterline = r
      profile.push({ r: +(r - lip).toFixed(0), x: +x.toFixed(1), z: +z.toFixed(1), depth: +depth.toFixed(2) })
    }
    return { ramp: { x: ramp.x, z: ramp.z, rotation: ramp.rotation, length: ramp.length, width: ramp.width }, waterline, profile }
  }
})

const sites = await page.evaluate(() => window.__waterSites())
const shelf = await page.evaluate(() => window.__rampShelf())
const geoLevels = await page.evaluate(() => ({ ocean: window.__world.geography.OCEAN_LEVEL }))

/* ============================================================
   DRIVING IT
   ============================================================ */

const put = (x, z, rotation) => page.evaluate(({ x, z, rotation }) => {
  const g = window.__world
  const y = g.terrain.colliderHeightAt(x, z) + 2
  g.vehicle.moveTo({ x, y, z }, rotation)
  g.view.focusPoint.trackedPosition.set(x, y, z)
  g.view.snapToTarget()
}, { x, z, rotation })

const state = () => page.evaluate(() => {
  const g = window.__world
  const p = g.player.position
  return {
    x: +p.x.toFixed(1), z: +p.z.toFixed(1), y: +p.y.toFixed(2),
    ground: +g.terrain.colliderHeightAt(p.x, p.z).toFixed(2),
    under: +window.__water.under(p.x, p.z).toFixed(2),
    level: window.__water.levelAt(p.x, p.z),
    speed: +g.vehicle.xzSpeed.toFixed(1),
    wheels: g.vehicle.wheels.inContactCount,
    rescued: window.__respawns.splice(0),
  }
})

async function hold(key, ms) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

const steering = new Set()
async function press(key, down) {
  if (down === steering.has(key)) return
  if (down) { steering.add(key); await page.keyboard.down(key) }
  else { steering.delete(key); await page.keyboard.up(key) }
}
async function releaseSteering() {
  for (const key of [...steering]) await press(key, false)
}

const failures = []

/**
 * Drive from `from` towards `into` in short pulses, stopping as soon as
 * the car is standing on submerged ground, then reverse in pulses until
 * it is back on dry land.
 *
 * Pulses rather than one long press because the distances differ by an
 * order of magnitude — the river is eighteen metres across and a beach
 * approach is forty — and a single timed run either stops short of the
 * water or drives through it and out the far side.
 *
 * `under` rather than an absolute height: this island has three water
 * levels (-0.7 lake west, -0.65 lake south, -0.7 river, -2.5 sea) and a
 * test that compares against one number is a test that is wrong on the
 * other three.
 */
async function wadeTest(name, ways, into) {
  /*
    Pick an approach the car can actually use. The ranking came from a
    scan run before the car was anywhere near, so the ecology's trunk
    colliders did not exist yet; standing on each candidate and asking
    again is the only way to find the tree. Five tries, then give up and
    say which ones were blocked — a wade test that silently drove into a
    wood and reported "never reached the water" is what this replaces.
  */
  let from = null
  const rejected = []
  for (const way of ways.slice(0, 5)) {
    await put(way.from[0], way.from[1], Math.atan2(-(into[1] - way.from[1]), into[0] - way.from[0]))
    await page.waitForTimeout(700)
    const blocked = await page.evaluate(({ a, b }) => window.__runIsClear(a, b), { a: way.from, b: into })
    if (!blocked) { from = way; break }
    rejected.push(`${(way.angle * 180 / Math.PI).toFixed(0)}° blocked at (${blocked.join(', ')})`)
  }
  if (!from) {
    failures.push(name)
    console.log(`  FAIL  ${name.padEnd(18)} no clear approach: ${rejected.join('; ')}`)
    return
  }
  const heading = Math.atan2(-(into[1] - from.from[1]), into[0] - from.from[0])
  await put(from.from[0], from.from[1], heading)
  await page.waitForTimeout(900)

  // Sampled while driving, not only between pulses: the river is
  // eighteen metres across and a pulse covers six, so a bed sampled at
  // the pulse boundaries is a bed the test drives straight over.
  let deepest = await state()
  let fished = null
  const watch = (now) => {
    if (now.rescued.length) fished = `respawned at "${now.rescued[0]}" — (${now.x}, ${now.z})`
    if (now.under > deepest.under) deepest = now
  }
  // Lift off the throttle INSIDE the pulse, not at the end of it. The
  // sea shelf goes from 0.1 m to 1.6 m of water in six metres and a
  // pulse covers about that, so a test that only checks between pulses
  // does not enter the shallows — it drives through them into water it
  // was never meant to be in, and then reports the beach as a trap.
  for (let pulse = 0; pulse < 10 && deepest.under <= 0.25; pulse++) {
    await page.keyboard.down('w')
    for (let tick = 0; tick < 7; tick++) {
      await page.waitForTimeout(60)
      watch(await state())
      if (deepest.under > 0.25) break
    }
    await page.keyboard.up('w')
    await page.waitForTimeout(220)
    watch(await state())
  }
  // Stop before reversing. Without this the car arrives at the
  // waterline carrying eight or nine metres a second, coasts down the
  // shelf while reverse spins up, and the test measures whether the car
  // can climb out of the deep — which is not the claim. The sea falls
  // from 0.1 m to 1.6 m of water in six metres; there is no room to
  // arrive fast and stop in the shallows.
  await hold('b', 500)
  watch(await state())
  const entered = deepest.under > 0
  const wentNowhere = Math.hypot(deepest.x - from.from[0], deepest.z - from.from[1]) < 3
  /*
    TWO depths, because they answer two different questions. `entry` is
    how deep the car was when it stopped driving in; `deepest` is how
    deep it ever got, which includes the reverse. On both open-coast
    entries the car wades in to under half a metre and then goes down to
    three or four while reversing — it is not overshooting on the way
    in, it is sliding down the shelf on the way out, and a report that
    prints one number cannot tell those apart.
  */
  const entry = { under: deepest.under, x: deepest.x, z: deepest.z }
  const overshoot = Math.hypot(entry.x - into[0], entry.z - into[1])
  const file = name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  await page.screenshot({ path: path.join(OUT, `${file}-in.png`) })

  // Reverse until the car is properly ashore, not merely at the
  // waterline: `under === 0` is true standing on ground exactly level
  // with the surface, which is still the bed. The margin is measured
  // against the level of the water it went into, because this island
  // has four of them (-0.7 west lake, -0.65 south lake, -0.7 river,
  // -2.5 sea) and a single absolute height is wrong for three.
  const level = deepest.level ?? geoLevels.ocean
  let back = await state()
  for (let pulse = 0; pulse < 18; pulse++) {
    /*
      HOLD THE ENTRY HEADING while reversing. Without this the car yaws
      in the water — no wheel has much grip and the drag is uneven — and
      once its nose has come round, `s` is no longer "back out", it is
      "drive further in". Both open-coast entries did exactly that: they
      waded in to a third of a metre and then covered a hundred and
      thirty metres of seabed under reverse before the drowning rule
      caught them. Steering is inverted going backwards, so the
      correction is applied the other way round.
    */
    const facing = await page.evaluate(() => window.__world.player.rotationY)
    let drift = facing - heading
    drift = Math.atan2(Math.sin(drift), Math.cos(drift))
    await press('a', drift < -0.08)
    await press('d', drift > 0.08)
    await hold('s', 420)
    await releaseSteering()
    await page.waitForTimeout(260)
    back = await state()
    watch(back)
    if (back.under === 0 && back.ground > level + 0.3) break
  }
  await page.waitForTimeout(600)
  back = await state()
  watch(back)
  await page.screenshot({ path: path.join(OUT, `${file}-out.png`) })

  // Getting out is DRIVING out. Being respawned by the drowning rule is
  // the world rescuing the car, which is the opposite of the claim.
  const escaped = back.under === 0 && back.ground > level + 0.15 && !fished
  const ok = entered && escaped
  if (!ok) failures.push(name)
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${name.padEnd(18)} ` +
    `in ${String(entry.under).padStart(5)} m of water at (${String(entry.x).padStart(6)},${String(entry.z).padStart(6)})` +
    ` · out on ground ${String(back.ground).padStart(6)}` +
    `${deepest.under > entry.under + 0.3 ? ` · went on down to ${deepest.under} m at (${deepest.x}, ${deepest.z}) while reversing` : ''}` +
    `${entered ? '' : wentNowhere ? '  (NEVER MOVED — something is holding the car at the start)' : '  (never reached the water)'}` +
    `${fished ? `  (RESPAWNED ${fished})` : escaped ? '' : '  (could not get out)'}` +
    `${!ok && overshoot > 12 ? `  [${overshoot.toFixed(0)} m past the entry point — it did not stop in the shallows]` : ''}`,
  )
}

console.log('\nWATER — drive in, drive out\n')
console.log(`  ${sites.length} entries derived from the geography table:`)
for (const site of sites) {
  if (!site.ways.length) { console.log(`    ${site.name.padEnd(18)} NO DRIVABLE APPROACH on any of 32 bearings`); continue }
  const first = site.ways[0]
  console.log(`    ${site.name.padEnd(18)} ${site.ways.length} way(s) in · first choice from (${first.from.map((n) => n.toFixed(0)).join(', ')}) on bearing ${(first.angle * 180 / Math.PI).toFixed(0)}°, steepest step ${first.steepest.toFixed(2)} m`)
}
console.log('')

for (const site of sites) {
  if (!site.ways.length) {
    failures.push(site.name)
    console.log(`  FAIL  ${site.name.padEnd(18)} NO DRIVABLE APPROACH on any of 32 bearings`)
    continue
  }
  await wadeTest(site.name, site.ways, site.into)
}

/* ---- the ramp's landing ---------------------------------- */

const past = shelf.profile.filter((p) => p.depth > 0)
const deepest = past.reduce((d, p) => Math.max(d, p.depth), 0)
console.log(`\n  the east ramp lands in the shallows — flight line ${shelf.ramp.rotation.toFixed(2)} rad from (${shelf.ramp.x}, ${shelf.ramp.z})\n`)
if (shelf.waterline === null) {
  console.log('  FAIL  ramp shallows      the flight line never reaches water within 60 m of the lip')
  failures.push('ramp shallows')
} else {
  console.log(`        waterline ${(shelf.waterline - shelf.ramp.length / 2).toFixed(0)} m past the lip · deepest ${deepest.toFixed(2)} m over the next ${past.length * 2} m`)
  // The profile, not just its worst number: "the shelf there is 0.6 m
  // deep, so you drive out again" is a claim about the first few metres
  // past the waterline, and it is worth being able to read where it
  // stops being true.
  console.log('        depth along the flight line, from the lip:')
  console.log('        ' + shelf.profile.filter((p) => p.r % 4 === 0).map((p) => `${p.r}m:${p.depth.toFixed(1)}`).join('  '))
  const splash = past.find((p) => p.depth > 0.15) ?? past[0]
  const ways = await page.evaluate(({ x, z }) => window.__approachTo(x, z, 90), { x: splash.x, z: splash.z })
  if (!ways.length) {
    console.log('  FAIL  ramp shallows      nothing drivable within 90 m of where the ramp puts you')
    failures.push('ramp shallows')
  } else {
    await wadeTest('ramp shallows', ways, [splash.x, splash.z])
  }
}

/* ---- and the one place that IS meant to be a trap --------- */

console.log('\n  the deep — should recover the car, not strand it\n')
const openSea = await page.evaluate(() => {
  const geo = window.__world.geography
  /*
    START ON THE BEACH AND DRIVE OUT. `coastRayDistance(a)` is the
    distance from the ORIGIN to the first shoreline on that bearing, so
    `d - 20` is twenty metres INLAND — the first version of this put the
    car down at (153, 89), which is the middle of the labyrinth, drove
    it into a maze wall, watched the unstuck rule respawn it and
    reported the open sea as recovering the car. Pick the bearing whose
    water is deepest well out, then start twelve metres short of the
    waterline on dry land.
  */
  let best = null
  for (let i = 0; i < 48; i++) {
    const angle = (i / 48) * Math.PI * 2
    const d = geo.coastRayDistance(angle)
    const start = [Math.cos(angle) * (d - 12), Math.sin(angle) * (d - 12)]
    const out = [Math.cos(angle) * (d + 45), Math.sin(angle) * (d + 45)]
    if (window.__water.under(start[0], start[1]) > 0) continue
    // …and the run has to be clear. The bearing with the deepest water
    // off it is 30°, and twelve metres inside the coast on 30° is the
    // middle of the labyrinth: the first version put the car down in a
    // maze corridor, drove it into a wall, and read the unstuck rule's
    // respawn as the sea recovering it.
    if (window.__runIsClear(start, out)) continue
    const depth = window.__water.under(out[0], out[1])
    if (!best || depth > best.depth) best = { angle, depth, x: start[0], z: start[1] }
  }
  return best
})
if (!openSea) throw new Error('[water] no bearing off this island reaches open sea')
console.log(`  out from (${openSea.x.toFixed(0)}, ${openSea.z.toFixed(0)}) on bearing ${(openSea.angle * 180 / Math.PI).toFixed(0)}°, where the sea is ${openSea.depth.toFixed(1)} m deep 45 m out\n`)
await put(openSea.x, openSea.z, Math.atan2(-Math.sin(openSea.angle), Math.cos(openSea.angle)))
await page.waitForTimeout(600)
const before = await state()
await hold('w', 6000)
await page.waitForTimeout(6000)
const rescued = await state()
const moved = Math.hypot(rescued.x - before.x, rescued.z - before.z)
const recovered = rescued.under === 0 && rescued.rescued.length > 0
console.log(`  ${recovered ? 'ok  ' : 'FAIL'}  open sea           left (${before.x}, ${before.z}) and ended on ground ${rescued.ground} at (${rescued.x}, ${rescued.z}), ${moved.toFixed(0)} m away` +
  `${rescued.rescued.length ? ` · respawned at "${rescued.rescued[0]}"` : ' · NOT respawned — the drowning rule never fired'}`)
if (!recovered) failures.push('open sea recovery')

console.log(`\n${failures.length} failure(s)${failures.length ? ': ' + failures.join(', ') : ''}\n`)
await browser.close()
process.exit(failures.length ? 1 : 0)
