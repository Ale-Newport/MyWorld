/**
 * NEWPORT LANES — five sets, played with the car.
 *
 *   node scripts/world-bowling-qa.mjs [baseUrl] [--sets=5] [--headed]
 *
 * The brief's requirement for bowling is not "it builds": it is that
 * ten physical pins stand in the right places, that the screen shows
 * the pins that are actually down, and that the whole thing survives
 * being played over and over. So this plays it — with keyboard input,
 * through the real interaction point, with no completion methods and
 * no score mutations — and after every ball it compares the SCREEN's
 * pin state against the PHYSICAL pins read straight off the bodies.
 *
 * What it asserts, per set:
 *   · ten pins, on their spots, upright, at the start
 *   · the standard 1/2/3/4 triangle, at the regulation pitch
 *   · the ball leaves the mark under its own physics
 *   · the screen's ten indicators match the ten bodies, every frame
 *     it is sampled — this is the "no stale pin icons" rule
 *   · the set reaches a score and the venue re-racks clean
 *
 * And once, before the sets, the four things the rebuild is FOR:
 * the lane is flush with the ground it stands on, nothing on it is a
 * wall, the screen is parallel to the lane with nothing solid where
 * it floats, and it slides along the lane to follow the car.
 *
 * Aiming is deliberately varied between sets — down the middle, off
 * each shoulder, and a deliberate gutter — because a rig that only
 * ever throws the same ball only ever tests one throw.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const SETS = Number(args.find((a) => a.startsWith('--sets='))?.slice(7) ?? 5)
const HEADED = args.includes('--headed')
const OUT = '.qa/bowling'

await mkdir(OUT, { recursive: true })

const failures = []
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures.push(name)
}

const browser = await chromium.launch({
  headless: !HEADED,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', (e) => failures.push(`page error: ${e.message}`))

await page.addInitScript(() => localStorage.setItem('alejandro-world-save-v1', JSON.stringify({
  version: 3, settings: { quality: 'medium', onboarded: true, muted: true }, progress: {},
})))
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => window.__world?.player?.state === 'default', { timeout: 60000 })

const wait = (ms) => page.waitForTimeout(ms)

/** Everything the venue knows about itself, in venue-local space. */
const venue = () => page.evaluate(() => {
  const g = window.__world
  const m = g.minigames.get('bowling')
  const spot = g.geography.PLAY_SPOTS.find((p) => p.id === 'bowling')
  const yaw = spot.rotation ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const local = (x, z) => ({
    x: (x - spot.x) * cos - (z - spot.z) * sin,
    z: (x - spot.x) * sin + (z - spot.z) * cos,
  })
  return {
    yaw,
    at: { x: spot.x, z: spot.z },
    mark: m.startPosition.toArray(),
    ballHome: m.ball.mesh.position.toArray(),
    pins: m.pins.map((p) => ({
      number: p.number,
      spot: local(p.spot.x, p.spot.z),
      at: local(p.physical.current.position.x, p.physical.current.position.z),
      y: +p.physical.current.position.y.toFixed(2),
      // The pin's own up vector against world up: the tilt test that
      // catches a pin lying on the deck but still on its spot.
      tilt: +(1 - 2 * (p.physical.current.quaternion.x ** 2 + p.physical.current.quaternion.z ** 2)).toFixed(3),
      enabled: p.physical.body.isEnabled(),
    })),
    standing: m.standing.slice(),
    state: m.state,
    phase: m.phase ?? null,
    frame: m.frame,
    down: m.down,
    score: m.score,
  }
})

/** The board, read back out of its own canvas rather than out of the
 *  fields that painted it: a screen that agrees with the model but not
 *  with itself is exactly the failure this is looking for. */
