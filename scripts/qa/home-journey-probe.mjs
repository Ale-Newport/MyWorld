/* The homepage journey probe: what the main thread and the room do while a visitor really uses the page.

     QA_BASE=http://localhost:3235 node scripts/qa/home-journey-probe.mjs \
        [--w 1440 --h 900] [--dpr 2] [--phone] [--cpu 1] [--net slow4g] [--idle 10] \
        [--phases load,idle,idleAt,chapters,scroll,hover,index] [--settle 3.5] [--gpu] [--css file.css] [--js file.js] [--out .qa/runs/home-journey.json]

   Run it against a PRODUCTION build (`next build && next start`), never the dev server. For React render
   milliseconds per commit build with `next build --profile` (React's production profiler is then on; the
   probe reads `actualDuration` through the DevTools hook, which exists without any extension installed).

   Phases (each one reports its own numbers; --phases picks a subset):
     load      TTFB, FCP, LCP, room ready, long tasks / TBT / long animation frames, JS bytes, requests to /world
     idle      --idle seconds with no input: main-thread tasks (from a Chromium trace), rAF frames the page
               itself asks for, React commits, style recalcs / layouts, JS timers, and the shared ticker's
               passes a second with the subscribers that kept it awake (a page at rest should have none)
     idleAt    idle in the middle of the Prelude, About, Toolbox, Universe and Education: what the second WebGL canvas
               (which draws the Toolbox's lattice) costs while nobody is doing anything
     chapters  crossing each chapter boundary by a programmatic scroll: React commits, function components
               that re-rendered, render ms (profiling builds), long animation frames, Range.getClientRects bursts
     scroll    the WHOLE journey by one synthesized mouse-wheel / touch gesture (what a visitor does, not
               scrollTo): per-chapter frame time p50/p95/max, long animation frames with script attribution,
               layout and style-recalc counts per frame
     hover     the pointer over the Toolbox tiles and the Universe bodies (taps on touch profiles): main-thread
               ms per target, Event Timing durations, reading-field measurement bursts (Range.getClientRects
               clusters, one per HomeRoom read()) with the code that started each, React commits, room redraws
     index     the chapter index opened and closed with the keyboard: viewport width before and during (does
               locking scroll move the layout?), room light cache restarts, frame times through the transition,
               GPU time with --gpu
   Everything is written to --out; nothing in the repository changes. The scroll bar is NOT hidden (Playwright
   hides it in headless mode by default, the site styles an 8 px classic one: hiding it measures another page). */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const PHONE = Boolean(opt('phone', false))
const BASE = String(opt('base', process.env.QA_BASE ?? 'http://localhost:3235')).replace(/\/$/, '')
const W = Number(opt('w', PHONE ? 390 : 1440))
const H = Number(opt('h', PHONE ? 844 : 900))
const DPR = Number(opt('dpr', PHONE ? 3 : 2))
const CPU = Number(opt('cpu', 1))
const NET = opt('net', null)
const IDLE = Number(opt('idle', 10))
const GPU = Boolean(opt('gpu', false))
const CSS = opt('css', null) // a stylesheet injected after load: an A/B inside one build
const JS = opt('js', null) // a script run after load (same purpose: try a change without building it)
// idleAt: seconds to wait after arriving before measuring. The room keeps its air moving for 8 s after a scroll
// (swayLinger), and the ambient motion of the About, Toolbox and Universe chapters runs 8 s (AMBIENT_LINGER) and then
// eases to rest over 2.5 s (AMBIENT_EASE, lib/ticker), so `--settle 13` measures a page that has been left alone.
const SETTLE = Number(opt('settle', 3.5))
const PHASES = String(opt('phases', 'load,idle,idleAt,chapters,scroll,hover,index')).split(',')
const OUT = String(opt('out', '.qa/runs/home-journey.json'))
const NETWORKS = {
  slow4g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  fast4g: { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
}
const WORLD = /\/archipelago\/|\/api\/world\/|\/world2\/|^\/world(\?|$)/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100)

