/* /world travel from the M map: places are buttons; selecting one puts the car
   at a safe arrival near it (outside its landmark, overlapping nothing), closes
   the map, leaves the plane, stops the car dead and has the camera behind it on
   the very next frame; the map's arrow then matches the car. Any point of the
   island travels too; the sea is refused with a message where it was clicked.
   Dragging pans and never travels. Keyboard (Tab, Enter) and touch work.
   QA_BASE=http://localhost:3404 node scripts/qa/world-teleport.mjs */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = watch(page)
await openPlayer(page)
await sleep(1200)

const isOpen = () => page.evaluate(() => !document.querySelector('.atlas').hidden)
const openMap = async () => { if (!(await isOpen())) { await page.keyboard.press('KeyM'); await page.waitForFunction(() => !document.querySelector('.atlas').hidden) } await sleep(250) }
const car = () => page.evaluate(() => { const d = globalThis.__archipelago.driving, v = d.vehicle, lv = v.chassis.physical.body.linvel(); return { x: v.position.x, y: v.position.y, z: v.position.z, speed: Math.hypot(lv.x, lv.y, lv.z), mode: d.mode } })
const pin = (name) => page.locator(`.atlas-pin[aria-label^="Travel to ${name}"]`).first()
/** The frame right after an action: the camera distance and the car's state, measured in the next animation frame. */
const nextFrame = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { const A = globalThis.__archipelago, d = A.driving, v = d.vehicle, lv = v.chassis.physical.body.linvel(); resolve({ camera: A.camera.position.distanceTo(v.position), speed: Math.hypot(lv.x, lv.y, lv.z), open: !document.querySelector('.atlas').hidden, mode: d.mode, plane: d.modes.isPlane, drop: d.modes.drop, fov: A.camera.fov, focus: document.activeElement?.id ?? null }) }))))
/** Where the arrival is relative to the place: distance, inside its landmark, overlapping anything. */
const arrivalCheck = (name) => page.evaluate(async (name) => {
  const A = globalThis.__archipelago, T = A.THREE, d = A.driving, v = d.vehicle, M = await import('/archipelago/preview/runtime/placement.js'), p = v.position
  const place = A.atlas.markers.places.find((m) => m.name === name), box = place?.group ? M.landmarkBox(place.group) : null
  const rot = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), d.flatHeading()), body = v.chassis.physical.body
  const overlap = A.physics.world.intersectionWithShape({ x: p.x, y: p.y + .1, z: p.z }, { x: rot.x, y: rot.y, z: rot.z, w: rot.w }, new A.physics.rapier.Cuboid(1.45, .45, .95), A.physics.rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, null, body)
  return { distance: Math.hypot(p.x - place.x, p.z - place.z), insideLandmark: !!box && p.x > box.min.x && p.x < box.max.x && p.z > box.min.z && p.z < box.max.z, overlap: overlap ? overlap.parent()?.userData?.physical?.node?.name ?? 'collider' : null, ground: !!d.placement.surface(p.x, p.z)?.ground }
}, name)
/** Pixel distance between the map's arrow and the car's true map position (as world-map.mjs measures it). */
const arrowError = () => page.evaluate(async () => {
  const A = globalThis.__archipelago, a = document.querySelector('.atlas-player').getBoundingClientRect(), plane = document.querySelector('.atlas-base').getBoundingClientRect(), v = A.driving.vehicle.position
  const m = await import('/archipelago/preview/world-bounds.js'), raw = m.authoredWorldBounds(A.root), b = { minX: raw.minX - 6, maxX: raw.maxX + 6, minZ: raw.minZ - 6, maxZ: raw.maxZ + 6 }
  const ex = plane.left + (v.x - b.minX) / (b.maxX - b.minX) * plane.width, ey = plane.top + (v.z - b.minZ) / (b.maxZ - b.minZ) * plane.height
  return Math.hypot(ex - (a.left + a.width / 2), ey - (a.top + a.height / 2))
})
const clickPin = async (name) => { const dot = await pin(name).locator('i').boundingBox(); await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2) }

