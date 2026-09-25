/* /world car jump: one press is one real hop with every wheel off the ground;
   held, SPACE keeps all four wheels extended (the /world2 hydraulics) after that
   one hop — no second impulse — until released, when the car is let down to its
   ride height; repeated / mid-air / typing / plane presses do not hop; a blur, a
   hidden tab, the map, R and the touch button's release all let the wheels down. */
import { launch, openPlayer, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = watch(page)
await openPlayer(page)
await sleep(2500)
const state = () => page.evaluate(() => { const d = globalThis.__archipelago.driving, v = d.vehicle, b = v.chassis.physical.body; return { y: v.position.y, contact: v.wheels.inContactCount, hops: d.jump.hops, jump: d.jump.state, extended: d.jump.extended, held: d.vehicleInput.held, suspensions: d.player.suspensions.join(','), length: v.wheels.items.map((w) => w.suspensionLength), vy: b.linvel().y, ang: Math.hypot(...Object.values(b.angvel())), up: v.upward.y, mode: d.mode } })
const trace = async (ms) => { const rows = []; const end = Date.now() + ms; while (Date.now() < end) { rows.push(await state()); await sleep(16) } return rows }
const allLow = (s) => s.suspensions === 'low,low,low,low'
const settle = async () => { for (let i = 0; i < 40 && !allLow(await state()); i++) await sleep(50); await sleep(700) }

const rest = await state()
assert(rest.contact === 4, `car at rest on four wheels (y ${rest.y.toFixed(2)})`, results)
// 1. One press.
await page.keyboard.press('Space')
const hop = await trace(1600)
const apex = Math.max(...hop.map((r) => r.y)) - rest.y
const airborne = hop.filter((r) => r.contact === 0).length
const landedAt = hop.findIndex((r, i) => i > 5 && hop.slice(0, i).some((q) => q.contact === 0) && r.contact >= 3)
const after = hop.slice(landedAt + 20)
const settledY = after.length ? after[after.length - 1].y : NaN
assert(hop[hop.length - 1].hops === rest.hops + 1, `one press → exactly one hop (${hop[hop.length - 1].hops - rest.hops})`, results)
assert(airborne >= 5, `all four wheels leave the ground (${airborne} samples with zero contact)`, results)
assert(apex > 1.0 && apex < 3.5, `chassis rises ${apex.toFixed(2)} m`, results)
assert(landedAt > 0, 'car lands on its wheels again', results)
assert(Math.abs(settledY - rest.y) < 0.08, `ride height restored after landing (${(settledY - rest.y).toFixed(3)} m)`, results)
assert(after.every((r) => r.up > 0.9), 'lands upright', results)
const tail = after.slice(-15)
assert(tail.every((r) => Math.abs(r.vy) < 0.25 && r.ang < 0.35), `no lingering bounce or vibration (max |vy| ${Math.max(...tail.map((r) => Math.abs(r.vy))).toFixed(3)})`, results)
assert(hop.slice(-20).every(allLow), 'a tap leaves the wheels at their normal height', results)
await sleep(600)

// 2. Held SPACE for three seconds: one hop, then the wheels stay extended until the release.
let before = (await state()).hops
await page.keyboard.down('Space')
const held = await trace(3000)
const during = held.slice(-40)
await page.keyboard.up('Space')
const released = await trace(1600)
const lowered = released.slice(-10)
assert((await state()).hops === before + 1 && held.filter((r, i) => i && r.hops > held[i - 1].hops).length <= 1, `holding SPACE for 3 s gives one hop — one impulse (${(await state()).hops - before})`, results)
assert(during.every((r) => r.suspensions === 'high,high,high,high' && r.extended && r.held), 'while held, all four suspensions stay extended (high)', results)
assert(during.every((r) => r.contact === 4 && r.y > rest.y + 0.6 && Math.min(...r.length) > 1.3), `the car rides raised on extended wheels (y ${during.at(-1).y.toFixed(2)} vs ${rest.y.toFixed(2)}, suspension ${Math.min(...during.at(-1).length).toFixed(2)} m)`, results)
assert(during.every((r) => Math.abs(r.vy) < 0.3 && r.ang < 0.2 && r.up > 0.99), 'steady while held: no bounce, no drift, upright', results)
assert(lowered.every((r) => allLow(r) && !r.extended && !r.held) && Math.abs(lowered.at(-1).y - rest.y) < 0.1, `released, the wheels come back to low and the car to its ride height (${(lowered.at(-1).y - rest.y).toFixed(3)} m)`, results)
assert(Math.max(...released.map((r) => Math.abs(r.vy))) < 1.6, `the release is a let-down, not a drop (max |vy| ${Math.max(...released.map((r) => Math.abs(r.vy))).toFixed(2)} m/s)`, results)
assert(released.every((r) => r.hops === before + 1), 'the release does not jump', results)

// 3. Browser auto-repeat while held: synthetic repeat keydowns are ignored.
before = (await state()).hops
await page.keyboard.down('Space')
await page.evaluate(() => { for (let i = 0; i < 12; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true })) })
await sleep(1200); await page.keyboard.up('Space'); await settle()
assert((await state()).hops === before + 1, `auto-repeat keydowns add no hops (${(await state()).hops - before})`, results)