const board = () => page.evaluate(() => {
  const g = window.__world
  const m = g.minigames.get('bowling')
  const c = m.canvas.getContext('2d')
  /*
    THESE FOUR NUMBERS ARE A CONTRACT WITH Bowling.ts's paint().

    The ten indicators are drawn in a 1/2/3/4 triangle from (512, 106)
    with a 200 x 132 pitch, back row at the top. Sample sixteen pixels
    up each pin's belly, where the silhouette is 16 px wide: a
    standing pin is painted #f4f1e6 (red 244), a fallen one #1d2622
    (red 29), so a threshold of 120 separates them with room either
    side.

    They were 152 / 118 / 52 / 66 on a 1024 x 448 canvas, when the
    diagram shared the board with a header, a scoresheet and three
    lines of text. The board is now the diagram and nothing else, so
    the rack is centred and four times the size. If the diagram ever
    moves again and these do not move with it, EVERY sample reads
    background, `lit` comes back all false, and the mismatch check at
    the bottom of this file passes without testing anything.
  */
  const cx = 512
  const top = 106
  const lit = []
  let index = 0
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col <= row; col++) {
      const px = Math.round(cx + (col - row / 2) * 200)
      const py = Math.round(top + (3 - row) * 132 + 10)
      const [r] = c.getImageData(px, py, 1, 1).data
      lit[index] = r > 120
      index++
    }
  }
  return { lit, painted: m.painted }
})

const startSet = async () => {
  await page.evaluate(() => {
    const g = window.__world
    g.minigames.cancel()
    g.store.getState().setOverlay(null)
  })
  await wait(400)
  // Through the real interaction point, not through `minigames.start`:
  // the prompt is the only way in and it is part of what is being
  // tested. Park the car at the mark first so the point is in range.
  await page.evaluate(() => {
    const g = window.__world
    const m = g.minigames.get('bowling')
    const p = m.startPosition
    g.vehicle.moveTo({ x: p.x, y: p.y + 0.2, z: p.z }, m.downLane ?? 0)
    g.view.snapToTarget()
  })
  await wait(500)
  await page.keyboard.press('Enter')
  await wait(900)
}

/** Drive the ball. `aim` is metres across the lane, from the mark. */
const throwBall = async (aim, ms = 1500) => {
  await page.evaluate((aim) => {
    const g = window.__world
    const m = g.minigames.get('bowling')
    const spot = g.geography.PLAY_SPOTS.find((p) => p.id === 'bowling')
    const yaw = spot.rotation ?? 0
    // Line the car up BEHIND the ball, offset across the lane, facing
    // down it. The ball is then pushed by the chassis — there is no
    // launch method and there is not going to be one.
    const b = m.ball.mesh.position
    const back = 6
    const fx = -Math.sin(yaw)
    const fz = -Math.cos(yaw)
    const sx = Math.cos(yaw)
    const sz = -Math.sin(yaw)
    const x = b.x - fx * back + sx * aim
    const z = b.z - fz * back + sz * aim
    // The venue's own deck height plus a little. The lane is flush
    // with the ground now, so this is only a drop height rather than
    // the way it used to be load-bearing: at ground level the car
    // spawned inside the old foundation and the solver spat it out
    // through the floor.
    g.vehicle.moveTo({ x, y: m.startPosition.y + 0.2, z }, Math.atan2(-fz, fx))
    g.view.snapToTarget()
  }, aim)
  await wait(500)
  await page.keyboard.down('KeyW')
  await wait(ms)
  await page.keyboard.up('KeyW')
}

/** Which of the ten are physically standing, by the venue's own rule:
 *  enabled, upright, and still on the deck. */
const standingPins = (v) => v.pins.map((p) => p.enabled && p.tilt > 0.64
  && Math.abs(p.at.x) < 4.6 && p.at.z > -10.6 && p.at.z < -1.5)
const bits = (list) => list.map((u) => (u ? 1 : 0)).join('')

console.log(`\nNEWPORT LANES — ${SETS} sets at ${BASE}\n`)

const first = await venue()
check('ten pins exist', first.pins.length === 10, `${first.pins.length}`)
check('every pin is enabled and upright at rest',
  first.pins.every((p) => p.enabled && p.tilt > 0.9),
  first.pins.map((p) => p.tilt).join(' '))

