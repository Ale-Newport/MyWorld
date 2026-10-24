/* Shared helpers for the perf-*.mjs harnesses (perf-home, perf-world, perf-all).

   Everything here is measurement plumbing; nothing changes the page except a
   few passive observers installed before any page script runs:

     - PerformanceObserver for long tasks, long animation frames (with the
       script that caused them), layout shifts, LCP, paint and Event Timing;
     - world:phase / archipelago:* message logs (the transition state machine);
     - an optional input log (which element received which event, per frame);
     - an optional requestAnimationFrame recorder (frame cadence).

   Network bytes come from the DevTools Network domain on the page session, so
   requests made by same-origin iframes (the /world runtime) are included.

   Environment: QA_BASE (default http://localhost:3220), QA_OUT (default
   .qa/runs/perf2). Headless Chromium runs on the real GPU like lib.mjs. */
import { chromium } from 'playwright'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const BASE = (process.env.QA_BASE ?? 'http://localhost:3220').replace(/\/$/, '')
export const OUT = process.env.QA_OUT ?? path.resolve('.qa/runs/perf2')
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export const log = (...a) => console.error(...a)

/** `--key value` and `--flag` arguments. */
export function parseArgs(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

export function outPath(name) {
  fs.mkdirSync(OUT, { recursive: true })
  return path.join(OUT, name)
}

/* ---- profiles and throttles ------------------------------------------ */

export const PROFILES = {
  desktop: { label: 'desktop 1440x900 @1x', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, touch: false },
  laptop: { label: 'laptop 1280x800 @2x', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, touch: false },
  tablet: { label: 'tablet 834x1112 @2x touch', viewport: { width: 834, height: 1112 }, deviceScaleFactor: 2, touch: true },
  phone: { label: 'phone 390x844 @3x touch', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, touch: true },
}

export const NETWORKS = {
  // Chrome DevTools / Lighthouse presets: latency ms, bytes per second.
  slow4g: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  fast4g: { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 },
}

export const CHROME_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']

let versionMemo = null
/** The bundled Chromium's version (used for the mobile user agent and the report). */
export async function chromeVersion() {
  if (!versionMemo) {
    const b = await chromium.launch({ headless: true, args: CHROME_ARGS })
    versionMemo = b.version()
    await b.close()
  }
  return versionMemo
}

/** A fresh, real Chromium profile per repetition: a persistent context has an on-disk HTTP cache of
 *  normal size (Playwright's default throw-away contexts keep a ~10 MB in-memory cache that cannot hold
 *  the 17 MB world document, which would make every warm download pointless and misreport the loading
 *  path). A new profile directory is still a COLD cache. Returns { ctx, page, cdp, close }. */
export async function session(profile, version) {
  fs.mkdirSync(OUT, { recursive: true })
  const dir = fs.mkdtempSync(path.join(OUT, '.profile-'))
  const ctx = await chromium.launchPersistentContext(dir, { headless: true, args: CHROME_ARGS, ...contextOptions(profile, version) })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const cdp = await ctx.newCDPSession(page)
  return {
    ctx, page, cdp,
    close: async () => { await ctx.close().catch(() => {}); fs.rmSync(dir, { recursive: true, force: true }) },
  }
}

export function contextOptions(profile, version = '153.0.0.0') {
  version = String(version).replace(/^(\d+)\..*/, '$1.0.0.0')
  const p = PROFILES[profile]
  const o = { viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor }
  if (p.touch) {
    o.isMobile = true
    o.hasTouch = true
    o.userAgent = `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Mobile Safari/537.36`
  }
  return o
}

export async function throttle(cdp, { cpu = 1, net = null } = {}) {
  if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  if (net) {
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[net] })
  }
}

/* ---- statistics ------------------------------------------------------- */

const q = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : null)
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100)

export function stats(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y)
  if (!a.length) return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null }
  return { n: a.length, min: r2(a[0]), p50: r2(q(a, 0.5)), p95: r2(q(a, 0.95)), p99: r2(q(a, 0.99)), max: r2(a[a.length - 1]), mean: r2(a.reduce((x, y) => x + y, 0) / a.length) }
}

export function median(values) {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y)
  if (!a.length) return null
  const m = a.length >> 1
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2
}

