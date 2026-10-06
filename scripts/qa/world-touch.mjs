/* /world on a touch screen: Chromium with touch and mobile emulation, as a
   phone held upright (390×844) and on its side (844×390), fingers put down
   through CDP Input.dispatchTouchEvent. On each:
   - a phone starts in touch mode: the buttons and the touch hints, no key hints;
   - the joystick on the ground: a one-finger drag drives the car several
     metres, a drag to one side turns it, lifting the finger lets go;
   - a tap on the car jumps; JUMP held keeps the wheels raised, released lets
     them down, and two quick taps of it do not fly; BACK ON YOUR WHEELS
     rights an overturned car where it lies, as R does;
   - a thumb on JUMP does not disturb a finger that is driving;
   - CAR / PLANE flies; a finger turns and climbs the plane; the joystick
     neither shows nor drives in the plane, where JUMP does nothing; CAR /
     PLANE lands again;
   - the map opens from its button and travels by tap, the buttons hidden
     while it is open;
   - a two-finger pinch zooms and does not drive;
   - a run that holds the car (the slalom's countdown, started from the
     interact button) lets go of a finger that was driving, with no jump;
     after the countdown the finger drives; BACK ON YOUR WHEELS ends the run;
   - a key (or a pad) hides the touch HUD and a finger on the world brings
     it back;
   - no runtime errors.
   Then the layout at 320×568, 390×844, 844×390, 768×1024 and 1024×768: every
   button at least 44 px and on screen, none overlapping the map button
   (player nav), the speed readout, the activity HUD, a notice or the
   interact button, the hints clear of the buttons, and a finger on a
   readout landing on the world; a 1440×900 mouse
   page shows none of the touch UI; and the studio (its own template, as
   world-studio-drive.mjs serves it) never does, on a touch screen either.
   Screenshots of the touch UI go to QA_OUT.
   QA_BASE=http://localhost:3404 node scripts/qa/world-touch.mjs */
import { BASE, launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()

/** A phone: touch and mobile emulation, and a CDP session to put fingers down with. */
async function phone(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = watch(page, `${width}×${height} `)
  await openPlayer(page)
  await sleep(1500)
  return { context, page, errors, cdp: await context.newCDPSession(page) }
}
/** Fingers through CDP ([x, y, id]). down and move list every finger that is down; lift lifts the ones it lists
 * (a touchEnd naming them, as Puppeteer's TouchHandle.end does), up lifts them all. */
const fingers = (cdp) => {
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) })
  return { down: (...points) => send('touchStart', points), move: (...points) => send('touchMove', points), lift: (...points) => send('touchEnd', points), up: () => send('touchEnd', []) }
}
/** Keeps a finger down at a point for `ms`, moving it a pixel now and then as a finger does. */
async function hold(f, [x, y], ms, others = []) { const end = Date.now() + ms; let i = 0; while (Date.now() < end) { await sleep(90); await f.move([x + (i++ % 2), y], ...others) } }
/** A drag from `a` to `b` in eight moves. */
async function drag(f, a, b) { await f.down([a.x, a.y]); for (let i = 1; i <= 8; i++) { await sleep(45); await f.move([a.x + (b.x - a.x) * i / 8, a.y + (b.y - a.y) * i / 8]) } }
async function tap(f, [x, y]) { await f.down([x, y]); await sleep(80); await f.up() }
const turned = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a))

