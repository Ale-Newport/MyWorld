/* /world frozen lake: penguins and cones are individual dynamic bodies the car
   pushes; they slide, slow down, collide with each other, never sink, never
   launch the car, leave no static collider behind, and reset to authored spots. */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = watch(page)
await openPlayer(page)
await sleep(1500)

/* The lake's own props: the infield slalom's cones are pushable too, but they stand on grass. */
const onIce = (node) => { for (let n = node; n; n = n.parent) if (n.userData.worldExperience) return /ice rink/i.test(n.name); return false }
const props = () => page.evaluate((onIceSrc) => {
  const A = globalThis.__archipelago, onIce = eval(onIceSrc)
  return A.physics.dynamic.filter((p) => p.node?.userData.pushable && onIce(p.node)).map((p) => {
    const t = p.body.translation(), v = p.body.linvel(), r = p.body.rotation()
    const up = new A.THREE.Vector3(0, 1, 0).applyQuaternion(new A.THREE.Quaternion(r.x, r.y, r.z, r.w)).y
    const h = p.initialState.rotation, homeUp = new A.THREE.Vector3(0, 1, 0).applyQuaternion(new A.THREE.Quaternion(h.x, h.y, h.z, h.w)).y
    return { name: p.node.name, homeUp, kind: p.node.userData.collider_shape, x: t.x, y: t.y, z: t.z, speed: Math.hypot(v.x, v.z), up, home: p.initialState.position, ccd: p.body.isCcdEnabled(), colliders: p.colliders.map((c) => c.shapeType()), mass: p.body.mass(), sleeping: p.body.isSleeping() }
  })
}, onIce.toString())
const before = await props()
const penguins = before.filter((p) => p.kind === 'SELF_RIGHTING'), cones = before.filter((p) => p.kind === 'CONE')
assert(penguins.length === 8 && cones.length === 7, `8 penguins and 7 cones are dynamic bodies (${penguins.length}/${cones.length})`, results)
assert(before.every((p) => p.ccd), 'every prop has continuous collision detection', results)
assert(before.every((p) => p.colliders.length >= 2 && !p.colliders.includes(6) && !p.colliders.includes(9)), `primitive colliders only, no trimesh/hull (${[...new Set(before.map((p) => p.colliders.join('+')))].join(', ')})`, results)

// No static collider left where a prop stands: ray down through each authored spot must hit the prop itself.
const staticLeft = await page.evaluate(() => {
  const A = globalThis.__archipelago, R = A.physics.rapier, w = A.physics.world
  const onIce = (node) => { for (let n = node; n; n = n.parent) if (n.userData.worldExperience) return /ice rink/i.test(n.name); return false }
  return A.physics.dynamic.filter((p) => p.node?.userData.pushable && onIce(p.node)).map((p) => {
    const s = p.initialState.position, ray = new R.Ray({ x: s.x, y: s.y + 5, z: s.z }, { x: 0, y: -1, z: 0 })
    const fixed = []
    w.intersectionsWithRay(ray, 10, true, (hit) => { const b = hit.collider.parent(); if (b && b.isFixed()) fixed.push(+(s.y + 5 - hit.timeOfImpact).toFixed(2)); return true })
    // The ice sheet itself sits just under the prop's base; anything 10 cm up is inside the prop.
    return { name: p.node.name, fixedAbove: fixed.filter((y) => y > s.y + 0.1).length, fixed }
  })
})
assert(staticLeft.every((s) => s.fixedAbove === 0), `no static collider inside any prop (${staticLeft.filter((s) => s.fixedAbove).map((s) => s.name).join(', ') || 'none'})`, results)

