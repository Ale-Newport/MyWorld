/* The five "A little about me" animations, at the sizes the section
   has to compose for.

     node scripts/qa/about-animations.mjs [--base http://localhost:3401]
       [--ids about.journey-ribbon,…] [--sizes 1440x900,390x844] [--at 0.3,0.55,0.85]
       [--out .qa/about-animations]

   For every option (picked with ?section-animation=<id>) and every
   viewport, the page is loaded once and the About chapter is scrolled
   to each `--at` of its own progress, then captured. Checked each time:

     box        the option mounted, fills the slot, clips its own
                overflow and does not intersect the summary heading
     overflow   the document is no wider than the viewport
     errors     console errors, warnings and uncaught exceptions.
                Listed apart, not failed: what the page does without
                any option — the dev server's 404s and "preloaded but
                not used" notices for its own chunk preloads, and the
                WebGL hall's THREE.Clock deprecation.

   Then, once per option:

     reduced    with `prefers-reduced-motion: reduce` emulated, the box
                is one still state: its DOM and canvas pixels are the
                same at every scroll position (and it is captured)
     idle       scrolled far away, the option does no per-frame work:
                no attribute writes and no canvas draws inside its box
                for a full second (and some while it is on screen)

   Screenshots: <out>/<option>/<w>x<h>[-reduced]-<at>.png
*/
import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  if (i < 0) return fallback
  const v = args[i + 1]
  return v === undefined || v.startsWith('--') ? true : v
}
const BASE = opt('base', process.env.QA_BASE ?? 'http://localhost:3401')
const IDS = String(opt('ids', 'about.journey-ribbon,about.identity-assembly,about.profile-frame,about.interest-constellation,about.type-motion')).split(',')
const SIZES = String(opt('sizes', '1440x900,1024x768,768x1024,390x844,320x640,2560x1440')).split(',').map((s) => s.split('x').map(Number))
const AT = String(opt('at', '0.3,0.55,0.85')).split(',').map(Number)
const REDUCED_SIZES = [[1440, 900], [390, 844]]
const OUT = path.resolve(String(opt('out', '.qa/about-animations')))

const results = []
const check = (ok, message) => {
  results.push({ ok: !!ok, message })
  if (!ok) console.log(`FAIL ${message}`)
  return !!ok
}

/* Counts what an option does per frame inside its slot: every reach
   for an element's inline style (each style write starts with one,
   even when it writes the value already there, which a
   MutationObserver would not see), every attribute set (SVG geometry)
   and every canvas clear (each canvas frame starts with one).
   Installed before the page's own scripts run. */
function instrument() {
  const w = window
  w.__aboutQa = { mutations: 0, draws: 0 }
  const inSlot = (el) => !!el?.closest?.('[data-section-animation]')
  for (const proto of [HTMLElement.prototype, SVGElement.prototype]) {
    const d = Object.getOwnPropertyDescriptor(proto, 'style')
    if (!d?.get) continue
    Object.defineProperty(proto, 'style', {
      ...d,
      get() {
        if (inSlot(this)) w.__aboutQa.mutations++
        return d.get.call(this)
      },
    })
  }
  const setAttribute = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (...a) {
    if (inSlot(this)) w.__aboutQa.mutations++
    return setAttribute.apply(this, a)
  }
  const clear = CanvasRenderingContext2D.prototype.clearRect
  CanvasRenderingContext2D.prototype.clearRect = function (...a) {
    if (inSlot(this.canvas)) w.__aboutQa.draws++
    return clear.apply(this, a)
  }
}

async function aboutRange(page) {
  return page.evaluate(() => {
    const secs = [...document.querySelectorAll('section[data-chapter]')].map((s) => ({ id: s.dataset.chapter, h: s.offsetHeight }))
    const total = secs.reduce((a, s) => a + s.h, 0)
    let cursor = 0
    const ranges = secs.map((s) => {
      const r = { id: s.id, start: cursor / total, end: (cursor + s.h) / total }
      cursor += s.h
      return r
    })
    const r = ranges.find((x) => x.id === 'about')
    return r && { ...r, max: document.documentElement.scrollHeight - innerHeight }
  })
}

/** Scrolls so the About chapter's own progress is `t` (the journey maps document progress onto chapters by their lengths). */
async function scrollTo(page, range, t) {
  await page.evaluate((y) => window.scrollTo(0, y), (range.start + t * (range.end - range.start)) * range.max)
}

function boxReport(id) {
  const slot = document.querySelector(`[data-section-animation="${id}"]`)
  const root = slot?.firstElementChild
  const heading = document.getElementById('about-title')
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  }
  const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const s = slot && rect(slot)
  const r = root && rect(root)
  const hd = heading && rect(heading)
  return {
    mounted: !!root,
    fills: !!(s && r && Math.abs(s.w - r.w) < 1.5 && Math.abs(s.h - r.h) < 1.5),
    clips: !!root && ['hidden', 'clip'].includes(getComputedStyle(root).overflowX) && ['hidden', 'clip'].includes(getComputedStyle(root).overflowY),
    intersects: !!(r && hd && hit(r, hd)),
    box: r && `${Math.round(r.w)}×${Math.round(r.h)}`,
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }
}