/* ---- in the page, before any page script ---------------------------------------------------------- */
const INIT = () => {
  const w = window
  // The site's shared ticker records which of its subscribers kept it busy (see lib/ticker.ts); it exposes nothing otherwise.
  w.__tickerDebug = true
  const P = (w.__p = { frames: [], loaf: [], long: [], events: [], commits: [], rects: [], timers: 0, shifts: 0, marks: [], recording: false })
  // Frame deltas, tagged with scroll position. Only while recording: a probe's own rAF loop would keep an idle page awake.
  let last = 0
  const tick = (t) => {
    if (!P.recording) { last = 0; return }
    if (last) P.frames.push([t, t - last, Math.round(scrollY)])
    last = t
    requestAnimationFrame(tick)
  }
  P.record = (on) => { if (on && !P.recording) { P.recording = true; last = 0; requestAnimationFrame(tick) } else if (!on) P.recording = false }
  const po = (type, fn, extra = {}) => { try { new PerformanceObserver((l) => l.getEntries().forEach(fn)).observe({ type, buffered: true, ...extra }) } catch { /* unsupported */ } }
  po('long-animation-frame', (e) => {
    const scripts = (e.scripts || []).map((s) => ({ src: String(s.sourceURL || '').split('/').slice(-2).join('/'), fn: s.sourceFunctionName || '', inv: s.invoker || '', d: Math.round(s.duration), forced: Math.round(s.forcedStyleAndLayoutDuration || 0) }))
    P.loaf.push({ t: e.startTime, d: e.duration, blocking: e.blockingDuration, style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, scripts })
  })
  po('longtask', (e) => P.long.push([e.startTime, e.duration]))
  po('event', (e) => P.events.push({ t: e.startTime, name: e.name, d: e.duration, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart, target: e.target?.tagName }), { durationThreshold: 16 })
  po('layout-shift', (e) => { if (!e.hadRecentInput) P.shifts += e.value })
  po('largest-contentful-paint', (e) => { P.lcp = e.startTime; P.lcpEl = `${e.element?.tagName ?? ''}${e.url ? ' ' + e.url.split('/').slice(-1)[0] : ''} ${Math.round(e.size)}px²` })
  po('paint', (e) => { if (e.name === 'first-contentful-paint') P.fcp = e.startTime })
  // JS timers (the 1.5 s role rotation and anything like it).
  const st = w.setTimeout, si = w.setInterval
  w.setTimeout = function (fn, ms, ...a) { P.timers++; return st.call(this, fn, ms, ...a) }
  w.setInterval = function (fn, ms, ...a) { P.timers++; return si.call(this, fn, ms, ...a) }
  // React commits through the DevTools hook (React calls it in production builds too). Profiling builds also
  // carry `actualDuration` on the root: the render time of the whole commit. `flags & 1` is PerformedWork:
  // the function components whose render ran in this commit (a bailed-out component does not have it).
  const fn = (t) => t === 0 || t === 11 || t === 14 || t === 15
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), checkDCE() {}, onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id },
    onCommitFiberRoot(id, root) {
      let n = 0
      const names = w.__p_names ? {} : null // a development build keeps component names: `--names` asks for them
      // A subtree React skipped keeps the PerformedWork flags of the last time it did render, so only
      // subtrees whose child list was rebuilt in this commit (child !== alternate.child) are walked.
      const stack = [root.current]
      while (stack.length) {
        const f = stack.pop()
        if (fn(f.tag) && f.alternate && (f.flags & 1)) {
          n++
          if (names) { const t = f.type; const k = (t && (t.displayName || t.name || t.render?.name || t.type?.name)) || '?'; names[k] = (names[k] ?? 0) + 1 }
        }
        if (f.sibling) stack.push(f.sibling)
        if (f.child && (!f.alternate || f.child !== f.alternate.child)) stack.push(f.child)
      }
      P.commits.push({ t: performance.now(), renderer: id, fibers: n, ms: root.current.actualDuration ?? null, y: Math.round(scrollY), names })
    },
  }
  // Reading-field measurement bursts: Range.getClientRects is what measureReadingBoxes / placeEntablature / flowLines hammer.
  const rc = Range.prototype.getClientRects
  let burst = null
  Range.prototype.getClientRects = function () {
    const now = performance.now()
    if (!burst || now - burst.last > 30) {
      const lines = (new Error().stack || '').split('\n').slice(2, 7).map((l) => l.replace(/^\s+at\s+/, '').replace(/https?:\/\/[^/]+\/_next\/static\//, '').trim())
      burst = { start: now, last: now, n: 0, from: lines }
      P.rects.push(burst)
    }
    burst.n++
    burst.last = performance.now()
    return rc.call(this)
  }
  w.addEventListener('room:ready', () => P.marks.push(['room:ready', performance.now()]))
}

/* ---- statistics ------------------------------------------------------------------------------------ */
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))] }
const median = (a) => pct(a, 0.5)
const frameStats = (a) => ({ n: a.length, p50: r2(pct(a, 0.5)), p95: r2(pct(a, 0.95)), p99: r2(pct(a, 0.99)), max: r2(a.length ? Math.max(...a) : null), over25: a.filter((x) => x > 25).length, over34: a.filter((x) => x > 33.4).length, over50: a.filter((x) => x > 50).length })
const sum = (a) => a.reduce((x, y) => x + y, 0)