/** Frame-to-frame deltas (ms) from rAF timestamps, summarised. */
export function frameStats(stamps) {
  const d = []
  for (let i = 1; i < stamps.length; i++) d.push(stamps[i] - stamps[i - 1])
  const s = stats(d)
  const ideal = 1000 / 60
  return {
    frames: stamps.length,
    ...s,
    over25: d.filter((x) => x > 25).length,
    over34: d.filter((x) => x > 33.4).length,
    over50: d.filter((x) => x > 50).length,
    over100: d.filter((x) => x > 100).length,
    // frames the 60 Hz display had to repeat
    missed: Math.round(d.reduce((a, x) => a + Math.max(0, Math.round(x / ideal) - 1), 0)),
    fps: d.length ? r2(1000 / (d.reduce((a, x) => a + x, 0) / d.length)) : null,
  }
}

/** Long-task entries [start, duration, container] → summary within [from, to]. */
export function taskStats(entries, from = -Infinity, to = Infinity) {
  const e = entries.filter(([s]) => s >= from && s <= to)
  return {
    count: e.length,
    longest: r2(e.reduce((a, [, d]) => Math.max(a, d), 0)),
    totalMs: r2(e.reduce((a, [, d]) => a + d, 0)),
    tbt: r2(e.reduce((a, [, d]) => a + Math.max(0, d - 50), 0)),
  }
}

/** Long animation frames [start, duration, blocking, renderStart, styleStart, script] in [from, to]. */
export function loafStats(entries, from = -Infinity, to = Infinity) {
  const e = entries.filter(([s]) => s >= from && s <= to)
  const byScript = new Map()
  for (const [, , , , , script] of e) {
    if (!script) continue
    const key = `${script[0]} ${script[1]}`
    const cur = byScript.get(key) ?? { ms: 0, forced: 0, n: 0 }
    cur.ms += script[2]; cur.forced += script[3]; cur.n++
    byScript.set(key, cur)
  }
  return {
    count: e.length,
    longest: r2(e.reduce((a, x) => Math.max(a, x[1]), 0)),
    blockingMs: r2(e.reduce((a, x) => a + (x[2] ?? 0), 0)),
    top: [...byScript].sort((a, b) => b[1].ms - a[1].ms).slice(0, 5).map(([k, v]) => ({ script: k, ms: Math.round(v.ms), forcedLayoutMs: Math.round(v.forced), n: v.n })),
  }
}

/* ---- machine noise ---------------------------------------------------- */

export const loadavg = () => os.loadavg().map((v) => Math.round(v * 100) / 100)

/** Fraction of all CPU cores busy (any process) over `ms`: the machine is shared with the user's other apps. */
export async function cpuBusy(ms = 1500) {
  const read = () => os.cpus().reduce((a, c) => { const t = Object.values(c.times).reduce((x, y) => x + y, 0); a.idle += c.times.idle; a.total += t; return a }, { idle: 0, total: 0 })
  const a = read()
  await sleep(ms)
  const b = read()
  return 1 - (b.idle - a.idle) / Math.max(1, b.total - a.total)
}

/** Waits (up to timeoutMs) for the machine to be mostly idle before a repetition; always returns what it saw. */
export async function waitForQuiet({ maxBusy = 0.5, timeoutMs = 150000 } = {}) {
  const t0 = Date.now()
  let busy = await cpuBusy()
  while (busy > maxBusy && Date.now() - t0 < timeoutMs) { await sleep(3000); busy = await cpuBusy() }
  return { busyBefore: r2(busy), waitedMs: Date.now() - t0, quiet: busy <= maxBusy, loadavgBefore: loadavg() }
}

/* ---- in-page instrumentation ------------------------------------------ */

