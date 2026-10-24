/* Frame pacing of the capped player under displays of different refresh rates (main.js frame(), runtime/quality.js FramePacer).

     QA_BASE=http://localhost:3210 node scripts/qa/world-frame-pacing.mjs [--hz 60,75,90,100,120,144] [--jitter 0.05] [--main <file>]

   A headless run has one display rate, so the real main.js is driven by a synthetic requestAnimationFrame clock: every callback gets the timestamp of a vsync of a display of H Hz (k * 1000/H, plus a
   random jitter of +-jitter ms), delivered by a timer. A touch context (coarse pointer) is what turns the 60 fps cap on. For each rate the check reads which callbacks drew (renderer.info.render.frame
   moved) and asserts that every gap between two draws is the same whole number of vsyncs, that the rate never falls under 60, and where it lands (60, 75, 90, 100 draw every vsync, 120 and 144
   every second one). The failure it was written for: at exactly 90 Hz the cap's old test (gap < 16.67 - refresh/2) was a tie, and frames came as a mix of 11 and 22 ms (57 fps, judder) where the
   uncapped page ran an even 90. A fine pointer (no cap) must draw every vsync. Last, one page whose display changes its rate on the fly (60, 120, 90, 144, 100, 60, 120).
   --main <file> serves that file in place of main.js (the negative control: the page as it was before the fix must fail this). */
import fs from 'node:fs'
import { launch, BASE, sleep, assert, finish } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const MAIN = arg('main', ''), RATES = arg('hz', '60,75,90,100,120,144').split(',').map(Number), JITTER = Number(arg('jitter', 0.05))
/** The whole number of vsyncs between two draws that keeps the rate at 60 or above. */
const expected = (hz) => Math.max(1, Math.floor(hz / 60 + 0.05))
const results = []
const browser = await launch()

async function run(hz, { touch, sequence = null }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...(touch ? { hasTouch: true, isMobile: true } : {}) })
  const page = await ctx.newPage(); const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  if (MAIN) await page.route('**/archipelago/preview/main.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(MAIN, 'utf8') }))
  await page.addInitScript(({ hz, jitter }) => {
    // The display: one callback batch per vsync, timestamps a whole number of vsyncs apart plus the jitter. window.__hz changes the rate while it runs (an adaptive refresh).
    let t = 0, queue = [], next = []; window.__ticks = []; window.__hz = hz
    window.requestAnimationFrame = (cb) => { next.push(cb); return next.length }
    window.cancelAnimationFrame = () => {}
    const vsync = () => {
      const period = 1000 / window.__hz; t += period; const ts = t + (Math.random() - .5) * 2 * jitter; queue = next; next = []
      const before = window.__archipelago?.renderer?.info.render.frame
      for (const cb of queue) { try { cb(ts) } catch (e) { console.error(e) } }
      const after = window.__archipelago?.renderer?.info.render.frame
      if (before !== undefined && window.__rec) window.__ticks.push([ts, after - before, window.__hz])
      setTimeout(vsync, period)
    }
    setTimeout(vsync, 1000 / hz)
  }, { hz, jitter: JITTER })
  await page.goto(`${BASE}/archipelago/preview/index.html?qa`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
  await sleep(4000)
  await page.evaluate(() => { window.__rec = true })
  if (sequence) for (const rate of sequence) { await page.evaluate((rate) => { window.__hz = rate }, rate); await sleep(3500) } else await sleep(8000)
  const res = await page.evaluate(() => {
    const t = window.__ticks, drew = t.filter((x) => x[1] > 0), gaps = drew.slice(1).map((v, i) => v[0] - drew[i][0])
    return { ticks: t.length, drew: drew.length, gaps, at: drew.slice(1).map((v) => v[2]), coarse: matchMedia('(pointer: coarse)').matches, all: t }
  })
  await ctx.close()
  const period = 1000 / hz, counts = {}
  for (const g of res.gaps) { const n = Math.round(g / period); counts[n] = (counts[n] ?? 0) + 1 }
  const off = Math.max(...res.gaps.map((g) => Math.abs(g - Math.round(g / period) * period)))
  const fps = 1000 / (res.gaps.reduce((a, b) => a + b, 0) / res.gaps.length)
  return { ...res, counts, off, fps, errors }
}

for (const hz of RATES) {
  const r = await run(hz, { touch: true }), want = expected(hz)
  console.log(`  ${hz} Hz touch: ${r.drew} draws of ${r.ticks} callbacks, ${r.fps.toFixed(1)} fps, gaps in vsyncs ${JSON.stringify(r.counts)}, worst gap off a whole number of vsyncs ${r.off.toFixed(2)} ms`)
  assert(r.coarse, `${hz} Hz: the context is a touch one (the cap is on)`, results)
  assert(Object.keys(r.counts).length === 1, `${hz} Hz: every gap between two draws is the same (${JSON.stringify(r.counts)})`, results)
  assert(r.counts[want] === r.gaps.length, `${hz} Hz: a draw every ${want} vsync${want > 1 ? 's' : ''} (${r.fps.toFixed(1)} fps)`, results)
  assert(r.fps >= 59, `${hz} Hz: never under 60 fps (${r.fps.toFixed(1)})`, results)
  assert(r.drew > 100, `${hz} Hz: enough draws to judge (${r.drew})`, results)
  assert(r.errors.length === 0, `${hz} Hz: no console errors ${r.errors.join(' | ')}`, results)
}
// A fine pointer has no cap: every vsync draws.
{
  const hz = RATES.includes(90) ? 90 : RATES[0], r = await run(hz, { touch: false })
  console.log(`  ${hz} Hz mouse: ${r.drew} draws of ${r.ticks} callbacks, ${r.fps.toFixed(1)} fps`)
  assert(!r.coarse && r.counts[1] === r.gaps.length, `${hz} Hz, fine pointer: no cap, a draw at every vsync (${r.fps.toFixed(1)} fps)`, results)
}
// A display that changes its rate while the game runs (a phone's adaptive refresh): after the first half second of each stretch the draws are as even as on a display that never changed.
{
  const sequence = [60, 120, 90, 144, 100, 60, 120], r = await run(sequence[0], { touch: true, sequence })
  const rows = [], stretches = []
  for (const tick of r.all) { const last = stretches.at(-1); if (last && last.hz === tick[2]) last.ticks.push(tick); else stretches.push({ hz: tick[2], ticks: [tick] }) }
  for (const { hz, ticks } of stretches) {
    const drew = ticks.filter((x) => x[1] > 0).map((x) => x[0]), t0 = ticks[0][0]
    const settled = drew.filter((v) => v - t0 > 600), gaps = settled.slice(1).map((v, i) => Math.round((v - settled[i]) / (1000 / hz))), kinds = [...new Set(gaps)]
    rows.push(`${hz} Hz: ${JSON.stringify(kinds)}`)
    assert(kinds.length === 1 && kinds[0] === expected(hz), `after a switch to ${hz} Hz every gap is ${expected(hz)} vsync${expected(hz) > 1 ? 's' : ''} from 0.6 s on (${JSON.stringify(kinds)}, ${gaps.length} draws)`, results)
  }
  console.log('  rate switches:', rows.join('; '))
  assert(r.errors.length === 0, `rate switches: no console errors ${r.errors.join(' | ')}`, results)
}
await browser.close()
finish(results)
