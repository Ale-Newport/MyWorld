/* Homepage performance baseline: cold load and the whole scroll journey.

     QA_BASE=http://localhost:3220 QA_OUT=.qa/runs/perf2/baseline \
       node scripts/qa/perf-home.mjs [--runs 3] [--scenarios desktop,laptop,tablet,phone,phone-raw,desktop-slow]
                                     [--out perf-home.json]

   Always against a PRODUCTION build (next build && next start), never the dev server.
   One JSON document goes to stdout (progress to stderr) and to QA_OUT/<out>.

   Per scenario, per repetition (a fresh Chromium profile directory = a cold on-disk HTTP cache):

     load      FCP, LCP, CLS, TTFB, DOMContentLoaded/load, live-room ready (data-ready flip
               on the room layer, same probe as home-perf.mjs), long tasks and TBT in the
               first 10 s, long animation frames with their top scripts, bytes by kind
               (js/css/html/image/font/json/glb/...), request count, JS heap, /world requests
               made while the homepage loads (must be 0), DOM node count.
     scrollDown  the whole journey top -> just short of the foot at 1500 px/s (wheel on
               desktop/laptop, touch swipe on tablet/phone), via Input.synthesizeScrollGesture:
               rAF frame time p50/p95/p99/max, frames > 25/34/50/100 ms, missed frames,
               worst gaps with the scrollY they happened at, long tasks, long animation frames,
               layout/style recalc counts and durations, script time, CLS, bytes fetched,
               room quality tier before/after.
     scrollUp  the same back to the top at 4000 px/s.
     index     (non-touch) keydown 'i' -> chapter index painted, Escape -> closed.

   The foot of the page is never pushed here (that starts the world; see perf-world.mjs).
   Throttled scenarios use Chrome's 4x CPU slowdown and the Lighthouse slow-4G profile
   (1.6 Mbps, 150 ms RTT). Nothing is estimated: a figure the browser did not report is null. */
import {
  BASE, PROFILES, parseArgs, chromeVersion, session, throttle, pfInit, perfMetrics, metricDelta, heapSampler,
  netCollector, issueCollector, dedupe, scrollGesture, frameStats, taskStats, loafStats, summarize, waitForQuiet,
  environment, emit, sleep, log,
} from './perf-lib.mjs'

const args = parseArgs()
const RUNS = Number(args.runs ?? 3)
const OBSERVE_MS = Number(args.observe ?? 10000)
const SCENARIOS = {
  desktop: { profile: 'desktop', cpu: 1, net: null },
  laptop: { profile: 'laptop', cpu: 1, net: null },
  tablet: { profile: 'tablet', cpu: 1, net: null },
  phone: { profile: 'phone', cpu: 4, net: 'slow4g' },
  'phone-raw': { profile: 'phone', cpu: 1, net: null },
  'desktop-slow': { profile: 'desktop', cpu: 4, net: 'slow4g' },
}
const wanted = String(args.scenarios ?? Object.keys(SCENARIOS).join(',')).split(',')
const WORLD = /\/archipelago\/|\/api\/world\/|\/world2\/|^\/world(\?|$)/

/** Home-only page hook: when does the live room flip data-ready (its first lit frame is on screen)? */
function roomHook() {
  const w = window
  const watch = () => {
    const host = document.querySelector('[data-room-host], div[data-ready][data-fallback]')
    if (host && host.getAttribute('data-ready') === 'true' && !w.__perfRoomReady) w.__perfRoomReady = performance.now()
  }
  new MutationObserver(watch).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-ready'], childList: true })
}

const sum = (rows, from, to) => rows.filter(([s]) => s >= from && s <= to).reduce((a, [, v]) => a + v, 0)