/** A fingerprint of everything the option shows: its markup (with every inline style) and its canvases' pixels. */
function fingerprint(id) {
  const slot = document.querySelector(`[data-section-animation="${id}"]`)
  if (!slot) return ''
  let text = slot.innerHTML
  for (const c of slot.querySelectorAll('canvas')) text += c.width ? c.toDataURL() : ''
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return `${text.length}:${(h >>> 0).toString(16)}`
}

const isPreload404 = (m) => /Failed to load resource/.test(m.text()) && /\/_next\/static\/chunks\/src_sections_/.test(m.location()?.url ?? '')
const isPageNoise = (m) => /THREE\.Clock: This module has been deprecated/.test(m.text()) || /was preloaded using link preload but not used/.test(m.text())

async function open(browser, id, [w, h], reduced) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: w < 800, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  await context.addInitScript(instrument)
  const page = await context.newPage()
  const errors = []
  const framework = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return
    if (isPreload404(m)) framework.push(`404 for a chunk preload: ${m.location().url.split('/').pop()}`)
    else if (isPageNoise(m)) framework.push(/THREE/.test(m.text()) ? 'THREE.Clock deprecation (the WebGL hall)' : `preloaded but unused: ${(/\/([^/\s]+\.js)/.exec(m.text()) ?? [])[1] ?? 'a chunk'}`)
    else errors.push(`console ${m.type()}: ${m.text().slice(0, 300)}`)
  })
  await page.goto(`${BASE}/?section-animation=${id}`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  const range = await aboutRange(page)
  return { context, page, errors, framework, range }
}

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const frameworkNoise = new Set()

for (const id of IDS) {
  const dir = path.join(OUT, id.replace(/^about\./, ''))
  fs.mkdirSync(dir, { recursive: true })
  console.log(`\n${id}`)

  for (const size of SIZES) {
    const [w, h] = size
    const { context, page, errors, framework, range } = await open(browser, id, size, false)
    if (!check(range, `${id} ${w}×${h}: the About chapter is on the page`)) {
      await context.close()
      continue
    }
    for (const t of AT) {
      await scrollTo(page, range, t)
      await page.waitForTimeout(1300)
      const r = await page.evaluate(boxReport, id)
      const where = `${id} ${w}×${h} at ${t}`
      check(r.mounted, `${where}: the option is mounted`)
      check(r.fills, `${where}: the option fills its slot`)
      check(r.clips, `${where}: the option clips what it draws to its box`)
      check(!r.intersects, `${where}: the box (${r.box}) stays clear of the summary`)
      check(!r.overflow, `${where}: no horizontal overflow`)
      await page.screenshot({ path: path.join(dir, `${w}x${h}-${t}.png`) })
    }
    check(!errors.length, `${id} ${w}×${h}: no console errors or warnings${errors.length ? ` — ${errors.join(' | ')}` : ''}`)
    framework.forEach((u) => frameworkNoise.add(u))
    console.log(`  ${w}×${h} done`)
    await context.close()
  }

  /* Reduced motion: one still, composed state wherever the chapter is. */
  for (const size of REDUCED_SIZES) {
    const [w, h] = size
    const { context, page, errors, range } = await open(browser, id, size, true)
    const prints = []
    for (const t of AT) {
      await scrollTo(page, range, t)
      await page.waitForTimeout(1000)
      prints.push(await page.evaluate(fingerprint, id))
      await page.screenshot({ path: path.join(dir, `${w}x${h}-reduced-${t}.png`) })
    }
    check(prints[0] && prints.every((p) => p === prints[0]), `${id} ${w}×${h} reduced motion: one still state at every scroll position`)
    check(!errors.length, `${id} ${w}×${h} reduced motion: no console errors or warnings${errors.length ? ` — ${errors.join(' | ')}` : ''}`)
    await context.close()
  }

  /* Idle: on screen it works per frame; far away it does nothing at all. */
  {
    const { context, page, range } = await open(browser, id, [1440, 900], false)
    await scrollTo(page, range, 0.4)
    await page.waitForTimeout(1200)
    // Scrolled a little during the window: an option may rightly skip frames in which nothing moves.
    const busy = await page.evaluate(async () => {
      const q = window.__aboutQa
      q.mutations = 0
      q.draws = 0
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, 24)
        await new Promise((r) => setTimeout(r, 200))
      }
      return q.mutations + q.draws
    })
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(1500)
    const idle = await page.evaluate(async () => {
      const q = window.__aboutQa
      q.mutations = 0
      q.draws = 0
      await new Promise((r) => setTimeout(r, 1000))
      return { mutations: q.mutations, draws: q.draws, mounted: !!document.querySelector('[data-section-animation] > *') }
    })
    check(busy > 0, `${id}: works per frame while on screen (${busy} writes in 1 s)`)
    check(idle.mounted, `${id}: stays mounted when scrolled away`)
    check(idle.mutations === 0 && idle.draws === 0, `${id}: no per-frame work when far off-screen (${idle.mutations} writes, ${idle.draws} draws in 1 s)`)
    await context.close()
  }
}

await browser.close()
const failed = results.filter((r) => !r.ok)
if (frameworkNoise.size) console.log(`\nnote: page messages that are not the options' (framework preloads, the WebGL hall):\n  ${[...frameworkNoise].join('\n  ')}`)
console.log(`\n${results.length - failed.length}/${results.length} checks passed; screenshots in ${OUT}`)
if (failed.length) process.exitCode = 1