/** Installed in EVERY frame before page scripts run (Playwright init script). */
export function pfInit() {
  if (window.__pf) return
  const pf = (window.__pf = {
    longTasks: [], loaf: [], shifts: [], events: [], phases: [], messages: [], input: [], logInput: false,
    lcp: 0, lcpSize: 0, fcp: 0, errors: [], rec: false, fr: null, fy: null, frN: 0, rd: [],
  })
  const watch = (type, cb, extra = {}) => {
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) cb(e) }).observe({ type, buffered: true, ...extra }) } catch { /* unsupported */ }
  }
  watch('longtask', (e) => pf.longTasks.push([e.startTime, e.duration, e.attribution?.[0]?.containerType ?? '']))
  watch('long-animation-frame', (e) => {
    if (pf.loaf.length >= 800) return
    let top = null
    for (const s of e.scripts ?? []) if (!top || s.duration > top.duration) top = s
    pf.loaf.push([e.startTime, e.duration, e.blockingDuration ?? 0, e.renderStart, e.styleAndLayoutStart,
      top ? [String(top.sourceURL || '').split('/').slice(-2).join('/'), top.sourceFunctionName || top.invoker || '', top.duration, top.forcedStyleAndLayoutDuration ?? 0] : null])
  })
  watch('layout-shift', (e) => { if (!e.hadRecentInput) pf.shifts.push([e.startTime, e.value]) })
  watch('largest-contentful-paint', (e) => { pf.lcp = e.startTime; pf.lcpSize = e.size; pf.lcpEl = (e.element?.tagName ?? '') + (e.url ? ' ' + e.url.slice(-60) : '') })
  watch('paint', (e) => { if (e.name === 'first-contentful-paint') pf.fcp = e.startTime })
  watch('event', (e) => { if (pf.events.length < 600) pf.events.push([e.name, e.startTime, e.processingStart - e.startTime, e.processingEnd - e.processingStart, e.duration, e.interactionId || 0]) }, { durationThreshold: 16 })
  window.addEventListener('world:phase', (e) => pf.phases.push([e.detail, performance.now()]))
  window.addEventListener('message', (e) => {
    const t = e.data && e.data.type
    if (typeof t === 'string' && t.startsWith('archipelago:')) pf.messages.push([t, performance.now(), e.data.stage ?? e.data.message ?? null, e.data.value ?? null])
  })
  const describe = (n) => {
    if (!n || !n.tagName) return String(n)
    const cls = typeof n.className === 'string' ? n.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''
    return `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${cls ? '.' + cls : ''}`
  }
  pf.describe = describe
  for (const type of ['click', 'pointerdown', 'keydown', 'wheel', 'touchstart']) {
    window.addEventListener(type, (e) => {
      if (!pf.logInput) return
      pf.input.push([type, Math.round(performance.now()), describe(e.target), type === 'keydown' ? e.code : '', location.pathname.split('/').slice(-2).join('/')])
    }, { capture: true, passive: true })
  }
  /** Records requestAnimationFrame timestamps (and scrollY every 4th frame when asked). */
  pf.frameStart = (trackScroll = false) => {
    pf.fr = new Float64Array(40000); pf.fy = trackScroll ? new Float32Array(40000) : null; pf.frN = 0; pf.rec = true
    const gen = (pf.gen = (pf.gen ?? 0) + 1)
    const tick = (t) => {
      if (!pf.rec || gen !== pf.gen) return
      if (pf.frN < pf.fr.length) {
        pf.fr[pf.frN] = t
        if (pf.fy && (pf.frN & 3) === 0) pf.fy[pf.frN] = window.scrollY
      }
      pf.frN++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }
  pf.frameStop = () => {
    pf.rec = false
    const n = Math.min(pf.frN, pf.fr.length)
    const stamps = Array.from(pf.fr.subarray(0, n))
    const y = pf.fy ? Array.from(pf.fy.subarray(0, n)) : null
    return { stamps, y }
  }
}

/* ---- CDP helpers ------------------------------------------------------ */

export async function perfMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]))
}

/** Differences of the Performance-domain counters that matter for main-thread cost. */
export function metricDelta(a, b) {
  const g = (k) => (b[k] ?? 0) - (a[k] ?? 0)
  return {
    wallS: r2(g('Timestamp')),
    layoutCount: g('LayoutCount'),
    recalcStyleCount: g('RecalcStyleCount'),
    layoutMs: r2(g('LayoutDuration') * 1000),
    recalcStyleMs: r2(g('RecalcStyleDuration') * 1000),
    scriptMs: r2(g('ScriptDuration') * 1000),
    taskMs: r2(g('TaskDuration') * 1000),
    heapUsedStartMB: r2((a.JSHeapUsedSize ?? 0) / 1048576),
    heapUsedEndMB: r2((b.JSHeapUsedSize ?? 0) / 1048576),
  }
}