/* ---- browser ----------------------------------------------------------------------------------------- */
const browser = await chromium.launch({
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  ignoreDefaultArgs: ['--hide-scrollbars'],
})
const version = browser.version()
const ctxOptions = { viewport: { width: W, height: H }, deviceScaleFactor: DPR }
if (PHONE) Object.assign(ctxOptions, { isMobile: true, hasTouch: true, userAgent: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version.replace(/^(\d+)\..*/, '$1.0.0.0')} Mobile Safari/537.36` })
const context = await browser.newContext(ctxOptions)
const page = await context.newPage()
const cdp = await context.newCDPSession(page)
await cdp.send('Performance.enable')
await cdp.send('Network.enable')
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
if (NET) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[NET] })
await page.addInitScript(INIT)
if (opt('names', false)) await page.addInitScript(() => { window.__p_names = true })
const pageErrors = []
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') pageErrors.push(`console: ${m.text().slice(0, 300)}`) })
const reqs = []
cdp.on('Network.requestWillBeSent', (e) => reqs.push(e.request.url))
let jsBytes = 0, totalBytes = 0, nReq = 0
const kinds = new Map()
cdp.on('Network.responseReceived', (e) => kinds.set(e.requestId, e.type))
cdp.on('Network.loadingFinished', (e) => { nReq++; totalBytes += e.encodedDataLength; if (kinds.get(e.requestId) === 'Script') jsBytes += e.encodedDataLength })

const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
const delta = (a, b) => ({
  layouts: b.LayoutCount - a.LayoutCount, styleRecalcs: b.RecalcStyleCount - a.RecalcStyleCount,
  layoutMs: r2((b.LayoutDuration - a.LayoutDuration) * 1000), styleMs: r2((b.RecalcStyleDuration - a.RecalcStyleDuration) * 1000),
  scriptMs: r2((b.ScriptDuration - a.ScriptDuration) * 1000), taskMs: r2((b.TaskDuration - a.TaskDuration) * 1000), wallMs: r2((b.Timestamp - a.Timestamp) * 1000),
})
const snap = () => page.evaluate(() => ({ t: performance.now(), frames: __p.frames.length, loaf: __p.loaf.length, commits: __p.commits.length, rects: __p.rects.length, events: __p.events.length, timers: __p.timers, long: __p.long.length }))
const since = (from) => page.evaluate((f) => ({ frames: __p.frames.slice(f.frames), loaf: __p.loaf.slice(f.loaf), commits: __p.commits.slice(f.commits), rects: __p.rects.slice(f.rects), events: __p.events.slice(f.events), long: __p.long.slice(f.long), timers: __p.timers - f.timers }), from)
const room = () => page.evaluate(() => { const r = window.__room?.(); return r ? { quality: r.quality, dpr: r.dpr, draws: r.draws, cache: r.cache, leaves: r.leaves, stems: r.stems, field: r.field, avoid: r.avoidRows, replantMs: r.timings?.replant, ready: r.milestones?.ready } : null })
const commitSummary = (c) => ({ commits: c.length, fibers: sum(c.map((x) => x.fibers)), maxFibers: c.length ? Math.max(...c.map((x) => x.fibers)) : 0, renderMs: c.some((x) => x.ms != null) ? r2(sum(c.map((x) => x.ms ?? 0))) : null, maxRenderMs: c.some((x) => x.ms != null) ? r2(Math.max(...c.map((x) => x.ms ?? 0))) : null })
const burstSummary = (rects) => {
  const sites = {}
  for (const b of rects) { const k = (b.from[0] ?? '?').slice(0, 90); sites[k] = (sites[k] ?? 0) + 1 }
  return { bursts: rects.length, rectsPerBurstMax: rects.reduce((m, r) => Math.max(m, r.n), 0), sites: Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 4) }
}
const loafSummary = (loaf) => ({
  count: loaf.length, longest: r1(loaf.reduce((m, l) => Math.max(m, l.d), 0)), blockingMs: r1(sum(loaf.map((l) => l.blocking ?? 0))),
  top: loaf.sort((a, b) => b.d - a.d).slice(0, 3).map((l) => ({ d: r1(l.d), blocking: r1(l.blocking), scripts: l.scripts.sort((a, b) => b.d - a.d).slice(0, 3) })),
})
const eventSummary = (events) => {
  const names = events.filter((e) => /^pointer|^mouse|^click|^key|^touch/.test(e.name))
  return { n: names.length, maxDuration: r1(names.reduce((m, e) => Math.max(m, e.d), 0)), p75: r1(pct(names.map((e) => e.d), 0.75)), maxDelay: r1(names.reduce((m, e) => Math.max(m, e.delay), 0)) }
}

/** A Chromium trace around `act`: main-thread tasks and GPU tasks inside the window. */
async function traced(act, categories = ['toplevel', 'disabled-by-default-devtools.timeline', 'gpu', 'disabled-by-default-gpu.service', 'viz', 'cc']) {
  await browser.startTracing(page, { categories, screenshots: false })
  let value
  try { value = await act() } finally { /* stop below */ }
  const buf = await browser.stopTracing()
  const events = JSON.parse(buf.toString()).traceEvents
  const threadName = new Map()
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args?.name)
  const main = events.filter((e) => e.ph === 'X' && e.name === 'ThreadControllerImpl::RunTask' && threadName.get(`${e.pid}:${e.tid}`) === 'CrRendererMain')
  const gpu = events.filter((e) => e.ph === 'X' && e.name === 'GPUTask')
  const frames = events.filter((e) => e.name === 'ProxyMain::BeginMainFrame' || e.name === 'PageAnimator::serviceScriptedAnimations').length
  const bmf = events.filter((e) => e.ph === 'X' && e.name === 'ProxyMain::BeginMainFrame')
  return {
    value,
    mainTasks: main.length, mainTaskMs: r1(sum(main.map((e) => e.dur)) / 1000), mainTaskMaxMs: r1(main.reduce((m, e) => Math.max(m, e.dur), 0) / 1000),
    gpuTasks: gpu.length, gpuMs: r1(sum(gpu.map((e) => e.dur)) / 1000), gpuMaxMs: r1(gpu.reduce((m, e) => Math.max(m, e.dur), 0) / 1000),
    beginMainFrames: bmf.length, animationFrameServices: frames,
  }
}

/** The shared ticker's own counters (lib/ticker.ts, exposed to this harness by `__tickerDebug`). */
const ticker = () => page.evaluate(() => (window.__ticker ? window.__ticker() : null))
const tickerDelta = (a, b, seconds) => {
  if (!a || !b) return null
  const from = Object.entries(b.wakeSources ?? {}).map(([k, n]) => [k, n - (a.wakeSources?.[k] ?? 0)]).filter(([, n]) => n > 0).sort((x, y) => y[1] - x[1]).slice(0, 4)
  return { running: b.running, passesPerS: r1((b.passes - a.passes) / seconds), wakes: b.wakes - a.wakes, busy: b.busy, wokenBy: Object.fromEntries(from) }
}

const result = { base: BASE, chromium: version, W, H, DPR, CPU, NET, phone: PHONE, phases: {} }
const t0 = Date.now()

/* ---- load -------------------------------------------------------------------------------------------- */
await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 })
await page.waitForFunction(() => document.querySelector('[data-room-host]')?.getAttribute('data-ready') === 'true', null, { timeout: 120000 }).catch(() => {})
await sleep(1500)
{
  const l = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0]
    const P = __p
    return {
      ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, fcp: P.fcp, lcp: P.lcp, lcpElement: P.lcpEl,
      roomReady: P.marks.find((m) => m[0] === 'room:ready')?.[1] ?? null,
      longTasks: P.long.length, tbt: P.long.reduce((a, [, d]) => a + Math.max(0, d - 50), 0), longest: P.long.reduce((a, [, d]) => Math.max(a, d), 0),
      loaf: P.loaf.length, cls: P.shifts, dom: document.getElementsByTagName('*').length,
      scrollbar: innerWidth - document.documentElement.clientWidth,
    }
  })
  result.phases.load = { ...l, jsKb: Math.round(jsBytes / 1024), transferKb: Math.round(totalBytes / 1024), requests: nReq, worldRequests: reqs.filter((u) => WORLD.test(new URL(u).pathname)).length, room: await room() }
  if (!PHASES.includes('load')) delete result.phases.load
}

if (CSS) await page.addStyleTag({ content: fs.readFileSync(String(CSS), 'utf8') })
if (JS) await page.addScriptTag({ content: fs.readFileSync(String(JS), 'utf8') })

/* ---- idle -------------------------------------------------------------------------------------------- */
if (PHASES.includes('idle')) {
  await sleep(1000)
  const a = await metrics()
  const s = await snap()
  const k0 = await ticker()
  const tr = await traced(async () => { await sleep(IDLE * 1000) })
  const k1 = await ticker()
  const b = await metrics()
  const d = await since(s)
  result.phases.idle = {
    seconds: IDLE, ticker: tickerDelta(k0, k1, IDLE),
    seconds_: undefined, mainTasksPer10s: Math.round((tr.mainTasks * 10) / IDLE), mainTaskMsPer10s: r1((tr.mainTaskMs * 10) / IDLE), beginMainFramesPer10s: Math.round((tr.beginMainFrames * 10) / IDLE),
    gpuTasksPer10s: Math.round((tr.gpuTasks * 10) / IDLE), gpuMsPer10s: r1((tr.gpuMs * 10) / IDLE),
    commitsPer10s: Math.round((d.commits.length * 10) / IDLE), timersPer10s: Math.round((d.timers * 10) / IDLE),
    perf: { styleRecalcsPer10s: Math.round(((b.RecalcStyleCount - a.RecalcStyleCount) * 10) / IDLE), layoutsPer10s: Math.round(((b.LayoutCount - a.LayoutCount) * 10) / IDLE), scriptMsPer10s: r1(((b.ScriptDuration - a.ScriptDuration) * 10000) / IDLE) },
    rectBursts: d.rects.length, room: await room(),
  }
}

/* ---- idle inside the chapters that carry the second canvas ------------------------------------------ */
if (PHASES.includes('idleAt')) {
  const where = {}
  const chapters = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#journey section[data-chapter]')]
    const top0 = secs[0].getBoundingClientRect().top + scrollY
    const sum = secs.reduce((a, el) => a + el.offsetHeight, 0)
    const max = document.documentElement.scrollHeight - innerHeight
    return secs.map((el) => ({ id: el.dataset.chapter, mid: ((el.getBoundingClientRect().top + scrollY - top0 + el.offsetHeight / 2) / sum) * max }))
  })
  for (const id of ['prelude', 'about', 'toolbox', 'universe', 'education']) {
    const c = chapters.find((x) => x.id === id)
    if (!c) continue
    await page.evaluate((y) => scrollTo(0, y), Math.round(c.mid))
    await sleep(SETTLE * 1000)
    const seconds = 4
    const a = await metrics()
    const s0 = await snap()
    const k0 = await ticker()
    const tr = await traced(async () => { await sleep(seconds * 1000) })
    const k1 = await ticker()
    const b = await metrics()
    const d0 = await since(s0)
    where[id] = {
      ticker: tickerDelta(k0, k1, seconds),
      commitsPerS: r1(d0.commits.length / seconds), timersPerS: r1(d0.timers / seconds),
      mainTasksPerS: r1(tr.mainTasks / seconds), mainTaskMsPerS: r1(tr.mainTaskMs / seconds), gpuTasksPerS: r1(tr.gpuTasks / seconds), gpuMsPerS: r1(tr.gpuMs / seconds),
      scriptMsPerS: r1(((b.ScriptDuration - a.ScriptDuration) * 1000) / seconds), styleRecalcsPerS: r1((b.RecalcStyleCount - a.RecalcStyleCount) / seconds),
    }
  }
  result.phases.idleAt = where
}

/* ---- chapters: React work per boundary ---------------------------------------------------------------- */
if (PHASES.includes('chapters')) {
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(1500)
  // A chapter becomes the active one at its range's start: its share of the journey's length, in scroll PROGRESS
  // (fractions of the document's height minus one viewport), which is not where its section's top stands.
  const chapters = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#journey section[data-chapter]')]
    const top0 = secs[0].getBoundingClientRect().top + scrollY
    const total = secs.reduce((a, el) => a + el.offsetHeight, 0)
    const max = document.documentElement.scrollHeight - innerHeight
    return secs.map((el) => ({ id: el.dataset.chapter, top: el.getBoundingClientRect().top + scrollY, h: el.offsetHeight, start: ((el.getBoundingClientRect().top + scrollY - top0) / total) * max }))
  })
  const rows = []
  const settle = async () => { await sleep(900) }
  for (let i = 1; i < chapters.length; i++) {
    const boundary = chapters[i].start
    // stand inside the previous chapter, then cross into the next one
    await page.evaluate((y) => scrollTo(0, y), Math.max(0, boundary - 120))
    await settle()
    const s = await snap()
    const a = await metrics()
    await page.evaluate((y) => scrollTo(0, y), boundary + 120)
    await settle()
    const b = await metrics()
    const d = await since(s)
    const histogram = {}
    for (const c of d.commits) for (const [k, v] of Object.entries(c.names ?? {})) histogram[k] = (histogram[k] ?? 0) + v
    rows.push({ into: chapters[i].id, ...commitSummary(d.commits), names: Object.keys(histogram).length ? Object.entries(histogram).sort((a, b) => b[1] - a[1]).slice(0, 12) : undefined, bursts: d.rects.length, loafLongest: r1(d.loaf.reduce((m, l) => Math.max(m, l.d), 0)), perf: delta(a, b) })
  }
  const all = rows.map((r) => r.commits)
  result.phases.chapters = {
    rows,
    commitsPerBoundaryMedian: median(all), commitsTotal: sum(all), fibersTotal: sum(rows.map((r) => r.fibers)), fibersPerBoundaryMedian: median(rows.map((r) => r.fibers)),
    renderMsTotal: rows.some((r) => r.renderMs != null) ? r2(sum(rows.map((r) => r.renderMs ?? 0))) : null,
  }
}

/* ---- scroll the whole journey by one synthesized gesture -------------------------------------------------- */
if (PHASES.includes('scroll')) {
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(1500)
  const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  const chapters = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#journey section[data-chapter]')]
    const top0 = secs[0].getBoundingClientRect().top + scrollY
    const sum = secs.reduce((a, el) => a + el.offsetHeight, 0)
    const max = document.documentElement.scrollHeight - innerHeight
    return secs.map((el) => {
      const start = ((el.getBoundingClientRect().top + scrollY - top0) / sum) * max
      return { id: el.dataset.chapter, start, end: start + (el.offsetHeight / sum) * max }
    })
  })
  const stop = Math.max(0, total - H * 1.2) // never push the portal: that leaves the page
  // A visitor scrolls with the pointer somewhere over the page: what passes under it is hovered.
  if (!PHONE) await page.mouse.move(W / 2, H / 2)
  await page.evaluate(() => __p.record(true))
  const s = await snap()
  const a = await metrics()
  const gesture = async () => {
    await cdp.send('Input.synthesizeScrollGesture', { x: W / 2, y: H / 2, yDistance: -stop, speed: PHONE ? 1800 : 1500, gestureSourceType: PHONE ? 'touch' : 'mouse', preventFling: true })
    await sleep(1200)
  }
  const tr = GPU ? await traced(gesture) : (await gesture(), null)
  const b = await metrics()
  await page.evaluate(() => __p.record(false))
  const d = await since(s)
  const per = {}
  for (const c of chapters) {
    const fr = d.frames.filter(([, , sy]) => sy >= c.start && sy < c.end).map(([, x]) => x)
    per[c.id] = frameStats(fr)
  }
  const frames = d.frames.map(([, x]) => x)
  result.phases.scroll = {
    px: stop, all: frameStats(frames), perChapter: per, perf: delta(a, b),
    layoutsPerFrame: r2((b.LayoutCount - a.LayoutCount) / Math.max(1, frames.length)), styleRecalcsPerFrame: r2((b.RecalcStyleCount - a.RecalcStyleCount) / Math.max(1, frames.length)),
    ...commitSummary(d.commits), ...burstSummary(d.rects), loaf: loafSummary(d.loaf), longTasks: d.long.length, room: await room(),
    gpu: tr ? { gpuMs: tr.gpuMs, gpuMsPerFrame: r2(tr.gpuMs / Math.max(1, frames.length)), gpuMaxTaskMs: tr.gpuMaxMs, gpuTasks: tr.gpuTasks, mainTaskMs: tr.mainTaskMs } : null,
  }
}

/* ---- hover (or tap) sweeps ------------------------------------------------------------------------------ */
if (PHASES.includes('hover')) {
  await page.evaluate(() => scrollTo(0, 0))
  const sweep = async (anchor, selector, label, limit = 24) => {
    await page.evaluate((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), anchor)
    await sleep(2200)
    const boxes = await page.evaluate(({ sel, n }) => [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.top > 80 && r.bottom < innerHeight - 60 }).slice(0, n).map((el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2] }), { sel: selector, n: limit })
    if (!boxes.length) { result.phases[label] = { targets: 0 }; return }
    const r0 = await room()
    const s = await snap()
    const a = await metrics()
    const per = []
    for (const [x, y] of boxes) {
      const m0 = await metrics()
      if (PHONE) await page.touchscreen.tap(x, y)
      else await page.mouse.move(x, y, { steps: 3 })
      await sleep(PHONE ? 220 : 90)
      const m1 = await metrics()
      per.push((m1.TaskDuration - m0.TaskDuration) * 1000)
    }
    await sleep(500)
    const b = await metrics()
    const d = await since(s)
    const r1s = await room()
    result.phases[label] = {
      targets: boxes.length, taskMsPerTargetMedian: r1(median(per)), taskMsPerTargetMax: r1(Math.max(...per)), perf: delta(a, b),
      ...commitSummary(d.commits), commitsPerTarget: r2(d.commits.length / boxes.length), ...burstSummary(d.rects), burstsPerTarget: r2(d.rects.length / boxes.length),
      events: eventSummary(d.events), loaf: loafSummary(d.loaf), longTasks: d.long.length,
      roomRedraws: r1s && r0 ? r1s.draws - r0.draws : null, avoidRowsChanged: JSON.stringify(r1s?.avoid) !== JSON.stringify(r0?.avoid), fieldBefore: r0?.field, fieldAfter: r1s?.field,
    }
    if (!PHONE) await page.mouse.move(2, 2)
  }
  await sweep('#chapter-toolbox', '#chapter-toolbox [data-tech] button', 'hoverToolbox')
  if (!PHONE) await sweep('#chapter-universe', '#chapter-universe button[data-tier]', 'hoverUniverse')
}

/* ---- the index overlay ---------------------------------------------------------------------------------- */
if (PHASES.includes('index')) {
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(1800)
  await page.evaluate(() => scrollTo(0, 3000))
  await sleep(1800)
  const before = await page.evaluate(() => ({ cw: document.documentElement.clientWidth, iw: innerWidth, bodyOverflow: document.body.style.overflow }))
  const r0 = await room()
  const cachePoll = []
  const pollRoom = async (ms) => { const end = Date.now() + ms; while (Date.now() < end) { const r = await room(); if (r) cachePoll.push(r.cache); await sleep(40) } }
  await page.evaluate(() => __p.record(true))
  const s = await snap()
  const run = async () => {
    await page.keyboard.press('i')
    await pollRoom(1100)
    const during = await page.evaluate(() => ({ cw: document.documentElement.clientWidth, iw: innerWidth, bodyOverflow: document.body.style.overflow }))
    await page.keyboard.press('Escape')
    await pollRoom(1100)
    const after = await page.evaluate(() => ({ cw: document.documentElement.clientWidth, iw: innerWidth }))
    return { during, after }
  }
  const tr = GPU ? await traced(run) : { value: await run() }
  await page.evaluate(() => __p.record(false))
  const d = await since(s)
  const r2s = await room()
  result.phases.index = {
    before, ...tr.value, widthChanged: tr.value.during.cw !== before.cw,
    lightCacheRestarted: cachePoll.some((c) => c && c.done < c.total), roomRedraws: r2s && r0 ? r2s.draws - r0.draws : null,
    frames: frameStats(d.frames.map(([, x]) => x)), ...commitSummary(d.commits), ...burstSummary(d.rects), loaf: loafSummary(d.loaf),
    gpu: GPU ? { gpuMs: tr.gpuMs, gpuMaxMs: tr.gpuMaxMs, gpuTasks: tr.gpuTasks, mainTaskMs: tr.mainTaskMs } : null,
  }
}

result.pageErrors = pageErrors.slice(0, 8)
result.wallSeconds = (Date.now() - t0) / 1000
fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, (k, v) => (k === 'room' || k === 'rows' || k === 'perChapter' ? undefined : v), 1))
await browser.close()
