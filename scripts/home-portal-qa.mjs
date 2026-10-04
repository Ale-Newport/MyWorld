/**
 * The home journey's way out: drives the portal for real and checks the
 * hand-off to /world2.
 *   node scripts/home-portal-qa.mjs [baseUrl] [WxH] [mobile]
 *
 * The page is wheeled down to its foot as a reader would (gradually: the
 * gateway only arms once the page has come to rest there), then pushed in
 * short bursts. A tiny synthetic wheel delta keeps the charge from bleeding
 * away while each frame is captured. Checks, each with its evidence:
 *   finished   at the foot, unpushed, nothing stands over the page (no canopy
 *              pixels, no cover layers)
 *   takeover   the room is taken over as the charge builds (window.__room)
 *   covered    at the commit the screen is leaves and their dark: no plaster
 *              or page shows through
 *   handoff    the canopy's live context is gone once sealed, and the room's
 *              is released before the route changes
 *   seam       no light frame between the commit and the world's opening
 *   arrival    /world2 auto-enters under the cover, the cover parts and is
 *              removed, and exactly one world canvas remains
 *   errors     no page errors or console errors on either route
 * Screenshots: .qa/home-room/portal/<viewport>/. PORTAL_ENGINE=webkit|firefox
 * runs it in another engine (default chromium).
 * Needs a running server (default http://localhost:3000).
 */
import { chromium, firefox, webkit } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const [W, H] = (process.argv[3] ?? '1440x900').split('x').map(Number)
const MOBILE = process.argv[4] === 'mobile' || W < H
const OUT = path.resolve('.qa/home-room/portal', `${W}x${H}${process.env.PORTAL_ENGINE ? '-' + process.env.PORTAL_ENGINE : ''}`)
await mkdir(OUT, { recursive: true })

const results = []
const check = (name, pass, evidence) => {
  results.push({ name, pass })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(9)} ${JSON.stringify(evidence)}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Share of pixels that read as the page's light plaster or paper. */
async function lightShare(png) {
  const { data, info } = await sharp(png).resize(240).raw().toBuffer({ resolveWithObject: true })
  let light = 0
  for (let i = 0; i < data.length; i += info.channels) {
    const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
    if (l > 0.7) light++
  }
  return light / (data.length / info.channels)
}

const ENGINE = process.env.PORTAL_ENGINE ?? 'chromium'
const browser = ENGINE === 'chromium'
  ? await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
  : await { webkit, firefox }[ENGINE].launch()