/* The rack: a 1/2/3/4 triangle. Row pitch is the pin pitch times
   cos 30°, which is what makes it equilateral rather than merely
   triangular — a rack authored on a square grid looks right from
   above and plays wrong, because the 1 pin then sits square to the 2
   and the 3 instead of between them. */
{
  const rows = [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10]]
  const spots = new Map(first.pins.map((p) => [p.number, p.spot]))
  const pitch = Math.abs(spots.get(3).x - spots.get(2).x)
  const rowPitch = Math.abs(spots.get(2).z - spots.get(1).z)
  check('pin pitch is uniform across every row',
    rows.every((row) => row.length < 2 || row.slice(1).every((n, i) =>
      Math.abs(Math.abs(spots.get(n).x - spots.get(row[i]).x) - pitch) < 0.02)),
    `${pitch.toFixed(3)} u`)
  check('rows are equilateral', Math.abs(rowPitch - pitch * Math.cos(Math.PI / 6)) < 0.02,
    `row ${rowPitch.toFixed(3)} vs ${(pitch * Math.cos(Math.PI / 6)).toFixed(3)}`)
  check('rows are evenly spaced down the deck',
    rows.every((row, r) => row.every((n) => Math.abs((spots.get(n).z - spots.get(1).z) + r * rowPitch) < 0.02)))
  check('no two pins share ground',
    first.pins.every((a, i) => first.pins.every((b, j) =>
      i === j || Math.hypot(a.spot.x - b.spot.x, a.spot.z - b.spot.z) > 0.9)))
  check('every pin sits on the deck, not in it or above it',
    first.pins.every((p) => Math.abs(p.y - first.pins[0].y) < 0.05))
}

/*
  GROUND LEVEL, NO WALLS.

  Both read off the venue's ONE fixed body, found the way
  scripts/_probe.mjs finds it — the static body at the spot carrying
  the most colliders — so a re-cut lane moves this check with it. The
  deck used to stand 0.72 m over the highest ground under its own
  footprint and 0.90 over the respawn two metres away, behind a
  2.05 m kickback and a 3.6 m masking unit.
*/
{
  const v = await page.evaluate(() => {
    const g = window.__world
    const m = g.minigames.get('bowling')
    const spot = g.geography.PLAY_SPOTS.find((p) => p.id === 'bowling')
    const yaw = spot.rotation ?? 0
    const cos = Math.cos(yaw)
    const sin = Math.sin(yaw)
    const wx = (dx, dz) => spot.x + dx * cos + dz * sin
    const wz = (dx, dz) => spot.z - dx * sin + dz * cos

    // The venue rectangle, in its own frame: BACK_Z..APPROACH_Z by
    // +/-HALF_W. Same probe Bowling.ts runs at build time.
    let highest = -Infinity
    for (let dz = -16; dz <= 38; dz += 1.5) {
      for (let dx = -5.835; dx <= 5.835; dx += 1.5) {
        const h = g.terrain.colliderHeightAt(wx(dx, dz), wz(dx, dz))
        if (h > highest) highest = h
      }
    }

    const shell = g.physics.physicals
      .filter((p) => p.static
        && Math.hypot(p.initialState.position.x - spot.x, p.initialState.position.z - spot.z) < 1)
      .sort((a, b) => b.colliders.length - a.colliders.length)[0]
    let tallest = 0
    for (const c of shell?.colliders ?? []) {
      // Trimeshes (the skirt) report no half extents, and a skirt that
      // ramps down to the terrain is the opposite of a wall anyway.
      const h = c.halfExtents?.()
      if (!h) continue
      tallest = Math.max(tallest, c.translation().y + h.y - m.floorY)
    }

    // Straight off matrixWorld rather than through THREE, which is not
    // a global in the page: elements 12/13/14 are the translation and
    // 8/9/10 are the object's own +Z, which for a plane is its normal.
    const e = m.screen.matrixWorld.elements
    const board = { x: e[12], y: e[13], z: e[14] }
    const len = Math.hypot(e[8], e[9], e[10]) || 1
    const facing = { x: e[8] / len, z: e[10] / len }
    // Down-lane in world terms, from the venue's own getter.
    const lane = { x: Math.cos(m.downLane), z: -Math.sin(m.downLane) }
    let nearestCollider = Infinity
    for (const p of g.physics.physicals) {
      for (const c of p.colliders) {
        const t = c.translation()
        nearestCollider = Math.min(
          nearestCollider,
          Math.hypot(t.x - board.x, t.y - board.y, t.z - board.z),
        )
      }
    }
    return {
      floorY: m.floorY,
      highest,
      tallest,
      colliders: shell?.colliders.length ?? 0,
      alongLane: Math.abs(facing.x * lane.x + facing.z * lane.z),
      nearestCollider,
    }
  })
  check('the venue is one body and its colliders were found', v.colliders >= 6, `${v.colliders} colliders`)
  check('the lane is flush with the ground under it',
    v.floorY - v.highest < 0.12, `deck stands ${(v.floorY - v.highest).toFixed(3)} m proud`)
  check('nothing on the venue is a wall',
    v.tallest <= 0.45, `tallest collider is ${v.tallest.toFixed(2)} m over the deck`)
  // The board's own normal against the lane's direction. Parallel to
  // the lane means the normal is square across it, so the dot product
  // with down-lane is zero however the venue is yawed.
  check('the screen is parallel to the lane', v.alongLane < 0.02, v.alongLane.toFixed(4))
  // 4.5 m, because the board floats 5 m over the deck: anything at
  // ground level is at least that far away whatever its footprint, so
  // the only thing this can catch is a collider up in the air beside
  // the board — which is exactly what the old scoreboard housing was
  // (12 x 4.4 x 1.0, centred 3.96 m from where the board now hangs).
  check('nothing solid stands where the screen floats',
    v.nearestCollider > 4.5, `nearest collider ${v.nearestCollider.toFixed(1)} m`)
}