/** Samples the JS heap (isolate-wide) in the background; stop() returns start/peak/end in MB. */
export function heapSampler(cdp, everyMs = 250) {
  let stop = false
  const s = { start: null, peak: 0, end: null, samples: 0 }
  const loop = (async () => {
    while (!stop) {
      try {
        const h = await cdp.send('Runtime.getHeapUsage')
        const mb = h.usedSize / 1048576
        if (s.start == null) s.start = mb
        s.peak = Math.max(s.peak, mb)
        s.end = mb
        s.samples++
      } catch { /* page closing */ }
      await sleep(everyMs)
    }
  })()
  return {
    peakNow: () => r2(s.peak),
    async stop() { stop = true; await loop; return { startMB: r2(s.start), peakMB: r2(s.peak), endMB: r2(s.end), samples: s.samples } },
  }
}

/* ---- network bytes by kind -------------------------------------------- */

const IMAGE_EXT = /\.(png|jpe?g|webp|avif|gif|svg|ico|ktx2|basis|hdr|exr|bmp)(\?|$)/i
function kindOf(url, mime = '', type = '') {
  const u = new URL(url)
  const p = u.pathname.toLowerCase()
  const world = /^\/(archipelago|world2|api\/world)\//.test(p)
  if (/\.wasm$/.test(p) || /wasm/.test(mime)) return 'wasm'
  if (/\.glb(\.gz)?$/.test(p) || /\.gltf$/.test(p) || /gltf/.test(mime)) return 'glb'
  if (/\.json(\.gz)?$/.test(p) || /json/.test(mime) || p.startsWith('/api/world/')) return 'json'
  if (/\.(mp3|ogg|wav|m4a|aac|opus|flac)$/.test(p) || mime.startsWith('audio/')) return 'audio'
  if (/\.(mp4|webm|mov|m4v)$/.test(p) || mime.startsWith('video/')) return 'video'
  if (/\.(woff2?|ttf|otf|eot)$/.test(p) || /font/.test(mime) || type === 'Font') return 'font'
  if (/\.(m?js)$/.test(p) || /javascript/.test(mime) || type === 'Script') return 'js'
  if (/\.css$/.test(p) || mime === 'text/css' || type === 'Stylesheet') return 'css'
  if (IMAGE_EXT.test(p) || mime.startsWith('image/') || p.startsWith('/_next/image') || type === 'Image') return world ? 'texture' : 'image'
  if (type === 'Document' || mime === 'text/html') return 'html'
  return 'other'
}

/** Per-request bookkeeping from the Network domain. After setOrigin(), times are ms on the top document's performance.now() clock. */
export async function netCollector(cdp) {
  await cdp.send('Network.enable')
  let origin = null
  const reqs = new Map()
  const done = []
  const failed = []
  cdp.on('Network.requestWillBeSent', (e) => {
    const prev = reqs.get(e.requestId)
    const rec = { url: e.request.url, type: e.type, t0: e.timestamp, wall: e.wallTime, encoded: 0, decoded: 0, status: 0, mime: '', cached: false, redirectFrom: prev?.url ?? null }
    reqs.set(e.requestId, rec)
  })
  cdp.on('Network.responseReceived', (e) => {
    const r = reqs.get(e.requestId)
    if (!r) return
    r.status = e.response.status
    r.mime = e.response.mimeType
    r.cached = !!(e.response.fromDiskCache || e.response.fromPrefetchCache || e.response.fromServiceWorker)
    r.protocol = e.response.protocol
  })
  cdp.on('Network.dataReceived', (e) => { const r = reqs.get(e.requestId); if (r) { r.decoded += e.dataLength; r.encoded += e.encodedDataLength } })
  cdp.on('Network.loadingFinished', (e) => {
    const r = reqs.get(e.requestId)
    if (!r) return
    r.encoded = e.encodedDataLength || r.encoded
    r.tEnd = e.timestamp
    r.kind = kindOf(r.url, r.mime, r.type)
    r.endWall = (r.wall + (e.timestamp - r.t0)) * 1000
    r.startWall = r.wall * 1000
    done.push(r)
  })
  cdp.on('Network.loadingFailed', (e) => {
    const r = reqs.get(e.requestId)
    if (r && !e.canceled) failed.push({ url: r.url.replace(BASE, ''), error: e.errorText, type: e.type })
  })
  const summarise = (from = -Infinity, to = Infinity, pred = null) => {
    for (const r of done) { r.endMs = origin == null ? null : r.endWall - origin; r.startMs = origin == null ? null : r.startWall - origin }
    const rows = done.filter((r) => (r.endMs == null || (r.endMs >= from && r.endMs <= to)) && (!pred || pred(r)))
    const byKind = {}
    for (const r of rows) {
      const k = (byKind[r.kind] ??= { n: 0, kb: 0, decodedKb: 0 })
      k.n++; k.kb += r.encoded / 1024; k.decodedKb += r.decoded / 1024
    }
    for (const k of Object.values(byKind)) { k.kb = Math.round(k.kb); k.decodedKb = Math.round(k.decodedKb) }
    return {
      requests: rows.length,
      transferKb: Math.round(rows.reduce((a, r) => a + r.encoded, 0) / 1024),
      byKind,
      top: [...rows].sort((a, b) => b.encoded - a.encoded).slice(0, 8).map((r) => ({ url: r.url.replace(BASE, '').slice(0, 110), kb: Math.round(r.encoded / 1024), ms: r.endMs == null ? null : Math.round(r.endMs - (r.startMs ?? r.endMs)), status: r.status })),
      cachedHits: rows.filter((r) => r.cached).length,
      notModified: rows.filter((r) => r.status === 304).length,
    }
  }
  return {
    done,
    failed,
    summarise,
    /** performance.timeOrigin of the top document, so request times line up with page marks. */
    setOrigin: (v) => { origin = v },
    count: () => reqs.size,
    urls: () => [...reqs.values()].map((r) => r.url),
  }
}

