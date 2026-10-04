/**
 * Home room: lifecycle and behaviour checks.
 *   node scripts/home-room-lifecycle-qa.mjs [baseUrl] [engine]
 *
 * Each check prints PASS/FAIL with the evidence it used:
 *   fixed      the layer stays put and covers the viewport while the page scrolls
 *   inert      it never receives pointer events (clicks fall through to the page)
 *   growth     growth follows scroll, is the same forward and backward, and
 *              jumps land without passing through intermediate states
 *   restore    a deep link / restored position renders the right state at once
 *   resize     a resize within a class keeps the plants; a class change rebuilds
 *   reduced    reduced motion holds one still state and draws nothing idle
 *   idle       nothing is drawn when nothing changes (and no sway is enabled)
 *   lost       a lost WebGL context swaps in the still image
 *   restored   a context the browser gives back brings the live room back
 *   settle     the air moves after a scroll and settles once input stops
 *   leave      navigating away removes the layer and its probe
 *   portal     `journey:leaving` releases the WebGL context immediately
 */
import { chromium, webkit, firefox } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const ENGINE = process.argv[3] ?? 'chromium'
const engines = { chromium, webkit, firefox }
const results = []
const check = (name, pass, evidence) => {
  results.push({ name, pass, evidence })
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name.padEnd(8)} ${JSON.stringify(evidence)}`)
}

const browser = await engines[ENGINE].launch(ENGINE === 'chromium' ? { args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : {})
const ready = (page) => page.waitForFunction(() => { const r = window.__room?.(); return r && r.cache && r.cache.done >= r.cache.total && r.cache.total > 0 }, null, { timeout: 60000 })
const state = (page) => page.evaluate(() => window.__room?.())
const scrollToFrac = (page, f) => page.evaluate((x) => window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * x, behavior: 'instant' }), f)

{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  await page.goto(`${BASE}/?room-still`, { waitUntil: 'load' })
  await ready(page)
  await page.waitForTimeout(800)

  // fixed: the layer's box is the viewport at several scroll positions.
  const boxes = []
  for (const f of [0, 0.3, 0.7, 1]) {
    await scrollToFrac(page, f)
    await page.waitForTimeout(300)
    boxes.push(await page.evaluate(() => {
      const h = document.querySelector('[class*="room-module"]').getBoundingClientRect()
      // clientWidth: a classic scrollbar (WebKit) is not viewport to cover.
      return [Math.round(h.top), Math.round(h.left), Math.round(h.width), Math.round(h.height), document.documentElement.clientWidth, innerHeight]
    }))
  }
  check('fixed', boxes.every(([t, l, w, h, iw, ih]) => t === 0 && l === 0 && w === iw && h >= ih), boxes)

  // inert: hit-testing the centre of the screen never lands in the layer.
  await scrollToFrac(page, 0.05)
  await page.waitForTimeout(400)
  const hit = await page.evaluate(() => {
    const host = document.querySelector('[class*="room-module"]')
    const pts = [[0.5, 0.5], [0.1, 0.9], [0.9, 0.1], [0.02, 0.5]]
    return pts.map(([x, y]) => { const el = document.elementFromPoint(innerWidth * x, innerHeight * y); return !!el && host.contains(el) })
  })
  const pe = await page.evaluate(() => getComputedStyle(document.querySelector('[class*="room-module"]')).pointerEvents)
  check('inert', !hit.some(Boolean) && pe === 'none', { hitsInLayer: hit, pointerEvents: pe })

  // growth: forward and backward land on the same value; a jump snaps.
  const g = {}
  for (const f of [0.1, 0.4, 0.75]) {
    await scrollToFrac(page, f)
    await page.waitForTimeout(1600)
    g[`fwd${f}`] = (await state(page)).growth
  }
  await scrollToFrac(page, 1)
  await page.waitForTimeout(1200)
  for (const f of [0.75, 0.4, 0.1]) {
    await scrollToFrac(page, f)
    await page.waitForTimeout(1600)
    g[`back${f}`] = (await state(page)).growth
  }
  const same = [0.1, 0.4, 0.75].every((f) => Math.abs(g[`fwd${f}`] - g[`back${f}`]) < 0.002)
  // Jump from top to near the end and sample the very next frames.
  await scrollToFrac(page, 0)
  await page.waitForTimeout(1500)
  const jump = await page.evaluate(async () => {
    const seen = []
    window.scrollTo({ top: (document.documentElement.scrollHeight - innerHeight) * 0.8, behavior: 'instant' })
    for (let i = 0; i < 8; i++) { await new Promise((r) => requestAnimationFrame(r)); seen.push(+window.__room().growth.toFixed(3)) }
    return seen
  })
  const target = jump[jump.length - 1]
  const passedThrough = jump.slice(1, -1).filter((v) => v > 0.12 && Math.abs(v - target) > 0.02)
  check('growth', same && passedThrough.length === 0, { ...g, jumpFrames: jump })

  // idle: with sway held still, nothing is drawn while nothing changes.
  const d0 = (await state(page)).draws
  await page.waitForTimeout(3000)
  const d1 = (await state(page)).draws
  check('idle', d1 - d0 <= 1, { drawsIn3s: d1 - d0 })

  // resize within the class keeps the plan; across classes rebuilds.
  const before = await state(page)
  await page.setViewportSize({ width: 1380, height: 880 })
  await page.waitForTimeout(2500)
  const within = await state(page)
  await page.setViewportSize({ width: 600, height: 1000 })
  await page.waitForTimeout(3500)
  const across = await state(page)
  check('resize', within.composition === before.composition && within.plannedLeaves === before.plannedLeaves && across.composition !== before.composition, {
    before: [before.composition, before.plannedLeaves], within: [within.composition, within.plannedLeaves], across: [across.composition, across.plannedLeaves],
  })

  // lost: force the context away; the still must take over.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(2000)
  const lost = await page.evaluate(async () => {
    const c = document.querySelector('[class*="room-module"] canvas')
    const gl = c.getContext('webgl2')
    gl.getExtension('WEBGL_lose_context').loseContext()
    await new Promise((r) => setTimeout(r, 900))
    const host = document.querySelector('[class*="room-module"]')
    const img = host.querySelector('img')
    return { fallback: host.dataset.fallback, img: img?.getAttribute('src') ?? null, loaded: img ? img.complete && img.naturalWidth > 0 : false }
  })
  check('lost', lost.fallback === 'true' && lost.loaded, lost)

  // leave: client navigation to /projects removes the layer and probe.
  await page.goto(`${BASE}/?room-still`, { waitUntil: 'load' })
  await ready(page)
  await page.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => x.getAttribute('href') === '/projects'); a?.click() })
  await page.waitForURL('**/projects', { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const away = await page.evaluate(() => ({ layer: !!document.querySelector('[class*="room-module"]'), probe: typeof window.__room, path: location.pathname }))
  check('leave', !away.layer && away.probe === 'undefined' && away.path === '/projects', away)

  // back: the browser's Back returns to a working room.
  await page.goBack()
  await page.waitForTimeout(500)
  await ready(page).catch(() => {})
  const backState = await state(page)
  check('back', !!backState && backState.cache.done === backState.cache.total, { composition: backState?.composition, growth: backState?.growth })

  // portal: the hand-over event releases the context at once.
  const portal = await page.evaluate(async () => {
    window.dispatchEvent(new Event('journey:leaving'))
    await new Promise((r) => setTimeout(r, 100))
    const c = document.querySelector('[class*="room-module"] canvas')
    const gl = c?.getContext('webgl2')
    return { probe: window.__room?.() ?? null, contextLost: gl ? gl.isContextLost() : 'no canvas' }
  })
  check('portal', portal.probe === null && (portal.contextLost === true || portal.contextLost === 'no canvas'), portal)
  if (errors.length) console.log('page errors:', errors)
  await ctx.close()
}

// restore: a deep link renders the right state on its first frame.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?room-still#chapter-education`, { waitUntil: 'load' })
  await ready(page)
  const firstDraw = await page.evaluate(() => window.__room().growth)
  await page.waitForTimeout(2500)
  const settled = await page.evaluate(() => window.__room().growth)
  check('restore', Math.abs(firstDraw - settled) < 0.05 && settled > 0.6, { firstDraw, settled })
  await ctx.close()
}

