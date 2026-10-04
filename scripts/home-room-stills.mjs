/**
 * Renders the fallback stills for the home room from the room itself.
 *   node scripts/home-room-stills.mjs [baseUrl]
 *
 * The homepage shows these only when WebGL cannot start or its
 * context is lost for good: a landscape and a portrait frame of the
 * same scene, with the copy hidden. A still is scaled to screens the
 * copy was never measured on, so it is captured in the room's
 * capture mode (`room-capture`: the entablature up out of the frame,
 * every chapter's copy kept clear at once) and at an early growth
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
const GROWTH = 0.32
const OUT = path.resolve('public/home-room')
const SHOTS = [
  { name: 'landscape', width: 1920, height: 1080, dpr: 1, mobile: false },
  { name: 'portrait', width: 430, height: 932, dpr: 2, mobile: true },
]

await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
for (const s of SHOTS) {
  const ctx = await browser.newContext({
    viewport: { width: s.width, height: s.height },
    deviceScaleFactor: s.dpr,
    isMobile: s.mobile,
    hasTouch: s.mobile,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/?room-still&room-capture&room-g=${GROWTH}`, { waitUntil: 'load', timeout: 90000 })
  await page.waitForFunction(() => { const r = window.__room?.(); return r && r.cache && r.cache.done >= r.cache.total && r.cache.total > 0 }, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  await page.addStyleTag({ content: 'body > *:not([class*="room-module"]) { visibility: hidden !important } nextjs-portal { display: none !important }' })
  await page.waitForTimeout(300)
  const png = await page.screenshot()
  const file = path.join(OUT, `still-${s.name}.webp`)
  await sharp(png).webp({ quality: 72, effort: 6 }).toFile(file)
  const { size } = await import('node:fs').then((fs) => fs.promises.stat(file))
  console.log(`${file}  ${(size / 1024).toFixed(0)} KB`)
  await ctx.close()
}
await browser.close()
