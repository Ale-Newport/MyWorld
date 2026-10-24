/* The way into /world is a closed door: while the leaves cover the screen nothing behind
   them scrolls, bounces, refreshes, zooms, takes focus or takes a click — through every way
   in — and the loader on the leaves keeps moving while the main thread is blocked.

     node scripts/qa/world-loading-lock.mjs [--only entries,early,history,reentry,readyfirst,reveal,error,reduced,protocol,quiet,slow,resize,compositor,latency]
                                            [--skip a,b] [--entries scroll,link,index,direct] [--cpu 4] [--phone]
                                            [--engine chromium|webkit|firefox]

   The world is held in LOADING_WORLD deterministically (page.route on main.js) and, for the
   entries that start on the homepage, in COVERED (page.route on the /world RSC request), so
   every assertion is made in the state it names. It needs the production runtime under
   QA_BASE (default http://localhost:3210) and writes screenshots to QA_OUT. `--phone` is a Pixel 7
   emulation (use with `--cpu 4`); `--engine webkit|firefox` runs the CDP-free subset
   (`--only entries,reduced,protocol --entries link,direct`).

   Sections
     protocol     progress messages as an old and a new runtime send them: marks, monotonic, no DOM churn, stage names only
     entries      scroll push, "Enter my world" link, the index link, a direct URL: the lock in
                  COVERED and in LOADING_WORLD — html overflow/overscroll, touch-action where a gesture lands, Lenis,
                  every body child inert except the cover/loader/status/dialog, iframe inert and
                  out of the tab order, wheel ±, Space/PgUp/PgDn/Home/End/arrows/i, touch scroll
                  and pull-to-refresh, pinch, Tab ×20 and Shift+Tab ×20, click-through counter,
                  the same again while a 2.5 s busy loop blocks the main thread
     early        the first second of a way in, the one the section above never sees (it holds the world at COVERED):
                  the page behind is made inert only once the cover is verified, so from the instant each entry begins
                  (the foot link by click and by keyboard, the index, the scroll push, a direct URL) a wheel turn, a click, a tap, a finger
                  drag and pinch, and Tab, Shift+Tab, Enter, Space, the arrows, Page keys, Home, End, `i` and Escape arrive every few ms for 1.5 s:
                  not one pointer event reaches anything but the cover or the loader, no focus lands outside them, the page does not move,
                  reload or zoom, and the visitor still ends in the world, having been on no other route
     history      Back in COVERED and in LOADING_WORLD, Forward as a direct arrival, the 20 s watchdog
                  (--no-watchdog skips that wait)
     reentry      Back during the way in, then the way in again (the foot link, a scroll push, the index link)
                  200 ms / 700 ms / 2 s later, while the leaves are still parting for the exit; Back then Forward at
                  once; the error dialog's "Return to the portfolio" then the foot link: every case ends in
                  LOADING_WORLD under a standing cover (and then reaches the world), or on a clean homepage —
                  never locked with nothing over it (--reentry-delays 200,700,2000)
     readyfirst   a direct arrival whose world is ready before its leaves are verified: the reveal waits for them,
                  and holds them on the screen, fully drawn, for a moment (the loader — in the first paint, on the dark of
                  the hedge — is up before them)
     reveal       release at REVEALING (frame focused, `live` posted, the car answers), `revealed` at
                  IN_WORLD, nothing left inert, Back to a working homepage
     error        a world that cannot start: dialog focused on "Try again", page still locked,
                  loader gone; retry shows the loader at zero and recovers
     reduced      prefers-reduced-motion: no looping or transform animation in the loader
     quiet        25 s of real silence says so; 35 s of silence is still no error
     slow         Fast 3G + 4× CPU: no false error, marks never go back
     resize       1440×900 → 900×1200 → 390×844 while covered
     compositor   the loader keeps changing on screen while the main thread is blocked (CDP
                  screencast of a 1.5 s busy loop) and animates only opacity and transform
     latency      route commit: COVERED → LOADING_WORLD with 1.2 s of server render injected (the scroll push: not on --phone) */
import { devices, webkit, firefox } from 'playwright'
import { BASE, launch, sleep, assert, finish, out } from './lib.mjs'

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] }
const only = arg('only', '')?.split(',').filter(Boolean)
const skip = (arg('skip', '') ?? '').split(',').filter(Boolean)
const want = (name) => (only?.length ? only.includes(name) : true) && !skip.includes(name)
const CPU = Number(arg('cpu', 1))
const PHONE = process.argv.includes('--phone')
/* Chromium by default; `--engine webkit|firefox` runs the engine-level subset (no CDP: no touch gestures,
   screencast or CPU throttling) to confirm inert iframes, focus and scroll holds there too. */
const ENGINE = arg('engine', 'chromium')
/* The phone emulation does not deliver `page.mouse.wheel`, so its push is not driven here: it runs the link, the index
   and the direct arrival (the touch push is covered by the real-runtime run with a touch scroll gesture). */
const ENTRIES = (arg('entries', PHONE ? 'link,index,direct' : 'scroll,link,index,direct') ?? '').split(',').filter(Boolean)
const results = []
const errors = []
/* Requests that died on a connection the browser had already set aside while a route was holding them. */
const stale = []
const ALLOW = '[data-world-cover],[data-world-allow],next-route-announcer,nextjs-portal,script,style,link,noscript,template,[hidden]'
const browser = ENGINE === 'webkit' ? await webkit.launch() : ENGINE === 'firefox' ? await firefox.launch() : await launch()

/* ---------------------------------------------------------------- page plumbing */

/** Lets a held request through. The browser reserves a pooled connection for a request the moment it is
    issued, and the server idles that connection out (5 s) while the route is still holding it: continuing then
    sends the request down a dead socket (ERR_SOCKET_NOT_CONNECTED), Next falls back to a hard navigation and the
    run measures the harness instead of the page. So the request is made afresh from here and handed back. */
async function pass(route) {
  try {
    await route.fulfill({ response: await route.fetch() })
  } catch {
    await route.continue().catch(() => {})
  }
}

