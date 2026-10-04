/**
 * Home room: performance and lifecycle probe.
 *   node scripts/home-room-perf.mjs [baseUrl] [viewport]
 *
 * Measures, in the browser that runs it (numbers are only as good as
 * that machine and its GPU — report them as such):
 *   · time from navigation to the room's first frame;
 *   · frame intervals (rAF) while scrolling the whole journey, and
 *     while idle on a page that has nothing to animate;
 *   · how many frames the room actually drew in each phase;
 *   · GPU resources it holds (geometries, textures, programs);
 *   · that its WebGL context is released after navigating away.
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const [W, H] = (process.argv[3] ?? '1440x900').split('x').map(Number)
const mobile = W < H

const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] })
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: mobile ? 3 : 2, isMobile: mobile, hasTouch: mobile })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })

const t0 = Date.now()
await page.goto(BASE, { waitUntil: 'load', timeout: 90000 })
const tLoad = Date.now() - t0
await page.waitForFunction(() => document.querySelector('[class*="room-module"][data-ready="true"]'), null, { timeout: 60000 })
const tReady = Date.now() - t0
const info = await page.evaluate(() => window.__room?.())

// Frame-interval sampler in the page.
await page.evaluate(() => {
  window.__frames = []
  let last = performance.now()
  const loop = (now) => { window.__frames.push(now - last); last = now; window.__raf = requestAnimationFrame(loop) }
  window.__raf = requestAnimationFrame(loop)
})
const stats = (arr) => {
  const a = [...arr].sort((x, y) => x - y)
  const q = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))]
  return { frames: a.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1), over33: a.filter((x) => x > 33.4).length }
}

// Scroll the whole journey with the wheel, as a visitor would.
const drawsBefore = await page.evaluate(() => window.__room?.()?.draws ?? null)
const total = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)
await page.evaluate(() => { window.__frames = [] })
const steps = 120
for (let i = 0; i < steps; i++) {
  await page.mouse.wheel(0, total / steps)
  await page.waitForTimeout(60)
}
await page.waitForTimeout(1200)
const scroll = stats(await page.evaluate(() => window.__frames))
const drawsScroll = await page.evaluate(() => window.__room?.()?.draws ?? null)

// Idle: no input for five seconds (the air is still moving: it
// settles `swayLinger` seconds after the last input)…
await page.evaluate(() => { window.__frames = [] })
await page.waitForTimeout(5000)
const idle = stats(await page.evaluate(() => window.__frames))
const drawsIdle = await page.evaluate(() => window.__room?.()?.draws ?? null)
// …and once it has settled.
await page.waitForTimeout(6000)
const drawsSettled0 = await page.evaluate(() => window.__room?.()?.draws ?? null)
await page.waitForTimeout(3000)
const drawsSettled1 = await page.evaluate(() => window.__room?.()?.draws ?? null)
const gpu = await page.evaluate(() => window.__room?.()?.gpu ?? null)

// Leave for /projects through the HUD link, then check the context.
const contexts = await page.evaluate(() => [...document.querySelectorAll('canvas')].length)
await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/projects'); a?.click() })
await page.waitForURL('**/projects', { timeout: 30000 }).catch(() => {})
await page.waitForTimeout(2500)
const after = await page.evaluate(() => ({
  roomLayer: !!document.querySelector('[class*="room-module"]'),
  probe: typeof window.__room,
  canvases: [...document.querySelectorAll('canvas')].length,
}))

console.log(JSON.stringify({
  viewport: `${W}x${H}`,
  load_ms: tLoad,
  roomReady_ms: tReady,
  room: info,
  scroll: { ...scroll, roomDraws: drawsScroll != null && drawsBefore != null ? drawsScroll - drawsBefore : null },
  idle: { ...idle, roomDraws: drawsIdle != null && drawsScroll != null ? drawsIdle - drawsScroll : null },
  settledDrawsIn3s: drawsSettled0 != null && drawsSettled1 != null ? drawsSettled1 - drawsSettled0 : null,
  gpu,
  canvasesOnHome: contexts,
  afterNavigation: after,
  errors,
}, null, 2))
await browser.close()
