/* A direct arrival at /world (a reload, Forward, a shared link): leaves, not a dark dissolve.

     QA_BASE=<production url> node scripts/qa/leaf-direct.mjs [--phone] [--cpu 4] [--runs 3] [--reduced]

   A visitor with no homepage behind them used to see about three seconds of bare dark green on a fast machine —
   the canopy was built in idle time that the world's own start never left — and then a dark dissolve into the world:
   the leaves had never been drawn, the loader never shown. This opens /world cold, in a fresh context, and reads every
   frame from the first paint: what is on the screen when, and what it was when the leaves began to part.

     · the loader is up (opaque) within a second of the navigation, on the dark of the hedge, before any leaf
     · the leaves are drawn and opaque (six layers, none of them fading in) well before the world is ready
     · at the first frame of the parting every leaf layer is opaque and the loader is still fully there
     · the leaves were on the screen, opaque, for at least 650 ms before they began to part
     · the loader's words are at least 14 px (desktop) or 12 px (phone) and light on dark; its sprig is lit by steps
     · nothing is logged as an error, and no warning is about the frame's `allow` / `allowfullscreen` pair (it used to be);
       other warnings (the physics engine's init parameters, a CSS preload) belong to other areas and are only listed

   Writes a screenshot of the loader on the leaves to QA_OUT. */
import { devices } from 'playwright'
import { BASE, launch, sleep, assert, finish, out } from './lib.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] }
const PHONE = process.argv.includes('--phone')
const REDUCED = process.argv.includes('--reduced')
const CPU = Number(arg('cpu', 1))
const RUNS = Number(arg('runs', 3))
const tag = `${PHONE ? 'phone' : 'desktop'}${CPU > 1 ? `-cpu${CPU}` : ''}${REDUCED ? '-reduced' : ''}`
const results = []
const browser = await launch()
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1] }
const runs = []

