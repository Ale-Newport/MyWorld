/* Do the two things that skip work still show everything that moves? Exercises every activity in the player (crates, bowling, projects, cookies, the race, the title letters,
   career, social, achievements, the plane, the time machine, the lab) with
     - the freeze (runtime/freeze.js): nodes that were frozen and then written. Its own audit frees them; any freed node is a mover the freeze list missed.
       __perf.verifyFrozen() lists frozen nodes whose position / quaternion / scale no longer match their matrix at the end.
     - the shadow (runtime/shadow-rig.js): __perf.verifyShadow() compares every visible caster near the box with its pose when the shadow map was last drawn, every frame,
       and names the casters that moved while no redraw followed (a stale shadow).
     - the matrices: __perf.verifyMatrices() recomputes every visible node's world matrix from the nodes' own position / quaternion / scale and compares it with what three drew with,
       every second frame: a node the freeze or the cut walk (runtime/freeze.js) left standing still, or at the origin, is named (a stale matrix).

     QA_BASE=http://127.0.0.1:3282 node scripts/qa/world-frame-guards.mjs [--query "&freeze=off"]
   Exit 1 on any freed node, any frozen mismatch, any stale matrix, or a caster stale for more than two frames in a row (one frame of lag as something starts to move is by design). */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE, sleep } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/impl/frame'))
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await page.goto(`${BASE}/archipelago/preview/index.html?qa&perf${arg('query', '')}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(3000)
await page.evaluate(() => { __perf.verifyShadow({ start: true }); __perf.verifyMatrices({ start: true, every: 2, freezer: __archipelago.freezer }) })
const log = [], T0 = Date.now()
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not answer in ${ms / 1000} s`)), ms))])
const step = async (name, fn, seconds = 2.5) => { const t = Date.now(); let r; try { r = await within(fn(), 40_000, name) } catch (e) { console.log('STEP FAILED', e.message, 'page alive:', await within(page.evaluate(() => performance.now()), 5000, 'ping').then(() => true, () => false)); throw e } await sleep(seconds * 1000); log.push({ name, ms: Date.now() - t, ...(r ?? {}) }); console.log(`${((Date.now() - T0) / 1000).toFixed(0).padStart(4)}s`, name.padEnd(34), JSON.stringify(r ?? {})) }
const goTo = (x, z) => page.evaluate(([x, z]) => { const d = __archipelago.driving, a = d.arrival({ group: null, x, z, name: 'p' }); if (!a.ok) return { ok: false, reason: a.reason }; d.place(a, { reason: 'travel' }); return { ok: true } }, [x, z])
const drive = async (seconds, keys = ['KeyW']) => { for (const k of keys) await page.keyboard.down(k); await sleep(seconds * 1000); for (const k of keys) await page.keyboard.up(k) }
const interact = () => page.evaluate(() => { const g = __archipelago.gameplay, i = g.instances.find((x) => x.prompts.activeLabel); return { label: i?.prompts.activeLabel ?? null, done: g.interact() } })
const prompt = (label) => page.evaluate((label) => { const g = __archipelago.gameplay; for (const i of g.instances) for (const item of i.prompts.items) if (item.label === label) { const p = item.group.getWorldPosition(new __archipelago.THREE.Vector3()); return { x: p.x, z: p.z } } return null }, label)
const approach = async (label, ring = 2.3) => {
  const p = await prompt(label); if (!p) return { found: false }
  const r = await page.evaluate(([p, ring]) => { const d = __archipelago.driving; for (const [radius, margin] of [[ring, .3], [ring + .6, .3], [ring + 1.2, .1]]) { const pose = d.placement.near(p.x, p.z, { radius, step: .5, margin, dynamicMargin: .2, maxEdge: 4 }); if (pose) { d.place(pose, { reason: 'travel' }); return { ok: true, away: +Math.hypot(pose.x - p.x, pose.z - p.z).toFixed(1) } } } return { ok: false } }, [p, ring])
  await sleep(1500); return { found: true, ...r }
}

