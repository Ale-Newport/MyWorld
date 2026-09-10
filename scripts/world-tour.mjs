/**
 * THE TOUR, DRIVEN.
 *
 *   node scripts/world-tour.mjs [baseUrl] [--wide] [--headed]
 *
 * The brief's acceptance test: a visitor arrives at the LANDING and
 * meets the whole world without ever being teleported. This drives it,
 * once, under its own power —
 *
 *   LANDING → the bridge → SOCIAL → BOWLING → PROJECTS → the RAMP
 *   → TIME MACHINE → the MAZE → back to LANDING → ACHIEVEMENTS
 *   → the RACE START
 *
 * — and reports, per leg, where it stalled, on what gradient, whether
 * it ended up in water, and whether the ENGINE moved it. That last one
 * is the point: `Player.onStuck` gives up after three hops and calls
 * `respawn()`, and `Water.update` respawns anything a metre under for
 * two seconds. Both are teleports. A tour that does not watch for them
 * reports a clean lap of a world it was carried around.
 *
 * WHAT REPLACED WHAT. This used to teleport to each district in turn
 * and photograph it — a contact sheet, not a test, and its camera
 * framing was the only thing in it that could fail. The screenshots
 * are still written to `.qa/tour/`, one per stop, but they are now
 * pictures of somewhere the car actually drove to.
 *
 * NOTHING HERE IS A COORDINATE. Every place is resolved from the
 * running world — respawn points, play spots, zones and
 * `geography.ZONES` — and every leg names roads by id and lets the
 * world supply their geometry. The only editorial content is the
 * ORDER, which is the brief's, and the direction each road is taken in.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const WIDE = args.includes('--wide')
const OUT = path.resolve('.qa/tour')

/*
  THE ROUTE. `stop` is a place resolved below from the live world;
  `via` names the carriageways to take to get there, `:back` meaning
  the road is driven from its last point to its first.

  A road named here that the world no longer has is a hard error, not a
  skipped leg — the previous version of this file quietly toured
  whatever districts it found and would have reported a pass on an
  island with two places left on it.
*/
const TOUR = [
  // Over the bridge. The river is fordable, but the road crosses it on
  // the deck and the tour checks that the deck is what it drove on.
  { stop: 'SOCIAL', via: ['landing-bridge-social'] },
  { stop: 'BOWLING', via: ['social-bowling'] },
  // The bowling forecourt IS the link: `social-bowling` stops short of
  // the lane and `bowling-projects` starts fifty metres east of it,
  // with the venue's own levelled pad in between.
  { stop: 'PROJECTS', via: ['bowling-projects'] },
  { stop: 'RAMP', via: ['landing-projects:back', 'landing-ramp'] },
  // Back down the ramp spur and through the landing junction, which is
  // where four of the thirteen roads meet.
  { stop: 'TIME MACHINE', via: ['landing-ramp:back', 'landing-projects:back', 'landing-south-spine'] },
  { stop: 'MAZE', via: ['timemachine-maze'] },
  { stop: 'LANDING', via: ['landing-maze-road:back'] },
  { stop: 'ACHIEVEMENTS', via: ['landing-racestart'] },
  { stop: 'RACE START', via: ['landing-racestart'] },
]

/** How near a stop counts as having arrived at it. */
const ARRIVE = 14

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: !args.includes('--headed'),
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
const page = await (
  await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
).newPage()
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
// Keyboard actions are bound to the canvas; without this the first key
// press goes to the button that started the world.
await page.locator('canvas').click({ position: { x: 640, y: 620 } })
await page.waitForTimeout(400)

/* ============================================================
   THE WORLD, AS IT IS TODAY
   ============================================================ */

