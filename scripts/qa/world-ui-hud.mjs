/* /world HUD latency and per-frame UI cost, in the public player on the real GPU.

   What the visitor's HUD owes the visitor: the interact button is on the frame its prompt
   becomes active (and gone on the frame it ends), a race clock that shows centiseconds
   moves at the display's rate, the speed readout follows the car about ten times a second
   and is written only when its text changed, and none of it makes the page lay out more
   than it has to or read the layout in an event handler:

   - prompt -> button: the car is put at the slalom's start prompt and away from it again, 14 times at
     random phases of any timer; frames (and ms) between the prompt being active and the button shown;
   - the activity clock: mutations of #gameplay-hud per second while a slalom run is timing;
   - the speed readout: writes per second while W is held, and that no write repeated the text it had;
   - the layout work: CDP LayoutCount / RecalcStyleCount / LayoutDuration per second parked and driving;
   - event handlers: Element.getBoundingClientRect calls by the input layer (Pointer) over 150 mouse moves on the canvas;
   - the frame loop: document.querySelector('dialog[open]') calls per second (the loop keeps a count of open dialogs instead).

     QA_BASE=http://localhost:3210 node scripts/qa/world-ui-hud.mjs [--label after] [--out dir]

   Writes <out>/hud-<label>.json. The thresholds are what the HUD is meant to meet; run on a tree from before the HUD
   change they fail (that is the check that this script sees what it is for). */
import fs from 'node:fs'
import path from 'node:path'
import { BASE, launch, openPlayer, assert, sleep, finish, watch } from './lib.mjs'
import { webkit, firefox } from 'playwright'

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback }
const label = arg('label', 'run'), dir = path.resolve(arg('out', '.qa/runs/impl/ui')), engine = arg('browser', 'chromium')
fs.mkdirSync(dir, { recursive: true })
const results = [], report = { label, base: BASE, engine }
const browser = engine === 'chromium' ? await launch() : await { webkit, firefox }[engine].launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
const page = await context.newPage()
const errors = watch(page)
await openPlayer(page)
await sleep(2500)
// Layout counts come from CDP: Chromium only (the other engines run the latency, clock, speed and handler checks).
const cdp = engine === 'chromium' ? await context.newCDPSession(page) : null
await cdp?.send('Performance.enable')
const metrics = async () => (cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : { LayoutCount: 0, RecalcStyleCount: 0, LayoutDuration: 0, ScriptDuration: 0 })
const press = async (key, ms = 90) => { await page.keyboard.down(key); await sleep(ms); await page.keyboard.up(key) }
const place = (x, z, heading = 0) => page.evaluate(([x, z, heading]) => { const A = globalThis.__archipelago; A.driving.vehicle.moveTo({ x, y: A.editor.terrainHeightAt(x, z) + 1.3, z }, heading) }, [x, z, heading])
const stats = (a) => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? { n, min: s[0], median: s[n >> 1], mean: +(s.reduce((x, y) => x + y, 0) / n).toFixed(2), p90: s[Math.min(n - 1, Math.floor(n * 0.9))], max: s[n - 1] } : { n: 0 } }

/* ---- prompt -> button ---- */
const latency = await page.evaluate(async ({ near, far, reps }) => {
  const A = globalThis.__archipelago, button = document.querySelector('#interact-action'), wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const frame = () => new Promise((r) => requestAnimationFrame(r))
  const move = ([x, z]) => A.driving.vehicle.moveTo({ x, y: A.editor.terrainHeightAt(x, z) + 1.3, z }, 0)
  const out = { appear: [], disappear: [], stuck: 0 }
  for (let rep = 0; rep < reps; rep++) {
    move(far)
    for (let i = 0; i < 90 && (A.activities.prompt || !button.hidden); i++) await frame()
    await wait(Math.random() * 520)
    // On: the frame the prompt is active, and the frame the button is shown.
    move(near)
    let promptAt = null, shownAt = null, n = 0
    for (; n < 120 && shownAt === null; n++) {
      const t = await frame().then(() => performance.now())
      if (promptAt === null && A.activities.prompt) promptAt = { n, t }
      if (promptAt && !button.hidden) shownAt = { n, t }
    }
    if (promptAt && shownAt) out.appear.push({ frames: shownAt.n - promptAt.n, ms: +(shownAt.t - promptAt.t).toFixed(1) }); else out.stuck++
    for (let i = 0; i < 40; i++) await frame()
    // Off.
    await wait(Math.random() * 520)
    move(far)
    let goneAt = null, hiddenAt = null
    for (n = 0; n < 120 && hiddenAt === null; n++) {
      const t = await frame().then(() => performance.now())
      if (goneAt === null && !A.activities.prompt) goneAt = { n, t }
      if (goneAt && button.hidden) hiddenAt = { n, t }
    }
    if (goneAt && hiddenAt) out.disappear.push({ frames: hiddenAt.n - goneAt.n, ms: +(hiddenAt.t - goneAt.t).toFixed(1) }); else out.stuck++
  }
  return out
}, { near: [-47, -26.5], far: [-47, 18], reps: 14 })
report.promptAppear = { frames: stats(latency.appear.map((r) => r.frames)), ms: stats(latency.appear.map((r) => r.ms)) }
report.promptDisappear = { frames: stats(latency.disappear.map((r) => r.frames)), ms: stats(latency.disappear.map((r) => r.ms)) }
console.log('prompt -> button, appear', JSON.stringify(report.promptAppear), 'disappear', JSON.stringify(report.promptDisappear), 'unseen', latency.stuck)
assert(latency.stuck === 0 && latency.appear.length === 14 && latency.disappear.length === 14, 'every prompt change was seen on the button', results)
assert(report.promptAppear.frames.max <= 2 && report.promptDisappear.frames.max <= 2, `the interact button follows its prompt within 2 frames (appear max ${report.promptAppear.frames.max}, disappear max ${report.promptDisappear.frames.max}; ${report.promptAppear.ms.max} / ${report.promptDisappear.ms.max} ms)`, results)