await step('start: parked', async () => ({}), 3)
await step('drive across the plaza', async () => { await drive(4, ['KeyW', 'KeyA']); return {} }, .5)
await step('crates: light the first', async () => page.evaluate(() => { const i = __archipelago.gameplay.instances.find((x) => x.parts?.crates?.items?.length); const c = i.parts.crates.items[0], p = c.node.getWorldPosition(new __archipelago.THREE.Vector3()); const d = __archipelago.driving, pose = d.placement.near(p.x + 9, p.z + 9, { radius: 10, step: 1, margin: .6, dynamicMargin: 1, maxEdge: 4 }); if (pose) d.place(pose, { reason: 'travel' }); setTimeout(() => i.parts.crates.light(c), 1200); return { near: !!pose } }), 5)
await step('crates: chain, light all', async () => page.evaluate(() => { for (const i of __archipelago.gameplay.instances) i.parts?.crates?.items?.slice(0, 3).forEach((c, k) => setTimeout(() => i.parts.crates.light(c), 400 * k)); return {} }), 5)
await step('bowling: approach, reset pins', async () => { const a = await approach('Reset pins'); const r = await interact(); await drive(3); return { ...a, ...r } }, 3)
await step('projects: open the board', async () => { const a = await approach('Projects'); const r = await interact(); return { ...a, ...r } }, 4)
await step('projects: next project', async () => page.evaluate(() => { __archipelago.gameplay.active()?.parts.projects?.step(1); return {} }), 3)
await step('projects: close', async () => page.evaluate(() => { __archipelago.gameplay.active()?.exit(); return {} }), 3)
await step('cookies: take a cookie', async () => { const a = await approach('Take a cookie'); const r = await interact(); await sleep(500); const r2 = await interact(); return { ...a, ...r, again: r2.done } }, 4)
await step('race: start Catalunya', async () => { const a = await approach('Start race'); const r = await interact(); await drive(6, ['KeyW', 'KeyD']); return { ...a, ...r } }, 3)
await step('race: leave', async () => page.evaluate(() => { __archipelago.gameplay.active()?.exit(); return {} }), 2)
await step('title letters: drive through', async () => { const r = await goTo(-16, 61); await sleep(800); await drive(5); return r }, 3)
await step('career: walk the path', async () => { const r = await goTo(10.3, 10.8); await sleep(1500); await drive(4); return r }, 2)
await step('social: approach the signs', async () => { const a = await approach('Email +2', 2); await drive(2); return a }, 3)
await step('achievements: plaza', async () => { const r = await goTo(78.1, 117.4); await drive(4); return r }, 3)
await step('time machine / lab / jukebox', async () => { for (const [label, off] of [['Time machine', 3], ['Jukebox', 3], ['Give it a spin', 3]]) { await approach(label, off); await interact(); await sleep(1500) } return {} }, 2)
await step('plane: space twice, fly', async () => { await page.keyboard.press('Space'); await sleep(250); await page.keyboard.press('Space'); await sleep(1200); await drive(5, ['KeyW']); await page.keyboard.press('Space'); await page.keyboard.press('Space'); return {} }, 3)
await step('ferris wheel and the harbor', async () => { const r = await goTo(60.6, -35.9); await drive(3); return r }, 4)
// Every prompt of every place, however it is reached: its own action, one second apart (the ones the approaches above did not activate: Email, Reset pins, ...), the way out of
// whatever it opened after each, with the stale-matrix and stale-shadow checks running.
await step('every prompt: its action, one by one', async () => {
  const labels = await page.evaluate(() => { window.open = () => null; const out = []; for (const i of __archipelago.gameplay.instances) for (const item of i.prompts.items) out.push(item.label); return out })
  const done = []
  for (const label of labels) {
    const r = await page.evaluate((label) => {
      for (const i of __archipelago.gameplay.instances) for (const item of i.prompts.items) if (item.label === label && !item.destroyed) { try { i.prompts.interact(item); return true } catch (e) { return String(e).slice(0, 80) } }
      return false
    }, label)
    await sleep(900)
    // (a dialog or the map that the prompt opened stops the frame loop: it is closed again)
    await page.evaluate(() => { try { __archipelago.gameplay.active()?.exit() } catch { /* nothing open */ } for (const d of document.querySelectorAll('dialog[open]')) d.close(); if (__archipelago.atlas?.isOpen) __archipelago.atlas.toggle() })
    done.push(r === true ? label : label + ' (' + r + ')')
  }
  return { count: labels.length, labels: done.slice(0, 60) }
}, 2)
await step('park and wait', async () => ({}), 4)