const world = await page.evaluate(() => {
  const g = window.__world
  const geo = g.geography
  const zone = (id) => {
    const z = g.zones.items.find((i) => i.id === id)
    return z ? { x: z.position.x, z: z.position.z, r: z.radius } : null
  }
  const spawn = (name) => {
    const r = g.respawns.getByName(name)
    return r ? { x: r.position.x, z: r.position.z, rotation: r.rotation } : null
  }
  const spot = (id) => {
    const s = geo.PLAY_SPOTS.find((p) => p.id === id)
    return s ? { x: s.x, z: s.z } : null
  }
  return {
    // `roads` in world.ts is PATHS with its ids hyphenated; the tour
    // names them the hyphenated way, so apply the same rule here
    // rather than shipping a second copy of the table.
    roads: geo.PATHS.map((p) => ({ id: p.id.replace(/_/g, '-'), points: p.points.map(([x, z]) => [x, z]) })),
    places: {
      LANDING: spawn('landing'),
      SOCIAL: spawn('social'),
      BOWLING: spawn('bowling'),
      PROJECTS: spawn('projects'),
      /* THE FOOT OF THE JUMP, not the middle of its deck.

         `ZONES.ramp` is the centre of a 30 m wedge that rises 6.6 m,
         so a tour that drives to it parks the car half way up a ramp
         and the next leg has to reverse down one. It cost the TIME
         MACHINE stop on two runs out of three. Where a visitor stops
         is at the bottom, lining up. */
      RAMP: {
        x: geo.ZONES.ramp.x - Math.cos(geo.ZONES.ramp.rotation) * (geo.ZONES.ramp.length / 2 + 4),
        z: geo.ZONES.ramp.z + Math.sin(geo.ZONES.ramp.rotation) * (geo.ZONES.ramp.length / 2 + 4),
      },
      'TIME MACHINE': spot('timeMachine'),
      /* Where a visitor STOPS at the labyrinth: under the arch on the
         approach, not in the doorway.

         This was the mouth zone, and the note beside it said the gate
         was "on the other face" — it was, when the generator opened
         the maze on the seaward side. Both are on the north face now,
         six metres apart, and driving to the mouth means stopping IN
         the opening: the next leg then starts inside the maze, with a
         straight-line route out through four walls, and takes the
         three stops after it down with it. */
      MAZE: g.world.landmarks.get('maze-entry')
        ? { x: g.world.landmarks.get('maze-entry').landmark.x, z: g.world.landmarks.get('maze-entry').landmark.z }
        : zone('labyrinth-mouth'),
      ACHIEVEMENTS: spawn('achievements'),
      'RACE START': { x: geo.ZONES.raceStart.x, z: geo.ZONES.raceStart.z },
    },
    bridge: geo.BRIDGES[0]
      ? { x: geo.BRIDGES[0].x, z: geo.BRIDGES[0].z, length: geo.BRIDGES[0].length, width: geo.BRIDGES[0].width, rotation: geo.BRIDGES[0].rotation, level: geo.BRIDGES[0].level }
      : null,
    /*
      STAND-OFFS — where you line up before you drive into a shell.

      A venue with walls has one way in, and the tour's route builder
      draws a straight line from the end of the last road to the mark
      inside it. For BOWLING that line comes in over the north side
      wall: the car climbed a 2.25 m wall at speed, went over, and took
      the two stops after it with it.

      The way in is the venue's own axis. `PLAY_SPOTS.rotation` is the
      venue's yaw and its apron is at local +Z, so the open end lies
      along (sin, cos), and the stand-off goes at the far edge of the
      venue's own flattened pad measured along that axis — no
      coordinate typed here, and a venue that is turned round in the
      plan turns this round with it.
    */
    approaches: Object.fromEntries(
      [['BOWLING', 'bowling']]
        .map(([place, id]) => {
          const s = geo.PLAY_SPOTS.find((p) => p.id === id)
          if (!s || !s.pad) return null
          const ax = Math.sin(s.rotation ?? 0)
          const az = Math.cos(s.rotation ?? 0)
          const pad = s.pad
          const cos = Math.cos(pad.rotation)
          const sin = Math.sin(pad.rotation)
          let reach = 0
          for (const [dl, dw] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
            const cx = pad.x + (dl * pad.length / 2) * cos - (dw * pad.width / 2) * sin
            const cz = pad.z + (dl * pad.length / 2) * sin + (dw * pad.width / 2) * cos
            reach = Math.max(reach, (cx - s.x) * ax + (cz - s.z) * az)
          }
          return [place, { x: s.x + ax * reach, z: s.z + az * reach }]
        })
        .filter(Boolean),
    ),
    gate: g.world.landmarks.get('maze-entry')?.landmark
      ? { x: g.world.landmarks.get('maze-entry').landmark.x, z: g.world.landmarks.get('maze-entry').landmark.z }
      : null,
  }
})

