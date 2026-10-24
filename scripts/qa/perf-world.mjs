/* /world performance baseline: Enter my world end to end, the first seconds of play, dialogs.

     QA_BASE=http://localhost:3220 QA_OUT=.qa/runs/perf2/baseline node scripts/qa/perf-world.mjs \
       [--mode enter|direct|probe] [--entry fling|read|link] [--profile desktop|laptop|tablet|phone]
       [--cpu 1] [--net slow4g|fast4g] [--runs 3] [--drive-ms 20000] [--play false] [--label name]

   Always against a PRODUCTION build. One JSON document goes to stdout (progress to stderr)
   and to QA_OUT/perf-world-<label>.json. Every repetition is a fresh Chromium profile (cold on-disk HTTP cache).

   mode enter   homepage -> scroll to the foot -> push (touch swipe on touch profiles) -> leaves ->
                /world -> reveal. entry: fling = flung to the foot right after the room is ready
                (nothing pre-warmed), read = scrolled through the journey at 1000 px/s (world bytes
                warm in the background), link = chapter index (key I) -> "Enter my world" link.
   mode direct  cold navigation straight to /world (the same foliage mask, no homepage).
   mode probe   enter, then, while the leaves are closed and the world is loading, try to scroll, type,
                click and tap and record what moved or reacted (evidence for "lock the page").

   enter/direct record, per repetition:
     timing    every worldTransition phase (page performance.now()) and the gaps between them, the
               runtime's hello / progress / ready messages, time to ready from the push / from COVERING
     loading   main-thread long tasks + long animation frames + TBT + Performance-domain counters
               during LOADING_WORLD -> WORLD_READY and during the whole COVERING -> IN_WORLD span
     bytes     by kind (js, json, glb, texture, audio, wasm, ...) before the push, while loading,
               after ready, plus the largest requests
     heap      JS heap start / peak (also at ready) / end
     renderer  after the reveal: draw calls, triangles, geometries, textures, programs, pixel ratio,
               canvas size, quality tier, mesh counts, an estimate of texture memory
     drive     (unless --play false) hold W for --drive-ms with A/D steering (touch: a finger held ahead
               of the car, moving in a circle): rAF frame time of the world frame, long tasks, LoAF,
               renderer.render() CPU cost, layout/style counts per frame, key->next-frame latency,
               W-at-rest -> first motion latency, quality-tier changes, renderer.info samples
     dialogs   click-to-painted (double rAF after the DOM change), long tasks and Event Timing for:
               Achievements, Controls, Map (first open = photograph render, close, second open)

   Throttled runs use Chrome's CPU slowdown and the named network profile (see perf-lib.mjs).
   Nothing is estimated except where a field says "Est". */
import {
  BASE, PROFILES, parseArgs, chromeVersion, session, throttle, pfInit, perfMetrics, metricDelta, heapSampler,
  netCollector, issueCollector, dedupe, scrollGesture, touchSender, frameStats, taskStats, loafStats, summarize,
  waitForQuiet, environment, emit, sleep, log, stats, median, outPath,
} from './perf-lib.mjs'

const args = parseArgs()
const MODE = String(args.mode ?? 'enter')
const ENTRY = String(args.entry ?? 'fling')
const PROFILE = String(args.profile ?? 'desktop')
const CPU = Number(args.cpu ?? 1)
const NET = args.net && args.net !== true ? String(args.net) : null
const RUNS = Number(args.runs ?? 3)
const DRIVE_MS = Number(args['drive-ms'] ?? 20000)
const PLAY = String(args.play ?? 'true') !== 'false'
const LABEL = String(args.label ?? `${MODE}-${MODE === 'direct' ? 'cold' : ENTRY}-${PROFILE}${CPU > 1 ? `-cpu${CPU}` : ''}${NET ? `-${NET}` : ''}`)
const prof = PROFILES[PROFILE]
const touch = prof.touch
const CX = prof.viewport.width / 2
const CY = prof.viewport.height / 2
const PHASE_TIMEOUT = NET === 'slow4g' ? 900000 : 300000
const WORLD_RE = /^\/(archipelago|world2|api\/world)\//
const isWorldReq = (r) => WORLD_RE.test(new URL(r.url).pathname)
const r1 = (v) => (v == null ? null : Math.round(v * 10) / 10)

const frameOf = (page) => page.frames().find((f) => f.url().includes('/archipelago/preview/'))
const phaseNames = (page) => page.evaluate(() => window.__pf.phases.map((p) => p[0]))
const waitPhase = (page, name, timeout = PHASE_TIMEOUT) =>
  page.waitForFunction((n) => window.__pf.phases.some((p) => p[0] === n || p[0] === 'ERROR'), name, { timeout, polling: 100 })

/* ---- reaching the foot and pushing ------------------------------------ */

async function reachFoot(page, cdp) {
  const max = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
  if (ENTRY !== 'read') await sleep(1500)
  // read: the journey at reading pace (world bytes warm in the background from ~55 % progress); fling: as fast as a hand goes.
  const speed = ENTRY === 'read' ? 1000 : 9000
  await scrollGesture(cdp, { x: CX, y: CY, dy: max - 150 - (await page.evaluate(() => scrollY)), speed, touch })
  await sleep(900)
  // The last stretch is programmatic: a swipe cannot be aimed to the pixel, and swipe input at the foot IS the push.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForFunction(() => document.documentElement.scrollHeight - innerHeight - scrollY < 3, null, { timeout: 60000, polling: 100 })
  await sleep(300)
}

