/* The runtime's side of the parent <-> runtime loading protocol (see public/archipelago/preview/runtime/loading.js),
   played against the real runtime in a real browser. A same-origin host page plays /world's shell: it keeps every
   archipelago:* message it receives (with its time) and the time of every one of its own animation frames, and posts
   archipelago:live / archipelago:revealed when a scenario asks.

     QA_BASE=http://127.0.0.1:3263 node scripts/qa/world-loading-protocol.mjs [--fallback false] [--label name]

   Scenarios
     embedded       keys and pointer events thrown at the runtime while it loads and after ready, before live:
                    ignored (no map, no dialog, the car stays put), `ready` still arrives; progress is monotonic, coalesced,
                    stepped, ends at 1 before ready; a host frame is presented soon after every step change;
                    `live` focuses the canvas, shows the controls notice and takes input; `revealed` releases the quality governor
     fallback       a host that never says live: the runtime goes live 8 s after ready
     standalone     opened on its own: live at once, the notice and focus come with the car
     map-before-ready  the map opened between the car and ready (standalone) does not stall ready
   Writes .qa/runs/impl/startup/protocol-<label>.json with the messages and the numbers asserted on. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, BASE, sleep, assert, finish } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const LABEL = arg('label', 'run'), FALLBACK = arg('fallback', 'true') !== 'false'
const OUT = path.resolve('.qa/runs/impl/startup')
const results = []
const HOST = `<!doctype html><title>host</title><style>body{margin:0}iframe{width:1280px;height:800px;border:0}</style><iframe id="f" src="/archipelago/preview/index.html"></iframe>
<script>window.__log=[];window.__frames=[];const t0=performance.now();
addEventListener('message',e=>{if(e.origin===location.origin&&e.data&&String(e.data.type).startsWith('archipelago:'))__log.push({t:Math.round(performance.now()-t0),e:performance.timeOrigin+performance.now(),...e.data})});
(function tick(t){__frames.push(Math.round(t-t0));if(__frames.length<4000)requestAnimationFrame(tick)})(0);
window.__send=type=>document.getElementById('f').contentWindow.postMessage({type},location.origin);
window.__focusFrame=()=>document.getElementById('f').contentWindow.focus();</script>`
const KEYS = ['KeyM', 'Tab', 'KeyK', 'KeyH', 'KeyW', 'Space', 'Enter', 'Escape', 'KeyE', 'KeyC', 'ArrowUp']

const browser = await launch()
const newPage = async (name) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${String(e).slice(0, 300)}`))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text().slice(0, 300)}`) })
  return { page, errors, context }
}
const frameOf = (page) => page.frames().find((f) => f.url().includes('/archipelago/preview/'))
const log = (page) => page.evaluate(() => window.__log)
const waitFor = (page, type, timeout = 240_000) => page.waitForFunction((t) => window.__log.some((m) => m.type === t), type, { timeout, polling: 50 })
const state = (frame) => frame.evaluate(() => {
  const a = window.__archipelago, d = a?.driving
  return {
    atlasOpen: !!a?.atlas?.isOpen, dialogOpen: !!document.querySelector('dialog[open]'), speed: d ? Math.abs(d.vehicle.speedKmh) : null,
    position: d ? d.vehicle.position.toArray().map((v) => Math.round(v * 100) / 100) : null, live: a?.host.live, liveReason: a?.host.liveReason, embedded: a?.host.embedded,
    focused: document.activeElement?.id ?? document.activeElement?.tagName, notice: document.querySelector('#notice')?.classList.contains('show') ? document.querySelector('#notice').textContent : null,
    held: a?.quality?.held ?? null, ready: document.body.dataset.ready === 'true',
  }
})
const throwInput = (frame) => frame.evaluate((keys) => {
  for (const code of keys) { for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true })) }
  const canvas = document.querySelector('#world')
  for (const type of ['pointerdown', 'pointerup', 'click', 'mousedown', 'mouseup']) canvas?.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: 500, clientY: 400, pointerId: 1 }))
}, KEYS).catch(() => {})

/* ---------- embedded ---------- */
{
  const { page, errors, context } = await newPage('embedded')
  await page.route(`${BASE}/__host.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST }))
  await page.goto(`${BASE}/__host.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, 'archipelago:hello', 120_000)
  let thrown = 0
  const pump = (async () => { while (!(await log(page)).some((m) => m.type === 'archipelago:ready')) { const f = frameOf(page); if (f) { await throwInput(f); thrown++; } await sleep(60) } })()
  // Real key presses too, into the frame, while it loads.
  await page.evaluate(() => window.__focusFrame())
  for (const code of ['KeyM', 'Tab', 'KeyK', 'KeyH', 'KeyW', 'Space']) { await page.keyboard.press(code).catch(() => {}); await sleep(40) }
  await waitFor(page, 'archipelago:ready')
  await pump
  const frame = frameOf(page)
  await sleep(300)
  const messages = await log(page), frames = await page.evaluate(() => window.__frames)
  const readyAt = messages.find((m) => m.type === 'archipelago:ready').t
  let atReady = await state(frame)
  assert(!!messages.find((m) => m.type === 'archipelago:ready') && thrown > 2, `ready arrives although M, Tab, K, H, Space and W were pressed ${thrown}x while loading`, results)
  assert(atReady.embedded === true && atReady.live === false, `embedded in a host, the runtime is not live before the host says so (${JSON.stringify({ embedded: atReady.embedded, live: atReady.live })})`, results)
  assert(!atReady.atlasOpen && !atReady.dialogOpen, `no map and no dialog was opened behind the leaves (${JSON.stringify({ atlas: atReady.atlasOpen, dialog: atReady.dialogOpen })})`, results)
  assert(atReady.speed < 0.5, `the car did not drive on its own (speed ${atReady.speed})`, results)
  assert(!/WASD|Drag to drive/.test(atReady.notice ?? ''), `no controls notice before live (${atReady.notice})`, results)
  // After ready, still before live.
  await page.evaluate(() => window.__focusFrame())
  for (const code of ['KeyM', 'Tab', 'KeyK', 'KeyW']) { await page.keyboard.down(code).catch(() => {}); await sleep(120); await page.keyboard.up(code).catch(() => {}) }
  await throwInput(frame); await sleep(500)
  const waiting = await state(frame)
  assert(!waiting.atlasOpen && !waiting.dialogOpen && waiting.speed < 0.5, `after ready, before live, input is still ignored (${JSON.stringify({ atlas: waiting.atlasOpen, dialog: waiting.dialogOpen, speed: waiting.speed })})`, results)
  assert(waiting.held === true, 'the quality governor is held until the leaves have parted', results)

  // ---- the progress sequence
  const progress = messages.filter((m) => m.type === 'archipelago:progress')
  const mono = progress.every((m, i) => i === 0 || (m.value >= progress[i - 1].value && m.step >= progress[i - 1].step))
  assert(messages[0].type === 'archipelago:hello' && progress.length >= 8 && progress.at(-1).t <= readyAt, `hello comes first, ${progress.length} progress messages precede ready`, results)
  assert(mono, 'progress value and step never go backwards', results)
  assert(progress.every((m) => m.of === 8 && Number.isInteger(m.step) && m.step >= 0 && m.step <= 8 && typeof m.stage === 'string' && m.value >= 0 && m.value <= 1), 'every message carries stage, value 0..1, an integer step and of = 8', results)
  assert(progress[0].step === 0 && progress.at(-1).value === 1 && progress.at(-1).step === 8, `it starts at step 0 and ends at step 8 / value 1 (${JSON.stringify(progress[0])} … ${JSON.stringify(progress.at(-1))})`, results)
  const steps = [...new Set(progress.map((m) => m.step))]
  assert(steps.length >= 8, `every step is announced (${steps.join(',')})`, results)
  // Coalescing is asserted exactly in tests/world/loading-protocol.test.mjs (injected clock). Here, from the host's side, a posted value
  // always moves: the host's receipt times bunch up whenever a long task holds it, so only repeated values can be told apart.
  const repeats = progress.filter((m, i) => i && m.step === progress[i - 1].step && m.value === progress[i - 1].value).length
  assert(repeats === 0, `no message repeats the one before it (${repeats} of ${progress.length})`, results)
  const violations = repeats
  assert(progress.length <= 90, `the host is not flooded (${progress.length} messages)`, results)
  const changes = progress.filter((m, i) => i && m.step !== progress[i - 1].step && m.step < 8)
  // Each step change reaches the host before the long task it announces begins: the runtime posts it, yields a presented frame,
  // and only then starts working (runtime/loading.js nextFrame). Compared on one clock: the runtime marks `archipelago:<step>:start` as it posts.
  const marks = await frame.evaluate(() => performance.getEntriesByType('mark').map((m) => [m.name, performance.timeOrigin + m.startTime]))
  const markAt = (id) => marks.find(([n]) => n === `archipelago:${id}:start`)?.[1]
  const order = ['load', 'build', 'restore', 'place', 'drive', 'prepare', 'compile', 'frame']
  const late = []
  for (let k = 1; k < 8; k++) {
    const received = messages.find((m) => m.type === 'archipelago:progress' && m.step === k)?.e, posted = markAt(order[k]), nextPost = markAt(order[k + 1]) ?? Infinity
    if (received === undefined || posted === undefined || received > nextPost || received - posted > 1500) late.push(`${order[k]} (+${Math.round(received - posted)} ms, next step began +${Math.round(nextPost - posted)})`)
  }
  assert(late.length === 0, `each of the 7 step changes reaches the host before the work it announces runs${late.length ? ' — late: ' + late.join(', ') : ''}`, results)
  // Secondary: the host's own animation frames keep coming around the step changes (a busy machine delays some, hence the slack).
  const unseen = changes.filter((m) => !frames.some((f) => f >= m.t - 2 && f <= m.t + 600))
  assert(changes.length >= 6 && unseen.length <= 3, `host frames are presented around the step changes (${changes.length} changes, ${unseen.length} without a frame in 600 ms: ${unseen.map((m) => m.step)})`, results)
  // The bytes are honest: while only the download step has run the value is below the CPU steps'.
  assert(progress.find((m) => m.step === 1).value <= 0.55 && progress.find((m) => m.step === 4).value >= 0.5, 'the value follows the work: under half while the island downloads, past half once the car starts', results)

  // ---- live
  const before = await state(frame)
  await frame.evaluate(() => document.activeElement?.blur())
  await page.evaluate(() => window.__send('archipelago:live'))
  await sleep(250)
  const live = await state(frame)
  assert(live.live === true && live.liveReason === 'host' && live.focused === 'world', `live: the runtime goes live and focuses the canvas (${JSON.stringify({ live: live.live, focused: live.focused })})`, results)
  assert(/WASD|Drag to drive/.test(live.notice ?? ''), `live: the controls notice is shown now (${live.notice})`, results)
  await page.keyboard.down('KeyW'); await sleep(900)
  const driving = await state(frame)
  await page.keyboard.up('KeyW')
  assert(driving.speed > 1 || Math.hypot(driving.position[0] - before.position[0], driving.position[2] - before.position[2]) > 0.5, `W drives the car once live (speed ${driving.speed})`, results)
  await page.keyboard.press('KeyM'); await sleep(900)
  assert((await state(frame)).atlasOpen === true, 'M opens the map once live', results)
  await page.keyboard.press('KeyM'); await sleep(500)
  assert((await state(frame)).held === true, 'the governor is still held until revealed', results)
  await page.evaluate(() => window.__send('archipelago:revealed')); await sleep(200)
  assert((await state(frame)).held === false, 'revealed: the quality governor is released', results)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, `protocol-${LABEL}.json`), JSON.stringify({ label: LABEL, base: BASE, readyAt, thrown, messages, hostFrames: frames.length, violations }, null, 1))
  assert(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

/* ---------- fallback ---------- */
if (FALLBACK) {
  const { page, errors, context } = await newPage('fallback')
  await page.route(`${BASE}/__host.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: HOST }))
  await page.goto(`${BASE}/__host.html`, { waitUntil: 'domcontentloaded' })
  await waitFor(page, 'archipelago:ready')
  const frame = frameOf(page), t0 = Date.now()
  await sleep(2500)
  assert((await state(frame)).live === false, 'a silent host: not live 2.5 s after ready', results)
  await page.waitForFunction(() => document.querySelector('#f').contentWindow.__archipelago.host.live, null, { timeout: 12_000, polling: 100 })
  const waited = Date.now() - t0, after = await state(frame)
  assert(after.liveReason === 'fallback' && waited > 6500 && waited < 10_500, `a silent host: live by fallback ~8 s after ready (${waited} ms)`, results)
  assert(/WASD|Drag to drive/.test(after.notice ?? '') && after.focused === 'world', 'and the notice and focus follow', results)
  const heldAtLive = (await state(frame)).held
  await page.waitForFunction(() => document.querySelector('#f').contentWindow.__archipelago.quality.held === false, null, { timeout: 8000, polling: 100 }).catch(() => {})
  assert(heldAtLive === true && (await state(frame)).held === false, 'an old host never says revealed: the quality governor is released 4 s after live', results)
  assert(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

/* ---------- standalone ---------- */
{
  const { page, errors, context } = await newPage('standalone')
  await page.goto(`${BASE}/archipelago/preview/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__archipelago?.host && document.body.dataset.ready === 'true', null, { timeout: 240_000, polling: 100 })
  const s = await state(page.mainFrame())
  assert(s.embedded === false && s.live === true && s.liveReason === 'standalone', `opened on its own it is live at once (${JSON.stringify({ embedded: s.embedded, live: s.live, reason: s.liveReason })})`, results)
  assert(s.focused === 'world' && /WASD|Drag to drive/.test(s.notice ?? ''), `the canvas has focus and the controls notice came with the car (${s.focused}, ${s.notice})`, results)
  await page.keyboard.down('KeyW'); await sleep(900)
  const d = await state(page.mainFrame()); await page.keyboard.up('KeyW')
  assert(d.speed > 1, `W drives at once (speed ${d.speed})`, results)
  assert(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

/* ---------- the map opened before ready ---------- */
{
  const { page, errors, context } = await newPage('map-before-ready')
  // Tab as soon as the car exists and ready has not been announced: the frame loop draws nothing while the map is open.
  await page.addInitScript(() => {
    const t = setInterval(() => {
      const a = window.__archipelago
      if (a?.driving && document.body.dataset.ready !== 'true' && !window.__pressed) { window.__pressed = performance.now(); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Tab', key: 'Tab', bubbles: true, cancelable: true })); clearInterval(t) }
    }, 2)
  })
  await page.goto(`${BASE}/archipelago/preview/index.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 60_000, polling: 100 }).catch(() => {})
  const s = await page.evaluate(() => ({ ready: document.body.dataset.ready === 'true', pressed: window.__pressed ?? null, atlas: !!window.__archipelago?.atlas?.isOpen }))
  assert(s.ready && s.pressed !== null, `Tab pressed between the car and ready: the map opens (${s.atlas}) and ready still arrives`, results)
  assert(errors.length === 0, `no errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

await browser.close()
finish(results)
