/* /world startup benchmark: the runtime opened on its own (standalone, no parent shell), cold HTTP cache per run.

     node scripts/qa/world-static-server.mjs --root <tree> --port 3262 &
     QA_BASE=http://127.0.0.1:3262 node scripts/qa/world-startup-bench.mjs --label before --runs 3 [--cpu 4] [--net fast|slow4g]

   Prints one JSON document (and writes .qa/runs/impl/startup/bench-<label>.json):
     per run  ready ms (performance.now() when <body data-ready> is set), long tasks (count / total / max / TBT),
              bytes + requests by kind, draw calls and triangles of a settled frame at spawn, programs, textures,
              geometries, JS heap, the runtime's own performance.measure() stages when it records any, load average.
     summary  medians over the runs.
   The machine is shared and noisy: compare medians of >= 3 runs taken back to back and read the load average. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launch, BASE } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const LABEL = arg('label', 'run'), RUNS = Number(arg('runs', 3)), CPU = Number(arg('cpu', 1)), NET = arg('net', null)
const OUT = path.resolve(arg('out', '.qa/runs/impl/startup'))
const URL_PATH = arg('url', '/archipelago/preview/index.html')
const SHOT = arg('shot', null)
const NETS = { fast: { latency: 80, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 }, slow4g: { latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8 } }
const median = (a) => { const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }
const kindOf = (url) => {
  const p = new URL(url).pathname
  if (/\.glb(\.gz)?$/.test(p)) return 'glb'
  if (/\/seed\/|\/api\/world\/(blob|release)|\.json(\.gz)?$/.test(p)) return 'json/doc'
  if (/\.(js|mjs)$/.test(p)) return /rapier/.test(p) ? 'rapier' : /vendor\/three/.test(p) ? 'three' : 'app js'
  if (/\.(png|jpg|webp|svg)$/.test(p)) return 'image'
  if (/\.(woff2?|ttf)$/.test(p)) return 'font'
  if (/\.css$/.test(p)) return 'css'
  return 'other'
}

const browser = await launch()
const runs = []
for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })
  await page.addInitScript(() => {
    const b = (window.__bench = { ready: null, tasks: [], frames: [] })
    new PerformanceObserver((l) => { for (const e of l.getEntries()) b.tasks.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ type: 'longtask', buffered: true })
    const watch = () => {
      if (!document.body) return requestAnimationFrame(watch)
      const check = () => { if (b.ready == null && document.body.dataset.ready === 'true') b.ready = performance.now() }
      new MutationObserver(check).observe(document.body, { attributes: true, attributeFilter: ['data-ready'] }); check()
    }
    watch()
  })
  const cdp = await context.newCDPSession(page)
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  if (NET) { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETS[NET] }) }
  const load = os.loadavg()[0]
  const started = Date.now()
  await page.goto(BASE + URL_PATH, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__bench.ready != null, null, { timeout: 600_000, polling: 100 })
  await page.waitForTimeout(2500)
  if (SHOT && run === 0) await page.screenshot({ path: SHOT })
  const m = await page.evaluate(() => {
    const a = window.__archipelago, info = a.renderer.info, b = window.__bench
    const res = performance.getEntriesByType('resource').map((r) => ({ url: r.name, transfer: r.transferSize, encoded: r.encodedBodySize, decoded: r.decodedBodySize, start: Math.round(r.startTime), end: Math.round(r.responseEnd), by: r.initiatorType }))
    let meshes = 0, hidden = 0; a.scene.traverse((o) => { if (o.isMesh) { meshes++; let v = true; for (let p = o; p; p = p.parent) if (!p.visible) v = false; if (!v) hidden++ } })
    return {
      ready: b.ready, tasks: b.tasks, resources: res,
      render: { calls: info.render.calls, triangles: info.render.triangles }, memory: { geometries: info.memory.geometries, textures: info.memory.textures }, programs: info.programs?.length ?? null,
      meshes, hiddenMeshes: hidden, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, quality: document.body.dataset.quality,
      measures: performance.getEntriesByType('measure').map((x) => [x.name, Math.round(x.startTime), Math.round(x.duration)]),
    }
  })
  const kinds = {}
  const seen = new Map(); for (const r of m.resources) seen.set(r.url, (seen.get(r.url) ?? 0) + 1)
  const duplicates = [...seen].filter(([, n]) => n > 1).map(([url, n]) => url.replace(/^https?:\/\/[^/]+/, '') + ' x' + n)
  const notPreloaded = m.resources.filter((r) => /\/archipelago\/preview\/.*\.js$/.test(new URL(r.url).pathname) && r.by === 'script').map((r) => new URL(r.url).pathname.replace('/archipelago/preview/', ''))
  for (const r of m.resources) { const k = kindOf(r.url); (kinds[k] ??= { n: 0, bytes: 0 }); kinds[k].n++; kinds[k].bytes += r.transfer || r.encoded || 0 }
  const before = m.tasks.filter(([s]) => s <= m.ready)
  runs.push({
    run, loadavg: Math.round(load * 100) / 100, wallMs: Date.now() - started, readyMs: Math.round(m.ready),
    longTasks: { count: before.length, totalMs: before.reduce((s, t) => s + t[1], 0), maxMs: Math.max(0, ...before.map((t) => t[1])), tbtMs: before.reduce((s, t) => s + Math.max(0, t[1] - 50), 0), list: before },
    requests: m.resources.length, bytes: m.resources.reduce((s, r) => s + (r.transfer || r.encoded || 0), 0), kinds,
    duplicates, notPreloaded, render: m.render, memory: m.memory, programs: m.programs, meshes: m.meshes, hiddenMeshes: m.hiddenMeshes, heapMB: m.heapMB, quality: m.quality, measures: m.measures, errors,
  })
  console.error(`run ${run}: ready ${runs.at(-1).readyMs} ms, long tasks ${before.length} (${runs.at(-1).longTasks.totalMs} ms), ${m.resources.length} requests, ${(runs.at(-1).bytes / 1048576).toFixed(1)} MB, ${m.render.triangles} tris / ${m.render.calls} calls, load ${load.toFixed(1)}${errors.length ? ', ERRORS ' + errors.length : ''}`)
  await context.close()
}
await browser.close()
const summary = {
  label: LABEL, base: BASE, cpu: CPU, net: NET, runs: RUNS,
  medianReadyMs: median(runs.map((r) => r.readyMs)), medianLongTaskCount: median(runs.map((r) => r.longTasks.count)), medianLongTaskTotalMs: median(runs.map((r) => r.longTasks.totalMs)),
  medianMaxLongTaskMs: median(runs.map((r) => r.longTasks.maxMs)), medianTbtMs: median(runs.map((r) => r.longTasks.tbtMs)), medianRequests: median(runs.map((r) => r.requests)), medianBytes: median(runs.map((r) => r.bytes)),
  medianTriangles: median(runs.map((r) => r.render.triangles)), medianCalls: median(runs.map((r) => r.render.calls)), medianPrograms: median(runs.map((r) => r.programs)), medianTextures: median(runs.map((r) => r.memory.textures)),
  medianHeapMB: median(runs.map((r) => r.heapMB)), duplicateRequests: runs.map((r) => r.duplicates.length), modulesNotPreloaded: runs.map((r) => r.notPreloaded.length), loadavg: runs.map((r) => r.loadavg), errors: runs.flatMap((r) => r.errors),
}
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(path.join(OUT, `bench-${LABEL}.json`), JSON.stringify({ summary, runs }, null, 1))
console.log(JSON.stringify(summary, null, 1))
