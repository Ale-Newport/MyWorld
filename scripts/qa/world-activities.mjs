/* The world's two portfolio activities, in the public player, start to finish:

   Infield slalom — the prompt appears at the start; Enter starts a countdown that
   holds the car; the clock starts at the start line; gates light up as they are
   passed; a clean run finishes with its time and no penalty; a run that skips a
   gate gets +3 s; a knocked cone (a real rigid body) gets +1 s; the timing screen
   shows the best time; Escape abandons a run.

   Penguin round-up — Enter starts it; the car physically shoves a penguin across
   the ice; penguins inside the ring are counted live; the round ends when all are
   in (or the time is up) with a result; "Put the penguins back" resets them.

   Both appear as markers on the M map. node scripts/qa/world-activities.mjs */
import { launch, openPlayer, assert, sleep, out, finish } from './lib.mjs'

const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
await openPlayer(page)
await sleep(1500)

const state = () => page.evaluate(() => { const A = globalThis.__archipelago; return A.activities?.list.map((a) => ({ type: a.spec.type, state: a.state, result: a.result, penned: a.penned ?? null })) ?? null })
const hud = () => page.evaluate(() => document.querySelector('#gameplay-hud')?.textContent ?? '')
const prompt = () => page.evaluate(() => globalThis.__archipelago.activities?.prompt ?? '')
const place = (x, z, heading = 0) => page.evaluate(([x, z, heading]) => { const A = globalThis.__archipelago; const y = A.editor.terrainHeightAt(x, z); A.driving.vehicle.moveTo({ x, y: y + 1.3, z }, heading) }, [x, z, heading])
/** Carries the car along a polyline a little each frame, as if driven, so every crossing is seen. */
const drive = (points, step = 0.45) => page.evaluate(async ([points, step]) => {
  const A = globalThis.__archipelago, frame = () => new Promise((r) => requestAnimationFrame(r))
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / step)), heading = Math.atan2(-(bz - az), bx - ax)
    for (let k = 1; k <= n; k++) { const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n; A.driving.vehicle.moveTo({ x, y: A.editor.terrainHeightAt(x, z) + 1.1, z }, heading); await frame() }
  }
}, [points, step])
const press = async (key) => { await page.keyboard.down(key); await sleep(90); await page.keyboard.up(key) }

const s0 = await state()
assert(s0?.length === 2 && s0.some((a) => a.type === 'slalom') && s0.some((a) => a.type === 'roundup'), `both activities are built from the published world (${JSON.stringify(s0?.map((a) => a.type))})`, results)

/* ---- slalom ---- */
await place(-47, -26.5, 0)
await sleep(1200)
assert(/infield slalom/i.test(await prompt()), `the start prompt appears at the slalom (“${await prompt()}”)`, results)
await page.locator('canvas').first().focus().catch(() => {})
await press('Enter')
await sleep(400)
assert((await state()).find((a) => a.type === 'slalom').state === 'countdown', 'Enter starts a countdown', results)
assert(/Infield slalom/.test(await hud()), `the HUD shows the activity (“${await hud()}”)`, results)
await sleep(3400)
assert((await state()).find((a) => a.type === 'slalom').state === 'armed', 'after the countdown it waits for the start line', results)
const clean = [[-45.2, -26.5], [-41, -26.5], [-38, -28.2], [-36.5, -28.5], [-34, -27.5], [-31, -24.5], [-28.5, -25.5], [-25.5, -28.5], [-23, -27.5], [-20, -24.5], [-17.5, -25.5], [-14.5, -28.5], [-12, -27.5], [-9, -26.5], [-6.5, -26.5]]
await drive(clean)
await sleep(600)
let slalom = (await state()).find((a) => a.type === 'slalom')
assert(slalom.state === 'done' && slalom.result?.missed === 0 && slalom.result?.cones === 0, `a clean run finishes with no penalty (${JSON.stringify(slalom.result && { total: +slalom.result.total.toFixed(2), missed: slalom.result.missed, cones: slalom.result.cones })})`, results)
assert(/Slalom/.test(await hud()), `the result is on the HUD (“${await hud()}”)`, results)
const board = await page.evaluate(() => { const a = globalThis.__archipelago.activities.list.find((x) => x.spec.type === 'slalom'); return !!a.board && (a.boardPlanes?.length ?? 0) > 0 })
assert(board, 'the timing screen shows a board with the times', results)
await page.screenshot({ path: out('activities-slalom-done.png') })

// Second run: skip gate 3 and clip the left cone of gate 1.
await place(-47, -26.5, 0)
await sleep(900)
await press('Enter')
await sleep(3700)
const messy = [[-45.2, -26.5], [-41, -27.5], [-38, -30.2], [-36.5, -31.0], [-34, -28], [-31, -24.5], [-28.5, -22], [-25.5, -21.5], [-23, -22.5], [-20, -24.5], [-17.5, -25.5], [-14.5, -28.5], [-12, -27.5], [-9, -26.5], [-6.5, -26.5]]
await drive(messy, 0.35)
await sleep(700)
slalom = (await state()).find((a) => a.type === 'slalom')
assert(slalom.result?.missed === 1, `skipping a gate is a missed gate (${slalom.result?.missed})`, results)
assert(slalom.result?.cones >= 1 && slalom.result.penalty === 3 + slalom.result.cones, `hitting a cone moves it and costs a second (${slalom.result?.cones} cone(s), +${slalom.result?.penalty} s)`, results)