const INIT = () => {
  window.__phases = []
  window.__reveal = null
  window.__leaks = 0
  window.__gaps = []
  // What this document is told by the one around it (the world's frame hears `live` and `revealed` here).
  window.__msgs = []
  // The first second of a way in (the `early` section): from the first phase event on, what reached the page behind the leaves.
  window.__early = { t0: 0, y0: 0, lastDown: 0, pointer: [], focus: [], moved: 0, paths: [] }
  // A direct arrival starts its world at once and shows its loader at once, on the dark of the hedge; its reveal waits for
  // the leaves, drawn, and holds them a moment (WorldRoute). Frames the loader showed over a cover not yet verified:
  window.__loaderEarly = 0
  window.__coveredAt = 0
  window.__frameAtLoading = null
  window.__coveredAtLoading = null
  window.__revealCovered = null
  window.addEventListener('message', (e) => window.__msgs.push({ type: e.data?.type, at: Date.now() }))
  window.addEventListener('world:phase', (e) => {
    const t = performance.now()
    if (!window.__early.t0) { window.__early.t0 = t; window.__early.y0 = scrollY }
    window.__phases.push({ phase: e.detail, t, wall: Date.now() })
    const verified = () => !!document.querySelector('[data-world-cover][data-covered]')
    if (e.detail === 'LOADING_WORLD' && window.__frameAtLoading === null) { window.__frameAtLoading = !!document.querySelector('iframe'); window.__coveredAtLoading = verified() }
    if (e.detail === 'REVEALING') window.__revealCovered = verified()
    // The first frames of the parting: the world must already be the visitor's.
    if (e.detail === 'REVEALING') requestAnimationFrame(() => requestAnimationFrame(() => {
      const f = document.querySelector('iframe')
      window.__reveal = { after: performance.now() - t, iframeInert: !!f?.closest('[inert]'), focused: document.activeElement === f, tabindex: f?.getAttribute('tabindex'), inerts: document.querySelectorAll('[inert]').length }
    }))
  })
  // Anything that reaches something other than the cover / the loader / the dialog is a leak.
  const leak = (e) => {
    if (!(e.target instanceof Element) || !e.target.closest('[data-world-cover],[data-world-allow]')) {
      window.__leaks++
      const early = window.__early
      // (A click, or the mouse events a touch sends when it ends, whose press began before the way in did — a hammer that straddles
      // it — are that press's, not the leaves'.)
      if (early.t0 && !((e.type === 'click' || e.type === 'mousedown') && early.lastDown < early.t0)) early.pointer.push(`${e.type} on ${e.target?.tagName} ${String(e.target?.className ?? '').slice(0, 24)} at ${Math.round(performance.now() - early.t0)} ms`)
    }
  }
  document.addEventListener('pointerdown', () => { window.__early.lastDown = performance.now() }, true)
  for (const type of ['click', 'pointerdown', 'mousedown', 'touchstart', 'keydown']) document.addEventListener(type, type === 'keydown' ? () => {} : leak, true)
  // Focus that is still on the page behind the leaves when the document hears of it (the machine's own guard runs first and takes it off).
  document.addEventListener('focusin', (e) => {
    const early = window.__early
    if (!early.t0 || !(e.target instanceof Element)) return
    if (e.target.closest('[data-world-cover],[data-world-allow],nextjs-portal,next-route-announcer') || document.activeElement !== e.target) return
    early.focus.push(`${e.target.tagName} ${(e.target.textContent ?? '').trim().slice(0, 20)} at ${Math.round(performance.now() - early.t0)} ms`)
  }, true)
  let last = 0
  const tick = (t) => {
    if (last && t - last > 100) window.__gaps.push([t, t - last])
    last = t
    const early = window.__early
    if (early.t0) {
      if (!early.paths.includes(location.pathname)) early.paths.push(location.pathname)
      // On the homepage the page does not move after the way in begins (a route swap puts a new page at the top: not that).
      if (location.pathname === '/' && Math.abs(scrollY - early.y0) > 2) early.moved++
    }
    const loader = document.querySelector('[data-world-loader]')
    if (loader && Number(getComputedStyle(loader).opacity) > 0.05 && !document.querySelector('[data-world-cover][data-covered]')) window.__loaderEarly++
    if (!window.__coveredAt && document.querySelector('[data-world-cover][data-covered]')) window.__coveredAt = Date.now()
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

/** A page whose runtime (main.js) and, for entries from the homepage, whose /world RSC are held until released. */
async function session({ name, reduced = false, viewport = { width: 1440, height: 900 }, mobile = PHONE, holdRuntime = true, holdRsc = false, cpu = CPU, net = null } = {}) {
  const context = await browser.newContext(mobile ? { ...devices['Pixel 7'], reducedMotion: reduced ? 'reduce' : 'no-preference' } : { viewport, ...(ENGINE === 'chromium' ? { hasTouch: true } : {}), reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  page.on('pageerror', (e) => errors.push(`${name}: pageerror ${String(e).slice(0, 300)}`))
  page.on('requestfailed', (r) => { const why = r.failure()?.errorText ?? ''; if (/SOCKET_NOT_CONNECTED|CONNECTION_(RESET|CLOSED)|EMPTY_RESPONSE/.test(why)) stale.push(`${name}: ${why} ${r.url().slice(0, 100)}`) })
  // The error section aborts the runtime's script on purpose: that failed request is the point of it.
  page.on('console', (m) => { if (m.type() === 'error' && !(/^(reentry-)?error/.test(name) && /net::ERR_FAILED/.test(m.text()))) errors.push(`${name}: console ${m.text().slice(0, 300)}`) })
  await page.addInitScript(INIT)
  const cdp = ENGINE === 'chromium' ? await context.newCDPSession(page) : null
  if (cpu > 1 && cdp) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  if (net && cdp) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net })
  const gate = { runtime: null, rsc: null }
  const hold = () => { let release; const p = new Promise((r) => { release = r }); return Object.assign(p, { release }) }
  gate.runtime = hold()
  gate.rsc = hold()
  if (!holdRuntime) gate.runtime.release()
  if (!holdRsc) gate.rsc.release()
  await page.route('**/archipelago/preview/main.js*', async (route) => { await gate.runtime; await pass(route) })
  await page.route(/\/world\?_rsc=/, async (route) => { await gate.rsc; await pass(route) })
  return { context, page, cdp, gate, name, close: () => context.close() }
}

const centre = (page) => { const v = page.viewportSize() ?? { width: 1440, height: 900 }; return [Math.round(v.width / 2), Math.round(v.height / 2)] }
const phase = (page) => page.evaluate(() => document.documentElement.dataset.worldPhase ?? 'HOME')
const waitPhase = (page, p, timeout = 90000) => page.waitForFunction((want) => window.__phases.some((x) => x.phase === want), p, { timeout })
const frameOf = (page) => page.frames().find((f) => f.url().includes('/archipelago/preview/index.html'))
/** The loader is up (fully opaque). Through the leaves it waits for the world to be made and then a 0.6 s grace; a direct
    arrival's is in the first paint, on the dark of the hedge, with the leaves coming up behind it. */
const loaderShown = (page) => page.waitForFunction(() => {
  const l = document.querySelector('[data-world-loader]')
  return !!l && Number(getComputedStyle(l).opacity) > 0.9
}, null, { timeout: 20000 }).catch(() => {})

async function openHome(page) {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__room?.().milestones.ready, null, { timeout: 90000 })
  await sleep(1200)
}
async function toFoot(page) {
  await page.mouse.move(720, 450)
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await page.waitForFunction(() => document.documentElement.scrollHeight - innerHeight - scrollY < 3)
  await sleep(2600)
}
const ENTRY = {
  async scroll(page) {
    await toFoot(page)
    for (let i = 0; i < 300 && (await phase(page)) === 'HOME'; i++) { await page.mouse.wheel(0, 120); await sleep(22) }
  },
  async link(page) {
    await toFoot(page)
    await page.locator('[data-stage-foot] a[href="/world"]').first().evaluate((a) => a.click())
  },
  async index(page) {
    await page.keyboard.press('i')
    const link = page.locator('[aria-label="Chapter index"] a[href="/world"]')
    await link.waitFor({ state: 'visible' })
    await sleep(700)
    await link.click()
  },
}

/* ---------------------------------------------------------------- what to read, what to press */

/** Everything that says "the door is closed", read in one go. */
const read = (page) => page.evaluate((ALLOW) => {
  const html = document.documentElement
  const cs = getComputedStyle(html)
  const kids = [...document.body.children]
  const name = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : ''}`
  const iframe = document.querySelector('iframe')
  const a = document.activeElement
  const fallback = document.querySelector('[class*="fallback"]')
  const frame = iframe?.contentDocument
  return {
    phase: html.dataset.worldPhase ?? 'HOME',
    overflowY: cs.overflowY,
    overscroll: cs.overscrollBehaviorY,
    touchAction: cs.touchAction,
    gestureTouchAction: [[2, 2], [innerWidth - 3, 2], [2, innerHeight - 3], [innerWidth - 3, innerHeight - 3], [innerWidth / 2, innerHeight / 2], [innerWidth / 2, innerHeight * 0.8]].map(([x, y]) => {
      // The effective value, as the browser takes it for a gesture: the element's own and its ancestors' together (it is not inherited, so a leaf layer inside the cover reads `auto` on its own).
      const el = document.elementFromPoint(x, y)
      if (!el) return 'no element'
      for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).touchAction === 'none') return 'none'
      return getComputedStyle(el).touchAction
    }),
    lenisStopped: html.classList.contains('lenis-stopped'),
    scrollY: Math.round(scrollY),
    timeOrigin: performance.timeOrigin,
    scale: visualViewport?.scale ?? 1,
    open: kids.filter((el) => !el.matches(ALLOW) && !el.inert).map(name),
    deadAllow: kids.filter((el) => el.matches('[data-world-cover],[data-world-allow]') && el.closest('[inert]')).map(name),
    cover: kids.filter((el) => el.matches('[data-world-cover]')).length,
    // A cover that is merely prepared (invisible, taking no clicks) is the homepage's normal state near its foot.
    blocking: kids.filter((el) => el.matches('[data-world-cover][data-blocking="true"],[data-world-cover][data-covered]')).length,
    strayInert: [...document.querySelectorAll('[inert]')].filter((el) => el.getAttribute('aria-hidden') !== 'true').map(name),
    iframe: iframe ? { inert: !!iframe.closest('[inert]'), tabindex: iframe.getAttribute('tabindex'), hasFocus: !!frame?.hasFocus() } : null,
    active: a && a !== document.body ? name(a) : null,
    // (`nextjs-portal` is the development overlay: it does not exist in a production build.)
    activeOk: !a || a === document.body || a === html || !!a.closest('[data-world-allow],[data-world-cover],nextjs-portal,next-route-announcer'),
    fallbackPopped: !!fallback?.matches(':focus-within'),
    skipLinkShown: !!document.querySelector('.skip-link')?.matches(':focus-visible'),
    indexOpen: !!document.querySelector('[aria-label="Chapter index"][data-open="true"]'),
    leaks: window.__leaks,
    loader: (() => { const l = document.querySelector('[data-world-loader]'); return l ? { opacity: Number(getComputedStyle(l).opacity), lit: l.querySelectorAll('[data-state="lit"]').length, leaving: l.hasAttribute('data-leaving') } : null })(),
  }
}, ALLOW)

/** One barrage of every way a visitor can move a page. Returns nothing; the caller compares reads. */
async function barrage(s, { touch = true, keys = true, activate = true, pinch = true } = {}) {
  const { page, cdp } = s
  const [cx, cy] = centre(page)
  await page.mouse.move(cx, cy)
  for (const dy of [400, -400, 900, -900]) { await page.mouse.wheel(0, dy); await sleep(30) }
  // `activate: false` leaves out the keys that press a focused button (the error dialog's "Try again" has the focus).
  if (keys) for (const key of ['Space', 'Shift+Space', 'PageDown', 'PageUp', 'End', 'Home', 'ArrowDown', 'ArrowUp', 'i'].filter((k) => activate || !/Space/.test(k))) { await page.keyboard.press(key); await sleep(20) }
  if (touch && cdp) {
    // A finger dragging DOWN from the top of a page at rest is Android's pull-to-refresh.
    for (const yDistance of [420, -420]) await cdp.send('Input.synthesizeScrollGesture', { x: cx, y: cy, yDistance, gestureSourceType: 'touch', speed: 1800 }).catch(() => {})
    // (Not on the error dialog: it may be zoomed on purpose, and a zoomed viewport moves the buttons under a mouse click.)
    if (pinch) await cdp.send('Input.synthesizePinchGesture', { x: cx, y: cy, scaleFactor: 2.4, gestureSourceType: 'touch' }).catch(() => {})
  }
  await sleep(250)
}

/** Tab and Shift+Tab ×20: focus never leaves body or the allowlist, nothing pops over the leaves. */
async function tabTrap(s, label) {
  const { page } = s
  let bad = 0, popped = 0, skip = 0, framed = 0, worst = null
  for (const combo of ['Tab', 'Shift+Tab']) for (let i = 0; i < 20; i++) {
    await page.keyboard.press(combo)
    const r = await read(page)
    if (!r.activeOk) { bad++; worst = r.active }
    if (r.fallbackPopped) popped++
    if (r.skipLinkShown) skip++
    if (r.iframe?.hasFocus) framed++
  }
  assert(bad === 0, `${label}: Tab ×20 and Shift+Tab ×20 never leave the allowlist${worst ? ` (reached ${worst})` : ''}`, results)
  assert(popped === 0 && skip === 0, `${label}: no text page or skip link pops over the leaves (${popped}/${skip})`, results)
  assert(framed === 0, `${label}: the world's frame never takes focus`, results)
}

async function clicks(s, label) {
  const { page } = s
  await page.evaluate(() => { window.__leaks = 0 })
  const v = page.viewportSize() ?? { width: 1440, height: 900 }
  const pts = [[8, 8], [v.width - 8, 8], [8, v.height - 8], [v.width - 8, v.height - 8], [v.width / 2, v.height / 2], [v.width / 2, v.height - 20]]
  for (const [x, y] of pts) await page.mouse.click(Math.round(x), Math.round(y))
  const hud = page.locator('[data-hud] button')
  if (await hud.count()) {
    const reached = await hud.first().click({ trial: true, timeout: 600 }).then(() => true, () => false)
    assert(!reached, `${label}: a trial click on a page button is intercepted by the leaves`, results)
  }
  const { leaks } = await read(page)
  assert(leaks === 0, `${label}: clicks, taps and presses reach nothing but the cover (${leaks} leaked)`, results)
  const covered = await page.evaluate(() => [[2, 2], [innerWidth - 3, 2], [2, innerHeight - 3], [innerWidth - 3, innerHeight - 3], [innerWidth / 2, innerHeight / 2]].every(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-world-cover],[data-world-allow]')))
  assert(covered, `${label}: the cover wins every hit test`, results)
}

/** The whole state of a closed door, in one named block. */
async function assertClosed(s, label, { home = false, fullTouch = true } = {}) {
  const { page } = s
  const before = await read(page)
  assert(before.overflowY === 'hidden' && before.overscroll === 'none', `${label}: html overflow hidden + overscroll-behavior none (${before.overflowY}/${before.overscroll})`, results)
  // Not declared on <html> (a style recalculation of the page at the instant the door closes): a gesture takes the
  // touch-action of the element it starts on, and every one starts on the cover or the loader above it.
  if (['COVERED', 'LOADING_WORLD', 'WORLD_READY'].includes(before.phase)) assert(before.gestureTouchAction.every((t) => t === 'none'), `${label}: a gesture starting anywhere on the screen lands on touch-action none (${before.gestureTouchAction.join(', ')})`, results)
  assert(before.open.length === 0, `${label}: every body child but the cover, loader, status and dialog is inert (open: ${before.open.join(', ') || 'none'})`, results)
  assert(before.deadAllow.length === 0 && before.cover === 1, `${label}: the cover, loader and status stay live (dead: ${before.deadAllow.join(', ') || 'none'}; covers: ${before.cover})`, results)
  if (home) assert(before.lenisStopped, `${label}: Lenis is stopped`, results)
  if (before.iframe) assert(before.iframe.inert && before.iframe.tabindex === '-1', `${label}: the world's frame is inert and out of the tab order`, results)
  await barrage(s, { touch: fullTouch })
  const after = await read(page)
  assert(after.scrollY === before.scrollY, `${label}: wheel ±, Space/Shift+Space/PgUp/PgDn/Home/End/arrows and touch scroll leave the page where it was (${before.scrollY} → ${after.scrollY})`, results)
  assert(after.timeOrigin === before.timeOrigin, `${label}: no reload (pull-to-refresh)`, results)
  assert(after.scale === 1, `${label}: pinch does not zoom (visual viewport scale ${after.scale})`, results)
  assert(after.indexOpen === before.indexOpen && after.phase === before.phase, `${label}: the index did not open or close under the leaves and the phase held (${after.phase})`, results)
  await tabTrap(s, label)
  await clicks(s, label)

  // The same again while the main thread is blocked: only declarations can hold then.
  const mark = await read(page)
  const busy = page.evaluate((ms) => { const end = performance.now() + ms; while (performance.now() < end); }, 2500)
  await sleep(150)
  const [bx, by] = centre(page)
  const during = Promise.allSettled([
    page.mouse.wheel(0, 700),
    ...(s.cdp ? [
      s.cdp.send('Input.synthesizeScrollGesture', { x: bx, y: by, yDistance: 500, gestureSourceType: 'touch', speed: 2400 }),
      s.cdp.send('Input.synthesizeScrollGesture', { x: bx, y: by, yDistance: -500, gestureSourceType: 'touch', speed: 2400 }),
    ] : []),
  ])
  await busy
  await during
  await sleep(300)
  const blocked = await read(page)
  assert(blocked.scrollY === mark.scrollY && blocked.timeOrigin === mark.timeOrigin, `${label}: nothing moves or reloads while a 2.5 s busy loop blocks the main thread (${mark.scrollY} → ${blocked.scrollY})`, results)
}

async function shot(page, name) { await page.screenshot({ path: out(`loading-lock/${name}.png`) }) }

/* ---------------------------------------------------------------- entries */

async function holdUntilLoading(s, how) {
  const { page } = s
  if (how === 'direct') {
    await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  } else {
    await openHome(page)
    await ENTRY[how](page)
  }
}

if (want('entries')) {
  for (const how of ENTRIES) {
    const s = await session({ name: `entry-${how}`, holdRsc: how !== 'direct' })
    const { page } = s
    await holdUntilLoading(s, how)
    if (how !== 'direct') {
      await waitPhase(page, 'COVERED')
      await sleep(400)
      assert((await phase(page)) === 'COVERED', `${how}: held in COVERED while the /world route is still rendering`, results)
      await assertClosed(s, `${how} · COVERED`, { home: true })
      s.gate.rsc.release()
    }
    await waitPhase(page, 'LOADING_WORLD')
    await loaderShown(page)
    await sleep(2400)
    await assertClosed(s, `${how} · LOADING_WORLD`)
    const r = await read(page)
    assert(!!r.loader && r.loader.opacity > 0.9, `${how}: the loader is on the leaves a second or two after COVERED (opacity ${r.loader?.opacity})`, results)
    if (how === 'direct') {
      const early = await page.evaluate(() => ({ frame: window.__frameAtLoading, covered: window.__coveredAtLoading, loaderEarly: window.__loaderEarly }))
      assert(early.frame === true && early.covered === false, `direct: the world's frame is created as the route mounts, not after the leaves are verified (frame ${early.frame}, leaves verified at that moment: ${early.covered})`, results)
      assert(early.loaderEarly > 0, `direct: the loader was up before the leaves were verified, not after them (${early.loaderEarly} frames)`, results)
    }
    await shot(page, `${how}-loading`)
    s.gate.runtime.release()
    await s.close()
  }
}

/* ---------------------------------------------------------------- the first second */

if (want('early')) {
  /* The page behind the leaves is made inert once the cover is verified: a style recalculation of the whole homepage that the frame
     which closes the door must not pay for. Until then, for about a second, the door is shut by things that cost the frame nothing
     (a transparent sheet under the cover for the pointer, the keys that act on a page held, the focus taken off). The sections above
     hold the world in COVERED and cannot see that window: this one starts at the first phase event of each way in and hammers it. */
  const ENTRY_EARLY = {
    ...ENTRY,
    /** The foot link pressed with the keyboard, as a keyboard visitor does: it has the focus when the way in begins. */
    async keys(page) {
      await toFoot(page)
      const link = page.locator('[data-stage-foot] a[href="/world"]').first()
      await link.focus()
      await page.keyboard.press('Enter')
    },
    async direct(page) {
      await page.goto(`${BASE}/world`, { waitUntil: 'commit' })
    },
  }
  const MS = 1500
  const hammer = async (s) => {
    const { page, cdp } = s
    const v = page.viewportSize() ?? { width: 1440, height: 900 }
    const pts = [[v.width / 2, v.height / 2], [v.width * 0.25, v.height * 0.3], [v.width * 0.75, v.height * 0.7], [40, v.height - 40], [v.width - 40, 60], [v.width / 2, v.height - 24]]
    const keys = ['Tab', 'Tab', 'Enter', 'Tab', 'Space', 'Shift+Tab', 'Enter', 'ArrowDown', 'PageDown', 'End', 'i', 'Escape', 'Home', 'PageUp', 'ArrowUp', 'Shift+Space']
    const t0 = Date.now()
    let n = 0
    while (Date.now() - t0 < MS) {
      const [x, y] = pts[n % pts.length]
      await page.mouse.wheel(0, n % 2 ? 500 : -500).catch(() => {})
      await page.mouse.click(Math.round(x), Math.round(y)).catch(() => {})
      if (ENGINE === 'chromium' && n % 2) await page.touchscreen.tap(Math.round(x), Math.round(y)).catch(() => {})
      await page.keyboard.press(keys[n % keys.length]).catch(() => {})
      if (cdp && n % 3 === 0) await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(v.width / 2), y: Math.round(v.height / 2), yDistance: n % 2 ? 300 : -300, speed: 2000, gestureSourceType: 'touch' }).catch(() => {})
      if (cdp && n % 6 === 0) await cdp.send('Input.synthesizePinchGesture', { x: Math.round(v.width / 2), y: Math.round(v.height / 2), scaleFactor: 1.8, gestureSourceType: 'touch' }).catch(() => {})
      n++
      await sleep(15)
    }
    return n
  }
  const early = (page) => page.evaluate(() => ({ ...window.__early, path: location.pathname, phase: document.documentElement.dataset.worldPhase ?? 'HOME', scale: visualViewport?.scale ?? 1, timeOrigin: performance.timeOrigin }))
  for (const how of [...ENTRIES, ...(ENTRIES.includes('link') && ENGINE === 'chromium' ? ['keys'] : [])]) {
    const label = `early · ${how}`
    const s = await session({ name: `early-${how}`, holdRuntime: false })
    const { page } = s
    if (how !== 'direct') await openHome(page)
    const origin = await page.evaluate(() => performance.timeOrigin)
    await ENTRY_EARLY[how](page)
    const n = await hammer(s)
    const e = await early(page)
    assert(e.t0 > 0, `${label}: the way in began`, results)
    assert(e.pointer.length === 0, `${label}: ${n} clicks and taps in the first ${MS} ms reached nothing but the cover and the loader (${e.pointer.length} leaked${e.pointer.length ? `: ${e.pointer.slice(0, 3).join('; ')}` : ''})`, results)
    assert(e.focus.length === 0, `${label}: Tab, Shift+Tab, Enter and Space left the focus on the cover or the loader (${e.focus.length} landed behind the leaves${e.focus.length ? `: ${e.focus.slice(0, 3).join('; ')}` : ''})`, results)
    assert(e.moved === 0, `${label}: the page did not move while the keys, the wheel and the fingers arrived (${e.moved} frames off its position)`, results)
    if (how !== 'direct') assert(e.timeOrigin === origin && e.scale === 1, `${label}: nothing reloaded and nothing zoomed (scale ${e.scale})`, results)
    await waitPhase(page, 'IN_WORLD', 180000).catch(() => {})
    const end = await early(page)
    assert(end.phase === 'IN_WORLD' && end.path === '/world', `${label}: the visitor reaches the world (${end.phase} on ${end.path})`, results)
    assert(end.paths.every((p) => p === '/' || p === '/world'), `${label}: and was on no other route on the way (${end.paths.join(', ')})`, results)
    await s.close()
  }
}

