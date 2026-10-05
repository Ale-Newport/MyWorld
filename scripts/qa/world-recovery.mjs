/* /world local recovery: off the west, south and east coasts the car comes back
   near where it went in — on its own recent trail, upright, still, facing
   inland — never the far-west field and not the plaza; a second incident at the
   same edge steps further back; past the edge of the world (the void) too; R
   and the overturned-car fallback use the same recovery; jumps (a tap, or SPACE
   held for 3 s) never count as incidents.
   QA_BASE=http://localhost:3404 node scripts/qa/world-recovery.mjs */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = watch(page)
await openPlayer(page)
await sleep(1500)
await page.locator('#world').focus()
await page.evaluate(() => {
  const d = globalThis.__archipelago.driving
  window.__recoveries = []
  d.events.on('recovered', (reason, pose) => window.__recoveries.push({ reason, x: pose.position.x, z: pose.position.z, source: pose.source, at: window.__incident }))
  const recover = d.recover.bind(d)
  d.recover = (reason) => { const p = d.vehicle.position; window.__incident = { reason, x: p.x, y: p.y, z: p.z }; return recover(reason) }
})
const PLAZA = [-16.05, 42.76], LEGACY = [-118.55, -31.36]
const recoveries = () => page.evaluate(() => window.__recoveries.length)
const state = () => page.evaluate(() => { const d = globalThis.__archipelago.driving, v = d.vehicle, lv = v.chassis.physical.body.linvel(), p = v.position, s = d.placement.surface(p.x, p.z); return { x: p.x, y: p.y, z: p.z, up: v.upward.y, speed: Math.hypot(lv.x, lv.y, lv.z), contacts: v.wheels.inContactCount, wet: d.water.wetness, dry: !!s && !s.wet && s.ground, crumbs: d.recovery.crumbs.length, heading: d.flatHeading() } })
/** A validated start on land facing the sea (travel clears the trail, as a teleport does). */
const start = (x, z, heading) => page.evaluate(([x, z, heading]) => { const d = globalThis.__archipelago.driving, c = d.placement.near(x, z, { radius: 6, step: 1, headings: [heading], dynamicMargin: 1 }); d.place(c, { reason: 'travel' }); return [c.x, c.z] }, [x, z, heading])
/** Drives forward until the tyres are in the sea; returns where the car left the land. */
const driveToSea = async () => {
  await page.keyboard.down('KeyW')
  let exit = null
  for (let i = 0; i < 120; i++) { await sleep(50); const s = await state(); if (s.dry) exit = s; if (s.wet > 0.05) break }
  await page.keyboard.up('KeyW')
  return exit
}
/** Off the edge: the car carried on `metres` past where it left the land, out where the beach has fallen away into deep water, and sinks there. */
const offTheEdge = (exit, metres) => page.evaluate(([exit, metres]) => { const d = globalThis.__archipelago.driving, v = d.vehicle, h = d.flatHeading(), x = exit.x + Math.cos(h) * metres, z = exit.z - Math.sin(h) * metres; v.moveTo({ x, y: d.placement.water(x, z) - .4, z }, h); return [x, z] }, [exit, metres])
const waitRecovery = async (count, ms = 9000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await recoveries()) > count) return page.evaluate(() => window.__recoveries.at(-1)); await sleep(100) } return null }