// Escape abandons a run.
await place(-47, -26.5, 0)
await sleep(900)
await press('Enter')
await sleep(3700)
await drive([[-45.2, -26.5], [-40, -26.5]])
await press('Escape')
await sleep(400)
assert((await state()).find((a) => a.type === 'slalom').state === 'idle', 'Escape abandons a run in progress', results)

/* ---- round-up ---- */
const sign = await page.evaluate(() => { const A = globalThis.__archipelago, a = A.activities.list.find((x) => x.spec.type === 'roundup'), w = a.sign.getWorldPosition(new A.THREE.Vector3()); return { x: w.x, z: w.z } })
await place(sign.x - 0.6, sign.z + 0.8, Math.PI / 2)
await sleep(1200)
assert(/round-up/i.test(await prompt()), `the round-up prompt appears by the lake (“${await prompt()}”)`, results)
await press('Enter')
await sleep(3700)
let round = (await state()).find((a) => a.type === 'roundup')
assert(round.state === 'running', 'the round-up runs after its countdown', results)
// A real shove: the car is set behind a penguin and driven into it.
const shove = await page.evaluate(async () => {
  const A = globalThis.__archipelago, a = A.activities.list.find((x) => x.spec.type === 'roundup'), frame = () => new Promise((r) => requestAnimationFrame(r))
  const p = a.penguins[0], start = p.getWorldPosition(new A.THREE.Vector3()), dir = new A.THREE.Vector3(a.pen.x - start.x, 0, a.pen.y - start.z).normalize()
  const from = start.clone().addScaledVector(dir, -5), heading = Math.atan2(-dir.z, dir.x)
  A.driving.vehicle.moveTo({ x: from.x, y: from.y + 1.2, z: from.z }, heading)
  for (let i = 0; i < 70; i++) { const at = from.clone().addScaledVector(dir, i * 0.13); A.driving.vehicle.moveTo({ x: at.x, y: start.y + 1.0, z: at.z }, heading); await frame() }
  for (let i = 0; i < 40; i++) await frame()
  return start.distanceTo(p.getWorldPosition(new A.THREE.Vector3()))
})
assert(shove > 1, `the car shoves a penguin across the ice (moved ${shove.toFixed(1)} m)`, results)
// Then every penguin is placed in the pen to check counting and completion.
await page.evaluate(async () => {
  const A = globalThis.__archipelago, a = A.activities.list.find((x) => x.spec.type === 'roundup'), frame = () => new Promise((r) => requestAnimationFrame(r))
  A.driving.vehicle.moveTo({ x: a.pen.x + 8, y: a.y + 2, z: a.pen.y - 6 }, 0)
  for (const [i, p] of a.penguins.entries()) {
    const body = A.physics.dynamic.find((d) => d.node === p)?.body
    const ang = (i / a.penguins.length) * Math.PI * 2, r = i % 2 ? 1.2 : 2.2
    body?.setTranslation({ x: a.pen.x + Math.cos(ang) * r, y: a.y + 0.9, z: a.pen.y + Math.sin(ang) * r }, true)
    body?.setLinvel({ x: 0, y: 0, z: 0 }, true)
    for (let k = 0; k < 6; k++) await frame()
  }
})
await sleep(1500)
round = (await state()).find((a) => a.type === 'roundup')
assert(round.state === 'done' && round.result?.all && round.result.count === round.result.of, `with every penguin in the ring the round-up completes (${JSON.stringify(round.result && { count: round.result.count, of: round.result.of })})`, results)
await page.screenshot({ path: out('activities-roundup-done.png') })
const ach = await page.evaluate(() => { const g = globalThis.__archipelago.gameplay?.achievements; return { roundUp: g?.has?.('roundUp'), all: g?.has?.('roundUpAll'), clean: g?.has?.('slalomClean') } })
assert(ach.roundUp && ach.all && ach.clean, `achievements unlock (${JSON.stringify(ach)})`, results)
// Reset puts them back.
const s = await page.evaluate(() => { const a = globalThis.__archipelago.activities.list.find((x) => x.spec.type === 'roundup'); return { x: a.sign ? a.sign.getWorldPosition(new globalThis.__archipelago.THREE.Vector3()).x + 2.2 : a.pen.x, z: a.sign ? a.sign.getWorldPosition(new globalThis.__archipelago.THREE.Vector3()).z : a.pen.y + 6 } })
await place(s.x, s.z + 0.8, Math.PI / 2)
await sleep(1200)
const resetLabel = await prompt()
if (/put the penguins back/i.test(resetLabel)) { await press('Enter'); await sleep(900) }
const inside = await page.evaluate(() => globalThis.__archipelago.activities.list.find((x) => x.spec.type === 'roundup').inside())
assert(/put the penguins back/i.test(resetLabel) && inside === 0, `“Put the penguins back” resets the herd (prompt “${resetLabel}”, ${inside} left in the ring)`, results)

/* ---- map ---- */
await press('KeyM')
await sleep(900)
const pins = await page.evaluate(() => [...document.querySelectorAll('.atlas-pin, [data-marker]')].map((p) => p.textContent?.trim() ?? p.getAttribute('aria-label')).filter(Boolean))
assert(pins.some((t) => /slalom/i.test(t)) && pins.some((t) => /round-up/i.test(t)), `both activities are marked on the M map (${pins.filter((t) => /slalom|round/i.test(t)).join(', ')})`, results)
await page.screenshot({ path: out('activities-map.png') })
await press('KeyM')
assert(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
