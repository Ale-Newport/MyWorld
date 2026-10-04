/* /world plane: banks into turns, propeller turns about the flight axis
   around its hub, hands over to a blur disc, and is frame-rate independent. */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = watch(page)
await openPlayer(page)
await sleep(1200)
await page.keyboard.press('Space'); await sleep(110); await page.keyboard.press('Space')
await page.waitForFunction(() => globalThis.__archipelago.driving.mode === 'PLANE')
await sleep(2600)

const sample = () => page.evaluate(() => {
  const A = globalThis.__archipelago, T = A.THREE, d = A.driving, g = d.plane.group
  g.updateMatrixWorld(true)
  const q = g.getWorldQuaternion(new T.Quaternion())
  const right = new T.Vector3(0, 0, 1).applyQuaternion(q), fwd = new T.Vector3(1, 0, 0).applyQuaternion(q)
  const rig = d.plane.rig
  let axisDot = null, hubDrift = null
  if (rig) {
    const wq = rig.pivot.getWorldQuaternion(new T.Quaternion())
    axisDot = rig.axis.clone().applyQuaternion(wq).normalize().dot(fwd)
    // The hub must not move when the propeller turns: compare pivot origin with itself one rotation later.
    const before = rig.pivot.getWorldPosition(new T.Vector3())
    rig.pivot.quaternion.setFromAxisAngle(rig.axis, 1.3); rig.pivot.updateMatrixWorld(true)
    hubDrift = before.distanceTo(rig.pivot.getWorldPosition(new T.Vector3()))
  }
  return { heading: d.modes.heading, roll: d.modes.roll, turn: d.modes.turn, rightWingY: right.y, axisDot, hubDrift, spin: d.plane.spin, blur: rig?.disc.material.opacity ?? null, bladesVisible: rig?.blades.some((b) => b.visible), propName: d.plane.propeller?.name }
})

const level = await sample()
assert(level.propName === 'Propeller pivot', `propeller found and re-hung on a hub pivot (${level.propName})`, results)
assert(level.axisDot !== null && Math.abs(level.axisDot) > 0.999, `propeller axis is the flight axis (|dot| = ${level.axisDot?.toFixed(4)})`, results)
assert(level.hubDrift !== null && level.hubDrift < 1e-4, `rotating the pivot leaves the hub in place (drift ${level.hubDrift?.toExponential(1)} m)`, results)
assert(level.spin > 20, `propeller at cruise revs (${level.spin.toFixed(1)} rev/s)`, results)
assert(level.blur > 0.95 && !level.bladesVisible, `blur disc stands in for the blades at speed (opacity ${level.blur?.toFixed(2)})`, results)

await page.keyboard.down('KeyD'); await sleep(1300)
const right = await sample()
await page.screenshot({ path: out('plane-right-turn.png') })
const overheadRight = await page.evaluate(() => {
  const A = globalThis.__archipelago, T = A.THREE, d = A.driving, p = d.vehicle.position
  const cam = new T.OrthographicCamera(-9, 9, 6, -6, 0.1, 400); cam.up.set(0, 0, -1); cam.position.set(p.x, p.y + 60, p.z); cam.lookAt(p.x, p.y, p.z)
  const r = A.renderer
  r.render(A.scene, cam)
  return r.domElement.toDataURL('image/png')
})
await page.keyboard.up('KeyD')
await page.keyboard.down('KeyA'); await sleep(1700)
const left = await sample()
await page.screenshot({ path: out('plane-left-turn.png') })
await page.keyboard.up('KeyA'); await sleep(2200)
const released = await sample()

assert(right.turn > 0.9 && right.rightWingY < -0.3, `right turn drops the right wing (turn ${right.turn.toFixed(2)}, right wing y ${right.rightWingY.toFixed(2)})`, results)
assert(left.turn < -0.9 && left.rightWingY > 0.3, `left turn drops the left wing (turn ${left.turn.toFixed(2)}, right wing y ${left.rightWingY.toFixed(2)})`, results)
assert(Math.abs(right.roll) <= 0.481 && Math.abs(left.roll) <= 0.481, `bank is limited to 27.5° (${(right.roll * 57.3).toFixed(1)}°, ${(left.roll * 57.3).toFixed(1)}°)`, results)
assert(Math.abs(released.roll) < 0.02 && Math.abs(released.rightWingY) < 0.02, `wings come back level when the turn input stops (roll ${released.roll.toFixed(3)})`, results)

// Frame-rate independence: drive the visual alone at 30, 60 and 144 Hz for one simulated second at fixed power.
const rates = await page.evaluate(() => {
  const d = globalThis.__archipelago.driving, p = d.plane
  // Spool from 8 to ~30 rev/s: exercises the damped revs and the integration together.
  const run = (hz) => { p.spin = 8; p.revolutions = 0; for (let i = 0; i < hz; i++) p.update(1 / hz, 1, true, 30 / 38); return p.revolutions }
  return [30, 60, 144].map(run)
})
const spread = Math.max(...rates) / Math.min(...rates)
assert(spread < 1.03, `same propeller travel per second at 30/60/144 Hz (${rates.map((r) => r.toFixed(2)).join(' / ')} rev)`, results)

const fs = await import('node:fs')
fs.writeFileSync(out('plane-right-turn-overhead.png'), Buffer.from(overheadRight.split(',')[1], 'base64'))
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 3).join(' | ')})`, results)
await browser.close()
finish(results)