/** Continuing wheel / swipe input at the foot until the transition leaves HOME. Returns page-time of the first push. */
async function push(page, cdp) {
  const t = await page.evaluate(() => (window.__pf.pushAt = performance.now()))
  for (let i = 0; i < 24; i++) {
    await scrollGesture(cdp, { x: CX, y: CY, dy: 500, speed: 1500, touch })
    const phase = await page.evaluate(() => document.documentElement.dataset.worldPhase)
    if (phase && phase !== 'HOME') break
  }
  return t
}

async function viaLink(page) {
  await page.evaluate(() => { window.__pf.pushAt = performance.now() })
  await page.keyboard.press('i')
  const link = page.locator('[aria-label="Chapter index"] a[href="/world"]')
  await link.waitFor({ state: 'visible' })
  await sleep(700)
  await page.evaluate(() => { window.__pf.pushAt = performance.now() })
  await link.click()
}

/* ---- in-world measurement helpers ------------------------------------- */

async function instrument(frame) {
  await frame.evaluate(() => {
    const pf = window.__pf
    if (pf.patched) return
    pf.patched = true
    const r = window.__archipelago.renderer
    const orig = r.render
    r.render = function (s, c) {
      const a = performance.now()
      const out = orig.call(this, s, c)
      if (pf.rec) pf.rd.push([a, performance.now() - a, this.info.render.calls, this.info.render.triangles, this.info.programs?.length ?? 0, this.info.memory.textures, this.info.memory.geometries])
      return out
    }
    pf.keys = []
    for (const type of ['keydown', 'keyup']) window.addEventListener(type, (e) => pf.keys.push([type, e.code, e.timeStamp]), { capture: true, passive: true })
    const at = window.__archipelago.atlas
    if (at) {
      const photo = at.photograph.bind(at)
      at.photograph = () => { const a = performance.now(); photo(); pf.photoMs = performance.now() - a }
    }
  })
}

async function rendererInfo(frame) {
  return frame.evaluate(() => {
    const A = window.__archipelago
    const r = A.renderer
    let meshes = 0, visible = 0, instanced = 0, instances = 0, casters = 0, lights = 0, skinned = 0
    const tex = new Map()
    A.scene.traverse((o) => {
      if (o.isLight) lights++
      if (!o.isMesh) return
      meshes++
      if (o.visible) visible++
      if (o.isInstancedMesh) { instanced++; instances += o.count }
      if (o.isSkinnedMesh) skinned++
      if (o.castShadow) casters++
      for (const m of [o.material].flat()) for (const v of Object.values(m ?? {})) if (v && v.isTexture && v.image) tex.set(v.uuid, v)
    })
    let texBytes = 0
    for (const t of tex.values()) texBytes += (t.image.width || 0) * (t.image.height || 0) * 4 * (t.generateMipmaps ? 1.33 : 1)
    const size = r.getSize(new A.THREE.Vector2())
    return {
      calls: r.info.render.calls, triangles: r.info.render.triangles,
      geometries: r.info.memory.geometries, textures: r.info.memory.textures, programs: r.info.programs?.length ?? null,
      pixelRatio: r.getPixelRatio(), canvasW: r.domElement.width, canvasH: r.domElement.height, cssW: Math.round(size.x), cssH: Math.round(size.y),
      quality: document.body.dataset.quality ?? null, qualityLevel: A.quality?.level ?? null, qualityChanges: A.quality?.changes ?? null,
      meshes, visibleMeshes: visible, instancedMeshes: instanced, instances, shadowCasters: casters, lights, skinned,
      sceneTexturesEst: tex.size, textureMBEst: Math.round(texBytes / 1048576),
      dom: document.getElementsByTagName('*').length,
      pos: A.driving?.vehicle?.position?.toArray?.().map((v) => Math.round(v * 100) / 100) ?? null,
    }
  })
}

