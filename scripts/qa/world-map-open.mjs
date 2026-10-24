/* /world M map: what opening it costs. Real input on the real GPU.
   keydown M (or a tap on MAP) -> the first frame that contains the dialog; every long task while the photograph is taken; shader programs
   and GPU memory before/after the first open; the cost of re-opening; open/close mashed while it is still sharpening; zoom-in detail renders.
   Usage:  QA_OUT=.qa/runs/impl/map node scripts/qa/world-map-open.mjs
   Env:    W, H (viewport, 1440x900)  DPR (1; 2 is a retina laptop: the photograph is then 3072 px wide)  LABEL (file names)
           WARM=1   wait for atlas.prewarm() (the runtime calls it once ready; the atlas also starts it itself 3 s after ready) before pressing M
           MOBILE=1 a phone: touch, coarse pointer, taps instead of keys (use with W=390 H=844 DPR=3)
           BASELINE=1 serve the committed (HEAD) atlas.js/atlas.css/world-bounds.js/portfolio-theme.css by request interception, so before/after
                      are measured from the same working tree
           BROWSER=webkit  a smoke run in WebKit (no long-task API there: that assertion proves nothing) */
import { webkit } from 'playwright'
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const results = []
const [w, h] = [Number(process.env.W ?? 1440), Number(process.env.H ?? 900)]
const label = process.env.LABEL ?? 'run'
const engine = process.env.BROWSER ?? 'chromium'
const mobile = !!process.env.MOBILE
const dpr = Number(process.env.DPR ?? 1)
const browser = engine === 'webkit' ? await webkit.launch({ headless: true }) : await launch()
const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, ...(mobile ? { isMobile: true, hasTouch: true } : {}) })
const page = await context.newPage()
const errors = watch(page)
if (process.env.BASELINE) {
  for (const name of ['atlas.js', 'atlas.css', 'world-bounds.js', 'portfolio-theme.css']) {
    const body = execFileSync('git', ['show', `HEAD:public/archipelago/preview/${name}`], { maxBuffer: 1 << 26 })
    await page.route(`**/archipelago/preview/${name}`, (route) => route.fulfill({ body, contentType: name.endsWith('.css') ? 'text/css' : 'text/javascript' }))
  }
}
await openPlayer(page)
await sleep(Number(process.env.SETTLE ?? 2500))
let warmMs = null, warmFrames = null
if (process.env.WARM) {
  // The warm-up runs while the world is being played: record the longest tasks and frame gaps it causes.
  warmFrames = await page.evaluate(async () => {
    const long = [], gaps = []; let last = performance.now(), stop = false
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)) }).observe({ type: 'longtask' }) } catch {}
    const loop = (ts) => { gaps.push(ts - last); last = ts; if (!stop) requestAnimationFrame(loop) }; requestAnimationFrame(loop)
    const t = performance.now(); await globalThis.__archipelago.atlas.prewarm?.(); const ms = performance.now() - t; stop = true
    await new Promise((r) => setTimeout(r, 100))
    gaps.sort((a, b) => a - b)
    return { ms: Math.round(ms), long, frames: gaps.length, p50: +gaps[gaps.length >> 1].toFixed(1), p99: +gaps[Math.floor(gaps.length * .99)].toFixed(1), max: +gaps[gaps.length - 1].toFixed(1) }
  })
  warmMs = warmFrames.ms
}

// Probes live in the page: long tasks, the input that starts an open, and the frame that first holds the dialog.
await page.evaluate(() => {
  const p = (globalThis.__mp = { long: [], keys: [], t0: null, seen: null, next: null, sharpAt: null })
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) p.long.push({ start: e.startTime, dur: e.duration }) }).observe({ type: 'longtask', buffered: false }) } catch {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'keydown' || e.name === 'click') p.keys.push({ start: e.startTime, script: e.processingEnd - e.processingStart, dur: e.duration }) }).observe({ type: 'event', durationThreshold: 16 }) } catch {}
  addEventListener('keydown', (e) => { if (e.code === 'KeyM' && p.t0 == null) p.t0 = e.timeStamp }, true)
  addEventListener('click', (e) => { if (e.target.closest?.('#player-map') && p.t0 == null) p.t0 = e.timeStamp }, true)   // a tap opens on its click
  const loop = (ts) => {
    requestAnimationFrame(loop)
    if (p.t0 == null) return
    const a = document.querySelector('.atlas')
    if (p.seen == null && a && !a.hidden) p.seen = ts
    else if (p.seen != null && p.next == null) p.next = ts
    const A = globalThis.__archipelago?.atlas
    if (p.sharpAt == null && A?.photo && (A.photo.state === undefined || A.photo.state === 'sharp')) p.sharpAt = ts
  }
  requestAnimationFrame(loop)
})
const reset = () => page.evaluate(() => { const p = globalThis.__mp; Object.assign(p, { long: [], keys: [], t0: null, seen: null, next: null, sharpAt: null }) })
const snap = () => page.evaluate(() => { const r = globalThis.__archipelago.renderer.info; return { programs: r.programs.length, memory: { ...r.memory } } })
const openMap = async () => { if (mobile) await page.tap('#player-map'); else { await page.evaluate(() => document.querySelector('#world').focus()); await page.keyboard.press('KeyM') } }
const closeMap = async () => { if (mobile) await page.tap('.atlas-close'); else await page.keyboard.press('Escape'); await sleep(350) }
const timing = () => page.evaluate(() => { const p = globalThis.__mp; return { toSeen: p.seen - p.t0, toNext: p.next - p.t0, toSharp: p.sharpAt == null ? null : p.sharpAt - p.t0, long: p.long.filter((l) => l.start >= p.t0 - 5).map((l) => Math.round(l.dur)), keys: p.keys.map((k) => ({ script: Math.round(k.script), dur: Math.round(k.dur) })) } })

