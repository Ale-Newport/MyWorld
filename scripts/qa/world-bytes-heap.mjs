/* What the ready player keeps of the world document and the asset definitions, and how high the JS heap goes while it starts on a slow phone.

     QA_BASE=http://localhost:3327 node scripts/qa/world-bytes-heap.mjs [--head URL] [--reference URL] [--rounds 3] [--profile phone] [--cpu 4] [--net fast4g] [--cap 256] [--post 3] [--dump]

   The acceptance run found the JS heap peak higher than HEAD's on the throttled profiles (desktop 327 vs 220 MB, phone 424 vs 260). Five things were
   behind it, found one after the other:
     - the parsed document and definitions (the document is 33 MB of text, about 25 MB of small objects once parsed) stayed reachable from
       world-storage.js's promises for as long as the page lived: 31 MB of the 143 MB the ready world held in the build under test (65 of 164 MB in HEAD);
     - nothing was let go of before the restore, which allocates gigabytes of short-lived data (terrain cuts, surfaces), so the garbage collections it
       causes had the whole tree to carry;
     - the height query over the terrain (terrain-query.js) kept every triangle as a ten-element array, 136 000 small objects per query plus three
       temporary arrays per triangle while it was built. They were a large share of what the restore promotes to the old space, and V8 lets the old
       space grow to about 4.4 times what was alive at the collection before the burst before it collects again: on a phone profile the burst reached that
       limit (360 to 420 MB) and was collected in the middle of the restore; with the triangles in one Float64Array it ends near 260 to 280 MB, below the
       limit, and the collection comes after the world is placed;
     - the shoreline derived from the same triangles (map-terrain-shore.js, updateTerrainShoreline, run by the restore for the foam line along the coast)
       did the same with a JS array per point, polygon, bound, height and edge, and a Map and a text key per line: 365 MB allocated by one call, about 90 MB
       of it promoted. That was the biggest single piece of the peak (sampled peak on desktop at CPU x4: 220 to 258 MB with it, 150 to 190 without; the
       acceptance harness, three rounds: HEAD 223, with it 268, flat arrays 178). It keeps the polygons, their bounds and the edges in typed arrays now
       and allocates 37 MB, and derives every number it did before to the last bit (tests/world/terrain-shore.test.mjs keeps the old code as the oracle);
     - the player cut the pits of the terrain three times while it started (editor.js: the constructor's first select, the select that starts the restore, the
       end of the restore), a full pass over every terrain triangle each, 15 MB promoted a pass; the first was thrown away by the second and is held back now
       (the restored terrain is the same to the bit: scripts/qa/world-geometry-dump.mjs).
   The checks are on what is deterministic (what the ready page holds, what is fetched), on the peak, and on the memory of the whole renderer process.

   The registry fingerprint leaves out the visibility of the meadow grass tiles: the player's adaptive quality hides them when the frames are slow, which
   it decides a few seconds after ready from the timing of that run (25 tiles showed hidden in some rounds and not in others, on the same build).

   Every check is made on the standalone player (/archipelago/preview/index.html, the runtime the /world iframe runs), one fresh Chromium profile per
   run, with --expose-gc so "held" is exact: the heap after two forced collections, minus the heap after world-storage.js is told to forget its
   promises (setRelease).

     held       the heap only world-storage.js's promises keep alive, after ready (the player must hold none of it)
     fetched    the document and the definitions are requested once each (the early head start is taken, not repeated)
     live       the heap after two forced collections at ready, against a budget (and against HEAD's)
     peak       the highest heap any garbage collection found (the trace's MajorGC / MinorGC usedHeapSizeBefore), median over the rounds, against
                HEAD's when --head is given, and against an absolute budget (--peak-budget) that the old layout of the terrain query exceeds.
                A sampler (Runtime.getHeapUsage, also reported as sampledMB) only sees the heap between tasks, and HEAD's multi-second parse and
                restore tasks hide its peak from it: HEAD's collections found 466 to 655 MB where the sampler saw 204. The sampled value is what the
                acceptance harness (perf-world) reports, so it is checked against an absolute budget too and, with --head, against HEAD's plus 10% (HEAD's own
                value flips between about 205 and 480 from run to run, depending on whether the sampler happens to see a heap before or after a restore task).
                Whether V8 has collected the old space by the time the player is ready varies from run to run too: the sampled peak of this build is about
                165 to 180 MB when it has and 205 to 245 when it has not (the old space then stands at the limit V8 set at the collection before the restore),
                and that second figure is what the 10% above is about, so the median over three rounds is compared and the budgets leave room for it.
     shore      what one terrainDebugData(root) call allocates for the real world (the sampling heap profiler, garbage included), against an absolute budget
                (--shore-budget; the object version allocated 365 MB, the typed one 37) and, with --head, against a third of HEAD's
     cuts       how many full passes over the terrain's triangles cut its pits while the player starts (updatePrefabTerrain recomputing, not returning at the
                signature): two (before this change three, HEAD's start makes five)
     rss        the highest resident size of the renderer process (ps), against HEAD's when --head is given: the memory the phone really spends,
                typed arrays and decoded images included, which no JS-heap number covers
     majors     with --cap MB the old space is capped (a small phone): the number of major collections must stay low, a heap that does not fit
                spends the start collecting
     reference  --reference URL: the same registry (ids, userData, transforms) as that build's, to prove the document is restored unchanged */
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { BASE, assert, finish } from './lib.mjs'
import { NETWORKS, contextOptions } from './perf-lib.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback }
const PROFILE = arg('profile', 'phone'), CPU = Number(arg('cpu', 4)), NET = arg('net', 'fast4g'), HEAD = arg('head', null), REFERENCE = arg('reference', null)
const CAP = arg('cap', null), MAJORS_BUDGET = Number(arg('majors-budget', 60)), DUMP = args.includes('--dump')
const ROUNDS = Number(arg('rounds', HEAD ? 3 : 1)), LIVE_BUDGET_MB = Number(arg('live-budget', 135)), HELD_BUDGET_MB = Number(arg('held-budget', 2))
const PEAK_BUDGET_MB = Number(arg('peak-budget', 240)), SAMPLED_BUDGET_MB = Number(arg('sampled-budget', 240)), SHORE_BUDGET_MB = Number(arg('shore-budget', 100)), CUT_PASSES = Number(arg('cut-passes', 2)), POST_S = Number(arg('post', 3))
const OUT = path.resolve(arg('out', '.qa/runs/impl/bytes-heap/guard'))
fs.mkdirSync(OUT, { recursive: true })
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null }
const mb = (v) => Math.round(v * 10) / 10
const rssOf = (pid) => new Promise((resolve) => execFile('ps', ['-o', 'rss=', '-p', String(pid)], (e, out) => resolve(e ? 0 : Number(out.trim() || 0) / 1024)))