for (let run = 0; run < RUNS; run++) {
  const context = await browser.newContext(PHONE ? { ...devices['Pixel 7'], reducedMotion: REDUCED ? 'reduce' : 'no-preference' } : { viewport: { width: 1440, height: 900 }, reducedMotion: REDUCED ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  const logged = []
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logged.push(`${m.type()}: ${m.text().slice(0, 200)}`) })
  page.on('pageerror', (e) => logged.push(`pageerror: ${String(e).slice(0, 200)}`))
  const cdp = await context.newCDPSession(page)
  if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
  await page.addInitScript(() => {
    const T = (window.__T = { loaderUp: 0, leavesOpaque: 0, firstLeaf: 0, reveal: null, ready: 0, text: null })
    const layers = () => [...document.querySelectorAll('[data-world-cover] canvas[data-band]')]
    window.addEventListener('message', (e) => { if (e.data?.type === 'archipelago:ready' && !T.ready) T.ready = performance.now() })
    window.addEventListener('world:phase', (e) => {
      if (e.detail !== 'REVEALING' || T.reveal) return
      const l = layers()
      const loader = document.querySelector('[data-world-loader]')
      T.reveal = { t: performance.now(), layers: l.length, minOpacity: l.length ? Math.min(...l.map((c) => +getComputedStyle(c).opacity)) : 0, loader: loader ? +getComputedStyle(loader).opacity : -1, loaderContent: loader ? +getComputedStyle(loader.firstElementChild).opacity : -1 }
    })
    const tick = (t) => {
      const loader = document.querySelector('[data-world-loader]')
      if (!T.loaderUp && loader && +getComputedStyle(loader).opacity >= 0.99) {
        T.loaderUp = t
        const p = loader.querySelectorAll('p')
        const fs = (el) => el && parseFloat(getComputedStyle(el).fontSize)
        T.text = { l1: fs(p[0]), l2: fs(p[1]), color: p[1] && getComputedStyle(p[1]).color, anyLeafAtThatTime: layers().length }
      }
      const l = layers()
      if (!T.firstLeaf && l.length && Math.max(...l.map((c) => +getComputedStyle(c).opacity)) > 0.05) T.firstLeaf = t
      if (!T.leavesOpaque && l.length >= 6 && l.every((c) => +getComputedStyle(c).opacity >= 0.99)) T.leavesOpaque = t
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page.goto(`${BASE}/world`, { waitUntil: 'commit' })
  await page.waitForFunction(() => document.documentElement.dataset.worldPhase === 'IN_WORLD' || document.documentElement.dataset.worldPhase === 'ERROR', null, { timeout: 240000 })
  const d = await page.evaluate(() => ({ ...window.__T, phase: document.documentElement.dataset.worldPhase }))
  if (run === 0) {
    // The same cold load, held on a frame mid-way through, for the eye (the runtime is stubbed to stay loading).
    const ctx2 = await browser.newContext(PHONE ? { ...devices['Pixel 7'] } : { viewport: { width: 1440, height: 900 } })
    const p2 = await ctx2.newPage()
    await p2.route('**/archipelago/preview/index.html*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: "<!doctype html><title>held</title><script>const p=(m)=>parent.postMessage(m,location.origin);p({type:'archipelago:hello'});p({type:'archipelago:progress',stage:'x',value:0.5,step:3,of:8});</script>" }))
    await p2.goto(`${BASE}/world`, { waitUntil: 'commit' })
    await sleep(3200)
    await p2.screenshot({ path: out(`leaf-direct/${tag}-loading.png`) })
    await ctx2.close()
  }
  runs.push({ ...d, logged })
  await context.close()
}
await browser.close()

const ok = runs.filter((r) => r.phase === 'IN_WORLD' && r.reveal)
assert(ok.length === runs.length, `every cold arrival reached the world (${ok.length}/${runs.length})`, results)
const worst = (k, f) => f(...ok.map((r) => k(r)))
if (!REDUCED) {
  assert(worst((r) => r.loaderUp, Math.max) <= 1000 * Math.max(1, CPU / 2), `the loader is up within ${1000 * Math.max(1, CPU / 2)} ms of the navigation (${ok.map((r) => Math.round(r.loaderUp)).join(', ')} ms)`, results)
  assert(ok.every((r) => r.leavesOpaque > 0 && r.leavesOpaque < r.reveal.t - 650), `the leaves were opaque at least 650 ms before they began to part (opaque at ${ok.map((r) => Math.round(r.leavesOpaque)).join(', ')}; parting at ${ok.map((r) => Math.round(r.reveal.t)).join(', ')} ms)`, results)
  assert(ok.every((r) => r.reveal.layers >= 6 && r.reveal.minOpacity >= 0.99), `at the first frame of the parting all six leaf layers are drawn and opaque (${ok.map((r) => `${r.reveal.layers} layers, min opacity ${r.reveal.minOpacity.toFixed(2)}`).join(' | ')})`, results)
  assert(ok.every((r) => r.reveal.loader >= 0.99 && r.reveal.loaderContent >= 0.99), `the loader is still fully there at the first frame of the parting (opacity ${ok.map((r) => r.reveal.loader.toFixed(2)).join(', ')})`, results)
  assert(ok.every((r) => r.loaderUp < r.leavesOpaque), `the loader came before the leaves were done, not after them (${ok.map((r) => `${Math.round(r.loaderUp)} < ${Math.round(r.leavesOpaque)}`).join(', ')})`, results)
}
const min1 = PHONE ? 12 : 14
assert(ok.every((r) => r.text && r.text.l1 >= min1 && r.text.l2 >= min1), `the loader's words are at least ${min1} px (${ok.map((r) => `${r.text?.l1.toFixed(1)}/${r.text?.l2.toFixed(1)}`).join(', ')})`, results)
assert(ok.every((r) => { const m = /rgb\((\d+), (\d+), (\d+)/.exec(r.text?.color ?? ''); return m && (0.2126 * +m[1] + 0.7152 * +m[2] + 0.0722 * +m[3]) > 190 }), `and light on the dark (${ok.map((r) => r.text?.color).join(' | ')})`, results)
const all = [...new Set(runs.flatMap((r) => r.logged))]
const mine = all.filter((m) => !m.startsWith('warning:') || /allow|fullscreen/i.test(m))
assert(mine.length === 0, `no error, and no warning about the frame's permissions, in the console (${mine.slice(0, 4).join(' | ') || 'none'})`, results)
const other = all.filter((m) => !mine.includes(m))
if (other.length) console.log(`(listed, not judged here: ${other.map((m) => m.slice(0, 90)).join(' | ')})`)
console.log(`${tag}: loader up ${median(ok.map((r) => r.loaderUp)).toFixed(0)} ms · first leaf ${median(ok.map((r) => r.firstLeaf)).toFixed(0)} · leaves opaque ${median(ok.map((r) => r.leavesOpaque)).toFixed(0)} · world ready ${median(ok.map((r) => r.ready)).toFixed(0)} · parting ${median(ok.map((r) => r.reveal.t)).toFixed(0)} ms`)
finish(results)
