/* Screenshots of every chapter of a journey at the widths the site has
   to compose for, plus an overflow check at each.

     node scripts/qa/responsive-shots.mjs [--base URL] [--path /] [--widths 320,390,768]
       [--engine chromium|firefox|webkit] [--at 0.5] [--landscape]

   For each width the page is loaded once, then each chapter is
   scrolled to `--at` of its length (default: the middle, where its
   stage is pinned) and captured. Reported per width:

     overflow   the document is wider than the viewport (a horizontal
                scrollbar), with the widest offending elements
     clipped    text boxes that leave the viewport horizontally
*/
import { chromium, firefox, webkit } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BASE = opt('base', process.env.QA_BASE ?? 'http://localhost:3210')
const PAGE = opt('path', '/')
const ENGINE = opt('engine', 'chromium')
const AT = Number(opt('at', 0.5))
const LANDSCAPE = Boolean(opt('landscape', false))
const WIDTHS = String(opt('widths', '320,390,768,1024,1440,1920,2560,3440')).split(',').map(Number)
const HEIGHT_FOR = (w) => (LANDSCAPE ? Math.round(w * 0.46) : w <= 420 ? Math.round(w * 2.16) : w <= 800 ? 1024 : w <= 1100 ? 768 : w <= 1500 ? 900 : w <= 2000 ? 1080 : 1440)
const OUT = opt('out', process.env.QA_OUT ?? path.resolve('.qa/responsive'))
fs.mkdirSync(OUT, { recursive: true })

const engines = { chromium, firefox, webkit }
const launchArgs = ENGINE === 'chromium' ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {}
const browser = await engines[ENGINE].launch({ headless: true, ...launchArgs })
let problems = 0

for (const w of WIDTHS) {
  const h = HEIGHT_FOR(w)
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: ENGINE === 'chromium' && w < 800 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(2500)
  const chapters = await page.evaluate(() => [...document.querySelectorAll('section[data-chapter]')].map((s) => ({ id: s.dataset.chapter, top: s.offsetTop, h: s.offsetHeight })))
  const list = chapters.length ? chapters : [{ id: 'page', top: 0, h: 0 }]
  for (const c of list) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, c.top + (c.h - h) * AT))
    await page.waitForTimeout(1400)
    const file = path.join(OUT, `${PAGE.replace(/\W+/g, '_') || 'home'}-${ENGINE}-${w}x${h}-${c.id}.png`)
    await page.screenshot({ path: file })
    const report = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const overflow = document.documentElement.scrollWidth > vw + 1
      const offenders = []
      if (overflow) {
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect()
          if (r.right > vw + 1 && getComputedStyle(el).position !== 'fixed') offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} → ${Math.round(r.right)}`)
          if (offenders.length > 6) break
        }
      }
      const clipped = []
      const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      let n
      while ((n = walker.nextNode())) {
        if (!n.textContent.trim()) continue
        const el = n.parentElement
        if (!el || el.closest('[aria-hidden="true"], .sr-only')) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue
        range.selectNodeContents(n)
        for (const r of range.getClientRects()) {
          if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue
          if (r.left < -1 || r.right > vw + 1) clipped.push(`${n.textContent.trim().slice(0, 30)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
        }
        if (clipped.length > 5) break
      }
      return { overflow, offenders, clipped }
    })
    const bad = report.overflow || report.clipped.length
    if (bad) problems++
    console.log(`${bad ? 'WARN' : 'ok  '} ${w}×${h} ${c.id}${report.overflow ? `  overflow: ${report.offenders.join(', ')}` : ''}${report.clipped.length ? `  clipped: ${report.clipped.join(' | ')}` : ''}`)
  }
  if (errors.length) console.log(`  page errors at ${w}: ${errors.join(' | ')}`)
  await context.close()
}
await browser.close()
console.log(`${problems} capture(s) with problems; screenshots in ${OUT}`)
if (problems) process.exitCode = 1