const end = await page.evaluate(() => ({ freed: __archipelago.freezer?.freed ?? null, frozen: __archipelago.freezer?.nodes.length ?? null, mismatches: __perf.verifyFrozen(), shadow: __perf.verifyShadow({ stop: true }), matrices: __perf.verifyMatrices({ stop: true }), rig: __archipelago.shadow?.state(), freeze: __archipelago.freezer?.stats() }))
console.log('\nfrozen nodes', end.frozen, ' freed by the audit:', JSON.stringify(end.freed), ' mismatches:', JSON.stringify(end.mismatches.slice(0, 10)))
console.log('shadow rig', JSON.stringify(end.rig))
console.log('freeze', JSON.stringify(end.freeze))
console.log('stale matrices:', JSON.stringify(end.matrices.violations.slice(0, 15)), 'over', end.matrices.checks, 'checks, worst check', end.matrices.worstFrame, 'nodes')
console.log('stale shadow casters:', JSON.stringify(end.shadow.violations.filter((v) => v.maxRun > 1).slice(0, 15)), 'over', end.shadow.frames, 'frames,', end.shadow.casters, 'casters')
// The safety net itself: a frozen node written to, as a mover the keep list missed would be. The matrix check must see it (it is not drawn where it was put) and the audit must free it
// within a couple of seconds, after which it is drawn right.
const net = await (async () => {
  await page.evaluate(() => __perf.verifyMatrices({ stop: true }))
  await page.evaluate(() => __perf.verifyMatrices({ start: true, every: 2, freezer: __archipelago.freezer }))
  const picked = await page.evaluate(() => {
    const A = __archipelago, f = A.freezer, shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true }
    const n = f.nodes.find((o) => o.isMesh && o.parent && o.parent !== A.scene && shown(o) && f.frozen.has(o) && !o.userData.terrainChunk && o.children.length === 0)
    if (!n) return null
    window.__written = n; n.position.x += 0.5
    return { name: (n.name || n.type) + (n.parent?.name ? ' < ' + n.parent.name : ''), freedBefore: f.freed.length }
  })
  await sleep(3500)
  const after = await page.evaluate(() => {
    const A = __archipelago, n = window.__written, f = A.freezer; n.position.x -= 0.5
    return { freed: f.freed.length, free: n.matrixAutoUpdate, stats: f.stats() }
  })
  await sleep(500)
  const final = await page.evaluate(() => __perf.verifyMatrices({ stop: true }))
  return { picked, after, stale: final.violations.filter((v) => v.name.startsWith(picked?.name ?? '#')).map(({ name, checks, maxRun }) => ({ name, checks, maxRun })), others: final.violations.length }
})()
console.log('safety net:', JSON.stringify(net))
fs.writeFileSync(path.join(OUT, 'frame-guards.json'), JSON.stringify({ base: BASE, log, end, net, errors }, null, 1))
for (const v of end.shadow.violations.filter((v) => v.maxRun > 2)) console.log('  stale caster detail:', JSON.stringify(await page.evaluate((u) => { let r = null; __archipelago.scene.traverse((o) => { if (o.uuid.startsWith(u)) r = { type: o.type, geometry: o.geometry?.type, material: o.material?.name || o.material?.type, auto: o.matrixAutoUpdate, visible: o.visible, userData: Object.keys(o.userData), inRig: __archipelago.shadow.watched.includes(o), parent: o.parent?.name } }); return r }, v.sample?.uuid ?? '')))
const stale = end.shadow.violations.filter((v) => v.maxRun > 2)   // a mover's shadow lags by one frame when it starts to move: that is by design
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no console errors')
const staleMatrices = end.matrices.violations.filter((v) => v.maxRun > 1)
const netOk = !net.picked || (net.after.freed === net.picked.freedBefore + 1 && net.after.free && net.stale.length > 0 && net.stale[0].maxRun <= 60)
const ok = netOk && !(end.freed?.length) && !end.mismatches.length && !stale.length && !staleMatrices.length && !errors.length
console.log(ok ? 'PASS' : 'FAIL')
await browser.close()
if (!ok) process.exitCode = 1