/* ---- 1. three named places by mouse ---- */
await openMap()
assert(await page.evaluate(() => [...document.querySelectorAll('.atlas-pin')].every((p) => p.tagName === 'BUTTON' && p.getAttribute('aria-label')?.startsWith('Travel to '))), 'every place on the map is a labelled button', results)
for (const name of ['Ice Rink', 'Castle', 'Harbor']) {
  await openMap()
  await clickPin(name)
  const frame = await nextFrame()
  await sleep(200)
  const arrival = await arrivalCheck(name), state = await car()
  assert(!frame.open && frame.mode === 'CAR', `${name}: the map closes and the car is a car`, results)
  assert(arrival.distance < 45 && !arrival.insideLandmark && arrival.overlap === null && arrival.ground, `${name}: arrives ${arrival.distance.toFixed(1)} m from the place, outside its landmark, on ground, overlapping nothing (${arrival.overlap})`, results)
  assert(frame.speed < 0.3 && state.speed < 0.5, `${name}: the car is still (${frame.speed.toFixed(3)} m/s)`, results)
  assert(frame.camera > 18 && frame.camera < 25, `${name}: the camera is behind the car on the next frame (${frame.camera.toFixed(1)} m), no flight across the island`, results)
  assert(frame.focus === 'world', `${name}: focus is back on the world (${frame.focus})`, results)
  await page.screenshot({ path: out(`teleport-${name.toLowerCase().replace(/\W+/g, '-')}.png`) })
  await openMap()
  const err = await arrowError()
  assert(err < 2, `${name}: the map's arrow is on the car (${err.toFixed(2)} px)`, results)
  await page.keyboard.press('Escape')
  await sleep(300)
}

/* ---- 2. the sea is refused, said where it was clicked ---- */
await openMap()
const before = await car()
const sea = await page.evaluate(() => { const A = globalThis.__archipelago, s = document.querySelector('.atlas-stage').getBoundingClientRect(), [x, y] = A.atlas.toScreen(-142, 10); return { x: s.left + x, y: s.top + y } })
await page.mouse.click(sea.x, sea.y)
await sleep(200)
const feedback = await page.evaluate(() => { const f = document.querySelector('.atlas-feedback'), r = f.getBoundingClientRect(); return { visible: !f.hidden && r.width > 0, text: f.textContent, x: r.left + r.width / 2, bottom: r.bottom } })
const afterSea = await car()
assert(await isOpen(), 'clicking the sea keeps the map open', results)
assert(feedback.visible && /can.t drive there/i.test(feedback.text) && /water/i.test(feedback.text), `and says why: “${feedback.text}”`, results)
assert(Math.abs(feedback.x - sea.x) < 100 && Math.abs(feedback.bottom - sea.y) < 40, `the message is where the click was (${Math.round(feedback.x - sea.x)}, ${Math.round(feedback.bottom - sea.y)} px)`, results)
assert(Math.hypot(afterSea.x - before.x, afterSea.z - before.z) < 0.05, 'the car did not move', results)
await page.screenshot({ path: out('teleport-sea-refused.png') })

/* ---- 3. dragging pans and never travels; a click on land travels ---- */
const stageBox = await page.locator('.atlas-stage').boundingBox()
await page.mouse.move(stageBox.x + stageBox.width / 2, stageBox.y + stageBox.height / 2)
for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -200)
await sleep(300)
const transform = await page.evaluate(() => document.querySelector('.atlas-plane').style.transform)
const land = { x: stageBox.x + stageBox.width * .45, y: stageBox.y + stageBox.height * .45 }
await page.mouse.move(land.x, land.y); await page.mouse.down(); await page.mouse.move(land.x + 90, land.y + 40, { steps: 10 }); await page.mouse.up()
await sleep(400)
const afterDrag = await car()
assert(await isOpen() && Math.hypot(afterDrag.x - before.x, afterDrag.z - before.z) < 0.05, 'a drag pans the map and does not travel', results)
assert(await page.evaluate((t) => document.querySelector('.atlas-plane').style.transform !== t, transform), `the drag did pan (zoom ${await page.evaluate(() => globalThis.__archipelago.atlas.view.zoom.toFixed(2))})`, results)
// Any point of the island: one that validates, clicked through the map's own transform (back to the whole island first).
await page.keyboard.press('Digit0')
await sleep(250)
const target = await page.evaluate(() => { const A = globalThis.__archipelago, d = A.driving, s = document.querySelector('.atlas-stage').getBoundingClientRect(); for (const [x, z] of [[-55, 62], [-62, 70], [-70, 40], [-40, 72], [-100, 0]]) { if (!d.placement.check(x, z, d.placement.cameraHeading(), { dynamicMargin: 2 }).ok) continue; const [sx, sy] = A.atlas.toScreen(x, z); return { x, z, sx: s.left + sx, sy: s.top + sy } } return null })
// A small wobble under the drag threshold is still a click.
await page.mouse.move(target.sx, target.sy); await page.mouse.down(); await page.mouse.move(target.sx + 2, target.sy + 1); await page.mouse.up()
await sleep(300)
const afterPoint = await car(), off = Math.hypot(afterPoint.x - target.x, afterPoint.z - target.z)
// One CSS pixel of the whole-island map is about half a metre of ground.
assert(!(await isOpen()) && off < 1.5, `a click on land travels to that point (${target.x}, ${target.z} → ${afterPoint.x.toFixed(2)}, ${afterPoint.z.toFixed(2)}; ${off.toFixed(2)} m)`, results)

