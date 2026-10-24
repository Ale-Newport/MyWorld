/* Does opening and closing an activity leak? Scene nodes, geometries, textures, programs and the JS heap after each of N cycles of the Projects board (open, switch project, close).

     QA_BASE=http://localhost:3210 node scripts/qa/world-frame-cycles.mjs [--cycles 40] [--activity projects|cookies] [--size 1440x900] [--out DIR]

   A first cycle builds what the activity builds lazily (the board's kit: its screens, glyph and paint textures, the cinematic's own camera targets): that is a step, once. A leak is a slope: the
   run is split in halves after a warm-up of WARM cycles, and the second half may not grow by more than a handful of nodes or geometries (a slope of zero is the pass; anything that adds an object
   to the scene on every cycle adds `cycles` objects). Prints the series. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE, sleep, assert, finish, watch } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const CYCLES = Number(arg('cycles', 40)), ACTIVITY = arg('activity', 'projects'), [W, H] = arg('size', '1440x900').split('x').map(Number), WARM = 5
const OUT = path.resolve(arg('out', '.qa/runs/cycles'))
fs.mkdirSync(OUT, { recursive: true })
const results = []
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 })).newPage()
const errors = watch(page)
await page.goto(`${BASE}/archipelago/preview/index.html?qa`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(3000)

const label = { projects: 'Projects', cookies: 'Take a cookie' }[ACTIVITY]
const approach = () => page.evaluate((label) => {
  const g = __archipelago.gameplay; let p
  for (const i of g.instances) for (const item of i.prompts.items) if (item.label === label) { const q = item.group.getWorldPosition(new __archipelago.THREE.Vector3()); p = { x: q.x, z: q.z } }
  if (!p) return false
  const d = __archipelago.driving
  for (const [radius, margin] of [[2.3, .3], [2.9, .3], [3.5, .1]]) { const pose = d.placement.near(p.x, p.z, { radius, step: .5, margin, dynamicMargin: .2, maxEdge: 4 }); if (pose) { d.place(pose, { reason: 'travel' }); return true } }
  return false
}, label)
const census = () => page.evaluate(() => {
  const A = __archipelago, info = A.renderer.info; let nodes = 0, meshes = 0; A.scene.traverse((o) => { nodes++; if (o.isMesh) meshes++ })
  return { nodes, meshes, geometries: info.memory.geometries, textures: info.memory.textures, programs: info.programs?.length ?? 0, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e5) / 10 : null }
})
assert(await approach(), `${ACTIVITY}: the car reaches the prompt`, results)
await sleep(1500)
const series = [await census()]
for (let k = 0; k < CYCLES; k++) {
  await page.evaluate(() => { const g = __archipelago.gameplay; g.interact() }); await sleep(2200)
  if (ACTIVITY === 'projects') { await page.evaluate(() => __archipelago.gameplay.active()?.parts.projects?.step(1)); await sleep(1200) }
  await page.evaluate(() => __archipelago.gameplay.active()?.exit()); await sleep(1800)
  series.push(await census())
}
const col = (key) => series.map((s) => s[key])
for (const key of ['nodes', 'meshes', 'geometries', 'textures', 'programs', 'heap']) if (series[0][key] !== null) console.log(key.padEnd(10), col(key).join(' '))
const growth = (key) => { const v = col(key), mid = WARM + Math.floor((v.length - 1 - WARM) / 2); return { first: v[WARM] - v[0], second: v.at(-1) - v[mid], total: v.at(-1) - v[0] } }
for (const key of ['nodes', 'meshes', 'geometries', 'textures', 'programs']) {
  const g = growth(key)
  console.log(`  ${key}: ${g.first >= 0 ? '+' : ''}${g.first} in the first ${WARM} cycles, ${g.second >= 0 ? '+' : ''}${g.second} over the second half (${CYCLES - WARM - Math.floor((CYCLES - WARM) / 2)} cycles), ${g.total >= 0 ? '+' : ''}${g.total} in all`)
  assert(g.second <= 3, `${ACTIVITY}: ${key} stop growing after the first cycles (${g.second} more over the second half of ${CYCLES} cycles)`, results)
}
assert(errors.length === 0, `no console errors ${errors.slice(0, 2).join(' | ')}`, results)
fs.writeFileSync(path.join(OUT, `cycles-${ACTIVITY}.json`), JSON.stringify({ base: BASE, cycles: CYCLES, series }, null, 1))
await browser.close()
finish(results)