const state = (page) => page.evaluate(() => {
  const A = globalThis.__archipelago, d = A.driving, v = d.vehicle, lv = v.chassis.physical.body.linvel(), n = d.nipple
  return { x: v.position.x, y: v.position.y, z: v.position.z, heading: Math.atan2(v.forward.z, v.forward.x), speed: Math.hypot(lv.x, lv.z), mode: d.mode, drop: d.modes.drop, player: d.player.state, contacts: v.wheels.inContactCount, up: v.upward.y, hops: d.jump.hops, extended: d.jump.extended, held: d.vehicleInput.held, suspensions: d.player.suspensions.join(','), accelerating: d.player.accelerating, steering: d.player.steering, ring: { active: n.active, visible: n.group.visible }, zoom: d.view.zoom.baseRatio, turn: d.modes.turn, pitch: d.modes.pitch, planeHeading: d.modes.heading, input: document.body.dataset.input }
})
const trace = async (page, ms) => { const rows = [], end = Date.now() + ms; while (Date.now() < end) { rows.push(await state(page)); await sleep(25) } return rows }
/** CSS pixels of the ground point `ahead` m in front of the car and `right` m to its right, on the joystick's plane. */
const ground = (page, ahead, right = 0) => page.evaluate(([ahead, right]) => {
  const A = globalThis.__archipelago, T = A.THREE, d = A.driving, v = d.vehicle, r = A.renderer.domElement.getBoundingClientRect()
  const f = new T.Vector3(v.forward.x, 0, v.forward.z).normalize(), s = new T.Vector3(-f.z, 0, f.x)
  const p = new T.Vector3(v.position.x, d.nipple.position.y, v.position.z).addScaledVector(f, ahead).addScaledVector(s, right).project(A.camera)
  return { x: r.left + (p.x + 1) / 2 * r.width, y: r.top + (1 - p.y) / 2 * r.height }
}, [ahead, right])
const centre = (page, selector) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] }, selector)
/** Puts the car, still, on open ground facing up the screen (away from the camera), with 24 m clear ahead of it. */
const openGround = (page) => page.evaluate(() => {
  const A = globalThis.__archipelago, d = A.driving, t = d.view.spherical.theta, heading = Math.atan2(Math.cos(t), -Math.sin(t)), fx = Math.cos(heading), fz = -Math.sin(heading)
  const clear = (x, z) => { for (let k = 3; k <= 24; k += 3) if (!d.placement.check(x + fx * k, z + fz * k, heading, { dynamicMargin: 1 }).ok) return false; return true }
  window.__open ??= (() => { const spots = [[-60, 62], [-40, 72], [-70, 40], [-100, 0], [-55, 30]]; for (let x = -110; x <= 110; x += 20) for (let z = -110; z <= 110; z += 20) spots.push([x, z]); for (const [x, z] of spots) { const c = d.placement.check(x, z, heading, { dynamicMargin: 2 }); if (c.ok && clear(c.x, c.z)) return [c.x, c.z] } return null })()
  if (!window.__open) return null
  const c = d.placement.check(window.__open[0], window.__open[1], heading, { dynamicMargin: 2 }); d.place(c, { reason: 'travel' }); return window.__open
})
/** Puts the car on its roof where it stands (as world-recovery.mjs does). */
const overturn = (page) => page.evaluate(() => { const T = globalThis.__archipelago.THREE, d = globalThis.__archipelago.driving, v = d.vehicle, b = v.chassis.physical.body, p = v.position, q = v.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI)); b.setTranslation({ x: p.x, y: p.y + .6, z: p.z }, true); b.setRotation(q, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true) })

