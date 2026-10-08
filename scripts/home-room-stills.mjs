/**
 * Renders the fallback stills for the home room from the room itself.
 *   node scripts/home-room-stills.mjs [baseUrl]
 *
 * The homepage shows these only when WebGL cannot start or its
 * context is lost for good. The responsive start frames also cover
 * first paint while WebGL prepares, using the actual opening camera.
 * Fallback frames use capture mode (`room-capture`: the entablature
 * up out of frame, every chapter's copy kept clear) and an early growth
 * value, where the plants keep to the edges. Re-run after changing
 * the room's look. Needs a running server (default
 * http://localhost:3000).
 * Writes public/home-room/still-{landscape,portrait}.webp.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = path.resolve('public/home-room')
const SHOTS = [
  { name: 'still-start-landscape', growth: 0.06, width: 1920, height: 1080, dpr: 1, mobile: false },
  { name: 'still-start-laptop', growth: 0.06, width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'still-start-wide', growth: 0.06, width: 2560, height: 1080, dpr: 1, mobile: false },
  { name: 'still-start-tablet', growth: 0.06, width: 768, height: 1024, dpr: 1, mobile: false },
  { name: 'still-start-portrait', growth: 0.06, width: 430, height: 932, dpr: 2, mobile: true },
  { name: 'still-landscape', growth: 0.32, width: 1920, height: 1080, dpr: 1, mobile: false },
  { name: 'still-portrait', growth: 0.32, width: 430, height: 932, dpr: 2, mobile: true },
]

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
for (const s of SHOTS.filter(s => !process.argv.includes('--start-only') || s.name.startsWith('still-start'))) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.dpr,
    isMobile: s.mobile,
    hasTouch: s.mobile,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?room-still&${s.name.startsWith('still-start') ? '' : 'room-capture&'}room-g=${s.growth}`, { waitUntil: 'load', timeout: 90000 })
  await page.waitForFunction(() => { const r = window.__room?.(); return r && r.cache && r.cache.done >= r.cache.total && r.cache.total > 0 }, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  await page.addStyleTag({ content: 'body > *:not([class*="room-module"]) { visibility: hidden !important } nextjs-portal { display: none !important }' })
  await page.waitForTimeout(300)
  const png = await page.screenshot()
  const file = path.join(OUT, `${s.name}.webp`)
  await sharp(png).webp({ quality: 72, effort: 6 }).toFile(file)
  const { size } = await import('node:fs').then((fs) => fs.promises.stat(file))
  console.log(`${file}  ${(size / 1024).toFixed(0)} KB`)
  await ctx.close()
}
await browser.close()
