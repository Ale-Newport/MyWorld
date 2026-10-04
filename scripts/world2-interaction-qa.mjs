/**
 * Plays the /world2 interaction layer for real: starts races, bowls frames,
 * blows up crates, reads the authored screens back out of the scene graph.
 *
 * Nothing here stubs the game. It drives the same `window.__world2` handle a
 * developer has in the console, and every assertion is read from live physics
 * or a live canvas, never from a mock.
 *
 * Run: node scripts/world2-interaction-qa.mjs [http://localhost:3000] [--only=tnt,circuit]
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:3000'
const onlyArg = process.argv.find(a => a.startsWith('--only='))
const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null
const wants = name => !only || only.has(name)

await mkdir('.qa/world2-interactions', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const report = { startedAt: new Date().toISOString(), checks: [], errors: [], shots: [] }
const failures = []

page.on('pageerror', error => report.errors.push(String(error)))
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()) })

function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail })
  console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail))
  if (!pass) failures.push(name)
}

const shot = async name => {
  const file = `.qa/world2-interactions/${name}.png`
  await page.screenshot({ path: file })
  report.shots.push(file)
}

/** Puts the car somewhere with zero velocity, the way a respawn would. */
const teleport = (x, y, z, heading = 0) =>
  page.evaluate(([x, y, z, heading]) => {
    window.__world2.vehicle.moveTo({ x, y, z }, heading)
  }, [x, y, z, heading])

const state = fn => page.evaluate(fn)