/* ---------------------------------------------------------------- history */

if (want('history')) {
  // Back while the world loads, Forward as a direct arrival.
  const s = await session({ name: 'history' })
  const { page } = s
  await openHome(page)
  await ENTRY.index(page)
  await waitPhase(page, 'LOADING_WORLD')
  await sleep(800)
  await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForFunction(() => !document.querySelector('[data-world-cover]'), null, { timeout: 15000 }).catch(() => {})
  await sleep(300)
  const home = await read(page)
  assert(new URL(page.url()).pathname === '/' && home.phase === 'HOME' && home.cover === 0, `Back during LOADING_WORLD: home again, no cover, phase HOME (${new URL(page.url()).pathname}, ${home.phase}, covers ${home.cover})`, results)
  assert(home.overflowY === 'visible' && home.overscroll !== 'none' && !home.lenisStopped, `Back: the page scrolls again (overflow ${home.overflowY}, Lenis stopped ${home.lenisStopped})`, results)
  // Only closed overlays (React's own `inert={!open}`, aria-hidden) may be inert; the index the visitor left open stays open.
  assert(home.strayInert.length === 0, `Back: nothing is left inert by the lock (stray: ${home.strayInert.join(', ') || 'none'})`, results)
  await page.keyboard.press('Escape')
  await sleep(500)
  assert(!(await read(page)).indexOpen, 'Back: the keyboard answers again (Escape closes the index left open)', results)
  await page.mouse.move(720, 450)
  const y0 = (await read(page)).scrollY
  await page.mouse.wheel(0, 900)
  await sleep(1200)
  assert((await read(page)).scrollY > y0, 'Back: the wheel scrolls the homepage (Lenis running)', results)
  await shot(page, 'history-back-home')
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD')
  await loaderShown(page)
  await sleep(2400)
  await assertClosed(s, 'Forward (direct arrival) · LOADING_WORLD', { fullTouch: false })
  const fwd = await read(page)
  assert(!!fwd.loader && fwd.loader.opacity > 0.9, 'Forward: the loader is back on the leaves', results)
  s.gate.runtime.release()
  await s.close()

  // Back in the gap: the URL is still / and the route has not committed.
  const g = await session({ name: 'history-gap', holdRsc: true })
  await g.page.goto(`${BASE}/projects`, { waitUntil: 'domcontentloaded' })
  await g.page.waitForFunction(() => !!window.next?.router, null, { timeout: 30000 }).catch(() => {})
  await g.page.evaluate(() => window.next.router.push('/'))
  await g.page.waitForFunction(() => location.pathname === '/' && window.__room?.().milestones.ready, null, { timeout: 90000 })
  await sleep(1200)
  await ENTRY.index(g.page)
  await waitPhase(g.page, 'COVERED')
  await sleep(300)
  assert((await phase(g.page)) === 'COVERED' && new URL(g.page.url()).pathname === '/', 'the push is pending: COVERED while the URL is still /', results)
  await g.page.goBack().catch(() => {})
  await g.page.waitForFunction(() => document.documentElement.dataset.worldPhase === 'HOME', null, { timeout: 15000 }).catch(() => {})
  await g.page.waitForFunction(() => !document.querySelector('[data-world-cover]'), null, { timeout: 15000 }).catch(() => {})
  const gap = await read(g.page)
  assert(gap.phase === 'HOME' && gap.cover === 0 && gap.overflowY !== 'hidden' && !gap.lenisStopped, `Back in the COVERED gap does not strand the cover (phase ${gap.phase}, covers ${gap.cover}, overflow ${gap.overflowY}, Lenis stopped ${gap.lenisStopped})`, results)
  assert(new URL(g.page.url()).pathname === '/projects', `Back in the gap lands on the previous page (${new URL(g.page.url()).pathname})`, results)
  await shot(g.page, 'history-gap-back')
  g.gate.rsc.release()
  g.gate.runtime.release()
  await g.close()

  // A route that never commits does not leave anyone on a closed door: the leaves part after 20 s.
  if (!process.argv.includes('--no-watchdog')) {
    const w = await session({ name: 'history-watchdog', holdRsc: true })
    await openHome(w.page)
    await ENTRY.index(w.page)
    await waitPhase(w.page, 'COVERED')
    await sleep(500)
    assert((await phase(w.page)) === 'COVERED', 'watchdog: held in COVERED (the route never commits)', results)
    await w.page.waitForFunction(() => document.documentElement.dataset.worldPhase === 'HOME', null, { timeout: 30000 }).catch(() => {})
    // The leaves part (about 1.4 s) and are put away: no cover is left standing over the page.
    await w.page.waitForFunction(() => !document.querySelector('[data-world-cover][data-blocking="true"],[data-world-cover][data-covered]'), null, { timeout: 10000 }).catch(() => {})
    const dog = await read(w.page)
    assert(dog.phase === 'HOME' && dog.blocking === 0 && dog.overflowY !== 'hidden' && !dog.lenisStopped && dog.strayInert.length === 0, `watchdog: after 20 s the leaves part and the page is usable (phase ${dog.phase}, covering ${dog.blocking}, overflow ${dog.overflowY}, Lenis stopped ${dog.lenisStopped})`, results)
    w.gate.rsc.release()
    w.gate.runtime.release()
    await w.close()
  }
}

