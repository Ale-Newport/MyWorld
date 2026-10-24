/* /world per-frame cost at five spots, measured with the runtime's own probe (runtime/perf-probe.js, ?qa&perf).

     QA_BASE=http://127.0.0.1:3281 node scripts/qa/world-perf-probe.mjs --label base
     QA_BASE=http://localhost:3210  node scripts/qa/world-perf-probe.mjs --label after --query "&shadow=legacy"

   Options  --label NAME  --spots plaza,ferris,circuit,projects,beach  --size 1440x900  --dpr 1.5  --touch  --cpu 1|4|6
            --drive 10 (seconds driving)  --park 10 (seconds parked)  --out DIR (default .qa/runs/impl/frame)  --query "&x=y"  --no-shots

   Per spot: the car is placed with the same call the map's travel uses, the camera settles, a screenshot is taken, then
   `park` seconds without input and `drive` seconds holding W with a gentle weave. For each: frame ms p50/p95/p99, CPU
   per phase, GPU ms (main / shadow), the shadow pass on its own (draw calls, triangles, CPU), per-subscriber p95, hitches.
   Also __perf.passes() (main vs shadow by A/B, updateMatrixWorld ms) and __perf.census() once per spot.
   Writes <out>/perf-<label>.json and <out>/shots/<label>-<spot>.png; prints a compact table. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, BASE, sleep } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const flag = (name) => process.argv.includes('--' + name)
const LABEL = arg('label', 'run'), OUT = path.resolve(arg('out', '.qa/runs/impl/frame'))
const [W, H] = arg('size', '1440x900').split('x').map(Number), DPR = Number(arg('dpr', 1.5)), CPU = Number(arg('cpu', 1))
const DRIVE = Number(arg('drive', 10)), PARK = Number(arg('park', 10)), QUERY = arg('query', ''), TOUCH = flag('touch'), SHOTS = !flag('no-shots')
import { SPOTS } from './world-spots.mjs'
const wanted = arg('spots', Object.keys(SPOTS).join(',')).split(',')

const browser = await launch()
const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, ...(TOUCH ? { hasTouch: true, isMobile: true } : {}) })
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })
const cdp = await context.newCDPSession(page)
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
await page.goto(`${BASE}/archipelago/preview/index.html?qa&perf${QUERY}`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(2500)
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })

const result = { label: LABEL, base: BASE, query: QUERY, size: [W, H], dpr: DPR, cpu: CPU, touch: TOUCH, loadavg: os.loadavg(), spots: {}, errors }
const slim = (r) => ({
  frameMs: r.frameMs, cpuFrameMs: r.cpuFrameMs, gpu: r.gpu, phases: r.phases, shadow: r.shadow, subscribers: r.subscribers.slice(0, 6), hitches: r.hitches, longTasks: r.longTasks.slice(-10), info: r.info, quality: r.quality, pixelRatio: r.pixelRatio, tier: r.tier,
})
for (const name of wanted) {
  const spot = SPOTS[name]
  if (spot) {
    const placed = await page.evaluate((spot) => {
      const d = globalThis.__archipelago.driving, arrival = d.arrival({ group: null, x: spot.x, z: spot.z, name: spot.name })
      if (!arrival.ok) return { ok: false, reason: arrival.reason }
      d.place(arrival, { reason: 'travel' }); return { ok: true, at: d.vehicle.position.toArray().map((v) => +v.toFixed(1)) }
    }, spot)
    if (!placed.ok) { console.log(name, 'arrival refused', placed.reason); continue }
  }
  await sleep(2500)
  if (SHOTS) { await page.screenshot({ path: path.join(OUT, 'shots', `${LABEL}-${name}.png`) }); await sleep(2000) } // the screenshot itself stalls the next frame: keep it out of the window
  const entry = (result.spots[name] = {})
  entry.at = await page.evaluate(() => globalThis.__archipelago.driving.vehicle.position.toArray().map((v) => +v.toFixed(1)))
  await page.evaluate(() => __perf.reset())
  await sleep(PARK * 1000)
  entry.parked = slim(await page.evaluate(() => __perf.report()))
  entry.passes = await page.evaluate(() => __perf.passes())
  entry.census = await page.evaluate(() => { const c = __perf.census({ top: 8 }); return c })
  await page.evaluate(() => __perf.reset())
  await page.keyboard.down('KeyW')
  const t0 = Date.now()
  while (Date.now() - t0 < DRIVE * 1000) {
    const phase = Math.floor((Date.now() - t0) / 1500) % 4
    await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD')
    if (phase === 1) await page.keyboard.down('KeyA'); else if (phase === 3) await page.keyboard.down('KeyD')
    await sleep(100)
  }
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); await page.keyboard.up('KeyD')
  entry.driving = slim(await page.evaluate(() => __perf.report()))
  const row = (r) => `p50 ${r.frameMs.p50.toFixed(1)} p95 ${r.frameMs.p95.toFixed(1)} p99 ${r.frameMs.p99.toFixed(1)} max ${r.frameMs.max.toFixed(0)} | cpu ${r.cpuFrameMs.p50.toFixed(1)} | gpu ${r.gpu?.mainMs ? (r.gpu.mainMs.p50 + r.gpu.shadowMs.p50).toFixed(2) : 'n/a'} (shadow ${r.gpu?.shadowMs ? r.gpu.shadowMs.p50.toFixed(2) : 'n/a'}) | shadow passes ${(r.shadow.framesWithPass * 100).toFixed(0)}% ${r.shadow.calls.p50} calls ${(r.shadow.triangles.p50 / 1e3).toFixed(0)}k tris | info ${r.info.calls} calls ${(r.info.triangles / 1e3).toFixed(0)}k tris`
  console.log(`\n== ${name} at ${entry.at}\n  parked  ${row(entry.parked)}\n  driving ${row(entry.driving)}\n  passes  main ${entry.passes.main.calls} calls ${(entry.passes.main.triangles / 1e3).toFixed(0)}k tris ${entry.passes.main.cpuMs} ms | shadow ${entry.passes.shadow.calls} calls ${(entry.passes.shadow.triangles / 1e3).toFixed(0)}k tris ${entry.passes.shadow.cpuMs} ms | updateMatrixWorld ${entry.passes.updateMatrixWorldMs} ms\n  census  nodes ${entry.census.nodes} meshes ${entry.census.meshes} visible ${entry.census.visibleMeshes} autoMatrix ${entry.census.matrixAutoUpdate.total} (hidden ${entry.census.matrixAutoUpdate.underHidden}) casters ${entry.census.casters} programs ${entry.census.info.programs}`)
}
result.errors = errors
fs.writeFileSync(path.join(OUT, `perf-${LABEL}.json`), JSON.stringify(result, null, 1))
console.log(`\nwrote ${path.join(OUT, `perf-${LABEL}.json`)}${errors.length ? '\nerrors: ' + errors.join('\n  ') : '\nno console errors'}`)
await browser.close()