// restored: a lost context that comes back brings the live room back.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?room-still`, { waitUntil: 'load' })
  await ready(page)
  const during = await page.evaluate(async () => {
    const c = document.querySelector('[class*="room-module"] canvas')
    const ext = c.getContext('webgl2').getExtension('WEBGL_lose_context')
    ext.loseContext()
    await new Promise((r) => setTimeout(r, 600))
    const fallback = document.querySelector('[class*="room-module"]').dataset.fallback
    ext.restoreContext()
    return fallback
  })
  // The probe goes to the new engine once the layer has remounted.
  await page.waitForTimeout(500)
  await ready(page).catch(() => {})
  const after = await page.evaluate(() => ({
    fallback: document.querySelector('[class*="room-module"]').dataset.fallback,
    canvases: document.querySelectorAll('[class*="room-module"] canvas').length,
    lost: window.__room?.()?.lost ?? null,
    cache: window.__room?.()?.cache ?? null,
  }))
  check('restored', during === 'true' && after.fallback === 'false' && after.canvases === 1 && after.lost === false && !!after.cache && after.cache.total > 0 && after.cache.done === after.cache.total, { during, ...after })
  await ctx.close()
}

// settle: without `room-still`, a scroll stirs the air, which then
// settles (no draws at all) a few seconds after the last input.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load' })
  await ready(page)
  await scrollToFrac(page, 0.45)
  await page.waitForTimeout(1500)
  const moving = await state(page)
  await page.waitForTimeout(1000)
  const moving2 = await state(page)
  await page.waitForTimeout(9000)
  const s0 = await state(page)
  await page.waitForTimeout(2000)
  const s1 = await state(page)
  check('settle', moving.air > 0 && moving2.draws > moving.draws && s0.air === 0 && s1.draws === s0.draws, {
    airWhileActive: moving.air, drawsPerSecActive: moving2.draws - moving.draws, airLater: s0.air, drawsIn2sLater: s1.draws - s0.draws,
  })
  await ctx.close()
}

// reduced: reduced motion holds the settled state and draws nothing idle.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'load' })
  await ready(page)
  await page.waitForTimeout(1000)
  const a = await state(page)
  await scrollToFrac(page, 0.6)
  await page.waitForTimeout(1200)
  const b = await state(page)
  const d0 = b.draws
  await page.waitForTimeout(3000)
  const c = await state(page)
  check('reduced', Math.abs(a.growth - b.growth) < 1e-6 && c.draws - d0 <= 1, { top: a.growth, scrolled: b.growth, idleDraws: c.draws - d0 })
  await ctx.close()
}

await browser.close()
const failed = results.filter((r) => !r.pass)
console.log(`\n${results.length - failed.length}/${results.length} passed (${ENGINE})`)
process.exit(failed.length ? 1 : 0)