/** Frame time, render() cost, tasks, latency of the world frame over a window; `act` runs inside it. */
async function measureWindow(page, frame, cdp, act) {
  await frame.evaluate(() => { const pf = window.__pf; pf.rd = []; pf.keys = []; pf.frameStart(false) })
  const m0 = await perfMetrics(cdp)
  const tF0 = await frame.evaluate(() => performance.now())
  const tP0 = await page.evaluate(() => performance.now())
  const extra = await act()
  const m1 = await perfMetrics(cdp)
  const tF1 = await frame.evaluate(() => performance.now())
  const tP1 = await page.evaluate(() => performance.now())
  const f = await frame.evaluate(() => {
    const pf = window.__pf
    const fr = pf.frameStop()
    return { stamps: fr.stamps, rd: pf.rd, keys: pf.keys, longTasks: pf.longTasks, loaf: pf.loaf, events: pf.events }
  })
  const p = await page.evaluate(() => ({ longTasks: window.__pf.longTasks, loaf: window.__pf.loaf }))
  // key -> first frame at or after it (same clock in the frame)
  const lat = []
  let j = 0
  for (const [, , ts] of f.keys) {
    while (j < f.stamps.length && f.stamps[j] < ts) j++
    if (j < f.stamps.length) lat.push(f.stamps[j] - ts)
  }
  const rdDur = f.rd.map((x) => x[1])
  // Single frames that hurt: the longest gaps between animation frames and the slowest renderer.render() calls
  // (with what the renderer created during them: a new program means a shader compile in the frame).
  const gaps = []
  for (let k = 1; k < f.stamps.length; k++) gaps.push([f.stamps[k] - f.stamps[k - 1], f.stamps[k - 1] - tF0])
  gaps.sort((a, b) => b[0] - a[0])
  const worstGaps = gaps.filter((g) => g[0] > 34).slice(0, 8).map(([ms, at]) => ({ gapMs: Math.round(ms), startedAtMs: Math.round(at) }))
  const slowRenders = f.rd.map((x, k) => ({ atMs: Math.round(x[0] - tF0), ms: Math.round(x[1]), calls: x[2], newPrograms: k ? x[4] - f.rd[k - 1][4] : 0, newTextures: k ? x[5] - f.rd[k - 1][5] : 0, newGeometries: k ? x[6] - f.rd[k - 1][6] : 0 }))
    .filter((x) => x.ms > 30).sort((a, b) => b.ms - a.ms).slice(0, 8)
  const frames = Math.max(1, f.stamps.length)
  const perFrame = { calls: [], tris: [] }
  for (const x of f.rd) { perFrame.calls.push(x[2]); perFrame.tris.push(x[3]) }
  const mainCalls = [...perFrame.calls].sort((a, b) => b - a)
  const med = (a) => median(a)
  return {
    extra,
    frame: frameStats(f.stamps),
    worstGaps,
    slowRenders,
    tasksFrame: taskStats(f.longTasks, tF0, tF1),
    tasksParent: taskStats(p.longTasks, tP0, tP1),
    loafFrame: loafStats(f.loaf, tF0, tF1),
    loafParent: loafStats(p.loaf, tP0, tP1),
    render: {
      calls: f.rd.length, perFrame: r1(f.rd.length / frames), cpuMs: stats(rdDur),
      drawCallsMedian: med(perFrame.calls), drawCallsMax: mainCalls[0] ?? null, trianglesMedian: med(perFrame.tris),
    },
    main: metricDelta(m0, m1),
    layoutPerFrame: r1((m1.LayoutCount - m0.LayoutCount) / frames),
    stylePerFrame: r1((m1.RecalcStyleCount - m0.RecalcStyleCount) / frames),
    keyToFrameMs: stats(lat),
    keyEvents: f.keys.length,
    eventTiming: f.events.filter(([, s]) => s >= tF0 && s <= tF1).map(([n, s, d, pr, dur]) => ({ name: n, atMs: Math.round(s - tF0), inputDelay: r1(d), processing: r1(pr), duration: dur })).slice(0, 40),
    windowMs: Math.round(tF1 - tF0),
  }
}

/* ---- driving ---------------------------------------------------------- */

async function driveKeyboard(page, frame, ms) {
  await frame.locator('#world').focus()
  const sampleAt = [500, 5000, 10000, 15000, ms - 500]
  const series = []
  const t0 = Date.now()
  await page.keyboard.down('KeyW')
  let held = null
  let s = 0
  while (Date.now() - t0 < ms) {
    const el = Date.now() - t0
    const want = [null, 'KeyA', null, 'KeyD'][Math.floor(el / 1500) % 4]
    if (want !== held) {
      if (held) await page.keyboard.up(held)
      if (want) await page.keyboard.down(want)
      held = want
    }
    if (s < sampleAt.length && el >= sampleAt[s]) {
      series.push({ atMs: el, ...(await frame.evaluate(() => { const r = window.__archipelago.renderer; return { calls: r.info.render.calls, tris: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, quality: document.body.dataset.quality, pixelRatio: r.getPixelRatio(), speedKmh: Math.round(window.__archipelago.driving.vehicle.speedKmh) } })) })
      s++
    }
    await sleep(40)
  }
  if (held) await page.keyboard.up(held)
  await page.keyboard.up('KeyW')
  return series
}

async function driveTouch(page, frame, cdp, ms) {
  const f = touchSender(cdp)
  const series = []
  const t0 = Date.now()
  const cx = CX
  const cy = CY * 0.55
  await f.down([cx, cy])
  let s = 0
  const sampleAt = [500, 5000, 10000, 15000, ms - 500]
  while (Date.now() - t0 < ms) {
    const el = Date.now() - t0
    const a = (el / 4000) * Math.PI * 2
    await f.move([cx + Math.cos(a) * 70, cy + Math.sin(a) * 45])
    if (s < sampleAt.length && el >= sampleAt[s]) {
      series.push({ atMs: el, ...(await frame.evaluate(() => { const r = window.__archipelago.renderer; return { calls: r.info.render.calls, tris: r.info.render.triangles, geometries: r.info.memory.geometries, textures: r.info.memory.textures, quality: document.body.dataset.quality, pixelRatio: r.getPixelRatio(), speedKmh: Math.round(window.__archipelago.driving.vehicle.speedKmh) } })) })
      s++
    }
    await sleep(80)
  }
  await f.up()
  return series
}

