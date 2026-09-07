/**
 * Measures what the visitor actually downloads and how fast the
 * opening becomes interactive.  node scripts/perf-check.mjs [url]
 */
import { chromium } from 'playwright'

const BASE = process.argv[2] ?? 'http://localhost:3100'
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const before = []
page.on('response', async (r) => {
  const h = r.headers()
  before.push({
    url: r.url().replace(BASE, ''),
    type: r.request().resourceType(),
    status: r.status(),
    size: Number(h['content-length'] ?? 0),
  })
})

const t0 = Date.now()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })
const domReady = Date.now() - t0
await page.waitForLoadState('networkidle')
const idle = Date.now() - t0

const initial = [...before]
// Now let the deferred WebGL layer in.
await page.waitForTimeout(4000)

const metrics = await page.evaluate(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paints = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]))
  return {
    domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
    load: Math.round(nav.loadEventEnd),
    ...paints,
    transferred: Math.round(performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
  }
})

const group = (list) => {
  const by = {}
  for (const r of list) {
    if (r.status >= 400) continue
    by[r.type] = (by[r.type] ?? 0) + r.size
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, `${Math.round(v / 1024)} KB`]))
}

// Sample frame rate while scrolling the whole journey.
const fps = await page.evaluate(async () => {
  const samples = []
  let frames = 0
  let last = performance.now()
  let raf = 0
  const tick = (now) => { frames++; if (now - last > 500) { samples.push(frames * 1000 / (now - last)); frames = 0; last = now } raf = requestAnimationFrame(tick) }
  raf = requestAnimationFrame(tick)
  const max = document.documentElement.scrollHeight - innerHeight
  for (let i = 0; i <= 40; i++) {
    window.scrollTo({ top: (max * i) / 40, behavior: 'instant' })
    await new Promise((r) => setTimeout(r, 140))
  }
  cancelAnimationFrame(raf)
  samples.sort((a, b) => a - b)
  return { min: Math.round(samples[0]), p10: Math.round(samples[Math.floor(samples.length * 0.1)]), median: Math.round(samples[Math.floor(samples.length / 2)]) }
})

const mem = await page.evaluate(() => {
  const gl = window.__gl
  return gl ? { geometries: gl.info.memory.geometries, textures: gl.info.memory.textures, calls: gl.info.render.calls } : null
})

await browser.close()

console.log(`\nFirst load (to network idle: ${idle}ms, DOM ready ${domReady}ms)`)
console.log('  by type:', group(initial))
console.log('  requests:', initial.filter((r) => r.status < 400).length)
console.log('\nAfter the WebGL layer loads')
console.log('  by type:', group(before))
console.log('  total transferred:', metrics.transferred, 'KB')
console.log('\nPaint:', { fcp: metrics['first-contentful-paint'], dcl: metrics.domContentLoaded, load: metrics.load })
console.log('Scroll FPS across the whole journey:', fps)
console.log('WebGL at rest:', mem)