/* ---------------------------------------------------------------- re-entry after Back */

if (want('reentry')) {
  /* The leaves part for about 1.3 s after an exit. A way in that starts in that window used to find a cover
     that was already open: it was never completed, the parting's end put it away, and the page stayed
     COVERING, locked, with nothing to see. Whatever the timing, the end is one of two states:
       · LOADING_WORLD under a standing, verified cover (and then the world arrives and the door opens), or
       · a clean homepage (no lock, nothing inert, Lenis running).
     Anything else is a dead page. */
  const DELAYS = (arg('reentry-delays', '200,700,2000') ?? '').split(',').filter(Boolean).map(Number)
  const lastPhaseIs = (page, name) => page.waitForFunction((n) => window.__phases.at(-1)?.phase === n, name, { timeout: 15000 })
  const loadingCount = (page) => page.evaluate(() => window.__phases.filter((p) => p.phase === 'LOADING_WORLD').length)
  /* A world that is not held may be well on its way by the time it is looked at: past the loader, or in. */
  const PROGRESSING = ['WORLD_READY', 'REVEALING', 'IN_WORLD']
  const alive = (r) => (r.phase === 'LOADING_WORLD' && r.cover === 1 && r.blocking === 1 && r.overflowY === 'hidden' && r.open.length === 0)
    || PROGRESSING.includes(r.phase)
    || (r.phase === 'HOME' && r.blocking === 0 && r.overflowY !== 'hidden' && !r.lenisStopped && r.strayInert.length === 0)
  const state = (r) => JSON.stringify({ phase: r.phase, covers: r.cover, blocking: r.blocking, overflow: r.overflowY, notInert: r.open.length, lenisStopped: r.lenisStopped })

  /** Through the world's way in again, from where Back left the page. */
  const REENTER = {
    async link(page) {
      const link = page.locator('[data-stage-foot] a[href="/world"]').first()
      await link.click({ timeout: 4000 }).catch(() => link.evaluate((a) => a.click()))
    },
    async index(page) {
      const link = page.locator('[aria-label="Chapter index"] a[href="/world"]')
      if (!(await link.isVisible())) {
        await page.keyboard.press('i')
        await link.waitFor({ state: 'visible' })
        await sleep(700)
      }
      await link.click({ timeout: 4000 }).catch(() => link.evaluate((a) => a.click()))
    },
    async scroll(page) {
      await page.mouse.move(720, 450)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      for (let i = 0; i < 300 && (await phase(page)) === 'HOME'; i++) { await page.mouse.wheel(0, 120); await sleep(22) }
    },
  }

  /** The state a re-entry settled in: alive, with the reasons printed when it is not. */
  async function settle(s, label, entered) {
    const { page } = s
    await page.waitForFunction((n) => window.__phases.filter((p) => p.phase === 'LOADING_WORLD').length > n || window.__phases.at(-1)?.phase === 'HOME', entered, { timeout: 25000 }).catch(() => {})
    if ((await phase(page)) === 'LOADING_WORLD') await loaderShown(page)
    await sleep(2400)
    const r = await read(page)
    assert(alive(r), `${label}: ends in LOADING_WORLD under a standing cover, or on a clean homepage — not dead (${state(r)})`, results)
    return r
  }

  for (const via of ['link', 'scroll', 'index'].filter((v) => ENTRIES.includes(v))) {
    for (const delay of DELAYS) {
      const label = `re-enter by ${via} ${delay} ms after Back`
      const s = await session({ name: `reentry-${via}-${delay}` })
      const { page } = s
      await openHome(page)
      await ENTRY[via](page)
      await waitPhase(page, 'LOADING_WORLD')
      await sleep(600)
      const entered = await loadingCount(page)
      await page.goBack({ waitUntil: 'commit' })
      await lastPhaseIs(page, 'HOME')
      await sleep(delay)
      await REENTER[via](page)
      const r = await settle(s, label, entered)
      if (r.phase === 'LOADING_WORLD') {
        assert(!!r.loader && r.loader.opacity > 0.9, `${label}: the loader is on the leaves again (opacity ${r.loader?.opacity})`, results)
        await shot(page, `reentry-${via}-${delay}`)
        s.gate.runtime.release()
        await waitPhase(page, 'IN_WORLD', 90000).catch(() => {})
        await sleep(400)
        const done = await read(page)
        assert(done.phase === 'IN_WORLD' && done.cover === 0 && (await page.evaluate(() => document.querySelectorAll('[inert]').length)) === 0 && (await page.locator('iframe').count()) === 1, `${label}: the world arrives, the leaves are gone and the door is open (${state(done)}, ${await page.locator('iframe').count()} frame(s))`, results)
      } else {
        if (r.phase === 'HOME') console.log(`info  ${label}: settled on a clean homepage (the way in was not taken)`)
        await shot(page, `reentry-${via}-${delay}-${r.phase === 'HOME' ? 'home' : 'dead'}`)
        s.gate.runtime.release()
      }
      await s.close()
    }
  }

  // Back, then Forward at once: a direct arrival while the leaves are still parting for the Back.
  {
    const label = 'Back then Forward 150 ms later'
    const s = await session({ name: 'reentry-forward' })
    const { page } = s
    await openHome(page)
    await ENTRY.index(page)
    await waitPhase(page, 'LOADING_WORLD')
    await sleep(600)
    const entered = await loadingCount(page)
    await page.goBack({ waitUntil: 'commit' })
    await lastPhaseIs(page, 'HOME')
    await sleep(150)
    await page.goForward({ waitUntil: 'commit' })
    const r = await settle(s, label, entered)
    assert(r.phase === 'LOADING_WORLD', `${label}: the world is loading again (${r.phase})`, results)
    if (r.phase === 'LOADING_WORLD') {
      assert(!!r.loader && r.loader.opacity > 0.9, `${label}: the loader is on the leaves (opacity ${r.loader?.opacity})`, results)
      await shot(page, 'reentry-forward')
      s.gate.runtime.release()
      await waitPhase(page, 'IN_WORLD', 90000).catch(() => {})
      await sleep(400)
      const done = await read(page)
      assert(done.phase === 'IN_WORLD' && done.cover === 0 && (await page.evaluate(() => document.querySelectorAll('[inert]').length)) === 0, `${label}: the world arrives and the door is open (${state(done)})`, results)
    }
    await s.close()
  }

  // The error dialog's way out, then the way in at once.
  for (const delay of DELAYS.filter((d) => d < 1500)) {
    const label = `re-enter by link ${delay} ms after "Return to the portfolio"`
    const s = await session({ name: `reentry-error-${delay}`, holdRuntime: false })
    const { page } = s
    let blocked = true
    await page.unroute('**/archipelago/preview/main.js*')
    await page.route('**/archipelago/preview/main.js*', async (r) => { if (blocked) return r.abort(); await pass(r) })
    await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
    await page.locator('[role="alertdialog"]', { hasText: 'did not load' }).waitFor({ timeout: 60000 })
    const entered = await loadingCount(page)
    blocked = false
    await page.getByRole('button', { name: 'Return to the portfolio' }).click()
    await lastPhaseIs(page, 'HOME')
    await page.waitForFunction(() => !!document.querySelector('[data-stage-foot] a[href="/world"]'), null, { timeout: 30000 })
    await sleep(delay)
    await REENTER.link(page)
    const r = await settle(s, label, entered)
    if (r.phase === 'LOADING_WORLD' || PROGRESSING.includes(r.phase)) {
      await waitPhase(page, 'IN_WORLD', 90000).catch(() => {})
      await sleep(400)
      const done = await read(page)
      assert(done.phase === 'IN_WORLD' && done.cover === 0 && (await page.evaluate(() => document.querySelectorAll('[inert]').length)) === 0, `${label}: the world arrives and the door is open (${state(done)})`, results)
    }
    await s.close()
  }
}