const before = await snap()
const warmStats = await page.evaluate(() => { const A = globalThis.__archipelago; return { warmed: !!A.atlas.warming, urgent: !!A.atlas.urgent, parallelCompile: !!A.renderer.extensions.has('KHR_parallel_shader_compile') } })
await openMap()
await page.waitForFunction(() => globalThis.__mp.sharpAt != null, null, { timeout: 60_000 })
await sleep(400)
const first = await timing()
const afterFirst = await snap()
const photo = await page.evaluate(() => { const a = globalThis.__archipelago.atlas; return { asyncReadFailed: a.asyncRead === false, state: a.photo?.state, size: a.photo && [a.photo.width, a.photo.height], coarse: matchMedia('(pointer:coarse)').matches } })
await page.screenshot({ path: out(`open-${label}-${w}x${h}-first.png`) })
await closeMap()

// Re-open: the photograph is kept, so this should be layout only.
const reopens = []
for (let i = 0; i < 3; i++) {
  await reset(); await openMap()
  await page.waitForFunction(() => globalThis.__mp.next != null, null, { timeout: 10_000 })
  await sleep(300)
  reopens.push(await timing()); await closeMap()
}
const afterReopen = await snap()
// Script cost of a re-open measured in the page (no input pipeline): show() then close().
const script = await page.evaluate(() => { const A = globalThis.__archipelago.atlas, t = []; for (let i = 0; i < 5; i++) { const a = performance.now(); A.show(); t.push(performance.now() - a); A.close() } return t.map((x) => +x.toFixed(2)) })

// Mashing: open and close at random moments while the photograph is still being drawn, then open for good. Nothing leaks, nothing breaks.
let stress = null
if (!process.env.BASELINE) {
  await page.evaluate(() => globalThis.__archipelago.atlas.invalidate())
  for (let i = 0; i < 10; i++) { await page.evaluate(() => globalThis.__archipelago.atlas.show()); await sleep(10 + Math.random() * 220); await page.evaluate(() => globalThis.__archipelago.atlas.close()); await sleep(Math.random() * 60) }
  await page.evaluate(() => globalThis.__archipelago.atlas.show())
  await page.waitForFunction(() => globalThis.__archipelago.atlas.photo?.state === 'sharp', null, { timeout: 60_000 })
  await sleep(500)
  const after = await snap()
  stress = { after, shape: await page.evaluate(() => { const a = globalThis.__archipelago.atlas; return { pumping: a.pumping, state: a.photo?.state, pins: a.pinEls.length } }) }
  await page.screenshot({ path: out(`open-${label}-${w}x${h}-mashed.png`) })
  await page.evaluate(() => globalThis.__archipelago.atlas.close())
}