async function scrollPass(page, cdp, net, sc, { name, to, speed }) {
  const prof = PROFILES[sc.profile]
  const touch = prof.touch
  const y0 = await page.evaluate(() => window.scrollY)
  const room0 = await page.evaluate(() => { const r = window.__room?.(); return r ? { quality: r.quality, dpr: r.dpr, leaves: r.leaves } : null })
  await page.evaluate(() => window.__pf.frameStart(true))
  const m0 = await perfMetrics(cdp)
  const tStart = await page.evaluate(() => performance.now())
  await scrollGesture(cdp, { x: prof.viewport.width / 2, y: prof.viewport.height / 2, dy: to - y0, speed, touch })
  await sleep(700) // Lenis' easing tail
  const tEnd = await page.evaluate(() => performance.now())
  const m1 = await perfMetrics(cdp)
  const rec = await page.evaluate(() => { const r = window.__pf.frameStop(); return { ...r, pf: { longTasks: window.__pf.longTasks, loaf: window.__pf.loaf, shifts: window.__pf.shifts }, y1: window.scrollY, room: window.__room ? (({ quality, dpr, leaves }) => ({ quality, dpr, leaves }))(window.__room()) : null } })
  const gaps = []
  for (let i = 1; i < rec.stamps.length; i++) gaps.push([rec.stamps[i] - rec.stamps[i - 1], i])
  gaps.sort((a, b) => b[0] - a[0])
  const worst = gaps.slice(0, 6).map(([d, i]) => ({ gapMs: Math.round(d), atMs: Math.round(rec.stamps[i] - tStart), scrollY: rec.y ? Math.round(rec.y[i & ~3] || rec.y[Math.max(0, (i & ~3) - 4)] || 0) : null }))
  return {
    name, speedPxPerS: speed, fromY: Math.round(y0), toY: Math.round(rec.y1),
    frame: frameStats(rec.stamps),
    worstGaps: worst,
    tasks: taskStats(rec.pf.longTasks, tStart, tEnd),
    loaf: loafStats(rec.pf.loaf, tStart, tEnd),
    cls: Math.round(sum(rec.pf.shifts, tStart, tEnd) * 10000) / 10000,
    main: metricDelta(m0, m1),
    layoutPerFrame: Math.round(((m1.LayoutCount - m0.LayoutCount) / Math.max(1, rec.stamps.length)) * 100) / 100,
    stylePerFrame: Math.round(((m1.RecalcStyleCount - m0.RecalcStyleCount) / Math.max(1, rec.stamps.length)) * 100) / 100,
    bytes: net.summarise(tStart, tEnd),
    roomBefore: room0,
    roomAfter: rec.room,
  }
}

async function indexOverlay(page) {
  const probe = async (open, act) => {
    await page.evaluate(arm, open)
    await act()
    return page.evaluate(() => window.__idx)
  }
  const arm = (open) => {
    window.__idx = new Promise((resolve) => {
      const t = { in: null, dom: null, paint: null }
      const el = () => document.querySelector('[aria-label="Chapter index"]')
      window.addEventListener('keydown', (e) => { t.in = e.timeStamp }, { capture: true, once: true })
      const mo = new MutationObserver(() => {
        if (t.dom || el()?.getAttribute('data-open') !== String(open)) return
        t.dom = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => { t.paint = performance.now(); mo.disconnect(); resolve(t) }))
      })
      mo.observe(el(), { attributes: true, attributeFilter: ['data-open'] })
      setTimeout(() => { mo.disconnect(); resolve(t) }, 5000)
    })
  }
  const a = await probe(true, () => page.keyboard.press('i'))
  await sleep(900)
  const b = await probe(false, () => page.keyboard.press('Escape'))
  const f = (t) => (t.in != null && t.paint != null ? Math.round((t.paint - t.in) * 10) / 10 : null)
  const d = (t) => (t.in != null && t.dom != null ? Math.round((t.dom - t.in) * 10) / 10 : null)
  return { openToDomMs: d(a), openToPaintMs: f(a), closeToDomMs: d(b), closeToPaintMs: f(b) }
}