/** W at rest -> first frame in which the car has moved (>1 cm): input to first visible motion. */
async function firstMotion(page, frame) {
  await frame.locator('#world').focus()
  await frame.evaluate(() => {
    const v = window.__archipelago.driving.vehicle
    const p0 = v.position.clone()
    window.__motion = new Promise((resolve) => {
      let tIn = null
      window.addEventListener('keydown', (e) => { if (e.code === 'KeyW' && tIn == null) tIn = e.timeStamp }, { capture: true })
      const end = performance.now() + 6000
      const tick = (t) => {
        if (tIn != null && v.position.distanceTo(p0) > 0.01) return resolve({ ms: t - tIn, speedKmh: v.speedKmh })
        if (tIn == null) p0.copy(v.position)
        if (t > end) return resolve(null)
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  })
  await page.keyboard.down('KeyW')
  const res = await frame.evaluate(() => window.__motion)
  await page.keyboard.up('KeyW')
  await sleep(1500)
  return res
}

/* ---- dialogs ---------------------------------------------------------- */

async function dialogStep(page, frame, cdp, { label, trigger, watch, kind, want }) {
  await frame.evaluate(({ watch, kind, want }) => {
    const target = document.querySelector(watch)
    window.__act = new Promise((resolve) => {
      const t = { click: null, pointerdown: null, dom: null, paint: null }
      window.addEventListener('pointerdown', (e) => { t.pointerdown = e.timeStamp }, { capture: true, once: true })
      window.addEventListener('click', (e) => { t.click = e.timeStamp }, { capture: true, once: true })
      const state = () => (kind === 'hidden' ? !target.hidden : target.open)
      const mo = new MutationObserver(() => {
        if (t.dom != null || state() !== want) return
        t.dom = performance.now()
        requestAnimationFrame(() => requestAnimationFrame(() => { t.paint = performance.now(); mo.disconnect(); resolve(t) }))
      })
      mo.observe(target, { attributes: true })
      setTimeout(() => { mo.disconnect(); resolve(t) }, 10000)
    })
    window.__pf.photoMs = null
  }, { watch, kind, want })
  const m0 = await perfMetrics(cdp)
  const tF0 = await frame.evaluate(() => performance.now())
  await trigger()
  const t = await frame.evaluate(() => window.__act)
  const tF1 = await frame.evaluate(() => performance.now())
  const m1 = await perfMetrics(cdp)
  const f = await frame.evaluate(() => ({ longTasks: window.__pf.longTasks, loaf: window.__pf.loaf, events: window.__pf.events, photoMs: window.__pf.photoMs }))
  const lat = t.click != null && t.paint != null ? t.paint - t.click : null
  const toDom = t.click != null && t.dom != null ? t.dom - t.click : null
  const events = f.events.filter(([, s]) => s >= tF0 && s <= tF1).map(([n, , , , d]) => [n, d])
  return {
    label,
    clickToDomMs: r1(toDom), clickToPaintMs: r1(lat),
    pointerdownToPaintMs: t.pointerdown != null && t.paint != null ? r1(t.paint - t.pointerdown) : null,
    photographMs: r1(f.photoMs),
    tasks: taskStats(f.longTasks, tF0, tF1), loaf: loafStats(f.loaf, tF0, tF1),
    eventTimingMaxMs: events.length ? Math.max(...events.map((e) => e[1])) : null,
    eventTiming: events.slice(0, 8),
    main: metricDelta(m0, m1),
  }
}

async function dialogs(page, frame, cdp) {
  const click = (sel) => async () => { if (touch) await frame.locator(sel).tap(); else await frame.locator(sel).click() }
  const out = {}
  const plan = [
    ['awardsOpen', { trigger: click('#player-awards'), watch: '#awards-dialog', kind: 'open', want: true }],
    ['awardsClose', { trigger: click('#close-awards'), watch: '#awards-dialog', kind: 'open', want: false }],
    ['helpOpen', { trigger: click('#player-help'), watch: '#help-dialog', kind: 'open', want: true }],
    ['helpClose', { trigger: click('#close-help'), watch: '#help-dialog', kind: 'open', want: false }],
    ['mapOpenFirst', { trigger: click('#player-map'), watch: '.atlas', kind: 'hidden', want: true }],
    ['mapClose', { trigger: click('.atlas-close'), watch: '.atlas', kind: 'hidden', want: false }],
    ['mapOpenSecond', { trigger: click('#player-map'), watch: '.atlas', kind: 'hidden', want: true }],
    ['mapCloseSecond', { trigger: click('.atlas-close'), watch: '.atlas', kind: 'hidden', want: false }],
  ]
  for (const [name, cfg] of plan) {
    try { out[name] = await dialogStep(page, frame, cdp, { label: name, ...cfg }) } catch (e) { out[name] = { error: String(e).slice(0, 200) } }
    await sleep(900)
  }
  return out
}

/* ---- one repetition (enter / direct) ---------------------------------- */

async function newSession(version) {
  const { ctx, page, cdp, close } = await session(PROFILE, version)
  await ctx.addInitScript(pfInit)
  const issues = issueCollector(page)
  await throttle(cdp, { cpu: CPU, net: NET })
  await cdp.send('Performance.enable')
  const net = await netCollector(cdp)
  const heap = heapSampler(cdp)
  return { ctx, page, cdp, issues, net, heap, close }
}

async function enterRep(version, i) {
  const machine = await waitForQuiet()
  const { page, cdp, issues, net, heap, close } = await newSession(version)
  const res = { rep: i + 1, loadavgBefore: machine.loadavgBefore, machine }
  const snaps = {}
  let stopWatch = false
  let watcher = null
  try {
    if (MODE === 'direct') {
      await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    } else {
      await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 })
      await page.waitForFunction(() => window.__room?.().milestones?.ready, null, { timeout: 180000, polling: 100 })
    }
    net.setOrigin(await page.evaluate(() => performance.timeOrigin))
    watcher = (async () => {
      while (!stopWatch) {
        try {
          for (const n of await phaseNames(page)) if (!snaps[n]) snaps[n] = { m: await perfMetrics(cdp), heapPeakMB: heap.peakNow() }
        } catch { /* navigating */ }
        await sleep(60)
      }
    })()
    let pushAt = 0
    if (MODE === 'enter') {
      if (ENTRY === 'link') await viaLink(page)
      else { await reachFoot(page, cdp); pushAt = await push(page, cdp) }
    }
    await waitPhase(page, 'IN_WORLD')
    await sleep(2500)
    stopWatch = true
    await watcher
    const rec = await page.evaluate(() => ({ phases: window.__pf.phases, messages: window.__pf.messages, longTasks: window.__pf.longTasks, loaf: window.__pf.loaf, shifts: window.__pf.shifts, pushAt: window.__pf.pushAt ?? 0, path: location.pathname, now: performance.now() }))
    const at = Object.fromEntries(rec.phases.map(([n, t]) => [n, t]))
    if (at.ERROR != null) res.error = 'world reported ERROR'
    const t0 = MODE === 'direct' ? 0 : rec.pushAt || pushAt
    const d = (a, b) => (at[a] != null && at[b] != null ? r1(at[b] - at[a]) : null)
    const msg = (name) => rec.messages.find((m) => m[0] === name)?.[1]
    const progress = rec.messages.filter((m) => m[0] === 'archipelago:progress')
    const tLoad = at.LOADING_WORLD ?? at.COVERED ?? 0
    res.timing = {
      phasesMs: Object.fromEntries(Object.entries(at).map(([n, t]) => [n, r1(t - t0)])),
      pushToCovering: d('COVERING', 'COVERING') == null ? null : r1(at.COVERING - t0),
      coveringToCovered: d('COVERING', 'COVERED'),
      coveredToLoading: d('COVERED', 'LOADING_WORLD'),
      loadingToWorldReady: d('LOADING_WORLD', 'WORLD_READY'),
      worldReadyToRevealing: d('WORLD_READY', 'REVEALING'),
      revealingToInWorld: d('REVEALING', 'IN_WORLD'),
      coveringToWorldReady: d('COVERING', 'WORLD_READY'),
      coveringToInWorld: d('COVERING', 'IN_WORLD'),
      pushToInWorld: at.IN_WORLD != null ? r1(at.IN_WORLD - t0) : null,
      pushToWorldReady: at.WORLD_READY != null ? r1(at.WORLD_READY - t0) : null,
      navToInWorld: MODE === 'direct' && at.IN_WORLD != null ? r1(at.IN_WORLD) : null,
      helloAfterLoadingMs: msg('archipelago:hello') != null ? r1(msg('archipelago:hello') - tLoad) : null,
      readyMsgAfterLoadingMs: msg('archipelago:ready') != null ? r1(msg('archipelago:ready') - tLoad) : null,
      progressStages: progress.map((m) => `${m[2]} @${r1(m[1] - tLoad)}ms (${Math.round((m[3] ?? 0) * 100)}%)`),
      phaseOrder: rec.phases.map((p) => p[0]).join(' > '),
    }
    // Main-thread cost while the world loads under the leaves, and across the whole sequence.
    const lw = [at.LOADING_WORLD, at.WORLD_READY]
    const whole = [at.COVERING ?? at.COVERED ?? 0, at.IN_WORLD]
    res.loading = {
      tasks: taskStats(rec.longTasks, lw[0], lw[1]), loaf: loafStats(rec.loaf, lw[0], lw[1]),
      wholeSequenceTasks: taskStats(rec.longTasks, whole[0], whole[1]), wholeSequenceLoaf: loafStats(rec.loaf, whole[0], whole[1]),
      coverGrowTasks: taskStats(rec.longTasks, at.COVERING ?? 0, at.LOADING_WORLD ?? 0),
      revealTasks: taskStats(rec.longTasks, at.REVEALING ?? 0, at.IN_WORLD ?? 0),
      main: snaps.LOADING_WORLD && snaps.WORLD_READY ? metricDelta(snaps.LOADING_WORLD.m, snaps.WORLD_READY.m) : null,
      mainWholeSequence: snaps.COVERING && snaps.IN_WORLD ? metricDelta(snaps.COVERING.m, snaps.IN_WORLD.m) : null,
      cls: Math.round(rec.shifts.filter(([s]) => s >= whole[0] && s <= whole[1]).reduce((a, [, v]) => a + v, 0) * 10000) / 10000,
    }
    const tp = (n) => (at[n] == null ? null : at[n])
    res.bytes = {
      before: net.summarise(-Infinity, (tp('COVERING') ?? tp('COVERED') ?? 0)),
      pushToLoading: net.summarise(tp('COVERING') ?? 0, tp('LOADING_WORLD') ?? 0),
      loading: net.summarise(tp('LOADING_WORLD') ?? 0, tp('WORLD_READY') ?? Infinity),
      afterReady: net.summarise(tp('WORLD_READY') ?? Infinity, Infinity),
      worldTotal: net.summarise(-Infinity, Infinity, isWorldReq),
      all: net.summarise(-Infinity, Infinity),
    }
    res.heapAtReady = snaps.WORLD_READY ? { peakSoFarMB: snaps.WORLD_READY.heapPeakMB } : null
    // The world frame.
    const frame = frameOf(page)
    if (!frame) throw new Error('no world frame')
    await frame.waitForFunction(() => !!window.__archipelago?.driving, null, { timeout: 30000 })
    res.runtimeEnv = await frame.evaluate(() => ({ pointerCoarse: matchMedia('(pointer: coarse)').matches, cores: navigator.hardwareConcurrency, memory: navigator.deviceMemory, dpr: devicePixelRatio, iw: innerWidth, ih: innerHeight, touchUi: document.body.dataset.input ?? null }))
    res.renderer = await rendererInfo(frame)
    if (PLAY) {
      await instrument(frame)
      await sleep(1000)
      res.idle = await measureWindow(page, frame, cdp, async () => { await sleep(3000) })
      res.firstMotion = touch ? null : await firstMotion(page, frame)
      const q0 = await frame.evaluate(() => ({ level: window.__archipelago.quality?.level, changes: window.__archipelago.quality?.changes }))
      const p0 = await frame.evaluate(() => window.__archipelago.driving.vehicle.position.toArray())
      res.drive = await measureWindow(page, frame, cdp, () => (touch ? driveTouch(page, frame, cdp, DRIVE_MS) : driveKeyboard(page, frame, DRIVE_MS)))
      const q1 = await frame.evaluate(() => ({ level: window.__archipelago.quality?.level, changes: window.__archipelago.quality?.changes, pr: window.__archipelago.renderer.getPixelRatio() }))
      const p1 = await frame.evaluate(() => window.__archipelago.driving.vehicle.position.toArray())
      res.drive.samples = res.drive.extra
      res.drive.extra = undefined
      res.drive.qualityBefore = q0
      res.drive.qualityAfter = q1
      res.drive.distanceM = r1(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]))
      res.rendererAfterDrive = await rendererInfo(frame)
      await sleep(1500)
      res.dialogs = await dialogs(page, frame, cdp)
      res.rendererAfterDialogs = await rendererInfo(frame)
    }
    res.screenshot = outPath(`perf-world-${LABEL}-r${i + 1}.png`)
    await page.screenshot({ path: res.screenshot }).catch(() => {})
  } catch (e) {
    res.error = String(e).slice(0, 500)
  }
  stopWatch = true
  await watcher
  res.heap = await heap.stop()
  res.issues = { console: dedupe(issues.console, 16), pageerrors: dedupe(issues.pageerrors), http: dedupe(issues.http), requestfailed: dedupe(issues.requestfailed), cdpFailed: net.failed.slice(0, 8) }
  await close()
  log(`${LABEL} #${i + 1}: ${res.error ? 'ERROR ' + res.error : `covering->ready ${res.timing?.coveringToWorldReady} ms, push->inWorld ${res.timing?.pushToInWorld} ms, loadingTasks ${res.loading?.tasks.count} (longest ${res.loading?.tasks.longest}), drive p50/p95/max ${res.drive?.frame.p50}/${res.drive?.frame.p95}/${res.drive?.frame.max}, map1 ${res.dialogs?.mapOpenFirst?.clickToPaintMs} ms`} | load ${res.loadavgBefore[0]}`)
  return res
}