const coasts = [['west', -104, 0, Math.PI], ['south', -110, 110, -Math.PI / 2], ['east', 88, 20, 0]]
for (const [name, x, z, heading] of coasts) {
  await start(x, z, heading)
  await sleep(700)
  const exit = await driveToSea(), crumbs = (await state()).crumbs
  assert(!!exit && (await state()).wet > 0.05, `${name}: drove from land into the sea (left the land at ${exit?.x.toFixed(1)}, ${exit?.z.toFixed(1)})`, results)
  if (!exit) continue
  const before = await recoveries()
  await offTheEdge(exit, 22)
  const rec = await waitRecovery(before)
  await sleep(600)
  const after = await state()
  assert(!!rec, `${name}: going off the coast is an incident and the car is recovered (${rec?.at?.reason})`, results)
  if (!rec) continue
  const fromIncident = Math.hypot(rec.x - rec.at.x, rec.z - rec.at.z), fromExit = exit ? Math.hypot(rec.x - exit.x, rec.z - exit.z) : NaN
  assert(fromIncident < 40 && fromExit < 20, `${name}: lands near the incident (${fromIncident.toFixed(1)} m from it, ${fromExit.toFixed(1)} m from where it left the land; ${rec.source}, ${crumbs} crumbs)`, results)
  assert(Math.hypot(rec.x - PLAZA[0], rec.z - PLAZA[1]) > 40 && Math.hypot(rec.x - LEGACY[0], rec.z - LEGACY[1]) > 20, `${name}: neither the plaza nor the old far-west spawn`, results)
  assert(after.up > 0.99 && after.speed < 0.3 && after.contacts === 4 && after.dry, `${name}: upright, still, on four wheels on dry ground (up ${after.up.toFixed(3)}, ${after.speed.toFixed(2)} m/s)`, results)
  const inland = Math.cos(after.heading - heading)
  assert(inland < 0.5, `${name}: not facing straight back into the sea (cos ${inland.toFixed(2)})`, results)
  const settled = await recoveries()
  await sleep(3000)
  assert((await recoveries()) === settled, `${name}: no second incident after recovering`, results)
  await page.screenshot({ path: out(`recovery-${name}.png`) })
}

/* ---- the same edge again, right away: one step further back ---- */
{
  await start(-104, 0, Math.PI)
  await sleep(700)
  const exit = await driveToSea()
  let count = await recoveries()
  await offTheEdge(exit, 22)
  const first = await waitRecovery(count)
  await sleep(500)
  count = await recoveries()
  await page.evaluate(([x, z]) => { const d = globalThis.__archipelago.driving; d.vehicle.moveTo({ x, y: d.placement.water(x, z) - .4, z }, Math.PI) }, [first.at.x, first.at.z])
  const second = await waitRecovery(count)
  const moved = second && Math.hypot(second.x - first.x, second.z - first.z), back = second && Math.hypot(second.x - second.at.x, second.z - second.at.z), firstBack = Math.hypot(first.x - first.at.x, first.z - first.at.z)
  assert(!!second && moved > 3.5 && back > firstBack, `a repeat incident at the same edge steps further back (${firstBack.toFixed(1)} → ${back?.toFixed(1)} m from the incident; ${second?.source})`, results)
  assert(!!second && back < 60, `and still nearby (${back?.toFixed(1)} m)`, results)
}

/* ---- past the edge of the world (the sea floor ends ~45 m out): the void — on the east coast, away from the repeats above ---- */
{
  await start(88, 20, 0)
  await sleep(700)
  await driveToSea()
  const count = await recoveries()
  await page.evaluate(() => { const d = globalThis.__archipelago.driving; d.vehicle.moveTo({ x: 158, y: -1.5, z: 20 }, 0) })
  const rec = await waitRecovery(count, 4000)
  assert(rec?.at?.reason === 'void' && Math.hypot(rec.x - rec.at.x, rec.z - rec.at.z) < 65 && rec.x > 80, `beyond the sea floor is the void: recovered on the same coast (${rec?.at?.reason}, ${rec && Math.hypot(rec.x - rec.at.x, rec.z - rec.at.z).toFixed(1)} m)`, results)
}