async function rep(version, name, sc, i) {
  const prof = PROFILES[sc.profile]
  const machine = await waitForQuiet()
  const load = machine.loadavgBefore
  const { ctx, page, cdp, close } = await session(sc.profile, version)
  await ctx.addInitScript(pfInit)
  await ctx.addInitScript(roomHook)
  const issues = issueCollector(page)
  await throttle(cdp, sc)
  await cdp.send('Performance.enable')
  const net = await netCollector(cdp)
  const heap = heapSampler(cdp)
  const m0 = await perfMetrics(cdp)
  const result = { rep: i + 1, loadavgBefore: load, machine }
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 })
    net.setOrigin(await page.evaluate(() => performance.timeOrigin))
    await page.waitForFunction(() => window.__perfRoomReady, null, { timeout: 90000, polling: 100 }).catch(() => {})
    await page.waitForFunction((ms) => performance.now() >= ms, OBSERVE_MS, { timeout: 90000, polling: 200 })
    const m1 = await perfMetrics(cdp)
    const page0 = await page.evaluate(() => {
      const pf = window.__pf
      const nav = performance.getEntriesByType('navigation')[0]
      const r = window.__room?.()
      return {
        fcp: pf.fcp, lcp: pf.lcp, lcpEl: pf.lcpEl, ttfb: nav.responseStart, dcl: nav.domContentLoadedEventEnd, loadEvent: nav.loadEventEnd,
        roomReady: window.__perfRoomReady ?? null,
        longTasks: pf.longTasks, loaf: pf.loaf, shifts: pf.shifts,
        dom: document.getElementsByTagName('*').length,
        scrollHeight: document.documentElement.scrollHeight,
        room: r ? { quality: r.quality, dpr: r.dpr, leaves: r.leaves, draws: r.draws, gpu: r.gpu, composition: r.composition, milestones: r.milestones, timings: r.timings } : null,
        env: { pointerCoarse: matchMedia('(pointer: coarse)').matches, hoverNone: matchMedia('(hover: none)').matches, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight, reduced: matchMedia('(prefers-reduced-motion: reduce)').matches },
      }
    })
    const tasks = taskStats(page0.longTasks, 0, OBSERVE_MS)
    const bytes = net.summarise(-Infinity, Infinity)
    const worldReqs = net.urls().filter((u) => WORLD.test(new URL(u).pathname))
    result.load = {
      fcpMs: Math.round(page0.fcp), lcpMs: Math.round(page0.lcp), lcpElement: page0.lcpEl, ttfbMs: Math.round(page0.ttfb), dclMs: Math.round(page0.dcl), loadMs: Math.round(page0.loadEvent),
      roomReadyMs: page0.roomReady == null ? null : Math.round(page0.roomReady),
      cls: Math.round(sum(page0.shifts, 0, OBSERVE_MS) * 10000) / 10000,
      tasks, loaf: loafStats(page0.loaf, 0, OBSERVE_MS),
      main: metricDelta(m0, m1),
      bytes, worldRequests: worldReqs.length, domNodes: page0.dom, scrollHeight: page0.scrollHeight,
    }
    result.env = page0.env
    result.room = page0.room
    // The journey.
    const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
    const stopShort = Math.max(0, maxY - prof.viewport.height * 1.2)
    result.scrollDown = await scrollPass(page, cdp, net, sc, { name: 'down', to: stopShort, speed: 1500 })
    result.scrollUp = await scrollPass(page, cdp, net, sc, { name: 'up', to: 0, speed: 4000 })
    result.worldRequestsAfterScroll = net.urls().filter((u) => WORLD.test(new URL(u).pathname)).length
    if (!prof.touch) { await sleep(500); result.index = await indexOverlay(page) }
  } catch (e) {
    result.error = String(e).slice(0, 400)
  }
  result.heap = await heap.stop()
  result.issues = { console: dedupe(issues.console), pageerrors: dedupe(issues.pageerrors), http: dedupe(issues.http), requestfailed: dedupe(issues.requestfailed), cdpFailed: net.failed.slice(0, 8) }
  await close()
  log(`${name} #${i + 1}: fcp ${result.load?.fcpMs} lcp ${result.load?.lcpMs} room ${result.load?.roomReadyMs} tbt ${result.load?.tasks?.tbt} | down p50/p95/max ${result.scrollDown?.frame.p50}/${result.scrollDown?.frame.p95}/${result.scrollDown?.frame.max} | load ${load[0]}${result.error ? ' ERROR ' + result.error : ''}`)
  return result
}

const version = await chromeVersion()
const doc = { harness: 'perf-home', env: environment(version), runsPerScenario: RUNS, observeMs: OBSERVE_MS, scenarios: {} }
for (const name of wanted) {
  const sc = SCENARIOS[name]
  if (!sc) { log(`unknown scenario ${name}`); continue }
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(await rep(version, name, sc, i))
  const ok = runs.filter((r) => !r.error && r.load)
  doc.scenarios[name] = {
    profile: PROFILES[sc.profile].label, cpuThrottle: sc.cpu, network: sc.net ?? 'none (localhost)',
    summary: summarize(ok, (r) => ({ load: { ...r.load, bytes: undefined, tasks: r.load.tasks, loaf: { count: r.load.loaf.count, longest: r.load.loaf.longest, blockingMs: r.load.loaf.blockingMs }, jsKb: r.load.bytes.byKind.js?.kb, cssKb: r.load.bytes.byKind.css?.kb, imageKb: r.load.bytes.byKind.image?.kb, fontKb: r.load.bytes.byKind.font?.kb, htmlKb: r.load.bytes.byKind.html?.kb, jsonKb: r.load.bytes.byKind.json?.kb, otherKb: r.load.bytes.byKind.other?.kb, transferKb: r.load.bytes.transferKb, requests: r.load.bytes.requests }, scrollDown: { ...r.scrollDown, worstGaps: undefined, loaf: { count: r.scrollDown.loaf.count, blockingMs: r.scrollDown.loaf.blockingMs, longest: r.scrollDown.loaf.longest }, bytes: { transferKb: r.scrollDown.bytes.transferKb, requests: r.scrollDown.bytes.requests } }, scrollUp: { ...r.scrollUp, worstGaps: undefined, loaf: { count: r.scrollUp.loaf.count, blockingMs: r.scrollUp.loaf.blockingMs, longest: r.scrollUp.loaf.longest }, bytes: { transferKb: r.scrollUp.bytes.transferKb, requests: r.scrollUp.bytes.requests } }, index: r.index, heap: r.heap })),
    failedRuns: runs.length - ok.length,
    runs,
  }
}
emit(doc, args.out ?? 'perf-home.json')