/*
  AND IT FOLLOWS THE CAR.

  Park beside the lane — never on it, or this test knocks the rack
  over before the first set — once level with the pin deck and once
  level with the mark, and read the board's own offset down the lane
  each time. Two seconds is about five damping time constants at
  lambda 2.6, so the board has arrived rather than being caught in
  transit.
*/
{
  const parkBeside = async (dz) => {
    await page.evaluate((dz) => {
      const g = window.__world
      const spot = g.geography.PLAY_SPOTS.find((p) => p.id === 'bowling')
      const yaw = spot.rotation ?? 0
      const x = spot.x + 12 * Math.cos(yaw) + dz * Math.sin(yaw)
      const z = spot.z - 12 * Math.sin(yaw) + dz * Math.cos(yaw)
      g.vehicle.moveTo({ x, y: g.terrain.colliderHeightAt(x, z) + 2, z }, 0)
      g.view.snapToTarget()
    }, dz)
    await wait(2000)
    return page.evaluate(() => window.__world.minigames.get('bowling').screen.position.z)
  }
  const atDeck = await parkBeside(4)
  check('the screen slides down the lane to the car', atDeck < 8, `board at ${atDeck.toFixed(1)}`)
  const atMark = await parkBeside(36)
  check('and back up it', atMark > 30, `board at ${atMark.toFixed(1)}`)
}

/* Five sets. The aims are deliberately different: a pocket ball, one
   off each shoulder, a thin one and a gutter. */
/* Five aims across the bed, the widest 3.2 m off the centreline.

   It was 4.2, which was inside the lane while the lane had 0.6 m gutters
   and kickbacks either side of it: the ball came back. On the rebuilt
   venue the gutters are 0.12 m channels with a cross-fall AWAY from the
   bed and there are no walls at all, so 4.2 puts the ball off the
   venue — the throw resolves with nothing knocked over, and five sets
   spent their twelve-ball budget without finishing three frames. The
   lane bed is 8.7 m wide; 3.2 is a wide ball, not a lost one. */
const AIMS = [0, -1.8, 1.8, -0.7, 3.2]
let mismatches = 0

