/**
 * Reduced-motion sweep.
 *   node scripts/reduced-motion-qa.mjs [baseUrl] [chapterId,chapterId,…]
 *   RM_QA_MOTION=no-preference node scripts/… — sweep the animated path
 *   RM_QA_OUT=.cache/somewhere  node scripts/… — write elsewhere
 *
 * The journey reveals itself from a requestAnimationFrame loop that
 * deliberately does not run when the visitor asks for reduced motion.
 * Every chapter therefore needs a static state that stands on its own,
 * and this checks that it has one: nothing invisible, nothing pushed
 * out of the pinned stage, nothing left mid-transform.
 *
 * A chapter passes when every piece of text it means to show is
 * legible without a single frame of animation: nothing invisible,
 * nothing clipped, and no two blocks printed on top of each other.
 * The last of those is the one an eye catches and an assertion
 * usually does not, so it is checked here rather than trusted.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const ONLY = process.argv[3] ? process.argv[3].split(',').map((s) => s.trim()) : null
/* Overridable so several sweeps can run side by side without
   deleting each other's screenshots. */
const OUT = path.resolve(process.env.RM_QA_OUT ?? '.cache/reduced-motion-qa')

const MOTION = process.env.RM_QA_MOTION === 'no-preference' ? 'no-preference' : 'reduce'

/* A short phone earns its place: the pinned stage is sized in viewport
   heights, so 667px of it is a different layout problem from 844px,
   and it is the size at which a composition that merely fits starts
   to spill. */
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '390x844', width: 390, height: 844 },
  { name: '375x667', width: 375, height: 667 },
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

  /* A block of text, allowing the <br>s the corner labels are built
     from — without that, every corner block looks like a container
     and is never compared with anything. */
  const isTextBlock = (el) => el.tagName !== 'BR' && [...el.children].every((c) => c.tagName === 'BR')
  /* section > pinned stage > content grid > the blocks themselves.
     Two spans inside one block are meant to sit together; two blocks
     are not. */
  const content = sec.firstElementChild?.firstElementChild ?? sec.firstElementChild
  const blockOf = (el) => { let e = el; while (e && e.parentElement && e.parentElement !== content) e = e.parentElement; return e }

  const invisible = [], clipped = [], painted = []
  for (const el of sec.querySelectorAll('*')) {
    if (!isTextBlock(el)) continue
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
    /* Anything that clips counts, not only the stage. The stage is the
       obvious one — pinned at 100svh with `overflow: clip`, so what
       leaves it is unreachable — but a container inside it can cut text
       just as finally: the client-work rail scrolls sideways and hides
       the overflow below, which is what sliced the captions off the
       gallery. A scroll container earns an exemption only on the axis it
       actually scrolls, because dragging sideways never brings back a
       line cut off at the foot. */
    let out = 0, culprit = ''
    let reachableX = false, reachableY = false
    for (let e = el.parentElement; e; e = e.parentElement) {
      const ov = getComputedStyle(e)
      const scrollsX = ov.overflowX === 'auto' || ov.overflowX === 'scroll' || e.hasAttribute('data-scrolls')
      const scrollsY = ov.overflowY === 'auto' || ov.overflowY === 'scroll' || e.hasAttribute('data-scrolls')
      const clipsX = !scrollsX && (ov.overflowX === 'hidden' || ov.overflowX === 'clip')
      const clipsY = !scrollsY && (ov.overflowY === 'hidden' || ov.overflowY === 'clip')
      if (clipsX || clipsY) {
        const cr = e.getBoundingClientRect()
        const dy = clipsY && !reachableY ? Math.max(Math.round(b.bottom - cr.bottom), Math.round(cr.top - b.top)) : 0
        const dx = clipsX && !reachableX ? Math.max(Math.round(b.right - cr.right), Math.round(cr.left - b.left)) : 0
        const d = Math.max(dx, dy)
        if (d > out) { out = d; culprit = short(e) }
      }
      // Once something outward of here scrolls on an axis, being outside
      // a clipper on that axis is a scroll away, not a loss.
      if (scrollsX) reachableX = true
      if (scrollsY) reachableY = true
      if (e === stage) break
    }
    if (out > 8) { clipped.push({ cls: short(el), out, by: culprit, text: text.slice(0, 40) }); continue }

    /* Line boxes, not the element box. A short heading inside a wide
       block reaches across the whole column on paper only in the
       layout engine's arithmetic — comparing element boxes reports
       every such heading as colliding with whatever sits beside it.
       The rectangles the glyphs actually occupy do not lie. */
    const rects = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(n)
      for (const r of range.getClientRects()) if (r.width > 1 && r.height > 1) rects.push(r)
    }
    if (rects.length) painted.push({ rects, cls: short(el), text: text.slice(0, 30), block: blockOf(el) })
  }

  const collided = []
  for (let i = 0; i < painted.length; i++) {
    for (let j = i + 1; j < painted.length; j++) {
      const a = painted[i], c = painted[j]
      if (a.block === c.block) continue
      let ox = 0, oy = 0
      for (const ra of a.rects) for (const rc of c.rects) {
        const x = Math.min(ra.right, rc.right) - Math.max(ra.left, rc.left)
        const y = Math.min(ra.bottom, rc.bottom) - Math.max(ra.top, rc.top)
        // Ignore the sliver where two lines merely share a leading edge.
        if (x > 4 && y > 4 && x * y > ox * oy) { ox = x; oy = y }
      }
      if (ox > 4 && oy > 4) collided.push({ a: a.cls, b: c.cls, ta: a.text, tb: c.text, ox: Math.round(ox), oy: Math.round(oy) })
    }
  }
  return { invisible, clipped, collided }
}