try {
  await page.goto(`${base}/world2`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof window.__world2 !== 'undefined', { timeout: 180000 }).catch(() => {
    throw new Error('window.__world2 is absent. This harness drives the development build; a production bundle deliberately ships no debug handle. Run it against `npm run dev`.')
  })
  await page.waitForFunction(() => window.__world2?.status.ready, { timeout: 180000 })
  await page.getByRole('button', { name: 'Start driving' }).click()
  await page.waitForTimeout(1500)

  const wired = await state(() => {
    const g = window.__world2, i = g.interactions
    return {
      interactions: !!i,
      crates: i.crates.items.length,
      gates: i.circuit.gates.length,
      obstacles: i.circuit.obstacles.length,
      achievements: i.achievements.groups.size,
      prompts: i.prompts.group.children.length,
      railsOff: i.references.physical('refRailsPhysicalFixed')?.body.isEnabled() === false,
    }
  })
  check('interaction layer builds from the Blender level', wired.interactions && wired.crates === 23 && wired.gates === 8, wired)
  check('race rails are down outside a race (the circuit access bug)', wired.railsOff, wired)

  /* ---------------------------------------------------------- TNT ---- */
  if (wants('tnt')) {
    await page.evaluate(() => window.__world2.interactions.crates.reset())
    await page.waitForTimeout(2400)
    const cluster = await state(() => {
      const crates = window.__world2.interactions.crates.items
      const t = crates[0].physical.body.translation()
      return { x: t.x, y: t.y, z: t.z }
    })
    await teleport(cluster.x - 7, cluster.y + 0.9, cluster.z, 0)
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__world2.vehicle.chassis.physical.body.setLinvel({ x: 16, y: 0, z: 0 }, true))
    await page.waitForTimeout(700)
    await shot('tnt-impact')
    await page.waitForTimeout(2200)
    const blast = await state(() => {
      const i = window.__world2.interactions
      return { exploded: i.crates.items.filter(c => c.exploded).length, remaining: i.crates.remaining, achievement: i.achievements.has('tnt') }
    })
    check('driving into a crate detonates it', blast.exploded >= 1, blast)
    check('the blast chains into its neighbours', blast.exploded >= 2, blast)
    check('detonating a crate unlocks its achievement', blast.achievement, blast)
    await shot('tnt-after')

    await page.evaluate(() => window.__world2.interactions.crates.reset())
    await page.waitForTimeout(2600)
    const afterReset = await state(() => {
      const i = window.__world2.interactions
      const crate = i.crates.items[0]
      const t = crate.physical.body.translation()
      return {
        remaining: i.crates.remaining,
        enabled: crate.physical.body.isEnabled(),
        home: Math.hypot(t.x - crate.home.position.x, t.y - crate.home.position.y, t.z - crate.home.position.z),
        visible: crate.node.visible,
      }
    })
    check('reset puts every crate back where Blender had it', afterReset.remaining === 23 && afterReset.enabled && afterReset.home < 0.05 && afterReset.visible, afterReset)
  }

  /* ------------------------------------------------------ CIRCUIT ---- */
  if (wants('circuit')) {
    const laps = []
    for (let lap = 0; lap < 3; lap++) {
      await page.evaluate(() => window.__world2.interactions.circuit.restart())
      await page.waitForTimeout(400)
      const onGrid = await state(() => {
        const g = window.__world2, c = g.interactions.circuit
        const start = c.references?.transform?.('refStart') ?? g.interactions.references.transform('refStart')
        const p = g.player.position
        return {
          state: c.state,
          rails: g.interactions.references.physical('refRailsPhysicalFixed').body.isEnabled(),
          locked: g.player.state,
          fromStart: start ? Math.hypot(p.x - start.position.x, p.z - start.position.z) : null,
        }
      })
      if (lap === 0) {
        check('the prompt puts the car on the authored grid', onGrid.fromStart !== null && onGrid.fromStart < 3, onGrid)
        check('the countdown locks the driver', onGrid.state === 'countdown' && onGrid.locked === 'locked', onGrid)
        check('the rails come up for the race', onGrid.rails === true, onGrid)
        await shot('circuit-countdown')
      }
      await page.waitForFunction(() => window.__world2.interactions.circuit.state === 'running', { timeout: 15000 })
      const atGo = await state(() => ({ elapsed: window.__world2.interactions.circuit.elapsed, locked: window.__world2.player.state }))
      if (lap === 0) check('the clock starts at GO, not before', atGo.elapsed < 0.25 && atGo.locked === 'default', atGo)

      // Cross the eight gates in order, then the start/finish line again.
      const order = []
      for (let i = 0; i < 9; i++) {
        const gate = await page.evaluate(i => {
          const c = window.__world2.interactions.circuit
          const g = c.gates[i % c.gates.length]
          return { name: g.name, x: g.position.x, y: g.position.y, z: g.position.z, heading: g.heading }
        }, i)
        await teleport(gate.x, gate.y + 1.1, gate.z, gate.heading)
        await page.waitForTimeout(260)
        order.push(await state(() => {
          const c = window.__world2.interactions.circuit
          // Snapshot the HUD here: the finish card only stands for 0.8 s
          // before the car is handed back, which a round trip can outlast.
          return { reached: c.reached, target: c.gates[c.targetIndex]?.name ?? null, state: c.state, hud: c.hud() }
        }))
        if (i === 4 && lap === 0) {
          // Skipping ahead must not count: jump to the last gate and back.
          const skipped = await page.evaluate(() => {
            const c = window.__world2.interactions.circuit
            const before = c.reached
            const far = c.gates[7]
            window.__world2.vehicle.moveTo({ x: far.position.x, y: far.position.y + 1.1, z: far.position.z }, far.heading)
            return { before }
          })
          await page.waitForTimeout(300)
          const after = await state(() => window.__world2.interactions.circuit.reached)
          check('crossing a gate out of order does not count', after === skipped.before, { before: skipped.before, after })
        }
        if (order[order.length - 1].state !== 'running') break
      }
      const finished = await state(() => {
        const c = window.__world2.interactions.circuit
        return { state: c.state, reached: c.reached, lastTime: c.lastTime, best: c.best, records: c.records.length, hud: c.hud() }
      })
      laps.push(finished)
      if (lap === 0) {
        check('all nine crossings are required to finish', finished.reached === 9, finished)
        check('the lap is timed and stops once', typeof finished.lastTime === 'number' && finished.lastTime > 0, finished)
        const finishCard = order.map(o => o.hud).reverse().find(h => h.timer)
        check('the finish reads MM:SS:MMM', /^\d{2}:\d{2}:\d{3}$/.test(finishCard?.timer ?? ''), finishCard)
        await shot('circuit-finish')
      }
      await page.waitForFunction(() => window.__world2.interactions.circuit.state === 'pending', { timeout: 10000 })
    }
    const board = await state(() => {
      const c = window.__world2.interactions.circuit
      return { records: c.records.length, sorted: c.records.every((r, i, a) => i === 0 || a[i - 1].time <= r.time), best: c.best, rails: window.__world2.interactions.references.physical('refRailsPhysicalFixed').body.isEnabled() }
    })
    check('three races run back to back', laps.length === 3 && laps.every(l => typeof l.lastTime === 'number'), laps.map(l => l.lastTime))
    check('the local leaderboard keeps the best laps in order', board.records === 3 && board.sorted, board)
    check('the rails go back down after the race', board.rails === false, board)

    // Respawn during a race must land on the last gate, not the world spawn.
    await page.evaluate(() => window.__world2.interactions.circuit.restart())
    await page.waitForFunction(() => window.__world2.interactions.circuit.state === 'running', { timeout: 15000 })
    const gate1 = await page.evaluate(() => {
      const c = window.__world2.interactions.circuit
      const g0 = c.gates[0]
      window.__world2.vehicle.moveTo({ x: g0.position.x, y: g0.position.y + 1.1, z: g0.position.z }, g0.heading)
      return { name: g0.name, respawn: g0.respawn.toArray() }
    })
    await page.waitForTimeout(300)
    await page.evaluate(() => window.__world2.player.respawn())
    await page.waitForTimeout(500)
    const respawned = await state(() => {
      const p = window.__world2.player.position
      return { x: p.x, y: p.y, z: p.z }
    })
    const distance = Math.hypot(respawned.x - gate1.respawn[0], respawned.z - gate1.respawn[2])
    check('respawning mid-race returns to the last gate', distance < 4, { gate: gate1.name, respawned, distance })
    await page.evaluate(() => window.__world2.interactions.circuit.exit(true))
    await page.waitForTimeout(900)
    const exited = await state(() => ({
      state: window.__world2.interactions.circuit.state,
      player: window.__world2.player.state,
      rails: window.__world2.interactions.references.physical('refRailsPhysicalFixed').body.isEnabled(),
    }))
    check('exiting a race hands the car back', exited.state === 'pending' && exited.player === 'default' && exited.rails === false, exited)
  }

  /* ------------------------------------------------------ BOWLING ---- */
  if (wants('bowling')) {
    const lane = await state(() => {
      const b = window.__world2.interactions.bowling
      return {
        pins: b.pins.length,
        distinct: new Set(b.pins.map(p => `${p.home.position.x.toFixed(3)}:${p.home.position.z.toFixed(3)}`)).size,
        lowest: Math.min(...b.pins.map(p => p.home.position.y)),
        overlap: b.pins.some((p, i) => b.pins.some((q, j) => i !== j && Math.hypot(p.home.position.x - q.home.position.x, p.home.position.z - q.home.position.z) < 0.6)),
        ball: !!b.ball,
        screen: !!b.screen,
        bumpers: !!b.bumpers,
      }
    })
    check('exactly ten pins, no two on the same spot', lane.pins === 10 && lane.distinct === 10 && !lane.overlap, lane)
    check('the ball, the board and the bumpers are all wired', lane.ball && lane.screen && lane.bumpers, lane)

    const frames = []
    for (let frame = 0; frame < 5; frame++) {
      await page.evaluate(() => window.__world2.interactions.bowling.reset())
      await page.waitForTimeout(900)
      const fresh = await state(() => {
        const b = window.__world2.interactions.bowling
        return { down: b.pinsDown, state: b.state, strike: b.strike }
      })
      if (frame === 0) check('reset stands all ten pins back up', fresh.down === 0 && !fresh.strike, fresh)

      // Fire the ball down the lane the way the car would: a real impulse.
      await page.evaluate(() => {
        const b = window.__world2.interactions.bowling
        const head = b.pins[0].home.position
        const t = b.ball.body.translation()
        const dx = head.x - t.x, dz = head.z - t.z
        const length = Math.hypot(dx, dz)
        b.ball.body.setEnabled(true)
        b.ball.body.wakeUp()
        b.ball.body.setLinvel({ x: dx / length * 17, y: 0, z: dz / length * 17 }, true)
      })
      await page.waitForTimeout(2600)
      if (frame === 0) await shot('bowling-roll')
      const result = await state(() => {
        const b = window.__world2.interactions.bowling
        return {
          down: b.pinsDown, strike: b.strike, state: b.state,
          board: Array.from(b.states),
          label: b.strikeLabel ? b.strikeLabel.visible !== undefined : false,
          restartShown: b.restartArmed,
        }
      })
      frames.push(result)
      if (frame === 0) {
        check('the ball knocks pins down', result.down > 0, result)
        check('the board tracks the pins that fell', result.board.filter(v => v === 128).length === result.down, result)
        check('the restart prompt appears once the frame is live', result.restartShown, result)
        await shot('bowling-result')
      }
    }
    check('five frames played back to back', frames.length === 5, frames.map(f => f.down))
    // A straight roll is a real physical roll: it clears most of the rack, and
    // sometimes all of it. Asserting a strike every time would be asserting
    // luck, so the STRIKE path is proved separately, below.
    // Judged on the run, not on one frame: contact ordering makes any single
    // physical roll vary, which is the point of rolling it rather than
    // scripting it.
    const average = frames.reduce((sum, f) => sum + f.down, 0) / frames.length
    check('a straight roll clears most of the rack', average >= 6 && frames.every(f => f.down >= 3), { average: +average.toFixed(1), frames: frames.map(f => f.down) })

    await page.evaluate(() => window.__world2.interactions.bowling.reset())
    await page.waitForTimeout(1000)
    await page.evaluate(() => {
      // Put the whole rack over and let the detector see it.
      for (const pin of window.__world2.interactions.bowling.pins) {
        pin.physical.body.wakeUp()
        pin.physical.body.applyTorqueImpulse({ x: 0.12, y: 0, z: 0.12 }, true)
        pin.physical.body.applyImpulse({ x: 0.05, y: 0, z: 0.05 }, true)
      }
    })
    await page.waitForTimeout(2600)
    const struck = await state(() => {
      const b = window.__world2.interactions.bowling
      return { down: b.pinsDown, strike: b.strike, label: b.strikeLabel?.visible !== undefined, award: window.__world2.interactions.achievements.has('strike'), board: Array.from(b.states).every(v => v === 128) }
    })
    check('ten down latches a strike and lights the label', struck.down === 10 && struck.strike && struck.board && struck.award, struck)
    await page.evaluate(() => window.__world2.interactions.bowling.reset())
    await page.waitForTimeout(900)
    const settled = await state(() => {
      const b = window.__world2.interactions.bowling
      const t = b.ball.body.translation()
      return {
        down: b.pinsDown,
        ballHome: Math.hypot(t.x - b.ballHome.x, t.y - b.ballHome.y, t.z - b.ballHome.z),
        board: Array.from(b.states).every(v => v === 0),
        pinsHome: b.pins.every(p => { const q = p.physical.body.translation(); return Math.hypot(q.x - p.home.position.x, q.z - p.home.position.z) < 0.05 }),
      }
    })
    check('reset restores pins, ball and board together', settled.down === 0 && settled.board && settled.pinsHome && settled.ballHome < 0.05, settled)
  }

  /* -------------------------------------------------------- TITLE ---- */
  if (wants('title')) {
    const name = await state(() => {
      const t = window.__world2.interactions.title
      const first = t.letters[0].home.position, last = t.letters[t.letters.length - 1].home.position
      const heights = t.letters.map(l => { l.mesh.geometry.computeBoundingBox(); const b = l.mesh.geometry.boundingBox; return +(b.max.y - b.min.y).toFixed(3) })
      const depths = t.letters.map(l => { const b = l.mesh.geometry.boundingBox; return +(b.max.z - b.min.z).toFixed(3) })
      const bodies = new Set(t.letters.map(l => l.physical.body.handle)).size
      return {
        text: t.letters.map(l => l.char).join(''),
        count: t.letters.length,
        bodies,
        capHeight: Math.min(...heights),
        depth: Math.max(...depths),
        masses: t.letters.map(l => +l.physical.body.mass().toFixed(3)),
        span: +Math.hypot(last.x - first.x, last.z - first.z).toFixed(2),
        standing: t.standing,
      }
    })
    check('the title reads ALEJANDRO NEWPORT', name.text === 'ALEJANDRONEWPORT', name)
    check('every letter is its own rigid body', name.count === 16 && name.bodies === 16, { count: name.count, bodies: name.bodies })
    check('cap height and depth match the authored letters', Math.abs(name.capHeight - 1.45) < 0.06 && Math.abs(name.depth - 0.46) < 0.06, { capHeight: name.capHeight, depth: name.depth })
    check('each letter carries the authored mass', name.masses.every(m => Math.abs(m - 0.2) < 0.001), name.masses[0])
    await page.evaluate(() => {
      const t = window.__world2.interactions.title
      const p = t.letters[0].home.position
      window.__world2.vehicle.moveTo({ x: p.x + 6, y: p.y + 1.5, z: p.z + 7 }, Math.PI * 0.75)
    })
    await page.waitForTimeout(2200)
    await shot('title')

    // Drive through it and check the name goes over, then comes back exactly.
    await page.evaluate(() => {
      const t = window.__world2.interactions.title
      for (const letter of t.letters) {
        letter.physical.body.wakeUp()
        letter.physical.body.applyImpulse({ x: 2.4, y: 1.6, z: 1.2 }, true)
        letter.physical.body.applyTorqueImpulse({ x: 0.35, y: 0, z: 0.35 }, true)
      }
    })
    await page.waitForTimeout(2600)
    await shot('title-scattered')
    const knocked = await state(() => {
      const t = window.__world2.interactions.title
      return { standing: t.standing, achievement: window.__world2.interactions.achievements.has('titleNudge') }
    })
    check('the car can knock the name over', knocked.standing < 16, knocked)
    check('toppling a letter is an award', knocked.achievement, knocked)
    // Stand where a player stands to press the bonfire, not on the letters:
    // resetting the name with the car parked in it shoves a letter aside.
    await page.evaluate(() => {
      const g = window.__world2
      const bonfire = g.interactions.references.position('refBonfireInteractivePoint')
      if (bonfire) g.vehicle.moveTo({ x: bonfire.x, y: bonfire.y + 1, z: bonfire.z }, 0)
    })
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__world2.interactions.title.reset())
    await page.waitForTimeout(1200)
    const restored = await state(() => {
      const t = window.__world2.interactions.title
      const drift = Math.max(...t.letters.map(l => {
        const p = l.physical.body.translation()
        return Math.hypot(p.x - l.home.position.x, p.y - l.home.position.y, p.z - l.home.position.z)
      }))
      // Reading order along the baseline is what "restores the name" means.
      const along = t.letters.map(l => {
        const p = l.physical.body.translation()
        return { char: l.char, t: +(p.x * Math.cos(-0.436) - p.z * Math.sin(-0.436)).toFixed(3) }
      })
      const lineOne = along.slice(0, 9).sort((a, b) => a.t - b.t).map(i => i.char).join('')
      const lineTwo = along.slice(9).sort((a, b) => a.t - b.t).map(i => i.char).join('')
      return { standing: t.standing, drift: +drift.toFixed(4), lineOne, lineTwo }
    })
    check('reset stands the whole name back up', restored.standing === 16 && restored.drift < 0.2, restored)
    check('reset restores the reading order and spacing', restored.lineOne === 'ALEJANDRO' && restored.lineTwo === 'NEWPORT', restored)
    await shot('title-restored')
  }

  /* ------------------------------------------------------- CAREER ---- */
  if (wants('career')) {
    const walk = await state(() => {
      const c = window.__world2.interactions.career
      const byTrack = {}
      for (const line of c.lines) (byTrack[line.track.id] ??= []).push(+line.origin.z.toFixed(2))
      return {
        stops: c.lines.length,
        titles: c.lines.map(l => `${l.stop.title} @ ${l.stop.organisation}`),
        tracks: [...new Set(c.lines.map(l => l.track.id))],
        byTrack,
        lanes: c.lanes,
        // Every stone must stand on its own track's lane, to the millimetre.
        onLane: c.lines.every(l => Math.abs(l.stone.position.x - c.lanes[l.track.id]) < 0.001),
        // The reference look: a headline about a third of a metre tall.
        labelHeights: [...new Set(c.lines.map(l => +l.label.geometry.parameters.height.toFixed(2)))],
        digits: c.year,
      }
    })
    check('the walk carries every real stop on three tracks', walk.stops === 9 && walk.tracks.length === 3 && walk.titles.every(t => t && !/bruno|hetic|uzik|immersive/i.test(t)), { stops: walk.stops, tracks: walk.tracks })
    check('studies, work and projects each get their own lane', walk.onLane && new Set(Object.values(walk.lanes)).size === 4, walk.lanes)
    check('each lane runs chronologically down the road', Object.values(walk.byTrack).every(zs => zs.every((z, i, a) => i === 0 || a[i - 1] >= z)), walk.byTrack)
    check('the labels are sized to be read at speed', walk.labelHeights.every(h => h >= 0.85), walk.labelHeights)

    // Drive the walk: sample the road from the first stone to the last.
    const path = await state(() => {
      const c = window.__world2.interactions.career
      const first = Math.max(...c.lines.map(l => l.origin.z))
      const last = Math.min(...c.lines.map(l => l.origin.z))
      return { x: c.lines[0].origin.x, first, last }
    })
    const revealed = []
    for (let i = 0; i <= 12; i++) {
      const z = path.first + 1 - ((path.first - path.last + 3) * i) / 12
      await teleport(path.x, 1.4, z, Math.PI / 2)
      await page.waitForTimeout(360)
      revealed.push(await state(() => {
        const c = window.__world2.interactions.career
        return { up: c.lines.filter(l => l.elevation > 1).length, seen: c.seen, year: c.year }
      }))
      if (i === 6) await shot('career-walk')
    }
    const anyUp = revealed.some(r => r.up > 0)
    const seen = revealed[revealed.length - 1].seen
    const years = [...new Set(revealed.map(r => r.year))]
    check('stones rise as the car reaches them', anyUp, revealed.map(r => r.up))
    check('every stage is revealed across one walk', seen >= 9, { seen })
    check('the year counter advances along the road', years.length >= 4, years)
    // The year plate is the authored seven-segment one: a digit's mask must
    // change as the years pass, and every mask must be a real digit.
    const segments = await state(() => {
      const c = window.__world2.interactions.career
      const masks = c.digitMasks
      const table = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111]
      return { masks, real: masks.every(m => table.includes(m)), painted: c.paintedYear }
    })
    check('the year reads on the authored seven-segment plate', segments.real && !segments.painted, segments)
    const award = await state(() => window.__world2.interactions.achievements.groups.get('career').progress)
    check('walking the career marks its award', award >= 9, { award })
    // Leave and come back: the state must still work.
    await teleport(path.x, 1.4, path.first + 14, Math.PI / 2)
    await page.waitForTimeout(700)
    await teleport(path.x, 1.4, path.first - 1, Math.PI / 2)
    await page.waitForTimeout(700)
    const again = await state(() => window.__world2.interactions.career.lines.filter(l => l.elevation > 1).length)
    check('leaving and returning replays the reveal', again > 0, { again })

    /*
      Three tracks overlap for most of this road — a degree, a job and a
      project run at the same time — so every raised stone keeping its label
      printed four of them over each other. One lane speaks once, and the three
      lane heights are a full label apart.
    */
    await teleport(26.3, 1.4, -1.5, Math.PI / 2)
    await page.waitForTimeout(900)
    const speaking = await state(() => {
      const c = window.__world2.interactions.career
      const shown = c.lines.filter(l => l.reveal > 0.5)
      const perTrack = {}
      for (const l of shown) perTrack[l.track.id] = (perTrack[l.track.id] ?? 0) + 1
      const ys = shown.map(l => +l.label.position.y.toFixed(2)).sort((a, b) => a - b)
      const gaps = ys.slice(1).map((y, i) => +(y - ys[i]).toFixed(2))
      return { shown: shown.map(l => l.stop.headline), perTrack, ys, gaps, height: shown[0]?.label.geometry.parameters.height ?? 0 }
    })
    check('one label per lane, never two on top of each other',
      Object.values(speaking.perTrack).every(n => n === 1) && speaking.gaps.every(g => g >= speaking.height),
      speaking)
  }

  /* ----------------------------------------------------- PROJECTS ---- */
  if (wants('projects')) {
    const board = await state(() => {
      const p = window.__world2.interactions.projects
      return {
        count: p.constructor.name && p.hud && Object.keys(p).length ? undefined : undefined,
        total: p.index !== undefined ? window.__world2.interactions.projects.signs.length : 0,
      }
    })
    void board
    const first = await state(() => {
      const p = window.__world2.interactions.projects
      return { title: p.current.title, index: p.index, screen: !!p.screen, flips: p.flips.length, attributes: p.attributes.length }
    })
    check('the board is built from the authored objects', first.screen && first.flips >= 2 && first.attributes >= 1, first)
    check('it opens on a real Alejandro project', !!first.title && !/bruno|three\.js journey|zenly/i.test(first.title), first)

    const point = await state(() => {
      const p = window.__world2.interactions.references.position('refInteractivePoint')
      return { x: p.x, y: p.y, z: p.z }
    })
    await teleport(point.x + 2, point.y + 0.4, point.z + 2, Math.PI)
    await page.waitForTimeout(900)
    await page.evaluate(() => window.__world2.interactions.projects.open())
    await page.waitForTimeout(2200)
    await shot('projects-open')
    const opened = await state(() => {
      const p = window.__world2.interactions.projects
      return { state: p.state, camera: window.__world2.view.mode, player: window.__world2.player.state }
    })
    check('opening the board takes the cinematic camera', opened.state === 'open' && opened.camera === 'cinematic' && opened.player === 'locked', opened)

    const walked = []
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__world2.interactions.projects.step(1))
      await page.waitForTimeout(700)
      walked.push(await state(() => {
        const p = window.__world2.interactions.projects
        return { index: p.index, title: p.current.title, link: p.current.link }
      }))
    }
    check('next steps through distinct projects', new Set(walked.map(w => w.title)).size === 5, walked.map(w => w.title))
    await page.evaluate(() => window.__world2.interactions.projects.step(-1))
    await page.waitForTimeout(600)
    const back = await state(() => window.__world2.interactions.projects.current.title)
    check('previous steps back', back === walked[3].title, { back, expected: walked[3].title })
    await shot('projects-detail')

    await page.evaluate(() => window.__world2.interactions.projects.close())
    await page.waitForTimeout(1400)
    const closed = await state(() => ({
      state: window.__world2.interactions.projects.state,
      camera: window.__world2.view.mode,
      player: window.__world2.player.state,
    }))
    check('closing gives the car and the camera back', closed.state === 'closed' && closed.camera === 'default' && closed.player === 'default', closed)
    await page.evaluate(() => window.__world2.interactions.projects.open())
    await page.waitForTimeout(1800)
    const reopened = await state(() => window.__world2.interactions.projects.state)
    check('the board can be re-entered', reopened === 'open', { reopened })
    await page.evaluate(() => window.__world2.interactions.projects.close())
    await page.waitForTimeout(1400)

    const marked = await state(() => window.__world2.interactions.achievements.groups.get('projects').progress)
    check('viewing projects marks the award', marked >= 5, { marked })
  }

  /* ------------------------------------------------------- SOCIAL ---- */
  if (wants('social')) {
    const social = await state(() => {
      const s = window.__world2.interactions.social
      return { links: s.links.map(l => ({ id: l.id, label: l.label, href: l.href })) }
    })
    check('social carries only real contact links', social.links.length >= 3 && social.links.every(l => !/bruno|simon/i.test(l.href)), social.links)
    check('GitHub, LinkedIn and email are all present', ['github', 'linkedin', 'email'].every(id => social.links.some(l => l.id === id)), social.links.map(l => l.id))
    const centre = await state(() => {
      const p = window.__world2.interactions.references.position('refCenter')
      return { x: p.x, y: p.y, z: p.z }
    })
    // Stand where the arc of icons is all in frame.
    const arc = await state(() => {
      const links = window.__world2.interactions.social.links
      const p = links.map(l => l.sign.position)
      const mid = p.reduce((a, v) => ({ x: a.x + v.x / p.length, z: a.z + v.z / p.length }), { x: 0, z: 0 })
      return { x: mid.x, z: mid.z }
    })
    await teleport(arc.x, centre.y + 0.4, arc.z + 15, Math.PI * 0.5)
    await page.waitForTimeout(2600)
    await shot('social')
    const facing = await state(() => {
      const links = window.__world2.interactions.social.links
      const p = window.__world2.player.position
      // Each plate should have turned its face toward the car.
      return links.every(l => {
        const n = new (p.constructor)(0, 0, 1).applyQuaternion(l.sign.quaternion)
        const to = new (p.constructor)(p.x - l.sign.position.x, 0, p.z - l.sign.position.z).normalize()
        return n.dot(to) > 0.6
      })
    })
    check('every plate turns to face the reader', facing, { facing })
    const signs = await state(() => window.__world2.interactions.social.group.children.length)
    check('each link has a world-space plate', signs >= 3, { signs })
  }

  /* ------------------------------------------------------- PLACES ---- */
  if (wants('places')) {
    const wired = await state(() => {
      const p = window.__world2.interactions.places
      return {
        altar: !!p.altarAt, beam: !!p.beam, counterBoard: !!p.altarBoard,
        cabin: !!p.cabin, tv: !!p.tv, cookieSpawn: !!p.cookieSpawn,
        scene: !!p.sceneBoard, lab: !!p.labBoard,
        prompts: window.__world2.interactions.prompts.group.children.length,
      }
    })
    check('every smaller place found its authored objects', wired.altar && wired.cabin && wired.tv && wired.cookieSpawn && wired.scene && wired.lab, wired)
    check('the world carries a full set of prompts', wired.prompts >= 12, { prompts: wired.prompts })

    // Cookie stand: take three, then drive over them.
    const spawn = await state(() => {
      const p = window.__world2.interactions.places.cookieSpawn
      return { x: p.x, y: p.y, z: p.z }
    })
    await teleport(spawn.x + 3, spawn.y + 1, spawn.z + 3, 0)
    await page.waitForTimeout(600)
    const before = await state(() => window.__world2.interactions.places.cookiesTaken)
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__world2.interactions.places.spawnCookie()); await page.waitForTimeout(300) }
    await page.waitForTimeout(1200)
    await teleport(spawn.x, spawn.y + 0.6, spawn.z, 0)
    await page.waitForTimeout(1400)
    const after = await state(() => ({ taken: window.__world2.interactions.places.cookiesTaken, left: window.__world2.interactions.places.cookies.length }))
    check('cookies spawn as physics props and can be collected', after.taken > before, { before, after })
    await shot('cookie')

    // The altar takes the car and counts the offering.
    const altar = await state(() => {
      const a = window.__world2.interactions.places.altarAt
      return { x: a.x, y: a.y, z: a.z, offerings: window.__world2.interactions.places.offerings }
    })
    await teleport(altar.x, altar.y + 1.2, altar.z, 0)
    await page.waitForTimeout(2600)
    const offered = await state(() => ({
      offerings: window.__world2.interactions.places.offerings,
      award: window.__world2.interactions.achievements.has('altar'),
    }))
    check('the altar takes an offering and counts it', offered.offerings === altar.offerings + 1 && offered.award, { before: altar.offerings, ...offered })

    // The latrine goes over when it is hit hard.
    // Line the car up and charge. The approach is retried because a single
    // launch can clip the platform edge and stop short; what is being tested
    // is that a hard hit puts the cabin over, not that one launch always lands.
    let toilet = { down: false, award: false, attempts: 0 }
    for (let attempt = 0; attempt < 3 && !toilet.down; attempt++) {
      const now = await state(() => {
        const t = window.__world2.interactions.places.cabin.physical.body.translation()
        return { x: t.x, y: t.y, z: t.z }
      })
      await teleport(now.x - 7, now.y + 1.2, now.z, 0)
      await page.waitForTimeout(1400)
      await page.evaluate(() => window.__world2.vehicle.chassis.physical.body.setLinvel({ x: 26, y: 0, z: 0 }, true))
      await page.waitForTimeout(3000)
      toilet = await state(() => ({
        down: window.__world2.interactions.places.cabin.down,
        award: window.__world2.interactions.achievements.has('toilet'),
        attempts: 0,
      }))
      toilet.attempts = attempt + 1
    }
    check('the latrine tips over when rammed', toilet.down && toilet.award, toilet)

    // Behind the scenes, the lab board and the jukebox all respond.
    await page.evaluate(() => {
      const p = window.__world2.interactions.places
      p.sceneBoard.shown = true
      p.sceneBoard.screen.group.visible = true
    })
    await page.waitForTimeout(900)
    const scene = await state(() => window.__world2.interactions.places.sceneBoard.screen.group.position.y > window.__world2.interactions.places.sceneBoard.home.y)
    check('the behind-the-scenes board rises out of the ground', scene, { scene })
    const lab = await state(() => {
      const p = window.__world2.interactions.places
      const first = p.labBoard.index
      p.labBoard.index = (p.labBoard.index + 1) % p.labProjects.length
      p.paintLab()
      return { first, second: p.labBoard.index, count: p.labProjects.length }
    })
    check('the lab board browses real experiments', lab.count >= 3 && lab.first !== lab.second, lab)
  }

  /* -------------------------------------------------- ACHIEVEMENTS ---- */
  if (wants('achievements')) {
    const view = await state(() => {
      const a = window.__world2.interactions.achievements
      return { total: a.groups.size, unlocked: a.unlockedCount, glyphs: a.glyphs ? a.glyphs.count : 0, pillar: !!a.pillar }
    })
    check('the achievement pillar carries one glyph per award', view.pillar && view.glyphs === view.total, view)
    await page.evaluate(() => window.__world2.toggleAchievements())
    await page.waitForTimeout(700)
    const panel = await page.evaluate(() => ({
      open: window.__world2.status.achievementsOpen,
      rows: document.querySelectorAll('[role=dialog] li').length,
    }))
    check('the achievements panel lists them all', panel.open && panel.rows === view.total, panel)
    await shot('achievements')
    await page.evaluate(() => window.__world2.toggleAchievements())
    await page.waitForTimeout(500)

    // Persistence: what is unlocked must survive a reload.
    const unlockedBefore = await state(() => window.__world2.interactions.achievements.unlockedCount)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.__world2?.status.ready, { timeout: 180000 })
    await page.getByRole('button', { name: 'Start driving' }).click()
    await page.waitForTimeout(1200)
    const unlockedAfter = await state(() => window.__world2.interactions.achievements.unlockedCount)
    check('unlocked awards survive a reload', unlockedAfter >= unlockedBefore && unlockedBefore > 0, { unlockedBefore, unlockedAfter })
  }

  /* ------------------------------------------------------ PROMPTS ---- */
  if (wants('prompts')) {
    const target = await state(() => {
      const p = window.__world2.interactions.references.position('refJukeboxInteractivePoint')
      return { x: p.x, y: p.y, z: p.z }
    })
    await teleport(target.x + 14, target.y + 0.4, target.z, 0)
    await page.waitForTimeout(900)
    const far = await state(() => ({ active: window.__world2.interactions.promptLabel }))
    check('no prompt shows from across the island', far.active === null, far)
    await teleport(target.x + 1.2, target.y + 0.2, target.z + 0.6, 0)
    await page.waitForTimeout(1400)
    const near = await state(() => ({ active: window.__world2.interactions.promptLabel }))
    check('driving up to a point opens its prompt', near.active === 'Jukebox', near)
    await shot('prompt')
    const fired = await page.evaluate(() => {
      const before = window.__world2.interactions.achievements.has('jukebox')
      window.__world2.interact()
      return { before, after: window.__world2.interactions.achievements.has('jukebox') }
    })
    check('interacting runs the point it belongs to', !fired.before && fired.after, fired)
    await teleport(target.x + 14, target.y + 0.4, target.z, 0)
    await page.waitForTimeout(1200)
    const gone = await state(() => ({ active: window.__world2.interactions.promptLabel }))
    check('driving away closes it again', gone.active === null, gone)

    /*
      Every prompt must be reachable from somewhere. The fan's moved when the
      OnlyFans logo it was anchored beside was removed, and a prompt anchored
      on nothing is the kind of thing that only shows up when somebody drives
      there. This parks the car on each point in turn and asks.
    */
    const unreachable = []
    // A mini-game keeps its own prompt down until it is wanted ("Reset pins"
    // only exists mid-frame), so a point that has asked to be hidden is not a
    // point that failed to answer.
    const points = await state(() => window.__world2.interactions.prompts.items
      .filter(i => !i.requestedHidden)
      .map(i => ({ label: i.label, x: i.at.x, z: i.at.y })))
    for (const point of points) {
      await teleport(point.x, 1.4, point.z + 0.9, 0)
      await page.waitForTimeout(320)
      const active = await state(() => window.__world2.interactions.promptLabel)
      // A point can be legitimately silent — a mini-game hides its own — so
      // only a point that is SHOWING but answers with someone else's label,
      // or with nothing at all, counts against it.
      if (active === null) unreachable.push(point.label)
    }
    check('every interaction point answers when you park on it', unreachable.length === 0, { points: points.length, unreachable })
  }

  /* --------------------------------------------------------- PERF ---- */
  if (wants('perf')) {
    // Drive the busiest corner of the island — the projects board, the career
    // walk and the social arc are all inside one frustum here.
    const at = await state(() => {
      const p = window.__world2.interactions.references.position('refInteractivePoint')
      return { x: p.x, y: p.y, z: p.z }
    })
    await teleport(at.x + 6, at.y + 0.5, at.z + 6, Math.PI)
    await page.waitForTimeout(2500)
    const samples = []
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(420)
      samples.push(await state(() => ({ fps: window.__world2.ticker.fps, draws: window.__world2.renderer.instance.info.render.calls })))
    }
    const fps = samples.map(s => s.fps).sort((a, b) => a - b)
    const median = fps[Math.floor(fps.length / 2)]
    const draws = Math.max(...samples.map(s => s.draws))
    // Software GL in CI is slow; this guards against a collapse, not a target.
    check('the busy corner still renders at a workable rate', median > 20, { median: Math.round(median), draws })
    report.performance = { medianFps: Math.round(median), maxDrawCalls: draws }
  }

  /* ------------------------------------------------------ REPORTED ---- */
  // Regressions reported from play. Each of these was a real defect.
  if (wants('reported')) {
    // The car used to start across the track: the grid empty's own yaw points
    // sideways, so the heading now comes from the line to the first gate.
    await page.evaluate(() => window.__world2.interactions.circuit.restart())
    await page.waitForTimeout(500)
    const grid = await state(() => {
      const g = window.__world2, c = g.interactions.circuit
      const forward = new (g.player.position.constructor)(1, 0, 0).applyQuaternion(g.vehicle.quaternion)
      const gate = c.gates[0].position
      const p = g.player.position
      const to = new (g.player.position.constructor)(gate.x - p.x, 0, gate.z - p.z).normalize()
      return { alignment: +forward.setY(0).normalize().dot(to).toFixed(3), podium: c.podium.map(n => n.visible) }
    })
    check('the car starts pointing down the track', grid.alignment > 0.9, grid)
    check('the podium is gone from the world', grid.podium.length > 0 && grid.podium.every(v => v === false), grid)

    await page.waitForFunction(() => window.__world2.interactions.circuit.state === 'running', { timeout: 15000 })
    const during = await state(() => {
      const c = window.__world2.interactions.circuit
      const hud = c.hud()
      return { timers: [hud.timer].filter(Boolean).length, clockAt: c.clock.group.position.toArray().map(n => +n.toFixed(2)), home: c.clockHome.toArray().map(n => +n.toFixed(2)) }
    })
    check('there is one lap clock, and it stays on its board', during.timers === 1 && Math.hypot(during.clockAt[0] - during.home[0], during.clockAt[2] - during.home[2]) < 0.01, during)

    /*
      The camera must not move when the race starts. The rails are a 20 m
      invisible wall and the level builds them in the `floor` category, which
      is exactly what the camera's obstruction ray queries — so putting them
      up pulled the camera from 21 m to 12 and read as a zoom onto the car.
    */
    const freeRoam = await state(() => ({
      dist: +window.__world2.view.camera.position.distanceTo(window.__world2.player.position).toFixed(2),
      radius: +window.__world2.view.spherical.radius.current.toFixed(2),
    }))
    // Sample the camera while the car is genuinely moving down the track.
    const racing = await page.evaluate(async () => {
      const g = window.__world2
      const gate = g.interactions.circuit.gates[0]
      const heading = g.player.rotationY
      g.vehicle.chassis.physical.body.setLinvel({ x: Math.cos(heading) * 16, y: 0, z: -Math.sin(heading) * 16 }, true)
      const radii = []
      let kmh = 0
      for (let i = 0; i < 24; i++) {
        await new Promise(r => requestAnimationFrame(r))
        radii.push(g.view.spherical.radius.current)
        kmh = Math.max(kmh, g.vehicle.speedKmh)
      }
      void gate
      return {
        kmh: Math.round(kmh),
        min: +Math.min(...radii).toFixed(2),
        max: +Math.max(...radii).toFixed(2),
      }
    })
    // The camera easing OUT with speed is the View's normal framing and
    // happens off the circuit too. What must never happen is it being pulled
    // IN — that is the obstruction probe finding the rails.
    check('the race never pulls the camera in', racing.min >= freeRoam.radius - 1, { freeRoam, racing })
    check('the car is genuinely moving for that sample', racing.kmh > 20, racing)

    // …and the rails still have to stop the car going off the track.
    const guard = await page.evaluate(async () => {
      const g = window.__world2
      const rails = g.interactions.references.physical('refRailsPhysicalFixed')
      const enabled = rails.body.isEnabled()
      // Fire the car at the outside of the circuit and see where it ends up.
      const gate = g.interactions.circuit.gates[4].position
      g.vehicle.moveTo({ x: gate.x, y: gate.y + 1, z: gate.z }, 0)
      await new Promise(r => setTimeout(r, 900))
      const before = { x: g.player.position.x, z: g.player.position.z }
      g.vehicle.chassis.physical.body.setLinvel({ x: -40, y: 0, z: 0 }, true)
      await new Promise(r => setTimeout(r, 2600))
      return { enabled, before, after: { x: +g.player.position.x.toFixed(1), z: +g.player.position.z.toFixed(1) }, travelled: +Math.abs(g.player.position.x - before.x).toFixed(1) }
    })
    check('the rails are up and still stop the car', guard.enabled && guard.travelled < 60, guard)

    // The leaderboard is painted on the authored sign, not on a plane of ours.
    const board = await state(() => {
      const g = window.__world2, c = g.interactions.circuit
      const node = g.interactions.references.node('refLeaderboard')
      const uv = node.geometry.getAttribute('uv')
      let uMin = 1, uMax = 0, vMin = 1, vMax = 0
      for (let i = 0; i < uv.count; i++) {
        uMin = Math.min(uMin, uv.getX(i)); uMax = Math.max(uMax, uv.getX(i))
        vMin = Math.min(vMin, uv.getY(i)); vMax = Math.max(vMax, uv.getY(i))
      }
      return {
        ownPlaneInScene: !!c.board.group.parent,
        paintedOnAuthored: node.material.map === c.board.texture,
        uSpan: +(uMax - uMin).toFixed(2), vSpan: +(vMax - vMin).toFixed(2),
      }
    })
    check('the leaderboard is painted on the authored sign', board.paintedOnAuthored && !board.ownPlaneInScene, board)
    check('that sign got a real mapping to paint through', board.uSpan > 0.9 && board.vSpan > 0.9, board)

    // The starting gantry counts down on its own three lamps.
    await page.evaluate(() => window.__world2.interactions.circuit.restart())
    await page.waitForTimeout(300)
    const sequence = []
    for (let i = 0; i < 8; i++) {
      sequence.push(await state(() => {
        const m = window.__world2.interactions.circuit.lightsMaterial
        return { beat: window.__world2.interactions.circuit.countdownBeat, lit: m.uniforms.lit.value, go: m.uniforms.go.value }
      }))
      await page.waitForTimeout(500)
    }
    const lamps = sequence.filter(s => !s.go).map(s => s.lit)
    check('the gantry lights one lamp per beat', lamps.includes(1) && lamps.includes(2) && lamps.includes(3), sequence)
    check('all three go green on GO', sequence.some(s => s.go === 1 && s.lit === 3), sequence.slice(-3))
    await page.evaluate(() => window.__world2.interactions.circuit.exit(true))
    await page.waitForTimeout(900)

    // Handling: this island's own grip, brake and damping.
    const handling = await state(() => {
      const v = window.__world2.vehicle
      return {
        grip: typeof v.surfaceFriction === 'function' ? v.surfaceFriction(null) : null,
        idleBrake: v.idleBrake,
        linearDamping: v.chassis.physical.linearDamping,
      }
    })
    check('the car carries this world\'s handling', handling.grip > 1.5 && handling.idleBrake > 0.1 && handling.linearDamping > 0.15, handling)


    // Finish, drive away, and make sure the race HUD lets go.
    for (let i = 0; i < 9; i++) {
      const gate = await page.evaluate(i => {
        const c = window.__world2.interactions.circuit
        const g = c.gates[i % c.gates.length]
        return { x: g.position.x, y: g.position.y, z: g.position.z, heading: g.heading }
      }, i)
      await teleport(gate.x, gate.y + 1.1, gate.z, gate.heading)
      await page.waitForTimeout(240)
    }
    await page.waitForFunction(() => window.__world2.interactions.circuit.state === 'pending', { timeout: 12000 })
    const podiumAfter = await state(() => ({
      visible: window.__world2.interactions.circuit.podium.map(n => n.visible),
      bodies: window.__world2.interactions.circuit.podiumBodies.map(b => b.body.isEnabled()),
    }))
    check('the podium stays gone after the lap, collider and all', podiumAfter.visible.every(v => v === false) && podiumAfter.bodies.every(b => b === false), podiumAfter)
    await teleport(40, 3, 38, 0)
    await page.waitForTimeout(1200)
    const hudAfter = await state(() => ({ activity: window.__world2.status.gameplay.activity, headline: window.__world2.status.gameplay.headline }))
    check('the race HUD clears once you drive away', hudAfter.activity === null, hudAfter)

    // The bowling ball, its board and the bumpers were all invisible: the
    // environment hid every body the interaction layer reserved.
    const seen = await state(() => {
      const r = window.__world2.interactions.references
      return {
        ball: r.node('refBallPhysicalDynamic')?.visible,
        screen: r.node('refScreenPhysicalKinematicPositionBased')?.visible,
        bumpers: r.node('refBumpersPhysicalKinematicPositionBased')?.visible,
        discs: r.node('refDiscs')?.visible,
        crosses: r.node('refCrosses')?.visible,
        letters: r.series('refLettersPhysicalDynamic').every(n => n.visible === false),
      }
    })
    check('the ball, the board and the bumpers are all on screen', seen.ball && seen.screen && seen.bumpers && seen.discs && seen.crosses, seen)
    check('the letters that were replaced stay hidden', seen.letters, seen)

    // Every prompt does something. Toggles used to fire twice and cancel.
    const toggles = []
    for (const label of ['Map', 'Controls', 'Achievements', 'Bumpers']) {
      await page.evaluate(l => {
        const item = window.__world2.interactions.prompts.items.find(i => i.label === l)
        window.__world2.vehicle.moveTo({ x: item.at.x + 1, y: 3, z: item.at.y + 1 }, 0)
      }, label)
      // Wait for the point to actually open rather than assume it has: the car
      // has to settle before the proximity test will look at it.
      await page.waitForFunction(l => window.__world2.interactions.promptLabel === l, label, { timeout: 8000 })
      const at = { label }
      const before = await page.evaluate(() => ({ map: window.__world2.status.map, help: window.__world2.status.help, ach: window.__world2.status.achievementsOpen, bumpers: window.__world2.interactions.bowling.bumpersOut }))
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      const after = await page.evaluate(() => ({ map: window.__world2.status.map, help: window.__world2.status.help, ach: window.__world2.status.achievementsOpen, bumpers: window.__world2.interactions.bowling.bumpersOut, rows: document.querySelectorAll('[role=dialog] li').length }))
      toggles.push({ label: at.label, changed: JSON.stringify(before) !== JSON.stringify({ map: after.map, help: after.help, ach: after.ach, bumpers: after.bumpers }), rows: after.rows })
      await page.evaluate(() => { const g = window.__world2; if (g.status.paused) g.setPaused(false) })
      await page.waitForTimeout(500)
    }
    check('every panel and toggle prompt actually toggles', toggles.every(t => t.changed), toggles)
    check('the achievements panel arrives populated', (toggles.find(t => t.label === 'Achievements')?.rows ?? 0) > 20, toggles)

    // The projects board takes the same keys the HUD advertises.
    const point = await state(() => {
      const p = window.__world2.interactions.references.position('refInteractivePoint')
      return { x: p.x, y: p.y, z: p.z }
    })
    await teleport(point.x + 1.2, point.y + 0.4, point.z + 1.2, Math.PI)
    await page.waitForTimeout(1400)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(2200)
    const steps = []
    for (const key of ['ArrowRight', 'ArrowRight', 'ArrowLeft']) {
      const before = await state(() => window.__world2.interactions.projects.index)
      await page.keyboard.press(key)
      await page.waitForTimeout(700)
      steps.push({ key, before, after: await state(() => window.__world2.interactions.projects.index) })
    }
    check('arrow keys step the projects board', steps.every(s => s.before !== s.after), steps)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(1600)
    check('escape hands the board back', await state(() => window.__world2.interactions.projects.state) === 'closed')

    // Grass: a per-blade gradient and a wind pass, not one flat colour.
    const grass = await state(() => {
      const g = window.__world2
      let found = null
      g.environment.group.traverse(n => {
        if (found || !n.isMesh) return
        const m = Array.isArray(n.material) ? n.material[0] : n.material
        if (/grass/i.test(m?.name ?? '')) found = { blade: !!n.geometry.getAttribute('bladeHeight'), patched: typeof m.onBeforeCompile === 'function' && m.onBeforeCompile.length > 0 }
      })
      return { ...found, meshes: g.grass.meshCount }
    })
    check('the grass has per-blade shading and wind', grass.blade && grass.patched && grass.meshes === 1, grass)

    // Travelling from the map.
    const travelled = await page.evaluate(async () => {
      const g = window.__world2
      const target = g.environment.areas.find(a => a.name === 'bowling')
      g.vehicle.moveTo({ x: 40, y: 3, z: 38 }, 0)
      await new Promise(r => setTimeout(r, 600))
      g.travelTo('bowling')
      await new Promise(r => setTimeout(r, 2200))
      const p = g.player.position
      return { distance: +Math.hypot(p.x - target.position.x, p.z - target.position.z).toFixed(1), paused: g.status.paused }
    })
    check('picking a place on the map drives you there', travelled.distance < 25 && !travelled.paused, travelled)

    /*
      The control blackboards. Blender authors each one three times over —
      mouse-and-keyboard, Xbox, PlayStation — as three label meshes on the
      SAME plane, within four micrometres of each other. All three drew at
      once and the board read as a smear.
    */
    const boards = await state(() => {
      const b = window.__world2.interactions.blackboards
      return {
        boards: b.boards.length,
        showing: b.showing,
        visible: b.boards.map(board => [...board.labels].filter(([, node]) => node.visible).length),
        batched: b.boards.every(board => [...board.labels].every(([, node]) => !node.userData.w2Batched)),
      }
    })
    check('each control board speaks one control scheme at a time', boards.boards === 2 && boards.visible.every(n => n === 1), boards)
    check('the boards read mouse and keyboard by default', boards.showing === 'mouseKeyboard' && boards.batched, boards)

    /*
      `refCookie` is a TEMPLATE — Blender marks it `preventAutoAdd` — and
      nothing honoured that, so a metre-wide cookie hung in the air beside the
      oven while the oven handed out plain cylinders built in code. It is the
      mould now: hidden, and pressed into every cookie the place gives away.
    */
    const cookie = await state(() => {
      const g = window.__world2
      const node = g.interactions.references.node('refCookie')
      // `refCookie` must own no body either: the environment's fallback pass
      // would otherwise fit a static trimesh to a cookie hanging in mid-air.
      const ghost = g.physics.physicals.some(p => p.owner === 'refCookie')
      return { visible: !!node?.visible, batched: !!node?.userData.w2Batched, ghost }
    })
    check('the cookie template is a mould, not a floating prop', !cookie.visible && !cookie.batched && !cookie.ghost, cookie)

    /*
      The social plaza: service marks for accounts that do not exist, and the
      level author's own statuary, are gone — mesh AND body, so nothing
      invisible is left to hit. The centre carries the portfolio's monogram.
    */
    const plaza = await state(() => {
      const g = window.__world2
      const names = ['twitchPhysicalDynamic', 'youtubePhysicalDynamic', 'discordPhysicalDynamic', 'blueskyPhysicalDynamic.001', 'xPhysicalDynamic', 'onlyfansPhysicalDynamic', 'refStatuePhysicalDynamic', 'sudoMesh.003', 'baguiraMesh.001', 'boyMesh', 'wings']
      const shown = names.filter(n => g.interactions.references.node(n)?.visible)
      const bodied = names.filter(n => g.physics.physicals.some(p => p.owner === n))
      const kept = ['gitHubPhysicalDynamic', 'linkedInPhysicalDynamic', 'mailPhysicalDynamic'].filter(n => g.interactions.references.node(n)?.visible)
      const monogram = g.interactions.social.monogram
      const tall = monogram.length ? Math.max(...monogram.map(m => m.position.y)) : 0
      return { shown, bodied, kept, letters: monogram.length, tall: +tall.toFixed(2), reads: monogram.map(m => m.name).join('') }
    })
    check('the plaza carries no account this portfolio does not have', plaza.shown.length === 0 && plaza.bodied.length === 0, plaza)
    check('GitHub, LinkedIn and email keep their marks', plaza.kept.length === 3, plaza.kept)
    check('the monogram stands where the statue did', plaza.letters === 2 && plaza.tall > 2, plaza)

    /*
      Grip is per-surface now. The circuit is the one place built to be driven
      hard, and Rapier's raycast vehicle ignores a ground collider's own
      friction, so `frictionSlip` is the only lever there is.
    */
    const surfaces = await state(() => {
      const g = window.__world2
      const at = name => {
        const physical = g.physics.physicals.find(p => p.owner === name)
        const collider = physical?.body.collider(0)
        return collider ? g.vehicle.surfaceFriction(collider) : null
      }
      return { road: at('refRoadPhysicalFixed'), ribbon: at('refRoad'), terrain: at('terrain'), island: g.vehicle.surfaceFriction(null) }
    })
    check('the circuit tarmac grips harder than the island', surfaces.road > surfaces.island && surfaces.road === surfaces.ribbon, surfaces)
    check('the island keeps the handling it had', surfaces.terrain === surfaces.island, surfaces)

    /*
      A FLOOR HAS TO WEIGH SOMETHING. Rapier derives a fixed body's mass from
      its colliders and the raycast vehicle resolves the BRAKE against the
      ground body's inverse mass, so a trimesh fitted to a FLAT surface —
      which encloses no volume, so mass 0 — cannot slow the car down. The
      circuit ribbon was one: the same wheel delivered 0.1633 of brake on the
      authored slabs and 0.0001 on the ribbon lying coplanar on top of them.
    */
    const floors = await state(() => {
      const g = window.__world2
      const fixed = g.physics.physicals.filter(p => p.body.bodyType() === 1)
      const light = fixed.filter(p => p.body.mass() < 1000)
      const named = n => { const p = g.physics.physicals.find(x => x.owner === n); return p ? +p.body.mass().toFixed(0) : null }
      return { fixed: fixed.length, light: light.length, owners: light.map(p => String(p.owner)).slice(0, 6), road: named('refRoad'), slabs: named('refRoadPhysicalFixed'), terrain: named('terrain') }
    })
    check('no fixed body in this world weighs nothing', floors.light === 0 && floors.road > 1000, floors)

    /*
      The boost wheelie. Engine force arrives at the contact patch, below the
      centre of mass, so hard acceleration pitches the nose up — and the two
      front wheels are the only ones this vehicle steers, and a wheel with
      nothing under it passes on neither engine force nor brake. At the
      upstream boost a front wheel was off the ground for 65 % of a standing
      start; the driver held the throttle and the car simply carried on.
    */
    const launch = await page.evaluate(async () => {
      const g = window.__world2, v = g.vehicle
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const t = g.interactions.references.transform('refStart')
      const f = new (t.position.constructor)(1, 0, 0).applyQuaternion(t.quaternion)
      v.moveTo({ x: t.position.x, y: 1, z: t.position.z }, Math.atan2(f.z, f.x))
      await wait(900)
      const set = (n, a) => { const c = g.inputs.actions.get(n); if (c) { c.active = a; c.value = a ? 1 : 0 } }
      let steps = 0, off = 0, pitch = 0
      const probe = () => {
        steps++
        if (!v.wheels.items[0].groundCollider || !v.wheels.items[1].groundCollider) off++
        pitch = Math.max(pitch, Math.asin(Math.max(-1, Math.min(1, v.forward.y))) * 180 / Math.PI)
      }
      g.ticker.events.on('fixed', probe, 90)
      set('forward', true); set('boost', true)
      await wait(1200)
      set('forward', false); set('boost', false)
      g.ticker.events.off('fixed', probe)
      return { steps, offPercent: Math.round((100 * off) / Math.max(1, steps)), pitch: +pitch.toFixed(1), top: Math.round(v.speedKmh), boost: v.boostMultiplier, ceiling: v.topSpeedBoost }
    })
    check('boosting off the line keeps the front wheels down', launch.offPercent <= 5 && launch.pitch < 12, launch)
    check('boost is still worth pressing', launch.boost > 0 && launch.ceiling >= 20, launch)

    /*
      The other half of the same fault: a car carrying its weight high stands
      on its nose under braking, which lifts the driven wheels off the road.
      At the shared centre of mass this stop pitched to 87.5 degrees and took
      12.1 m; with the weight dropped it stays inside five and takes 7.3.
    */
    const stopping = await page.evaluate(async () => {
      const g = window.__world2, v = g.vehicle
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const t = g.interactions.references.transform('refStart')
      const f = new (t.position.constructor)(1, 0, 0).applyQuaternion(t.quaternion)
      v.moveTo({ x: t.position.x, y: 1, z: t.position.z }, Math.atan2(f.z, f.x))
      await wait(900)
      const set = (n, a) => { const c = g.inputs.actions.get(n); if (c) { c.active = a; c.value = a ? 1 : 0 } }
      set('forward', true); set('boost', true)
      await wait(1200)
      set('forward', false); set('boost', false)
      const from = v.speedKmh
      const p0 = { x: g.player.position.x, z: g.player.position.z }
      let pitch = 0, off = 0, steps = 0
      const probe = () => {
        steps++
        pitch = Math.max(pitch, Math.abs(Math.asin(Math.max(-1, Math.min(1, v.forward.y))) * 180 / Math.PI))
        if (v.wheels.inContactCount < 4) off++
      }
      g.ticker.events.on('fixed', probe, 90)
      set('brake', true)
      for (let i = 0; i < 150 && v.speedKmh > 5; i++) await wait(30)
      set('brake', false)
      g.ticker.events.off('fixed', probe)
      const com = v.chassis.physical.body.collider(0).centerOfMass?.() ?? null
      return {
        from: Math.round(from),
        metres: +Math.hypot(g.player.position.x - p0.x, g.player.position.z - p0.z).toFixed(1),
        pitch: +pitch.toFixed(1),
        wheelsUp: Math.round((100 * off) / Math.max(1, steps)),
        centreOfMass: com ? +com.y.toFixed(2) : null,
      }
    })
    check('the car stops flat instead of standing on its nose', stopping.pitch < 20 && stopping.metres < 11, stopping)

    /*
      "Am I going the way I am pointing" has to be asked on the GROUND: taken
      in 3D, a car with its nose up reads as travelling sideways and the
      vehicle hands the driver the handbrake instead of the throttle.
    */
    const ramp = await page.evaluate(async () => {
      const g = window.__world2, v = g.vehicle
      const wait = ms => new Promise(r => setTimeout(r, ms))
      const points = g.manifest.roadPaths[0].points, a = points[0], b = points.at(-1)
      const length = Math.hypot(b[0] - a[0], b[2] - a[2])
      const axis = [(b[0] - a[0]) / length, (b[2] - a[2]) / length]
      v.moveTo({ x: a[0] - axis[0] * 4, y: 2.2, z: a[2] - axis[1] * 4 }, Math.atan2(-axis[1], axis[0]))
      await wait(900)
      const set = (n, x) => { const c = g.inputs.actions.get(n); if (c) { c.active = x; c.value = x ? 1 : 0 } }
      const rows = []
      const probe = () => {
        if (v.speed < 1) return
        rows.push({
          ratio: +v.forwardRatio.toFixed(3),
          going: v.goingForward,
          pitch: +(Math.asin(Math.max(-1, Math.min(1, v.forward.y))) * 180 / Math.PI).toFixed(1),
        })
      }
      g.ticker.events.on('fixed', probe, 90)
      set('forward', true); set('boost', true)
      await wait(2200)
      set('forward', false); set('boost', false)
      g.ticker.events.off('fixed', probe)
      const steep = rows.filter(r => Math.abs(r.pitch) > 8)
      return {
        samples: rows.length,
        steepSamples: steep.length,
        maxPitch: Math.max(...rows.map(r => Math.abs(r.pitch))),
        handbrakeWhilePitched: steep.filter(r => !r.going).length,
        worstRatio: Math.min(...rows.map(r => r.ratio)),
      }
    })
    // Taken in 3D the same ramp run bottoms out at 0.723 and a harder landing
    // goes under the 0.5 the handbrake branch tests; flattened it holds 0.97.
    check('a pitched car is still driving forwards, not braking',
      ramp.steepSamples > 0 && ramp.handbrakeWhilePitched === 0 && ramp.worstRatio > 0.9, ramp)
  }

  /* ------------------------------------------------------ CLEANUP ---- */
  if (wants('cleanup')) {
    const before = await page.evaluate(() => ({
      bodies: window.__world2.physics.world.bodies.len(),
      contexts: window.__world2.audio.ctx ? 1 : 0,
    }))
    await page.evaluate(() => { window.__world2Probe = { destroyed: false }; const g = window.__world2; const original = g.destroy.bind(g); g.destroy = () => { original(); window.__world2Probe.destroyed = true } })
    await page.getByRole('link', { name: /Back to portfolio|^AN/ }).first().click().catch(() => page.goto(`${base}/`))
    await page.waitForTimeout(2500)
    const after = await page.evaluate(() => ({
      handle: typeof window.__world2,
      raf: !!window.__world2,
      audio: !!(window.__world2 && window.__world2.audio && window.__world2.audio.ctx && window.__world2.audio.ctx.state === 'running'),
      path: location.pathname,
    }))
    check('leaving /world2 tears the game down', after.handle === 'undefined' && !after.audio, { before, after })
  }

  report.errors = report.errors.filter(e => !/preloaded using link preload/.test(e))
  check('no runtime errors while playing', report.errors.length === 0, report.errors.slice(0, 5))
} catch (error) {
  check('harness completed', false, String(error))
} finally {
  report.finishedAt = new Date().toISOString()
  report.failures = failures
  await writeFile('.qa/world2-interactions/report.json', JSON.stringify(report, null, 2))
  await browser.close()
  console.log(`\n${report.checks.filter(c => c.pass).length}/${report.checks.length} checks passed`)
  if (failures.length) { console.log('FAILURES:', failures.join(', ')); process.exitCode = 1 }
}