// 4. Letting go is not the only way out of a hold: a blur, a hidden tab, the map, R, each let the wheels down.
const holdUp = async () => { await page.keyboard.down('Space'); await sleep(1300); return (await state()).extended }
let up = await holdUp()
await page.evaluate(() => window.dispatchEvent(new Event('blur')))
await sleep(1200)
let s = await state()
assert(up && !s.held && !s.extended && allLow(s), `a window blur while held lets the wheels down (${s.suspensions})`, results)
await page.keyboard.up('Space'); await settle()

up = await holdUp()
await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); delete document.visibilityState })
await sleep(1200)
s = await state()
assert(up && !s.held && !s.extended && allLow(s), `a hidden tab while held lets the wheels down (${s.suspensions})`, results)
await page.keyboard.up('Space'); await settle()

before = (await state()).hops
up = await holdUp()
await page.keyboard.press('KeyM')
await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
s = await state()
assert(up && !s.held && !s.extended, 'opening the map while held releases the hold', results)
await page.keyboard.press('Escape')
await page.keyboard.up('Space')
await sleep(1300)
s = await state()
assert(allLow(s) && s.hops === before + 1, `and after the map the wheels are down, with no extra hop (${s.suspensions}, ${s.hops - before})`, results)
await settle()

before = (await state()).hops
up = await holdUp()
await page.keyboard.press('KeyR')
await sleep(150)
s = await state()
assert(up && !s.held && !s.extended && allLow(s), `R while held puts the car back on normal wheels at once (${s.suspensions})`, results)
await page.keyboard.up('Space'); await sleep(900)
assert((await state()).hops === before + 1, 'and no hop follows', results)
await settle()

// 5. The touch / gamepad jump button: a tap hops; held, it keeps the wheels up; let go, they come down.
before = (await state()).hops
await page.evaluate(() => globalThis.__archipelago.driving.inputs.pressTouchAction('jump'))
await sleep(1500)
const touchHeld = await state()
await page.evaluate(() => globalThis.__archipelago.driving.inputs.releaseTouchAction('jump'))
await sleep(1300)
const touchReleased = await state()
assert(touchHeld.hops === before + 1 && touchHeld.extended && touchHeld.suspensions === 'high,high,high,high', 'the touch jump button held: one hop, wheels kept up', results)
assert(allLow(touchReleased) && !touchReleased.extended, 'released: wheels down', results)
await settle()

// 6. Mid-air: a request while airborne (outside the double-tap window) is refused.
before = (await state()).hops
await page.keyboard.press('Space')
await page.waitForFunction(() => globalThis.__archipelago.driving.vehicle.wheels.inContactCount === 0)
const midair = await page.evaluate(() => globalThis.__archipelago.driving.hop())
await sleep(1500)
assert(midair === false && (await state()).hops === before + 1, `no mid-air hop (request returned ${midair})`, results)

// 7. Typing into a field never hops.
before = (await state()).hops
await page.evaluate(() => { const i = document.createElement('input'); i.id = 'qa-field'; i.style.cssText = 'position:fixed;top:4px;left:4px;z-index:999'; document.body.append(i); i.focus() })
await page.keyboard.type('a b c'); await page.keyboard.press('Space'); await page.keyboard.down('Space'); await sleep(900); await page.keyboard.up('Space')
s = await state()
assert(s.hops === before && allLow(s), 'SPACE typed (or held) in a text field does not hop or raise the wheels', results)
await page.evaluate(() => { document.getElementById('qa-field').remove(); document.querySelector('#world').focus() })

// 8. Plane: a single press does not hop; the switch leaves nothing raised.
await page.keyboard.press('Space'); await sleep(110); await page.keyboard.press('Space')
await page.waitForFunction(() => globalThis.__archipelago.driving.mode === 'PLANE')
await sleep(800)
before = (await state()).hops
await page.keyboard.press('Space'); await sleep(900)
const plane = await state()
assert(plane.mode === 'PLANE' && plane.hops === before && allLow(plane), 'a single press while flying does not hop', results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
console.log('trace', JSON.stringify(hop.filter((_, i) => i % 3 === 0).map((r) => [+r.y.toFixed(2), r.contact])))
console.log('held', JSON.stringify([...held, ...released].filter((_, i) => i % 6 === 0).map((r) => [+r.y.toFixed(2), r.contact, r.suspensions[0]])))
await browser.close()
finish(results)
