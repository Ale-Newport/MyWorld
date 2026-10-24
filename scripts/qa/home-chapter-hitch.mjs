/* The homepage scroll journey, frame by frame, with the cause of every long frame.

     QA_BASE=http://localhost:3295 node scripts/qa/home-chapter-hitch.mjs
       [--profile phone|tablet|desktop|laptop]  (default phone: 390x844 @3x touch)
       [--cpu 4] [--net slow4g|fast4g|none]     (default 4 / slow4g, the acceptance scenario)
       [--speed 1500] [--runs 3] [--cpuprofile] [--maps <dir of .next/static>] [--assert] [--out file.json]

   A fresh Chromium profile per run. The page loads, the room is ready, the page waits for its idle work
   to settle, then the whole journey is scrolled top to just short of the foot at --speed px/s, recording
   every rAF stamp with the scrollY it happened at. Reported per run: frame p50/p99/max, frames over
   34/50/100 ms, and every gap over 34 ms with the chapter it happened in and the script the browser's
   long-animation-frame entry blames (sourceURL, char position, function, duration, forced layout).
   With --cpuprofile the V8 sampling profiler (CDP Profiler, 100 us) runs through the scroll and each
   long gap gets the functions that held the main thread in it, self and inclusive, mapped back through
   the build's source maps when --maps points at the .next/static directory of the served build.

   --assert turns it into the regression check: exit 1 when a run has a frame over --max-frame ms
   (default 100 at the acceptance scenario), more than --max-over50 frames over 50 ms (default 4), or the room's
   reading of the page ran a slice longer than --max-slice ms (default 30: its budget plus one piece, at 4x CPU)
   or a plan of the plants a piece longer than that. The first two are the visitor's frames and move with the
   machine's load; the slice figures are CPU-bound and do not, which is why the check carries both. The cause these
   guard: a chapter's animation mounts a screen or two ahead of the visitor, the room reads the page's copy again,
   and when that was one task it was 130 to 180 ms of a scroll (at Toolbox and at Universe entry).
   Against a PRODUCTION build only. */
import fs from 'node:fs'
import path from 'node:path'
import {
  BASE, PROFILES, parseArgs, chromeVersion, session, throttle, pfInit, scrollGesture, frameStats, loafStats, taskStats, sleep, log, stats, waitForQuiet,
} from './perf-lib.mjs'

const args = parseArgs()
const PROFILE = String(args.profile ?? 'phone')
const CPU = Number(args.cpu ?? 4)
const NET = args.net === 'none' ? null : String(args.net ?? 'slow4g')
const SPEED = Number(args.speed ?? 1500)
const RUNS = Number(args.runs ?? 3)
const CPUPROFILE = !!args.cpuprofile
const MAPS = args.maps ? path.resolve(String(args.maps)) : null
const ASSERT = !!args.assert
const MAX_FRAME = Number(args['max-frame'] ?? 100)
const MAX_OVER50 = Number(args['max-over50'] ?? 4)
const MAX_SLICE = Number(args['max-slice'] ?? 30)
const prof = PROFILES[PROFILE]
if (!prof) throw new Error(`unknown profile ${PROFILE}`)