/* ---------------------------------------------------------------- a world that is ready before its leaves */

if (want('readyfirst')) {
  // A direct arrival starts its world at once and builds the leaves beside it. A world that says `ready` before the
  // leaves are verified (a quick world, a slow canopy: the CPU is slowed here) must still wait for them — and then hold them,
  // fully drawn, for a moment — so that what opens is leaves, never a dark dissolve.
  const s = await session({ name: 'readyfirst', holdRuntime: false, cpu: Math.max(CPU, 4) })
  const { page } = s
  await page.unroute('**/archipelago/preview/main.js*')
  await page.route('**/archipelago/preview/main.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: "const t=(type)=>parent.postMessage({type},location.origin);document.body.dataset.player='true';t('archipelago:hello');t('archipelago:ready');" }))
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'IN_WORLD', 60000)
  const r = await page.evaluate(() => {
    const at = (n) => window.__phases.find((p) => p.phase === n)?.wall
    return { ready: window.__msgs.find((m) => m.type === 'archipelago:ready')?.at, revealing: at('REVEALING'), early: window.__loaderEarly, verified: window.__revealCovered, coveredAt: window.__coveredAt }
  })
  assert(r.ready && r.revealing - r.ready > 150, `ready-first: the world said ready ${r.revealing - r.ready} ms before the leaves parted`, results)
  assert(r.verified === true, 'ready-first: the leaves were verified on screen when the reveal began', results)
  assert(r.coveredAt > 0 && r.revealing - r.coveredAt >= 650, `ready-first: the leaves were held on the screen, verified and drawn, ${r.revealing - r.coveredAt} ms before they parted (at least 650)`, results)
  assert(r.early > 0, `ready-first: the loader was up in the first moments, before the leaves (${r.early} frames)`, results)
  await s.close()
}