/** Console warnings/errors, uncaught exceptions, HTTP failures: for the "anomalies" section. */
export function issueCollector(page) {
  const issues = { console: [], pageerrors: [], http: [], requestfailed: [] }
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') issues.console.push(`${m.type()}: ${m.text().slice(0, 220)}`)
  })
  page.on('pageerror', (e) => issues.pageerrors.push(String(e).slice(0, 300)))
  page.on('response', (r) => { if (r.status() >= 400) issues.http.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 140)}`) })
  page.on('requestfailed', (r) => {
    const err = r.failure()?.errorText ?? ''
    if (!/ERR_ABORTED/.test(err)) issues.requestfailed.push(`${err} ${r.url().replace(BASE, '').slice(0, 140)}`)
  })
  return issues
}

export function dedupe(list, max = 12) {
  const counts = new Map()
  for (const l of list) counts.set(l, (counts.get(l) ?? 0) + 1)
  return [...counts].slice(0, max).map(([t, n]) => (n > 1 ? `${t}  (x${n})` : t))
}

/* ---- gestures --------------------------------------------------------- */

/** Wheel (mouse) or touch scroll of dy pixels at `speed` px/s through DevTools. Resolves when the gesture ended. */
export async function scrollGesture(cdp, { x, y, dy, speed, touch = false }) {
  await cdp.send('Input.synthesizeScrollGesture', { x, y, yDistance: -dy, speed, gestureSourceType: touch ? 'touch' : 'mouse', preventFling: true })
}

export const touchSender = (cdp) => {
  const send = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y, id = 0]) => ({ x, y, id })) })
  return { down: (...p) => send('touchStart', p), move: (...p) => send('touchMove', p), up: () => send('touchEnd', []) }
}

/* ---- aggregation ------------------------------------------------------ */

/** Flattens nested numeric leaves to dotted keys. */
export function flatten(obj, prefix = '', out = {}) {
  if (obj == null) return out
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v
    else if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out)
  }
  return out
}

/** Median / min / max over runs for every numeric leaf found in at least one run. */
export function summarize(runs, pick = (r) => r) {
  const flat = runs.map((r) => flatten(pick(r)))
  const keys = [...new Set(flat.flatMap((f) => Object.keys(f)))]
  const out = {}
  for (const k of keys) {
    const v = flat.map((f) => f[k]).filter((x) => x != null)
    out[k] = { median: r2(median(v)), min: r2(Math.min(...v)), max: r2(Math.max(...v)), n: v.length }
  }
  return out
}

export function environment(version) {
  return {
    date: new Date().toISOString(),
    base: BASE,
    chromium: version,
    cache: 'fresh persistent Chromium profile per repetition (cold on-disk HTTP cache)',
    node: process.version,
    cpus: os.cpus().length,
    loadavgAtStart: loadavg(),
  }
}

export function emit(doc, file) {
  fs.mkdirSync(OUT, { recursive: true })
  const text = JSON.stringify(doc, null, 2)
  if (file) fs.writeFileSync(path.join(OUT, file), text)
  process.stdout.write(text + '\n')
}