async function measure(base, label) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--js-flags=--expose-gc' + (CAP ? ` --max-old-space-size=${CAP}` : ''), '--enable-precise-memory-info'] })
  const ctx = await browser.newContext(contextOptions(PROFILE, '153.0.0.0'))
  try {
    const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page), errors = [], requested = new Map()
    // Counts the passes of the terrain cut: a pass that recomputes puts a new terrainCutStats on the root, one that finds nothing changed leaves it.
    await ctx.route(/\/preview\/prefab-terrain\.js$/, async (route) => {
      const response = await route.fetch(), head = 'export function updatePrefabTerrain(root,force=false){'
      let text = await response.text()
      if (text.includes(head)) text = text.replace(head, head + 'const __before=root.userData.terrainCutStats;try{return __cutPass(root,force);}finally{if(root.userData.terrainCutStats!==__before)window.__cutPasses=(window.__cutPasses||0)+1;}}\nfunction __cutPass(root,force){')
      await route.fulfill({ response, body: text })
    })
    await browser.startTracing(page, { categories: ['devtools.timeline'] })
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e).slice(0, 300)))
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)) })
    page.on('request', (r) => { const p = new URL(r.url()).pathname; requested.set(p, (requested.get(p) ?? 0) + 1) })
    const release = await (await fetch(base + '/api/world/release', { cache: 'no-store' })).json()
    await cdp.send('Runtime.enable')
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })
    if (NET !== 'none') { await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[NET] }) }
    let peak = 0, stop = false
    const sampler = (async () => { while (!stop) { try { peak = Math.max(peak, (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576) } catch {} await new Promise((r) => setTimeout(r, 50)) } })()
    // The renderer process's resident size, every 250 ms (the browser-level SystemInfo lists the renderer pids; the navigation may swap the process).
    const browserCdp = await browser.newBrowserCDPSession()
    let rssPeak = 0
    const rssLoop = (async () => { while (!stop) { try { const { processInfo } = await browserCdp.send('SystemInfo.getProcessInfo'); for (const p of processInfo) if (p.type === 'renderer') rssPeak = Math.max(rssPeak, await rssOf(p.id)) } catch {} await new Promise((r) => setTimeout(r, 250)) } })()
    const t0 = Date.now()
    await page.goto(base + '/archipelago/preview/index.html', { waitUntil: 'commit' })
    await page.waitForFunction(() => document.body?.dataset.ready === 'true', null, { timeout: 600_000, polling: 200 })
    const readyMs = Date.now() - t0
    await page.waitForTimeout(POST_S * 1000)
    stop = true; await sampler; await rssLoop
    const trace = JSON.parse((await browser.stopTracing()).toString()).traceEvents.filter((e) => (e.name === 'MajorGC' || e.name === 'MinorGC') && e.args?.usedHeapSizeBefore !== undefined)
    const gcPeak = Math.max(0, ...trace.map((e) => e.args.usedHeapSizeBefore)) / 1048576, majors = trace.filter((e) => e.name === 'MajorGC').length
    const used = async () => { await page.evaluate(() => { gc(); gc() }); return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576 }
    // What the restore produced: every node's id, userData, name and visibility (exact), and its transform (the fountain and a few other nodes animate).
    const fingerprint = await page.evaluate((dump) => {
      const e = __archipelago.editor; let h = 2166136261 >>> 0
      const mix = (s) => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0 } }
      const tr = [], nodes = {}
      for (const [id, o] of e.registry) {
        // the node's own signature too, so that two different registry hashes can be told apart node by node
        let n = 2166136261 >>> 0; const own = (s) => { for (let i = 0; i < s.length; i++) { n ^= s.charCodeAt(i); n = Math.imul(n, 16777619) >>> 0 } }
        mix(id); try { const u = JSON.stringify(o.userData); mix(u); own(u) } catch { mix('?'); own('?') } mix(o.name); own(o.name); const shown = o.userData.meadowGrass ? 'q' : o.visible ? '1' : '0'; mix(shown); own(shown); nodes[id] = n
        const p = o.position, q = o.quaternion, s = o.scale
        tr.push(p.x, p.y, p.z, q.x, q.y, q.z, q.w, s.x, s.y, s.z)
      }
      const detail = {}
      if (dump) for (const [id, o] of e.registry) { let u; try { u = JSON.stringify(o.userData) } catch { u = '?' } detail[id] = [o.name, o.visible ? 1 : 0, u] }
      return { registry: e.registry.size, hash: h.toString(16), tr, nodes, detail }
    }, DUMP)
    if (DUMP) fs.writeFileSync(path.join(OUT, `nodes-${label.replace(/\W+/g, '-')}.json`), JSON.stringify(fingerprint.detail))
    delete fingerprint.detail
    const live = await used()
    await page.evaluate(async () => { const m = await import('/archipelago/preview/world-storage.js'); m.setRelease(await m.loadRelease()) })
    const afterRelease = await used()
    // One derivation of the shoreline from every terrain triangle, in a fresh copy of its module (its cache is per module instance), while the sampling heap
    // profiler counts every allocation, the ones already collected too.
    await cdp.send('HeapProfiler.enable'); await page.evaluate(() => { gc(); gc() })
    await cdp.send('HeapProfiler.startSampling', { samplingInterval: 4096, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
    const shoreInfo = await page.evaluate(async () => { const m = await import('/archipelago/preview/map-terrain-shore.js?guard=' + Math.random()); const t = performance.now(); const d = m.terrainDebugData(__archipelago.root); return { ms: performance.now() - t, triangles: d.counts.triangles, segments: d.counts.boundarySegments } })
    const { profile: shoreProfile } = await cdp.send('HeapProfiler.stopSampling')
    let shoreBytes = 0; const addUp = (n) => { shoreBytes += n.selfSize; n.children.forEach(addUp) }; addUp(shoreProfile.head)
    const cuts = await page.evaluate(() => window.__cutPasses ?? -1)
    const count = (url) => requested.get(new URL(url, base).pathname) ?? 0
    const r = { label, base, docBytes: release.world.size, readyMs, peakMB: mb(gcPeak), sampledMB: mb(peak), rssMB: Math.round(rssPeak), majors, liveMB: mb(live), heldMB: mb(live - afterRelease), cuts, shoreMB: mb(shoreBytes / 1048576), shoreMs: Math.round(shoreInfo.ms), shoreShape: shoreInfo.triangles + '/' + shoreInfo.segments, docRequests: count(release.world.url), defsRequests: count(release.assets.url), fingerprint, errors: errors.slice(0, 5) }
    console.log(JSON.stringify({ ...r, fingerprint: { registry: fingerprint.registry, hash: fingerprint.hash } }))
    return r
  } finally { await browser.close().catch(() => {}) }
}