/* ---- R: the same local recovery ---- */
{
  await start(-104, 0, Math.PI)
  await sleep(700)
  await driveToSea()
  await sleep(300)
  const wet = await state(), count = await recoveries()
  await page.keyboard.press('KeyR')
  const rec = await waitRecovery(count, 2000)
  await sleep(500)
  const after = await state()
  assert(wet.wet > 0.05 && rec?.reason === 'manual' && after.dry && Math.hypot(rec.x - wet.x, rec.z - wet.z) < 40 && Math.hypot(rec.x - PLAZA[0], rec.z - PLAZA[1]) > 40, `R in the shallows recovers nearby on dry ground (${rec?.source}, ${rec && Math.hypot(rec.x - wet.x, rec.z - wet.z).toFixed(1)} m)`, results)
  // On open ground, R just sets the car back on its wheels where it is.
  // On its roof: rolled half a turn about its own length.
  await page.evaluate(() => { const T = globalThis.__archipelago.THREE, d = globalThis.__archipelago.driving, v = d.vehicle, b = v.chassis.physical.body, p = v.position, q = v.quaternion.clone().multiply(new T.Quaternion().setFromAxisAngle(new T.Vector3(1, 0, 0), Math.PI)); b.setTranslation({ x: p.x, y: p.y + .6, z: p.z }, true); b.setRotation(q, true); b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true) })
  await sleep(900)
  const flipped = await state(), n = await recoveries()
  await page.keyboard.press('KeyR')
  const righted = await waitRecovery(n, 2000)
  await sleep(500)
  const upright = await state()
  assert(flipped.up < 0 && righted?.source === 'in place' && upright.up > 0.99 && Math.hypot(upright.x - flipped.x, upright.z - flipped.z) < 1.5, `R on its roof on open ground: back on its wheels where it lay (${righted?.source}, up ${flipped.up.toFixed(2)} → ${upright.up.toFixed(3)})`, results)
  // A hazard's respawn (World2's altar, Player.die) is not R: the car is taken away from the spot, not set back on it.
  await sleep(1500)
  const here = await state(), m = await recoveries()
  await page.evaluate(() => globalThis.__archipelago.driving.player.respawn())
  const away = await waitRecovery(m, 2000)
  assert(away?.reason === 'respawn' && away.source !== 'in place' && Math.hypot(away.x - here.x, away.z - here.z) >= 5, `a hazard's respawn moves the car off the spot (${away?.source}, ${away && Math.hypot(away.x - here.x, away.z - here.z).toFixed(1)} m)`, results)
}

/* ---- the overturned fallback in the water recovers nearby instead of righting in place ---- */
{
  await start(-104, 0, Math.PI)
  await sleep(700)
  await driveToSea()
  await page.evaluate(() => { const A = globalThis.__archipelago, d = A.driving, v = d.vehicle, b = v.chassis.physical.body, p = v.position; b.setTranslation({ x: p.x - 4, y: p.y + .8, z: p.z }, true); b.setRotation(new A.THREE.Quaternion().setFromAxisAngle(new A.THREE.Vector3(1, 0, 0), Math.PI), true) })
  await sleep(800)
  const count = await recoveries()
  await page.evaluate(() => globalThis.__archipelago.driving.player.rightItself())
  const rec = await waitRecovery(count, 2000)
  await sleep(500)
  const after = await state()
  assert(rec?.reason === 'overturned' && after.dry && after.up > 0.99, `an overturned car that cannot be righted where it lies (in the sea) is recovered nearby (${rec?.reason}, ${rec?.source})`, results)
}

/* ---- a NaN physics state: recovered where the car last stood, sane again ---- */
{
  await start(-60, 62, Math.PI / 2)
  await sleep(700)
  await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW')
  const before = await state(), count = await recoveries()
  await page.evaluate(() => globalThis.__archipelago.driving.vehicle.chassis.physical.body.setLinvel({ x: NaN, y: 0, z: 0 }, true))
  const rec = await waitRecovery(count, 2000)
  await sleep(800)
  const after = await state()
  assert(rec?.reason === 'invalid' && Number.isFinite(after.x + after.y + after.z) && after.up > 0.99 && after.speed < 0.3 && Math.hypot(after.x - before.x, after.z - before.z) < 40, `a NaN physics state is an incident: the car is put back, finite and upright, near where it was (${rec?.source}, ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m)`, results)
}

/* ---- jumps are not incidents ---- */
{
  await start(-60, 62, Math.PI)
  await sleep(1200)
  const count = await recoveries()
  await page.keyboard.press('Space')
  await sleep(1800)
  await page.keyboard.down('Space'); await sleep(3000); await page.keyboard.up('Space')
  await sleep(1500)
  assert((await recoveries()) === count, `a jump, and SPACE held for 3 s, are never incidents (${(await recoveries()) - count})`, results)
}
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
console.log('recoveries', JSON.stringify(await page.evaluate(() => window.__recoveries.map((r) => ({ reason: r.reason, source: r.source, at: [+r.at.x.toFixed(1), +r.at.z.toFixed(1)], to: [+r.x.toFixed(1), +r.z.toFixed(1)] })))))
await browser.close()
finish(results)