let traceMapping = null
if (MAPS) traceMapping = await import('@jridgewell/trace-mapping')
const mapCache = new Map()
/** Original position of a minified chunk location, or the minified one if there is no map. */
function original(url, line, col) {
  if (!traceMapping || !url) return `${(url || '').split('/').slice(-1)[0]}:${line}:${col}`
  const file = url.replace(/^.*\/_next\/static\//, '')
  let map = mapCache.get(file)
  if (map === undefined) {
    try {
      // Turbopack names the map in the chunk's last line, not after the chunk.
      const code = fs.readFileSync(path.join(MAPS, file), 'utf8')
      const name = /\/\/# sourceMappingURL=(\S+)\s*$/.exec(code)?.[1] ?? `${path.basename(file)}.map`
      map = new traceMapping.TraceMap(fs.readFileSync(path.join(MAPS, path.dirname(file), name), 'utf8'))
    } catch { map = null }
    mapCache.set(file, map)
  }
  if (!map) return `${file.split('/').slice(-1)[0]}:${line}:${col}`
  const o = traceMapping.originalPositionFor(map, { line: line + 1, column: col })
  if (!o.source) return `${file.split('/').slice(-1)[0]}:${line}:${col}`
  return `${o.source.replace(/^.*?(src\/|node_modules\/)/, '$1')}:${o.line}${o.name ? ' ' + o.name : ''}`
}

/** Self and inclusive time per function inside [fromMs, toMs] (page clock) of a V8 CPU profile. */
function analyse(profile, toPage, fromMs, toMs) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id)
  const self = new Map()
  const incl = new Map()
  let t = profile.startTime
  const key = (n) => {
    const f = n.callFrame
    return `${f.functionName || '(anonymous)'} @ ${original(f.url, f.lineNumber, f.columnNumber)}`
  }
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] ?? 0
    t += dt
    const at = toPage(t)
    if (at < fromMs || at > toMs) continue
    const id = profile.samples[i]
    const n = nodes.get(id)
    if (!n || /^\((root|program|idle)\)$/.test(n.callFrame.functionName)) continue
    const k = key(n)
    self.set(k, (self.get(k) ?? 0) + dt / 1000)
    const seen = new Set()
    for (let p = id; p != null; p = parent.get(p)) {
      const pn = nodes.get(p)
      if (!pn || /^\((root|program|idle)\)$/.test(pn.callFrame.functionName)) continue
      const pk = key(pn)
      if (seen.has(pk)) continue
      seen.add(pk)
      incl.set(pk, (incl.get(pk) ?? 0) + dt / 1000)
    }
  }
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${Math.round(v)} ms  ${k}`)
  return { self: top(self, 6), inclusive: top(incl, 12) }
}

async function run(version, i) {
  const machine = await waitForQuiet({ maxBusy: 0.55, timeoutMs: 60000 })
  const { page, cdp, close } = await session(PROFILE, version)
  await page.context().addInitScript(pfInit)
  await throttle(cdp, { cpu: CPU, net: NET })
  await cdp.send('Performance.enable')
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  const out = { run: i + 1, loadavg: machine.loadavgBefore }
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 })
    await page.waitForFunction(() => window.__room?.().milestones?.ready != null, null, { timeout: 90000, polling: 100 })
    // The idle work of a cold page (lazy chunks, the room's settling) is part of what a visitor meets, so wait a visitor's beat, not a lab's.
    await sleep(Number(args.settle ?? 3000))
    const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
    const chapters = await page.evaluate(() => [...document.querySelectorAll('#journey section[data-chapter]')].map((s) => [s.dataset.chapter, Math.round(s.getBoundingClientRect().top + scrollY), Math.round(s.offsetHeight)]))
    const to = Math.max(0, maxY - prof.viewport.height * 1.2)
    await page.evaluate(() => { window.__pf.frameStart(true); window.__pf.loaf.length = 0; window.__pf.longTasks.length = 0 })
    if (CPUPROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); await cdp.send('Profiler.start') }
    const tStart = await page.evaluate(() => performance.now())
    await scrollGesture(cdp, { x: prof.viewport.width / 2, y: prof.viewport.height / 2, dy: to, speed: SPEED, touch: prof.touch })
    await sleep(700)
    const tEnd = await page.evaluate(() => performance.now())
    // The two clocks: CDP's monotonic seconds against the page's performance.now().
    const { metrics } = await cdp.send('Performance.getMetrics')
    const nowPage = await page.evaluate(() => performance.now())
    const monoUs = metrics.find((m) => m.name === 'Timestamp').value * 1e6
    const offsetUs = monoUs - nowPage * 1000
    let profile = null
    if (CPUPROFILE) profile = (await cdp.send('Profiler.stop')).profile
    const rec = await page.evaluate(() => {
      const r = window.__pf.frameStop()
      return { ...r, loaf: window.__pf.loaf, tasks: window.__pf.longTasks }
    })
    // The scroll is recorded from the first frame on; keep the frames of the gesture.
    const frames = []
    for (let k = 0; k < rec.stamps.length; k++) if (rec.stamps[k] >= tStart && rec.stamps[k] <= tEnd) frames.push(k)
    const stamps = frames.map((k) => rec.stamps[k])
    const chapterAt = (y) => { let c = '-'; for (const [id, top] of chapters) if (y >= top - prof.viewport.height) c = id; return c }
    const gaps = []
    for (let k = 1; k < frames.length; k++) {
      const d = stamps[k] - stamps[k - 1]
      if (d > 34) {
        // scrollY is sampled every 4th frame: take the nearest recorded one before.
        const idx = frames[k] & ~3
        const y = Math.round(rec.y[idx] || rec.y[Math.max(0, idx - 4)] || 0)
        const from = stamps[k - 1], toT = stamps[k]
        const loaf = rec.loaf.filter(([s, dur]) => s < toT && s + dur > from - 1).map(([s, dur, block, rs, ss, sc]) => ({ start: Math.round(s), dur: Math.round(dur), blocking: Math.round(block), styleStartAfter: Math.round(ss - s), renderStartAfter: Math.round(rs - s), script: sc }))
        gaps.push({ gapMs: Math.round(d), atMs: Math.round(stamps[k] - tStart), scrollY: y, chapterNear: chapterAt(y), loaf, profile: profile ? analyse(profile, (us) => (us - offsetUs) / 1000, from, toT) : undefined })
      }
    }
    gaps.sort((a, b) => b.gapMs - a.gapMs)
    out.frame = frameStats(stamps)
    out.tasks = taskStats(rec.tasks, tStart, tEnd)
    out.loaf = loafStats(rec.loaf, tStart, tEnd)
    out.gaps = gaps.slice(0, 8)
    out.chapters = chapters
    // How the room's reads and plant plans were cut (probes in HomeRoom and the engine).
    out.room = await page.evaluate(() => ({ read: window.__roomRead ?? null, replantLongest: window.__room?.().timings.replantLongest ?? null, replantSlices: window.__room?.().timings.replantSlices ?? null, relights: window.__room?.().timings.relights ?? null }))
    out.reachedY = Math.round(await page.evaluate(() => scrollY))
  } catch (e) {
    out.error = String(e).slice(0, 400)
  }
  out.pageerrors = errors
  await close()
  log(`run ${i + 1}: room ${JSON.stringify(out.room)}`)
  log(`run ${i + 1}: max ${out.frame?.max} p99 ${out.frame?.p99} >34:${out.frame?.over34} >50:${out.frame?.over50} >100:${out.frame?.over100} | worst ${out.gaps?.slice(0, 3).map((g) => `${g.gapMs}ms@${g.scrollY}(${g.chapterNear})`).join(' ')}${out.error ? ' ERROR ' + out.error : ''}`)
  return out
}

const version = await chromeVersion()
const runs = []
for (let i = 0; i < RUNS; i++) runs.push(await run(version, i))
const ok = runs.filter((r) => !r.error)
const doc = {
  harness: 'home-chapter-hitch', base: BASE, profile: prof.label, cpu: CPU, net: NET ?? 'none', speed: SPEED,
  summary: {
    max: stats(ok.map((r) => r.frame.max)), p99: stats(ok.map((r) => r.frame.p99)),
    over34: stats(ok.map((r) => r.frame.over34)), over50: stats(ok.map((r) => r.frame.over50)), over100: stats(ok.map((r) => r.frame.over100)),
  },
  runs,
}
const file = args.out ? String(args.out) : null
if (file) { fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true }); fs.writeFileSync(file, JSON.stringify(doc, null, 2)) }
console.log(JSON.stringify(doc.summary, null, 1))
if (ASSERT) {
  const bad = []
  for (const r of runs) {
    if (r.error) bad.push(`run ${r.run}: ${r.error}`)
    else {
      if (r.frame.max > MAX_FRAME) bad.push(`run ${r.run}: worst frame ${r.frame.max} ms > ${MAX_FRAME}`)
      if (r.frame.over50 > MAX_OVER50) bad.push(`run ${r.run}: ${r.frame.over50} frames over 50 ms > ${MAX_OVER50}`)
      if (r.pageerrors.length) bad.push(`run ${r.run}: page errors ${r.pageerrors.join(' | ')}`)
      if (!r.room?.read) bad.push(`run ${r.run}: the room's read probe is missing`)
      else if (r.room.read.longestSlice > MAX_SLICE) bad.push(`run ${r.run}: a read slice took ${r.room.read.longestSlice} ms > ${MAX_SLICE}`)
      if (r.room?.replantLongest > MAX_SLICE) bad.push(`run ${r.run}: a plant-plan slice took ${r.room.replantLongest} ms > ${MAX_SLICE}`)
    }
  }
  if (bad.length) { console.log('FAIL\n' + bad.join('\n')); process.exitCode = 1 } else console.log(`PASS (${runs.length} runs: max frame <= ${MAX_FRAME} ms, <= ${MAX_OVER50} frames over 50 ms, read slices <= ${MAX_SLICE} ms)`)
}