async function suite(width, height) {
  const tag = `${width}×${height}`, { context, page, errors, cdp } = await phone(width, height), f = fingers(cdp)
  await page.evaluate(() => { window.__recoveries = []; globalThis.__archipelago.driving.events.on('recovered', (reason, pose) => window.__recoveries.push({ reason, source: pose.source })) })
  const shown = await page.evaluate(() => { const show = (s) => getComputedStyle(document.querySelector(s)).display; return { input: document.body.dataset.input, buttons: show('#touch-controls'), hints: show('#touch-hints'), keys: show('#key-hints'), notice: document.querySelector('#notice').textContent } })
  assert(shown.input === 'touch' && shown.buttons === 'flex' && shown.hints === 'block' && shown.keys === 'none', `${tag}: a phone starts in touch mode — buttons and touch hints shown, key hints hidden (${JSON.stringify(shown)})`, results)
  await page.screenshot({ path: out(`touch-${width}x${height}.png`) })

  /* ---- the joystick: a one-finger drag drives ---- */
  const spot = await openGround(page)
  assert(!!spot, `${tag}: open ground to drive on, facing up the screen (${spot?.map((n) => n.toFixed(1))})`, results)
  await sleep(1000)
  const s0 = await state(page)
  await drag(f, await ground(page, 1), await ground(page, 4.2))
  const target = await ground(page, 4.2), during = []
  for (let i = 0; i < 20; i++) { await sleep(100); await f.move([target.x + (i % 2), target.y]); during.push(await state(page)) }
  await page.screenshot({ path: out(`touch-${width}x${height}-joystick.png`) })
  const s1 = await state(page), moved = Math.hypot(s1.x - s0.x, s1.z - s0.z), along = ((s1.x - s0.x) * Math.cos(s0.heading) + (s1.z - s0.z) * Math.sin(s0.heading)) / (moved || 1)
  assert(moved > 4 && along > 0.9, `${tag}: a one-finger drag ahead of the car drives it ${moved.toFixed(1)} m forward (along its heading ${along.toFixed(2)})`, results)
  assert(during.every((r) => r.ring.active && r.ring.visible) && Math.max(...during.map((r) => r.accelerating)) > 0.5, `${tag}: the ring is on the ground under the finger and the throttle follows it (max ${Math.max(...during.map((r) => r.accelerating)).toFixed(2)})`, results)
  await f.up()
  await sleep(150)
  const lifted = await state(page)
  await sleep(1500)
  const coasting = await state(page)
  assert(!lifted.ring.active && !lifted.ring.visible && lifted.accelerating === 0 && lifted.hops === s0.hops, `${tag}: lifting the finger lets go — no ring, no throttle, no jump`, results)
  assert(coasting.speed < s1.speed && Math.abs(coasting.steering) < 0.02 && coasting.accelerating === 0, `${tag}: and the car runs on without input (${s1.speed.toFixed(1)} → ${coasting.speed.toFixed(1)} m/s)`, results)

  /* ---- a drag to one side turns the car that way ---- */
  for (const side of [1, -1]) {
    await openGround(page)
    await sleep(1000)
    const h0 = (await state(page)).heading, to = await ground(page, 2.9, 2.9 * side)
    await drag(f, await ground(page, 1), to)
    await hold(f, [to.x, to.y], 1800)
    const h1 = (await state(page)).heading
    await f.up()
    assert(turned(h0, h1) * side > 0.3, `${tag}: a drag to the ${side > 0 ? 'right' : 'left'} of the car turns it ${side > 0 ? 'right' : 'left'} (${turned(h0, h1).toFixed(2)} rad)`, results)
  }

  /* ---- a tap on the car jumps ---- */
  await openGround(page)
  await sleep(1300)
  let before = await state(page)
  const onCar = await ground(page, 0)
  await tap(f, [onCar.x, onCar.y])
  const hop = await trace(page, 1500)
  assert(hop.at(-1).hops === before.hops + 1 && hop.some((r) => r.contacts === 0) && hop.at(-1).suspensions === 'low,low,low,low', `${tag}: a tap on the car is one jump, every wheel off the ground, back down after`, results)
  await sleep(800)

  /* ---- JUMP: held, the wheels stay raised; released, they come down; two quick taps do not fly ---- */
  const jump = await centre(page, '#touch-jump')
  before = await state(page)
  await f.down(jump)
  await sleep(1500)
  const raised = await state(page)
  await f.up()
  await sleep(1400)
  const lowered = await state(page)
  assert(raised.hops === before.hops + 1 && raised.held && raised.extended && raised.suspensions === 'high,high,high,high' && raised.contacts === 4 && raised.y > before.y + 0.5 && !raised.ring.active, `${tag}: JUMP held — one jump, then the car rides on raised wheels (y +${(raised.y - before.y).toFixed(2)} m)`, results)
  assert(!lowered.held && !lowered.extended && lowered.suspensions === 'low,low,low,low' && Math.abs(lowered.y - before.y) < 0.12 && lowered.hops === before.hops + 1, `${tag}: JUMP released — the wheels come down to the ride height, no second jump (${(lowered.y - before.y).toFixed(3)} m; held ${lowered.held}, extended ${lowered.extended}, ${lowered.suspensions}, ${lowered.hops - before.hops} jump)`, results)
  await tap(f, jump); await sleep(120); await tap(f, jump)
  await sleep(500)
  assert((await state(page)).mode === 'CAR', `${tag}: two quick taps of JUMP do not fly`, results)
  await sleep(1500)

  /* ---- a thumb on JUMP while a finger drives ---- */
  await openGround(page)
  await sleep(1000)
  before = await state(page)
  const ahead = await ground(page, 3.6)
  await drag(f, await ground(page, 1), ahead)
  await hold(f, [ahead.x, ahead.y], 500)
  await f.down([ahead.x, ahead.y, 0], [jump[0], jump[1], 1])
  await hold(f, [ahead.x, ahead.y], 1300, [[jump[0], jump[1], 1]])
  const both = await state(page)
  await f.lift([jump[0], jump[1], 1])
  await hold(f, [ahead.x, ahead.y], 1300)
  const driving = await state(page)
  await f.up()
  assert(both.ring.active && both.accelerating > 0 && both.extended && both.hops === before.hops + 1, `${tag}: a thumb on JUMP while a finger drives — the car jumps and keeps its wheels up, still driven`, results)
  assert(driving.ring.active && driving.accelerating > 0 && !driving.extended, `${tag}: the thumb lifted, the wheels come down and the finger still drives (ring ${driving.ring.active}, throttle ${driving.accelerating.toFixed(2)}, extended ${driving.extended}, held ${driving.held})`, results)

  /* ---- BACK ON YOUR WHEELS rights an overturned car where it lies, as R does ---- */
  await openGround(page)
  await sleep(1000)
  await overturn(page)
  await sleep(900)
  const flipped = await state(page), count = await page.evaluate(() => window.__recoveries.length)
  await tap(f, await centre(page, '#touch-recover'))
  await page.waitForFunction((n) => window.__recoveries.length > n, count, { timeout: 3000 }).catch(() => {})
  await sleep(500)
  const righted = await state(page), rec = await page.evaluate(() => window.__recoveries.at(-1)), notice = await page.evaluate(() => document.querySelector('#notice').textContent)
  assert(flipped.up < 0 && rec?.reason === 'manual' && rec.source === 'in place' && righted.up > 0.99 && Math.hypot(righted.x - flipped.x, righted.z - flipped.z) < 1.5 && /back on your wheels/i.test(notice), `${tag}: BACK ON YOUR WHEELS on its roof — R's recovery, back on its wheels where it lay (${rec?.reason}, ${rec?.source}, up ${flipped.up.toFixed(2)} → ${righted.up.toFixed(3)}; “${notice}”)`, results)

  /* ---- CAR / PLANE: the plane, steered by a finger ---- */
  await tap(f, await centre(page, '#touch-vehicle'))
  await page.waitForFunction(() => globalThis.__archipelago.driving.mode === 'PLANE', null, { timeout: 3000 }).catch(() => {})
  const planeUi = await page.evaluate(() => ({ mode: globalThis.__archipelago.driving.mode, pressed: document.querySelector('#touch-vehicle').getAttribute('aria-pressed'), jump: document.querySelector('#touch-jump').getAttribute('aria-disabled'), recover: document.querySelector('#touch-recover').getAttribute('aria-disabled'), hint: getComputedStyle(document.querySelector('#touch-hints .plane-hint')).display }))
  assert(planeUi.mode === 'PLANE' && planeUi.pressed === 'true' && planeUi.jump === 'true' && planeUi.recover === 'true' && planeUi.hint === 'block', `${tag}: CAR / PLANE flies — the button says plane, JUMP and BACK ON YOUR WHEELS stand down, the hints are the plane's (${JSON.stringify(planeUi)})`, results)
  await sleep(2600)
  await page.screenshot({ path: out(`touch-${width}x${height}-plane.png`) })
  const p0 = await state(page), right = [width * 0.85, height * 0.5]
  await f.down(right)
  await hold(f, right, 1500)
  const p1 = await state(page)
  await f.up()
  await sleep(700)
  const high = [width * 0.5, height * 0.25]
  await f.down(high)
  await hold(f, high, 1300)
  const p2 = await state(page)
  await f.up()
  assert(p1.turn > 0.3 && turned(p0.planeHeading, p1.planeHeading) < -0.15, `${tag}: a finger held right of centre turns the plane right (turn ${p1.turn.toFixed(2)}, heading ${turned(p0.planeHeading, p1.planeHeading).toFixed(2)} rad)`, results)
  assert(p2.pitch > 0.08, `${tag}: held above centre, it climbs (pitch ${p2.pitch.toFixed(2)})`, results)
  assert(!p1.ring.active && !p1.ring.visible && !p2.ring.active && p1.accelerating === 0, `${tag}: in the plane the joystick neither shows nor drives`, results)
  const hops = (await state(page)).hops
  await tap(f, jump)
  await sleep(500)
  assert((await state(page)).hops === hops && (await state(page)).mode === 'PLANE', `${tag}: JUMP does nothing in the plane`, results)
  await tap(f, await centre(page, '#touch-vehicle'))
  await page.waitForFunction(() => { const d = globalThis.__archipelago.driving; return d.mode === 'CAR' && !d.modes.drop }, null, { timeout: 15000 }).catch(() => {})
  const landed = await page.evaluate(() => ({ mode: globalThis.__archipelago.driving.mode, pressed: document.querySelector('#touch-vehicle').getAttribute('aria-pressed'), jump: document.querySelector('#touch-jump').getAttribute('aria-disabled') }))
  assert(landed.mode === 'CAR' && landed.pressed === 'false' && landed.jump === 'false', `${tag}: CAR / PLANE again lands a car, and JUMP is back`, results)

  /* ---- the map: opens from its button, travels by tap ---- */
  await sleep(1000)
  await tap(f, await centre(page, '#player-map'))
  await page.waitForFunction(() => !document.querySelector('.atlas').hidden, null, { timeout: 5000 }).catch(() => {})
  await sleep(400)
  const pin = await page.evaluate(() => {
    const stage = document.querySelector('.atlas-stage').getBoundingClientRect(), inside = (r) => r.left > stage.left + 4 && r.right < stage.right - 4 && r.top > stage.top + 4 && r.bottom < stage.bottom - 4
    const pins = [...document.querySelectorAll('.atlas-pin')].map((p) => ({ name: p.getAttribute('aria-label')?.replace(/^Travel to /, '').split(/[,·—(]/)[0].trim(), r: p.querySelector('i').getBoundingClientRect() })).filter((p) => p.name && inside(p.r))
    const p = pins.find((x) => /^Castle/.test(x.name)) ?? pins[0]
    return p ? { name: p.name, x: p.r.left + p.r.width / 2, y: p.r.top + p.r.height / 2, buttons: getComputedStyle(document.querySelector('#touch-controls')).display } : null
  })
  if (pin) await tap(f, [pin.x, pin.y])
  await sleep(600)
  const travelled = await page.evaluate((name) => { const A = globalThis.__archipelago, p = A.driving.vehicle.position, place = A.atlas.markers.places.find((m) => m.name === name) ?? A.atlas.markers.places.find((m) => name && m.name.startsWith(name)); return { open: !document.querySelector('.atlas').hidden, distance: place ? Math.hypot(p.x - place.x, p.z - place.z) : NaN, buttons: getComputedStyle(document.querySelector('#touch-controls')).display } }, pin?.name)
  assert(!!pin && pin.buttons === 'none', `${tag}: the map opens from its button, the touch buttons hidden under it`, results)
  assert(!travelled.open && travelled.distance < 45 && travelled.buttons === 'flex', `${tag}: a tap on a place travels there (${pin?.name}, ${travelled.distance.toFixed(1)} m), the buttons back`, results)

  /* ---- a two-finger pinch zooms and does not drive ---- */
  await openGround(page)
  await sleep(1200)
  const c0 = await state(page), c = await ground(page, 0), pinch = []
  await f.down([c.x - 35, c.y, 0], [c.x + 35, c.y, 1])
  for (let i = 1; i <= 10; i++) { await sleep(50); await f.move([c.x - 35 - i * 11, c.y, 0], [c.x + 35 + i * 11, c.y, 1]); pinch.push(await state(page)) }
  await f.up()
  await sleep(500)
  const c1 = await state(page)
  assert(c1.zoom > c0.zoom + 0.15, `${tag}: a two-finger pinch zooms (zoom ${c0.zoom.toFixed(2)} → ${c1.zoom.toFixed(2)})`, results)
  assert(pinch.every((r) => !r.ring.active && r.accelerating === 0) && Math.hypot(c1.x - c0.x, c1.z - c0.z) < 0.3 && c1.hops === c0.hops, `${tag}: and does not drive or jump (moved ${Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(2)} m)`, results)

  /* ---- a run that holds the car lets go of the finger; after it, the finger drives; BACK ON YOUR WHEELS ends it ---- */
  await page.evaluate(() => { const d = globalThis.__archipelago.driving, c = d.placement.check(-47, -26.5, 0, { dynamicMargin: 1 }); d.place(c, { reason: 'travel' }) })
  await page.waitForFunction(() => !document.querySelector('#interact-action').hidden, null, { timeout: 5000 }).catch(() => {})
  const label = await page.evaluate(() => document.querySelector('#interact-action').textContent)
  before = await state(page)
  const car = await ground(page, 0), interact = await centre(page, '#interact-action')
  await f.down([car.x, car.y, 0])
  await hold(f, [car.x, car.y], 300)
  const engaged = await state(page)
  await f.down([car.x, car.y, 0], [interact[0], interact[1], 1])
  await sleep(120)
  await f.lift([interact[0], interact[1], 1])
  await hold(f, [car.x, car.y], 400)
  const counting = await page.evaluate(() => ({ slalom: globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state, hud: document.querySelector('#gameplay-hud').textContent, jump: document.querySelector('#touch-jump').getAttribute('aria-disabled') }))
  const held = await state(page)
  await f.up()
  await sleep(600)
  const afterLift = await state(page)
  assert(!/· E$/.test(label) && engaged.ring.active, `${tag}: the interact button is the on-screen E (“${label}”), a finger on the car`, results)
  assert(counting.slalom === 'countdown' && held.player === 'locked' && !held.ring.active && !held.ring.visible && counting.jump === 'true', `${tag}: tapping it starts the slalom's countdown, which lets go of the finger and stands JUMP down (${counting.slalom}, “${counting.hud}”)`, results)
  assert(afterLift.hops === before.hops, `${tag}: lifting that finger afterwards is not a tap — no jump`, results)
  await page.waitForFunction(() => globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state === 'running', null, { timeout: 6000 }).catch(() => {})
  const go = await ground(page, 3.6)
  await drag(f, await ground(page, 1), go)
  await hold(f, [go.x, go.y], 600)
  const racing = await state(page)
  await f.up()
  assert(racing.player === 'default' && racing.ring.active && racing.accelerating > 0, `${tag}: after the countdown a finger drives again`, results)
  await sleep(400)
  await tap(f, await centre(page, '#touch-recover'))
  await sleep(700)
  const ended = await page.evaluate(() => globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state)
  assert(ended === 'idle', `${tag}: BACK ON YOUR WHEELS ends the run, as R does (${ended})`, results)

  /* ---- a key (or a pad) takes over, and a finger takes it back ---- */
  const hud = () => page.evaluate(() => { const show = (s) => getComputedStyle(document.querySelector(s)).display; return { input: document.body.dataset.input, buttons: show('#touch-controls'), keys: show('#key-hints') } })
  const twoFingers = async () => { const m = await ground(page, 0); await f.down([m.x - 30, m.y, 0], [m.x + 30, m.y, 1]); await sleep(150); await f.up(); await sleep(150) }
  await page.keyboard.press('KeyC')
  await sleep(150)
  const keyed = await hud()
  await twoFingers()
  const back = await hud()
  // No pad can be plugged into this browser: its mode is set the way Inputs sets it on a pad's first button.
  await page.evaluate(() => globalThis.__archipelago.driving.inputs.setMode('gamepad'))
  await sleep(150)
  const padded = await hud()
  await twoFingers()
  const again = await hud()
  assert(keyed.input === 'keyboard' && keyed.buttons === 'none' && keyed.keys === 'block' && back.input === 'touch' && back.buttons === 'flex' && back.keys === 'none', `${tag}: a key hides the touch HUD and brings the key hints back; a finger on the world brings the touch HUD back (${JSON.stringify([keyed, back])})`, results)
  assert(padded.input === 'gamepad' && padded.buttons === 'none' && again.buttons === 'flex', `${tag}: so does a pad (${JSON.stringify([padded, again])})`, results)

  assert(errors.length === 0, `${tag}: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

await suite(390, 844)
await suite(844, 390)

/* ---- the layout at five sizes ---- */
{
  const { context, page, errors } = await phone(390, 844)
  const sizes = [[320, 568], [390, 844], [844, 390], [768, 1024], [1024, 768]]
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height })
    await sleep(700)
    const layout = await page.evaluate(() => {
      const A = globalThis.__archipelago, $ = (s) => document.querySelector(s)
      // Everything that can share the screen with the buttons, at its fullest: the longest touch notice, an
      // activity HUD and an interact prompt. The HUD and the prompt are rewritten every half second; measured at once.
      $('#notice').textContent = 'Drag to drive · tap the car to jump'; $('#notice').classList.add('show')
      $('#gameplay-hud').textContent = 'Penguin round-up · 0:42 · 3 / 6 penguins in the pen · Push them into the ring on the ice'
      $('#interact-action').hidden = false; $('#interact-action').textContent = 'Start the penguin round-up'
      const box = (s) => { const r = $(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height, display: getComputedStyle($(s)).display } }
      const hud = ['#vehicle-mode', '#speed', '#surface', '#altitude', '#touch-hints', '#vehicle-paint', '#drive-hud > span'].map(box).filter((b) => b.width && b.height)
      // A finger put down on a readout is a finger on the world.
      const through = ['#speed', '#touch-hints', '#gameplay-hud'].every((s) => { const r = $(s).getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === $('#world') })
      return { through, input: document.body.dataset.input, buttons: ['#touch-recover', '#touch-vehicle', '#touch-jump'].map(box), column: box('#touch-controls'), nav: box('#player-nav'), hud, hints: box('#touch-hints'), gameplay: box('#gameplay-hud'), notice: box('#notice'), interact: box('#interact-action'), viewport: { width: innerWidth, height: innerHeight }, mode: A.driving.mode }
    })
    await page.screenshot({ path: out(`touch-layout-${width}x${height}.png`) })
    const meets = (a, b) => a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5
    const others = { 'player nav': [layout.nav], 'speed readout': layout.hud, 'activity HUD': [layout.gameplay], notice: [layout.notice], 'interact button': [layout.interact] }
    const hits = []
    for (const b of layout.buttons) for (const [name, list] of Object.entries(others)) if (list.some((o) => meets(b, o))) hits.push(name)
    const small = layout.buttons.filter((b) => b.width < 44 || b.height < 44), outside = layout.buttons.filter((b) => b.left < 0 || b.top < 0 || b.right > layout.viewport.width || b.bottom > layout.viewport.height)
    assert(layout.input === 'touch' && layout.column.display === 'flex' && layout.gameplay.display === 'block' && layout.notice.width > 0 && layout.interact.width > 0, `${width}×${height}: touch UI, activity HUD, notice and interact prompt all on screen`, results)
    assert(!small.length && !outside.length, `${width}×${height}: every button at least 44 px and on screen (${layout.buttons.map((b) => `${Math.round(b.width)}×${Math.round(b.height)}`).join(', ')})`, results)
    assert(!hits.length, `${width}×${height}: no button overlaps the player nav, the speed readout, the activity HUD, a notice or the interact button${hits.length ? ` (overlaps: ${[...new Set(hits)].join(', ')})` : ''}`, results)
    assert(!meets(layout.hints, layout.column) && ![layout.notice, layout.gameplay, layout.nav, ...layout.hud].some((o) => meets(layout.interact, o)), `${width}×${height}: the touch hints stay clear of the buttons; the interact prompt of the notice, the activity HUD, the player nav and the speed readout`, results)
    assert(layout.through, `${width}×${height}: a finger on the speed readout, the hints or the activity HUD lands on the world`, results)
  }
  await page.evaluate(() => { document.querySelector('#notice').classList.remove('show'); globalThis.__archipelago.atlas.toggle() })
  await sleep(500)
  const underMap = await page.evaluate(() => ({ open: !document.querySelector('.atlas').hidden, buttons: getComputedStyle(document.querySelector('#touch-controls')).display }))
  assert(underMap.open && underMap.buttons === 'none', 'with the map open the touch buttons are hidden, not left under it', results)
  assert(errors.length === 0, `layout: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

/* ---- a mouse and a keyboard: none of it ---- */
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = watch(page, 'mouse ')
  await openPlayer(page)
  await sleep(1000)
  await page.mouse.move(700, 450); await page.mouse.down(); await page.mouse.move(760, 420, { steps: 6 }); await page.mouse.up()
  await page.keyboard.press('KeyW')
  await sleep(300)
  const desk = await page.evaluate(() => { const show = (s) => getComputedStyle(document.querySelector(s)).display, d = globalThis.__archipelago.driving; return { coarse: matchMedia('(pointer: coarse)').matches, input: document.body.dataset.input, mode: d.inputs.mode, buttons: show('#touch-controls'), hints: show('#touch-hints'), keys: show('#key-hints'), help: show('#help-touch'), ring: d.nipple.active || d.nipple.group.visible, notice: document.querySelector('#notice').textContent } })
  assert(!desk.coarse && desk.input === 'keyboard' && desk.mode === 'keyboard' && desk.buttons === 'none' && desk.hints === 'none' && desk.help === 'none' && desk.keys === 'block' && !desk.ring, `1440×900 with a mouse: no touch buttons, hints or joystick; the key hints as before (${JSON.stringify(desk)})`, results)
  assert(/^WASD drive/.test(desk.notice), `and the keyboard notice (“${desk.notice}”)`, results)
  await page.screenshot({ path: out('touch-mouse-1440x900.png') })
  assert(errors.length === 0, `mouse: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await page.close()
}

/* ---- the studio, on a touch screen: never ---- */
{
  const html = (await import(new URL('../../src/server/world-studio/studio-template.ts', import.meta.url))).STUDIO_HTML.replace('<!--CONFIG-->', '<script>window.ARCHIPELAGO_CONFIG={}</script>')
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true })
  const page = await context.newPage(), errors = watch(page, 'studio ')
  await page.route(`${BASE}/archipelago/preview/studio-qa.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
  await page.goto(`${BASE}/archipelago/preview/studio-qa.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 240_000 })
  await page.locator('#drive').tap()
  await page.waitForFunction(() => globalThis.__archipelago.mode === 'drive', null, { timeout: 30_000 })
  await sleep(1200)
  const f = fingers(await context.newCDPSession(page)), at = await ground(page, 3.5)
  await f.down([at.x, at.y])
  await hold(f, [at.x, at.y], 500)
  const studio = await page.evaluate(() => ({ admin: document.body.classList.contains('studio-admin'), input: document.body.dataset.input ?? null, mode: globalThis.__archipelago.driving.inputs.mode, ui: ['#touch-controls', '#touch-hints', '#touch-jump'].filter((s) => document.querySelector(s)).length }))
  await f.up()
  assert(studio.admin && studio.mode === 'touch' && studio.input === null && studio.ui === 0, `the studio's drive on a touch screen shows no touch HUD (${JSON.stringify(studio)})`, results)
  assert(errors.length === 0, `studio: no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}
await browser.close()
finish(results)