// PORTAL_VIDEO=1 records the whole run (to judge the motion itself).
const ctx = await browser.newContext({
  viewport: { width: W, height: H }, deviceScaleFactor: MOBILE ? 2 : 1,
  ...(ENGINE === 'firefox' ? {} : { isMobile: MOBILE }), hasTouch: MOBILE,
  ...(process.env.PORTAL_VIDEO ? { recordVideo: { dir: path.join(OUT, 'video'), size: { width: W, height: H } } } : {}),
})
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror ${String(e).slice(0, 200)}`))
page.on('console', (m) => {
  // The dev server's own preload of a chunk it never serves is not the page's.
  if (m.type() === 'error' && !/_next\/static\/chunks\/.*404|status of 404/.test(m.text())) errors.push(m.text().slice(0, 200))
})

await page.goto(BASE, { waitUntil: 'load', timeout: 90000 })
await page.waitForFunction(() => { const r = window.__room?.(); return r && r.cache && r.cache.total > 0 && r.cache.done >= r.cache.total }, null, { timeout: 60000 })
await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
await page.mouse.move(W / 2, H / 2)

const remaining = () => page.evaluate(() => Math.round(document.documentElement.scrollHeight - innerHeight - scrollY))
for (let i = 0; i < 3000; i++) {
  const rem = await remaining()
  if (rem <= 2) break
  await page.mouse.wheel(0, Math.min(140, Math.max(12, rem / 3)))
  await sleep(22)
}
await sleep(2200)
const shot = async (name) => {
  const png = await page.screenshot()
  await sharp(png).toFile(path.join(OUT, `${name}.png`))
  return png
}
const coverState = () => page.evaluate(() => {
  const root = document.querySelector('[class*="canopy-module"][class*="root"]')
  const fill = document.querySelector('[class*="ruleFill"]')
  const m = fill?.style.transform.match(/scaleX\(([-\d.e]+)\)/)
  return {
    path: location.pathname,
    pull: m ? +(+m[1]).toFixed(3) : null,
    cover: !!root,
    live: root ? root.querySelectorAll('canvas[class*="live"]').length : 0,
    layers: root ? root.querySelectorAll('canvas[data-band]').length : 0,
    deep: root ? +(+getComputedStyle(root.querySelector('[class*="deep"]')).opacity).toFixed(3) : null,
    open: root?.dataset.open ?? null,
    room: window.__room?.() ?? null,
    htmlBg: document.documentElement.style.background || '',
  }
})

// finished: at the foot, before any push.
const rest = await coverState()
await shot('01-foot')
// The live canopy draws nothing at a zero charge: the cover alone
// (everything else hidden) against nothing at all.
const isolate = await page.addStyleTag({ content: 'body *{visibility:hidden!important} [class*="canopy-module"][class*="root"], [class*="canopy-module"][class*="root"] *{visibility:visible!important}' })
await sleep(150)
const withCover = await page.screenshot()
const none = await page.addStyleTag({ content: '[class*="canopy-module"][class*="root"], [class*="canopy-module"][class*="root"] *{visibility:hidden!important}' })
await sleep(150)
const without = await page.screenshot()
await none.evaluate((n) => n.remove())
await isolate.evaluate((n) => n.remove())
const a = await sharp(withCover).raw().toBuffer()
const b = await sharp(without).raw().toBuffer()
let diff = 0
for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 6) diff++
check('finished', rest.pull === 0 && diff / a.length < 0.0005 && rest.layers === 0, { pull: rest.pull, cover: rest.cover, live: rest.live, changedBytes: diff })

// Push in stages, keeping the charge from draining while capturing.
// Frame intervals are recorded throughout (the room is taken over and
// the canopy drawn every frame of a push).
await page.evaluate(() => {
  window.__keep = setInterval(() => window.dispatchEvent(new WheelEvent('wheel', { deltaY: 0.2, deltaMode: 0 })), 16)
  window.__pushFrames = []
  let last = performance.now()
  const tick = (t) => {
    window.__pushFrames.push(t - last)
    last = t
    if (!window.__pushDone) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
const burst = async (n) => { for (let i = 0; i < n; i++) { await page.mouse.wheel(0, 60); await sleep(16) } }
const takeovers = []
const targets = [0.2, 0.4, 0.6, 0.8, 0.93]
let k = 0
for (let guard = 0; guard < 120 && k < targets.length; guard++) {
  await burst(3)
  const s = await coverState()
  if (s.path !== '/') break
  if (s.pull !== null && s.pull >= targets[k]) {
    await sleep(60)
    await shot(`02-charge-${String(Math.round(s.pull * 100)).padStart(2, '0')}`)
    takeovers.push({ pull: s.pull, takeover: s.room?.takeover ?? null, live: s.live })
    k++
  }
}
// Frame intervals while pushing (screenshot stalls excluded: the capture
// itself blocks the page for a frame or two each time).
const push = await page.evaluate(() => { window.__pushDone = true; return window.__pushFrames.slice(2) })
const sorted = [...push].sort((x, y) => x - y)
const pct = (p) => +(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0).toFixed(1)
console.log(`      push frames: n=${push.length} p50=${pct(0.5)}ms p90=${pct(0.9)}ms p95=${pct(0.95)}ms (includes ${targets.length} screenshot stalls)`)
check('takeover', takeovers.length >= 3 && takeovers.every((t, i) => i === 0 || (t.takeover ?? 0) >= (takeovers[i - 1].takeover ?? 0)) && (takeovers.at(-1)?.takeover ?? 0) > 0.9, takeovers)

// Through: push until the commit, then follow the hand-off frame by frame.
await page.evaluate(() => {
  window.__trace = []
  const tick = () => {
    const root = document.querySelector('[class*="canopy-module"][class*="root"]')
    window.__trace.push({
      t: Math.round(performance.now()),
      path: location.pathname,
      live: root ? root.querySelectorAll('canvas[class*="live"]').length : 0,
      layers: root ? root.querySelectorAll('canvas[data-band]').length : 0,
      open: root?.dataset.open ?? null,
      room: !!window.__room?.(),
      bg: document.documentElement.style.background || '',
    })
    if (window.__trace.length < 6000) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})
let committed = null
for (let guard = 0; guard < 80; guard++) {
  await burst(4)
  const s = await coverState()
  if (s.layers > 0 || s.path !== '/') {
    committed = s
    break
  }
}
const coverPng = await shot('03-commit')
const lit = await lightShare(coverPng)
check('covered', !!committed && lit < 0.01, { lightShare: +lit.toFixed(4), layers: committed?.layers, live: committed?.live, deep: committed?.deep })

// Frames until the cover has gone.
const frames = []
const t0 = Date.now()
let lastState = null
while (Date.now() - t0 < 20000) {
  let png = null
  try { png = await page.screenshot() } catch { await sleep(100); continue }
  lastState = await coverState().catch(() => null)
  frames.push({ t: Date.now() - t0, light: await lightShare(png), open: lastState?.open ?? null, cover: lastState?.cover ?? null, path: lastState?.path })
  // PORTAL_FRAMES=1 keeps every frame (to judge the parting itself).
  if (process.env.PORTAL_FRAMES || frames.length % 3 === 1) await sharp(png).toFile(path.join(OUT, `04-arrival-${String(frames.length).padStart(2, '0')}.png`))
  if (lastState && lastState.path === '/world2' && !lastState.cover) break
  await sleep(process.env.PORTAL_FRAMES ? 0 : 200)
}
const trace = await page.evaluate(() => window.__trace ?? []).catch(() => [])
const sealedAt = trace.find((f) => f.layers > 0)?.t
const liveAfterSeal = trace.filter((f) => sealedAt && f.t > sealedAt && f.live > 0).length
const roomGoneAt = trace.find((f) => sealedAt && f.t >= sealedAt && !f.room)?.t
const routeAt = trace.find((f) => f.path === '/world2')?.t
check('handoff', !!sealedAt && liveAfterSeal === 0 && (!routeAt || (roomGoneAt && roomGoneAt <= routeAt)), { sealedAt, liveAfterSeal, roomGoneMs: roomGoneAt && sealedAt ? roomGoneAt - sealedAt : null, routeMs: routeAt && sealedAt ? routeAt - sealedAt : null })
// Every animation frame from the seal to the parting keeps the whole
// cover (its frozen layers over the dark), across the route change; and
// any screenshot taken in that window shows no plaster or page.
const openAt = trace.find((f) => f.open === 'true')?.t
const between = trace.filter((f) => sealedAt && f.t >= sealedAt && (!openAt || f.t < openAt))
const gaps = between.filter((f) => f.layers === 0)
const closed = frames.filter((f) => f.cover && f.open !== 'true')
check('seam', between.length > 0 && gaps.length === 0 && closed.every((f) => f.light < 0.01), {
  framesBetweenSealAndOpen: between.length, framesWithoutCover: gaps.length, screenshotsClosed: closed.length, maxLight: +Math.max(0, ...closed.map((f) => f.light)).toFixed(4),
})

const world = await page.evaluate(() => ({
  path: location.pathname,
  cover: !!document.querySelector('[class*="canopy-module"][class*="root"]'),
  canvases: document.querySelectorAll('main canvas').length,
  entered: document.querySelector('[data-world2-entered]')?.getAttribute('data-world2-entered') ?? null,
  bg: document.documentElement.style.background || '',
})).catch((e) => ({ error: String(e) }))
await shot('05-world')
check('arrival', world.path === '/world2' && !world.cover && world.canvases === 1 && world.bg === '', { ...world, frames: frames.length, openedAfterMs: frames.find((f) => f.open === 'true')?.t ?? null })
check('errors', errors.length === 0, errors.slice(0, 6))

await ctx.close()
await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed (${W}x${H}, ${ENGINE}) — screenshots in ${OUT}`)
process.exit(failed.length ? 1 : 0)