/* ---- lock probe: what happens behind the leaves while the world loads -- */

async function probeRep(version, i) {
  const machine = await waitForQuiet()
  const { page, cdp, issues, net, heap, close } = await newSession(version)
  const res = { rep: i + 1, loadavgBefore: machine.loadavgBefore, machine, entry: touch ? 'touch push' : ENTRY === 'link' ? 'index link' : 'wheel push' }
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 120000 })
    await page.waitForFunction(() => window.__room?.().milestones?.ready, null, { timeout: 180000, polling: 100 })
    net.setOrigin(await page.evaluate(() => performance.timeOrigin))
    const snap = (extra = {}) => page.evaluate((extra) => {
      const d = (n) => (n && n.tagName ? `${n.tagName.toLowerCase()}${n.id ? '#' + n.id : ''}${typeof n.className === 'string' && n.className ? '.' + n.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : ''}` : String(n))
      const pts = [[.1, .1], [.5, .1], [.9, .1], [.1, .5], [.5, .5], [.9, .5], [.1, .9], [.5, .9], [.9, .9]].map(([a, b]) => {
        const el = document.elementFromPoint(innerWidth * a, innerHeight * b)
        return `${a},${b}: ${d(el)}${el?.closest('iframe') ? ' [in iframe]' : ''} pe=${el ? getComputedStyle(el).pointerEvents : ''}`
      })
      const scroller = document.scrollingElement
      return {
        phase: document.documentElement.dataset.worldPhase, path: location.pathname,
        scrollY: Math.round(scrollY), scrollTop: Math.round(scroller?.scrollTop ?? 0), scrollHeight: document.documentElement.scrollHeight, innerHeight,
        htmlOverflow: getComputedStyle(document.documentElement).overflow, bodyOverflow: getComputedStyle(document.body).overflow, bodyPosition: getComputedStyle(document.body).position,
        htmlTouchAction: getComputedStyle(document.documentElement).touchAction,
        lenis: window.lenis ? { stopped: window.lenis.isStopped, locked: window.lenis.isLocked } : null,
        active: d(document.activeElement), inert: [...document.querySelectorAll('[inert]')].map(d), coverMarked: !!document.querySelector('[data-covered]'),
        iframes: document.querySelectorAll('iframe').length, hit: pts,
        status: [...document.querySelectorAll('[role=status]')].map((n) => ({ text: n.textContent?.slice(0, 80), cls: String(n.className).slice(0, 40), w: Math.round(n.getBoundingClientRect().width), h: Math.round(n.getBoundingClientRect().height) })),
        ...extra,
      }
    }, extra)
    const wheelBurst = async (n, dy) => { await Promise.all(Array.from({ length: n }, () => cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: CX, y: CY, deltaX: 0, deltaY: dy }))) }
    // ---- entry
    if (ENTRY === 'link' && !touch) {
      await page.keyboard.press('i')
      const link = page.locator('[aria-label="Chapter index"] a[href="/world"]')
      await link.waitFor({ state: 'visible' })
      await sleep(700)
      await link.click()
      // COVERING: the leaves are growing in (about 900 ms); try the page behind them at once.
      const before = await snap()
      if (!touch) await wheelBurst(5, 300)
      await sleep(250)
      const after = await snap()
      res.atCovering = { phaseBefore: before.phase, phaseAfter: after.phase, scrollYBefore: before.scrollY, scrollYAfter: after.scrollY, scrollHeight: before.scrollHeight }
    } else {
      await reachFoot(page, cdp)
      await push(page, cdp)
      const before = await snap()
      res.atCoveringPush = { phase: before.phase, scrollY: before.scrollY }
    }
    await waitPhase(page, 'LOADING_WORLD', 120000)
    // ---- LOADING_WORLD
    const frame0 = frameOf(page)
    for (const f of page.frames()) await f.evaluate(() => { if (window.__pf) window.__pf.logInput = true }).catch(() => {})
    const s0 = await snap()
    res.loading = { start: s0 }
    await page.screenshot({ path: outPath(`perf-world-probe-${PROFILE}-loading-r${i + 1}.png`) }).catch(() => {})
    const steps = []
    const light = () => page.evaluate(() => ({ phase: document.documentElement.dataset.worldPhase, scrollY: Math.round(scrollY), path: location.pathname, active: document.activeElement?.tagName?.toLowerCase() + (document.activeElement?.id ? '#' + document.activeElement.id : '') }))
    const step = async (name, fn) => {
      const a = await light()
      await fn()
      await sleep(150)
      const b = await light()
      steps.push({ step: name, phaseBefore: a.phase, phaseAfter: b.phase, underLeaves: ['COVERED', 'LOADING_WORLD'].includes(a.phase) && ['COVERED', 'LOADING_WORLD'].includes(b.phase), scrollYBefore: a.scrollY, scrollYAfter: b.scrollY, active: b.active, path: b.path })
    }
    if (touch) {
      await step('touch swipe up 600px x3', async () => { for (let k = 0; k < 3; k++) await scrollGesture(cdp, { x: CX, y: CY, dy: 600, speed: 3000, touch: true }) })
      await step('touch swipe down 600px', async () => { await scrollGesture(cdp, { x: CX, y: CY, dy: -600, speed: 3000, touch: true }) })
    } else {
      await step('wheel 6 x 500px down', async () => { await wheelBurst(6, 500) })
      await step('wheel 6 x 500px up', async () => { await wheelBurst(6, -500) })
    }
    for (const key of ['PageDown', 'End', 'Space', 'Tab', 'KeyM', 'Enter']) await step(`key ${key}`, async () => { await page.keyboard.press(key) })
    await step('key W held 400 ms', async () => { await page.keyboard.down('KeyW'); await sleep(400); await page.keyboard.up('KeyW') })
    // Where do clicks land? Centre, then the world frame's own Map button, then its "Portfolio" link.
    const rect = async (sel) => frame0 ? frame0.evaluate((sel) => { const e = document.querySelector(sel); const r = e?.getBoundingClientRect(); return r ? [r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, getComputedStyle(e).display] : null }, sel).catch(() => null) : null
    const tap = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y))
    const centre = [CX, CY]
    const mapBtn = await rect('#player-map')
    const homeBtn = await rect('#player-home')
    res.loading.worldFrameButtons = { map: mapBtn, home: homeBtn }
    await step('click centre of screen', async () => { await tap(...centre) })
    if (mapBtn) {
      const a = await frame0.evaluate(() => ({ atlasOpen: !!window.__archipelago?.atlas?.isOpen, atlasVisible: document.querySelector('.atlas') ? !document.querySelector('.atlas').hidden : null })).catch(() => null)
      await step('click the world frame Map button (under the leaves)', async () => { await tap(mapBtn[0], mapBtn[1]) })
      const b = await frame0.evaluate(() => ({ atlasOpen: !!window.__archipelago?.atlas?.isOpen, atlasVisible: document.querySelector('.atlas') ? !document.querySelector('.atlas').hidden : null })).catch(() => null)
      res.loading.mapUnderLeaves = { before: a, after: b }
    }
    const pre = await snap()
    res.loading.phaseBeforeHomeClick = pre.phase
    res.loading.inputLog = await Promise.all(page.frames().map(async (f) => ({ frame: f.url().replace(BASE, '').slice(0, 40), log: await f.evaluate(() => window.__pf?.input ?? []).catch(() => []) })))
    if (homeBtn) {
      await step('click the world frame "Portfolio" link (navigates the top window home)', async () => { await tap(homeBtn[0], homeBtn[1]) })
    }
    await sleep(800)
    res.loading.steps = steps
    res.loading.end = await snap().catch(() => null)
    res.loading.phasesSeen = await page.evaluate(() => window.__pf.phases.map((p) => p[0]).join(' > ')).catch(() => null)
  } catch (e) {
    res.error = String(e).slice(0, 500)
  }
  await heap.stop()
  res.issues = { console: dedupe(issues.console, 10), pageerrors: dedupe(issues.pageerrors), http: dedupe(issues.http) }
  await close()
  log(`${LABEL} #${i + 1}: ${res.error ? 'ERROR ' + res.error : 'probed'}`)
  return res
}