/* ---- the activity clock ---- */
await place(-47, -26.5, 0)
await sleep(1200)
await page.locator('canvas').first().focus().catch(() => {})
await press('Enter')
await sleep(3800)
const armed = await page.evaluate(() => globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state)
// Crossing the start line starts the clock; the car then stands still while it runs.
await page.evaluate(async () => {
  const A = globalThis.__archipelago, frame = () => new Promise((r) => requestAnimationFrame(r))
  for (let x = -45.2; x <= -40; x += 0.45) { A.driving.vehicle.moveTo({ x, y: A.editor.terrainHeightAt(x, -26.5) + 1.1, z: -26.5 }, 0); await frame() }
})
const running = await page.evaluate(() => globalThis.__archipelago.activities.list.find((a) => a.spec.type === 'slalom').state)
const clock = await page.evaluate(async () => {
  const hud = document.querySelector('#gameplay-hud'), seen = []
  const observer = new MutationObserver(() => seen.push({ t: performance.now(), text: hud.textContent }))
  observer.observe(hud, { childList: true, characterData: true, subtree: true })
  await new Promise((r) => setTimeout(r, 2000))
  observer.disconnect()
  const timers = seen.map((s) => s.text.match(/\d+\.\d\d s/)?.[0]).filter(Boolean)
  return { writes: seen.length, perSecond: +(seen.length / 2).toFixed(1), distinctTimers: new Set(timers).size, sample: seen.slice(0, 3).map((s) => s.text) }
})
report.clock = { state: { armed, running }, ...clock }
console.log('activity clock', JSON.stringify(report.clock))
assert(running === 'running', `a slalom run is timing (${armed} -> ${running})`, results)
assert(clock.perSecond >= 30 && clock.distinctTimers >= 40, `the race clock moves at the display's rate (${clock.perSecond} HUD writes per second, ${clock.distinctTimers} distinct readings in 2 s)`, results)
await press('Escape')
await sleep(500)

