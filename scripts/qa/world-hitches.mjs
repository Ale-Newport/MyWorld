/* The first time something is used must not freeze the frame: the first explosion (a TNT crate), the first press of M, and a plain drive across the island for comparison.
   A recorder in the page logs every animation frame longer than 40 ms with how many shader programs, geometries and textures the renderer gained during it.

     QA_BASE=http://127.0.0.1:3282 node scripts/qa/world-hitches.mjs --label after [--cpu 4] [--size 1440x900] [--dpr 1.5] [--wait 12]
   --wait: seconds between ready and the first test (the idle warm-ups run in that time); the first-use cost is only what is left. Writes hitches-<label>.json. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE, sleep } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const LABEL = arg('label', 'run'), CPU = Number(arg('cpu', 1)), WAIT = Number(arg('wait', 12)), OUT = path.resolve(arg('out', '.qa/runs/impl/frame'))
const [W, H] = arg('size', '1440x900').split('x').map(Number), DPR = Number(arg('dpr', 1.5))
const browser = await launch()
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
const cdp = await context.newCDPSession(page)
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
await page.addInitScript(() => {
  const log = (window.__frames = { list: [], on: false, last: 0, mark: 0 })
  const loop = (now) => {
    requestAnimationFrame(loop)
    const A = window.__archipelago, info = A?.renderer?.info
    if (log.on && log.last) {
      const dt = now - log.last
      if (dt > 40) log.list.push({ at: Math.round(now - log.mark), dt: +dt.toFixed(0), programsNow: info?.programs?.length, geometries: info?.memory.geometries, textures: info?.memory.textures })
      log.max = Math.max(log.max ?? 0, dt)
    }
    log.last = now
  }
  requestAnimationFrame(loop)
})
await page.goto(`${BASE}/archipelago/preview/index.html?qa`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(WAIT * 1000)
const record = async (name, action, seconds = 3) => {
  await page.evaluate(() => { const f = window.__frames; f.list = []; f.max = 0; f.on = true; f.mark = performance.now(); f.programs0 = __archipelago.renderer.info.programs.length })
  await action()
  await sleep(seconds * 1000)
  const r = await page.evaluate(() => { const f = window.__frames; f.on = false; return { worst: f.max, list: f.list, programsGained: __archipelago.renderer.info.programs.length - f.programs0 } })
  console.log(`${name.padEnd(22)} worst frame ${String(Math.round(r.worst)).padStart(4)} ms   frames > 40 ms: ${r.list.length}   programs gained ${r.programsGained}   ${r.list.slice(0, 4).map((x) => `${x.dt}ms@${x.at}`).join(' ')}`)
  return { name, ...r }
}
const results = []
// 1. the first explosion: put the car beside the first crate and light it
const crate = await page.evaluate(() => {
  const A = __archipelago, i = A.gameplay.instances.find((x) => x.parts?.crates?.items?.length)
  if (!i) return null
  const c = i.parts.crates.items[0], p = c.node.getWorldPosition(new A.THREE.Vector3()), d = A.driving
  const pose = d.placement.near(p.x + 10, p.z + 10, { radius: 10, step: 1, margin: .6, dynamicMargin: 1, maxEdge: 4 })
  if (pose) d.place(pose, { reason: 'travel' })
  return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), placed: !!pose }
})
console.log('crate', JSON.stringify(crate))
await sleep(2500)
results.push(await record('first explosion', () => page.evaluate(() => { const i = __archipelago.gameplay.instances.find((x) => x.parts?.crates?.items?.length); i.parts.crates.light(i.parts.crates.items[0]) }), 4))
// 2. the first M: dialog open, the photograph under way
results.push(await record('first M (map)', async () => { await page.keyboard.press('KeyM') }, 4))
await page.keyboard.press('KeyM'); await sleep(800)
results.push(await record('second M (reopen)', async () => { await page.keyboard.press('KeyM') }, 3))
await page.keyboard.press('KeyM'); await sleep(800)
// 3. a second explosion for comparison
results.push(await record('second explosion', () => page.evaluate(() => { const i = __archipelago.gameplay.instances.find((x) => x.parts?.crates?.items?.length); const c = i.parts.crates.items[1] ?? i.parts.crates.items[0]; i.parts.crates.light(c) }), 3))
// a chain: every crate of the island, a fuse apart
results.push(await record('chain: all crates', () => page.evaluate(() => { let k = 0; for (const i of __archipelago.gameplay.instances) for (const c of i.parts?.crates?.items ?? []) setTimeout(() => i.parts.crates.light(c), 120 * k++); return k }), 6))
// 4. first sight of each place (geometry and texture uploads), the plane, the Projects board, a quality level change
import { SPOTS } from './world-spots.mjs'
for (const [name, spot] of Object.entries(SPOTS)) {
  if (!spot) continue
  results.push(await record('teleport: ' + name, () => page.evaluate((s) => { const d = __archipelago.driving, a = d.arrival({ group: null, x: s.x, z: s.z, name: s.name }); d.place(a, { reason: 'travel' }) }, spot), 3))
}
results.push(await record('plane: on and off', async () => { await page.keyboard.press('Space'); await sleep(250); await page.keyboard.press('Space'); await sleep(2500); await page.keyboard.down('KeyW'); await sleep(1500); await page.keyboard.up('KeyW'); await page.keyboard.press('Space'); await page.keyboard.press('Space') }, 3))
results.push(await record('projects board: open', async () => {
  const p = await page.evaluate(() => { for (const i of __archipelago.gameplay.instances) for (const item of i.prompts.items) if (item.label === 'Projects') { const w = item.group.getWorldPosition(new __archipelago.THREE.Vector3()); return { x: w.x, z: w.z } } return null })
  if (p) { await page.evaluate((p) => { const d = __archipelago.driving, a = d.arrival({ group: null, x: p.x + 3, z: p.z + 3, name: 'p' }); d.place(a, { reason: 'travel' }) }, p); await sleep(1500); await page.evaluate(() => __archipelago.gameplay.interact()); await sleep(2500); await page.evaluate(() => __archipelago.gameplay.active()?.exit()) }
}, 2))
results.push(await record('quality level 0 to 1 to 0', async () => { await page.evaluate(() => { const q = __archipelago.quality; q.level = 1; q.apply() }); await sleep(1500); await page.evaluate(() => { const q = __archipelago.quality; q.level = 0; q.apply() }) }, 2))
fs.writeFileSync(path.join(OUT, `hitches-${LABEL}.json`), JSON.stringify({ label: LABEL, base: BASE, cpu: CPU, size: [W, H], dpr: DPR, wait: WAIT, results, errors }, null, 1))
console.log(errors.length ? 'errors: ' + errors.join(' | ') : 'no errors')
await browser.close()