/* ---------------------------------------------------------------- reveal and restore */

if (want('reveal')) {
  for (const how of ['scroll', 'direct'].filter((h) => ENTRIES.includes(h))) {
    const s = await session({ name: `reveal-${how}` })
    const { page } = s
    await holdUntilLoading(s, how)
    await waitPhase(page, 'LOADING_WORLD')
    await sleep(1500)
    s.gate.runtime.release()
    await waitPhase(page, 'REVEALING', 240000)
    await page.waitForFunction(() => window.__reveal, null, { timeout: 5000 })
    const rv = await page.evaluate(() => window.__reveal)
    assert(await page.evaluate(() => window.__revealCovered === true), `${how}: the leaves were verified on screen before the reveal began`, results)
    assert(!rv.iframeInert && rv.focused && rv.inerts === 0 && rv.tabindex === null, `${how}: at REVEALING (${Math.round(rv.after)} ms in) the world is not inert, its frame is focused and the page is open`, results)
    // The car answers before the leaves are gone.
    const frame = frameOf(page)
    const speed = () => frame.evaluate(() => { const v = globalThis.__archipelago?.driving?.vehicle; const b = v?.chassis?.physical?.body?.linvel?.(); return b ? Math.hypot(b.x, b.y, b.z) : null })
    await page.keyboard.down('w')
    await sleep(450)
    const early = (await page.evaluate(() => document.documentElement.dataset.worldPhase)) === 'REVEALING'
    const moving = await speed()
    await page.keyboard.up('w')
    assert(early && moving !== null && moving > 0.3, `${how}: W drives the car while the leaves are still parting (speed ${moving?.toFixed?.(2)} m/s, still REVEALING: ${early})`, results)
    await waitPhase(page, 'IN_WORLD', 30000)
    await sleep(400)
    const walls = await page.evaluate(() => Object.fromEntries(window.__phases.map((p) => [p.phase, p.wall])))
    const told = await frame.evaluate(() => window.__msgs.filter((m) => /^archipelago:(live|revealed)$/.test(m.type)))
    const live = told.find((m) => m.type === 'archipelago:live')
    const revealed = told.find((m) => m.type === 'archipelago:revealed')
    assert(!!live && !!revealed && live.at >= walls.REVEALING - 5 && live.at < walls.IN_WORLD && revealed.at >= walls.IN_WORLD - 5, `${how}: the world is told live ${live ? live.at - walls.REVEALING : '?'} ms into the parting and revealed ${revealed ? revealed.at - walls.IN_WORLD : '?'} ms after IN_WORLD`, results)
    const done = await read(page)
    const gaps = await page.evaluate(() => window.__gaps.filter(([t]) => t > 0).map(([, g]) => g))
    assert((await page.evaluate(() => document.querySelectorAll('[inert]').length)) === 0, `${how}: at IN_WORLD nothing the lock set is left inert`, results)
    assert(done.overflowY === 'hidden' && (await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)), `${how}: /world itself does not scroll (overflow ${done.overflowY})`, results)
    assert(done.cover === 0 && !(await page.locator('[data-world-loader]').count()), `${how}: the cover and the loader are gone`, results)
    await shot(page, `${how}-in-world`)
    if (how === 'scroll') {
      await page.goBack({ waitUntil: 'domcontentloaded' })
      await sleep(2500)
      const back = await read(page)
      assert(back.phase === 'HOME' && back.overflowY === 'visible' && !back.lenisStopped && back.strayInert.length === 0 && back.blocking === 0, `Back from the world restores the homepage (phase ${back.phase}, overflow ${back.overflowY}, Lenis stopped ${back.lenisStopped}, stray inert ${back.strayInert.length}, covering ${back.blocking})`, results)
    }
    console.log(`info  ${how}: the leaves part in ${walls.IN_WORLD - walls.REVEALING} ms (REVEALING → IN_WORLD; the standard setting is about 1370)`)
    console.log(`info  ${how}: ${gaps.length} parent animation-frame gap(s) over 100 ms from page load to IN_WORLD (longest ${Math.round(Math.max(0, ...gaps))} ms: the world's startup shares this thread)`)
    await s.close()
  }
}

/* ---------------------------------------------------------------- error and retry */

