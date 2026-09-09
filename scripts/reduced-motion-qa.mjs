/**
 * Reduced-motion sweep.
 *   node scripts/reduced-motion-qa.mjs [baseUrl] [chapterId,chapterId,…]
 *
 * The journey reveals itself from a requestAnimationFrame loop that
 * deliberately does not run when the visitor asks for reduced motion.
 * Every chapter therefore needs a static state that stands on its own,
 * and this checks that it has one: nothing invisible, nothing pushed
 * out of the pinned stage, nothing left mid-transform.
 *
 * A chapter passes when every piece of text it means to show is
 * legible without a single frame of animation.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const ONLY = process.argv[3] ? process.argv[3].split(',').map((s) => s.trim()) : null
/* Overridable so several sweeps can run side by side without
   deleting each other's screenshots. */
const OUT = path.resolve(process.env.RM_QA_OUT ?? '.cache/reduced-motion-qa')

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
]

/* Some things are invisible on purpose, in every motion mode: a drawer
   the visitor has not opened, a label that belongs to a pointer that is
   not there. They are named here rather than inferred, so that a
   genuinely broken element can never hide behind a clever heuristic. */
const DELIBERATELY_HIDDEN = [
  'Universe-module__.*__list',      // the archive drawer, behind "Open as list"
  'Universe-module__.*__label',     // hover label for a node under the pointer
  'Toolbox-module__.*__evidence',   // evidence readout, until a technology is picked
  'Teaching-module__.*__cursors',   // pointer trails, drawn only while pointing
  'WorldPortal-module__.*__',       // the portal sheet, until it is charged
]
const hiddenRe = new RegExp(DELIBERATELY_HIDDEN.join('|'))

const probe = ({ chapter, allow }) => {
  const sec = document.getElementById('chapter-' + chapter)
  const stage = sec.querySelector(':scope > div')
  const sr = stage.getBoundingClientRect()
  const allowRe = new RegExp(allow)
  const short = (el) =>
    (typeof el.className === 'string' ? el.className : '')
      .split(/\s+/).filter(Boolean)
      .map((c) => c.replace(/^[A-Za-z]+-module__[^_]+__/, ''))
      .join('.') || el.tagName.toLowerCase()

  const effOpacity = (el) => {
    let o = 1, e = el
    while (e && e !== document.documentElement) { o *= parseFloat(getComputedStyle(e).opacity); e = e.parentElement }
    return o
  }
  const deliberate = (el) => {
    let e = el
    while (e && e !== sec) {
      const cn = typeof e.className === 'string' ? e.className : ''
      if (allowRe.test(cn)) return true
      e = e.parentElement
    }
    return false
  }

  const invisible = [], clipped = []
  for (const el of sec.querySelectorAll('*')) {
    if (el.children.length) continue
    const text = el.textContent.trim()
    if (!text) continue
    if (el.closest('.sr-only')) continue
    if (deliberate(el)) continue
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none') continue

    const o = effOpacity(el)
    if (o < 0.05) { invisible.push({ cls: short(el), o: +o.toFixed(3), text: text.slice(0, 40) }); continue }

    const b = el.getBoundingClientRect()
    if (!b.width || !b.height) continue
    // The stage is pinned at 100svh and clips, so anything outside it
    // is unreachable rather than merely off-screen — unless it sits in
    // something the visitor can actually scroll, like the client-work
    // rail or the archive drawer, where off-screen is the whole point.
    let inScroller = false
    for (let e = el.parentElement; e && e !== sec; e = e.parentElement) {
      if (e.hasAttribute('data-scrolls')) { inScroller = true; break }
      const ov = getComputedStyle(e)
      if (/(auto|scroll)/.test(ov.overflowX + ' ' + ov.overflowY)) { inScroller = true; break }
    }
    if (inScroller) continue
    const out = Math.max(Math.round(b.bottom - sr.bottom), Math.round(sr.top - b.top), Math.round(b.right - sr.right), Math.round(sr.left - b.left))
    if (out > 8) clipped.push({ cls: short(el), out, text: text.slice(0, 40) })
  }
  return { invisible, clipped }
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const failures = []

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => failures.push(`${vp.name}: pageerror ${String(e).slice(0, 160)}`))
  await page.goto(BASE, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(2400)
  await mkdir(path.join(OUT, vp.name), { recursive: true })

  const ids = await page.evaluate(() =>
    [...document.querySelectorAll('section[data-chapter]')].map((s) => s.dataset.chapter))

  for (const id of ids) {
    if (ONLY && !ONLY.includes(id)) continue
    await page.evaluate((c) => {
      const el = document.getElementById('chapter-' + c)
      // Stop short of the true foot of the page: that arms the world
      // portal, and this sweep is not the visitor asking to leave.
      const max = document.documentElement.scrollHeight - window.innerHeight - 320
      const top = el.offsetTop + el.offsetHeight * 0.5 - window.innerHeight * 0.5
      window.scrollTo({ top: Math.max(0, Math.min(max, top)), behavior: 'instant' })
    }, id)
    await page.waitForTimeout(1000)

    const r = await page.evaluate(probe, { chapter: id, allow: hiddenRe.source })
    await page.screenshot({ path: path.join(OUT, vp.name, `${id}.png`), type: 'png' })

    const group = (rows, key) => {
      const m = new Map()
      for (const x of rows) {
        const cur = m.get(x.cls)
        if (!cur || cur[key] < x[key]) m.set(x.cls, { ...x, n: (cur?.n ?? 0) + 1 })
        else m.set(x.cls, { ...cur, n: cur.n + 1 })
      }
      return [...m.values()]
    }

    if (r.invisible.length) {
      for (const x of group(r.invisible, 'o')) {
        failures.push(`${vp.name} / ${id}: .${x.cls}${x.n > 1 ? ` ×${x.n}` : ''} is invisible (opacity ${x.o}) — "${x.text}"`)
      }
    }
    if (r.clipped.length) {
      for (const x of group(r.clipped, 'out')) {
        failures.push(`${vp.name} / ${id}: .${x.cls}${x.n > 1 ? ` ×${x.n}` : ''} sits ${x.out}px outside the pinned stage — "${x.text}"`)
      }
    }
    const mark = r.invisible.length || r.clipped.length ? 'FAIL' : 'ok  '
    console.log(`${mark} ${vp.name} / ${id}`)
  }
  await ctx.close()
}

await browser.close()

console.log(`\nScreenshots → ${path.relative(process.cwd(), OUT)}`)
if (failures.length) {
  console.log(`\n${failures.length} problem(s):\n` + failures.map((f) => '  ' + f).join('\n'))
  process.exit(1)
}
console.log('\nEvery chapter stands up without a frame of animation.')