/* ---- the speed readout, and the layout work while driving ---- */
// The longest clear straight of the island: the car accelerates, then cruises, instead of meeting a wall.
const straight = await page.evaluate(() => {
  const A = globalThis.__archipelago, d = A.driving; let best = { len: 0 }
  for (let x = -120; x <= 120; x += 12) for (let z = -100; z <= 150; z += 12) for (let k = 0; k < 16; k++) {
    const h = (k * Math.PI) / 8, fx = Math.cos(h), fz = -Math.sin(h); let len = 0
    if (!d.placement.check(x, z, h, { dynamicMargin: 1 }).ok) continue
    for (let m = 4; m <= 160; m += 4) { if (!d.placement.check(x + fx * m, z + fz * m, h, { dynamicMargin: 1 }).ok) break; len = m }
    if (len > best.len) best = { x, z, h, len }
  }
  return best
})
await place(straight.x, straight.z, straight.h)
await sleep(1500)
const parked0 = await metrics()
await sleep(5000)
const parked1 = await metrics()
const perS = (a, b, k, s) => +((b[k] - a[k]) / s).toFixed(2)
report.parked = { layoutPerS: perS(parked0, parked1, 'LayoutCount', 5), stylePerS: perS(parked0, parked1, 'RecalcStyleCount', 5), layoutMsPerS: +(((parked1.LayoutDuration - parked0.LayoutDuration) / 5) * 1000).toFixed(2) }
await page.evaluate(() => {
  const speed = document.querySelector('#speed'), writes = []
  window.__speed = { writes, observer: new MutationObserver(() => writes.push({ t: performance.now(), text: speed.textContent })) }
  window.__speed.observer.observe(speed, { childList: true, characterData: true, subtree: true })
  window.__speed.initial = speed.textContent
})
await page.keyboard.down('KeyW')
const seconds = []
let last = await metrics(), lastWrites = 0
for (let i = 0; i < 8; i++) {
  await sleep(1000)
  const now = await metrics(), writes = await page.evaluate(() => window.__speed.writes.length), kmh = await page.evaluate(() => Math.round(globalThis.__archipelago.driving.vehicle.speedKmh))
  seconds.push({ second: i + 1, layouts: now.LayoutCount - last.LayoutCount, readoutWrites: writes - lastWrites, kmh, layoutMs: +((now.LayoutDuration - last.LayoutDuration) * 1000).toFixed(2), scriptMs: +((now.ScriptDuration - last.ScriptDuration) * 1000).toFixed(0) })
  last = now; lastWrites = writes
}
await page.keyboard.up('KeyW')
const speed = await page.evaluate(() => {
  const { writes, observer, initial } = window.__speed; observer.disconnect()
  let repeats = 0, previous = initial
  for (const w of writes) { if (w.text === previous) repeats++; previous = w.text }
  const gaps = writes.slice(1).map((w, i) => w.t - writes[i].t)
  return { writes: writes.length, repeats, distinct: new Set(writes.map((w) => w.text)).size, medianGapMs: gaps.length ? +[...gaps].sort((a, b) => a - b)[gaps.length >> 1].toFixed(0) : null, last: writes.at(-1)?.text }
})
report.speed = speed
report.straight = straight
report.driveSeconds = seconds
const driven = seconds.filter((r) => r.kmh >= 10)
report.driving = { layoutPerS: +(driven.reduce((a, r) => a + r.layouts, 0) / driven.length).toFixed(2), layoutMsPerS: +(driven.reduce((a, r) => a + r.layoutMs, 0) / driven.length).toFixed(2), scriptMsPerS: +(driven.reduce((a, r) => a + r.scriptMs, 0) / driven.length).toFixed(0), seconds: driven.length }
console.log('speed readout', JSON.stringify(speed), '\nparked', JSON.stringify(report.parked), '\ndriving', JSON.stringify(report.driving), '\nper second', seconds.map((r) => `${r.layouts}L/${r.readoutWrites}W@${r.kmh}`).join(' '))
assert(speed.writes >= 5 && speed.repeats === 0, `the speed readout was written ${speed.writes} times while W was held, none repeating the text it had (${speed.repeats} repeats; last ${speed.last})`, results)
assert(speed.medianGapMs !== null && speed.medianGapMs <= 150, `and about ten times a second while it changes (median gap ${speed.medianGapMs} ms)`, results)
if (cdp) assert(report.parked.layoutPerS <= 1, `parked: the page lays out at most once a second (${report.parked.layoutPerS}/s, ${report.parked.layoutMsPerS} ms/s)`, results)
if (cdp) assert(seconds.every((r) => r.layouts <= r.readoutWrites + 2) && report.driving.layoutMsPerS < 5, `driving: layout runs for the readout's own writes and for nothing else (layouts per second never more than the readout's writes + 2; ${report.driving.layoutMsPerS} ms/s of layout)`, results)
if (cdp) assert(seconds.filter((r) => r.readoutWrites === 0).every((r) => r.layouts <= 2), `and a second in which the readout did not change lays out at most twice (${seconds.filter((r) => r.readoutWrites === 0).map((r) => r.layouts).join(', ') || 'none'})`, results)

/* ---- dialogs: from the click to the frame that shows them (Event Timing: processing + the next paint) ---- */
await place(straight.x, straight.z, straight.h)
await sleep(800)
const dialogs = []
for (const [button, dialog, close] of [['#player-help', '#help-dialog', '#close-help'], ['#player-awards', '#awards-dialog', '#close-awards'], ['#player-help', '#help-dialog', '#close-help'], ['#player-awards', '#awards-dialog', '#close-awards']]) {
  await page.evaluate(() => {
    window.__events = []
    try { window.__eventObserver?.disconnect(); window.__eventObserver = new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === 'click') window.__events.push({ duration: e.duration, delay: e.processingStart - e.startTime, processing: e.processingEnd - e.processingStart }) }); window.__eventObserver.observe({ type: 'event', durationThreshold: 16, buffered: false }) } catch { window.__events = null }
  })
  const box = await page.locator(button).boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await page.waitForFunction((d) => document.querySelector(d).open, dialog, { timeout: 5000 })
  await sleep(300)
  const events = await page.evaluate(() => window.__events)
  dialogs.push(events === null ? null : events[0] ?? { duration: 0, note: 'under 16 ms' })
  await page.locator(close).click(); await sleep(300)
}
report.dialogs = dialogs
console.log('click -> dialog on screen (event timing)', JSON.stringify(dialogs))
if (dialogs.every((d) => d)) assert(dialogs.every((d) => d.duration <= 48), `a click opens a dialog within three frames (${dialogs.map((d) => d.duration).join(', ')} ms)`, results)

