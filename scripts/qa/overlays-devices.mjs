/* The two overlays of the home page — the index (menu) and the project case study — on the devices the site has to
   work on: nothing outside the screen sideways, no text cut by the panel's edge, controls big enough to tap, and the
   panel reaching its last line when it is scrolled.

     node scripts/qa/overlays-devices.mjs [--base URL] [--sizes 375x553,...] [--slugs focus,gym-app] [--out .qa/overlays]  */
import { chromium, webkit, firefox } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] }
const BASE = opt('base', process.env.QA_BASE ?? 'http://127.0.0.1:3398')
const ENGINE = opt('engine', 'chromium')
const SIZES = opt('sizes', '320x454,375x553,390x664,430x739,667x315,844x390,744x1048,1133x690,1280x720,1440x900,1920x1080').split(',').map((s) => s.split('x').map(Number))
const SLUGS = opt('slugs', 'focus,gym-app,chess-assistant,stock-matching,pansofia,metaview').split(',')
const OUT = path.resolve(opt('out', '.qa/overlays'))
fs.mkdirSync(OUT, { recursive: true })

const INSPECT = (rootSelector) => {
  const vw = document.documentElement.clientWidth, vh = innerHeight
  const root = document.querySelector(rootSelector) ?? document.body
  const problems = []
  const visible = (el) => { for (let a = el; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) return false } return true }
  const sideways = (el) => { for (let a = el.parentElement; a && a !== root.parentElement; a = a.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(a).overflowX)) return true; return false }
  const range = document.createRange()
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let n
  while ((n = walker.nextNode()) && problems.length < 8) {
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || el.closest('.sr-only, [aria-hidden="true"], script, style') || !visible(el) || sideways(el)) continue
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) if (r.width && r.top < vh && r.bottom > 0 && (r.left < -1 || r.right > vw + 1)) problems.push(`text “${n.textContent.trim().slice(0, 26)}” [${Math.round(r.left)}..${Math.round(r.right)}] of ${vw}`)
  }
  const grow = (el) => { let x = 0, y = 0; for (const pseudo of ['::before', '::after']) { const c = getComputedStyle(el, pseudo); if (c.position === 'absolute' && c.content !== 'none' && c.content !== 'normal') { x = Math.max(x, parseFloat(c.left) < 0 ? -parseFloat(c.left) : 0); y = Math.max(y, parseFloat(c.top) < 0 ? -parseFloat(c.top) : 0) } } return { x, y } }
  if (matchMedia('(pointer: coarse)').matches) {
    for (const el of root.querySelectorAll('a[href], button, [role="button"]')) {
      if (problems.length > 10) break
      if (el.closest('[aria-hidden="true"], .sr-only') || !visible(el)) continue
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el), g = grow(el)
      if (r.width && r.height && r.top < vh && r.bottom > 0 && (r.width + 2 * g.x < 30 || r.height + 2 * g.y < 30) && cs.display !== 'inline') problems.push(`${el.tagName.toLowerCase()} “${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18)}” ${Math.round(r.width + 2 * g.x)}×${Math.round(r.height + 2 * g.y)}: small to tap`)
    }
  }
  const scroller = [root, ...root.querySelectorAll('*')].find((e) => { const s = getComputedStyle(e); return ['auto', 'scroll'].includes(s.overflowY) && e.scrollHeight > e.clientHeight + 2 })
  return { problems, scroller: scroller ? { tag: scroller.tagName.toLowerCase(), cls: String(scroller.className).slice(0, 30), max: scroller.scrollHeight - scroller.clientHeight } : null, doc: document.documentElement.scrollWidth > vw + 1 ? `document is ${document.documentElement.scrollWidth} wide` : null }
}

const browser = await ({ chromium, webkit, firefox })[ENGINE].launch({ headless: true })
let bad = 0
const report = (label, r, errors = []) => {
  const problems = [...r.problems, ...(r.doc ? [r.doc] : []), ...errors]
  if (problems.length) bad++
  console.log(`${problems.length ? 'WARN' : 'ok  '} ${label}${problems.length ? `\n     ${problems.join('\n     ')}` : ''}`)
}
for (const [w, h] of SIZES) {
  const touch = w < 800 || h < 500
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: ENGINE === 'chromium' && touch })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(`page error: ${String(e).slice(0, 140)}`))
  await page.goto(`${BASE}/`, { waitUntil: 'load' })
  await page.waitForTimeout(2200)
  await page.getByRole('button', { name: /index/i }).first().click().catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(OUT, `index-${ENGINE}-${w}x${h}.png`) })
  report(`${w}×${h} index overlay`, await page.evaluate(INSPECT, '[class*="IndexOverlay-module"][class*="__overlay"]'), errors.splice(0))
  for (const slug of SLUGS) {
    await page.goto(`${BASE}/#project/${slug}`, { waitUntil: 'load' })
    await page.reload({ waitUntil: 'load' })
    await page.waitForTimeout(2200)
    const base = path.join(OUT, `project-${slug}-${ENGINE}-${w}x${h}`)
    await page.screenshot({ path: `${base}.png` })
    const top = await page.evaluate(INSPECT, '[class*="ProjectOverlay-module"][class*="__overlay"]')
    let tail = null
    if (top.scroller) {
      await page.evaluate(() => { const root = document.querySelector('[class*="ProjectOverlay-module"][class*="__overlay"]'); const el = [...root.querySelectorAll('*')].find((e) => ['auto', 'scroll'].includes(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 2); if (el) el.scrollTop = el.scrollHeight })
      await page.waitForTimeout(700)
      await page.screenshot({ path: `${base}-end.png` })
      tail = await page.evaluate(INSPECT, '[class*="ProjectOverlay-module"][class*="__overlay"]')
    }
    report(`${w}×${h} project overlay ${slug}${top.scroller ? ` (scrolls ${top.scroller.max}px)` : ''}`, { problems: [...top.problems, ...(tail?.problems ?? []).map((p) => `end: ${p}`)], doc: top.doc }, errors.splice(0))
  }
  await context.close()
}
await browser.close()
console.log(`${bad} case(s) with problems; screenshots in ${OUT}`)
if (bad) process.exitCode = 1
