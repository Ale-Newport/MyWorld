/* /world car jump: one press is one real hop with every wheel off the ground,
   held / repeated / mid-air / typing / plane presses do not hop, landings settle. */
import { launch, openPlayer, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = watch(page)
await openPlayer(page)
await sleep(2500)
const state = () => page.evaluate(() => { const d = globalThis.__archipelago.driving, v = d.vehicle, b = v.chassis.physical.body; return { y: v.position.y, contact: v.wheels.inContactCount, hops: d.jump.hops, jump: d.jump.state, vy: b.linvel().y, ang: Math.hypot(...Object.values(b.angvel())), up: v.upward.y, mode: d.mode } })
const trace = async (ms) => { const rows = []; const end = Date.now() + ms; while (Date.now() < end) { rows.push(await state()); await sleep(16) } return rows }

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
await sleep(600)

// 2. Held SPACE for two seconds: still one hop.
let before = (await state()).hops
await page.keyboard.down('Space'); await sleep(2000); await page.keyboard.up('Space'); await sleep(900)
assert((await state()).hops === before + 1, `holding SPACE for 2 s gives one hop (${(await state()).hops - before})`, results)

// 3. Browser auto-repeat while held: synthetic repeat keydowns are ignored.
before = (await state()).hops
await page.keyboard.down('Space')
await page.evaluate(() => { for (let i = 0; i < 12; i++) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ', repeat: true, bubbles: true })) })
await sleep(1200); await page.keyboard.up('Space'); await sleep(700)
assert((await state()).hops === before + 1, `auto-repeat keydowns add no hops (${(await state()).hops - before})`, results)

// 4. Mid-air: a request while airborne (outside the double-tap window) is refused.
before = (await state()).hops
await page.keyboard.press('Space')
await page.waitForFunction(() => globalThis.__archipelago.driving.vehicle.wheels.inContactCount === 0)
const midair = await page.evaluate(() => globalThis.__archipelago.driving.hop())
await sleep(1500)
assert(midair === false && (await state()).hops === before + 1, `no mid-air hop (request returned ${midair})`, results)

// 5. Typing into a field never hops.
before = (await state()).hops
await page.evaluate(() => { const i = document.createElement('input'); i.id = 'qa-field'; i.style.cssText = 'position:fixed;top:4px;left:4px;z-index:999'; document.body.append(i); i.focus() })
await page.keyboard.type('a b c'); await page.keyboard.press('Space'); await sleep(900)
assert((await state()).hops === before, 'SPACE typed into a text field does not hop', results)
await page.evaluate(() => { document.getElementById('qa-field').remove(); document.querySelector('#world').focus() })

// 6. Plane: a single press does not hop.
await page.keyboard.press('Space'); await sleep(110); await page.keyboard.press('Space')
await page.waitForFunction(() => globalThis.__archipelago.driving.mode === 'PLANE')
await sleep(800)
before = (await state()).hops
await page.keyboard.press('Space'); await sleep(900)
const plane = await state()
assert(plane.mode === 'PLANE' && plane.hops === before, 'a single press while flying does not hop', results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
console.log('trace', JSON.stringify(hop.filter((_, i) => i % 3 === 0).map((r) => [+r.y.toFixed(2), r.contact])))
await browser.close()
finish(results)