const roadById = Object.fromEntries(world.roads.map((r) => [r.id, r]))
for (const leg of TOUR) {
  for (const spec of leg.via) {
    const id = spec.split(':')[0]
    if (!roadById[id]) throw new Error(`[tour] the route names a road this world does not have: "${id}"`)
  }
  if (!world.places[leg.stop]) throw new Error(`[tour] the route names a place this world does not have: "${leg.stop}"`)
}
if (!world.places.LANDING) throw new Error('[tour] no landing respawn to start from')
if (!world.bridge) throw new Error('[tour] the tour goes over a bridge and the world has none')

/* ============================================================
   ROUTE BUILDING

   Roads join at shared vertices, but not always at their FIRST or
   LAST one — `landing-ramp` leaves `landing-projects` in the middle of
   it. So consecutive roads are stitched at their closest pair of
   vertices, the head of the first drops the vertices the car is
   already past, and the tail of the last drops the ones that lead away
   from the stop. Without the trims the car drives to the end of a road
   and then twenty metres back down it, which reads in the log as a
   stall.
   ============================================================ */

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/*
  The trims WALK, they do not search for the nearest vertex.

  `nearest()` is the obvious implementation and it is wrong: the maze
  spur's closest vertex to the labyrinth mouth is its FIRST one, forty
  metres from its last, because the road runs away round the outside of
  a forty-two-metre wall. Trimming to it deleted the whole road and sent
  the car in a straight line at the maze's west face, where it wedged
  for the rest of the tour. Walking out from the end while each step
  gets closer keeps the road and only drops the tail that doubles back.
*/
const trimHead = (points, from) => {
  let s = 0
  while (s < points.length - 1 && dist(points[s + 1], from) < dist(points[s], from)) s++
  return points.slice(s)
}
const trimTail = (points, to) => {
  let e = points.length - 1
  while (e > 0 && dist(points[e - 1], to) < dist(points[e], to)) e--
  return points.slice(0, e + 1)
}

function buildRoute(from, via, to) {
  const chains = via.map((spec) => {
    const [id, direction] = spec.split(':')
    const points = roadById[id].points.map((p) => [p[0], p[1]])
    return direction === 'back' ? points.reverse() : points
  })
  chains[0] = trimHead(chains[0], from)
  for (let i = 1; i < chains.length; i++) {
    const previous = chains[i - 1]
    let bestA = previous.length - 1
    let bestB = 0
    let best = Infinity
    for (let a = 0; a < previous.length; a++) {
      for (let b = 0; b < chains[i].length; b++) {
        const d = dist(previous[a], chains[i][b])
        if (d < best) { best = d; bestA = a; bestB = b }
      }
    }
    chains[i - 1] = previous.slice(0, bestA + 1)
    chains[i] = chains[i].slice(bestB)
  }
  chains[chains.length - 1] = trimTail(chains[chains.length - 1], to)

  const route = [from, ...chains.flat(), to]
  // Two vertices half a metre apart make a look-ahead target the car
  // is already standing on, and the controller then steers on noise.
  return route.filter((p, i) => i === 0 || dist(p, route[i - 1]) > 0.5)
}

/* ============================================================
   THE AUTOPILOT

   Split between the page and Node: the page works out what it wants,
   because only the page knows where the car is, and Node presses the
   keys, because a `KeyboardEvent` dispatched from inside the page is
   not trusted and the input layer ignores it.

   The controller is `world-loop-drive.mjs`'s — pure pursuit along the
   polyline with a target speed picked from how much the route is
   bending. It follows the polyline LINEARLY: the terrain paints these
   roads with `lineTo`, so the polyline is the road, and a spline
   through the same points bulges outside it at every corner.
   ============================================================ */