/* Collisions this sweep found on its first run, which predate it and
   belong to chapters nobody has been asked to touch. They are listed
   rather than fixed so that the check fails on anything NEW while the
   backlog stays in front of whoever runs it — every one is printed on
   every run. Each is real; none is a tolerance. Delete an entry the
   moment its chapter is fixed. */
const KNOWN = [
  { at: '1440x900 / ucl', a: '.span "2023"', b: '.span "IS STILL"',
    note: 'the 2023 timeline label sits behind the closing headline and cannot be read' },
  { at: '390x844 / ucl', a: '.span "2023"', b: '.span "THE SYSTEM"',
    note: 'same label, same cause, at phone width' },
  { at: '375x667 / ucl', a: '.span "2023"', b: '.span "THE SYSTEM"',
    note: 'same label, same cause, on a short phone' },
  { at: '1440x900 / ucl', a: '.timelineFuture', b: '.span "CS50"',
    note: 'the timeline\u2019s trailing question mark sits on the last credential' },
  { at: '390x844 / focus', a: '.corner.cornerBL', b: '.corner.cornerBR',
    note: 'chapters.module.css caps .cornerTR/.cornerBR at 42vw but not .cornerBL, so Focus\u2019s long pipeline label runs the full width and under the corner opposite it' },
  { at: '375x667 / focus', a: '.corner.cornerBL', b: '.corner.cornerBR',
    note: 'the same uncapped label, worse on a short phone' },
  { at: '375x667 / focus', a: '.layerNo', b: '.corner.cornerBL',
    note: 'the same uncapped label, running under the layer stack' },
  { at: '375x667 / focus', a: '.layerLabel', b: '.corner.cornerBL',
    note: 'the same uncapped label, running under the layer stack' },
  { at: '375x667 / teaching', a: '.testState', b: '.corner.cornerBR',
    note: 'the FAIL markers and the bottom-right corner label share a band on a short phone' },
]

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const failures = []

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    reducedMotion: MOTION,
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
        failures.push(`${vp.name} / ${id}: .${x.cls}${x.n > 1 ? ` ×${x.n}` : ''} is cut off by ${x.by ? '.' + x.by : 'the stage'} — ${x.out}px outside it — "${x.text}"`)
      }
    }
    if (r.collided.length) {
      const seen = new Set()
      for (const x of r.collided) {
        const k = x.a + '|' + x.b
        if (seen.has(k)) continue
        seen.add(k)
        failures.push(`${vp.name} / ${id}: .${x.a} "${x.ta}" is printed over .${x.b} "${x.tb}" (${x.ox}×${x.oy}px)`)
      }
    }
    const mark = r.invisible.length || r.clipped.length || r.collided.length ? 'FAIL' : 'ok  '
    console.log(`${mark} ${vp.name} / ${id}`)
  }
  await ctx.close()
}

await browser.close()

console.log(`\nprefers-reduced-motion: ${MOTION}`)
console.log(`Screenshots → ${path.relative(process.cwd(), OUT)}`)

const isKnown = (f) =>
  KNOWN.find((k) => f.startsWith(k.at + ':') && f.includes(k.a + ' is printed over ' + k.b))
const carried = failures.filter(isKnown)
const fresh = failures.filter((f) => !isKnown(f))

if (carried.length) {
  console.log(`\n${carried.length} known, already on the books:`)
  for (const f of carried) console.log(`  ${f}\n      ${isKnown(f).note}`)
}
if (fresh.length) {
  console.log(`\n${fresh.length} problem(s):\n` + fresh.map((f) => '  ' + f).join('\n'))
  process.exit(1)
}
console.log(MOTION === 'reduce'
  ? '\nEvery chapter stands up without a frame of animation.'
  : '\nEvery chapter holds together on the animated path too.')