for (let set = 0; set < SETS; set++) {
  const aim = AIMS[set % AIMS.length]
  await startSet()

  const opening = await venue()
  check(`set ${set + 1}: re-racked to ten standing`,
    opening.standing.filter(Boolean).length === 10 && opening.pins.every((p) => p.enabled && p.tilt > 0.9),
    `${opening.standing.filter(Boolean).length}/10`)
  check(`set ${set + 1}: every pin back on its authored spot`,
    opening.pins.every((p) => Math.hypot(p.at.x - p.spot.x, p.at.z - p.spot.z) < 0.25),
    Math.max(...opening.pins.map((p) => Math.hypot(p.at.x - p.spot.x, p.at.z - p.spot.z))).toFixed(3))

  let balls = 0
  const seen = []
  /*
    A set is three frames — seven balls with a fill, nine if the last
    frame is a strike. Twelve is enough to run one out even with two
    gutters in it.
  */
  for (let ball = 0; ball < 12; ball++) {
    const before = await venue()
    if (before.state === 'finished' || before.state === 'idle') break

    /*
      THE BOARD MUST NOT LIE ABOUT WHAT IS LEFT TO HIT.

      At the mark the diagram is what the player aims against, so a pin
      shown STANDING that is physically down is a defect — that is the
      "no stale pin icons" rule at the only point it matters.

      The other direction is allowed, and deliberately: `standing`
      latches during a roll so the diagram does not flicker while ten
      bodies are bouncing off each other, and a pin that was knocked and
      wobbled back upright stays counted. That is the debounce the brief
      asks for, not a disagreement.
    */
    await wait(500)
    {
      const settled = await venue()
      const b = await board()
      const physical = standingPins(settled)
      const lying = b.lit.map((up, i) => up && !physical[i])
      if (lying.some(Boolean)) {
        mismatches++
        seen.push(`set ${set + 1} ball ${ball + 1} AT THE MARK: screen ${bits(b.lit)} claims pins that are down ${bits(physical)}`)
      }
    }

    await throwBall(ball === 0 ? aim : AIMS[(set + ball) % AIMS.length])
    balls++

    /*
      Then sample WHILE THE BALL IS ROLLING, not only after it settles:
      the requirement is a live readout, and a board that caught up at
      the end of the throw would pass an after-the-fact comparison.

      Only while rolling. During the sweep the board deliberately holds
      the throw's result while the pinsetter clears and re-racks
      underneath it — a diagram that flicked back to ten the instant
      the machine picked the pins up would be worse, not better.
    */
    for (let sample = 0; sample < 26; sample++) {
      await wait(400)
      const v = await venue()
      if (v.phase === 'rolling') {
        const b = await board()
        const physical = standingPins(v)
        // Same asymmetry as at the mark: the board may be AHEAD of the
        // bodies (a pin latched down that has not settled yet) but never
        // behind them.
        if (b.lit.some((up, i) => up && !physical[i])) {
          mismatches++
          seen.push(`set ${set + 1} ball ${ball + 1} rolling: screen ${bits(b.lit)} claims pins that are down ${bits(physical)}`)
        }
      }
      // Back at the mark with the ball returned: the throw is over.
      if (v.phase === 'ready' && sample > 1) break
      if (v.state !== 'running') break
    }
  }
  if (seen.length) for (const line of seen.slice(0, 6)) console.log(`        ${line}`)

  const after = await venue()
  check(`set ${set + 1}: played out three frames`,
    after.state === 'finished' || after.frame >= 2,
    `state ${after.state}, frame ${after.frame + 1}/3, score ${after.score}, ${balls} balls`)
  await page.screenshot({ path: `${OUT}/set-${set + 1}.png` })
  await page.evaluate(() => window.__world.minigames.cancel())
  await wait(700)
}

check('the screen never showed a pin that was not there', mismatches === 0, `${mismatches} sample(s)`)

const rest = await venue()
check('the venue is clean after the last set',
  rest.pins.every((p) => p.enabled) && rest.standing.filter(Boolean).length === 10,
  `${rest.standing.filter(Boolean).length}/10 standing`)

console.log(`\n${failures.length ? `${failures.length} failing check(s)` : 'all checks passed'}\n`)
await browser.close()
process.exit(failures.length ? 1 : 0)