if (want('error')) {
  const s = await session({ name: 'error', holdRuntime: false })
  const { page } = s
  let blocked = true
  let retryHold = null
  await page.unroute('**/archipelago/preview/main.js*')
  await page.route('**/archipelago/preview/main.js*', async (r) => {
    if (blocked) return r.abort()
    await retryHold
    await pass(r)
  })
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  const dialog = page.locator('[role="alertdialog"]', { hasText: 'did not load' })
  await dialog.waitFor({ timeout: 60000 })
  await sleep(300)
  const e = await read(page)
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim())
  assert(focused === 'Try again', `error: the dialog is focused on "Try again" (${focused})`, results)
  assert(e.phase === 'ERROR' && e.overflowY === 'hidden' && e.open.length === 0, `error: the page is still locked behind the dialog (phase ${e.phase}, open ${e.open.join(', ') || 'none'})`, results)
  assert(e.loader === null, 'error: the loader has gone and the dialog took over', results)
  await shot(page, 'error-dialog')
  await barrage(s, { activate: false, pinch: false })
  assert((await read(page)).scrollY === e.scrollY, 'error: wheel, keys and touch do nothing behind the dialog', results)
  await tabTrap(s, 'error')
  const reachable = await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Try again'); const r = b.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return hit === b || b.contains(hit) })
  assert(reachable && (await page.evaluate(() => visualViewport.scale)) === 1, 'error: after the barrage the dialog is as it was and its button is under the pointer', results)
  blocked = false
  // The retried world is held at its script, so that no progress message can have lit a mark before this is read:
  // what is asserted is the reset itself, not a race with a fast runtime.
  let letGo
  retryHold = new Promise((resolve) => { letGo = resolve })
  await page.getByRole('button', { name: 'Try again' }).click()
  await sleep(250)
  const again = await read(page)
  assert(!!again.loader && again.loader.lit === 0 && again.phase === 'LOADING_WORLD', `retry: the loader is back at zero marks (${again.loader?.lit}) in ${again.phase}`, results)
  letGo()
  await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 })
  await waitPhase(page, 'IN_WORLD', 60000)
  const ok = await read(page)
  assert(ok.phase === 'IN_WORLD' && (await page.evaluate(() => document.querySelectorAll('[inert]').length)) === 0 && !(await page.locator('[role="alertdialog"]').count()), 'retry: the world loads and the page opens', results)
  await s.close()
}

/* ---------------------------------------------------------------- reduced motion */

if (want('reduced')) {
  const s = await session({ name: 'reduced', reduced: true })
  const { page } = s
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD')
  await loaderShown(page)
  await sleep(2200)
  await page.evaluate(() => { window.postMessage = window.postMessage })
  const anims = await page.evaluate(() => {
    const l = document.querySelector('[data-world-loader]')
    return l.getAnimations({ subtree: true }).map((a) => ({ looping: a.effect.getTiming().iterations === Infinity, props: a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)), name: a.animationName ?? a.transitionProperty ?? '' }))
  })
  assert(!anims.some((a) => a.looping) && !anims.some((a) => a.props.includes('transform')), `reduced motion: no looping animation and none that moves anything (${anims.length} running: ${anims.map((a) => a.name).join(', ') || 'none'})`, results)
  const r = await read(page)
  assert(r.overflowY === 'hidden' && r.overscroll === 'none' && r.open.length === 0, 'reduced motion: the lock holds as well', results)
  const say = (v) => frameOf(page).evaluate((value) => parent.postMessage({ type: 'archipelago:progress', stage: 'x', value }, location.origin), v)
  await say(0.66)
  await sleep(500)
  const line = await page.locator('[data-world-loader] p').last().textContent()
  assert(/sign and stone/.test(line ?? ''), `reduced motion: the line still changes with the steps ("${line}")`, results)
  await shot(page, 'reduced-motion')
  s.gate.runtime.release()
  await s.close()
}

/* ---------------------------------------------------------------- protocol */

if (want('protocol')) {
  // The runtime's progress messages, as an old and a new runtime would send them.
  const s = await session({ name: 'protocol' })
  const { page } = s
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD')
  await sleep(1200)
  const fr = frameOf(page)
  const send = (m) => fr.evaluate((m) => parent.postMessage({ type: 'archipelago:progress', stage: 'x', ...m }, location.origin), m)
  const lit = () => page.locator('[data-world-loader] [data-state="lit"]').count()
  const status = () => page.locator('[role="status"]').first().textContent()
  const seen = []
  await send({ value: 0.03 }); await sleep(120)
  assert((await lit()) === 0, 'protocol: "reading the release" completes no step', results)
  await send({ value: 0.06 }); await sleep(120)
  assert((await lit()) === 1, 'protocol: an old runtime (value only): .06 completes the first step', results)
  seen.push(await status())
  await send({ value: 0, step: 5, of: 8 }); await sleep(120)
  assert((await lit()) === 5, 'protocol: a new runtime (step 5 of 8) lights five marks', results)
  seen.push(await status())
  await send({ value: 0.06 }); await sleep(120)
  assert((await lit()) === 5, 'protocol: a later, lower message cannot dim a lit mark', results)
  await send({ value: 0.9, step: 8, of: 8 }); await sleep(120)
  assert((await lit()) === 7, 'protocol: even "8 of 8" leaves the last mark for ready', results)
  seen.push(await status())
  // 300 messages of a byte-proportional download change nothing on screen.
  await page.evaluate(() => {
    window.__mut = 0
    const mo = new MutationObserver((list) => { window.__mut += list.length })
    for (const el of [document.querySelector('[data-world-loader]'), document.querySelector('[role="status"]')]) mo.observe(el, { subtree: true, childList: true, attributes: true, characterData: true })
  })
  for (let i = 0; i < 300; i++) await send({ value: 0.52 + (0.14 * i) / 300, step: 7, of: 8 })
  await sleep(300)
  const mutations = await page.evaluate(() => window.__mut)
  assert(mutations === 0 && (await lit()) === 7, `protocol: 300 progress messages that change nothing cause ${mutations} DOM changes in the loader and the status line`, results)
  assert(seen.every((t) => t && !/%/.test(t)) && new Set(seen).size === seen.length, `protocol: the status line names stages and never a percentage (${seen.map((t) => `"${t}"`).join(' -> ')})`, results)
  s.gate.runtime.release()
  await s.close()
}

/* ---------------------------------------------------------------- quiet */

if (want('quiet')) {
  // The runtime says hello and then nothing, because the island's file is held.
  const s = await session({ name: 'quiet', holdRuntime: false })
  const { page } = s
  let hold
  const held = new Promise((r) => { hold = r })
  await page.route('**/archipelago/exports/AlejandroWorld.glb.gz*', async (route) => { await held; await route.continue().catch(() => {}) })
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD')
  await sleep(14000)
  const early = await page.locator('[role="status"]').first().textContent()
  assert(!/Still loading/.test(early ?? ''), `quiet: 14 s into the silence nothing is said yet ("${early}")`, results)
  // 25 s after the runtime's LAST word, read from the page's own message log, not a fixed 28 s from the start: when that
  // last word came depends on how fast this machine boots the world (it moved by a second between runs).
  const silentFor = () => page.evaluate(() => (Date.now() - Math.max(...window.__msgs.map((m) => m.at))) / 1000)
  for (let i = 0; i < 100 && (await silentFor()) < 26; i++) await sleep(500)
  await sleep(700)
  const late = await page.locator('[role="status"]').first().textContent()
  const line = await page.locator('[data-world-loader] p').last().textContent()
  assert(/Still loading/.test(late ?? '') && /Still loading/.test(line ?? ''), `quiet: after 25 s of silence the line and the status say so ("${line}")`, results)
  await sleep(8000)
  assert((await page.locator('[role="alertdialog"]').count()) === 0 && (await phase(page)) === 'LOADING_WORLD', 'quiet: 36 s of silence is not an error', results)
  hold()
  await page.waitForSelector('[data-world-shell][data-ready]', { timeout: 240000 })
  assert(!(/Still loading/.test((await page.locator('[role="status"]').first().textContent()) ?? '')), 'quiet: a world that was only slow says it is ready', results)
  await s.close()
}

/* ---------------------------------------------------------------- slow network, slow CPU */

if (want('slow')) {
  const s = await session({ name: 'slow', holdRuntime: false, cpu: 4, net: { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } })
  const { page } = s
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD', 120000)
  const seen = []
  const t0 = Date.now()
  while (Date.now() - t0 < 20000) { seen.push((await read(page)).loader?.lit ?? -1); await sleep(250) }
  const monotonic = seen.every((v, i) => i === 0 || v >= seen[i - 1])
  assert(monotonic, `slow (Fast 3G, 4× CPU): the marks never go back (${[...new Set(seen)].join(' → ')})`, results)
  assert((await page.locator('[role="alertdialog"]').count()) === 0 && (await phase(page)) === 'LOADING_WORLD', 'slow: no false error while the world is still downloading', results)
  assert((await read(page)).loader?.opacity > 0.9, 'slow: the loader is on screen', results)
  await s.close()
}