// Drive into the first penguin column from outside the lake.
const target = penguins.sort((a, b) => a.z - b.z)[0]
await page.evaluate(({ x, z }) => { const d = globalThis.__archipelago.driving, T = globalThis.__archipelago.THREE; d.vehicle.moveTo(new T.Vector3(x, 1.4, z - 11), -Math.PI / 2); d.player.position.set(x, 1.4, z - 11); d.restoreCarCamera() }, target)
await sleep(700)
let carMaxLift = 0
const carY0 = await page.evaluate(() => globalThis.__archipelago.driving.vehicle.position.y)
await page.keyboard.down('KeyW')
for (let i = 0; i < 30; i++) { await sleep(50); carMaxLift = Math.max(carMaxLift, (await page.evaluate(() => globalThis.__archipelago.driving.vehicle.position.y)) - carY0) }
await page.screenshot({ path: out('ice-impact.png') })
await page.keyboard.up('KeyW')
await page.keyboard.down('KeyB'); await sleep(900); await page.keyboard.up('KeyB')
const mid = await props()
await sleep(2500)
const late = await props()
const moved = late.filter((p) => Math.hypot(p.x - p.home.x, p.z - p.home.z) > 1)
const hit = mid.find((p) => p.name === target.name), hitLate = late.find((p) => p.name === target.name)
assert(moved.length >= 2, `car pushed props across the ice (${moved.length} moved > 1 m: ${moved.map((p) => p.name).join(', ')})`, results)
assert(moved.some((p) => p.name !== target.name), 'the struck penguin knocked into others (prop–prop collisions)', results)
assert(hit && hitLate && hitLate.speed < hit.speed, `pushed props slow down (${hit?.speed.toFixed(2)} → ${hitLate?.speed.toFixed(2)} m/s)`, results)
assert(late.every((p) => p.y > p.home.y - 0.25), `nothing sinks through the ice (min Δy ${Math.min(...late.map((p) => p.y - p.home.y)).toFixed(2)} m)`, results)
assert(carMaxLift < 0.6, `the car is not launched by the impact (max lift ${carMaxLift.toFixed(2)} m)`, results)

// Cones: drive along the cone row at speed.
const cone = cones.sort((a, b) => a.z - b.z)[0]
await page.evaluate(({ x, z }) => { const d = globalThis.__archipelago.driving, T = globalThis.__archipelago.THREE; d.vehicle.moveTo(new T.Vector3(x, 1.4, z - 14), -Math.PI / 2); d.player.position.set(x, 1.4, z - 14); d.restoreCarCamera() }, cone)
await sleep(600)
await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft'); await sleep(2200); await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW')
await page.keyboard.down('KeyB'); await sleep(1000); await page.keyboard.up('KeyB')
await sleep(3500)
const settled = await props()
const conesAfter = settled.filter((p) => p.kind === 'CONE')
assert(conesAfter.filter((p) => Math.hypot(p.x - p.home.x, p.z - p.home.z) > 1).length >= 3, `the car scattered the cone row (${conesAfter.filter((p) => Math.hypot(p.x - p.home.x, p.z - p.home.z) > 1).length} cones moved)`, results)
assert(conesAfter.some((p) => p.up < 0.6), `cones can tip over (${conesAfter.filter((p) => p.up < 0.6).length} on their side)`, results)

await sleep(4000)
const resting = await props()
const fallen = resting.filter((p) => p.kind === 'SELF_RIGHTING' && p.up < 0.85)
assert(fallen.length === 0, `penguins wobble but end up standing (${fallen.map((p) => p.name + ' ' + p.up.toFixed(2)).join(', ') || 'all upright'})`, results)
assert(resting.every((p) => p.speed < 0.2), `everything comes to rest; no endless vibration (max ${Math.max(...resting.map((p) => p.speed)).toFixed(3)} m/s)`, results)
await page.screenshot({ path: out('ice-after.png') })

// Reset to the authored positions — with the car off the lake first: where the cone run ends is chaotic, and a
// prop reset into a car that happened to stop on its spot is shoved out of it (measured: a cone 0.57 m off, tipped).
await page.evaluate(() => { const d = globalThis.__archipelago.driving; d.place(d.placement.near(76.6, 14, { radius: 12, dynamicMargin: 1 }), { reason: 'travel' }) })
await sleep(300)
const reset = await page.evaluate(async (onIceSrc) => { const m = await import('/archipelago/preview/pushables.js'); return m.resetPushables(globalThis.__archipelago.physics, eval(onIceSrc)) }, onIce.toString())
await sleep(1800)
const restored = await props()
// Reset returns each prop to the rest pose it settled into from its authored spot at load
// (a prop authored on the sloping shore leans there too, both times).
const atLoad = new Map(before.map((p) => [p.name, p]))
const drift = restored.map((p) => { const b = atLoad.get(p.name); return { name: p.name, d: Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z), tilt: Math.abs(p.up - b.up) } })
assert(reset === 15 && drift.every((p) => p.d < 0.02 && p.tilt < 0.01), `reset puts all ${reset} props back in their authored rest pose (worst ${Math.max(...drift.map((p) => p.d)).toFixed(3)} m, tilt ${Math.max(...drift.map((p) => p.tilt)).toFixed(3)})`, results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
