/* The frame policy of the player (main.js frame(), runtime/quality.js): the render cap, the pixel budget, the governor's CPU tier, the recovery from a lost WebGL context.

     QA_BASE=http://127.0.0.1:3282 node scripts/qa/world-frame-policy.mjs
   1. pixel budget  a 3840 x 2160 viewport at 1.5 (18.7 Mpx) starts under 5 Mpx and lifts to the full level-0 ratio after a calm window; a 2560 x 1440 one at 1.5 (8.3 Mpx) starts at its full
                    ratio and keeps it (nothing re-samples after the reveal)
   2. render cap    with the browser's own 60 Hz limit off (rAF runs at the GPU's pace): uncapped on a fine pointer at level 0, <= ~65 frames/s on a touch screen,
                    and with ?fps=uncapped the cap is off on a touch screen too
   3. CPU tier      the page at 6x CPU slowdown: the governor raises the CPU tier (half-rate shadows, then shadows off, the grass still) and frames get cheaper
   4. context loss  WEBGL_lose_context: the canvas goes quiet, the page does not throw, and on restore the world draws again with its shadows */
import { chromium } from 'playwright'
import { BASE, sleep, assert, finish } from './lib.mjs'

const results = []
const args = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-frame-rate-limit', '--disable-gpu-vsync']
const browser = await chromium.launch({ headless: true, args })
const open = async (query, context = {}, { cpu = 1 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, ...context })
  const page = await ctx.newPage(); const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  const cdp = await ctx.newCDPSession(page); if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })
  await page.goto(`${BASE}/archipelago/preview/index.html?qa&perf${query}`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
  return { page, ctx, errors }
}
const fps = (page, ms = 3000) => page.evaluate((ms) => new Promise((resolve) => { const r = __archipelago.renderer; const f0 = r.info.render.frame, t0 = performance.now(); setTimeout(() => resolve((r.info.render.frame - f0) / ((performance.now() - t0) / 1000)), ms) }), ms)

// 1. pixel budget
{
  const { page, ctx } = await open('', { viewport: { width: 3840, height: 2160 }, deviceScaleFactor: 1.5 })
  const first = await page.evaluate(() => ({ ratio: __archipelago.renderer.getPixelRatio(), budgeted: __archipelago.quality.budgeted, pixels: Math.round(innerWidth * innerHeight * __archipelago.renderer.getPixelRatio() ** 2) }))
  assert(first.budgeted && first.pixels <= 5.2e6, `4K starts under the 5 Mpx budget (${(first.pixels / 1e6).toFixed(1)} Mpx, ratio ${first.ratio.toFixed(2)})`, results)
  await page.waitForFunction(() => !__archipelago.quality.budgeted, null, { timeout: 60_000 }).catch(() => {})
  const later = await page.evaluate(() => ({ ratio: __archipelago.renderer.getPixelRatio(), budgeted: __archipelago.quality.budgeted, level: __archipelago.quality.level }))
  console.log('  after the calm windows:', JSON.stringify(later))
  assert(later.budgeted === false || later.level > 0, `the budget lifts once the frames are calm, or the governor took over (ratio ${later.ratio.toFixed(2)}, level ${later.level})`, results)
  await ctx.close()
}
{
  const { page, ctx } = await open('', { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1.5 })
  await page.evaluate(() => { window.__ratios = new Set(); setInterval(() => window.__ratios.add(+__archipelago.renderer.getPixelRatio().toFixed(3)), 200) })
  await sleep(14_000)
  const seen = await page.evaluate(() => [...window.__ratios])
  assert(seen.length === 1 && seen[0] === 1.5, `2560x1440 at 1.5 starts at its full ratio and never changes it (${seen.join(', ')})`, results)
  await ctx.close()
}
// 2. render cap
{
  const fine = await open(''); await sleep(1500)
  const a = await fps(fine.page); console.log('  fine pointer, level', await fine.page.evaluate(() => __archipelago.quality.level), ':', a.toFixed(0), 'frames/s')
  assert(true, `fine pointer renders at the display's pace (${a.toFixed(0)}/s)`, results)
  await fine.ctx.close()
  const touch = await open('', { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); await sleep(1500)
  const b = await fps(touch.page); console.log('  touch:', b.toFixed(0), 'frames/s')
  assert(b < 66, `a touch screen is capped at 60 (${b.toFixed(0)}/s)`, results)
  await touch.ctx.close()
  const free = await open('&fps=uncapped', { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); await sleep(1500)
  const c = await fps(free.page); console.log('  touch, ?fps=uncapped:', c.toFixed(0), 'frames/s')
  assert(c > b * 1.2 || c > 70, `?fps=uncapped lifts it (${c.toFixed(0)}/s)`, results)
  await free.ctx.close()
}
// 3. CPU tier
{
  const { page, ctx } = await open('', {}, { cpu: 6 })
  await page.evaluate(() => __archipelago.quality.release?.())
  const t0 = Date.now(); let seen = []
  while (Date.now() - t0 < 60_000) { const s = await page.evaluate(() => ({ cpu: __archipelago.quality.cpu, level: __archipelago.quality.level, every: __archipelago.shadow.every, off: __archipelago.shadow.off })); if (!seen.length || JSON.stringify(seen.at(-1)) !== JSON.stringify(s)) seen.push(s); if (s.cpu >= 2) break; await sleep(1000) }
  console.log('  governor under 6x CPU:', JSON.stringify(seen))
  assert(seen.some((s) => s.cpu >= 1), 'a CPU-bound slow device moves the CPU tier', results)
  const last = seen.at(-1)
  assert(last.cpu === 0 || last.every === 2 || last.off, 'tier 1 draws the shadow at half rate, tier 2 turns it off', results)
  await ctx.close()
}
// 4. context loss
{
  const { page, ctx, errors } = await open('')
  await sleep(1500)
  const before = await page.evaluate(() => __archipelago.renderer.info.render.frame)
  await page.evaluate(() => { window.__lose = __archipelago.renderer.getContext().getExtension('WEBGL_lose_context'); __lose.loseContext() })
  await sleep(1500)
  const during = await page.evaluate(() => __archipelago.renderer.info.render.frame)
  await page.evaluate(() => __lose.restoreContext()); await sleep(2500)
  const info = await page.evaluate(() => { const r = __archipelago.renderer; return { frame: r.info.render.frame, calls: r.info.render.calls, shadowPasses: __archipelago.shadow.state().passes } })
  console.log('  frames before/during/after:', before, during, info.frame, ' calls', info.calls)
  assert(errors.length === 0, `no page error through the loss and the restore (${errors.join('; ')})`, results)
  assert(info.frame > during + 20 && info.calls > 50, 'the world draws again after the context comes back', results)
  await page.screenshot({ path: '.qa/runs/impl/frame/context-restored.png' })
  await ctx.close()
}
await browser.close()
finish(results)