/* ---- what asking for the HUD costs, per frame (the visitor's HUD asks every frame) ---- */
const query = await page.evaluate(() => {
  const A = globalThis.__archipelago, once = () => { A.gameplay.hud(); A.trackGameplay?.hud(); A.activities?.hud() }
  for (let i = 0; i < 300; i++) once()
  const n = 4000, t0 = performance.now(); for (let i = 0; i < n; i++) once()
  return +(((performance.now() - t0) / n) * 1000).toFixed(1)
})
report.hudQueryMicroseconds = query
console.log('one HUD query (gameplay + track + activities)', query, 'us')
assert(query < 100, `one frame's HUD query costs ${query} us (under 100 us, 0.6% of a 60 Hz frame)`, results)

/* ---- layout shifts while the speed readout moves ---- */
const shifts = await page.evaluate(async () => {
  let value = 0, count = 0
  const observer = new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) { value += e.value; count++ } })
  try { observer.observe({ type: 'layout-shift', buffered: false }) } catch { return null }
  window.__shifts = () => { const records = observer.takeRecords(); for (const e of records) if (!e.hadRecentInput) { value += e.value; count++ } observer.disconnect(); return { value, count } }
  return true
})
if (shifts) {
  await page.keyboard.down('KeyW'); await sleep(2500); await page.keyboard.up('KeyW')
  report.layoutShift = await page.evaluate(() => window.__shifts())
  console.log('layout shift while the speed readout moves', JSON.stringify(report.layoutShift))
  assert(report.layoutShift.value === 0, `the readouts shift nothing while they change (layout-shift ${report.layoutShift.value} in ${report.layoutShift.count} entries)`, results)
}

/* ---- event handlers and the frame loop ---- */
const handlers = await page.evaluate(async () => {
  // rects: reads made by the input layer's Pointer (what an event handler must not do); others: reads by anything else (the Career area measures the HUD to keep its plaques clear of it).
  const counts = { rects: 0, others: 0, dialogQueries: 0 }
  const rect = Element.prototype.getBoundingClientRect, query = Document.prototype.querySelector
  Element.prototype.getBoundingClientRect = function () { if (new Error().stack.includes('/input/Pointer.js')) counts.rects++; else counts.others++; return rect.call(this) }
  Document.prototype.querySelector = function (s) { if (s === 'dialog[open]') counts.dialogQueries++; return query.call(this, s) }
  await new Promise((r) => setTimeout(r, 2000))
  const frames = await new Promise((r) => { let n = 0; const t0 = performance.now(); const tick = () => { if (++n >= 60) r(n / ((performance.now() - t0) / 1000)); else requestAnimationFrame(tick) }; requestAnimationFrame(tick) })
  const idle = { ...counts }
  counts.rects = 0; counts.others = 0
  window.__counts = counts; window.__restore = () => { Element.prototype.getBoundingClientRect = rect; Document.prototype.querySelector = query }
  return { idle, fps: +frames.toFixed(0) }
})
await page.mouse.move(300, 300)
await page.mouse.move(900, 600, { steps: 150 })
const moves = await page.evaluate(() => { const c = { ...window.__counts }; window.__restore(); return c })
report.handlers = { idleTwoSeconds: handlers.idle, fps: handlers.fps, mouseMoves: 150, rectsDuringMoves: moves.rects, otherReadsDuringMoves: moves.others }
console.log('handlers', JSON.stringify(report.handlers))
assert(moves.rects <= 5, `150 mouse moves on the canvas made the input layer read the layout ${moves.rects} times (the canvas rect is cached)`, results)
assert(handlers.idle.dialogQueries === 0, `the frame loop asked the document for an open dialog ${handlers.idle.dialogQueries} times in 2 s (it keeps a count)`, results)

assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
fs.writeFileSync(path.join(dir, `hud-${engine === 'chromium' ? '' : engine + '-'}${label}.json`), JSON.stringify(report, null, 1))
await browser.close()
finish(results)