// Detail: zoom in with the wheel, watch what the sharper photograph costs and when it is skipped.
let detail = null
if (!mobile && !process.env.BASELINE) {
  await reset(); await openMap(); await page.waitForFunction(() => globalThis.__archipelago.atlas.photo?.state === 'sharp'); await sleep(300)
  const box = await page.evaluate(() => { const r = document.querySelector('.atlas-stage').getBoundingClientRect(); return { x: r.left + r.width * .55, y: r.top + r.height * .5 } })
  await page.evaluate(() => { const a = globalThis.__archipelago.atlas, shoot = a.shoot.bind(a); globalThis.__shoots = []; a.shoot = (o) => { globalThis.__shoots.push({ w: o.width, h: o.height }); return shoot(o) } })
  await page.mouse.move(box.x, box.y)
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await sleep(30) }
  const t0 = Date.now()
  await page.waitForFunction(() => globalThis.__archipelago.atlas.detailInfo, null, { timeout: 15_000 })
  const detailMs = Date.now() - t0 + 180
  await sleep(300)
  const zoomed = await page.evaluate(() => { const a = globalThis.__archipelago.atlas; return { shoots: globalThis.__shoots.length, zoom: a.view.zoom, info: a.detailInfo && { w: a.detailInfo.width, h: a.detailInfo.height } } })
  // A small drag stays inside the margin the detail was taken with: no new photograph. A long one needs a new one.
  await page.mouse.down(); await page.mouse.move(box.x - 14, box.y - 10, { steps: 4 }); await page.mouse.up(); await sleep(900)
  const small = await page.evaluate(() => globalThis.__shoots.length)
  await page.mouse.down(); await page.mouse.move(box.x - 330, box.y + 220, { steps: 10 }); await page.mouse.up()
  await page.waitForFunction((n) => globalThis.__shoots.length > n, small, { timeout: 15_000 }).catch(() => {})
  await sleep(700)
  const large = await page.evaluate(() => globalThis.__shoots.length)
  const longs = await page.evaluate(() => globalThis.__mp.long.map((l) => Math.round(l.dur)))
  await page.screenshot({ path: out(`open-${label}-${w}x${h}-detail.png`) })
  detail = { detailMs, zoomed, shootsAfterSmallPan: small - zoomed.shoots, shootsAfterLargePan: large - small, long: longs }
  await closeMap()
}

const report = { label, engine, viewport: [w, h], dpr, mobile, baseline: !!process.env.BASELINE, warmMs, warmFrames, warmStats, photo, before, afterFirst, afterReopen, first, reopens, scriptShowMs: script, stress, detail }
fs.writeFileSync(out(`open-${label}-${w}x${h}.json`), JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, stress: undefined }, null, 1))

// A phone's tap reaches the page ~15 ms later than a key (touch pipeline, emulated here), so there the first open is judged by what it adds to a re-open.
const reopenFloor = [...reopens.map((r) => r.toNext)].sort((a, b) => a - b)[1]
if (mobile) assert(first.toNext < 50 || first.toNext - reopenFloor < 25, `tap on MAP -> first frame holding the dialog ${first.toNext.toFixed(1)} ms (a re-open takes ${reopenFloor.toFixed(1)} ms: +${(first.toNext - reopenFloor).toFixed(1)} ms for the first)`, results)
else assert(first.toNext < 50, `keydown M -> first frame holding the dialog ${first.toNext.toFixed(1)} ms (frame start ${first.toSeen.toFixed(1)} ms) < 50 ms`, results)
assert(first.long.every((d) => d < 50), `no task >= 50 ms while the map opens (long tasks: ${first.long.join(', ') || 'none'})`, results)
assert(afterReopen.programs === afterFirst.programs && afterReopen.memory.textures <= afterFirst.memory.textures && afterReopen.memory.geometries <= afterFirst.memory.geometries, `re-opening compiles nothing and grows nothing (programs ${afterFirst.programs}->${afterReopen.programs}, textures ${afterFirst.memory.textures}->${afterReopen.memory.textures})`, results)
assert(Math.max(...script.slice(1)) < 16, `re-open script cost ${Math.max(...script.slice(1)).toFixed(1)} ms < 16 ms`, results)
assert(reopens.every((r) => r.toNext < (mobile ? 60 : 50)), `re-open shows the dialog in ${reopens.map((r) => r.toNext.toFixed(0)).join('/')} ms`, results)
if (stress) assert(stress.after.memory.textures <= afterFirst.memory.textures && stress.after.memory.geometries <= afterFirst.memory.geometries && stress.after.programs <= afterFirst.programs && !stress.shape.pumping, `10 opens and closes mashed mid-photograph leak nothing (textures ${afterFirst.memory.textures}->${stress.after.memory.textures}, programs ${afterFirst.programs}->${stress.after.programs}) and finish sharp (${stress.shape.state})`, results)
if (detail) {
  assert(detail.zoomed.info && Math.max(detail.zoomed.info.w, detail.zoomed.info.h) <= 2048 && detail.long.every((d) => d < 50), `zoom ${detail.zoomed.zoom.toFixed(1)}: detail photographed at ${detail.zoomed.info?.w}x${detail.zoomed.info?.h} about ${detail.detailMs} ms after the gesture, no task >= 50 ms (${detail.long.join(', ') || 'none'})`, results)
  assert(detail.shootsAfterSmallPan === 0 && detail.shootsAfterLargePan >= 1, `a small pan reuses the detail (${detail.shootsAfterSmallPan} new photographs), a long one takes a new one (${detail.shootsAfterLargePan})`, results)
}
if (mobile) assert(photo.coarse, 'the phone profile reports a coarse pointer', results)
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