/* ---- 4. keyboard: Tab to a place, Enter travels ---- */
await openMap()
let focused = ''
for (let i = 0; i < 80 && !/^Travel to Loop/.test(focused); i++) { await page.keyboard.press('Tab'); focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '') }
assert(/^Travel to Loop/.test(focused) && await isOpen(), `Tab reaches the places inside the map (“${focused}”)`, results)
const focusStyle = await page.evaluate(() => getComputedStyle(document.activeElement.querySelector('i')).boxShadow)
assert(focusStyle && focusStyle !== 'none', 'a focused place is visibly highlighted', results)
await page.keyboard.press('Enter')
await sleep(300)
const loop = await arrivalCheck('Loop')
assert(!(await isOpen()) && loop.distance < 45 && loop.overlap === null, `Enter on a place travels there (${loop.distance.toFixed(1)} m from the Loop)`, results)
await openMap()
await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
await page.keyboard.press('Escape')
assert(!(await isOpen()), 'Escape still closes the map', results)

/* ---- 5. from the plane ---- */
await page.locator('#world').focus()
await page.keyboard.press('Space'); await sleep(110); await page.keyboard.press('Space')
await page.waitForFunction(() => globalThis.__archipelago.driving.mode === 'PLANE')
await sleep(1500)
await openMap()
await clickPin('Contact')
const fromPlane = await nextFrame()
await sleep(400)
const contact = await arrivalCheck('Contact'), planeVisible = await page.evaluate(() => globalThis.__archipelago.driving.plane.group.visible)
assert(fromPlane.mode === 'CAR' && !fromPlane.plane && !fromPlane.drop && !planeVisible, 'travelling from the plane lands a car, plane controller off', results)
assert(Math.abs(fromPlane.fov - 25) < 0.5 && fromPlane.camera > 18 && fromPlane.camera < 25, `with the car camera at once (fov ${fromPlane.fov.toFixed(1)}, ${fromPlane.camera.toFixed(1)} m)`, results)
assert(contact.distance < 45 && contact.overlap === null, `at Contact (${contact.distance.toFixed(1)} m)`, results)

/* ---- 6. a run in progress ends ---- */
await page.evaluate(() => { const A = globalThis.__archipelago, d = A.driving, c = d.placement.check(-47, -26.5, 0, { dynamicMargin: 1 }); d.place(c, { reason: 'travel' }) })
await sleep(900)
await page.keyboard.press('Enter')
await sleep(300)
const running = await page.evaluate(() => globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state)
await openMap()
await clickPin('Ice Rink')
await sleep(300)
const stopped = await page.evaluate(() => ({ state: globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state, player: globalThis.__archipelago.driving.player.state }))
assert(running === 'countdown' && stopped.state === 'idle' && stopped.player === 'default', `travelling ends a run in progress (${running} → ${stopped.state}, player ${stopped.player})`, results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await page.close()

/* ---- 7. touch ---- */
const touch = await browser.newPage({ viewport: { width: 1024, height: 700 }, hasTouch: true })
const touchErrors = watch(touch, 'touch ')
await openPlayer(touch)
await sleep(800)
await touch.locator('#player-map').tap()
await touch.waitForFunction(() => !document.querySelector('.atlas').hidden)
await sleep(300)
const start = await touch.evaluate(() => globalThis.__archipelago.driving.vehicle.position.toArray())
// A one-finger drag pans without travelling.
const mid = await touch.evaluate(() => { const r = document.querySelector('.atlas-stage').getBoundingClientRect(); return { x: r.left + r.width * .4, y: r.top + r.height * .55 } })
const cdp = await touch.context().newCDPSession(touch)
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: mid.x, y: mid.y }] })
for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: mid.x + i * 9, y: mid.y + i * 4 }] })
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
await sleep(300)
const afterSwipe = await touch.evaluate(() => ({ open: !document.querySelector('.atlas').hidden, p: globalThis.__archipelago.driving.vehicle.position.toArray() }))
assert(afterSwipe.open && Math.hypot(afterSwipe.p[0] - start[0], afterSwipe.p[2] - start[2]) < 0.05, 'a one-finger swipe pans and does not travel', results)
const dot = await touch.locator('.atlas-pin[aria-label^="Travel to Castle"] i').boundingBox()
await touch.touchscreen.tap(dot.x + dot.width / 2, dot.y + dot.height / 2)
await sleep(400)
const tapped = await touch.evaluate(async () => { const A = globalThis.__archipelago, p = A.driving.vehicle.position, place = A.atlas.markers.places.find((m) => m.name === 'Castle'); return { open: !document.querySelector('.atlas').hidden, distance: Math.hypot(p.x - place.x, p.z - place.z) } })
assert(!tapped.open && tapped.distance < 45, `a tap on a place travels there (${tapped.distance.toFixed(1)} m from the Castle)`, results)
assert(touchErrors.length === 0, `no runtime errors (${touchErrors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
