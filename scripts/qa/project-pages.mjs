/* Every project page (and the other plain pages) at the viewports of the device matrix, checked for what a page that
   scrolls naturally can get wrong: sideways overflow, text outside the screen, images or media wider than the
   column, and controls too small to tap on a touch screen.

     node scripts/qa/project-pages.mjs [--base URL] [--engine chromium] [--sizes 390x664,820x1100,1440x900]
                                       [--paths /projects/focus,...] [--shots] [--out .qa/pages]

   With no --paths it takes every project in the sitemap, plus /projects/does-not-exist (the 404). --shots writes a
   full-page screenshot per page and size. */
import { chromium, firefox, webkit } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1] }
const BASE = opt('base', process.env.QA_BASE ?? 'http://127.0.0.1:3398')
const ENGINE = opt('engine', 'chromium')
const SIZES = opt('sizes', '320x454,390x664,430x739,744x1048,1024x1290,1280x720,1440x900,1920x1080,3440x1440').split(',').map((s) => s.split('x').map(Number))
const OUT = path.resolve(opt('out', '.qa/pages'))
const SHOTS = args.includes('--shots')
fs.mkdirSync(OUT, { recursive: true })

let paths = opt('paths', null)?.split(',')
if (!paths) {
  const xml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  paths = [...xml.matchAll(/<loc>[^<]*?(\/projects\/[^<]+)<\/loc>/g)].map((m) => m[1])
  paths.push('/projects/does-not-exist')
}

const INSPECT = () => {
  const vw = document.documentElement.clientWidth
  const out = { overflow: document.documentElement.scrollWidth > vw + 1 ? `${document.documentElement.scrollWidth} > ${vw}` : null, wide: [], clipped: [], tiny: [] }
  const sideways = (el) => { for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) if (['auto', 'scroll'].includes(getComputedStyle(a).overflowX)) return true; return false }
  for (const el of document.querySelectorAll('img, video, canvas, svg, iframe, table, pre')) {
    if (out.wide.length > 4) break
    if (el.closest('[aria-hidden="true"]') && el.tagName === 'svg') continue
    const r = el.getBoundingClientRect()
    if (r.width > 1 && !sideways(el) && (r.right > vw + 1 || r.left < -1)) out.wide.push(`${el.tagName.toLowerCase()} ${Math.round(r.left)}..${Math.round(r.right)}`)
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  let n
  while ((n = walker.nextNode())) {
    if (out.clipped.length > 4) break
    if (!n.textContent.trim()) continue
    const el = n.parentElement
    if (!el || el.closest('[aria-hidden="true"], .sr-only, script, style') || sideways(el)) continue
    let seen = true
    for (let a = el; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.05) { seen = false; break } }
    if (!seen) continue
    range.selectNodeContents(n)
    for (const r of range.getClientRects()) if (r.width && (r.left < -1 || r.right > vw + 1)) out.clipped.push(`${n.textContent.trim().slice(0, 28)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
  }
  const grow = (el) => { let x = 0, y = 0; for (const pseudo of ['::before', '::after']) { const c = getComputedStyle(el, pseudo); if (c.position === 'absolute' && c.content !== 'none' && c.content !== 'normal') { x = Math.max(x, parseFloat(c.left) < 0 ? -parseFloat(c.left) : 0); y = Math.max(y, parseFloat(c.top) < 0 ? -parseFloat(c.top) : 0) } } return { x, y } }
  if (matchMedia('(pointer: coarse)').matches) {
    for (const el of document.querySelectorAll('a[href], button, [role="button"], input, select, textarea, summary')) {
      if (out.tiny.length > 4) break
      if (el.closest('[aria-hidden="true"], .sr-only')) continue
      const cs = getComputedStyle(el)
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue
      const r = el.getBoundingClientRect(), g = grow(el)
      // An inline link inside a sentence is as big as its text; what has to be tappable is a control.
      if (r.width && r.height && (r.height + 2 * g.y < 24 || r.width + 2 * g.x < 24) && cs.display !== 'inline') out.tiny.push(`${el.tagName.toLowerCase()} ${Math.round(r.width + 2 * g.x)}x${Math.round(r.height + 2 * g.y)} ${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 18)}`)
    }
  }
  return out
}

const engines = { chromium, firefox, webkit }
const browser = await engines[ENGINE].launch({ headless: true })
let problems = 0
for (const [w, h] of SIZES) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 800, isMobile: ENGINE === 'chromium' && w < 800 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)))
  for (const p of paths) {
    const res = await page.goto(`${BASE}${p}`, { waitUntil: 'load' }).catch((e) => ({ status: () => `error ${e.message.slice(0, 60)}` }))
    await page.waitForTimeout(700)
    const r = await page.evaluate(INSPECT)
    const bad = r.overflow || r.wide.length || r.clipped.length || r.tiny.length
    if (bad) problems++
    if (SHOTS) await page.screenshot({ path: path.join(OUT, `${p.replace(/\W+/g, '_')}-${ENGINE}-${w}x${h}.png`), fullPage: true })
    console.log(`${bad ? 'WARN' : 'ok  '} ${w}×${h} ${p} [${res.status?.()}]${r.overflow ? `  overflow ${r.overflow}` : ''}${r.wide.length ? `  wide: ${r.wide.join(' | ')}` : ''}${r.clipped.length ? `  clipped: ${r.clipped.join(' | ')}` : ''}${r.tiny.length ? `  small targets: ${r.tiny.join(' | ')}` : ''}`)
  }
  if (errors.length) console.log(`  page errors at ${w}×${h}: ${[...new Set(errors)].join(' | ')}`)
  await context.close()
}
await browser.close()
console.log(`${problems} page/size combination(s) with problems`)
if (problems) process.exitCode = 1