/* ---- main ------------------------------------------------------------- */

const version = await chromeVersion()
const doc = {
  harness: 'perf-world', label: LABEL, mode: MODE, entry: MODE === 'direct' ? 'direct' : ENTRY, profile: prof.label, cpuThrottle: CPU, network: NET ?? 'none (localhost)',
  driveMs: DRIVE_MS, play: PLAY, env: environment(version), runsRequested: RUNS, runs: [],
}
for (let i = 0; i < RUNS; i++) doc.runs.push(MODE === 'probe' ? await probeRep(version, i) : await enterRep(version, i))
if (MODE !== 'probe') {
  const ok = doc.runs.filter((r) => !r.error && r.timing)
  doc.failedRuns = doc.runs.length - ok.length
  doc.summary = summarize(ok, (r) => ({
    timing: { ...r.timing, phasesMs: undefined },
    loading: { tasks: r.loading.tasks, loaf: { count: r.loading.loaf.count, longest: r.loading.loaf.longest, blockingMs: r.loading.loaf.blockingMs }, wholeSequenceTasks: r.loading.wholeSequenceTasks, coverGrowTasks: r.loading.coverGrowTasks, revealTasks: r.loading.revealTasks, main: r.loading.main, mainWholeSequence: r.loading.mainWholeSequence, cls: r.loading.cls },
    bytes: Object.fromEntries(Object.entries(r.bytes).map(([k, v]) => [k, { requests: v.requests, transferKb: v.transferKb, kind: Object.fromEntries(Object.entries(v.byKind).map(([kk, vv]) => [kk, vv.kb])) }])),
    heap: r.heap, heapAtReady: r.heapAtReady, renderer: r.renderer, rendererAfterDrive: r.rendererAfterDrive,
    firstMotion: r.firstMotion,
    idle: r.idle && { frame: r.idle.frame, render: r.idle.render, tasksFrame: r.idle.tasksFrame, main: r.idle.main, layoutPerFrame: r.idle.layoutPerFrame, stylePerFrame: r.idle.stylePerFrame },
    drive: r.drive && { ...r.drive, samples: undefined, eventTiming: undefined, loafFrame: { count: r.drive.loafFrame.count, blockingMs: r.drive.loafFrame.blockingMs, longest: r.drive.loafFrame.longest }, loafParent: { count: r.drive.loafParent.count, blockingMs: r.drive.loafParent.blockingMs, longest: r.drive.loafParent.longest }, qualityBefore: undefined, qualityAfter: r.drive.qualityAfter && { changes: r.drive.qualityAfter.changes, level: r.drive.qualityAfter.level, pr: r.drive.qualityAfter.pr } },
    dialogs: r.dialogs && Object.fromEntries(Object.entries(r.dialogs).map(([k, v]) => [k, v && { clickToDomMs: v.clickToDomMs, clickToPaintMs: v.clickToPaintMs, photographMs: v.photographMs, tasks: v.tasks, eventTimingMaxMs: v.eventTimingMaxMs }])),
  }))
}
emit(doc, `perf-world-${LABEL}.json`)