const results = [], runs = { subject: [], head: [] }
for (let i = 0; i < ROUNDS; i++) {
  runs.subject.push(await measure(BASE, `subject r${i + 1}`))
  if (HEAD) runs.head.push(await measure(HEAD.replace(/\/$/, ''), `head r${i + 1}`))
}
const subject = runs.subject
console.log(`\nprofile ${PROFILE} cpu x${CPU} net ${NET}, ${ROUNDS} round(s)`)
assert(subject.every((r) => r.errors.length === 0), 'no console errors or uncaught exceptions while the player starts', results)
assert(subject.every((r) => r.docRequests === 1 && r.defsRequests === 1), `the document and the definitions are each requested once (${subject.map((r) => r.docRequests + '/' + r.defsRequests).join(', ')})`, results)
assert(subject.every((r) => r.heldMB <= HELD_BUDGET_MB), `the ready player holds none of the parsed document or definitions: held ${subject.map((r) => r.heldMB).join(', ')} MB (budget ${HELD_BUDGET_MB})`, results)
assert(subject.every((r) => r.liveMB <= LIVE_BUDGET_MB), `the heap the ready world keeps stays within ${LIVE_BUDGET_MB} MB: ${subject.map((r) => r.liveMB).join(', ')} MB`, results)
if (CAP) assert(subject.every((r) => r.majors <= MAJORS_BUDGET), `with the old space capped at ${CAP} MB the start needs few major collections: ${subject.map((r) => r.majors).join(', ')} (budget ${MAJORS_BUDGET})`, results)
assert(subject.every((r) => r.cuts === CUT_PASSES), `the terrain's pits are cut in ${CUT_PASSES} full passes while the player starts, not more: ${subject.map((r) => r.cuts).join(', ')}${HEAD ? ' (HEAD makes ' + runs.head.map((r) => r.cuts).join(', ') + ')' : ''}`, results)
assert(subject.every((r) => r.shoreMB <= SHORE_BUDGET_MB), `deriving the shoreline from the ${subject[0].shoreShape.split('/')[0]} terrain triangles allocates little: ${subject.map((r) => r.shoreMB).join(', ')} MB in ${subject.map((r) => r.shoreMs).join(', ')} ms (budget ${SHORE_BUDGET_MB} MB)`, results)
assert(median(subject.map((r) => r.peakMB)) <= PEAK_BUDGET_MB, `the highest heap a collection found stays below the limit V8 sets for the restore burst: ${median(subject.map((r) => r.peakMB))} MB median (budget ${PEAK_BUDGET_MB}; per run ${subject.map((r) => r.peakMB).join(', ')})`, results)
assert(median(subject.map((r) => r.sampledMB)) <= SAMPLED_BUDGET_MB, `and so does what the acceptance harness's sampler sees: ${median(subject.map((r) => r.sampledMB))} MB median (budget ${SAMPLED_BUDGET_MB}; per run ${subject.map((r) => r.sampledMB).join(', ')})`, results)
if (HEAD) {
  const head = runs.head
  assert(median(subject.map((r) => r.rssMB)) <= median(head.map((r) => r.rssMB)), `the renderer process spends no more memory than HEAD's: ${median(subject.map((r) => r.rssMB))} vs ${median(head.map((r) => r.rssMB))} MB resident (median)`, results)
  assert(median(subject.map((r) => r.liveMB)) <= median(head.map((r) => r.liveMB)), `the ready world keeps no more than HEAD's: ${median(subject.map((r) => r.liveMB))} vs ${median(head.map((r) => r.liveMB))} MB (median)`, results)
  assert(median(subject.map((r) => r.shoreMB)) * 3 <= median(head.map((r) => r.shoreMB)), `and a third of what HEAD's allocates for the same shoreline: ${median(subject.map((r) => r.shoreMB))} vs ${median(head.map((r) => r.shoreMB))} MB (median; the shapes ${subject[0].shoreShape} and ${head[0].shoreShape})`, results)
  assert(median(subject.map((r) => r.sampledMB)) <= median(head.map((r) => r.sampledMB)) * 1.1, `what the acceptance harness's sampler sees is within 10% of HEAD's: ${median(subject.map((r) => r.sampledMB))} vs ${median(head.map((r) => r.sampledMB))} MB (median; per run ${subject.map((r) => r.sampledMB).join(', ')} vs ${head.map((r) => r.sampledMB).join(', ')}; HEAD's collections found ${head.map((r) => r.peakMB).join(', ')})`, results)
  assert(median(subject.map((r) => r.peakMB)) <= median(head.map((r) => r.peakMB)), `the highest heap a collection found is not above HEAD's: ${median(subject.map((r) => r.peakMB))} vs ${median(head.map((r) => r.peakMB))} MB (median; per run ${subject.map((r) => r.peakMB).join(', ')} vs ${head.map((r) => r.peakMB).join(', ')}; the sampler saw ${subject.map((r) => r.sampledMB).join(', ')} vs ${head.map((r) => r.sampledMB).join(', ')})`, results)
}
if (REFERENCE) {
  const ref = await measure(REFERENCE.replace(/\/$/, ''), 'reference')
  const same = (a, b) => a.registry === b.registry && a.hash === b.hash
  const moved = (a, b) => { let n = 0, worst = 0; for (let i = 0; i < a.tr.length; i += 10) { let d = 0; for (let k = 0; k < 10; k++) d = Math.max(d, Math.abs(a.tr[i + k] - b.tr[i + k])); if (d > 1e-3) n++; worst = Math.max(worst, d) } return { n, worst } }
  // When a round's registry differs, which nodes: the ids whose userData / name / visibility are not the reference's.
  const differing = (a, b) => { const out = []; for (const id of new Set([...Object.keys(a.nodes), ...Object.keys(b.nodes)])) if (a.nodes[id] !== b.nodes[id]) out.push(id); return out }
  const apart = subject.map((r, i) => (same(r.fingerprint, ref.fingerprint) ? null : `round ${i + 1}: ${r.fingerprint.hash}, ${differing(r.fingerprint, ref.fingerprint).length} nodes differ, e.g. ${differing(r.fingerprint, ref.fingerprint).slice(0, 4).join(' ')}`)).filter(Boolean)
  assert(subject.every((r) => same(r.fingerprint, ref.fingerprint)), `the restored registry (ids, userData, names, visibility) is the reference build's: ${subject[0].fingerprint.registry} nodes, ${subject.map((r) => r.fingerprint.hash).join(', ')} vs ${ref.fingerprint.registry}, ${ref.fingerprint.hash}${apart.length ? ' (' + apart.join('; ') + ')' : ''}`, results)
  const m = moved(subject[0].fingerprint, ref.fingerprint)
  assert(m.n <= 150 && m.worst <= 0.5, `and so are the transforms, but the few animated nodes (${m.n} differ by up to ${m.worst.toFixed(3)})`, results)
}
const slim = (r) => ({ ...r, fingerprint: { registry: r.fingerprint.registry, hash: r.fingerprint.hash } })
fs.writeFileSync(path.join(OUT, 'world-bytes-heap.json'), JSON.stringify({ profile: PROFILE, cpu: CPU, net: NET, runs: { subject: runs.subject.map(slim), head: runs.head.map(slim) }, results }, null, 1))
finish(results)