/* ---------------------------------------------------------------- resize */

if (want('resize')) {
  const s = await session({ name: 'resize' })
  const { page } = s
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD')
  await loaderShown(page)
  await sleep(2000)
  for (const [w, h] of [[900, 1200], [390, 844], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h })
    await sleep(700)
    const r = await page.evaluate(() => {
      const box = document.querySelector('[data-world-loader] > div')?.getBoundingClientRect()
      return { loader: !!box && box.left >= 0 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1, corners: [[2, 2], [innerWidth - 3, 2], [2, innerHeight - 3], [innerWidth - 3, innerHeight - 3], [innerWidth / 2, innerHeight / 2]].every(([x, y]) => !!document.elementFromPoint(x, y)?.closest('[data-world-cover],[data-world-allow]')), overflow: getComputedStyle(document.documentElement).overflowY }
    })
    assert(r.corners && r.loader && r.overflow === 'hidden', `${w}×${h}: the cover spans every corner, the loader sits inside the screen and the lock holds`, results)
    await shot(page, `resize-${w}x${h}`)
  }
  s.gate.runtime.release()
  await s.close()
}

/* ---------------------------------------------------------------- compositor */

if (want('compositor') && ENGINE === 'chromium') {
  const s = await session({ name: 'compositor' })
  const { page, cdp } = s
  await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded' })
  await waitPhase(page, 'LOADING_WORLD')
  await loaderShown(page)
  await sleep(2600)
  const props = await page.evaluate(() => {
    const l = document.querySelector('[data-world-loader]')
    return l.getAnimations({ subtree: true }).map((a) => ({ looping: a.effect.getTiming().iterations === Infinity, name: a.animationName ?? a.transitionProperty ?? '', props: [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)).filter((k) => !['offset', 'easing', 'composite', 'computedOffset'].includes(k)))] }))
  })
  const bad = props.filter((a) => a.props.some((p) => !['opacity', 'transform'].includes(p)))
  assert(props.length > 0 && bad.length === 0, `loader: ${props.length} running animations, every one animating only opacity/transform${bad.length ? ` (offenders: ${bad.map((b) => `${b.name}:${b.props}`).join(', ')})` : ''}`, results)
  assert(props.some((a) => a.looping), 'loader: it has loops that started while the thread was idle', results)

  // Frames that the compositor presents while the main thread is blocked 1.5 s.
  const helper = await s.context.newPage()
  await helper.goto('about:blank')
  const rect = await page.evaluate(() => { const r = document.querySelector('[data-world-loader] > div > div').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: devicePixelRatio, vw: innerWidth, vh: innerHeight } })
  const fs = await import('node:fs')
  const blocked = async (tag) => {
    const frames = []
    const onFrame = async (f) => { frames.push({ t: f.metadata.timestamp, data: f.data }); await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {}) }
    cdp.on('Page.screencastFrame', onFrame)
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1, maxWidth: rect.vw, maxHeight: rect.vh })
    await sleep(600)
    const startBlock = Date.now() / 1000
    const busy = page.evaluate(() => { const t0 = performance.now(); const end = t0 + 1500; while (performance.now() < end); })
    await sleep(1700)
    await busy
    await cdp.send('Page.stopScreencast')
    cdp.off('Page.screencastFrame', onFrame)
    const during = frames.filter((f) => f.t >= startBlock + 0.1 && f.t <= startBlock + 1.5)
    if (during.length) {
      fs.mkdirSync(out('loading-lock'), { recursive: true })
      fs.writeFileSync(out(`loading-lock/compositor-${tag}-first.jpg`), Buffer.from(during[0].data, 'base64'))
      fs.writeFileSync(out(`loading-lock/compositor-${tag}-last.jpg`), Buffer.from(during.at(-1).data, 'base64'))
    }
    const diff = await helper.evaluate(async ({ shots, rect }) => {
      const decode = async (b64) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${b64}`)).blob())
        const c = new OffscreenCanvas(Math.round(rect.w), Math.round(rect.h))
        const g = c.getContext('2d', { willReadFrequently: true })
        const k = bmp.width / rect.vw
        g.drawImage(bmp, rect.x * k, rect.y * k, rect.w * k, rect.h * k, 0, 0, c.width, c.height)
        return g.getImageData(0, 0, c.width, c.height).data
      }
      if (shots.length < 2) return { max: 0, n: shots.length }
      const first = await decode(shots[0])
      let max = 0
      for (let i = 1; i < shots.length; i++) {
        const d = await decode(shots[i])
        let sum = 0
        for (let p = 0; p < d.length; p += 4) sum += Math.abs(d[p] - first[p]) + Math.abs(d[p + 1] - first[p + 1]) + Math.abs(d[p + 2] - first[p + 2])
        max = Math.max(max, sum / (d.length / 4) / 3)
      }
      return { max, n: shots.length }
    }, { shots: during.map((f) => f.data), rect })
    return diff
  }
  // Four steps done, the fifth charging: the sprig as it looks a few seconds in.
  await frameOf(page).evaluate(() => parent.postMessage({ type: 'archipelago:progress', stage: 'x', value: 0.76 }, location.origin))
  await sleep(2200)
  // The cover itself breathes (a compositor animation of its own): hold it still so that what is
  // measured below is the loader and nothing behind it.
  await page.evaluate(() => document.querySelector('[data-world-cover]').getAnimations({ subtree: true }).forEach((a) => a.pause()))
  await sleep(300)
  const moving = await blocked('moving')
  const gap = await page.evaluate(() => Math.max(0, ...window.__gaps.map(([, g]) => g)))
  assert(gap > 1300, `the main thread really was blocked (longest animation-frame gap ${Math.round(gap)} ms)`, results)
  // Control: with every loader animation paused the same block shows nothing but codec noise.
  await page.evaluate(() => document.querySelector('[data-world-loader]').getAnimations({ subtree: true }).forEach((a) => a.pause()))
  await sleep(300)
  const still = await blocked('paused')
  assert(moving.n >= 8 && moving.max > 0.25 && still.max < 0.1, `the loader kept changing on screen while the thread was blocked: ${moving.n} frames presented, the sprig changed by up to ${moving.max.toFixed(2)} grey levels (control with the animations paused: ${still.max.toFixed(2)})`, results)
  await s.close()
}

/* ---------------------------------------------------------------- route commit latency */

if (want('latency') && !PHONE) {
  // The server render of /world takes 1.2 s (injected); how long are the leaves closed with nothing started?
  const LATENCY = 1200
  const s = await session({ name: 'latency', holdRuntime: true })
  const { page } = s
  await page.unroute(/\/world\?_rsc=/)
  const seen = []
  await page.route(/\/world\?_rsc=/, async (route) => {
    const prefetch = route.request().headers()['next-router-prefetch'] === '1' || !!route.request().headers()['next-router-segment-prefetch']
    seen.push(prefetch ? 'prefetch' : 'navigate')
    if (!prefetch) await sleep(LATENCY)
    await pass(route)
  })
  await openHome(page)
  await toFoot(page)
  await sleep(1500)
  for (let i = 0; i < 300 && (await phase(page)) === 'HOME'; i++) { await page.mouse.wheel(0, 120); await sleep(22) }
  await waitPhase(page, 'LOADING_WORLD')
  const t = await page.evaluate(() => { const p = window.__phases; const at = (n) => p.find((x) => x.phase === n)?.t; return at('LOADING_WORLD') - at('COVERED') })
  console.log(`latency: COVERED → LOADING_WORLD ${Math.round(t)} ms with ${LATENCY} ms injected on the navigation request; RSC requests: ${seen.join(', ')}`)
  assert(seen.includes('prefetch'), 'the scroll approach prefetched the /world route (router.prefetch next to prepareWorld)', results)
  assert(t < LATENCY * 0.5, `the frame is created ${Math.round(t)} ms after COVERED, not after the server's ${LATENCY} ms render`, results)
  s.gate.runtime.release()
  await s.close()
}

assert(errors.length === 0, `no console errors or page errors in any section (${errors.slice(0, 3).join(' | ')})`, results)
if (stale.length) console.log(`NOTE: ${stale.length} request(s) died on a connection that was no longer there (${stale.slice(0, 3).join(' | ')}). That is the machine, not the page: a failure above that mentions a missing style or a hard navigation is this — run it again when the load is lower.`)
await browser.close()
finish(results)