await page.evaluate(() => {
  const g = window.__world
  const geo = g.geography
  window.__tour = { samples: [], progress: 0, done: false, stuck: 0 }

  /*
    Teleports, from the horse's mouth. This was a distance heuristic —
    "a step over fifteen metres in one poll is a respawn" — and a single
    frame hitch on the first leg, while the terrain shaders were still
    compiling, moved the car twenty-one metres between two polls and was
    reported as the engine rescuing it. `Player.respawn` fires an event;
    there is no reason to guess.
  */
  window.__tourTeleports = []
  g.player.events.on('respawn', (target) => {
    window.__tourTeleports.push({ to: [Math.round(target.position.x), Math.round(target.position.z)], name: target.name })
  })

  window.__tourRoute = (points) => {
    const samples = []
    for (let seg = 0; seg < points.length - 1; seg++) {
      const [ax, az] = points[seg]
      const [bx, bz] = points[seg + 1]
      const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.5))
      for (let k = 0; k < steps; k++) {
        const t = k / steps
        samples.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t })
      }
    }
    samples.push({ x: points[points.length - 1][0], z: points[points.length - 1][1] })
    window.__tour = { samples, progress: 0, done: false, stuck: 0 }
  }

  /**
   * Is the CAR in water, and whose water is it?
   *
   * This used to ask only whether the GROUND at the car's x/z was under
   * a water level, which is a different question with a different
   * answer every time the car is on the bridge: the riverbed is 1.5 m
   * under the river all the way across, so every crossing reported
   * "crossed the bridge on the deck" and "drove through water 1.49 m
   * deep" in the same breath. The car's own height settles it — on the
   * deck it is four metres clear.
   */
  const wetness = (x, z, y) => {
    const inland = geo.inlandWater(x, z)
    const level = inland ? inland.level : geo.coastInset(x, z) < 0 ? geo.OCEAN_LEVEL : null
    if (level === null) return null
    const ground = g.terrain.colliderHeightAt(x, z)
    if (ground >= level) return null
    // A car floating on its suspension sits about 0.6 m above whatever
    // it is standing on; 1.2 m of headroom over the surface is water
    // it is driving THROUGH rather than over.
    if (y > level + 1.2) return null
    return { level, under: +(level - ground).toFixed(2) }
  }

  window.__tourCommand = () => {
    const a = window.__tour
    const p = g.player.position
    // The car faces (cos r, −sin r); +Z is a NEGATIVE rotation.
    const hx = Math.cos(g.player.rotationY)
    const hz = -Math.sin(g.player.rotationY)
    const ahead = g.terrain.colliderHeightAt(p.x + hx * 2, p.z + hz * 2)
    const behind = g.terrain.colliderHeightAt(p.x - hx * 2, p.z - hz * 2)
    const gradient = (Math.atan2(ahead - behind, 4) * 180) / Math.PI
    const ground = g.terrain.colliderHeightAt(p.x, p.z)
    const common = {
      x: p.x, z: p.z, y: p.y, ground, gradient,
      teleports: window.__tourTeleports.splice(0),
      speed: g.vehicle.xzSpeed,
      wheels: g.vehicle.wheels.inContactCount,
      flipped: g.vehicle.upsideDown?.active ?? false,
      wedged: g.vehicle.stuck?.active ?? false,
      water: wetness(p.x, p.z, p.y),
      stuck: a.stuck,
    }
    if (a.done || !a.samples.length) return { ...common, throttle: 0, steer: 0, done: true, at: a.progress, of: a.samples.length }

    // Nearest sample AHEAD of the furthest one reached, so the car
    // cannot satisfy a route by cutting back to its start.
    let closest = a.progress
    let best = Infinity
    for (let i = a.progress; i < Math.min(a.samples.length, a.progress + 60); i++) {
      const d = (p.x - a.samples[i].x) ** 2 + (p.z - a.samples[i].z) ** 2
      if (d < best) { best = d; closest = i }
    }
    a.progress = closest
    if (closest >= a.samples.length - 2) a.done = true

    // Twelve metres of look-ahead at 1.5 m a sample. Twenty-four aims
    // past a short corner entirely and cuts it.
    const target = a.samples[Math.min(a.samples.length - 1, closest + 8)]
    const far = a.samples[Math.min(a.samples.length - 1, closest + 18)]
    const here = a.samples[closest]
    const v1 = { x: target.x - here.x, z: target.z - here.z }
    const v2 = { x: far.x - target.x, z: far.z - target.z }
    const l1 = Math.hypot(v1.x, v1.z) || 1
    const l2 = Math.hypot(v2.x, v2.z) || 1
    const curvature = Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.z * v2.z) / (l1 * l2))))

    let error = Math.atan2(target.z - p.z, target.x - p.x) - g.player.rotationY
    error = Math.atan2(Math.sin(error), Math.cos(error))
    const steer = error + g.vehicle.chassis.physical.body.angvel().y * 0.22
    const speed = g.vehicle.xzSpeed
    // Slow down for the arrival. Samples are 1.5 m apart, so this eases
    // off over the last twenty metres and finishes at walking pace.
    // Ploughing into a stop at 13 m/s is how the car ended up inside
    // the labyrinth and on top of the bowling shell's side wall.
    const left = (a.samples.length - 1 - closest) * 1.5
    const wanted = Math.min(Math.max(6.5, 13 - curvature * 6), 2.5 + left * 0.5)

    if (speed < 1.5) a.stuck += 1 / 15
    else a.stuck = 0

    /*
      TURNING ROUND, rather than driving on.

      A leg ends with the car pointing at the stop, so the next one
      often begins with the road behind it — and at the labyrinth,
      "behind it" means the only thing in front of it is the doorway.
      A controller that can only drive forwards answers that by
      driving into the maze and spending the rest of the tour in it.

      So: past 115° of heading error, back out; keep backing until the
      error is under 80°, which stops it dithering on the boundary.
      Steering is inverted in reverse, because the back of the car goes
      the other way.
    */
    if (Math.abs(error) > 2.0) a.reversing = true
    else if (Math.abs(error) < 1.4) a.reversing = false
    const wheel = steer < -0.075 ? -1 : steer > 0.075 ? 1 : 0

    if (a.reversing) {
      return {
        ...common,
        stuck: a.stuck,
        throttle: -1,
        brake: false,
        steer: -wheel,
        done: a.done, at: closest, of: a.samples.length, wanted, reversing: true,
      }
    }

    return {
      ...common,
      stuck: a.stuck,
      throttle: a.stuck > 2.5 && a.stuck < 4 ? -1 : speed > wanted + 1.2 ? 0 : 1,
      brake: speed > wanted + 1.2,
      steer: wheel,
      done: a.done, at: closest, of: a.samples.length, wanted,
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

/* ============================================================
   DRIVING A LEG
   ============================================================ */

const bridgeBox = world.bridge
const onBridge = (x, z) => {
  const dx = x - bridgeBox.x
  const dz = z - bridgeBox.z
  const along = Math.abs(dx * Math.cos(bridgeBox.rotation) + dz * Math.sin(bridgeBox.rotation))
  const across = Math.abs(-dx * Math.sin(bridgeBox.rotation) + dz * Math.cos(bridgeBox.rotation))
  return along < bridgeBox.length / 2 && across < bridgeBox.width / 2
}

async function driveLeg(name, route, to, budgetSeconds) {
  await page.evaluate((points) => window.__tourRoute(points), route)
  const started = Date.now()
  const report = {
    name, arrived: false, closest: Infinity, closestAt: null, driven: 0,
    stalls: [], teleports: [], steepestClimbed: 0, wettest: null, crossedBridge: false,
    onItsRoof: 0, firstFlip: null, startedOnItsRoof: false, seconds: 0,
    // Where the leg BEGAN. A leg that fails from the wrong starting
    // point is a different bug from one that fails on the way, and
    // without this they read identically.
    from: null,
    // Which KIND of immobile. The recoveries are different — the
    // upside-down loop kicks and then rights the car in place, the
    // beached one hops and then respawns — so a report that says only
    // "upside down or wedged" cannot say which one failed to run.
    flippedSamples: 0, wedgedSamples: 0,
  }
  let previous = null
  let stalling = null
  let samples = 0
  while (Date.now() - started < budgetSeconds * 1000) {
    const c = await page.evaluate(() => window.__tourCommand())
    const here = [c.x, c.z]
    samples++
    if (!report.from) report.from = here

    // `Player.respawn()` — the unstuck hopper giving up after three
    // hops, or `Water.update` fishing the car out from a metre under —
    // is the teleport this tour exists to catch. The distance it
    // covered is not distance driven.
    for (const jump of c.teleports) report.teleports.push(`${previous ? previous.map(Math.round).join(',') : '?'} → ${jump.to.join(',')} (respawn "${jump.name}")`)
    if (previous && !c.teleports.length) report.driven += dist(here, previous)
    previous = here

    const gap = dist(here, [to.x, to.z])
    if (gap < report.closest) { report.closest = gap; report.closestAt = here }
    // Reaching a place on your roof is not arriving at it. The first
    // run of this reported BOWLING as reached because the car slid the
    // last nine metres upside down.
    if (gap < ARRIVE && !c.flipped) report.arrived = true
    if (onBridge(c.x, c.z) && c.y > bridgeBox.level - 1) report.crossedBridge = true
    if (c.speed > 3 && c.gradient > report.steepestClimbed) report.steepestClimbed = c.gradient
    if (c.water && (!report.wettest || c.water.under > report.wettest.under)) {
      report.wettest = { ...c.water, at: [Math.round(c.x), Math.round(c.z)] }
    }
    // WHERE it went over, not just that it did — and only when it went
    // over on THIS leg. The car stays on its roof until something
    // rights it, so a leg that begins upside down inherits the
    // previous leg's flip, and reporting that position again nine
    // times reads as nine separate bugs at the same coordinate.
    if (c.flipped || c.wedged) {
      report.onItsRoof++
      if (c.flipped) report.flippedSamples++
      if (c.wedged) report.wedgedSamples++
      if (samples === 1) report.startedOnItsRoof = true
      else if (!report.firstFlip && !report.startedOnItsRoof) {
        report.firstFlip = { at: here, gradient: c.gradient, ground: c.ground, y: c.y }
      }
    }

    // A stall is recorded ONCE per place, with the gradient the car was
    // trying to climb when it gave up — "stuck at (12, −98)" is not
    // actionable; "stuck at (12, −98) on a 21° slope" is.
    if (c.stuck > 3) {
      if (!stalling || dist(here, stalling.at) > 10) {
        stalling = { at: here, gradient: c.gradient, water: c.water, wheels: c.wheels, above: c.y - c.ground, flipped: c.flipped, wedged: c.wedged }
        report.stalls.push(stalling)
      }
      stalling.gradient = Math.max(stalling.gradient, c.gradient)
      stalling.seconds = c.stuck
    } else if (c.stuck === 0) {
      stalling = null
    }

    if (c.done) break
    await press('w', c.throttle > 0)
    await press('s', c.throttle < 0)
    await press('b', Boolean(c.brake))
    await press('a', c.steer < 0)
    await press('d', c.steer > 0)
    if (process.env.VERBOSE) {
      console.log(`      ${c.x.toFixed(0)},${c.z.toFixed(0)} ${c.at}/${c.of} v=${c.speed.toFixed(1)} grade=${c.gradient.toFixed(0)}° wheels=${c.wheels} stuck=${c.stuck.toFixed(1)}${c.water ? ` water ${c.water.under}m` : ''}`)
    }
    await page.waitForTimeout(70)
  }
  await release()

  /*
    COME TO A STOP before the next leg starts.

    A visitor who arrives somewhere stops there. This let go of the keys
    at whatever speed the leg ended on and the car coasted — through the
    labyrinth's mouth, most memorably, which put the START of the next
    leg sixteen metres inside a maze whose route out is a straight line
    through four walls. Three of the tour's ten stops were failing to a
    car that had never been asked to stop.
  */
  for (let i = 0; i < 45; i++) {
    const speed = await page.evaluate(() => window.__world.vehicle.xzSpeed)
    if (speed < 1) break
    await press('b', true)
    await page.waitForTimeout(70)
  }
  await release()

  report.seconds = Math.round((Date.now() - started) / 1000)
  return report
}

/* ============================================================
   THE TOUR
   ============================================================ */

console.log('\nTHE TOUR — driven, not teleported\n')
console.log(`  ${world.roads.length} roads · bridge at (${world.bridge.x}, ${world.bridge.z})`)
if (world.gate) console.log(`  labyrinth gate at (${world.gate.x}, ${world.gate.z}), mouth at (${world.places.MAZE.x}, ${world.places.MAZE.z})`)
console.log('')

// The ONE placement in the whole run: the visitor arriving.
const start = world.places.LANDING
await page.evaluate(({ x, z, rotation }) => {
  const g = window.__world
  const y = g.terrain.colliderHeightAt(x, z) + 2
  g.vehicle.moveTo({ x, y, z }, rotation ?? 0)
  g.view.focusPoint.trackedPosition.set(x, y, z)
  g.view.snapToTarget()
}, start)
await page.waitForTimeout(1200)
await page.screenshot({ path: path.join(OUT, '00-landing.png') })

const reports = []
let from = [start.x, start.z]
let index = 1
for (const leg of TOUR) {
  const to = world.places[leg.stop]
  // Line up outside a walled venue, then drive in down its own axis.
  const standOff = world.approaches[leg.stop]
  const route = buildRoute(from, leg.via, standOff ? [standOff.x, standOff.z] : [to.x, to.z])
  if (standOff) route.push([to.x, to.z])
  let length = 0
  for (let i = 1; i < route.length; i++) length += dist(route[i], route[i - 1])
  // Three seconds per ten metres, which is a very relaxed 3.3 m/s, and
  // never less than forty — a short leg that goes wrong needs long
  // enough to prove it went wrong rather than ran out of clock.
  const report = await driveLeg(leg.stop, route, to, Math.max(40, length * 0.34))
  report.route = `${Math.round(length)} m via ${leg.via.join(' + ')}`
  reports.push(report)
  const file = `${String(index).padStart(2, '0')}-${leg.stop.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`
  await page.screenshot({ path: path.join(OUT, `${file}.png`) })
  console.log(
    `  ${report.arrived ? 'ok  ' : 'FAIL'}  ${leg.stop.padEnd(13)} ${report.route.padEnd(52)}` +
    ` ${report.seconds}s · closest ${report.closest.toFixed(0)} m` +
    `${report.arrived ? '' : ` · from (${report.from.map(Math.round).join(', ')})`}`,
  )
  for (const stall of report.stalls) {
    console.log(
      `          stalled at (${stall.at.map(Math.round).join(', ')}) on ${stall.gradient.toFixed(0)}°` +
      ` with ${stall.wheels} wheels down, ${stall.above.toFixed(1)} m over the ground` +
      `${stall.flipped ? ', on its roof' : ''}${stall.wedged ? ', wedged' : ''}` +
      `${stall.water ? `, ${stall.water.under} m of water over the ground` : ''}`,
    )
  }
  for (const jump of report.teleports) console.log(`          TELEPORTED ${jump} — the engine recovered the car; the tour did not drive this`)
  if (report.wettest) console.log(`          drove through water ${report.wettest.under} m deep at (${report.wettest.at.join(', ')})`)
  if (report.crossedBridge) console.log('          crossed the bridge on the deck')
  if (report.startedOnItsRoof) console.log(`          started this leg immobile — ${report.flippedSamples} sample(s) on its roof, ${report.wedgedSamples} wedged`)
  else if (report.firstFlip) {
    console.log(`          went over at (${report.firstFlip.at.map(Math.round).join(', ')}) on ${report.firstFlip.gradient.toFixed(0)}° — ${report.flippedSamples} sample(s) on its roof, ${report.wedgedSamples} wedged`)
  }
  // No repositioning between legs. The next leg is built from where
  // the car ACTUALLY is — including when that is halfway up a wall —
  // which is the whole point of the exercise.
  from = await page.evaluate(() => [window.__world.player.position.x, window.__world.player.position.z])
  index++
}

if (WIDE) {
  await page.evaluate(() => {
    const g = window.__world
    g.view.spherical.radius.edges.max = 620
    g.view.spherical.radius.edges.min = 620
    g.view.spherical.targetPhi = Math.PI * 0.16
    g.view.zoom.baseRatio = 0
    g.view.zoom.smoothedRatio = 0
    g.renderer.scene.fog = null
    g.view.camera.far = 2200
    g.view.camera.updateProjectionMatrix()
    g.view.focusPoint.trackedPosition.set(0, 0, 0)
    g.view.snapToTarget()
    g.renderer.instance.setClearColor('#f4f2ee', 1)
  })
  await page.waitForTimeout(1400)
  await page.screenshot({ path: path.join(OUT, 'zz-overview.png') })
}

const missed = reports.filter((r) => !r.arrived)
const teleports = reports.reduce((n, r) => n + r.teleports.length, 0)
const stalls = reports.reduce((n, r) => n + r.stalls.length, 0)
const driven = reports.reduce((n, r) => n + r.driven, 0)
const steepest = reports.reduce((d, r) => Math.max(d, r.steepestClimbed), 0)
const bridged = reports.some((r) => r.crossedBridge)

console.log(`\n  ${Math.round(driven)} m driven · steepest gradient climbed ${steepest.toFixed(0)}°`)
console.log(`  ${bridged ? 'crossed the bridge on its deck' : 'NEVER CROSSED THE BRIDGE — the leg to SOCIAL forded the river or went round'}`)
console.log(`\n${missed.length} stop(s) not reached${missed.length ? ': ' + missed.map((r) => r.name).join(', ') : ''}`)
console.log(`${stalls} stall(s) · ${teleports} teleport(s)`)
if (errors.length) console.log(`page errors: ${errors.slice(0, 3).join(' | ')}`)
console.log(`\nscreenshots → ${OUT}\n`)

await browser.close()
process.exit(missed.length || teleports ? 1 : 0)
