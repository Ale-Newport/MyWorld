/* Copy clearance: does anything a visual draws cross the copy, at any
   moment of a chapter's motion?

     node scripts/qa/copy-clearance.mjs [--base URL] [--path /projects]
       [--sizes 390x844,1440x900] [--ts 0.05,0.25,0.5,0.75,0.95]
       [--chapters metaview,chess] [--reduced] [--out DIR] [--shots]

   For each size, chapter and moment `t` (the chapter's own 0..1, as the
   scenes read it) the page is scrolled to that moment and captured four
   times: as it is; with the ink of every line of copy removed; with that
   ink and the WebGL canvas removed; and with that ink and every <canvas>
   removed. The differences between the last three are exactly what the
   visuals drew — the WebGL scenes and the 2D project graphics, apart —
   and any of it inside a line of copy is reported (`crossed`).

   The WebGL layer only counts on a chapter that lays out a region for its
   subject (`[data-scene-region]`): elsewhere it draws the ground the
   journey travels on, a faint ruling under everything by design. On a
   chapter that does, WebGL ink outside its visible region is reported as
   well (`escape`) — ink that could reach the copy at another size, or a
   subject drawn after its region has been laid away.

   Also reported, while the chapter's stage is pinned:
     hud      copy inside the HUD's top or bottom band
     cut      copy that leaves the viewport (not text in a row that
              scrolls sideways on purpose, like the gallery)
     text     two lines of copy printed through each other
     hud-ink  visuals drawing inside the HUD bands
     hud-box  an image, canvas or filled box of the stage reaching into them

   Text that belongs to a visual — the chips and readouts a project
   graphic lays over its own canvas, or anything inside an element marked
   `data-illustration` — is not copy for these checks, though copy printed
   through it still is. With --shots an annotated frame is written for
   every capture: visual ink tinted red, copy outlined (red where it is
   crossed), the HUD bands and scene regions outlined in blue.
*/
import { chromium } from 'playwright'
import sharp from 'sharp'
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
const PAGE = opt('path', '/projects')
const SIZES = String(opt('sizes', '390x844,1440x900')).split(',').map((s) => s.split('x').map(Number))
const TS = String(opt('ts', '0.05,0.25,0.5,0.75,0.95')).split(',').map(Number)
const ONLY = opt('chapters', '') ? String(opt('chapters', '')).split(',') : null
const REDUCED = Boolean(opt('reduced', false))
const SHOTS = Boolean(opt('shots', false))
const OUT = opt('out', path.resolve('.qa/clearance'))
fs.mkdirSync(OUT, { recursive: true })

/** A channel difference above this is a mark, not antialiasing. */
const INK = 34
/** How far WebGL ink may stray outside its region before it counts as an escape (px). */
const SLACK = 3

const HIDE_COPY = `
  main, main * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; }
  [class*="egetation"], [class*="Cursor-module"], nextjs-portal { visibility: hidden !important; }
`
const HIDE_GL = 'canvas[data-qa-gl] { visibility: hidden !important; }'
const HIDE_CANVAS = 'canvas { visibility: hidden !important; }'

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
let problems = 0
let captures = 0

const raw = async (png) => sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
function diff(a, b) {
  const n = a.info.width * a.info.height
  const m = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 3) {
    const d = Math.max(Math.abs(a.data[p] - b.data[p]), Math.abs(a.data[p + 1] - b.data[p + 1]), Math.abs(a.data[p + 2] - b.data[p + 2]))
    if (d > INK) m[i] = 1
  }
  return m
}

for (const [w, h] of SIZES) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 1,
    hasTouch: w < 800,
    isMobile: w < 800,
    reducedMotion: REDUCED ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'load' })
  await page.waitForTimeout(3000)

  const chapters = await page.evaluate(() => {
    const list = [...document.querySelectorAll('main section[data-chapter]')].map((s) => ({
      id: s.dataset.chapter,
      top: s.getBoundingClientRect().top + scrollY,
      h: s.offsetHeight,
    }))
    const total = list.reduce((a, c) => a + c.h, 0)
    return list.map((c) => ({ ...c, total }))
  })

  for (const c of chapters) {
    if (ONLY && !ONLY.includes(c.id)) continue
    for (const t of TS) {
      captures++
      await page.evaluate(({ c, t }) => {
        const max = document.documentElement.scrollHeight - innerHeight
        const p = (c.top + t * c.h) / c.total
        window.scrollTo(0, Math.round(p * max))
      }, { c, t })
      await page.waitForTimeout(1500)

      const report = await page.evaluate((id) => {
        const vw = document.documentElement.clientWidth
        const vh = innerHeight
        // The WebGL canvas is the one in a fixed host; mark it so it can be hidden alone.
        for (const cv of document.querySelectorAll('canvas')) {
          let fixed = false
          for (let e = cv.parentElement; e; e = e.parentElement) if (getComputedStyle(e).position === 'fixed') { fixed = true; break }
          if (fixed) cv.setAttribute('data-qa-gl', '')
        }
        const hud = document.querySelector('[data-hud]')
        const bands = hud && getComputedStyle(hud).opacity !== '0'
          ? [hud.querySelector(':scope > header'), hud.querySelector(':scope > footer')].filter(Boolean).map((e) => {
            const r = e.getBoundingClientRect()
            // The band is what the HUD actually prints, not the padding around it.
            let top = Infinity
            let bottom = -Infinity
            for (const k of e.querySelectorAll('*')) {
              const q = k.getBoundingClientRect()
              if (q.width < 1 || q.height < 1) continue
              top = Math.min(top, q.top)
              bottom = Math.max(bottom, q.bottom)
            }
            return { left: r.left, right: r.right, top: Number.isFinite(top) ? top : r.top, bottom: Number.isFinite(bottom) ? bottom : r.bottom }
          })
          : []

        const section = document.querySelector(`section[data-chapter="${id}"]`)
        const stage = section?.firstElementChild
        const pinned = stage ? Math.abs(stage.getBoundingClientRect().top) < 1.5 : false
        const regions = [...document.querySelectorAll('[data-scene-region]')].map((e) => {
          const r = e.getBoundingClientRect()
          return { id: e.getAttribute('data-scene-region'), left: r.left, top: r.top, right: r.right, bottom: r.bottom }
        }).filter((r) => r.right > r.left && r.bottom > r.top)
        // A chapter that lays out a region for a subject: its WebGL ink is
        // the subject's, and with the region gone there should be none.
        const ownRegion = !!section?.querySelector('[data-scene-region]')

        const opacityOf = (el) => {
          let o = 1
          for (let e = el; e && e !== document.body; e = e.parentElement) {
            const cs = getComputedStyle(e)
            if (cs.visibility === 'hidden' || cs.display === 'none') return 0
            o *= Number(cs.opacity)
            if (o < 0.01) return 0
          }
          return o
        }
        /* Text a project graphic lays over its own canvas is part of the
           graphic, and so is anything inside an element marked as an
           illustration (the code being edited in the teaching chapter). */
        const inVisual = (el) => {
          if (el.closest('[data-illustration]')) return true
          for (let e = el; e && e.tagName !== 'SECTION'; e = e.parentElement) {
            for (const k of e.children) if (k.tagName === 'CANVAS') return true
          }
          return false
        }
        /* What the boxes around a line actually let through: a note
           folded to max-height 0 is in the layout but prints nothing. */
        const clippers = (el) => {
          const out = []
          let scrolls = false
          for (let e = el; e && e !== document.body; e = e.parentElement) {
            const cs = getComputedStyle(e)
            if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') out.push(e.getBoundingClientRect())
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') scrolls = true
          }
          return { boxes: out, scrolls }
        }
        const BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, summary, button, a, figcaption, label, td, th'
        const owners = new Map()

        const texts = []
        const walker = document.createTreeWalker(document.querySelector('main'), NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        let n
        let block = 0
        while ((n = walker.nextNode())) {
          if (!n.textContent.trim()) continue
          const el = n.parentElement
          // A closed <details> keeps its list in the tree but prints none of it.
          if (!el || el.closest('.sr-only, details:not([open]) > :not(summary)')) continue
          const op = opacityOf(el)
          if (op < 0.2) continue
          range.selectNodeContents(n)
          /* Lines of one heading or paragraph may touch; only different
             blocks printed through each other are a problem. */
          const owner = el.closest(BLOCK) ?? el.parentElement ?? el
          if (!owners.has(owner)) owners.set(owner, ++block)
          const visual = inVisual(el)
          const { boxes, scrolls } = clippers(el)
          const fs = parseFloat(getComputedStyle(el).fontSize) || 12
          for (const q of range.getClientRects()) {
            let left = q.left
            let top = q.top
            let right = q.right
            let bottom = q.bottom
            for (const b of boxes) {
              left = Math.max(left, b.left)
              top = Math.max(top, b.top)
              right = Math.min(right, b.right)
              bottom = Math.min(bottom, b.bottom)
            }
            if (right - left < 2 || bottom - top < 2) continue
            if (bottom < 0 || top > vh || right < 0 || left > vw) continue
            const mid = (q.top + q.bottom) / 2
            texts.push({
              s: n.textContent.trim().slice(0, 28),
              left, top, right, bottom,
              // Where the glyphs are, not the line box: tight display
              // leading makes neighbouring line boxes overlap by design.
              inkTop: Math.max(top, mid - fs * 0.4), inkBottom: Math.min(bottom, mid + fs * 0.4),
              cutLeft: q.left, cutRight: q.right, cutTop: q.top, cutBottom: q.bottom,
              op: Math.round(op * 100) / 100,
              visual,
              scrolls,
              block: owners.get(owner),
            })
          }
        }
        /* Anything of the stage that prints a surface — an image, a canvas,
           a filled or ruled box — reaching into the HUD's bands. */
        const boxes = []
        if (pinned && section) {
          const alpha = (c) => {
            const m = /rgba?\(([^)]+)\)/.exec(c)
            if (!m) return c === 'transparent' ? 0 : 1
            const parts = m[1].split(/[ ,/]+/).filter(Boolean)
            return parts.length > 3 ? Number(parts[3]) : 1
          }
          for (const el of section.querySelectorAll('*')) {
            const cs = getComputedStyle(el)
            const media = /^(IMG|CANVAS|VIDEO|svg)$/.test(el.tagName)
            const filled = alpha(cs.backgroundColor) > 0.05 || (parseFloat(cs.borderTopWidth) > 0 && alpha(cs.borderTopColor) > 0.05) || (parseFloat(cs.borderBottomWidth) > 0 && alpha(cs.borderBottomColor) > 0.05)
            if (!media && !filled) continue
            if (opacityOf(el) < 0.2) continue
            const r = el.getBoundingClientRect()
            if (r.width < 2 || r.height < 2) continue
            // Clipped away by a scroller or a box it sits in?
            let { left, top, right, bottom } = r
            for (let e = el.parentElement; e && e !== section; e = e.parentElement) {
              const ps = getComputedStyle(e)
              if (ps.overflowX === 'visible' && ps.overflowY === 'visible') continue
              const q = e.getBoundingClientRect()
              left = Math.max(left, q.left); top = Math.max(top, q.top); right = Math.min(right, q.right); bottom = Math.min(bottom, q.bottom)
            }
            if (right - left < 2 || bottom - top < 2) continue
            for (const b of bands) {
              const ix = Math.min(right, b.right) - Math.max(left, b.left)
              const iy = Math.min(bottom, b.bottom) - Math.max(top, b.top)
              if (ix > 2 && iy > 2) boxes.push(`${el.tagName.toLowerCase()}.${String(el.className).replace(/^.*?__/, '').slice(0, 24)}`)
            }
          }
        }
        return { vw, vh, bands, pinned, texts, regions, ownRegion, boxes }
      }, c.id)

      const shotA = await page.screenshot()
      const s1 = await page.addStyleTag({ content: HIDE_COPY })
      await page.waitForTimeout(60)
      const shotB = await page.screenshot()
      const s2 = await page.addStyleTag({ content: HIDE_GL })
      await page.waitForTimeout(60)
      const shotD = await page.screenshot()
      const s3 = await page.addStyleTag({ content: HIDE_CANVAS })
      await page.waitForTimeout(60)
      const shotC = await page.screenshot()
      for (const s of [s1, s2, s3]) await s.evaluate((e) => e.remove())

      const B = await raw(shotB)
      const D = await raw(shotD)
      const C = await raw(shotC)
      const W = B.info.width
      const H = B.info.height
      const gl = diff(B, D)
      const dom = diff(D, C)
      const mask = new Uint8Array(W * H)
      for (let i = 0; i < mask.length; i++) mask[i] = dom[i] || (report.ownRegion && gl[i]) ? 1 : 0
      const count = (m, l, t2, r, b) => {
        let k = 0
        const x0 = Math.max(0, Math.floor(l)); const x1 = Math.min(W, Math.ceil(r))
        const y0 = Math.max(0, Math.floor(t2)); const y1 = Math.min(H, Math.ceil(b))
        for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) k += m[y * W + x]
        return k
      }

      const issues = []
      const crossed = new Set()
      for (const [i, r] of report.texts.entries()) {
        if (r.visual) continue
        const area = Math.max(1, (r.right - r.left) * (r.bottom - r.top))
        const k = count(mask, r.left - 1, r.top - 1, r.right + 1, r.bottom + 1)
        if (k >= Math.max(8, area * 0.006)) {
          issues.push(`crossed "${r.s}" (${k}px)`)
          crossed.add(i)
        }
      }
      if (report.ownRegion) {
        let escaped = 0
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            if (!gl[y * W + x]) continue
            const inside = report.regions.some((r) => x >= r.left - SLACK && x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK)
            if (!inside) escaped++
          }
        }
        if (escaped > 24) issues.push(`escape ${escaped}px`)
      }
      if (report.pinned) {
        for (const r of report.texts) {
          if (r.visual) continue
          for (const b of report.bands) {
            if (r.right > b.left && r.left < b.right && r.bottom > b.top + 1 && r.top < b.bottom - 1) issues.push(`hud "${r.s}"`)
          }
          if (!r.scrolls && (r.cutTop < -1 || r.cutBottom > report.vh + 1 || r.cutLeft < -1 || r.cutRight > report.vw + 1)) {
            issues.push(`cut "${r.s}" [${Math.round(r.cutLeft)},${Math.round(r.cutTop)}..${Math.round(r.cutRight)},${Math.round(r.cutBottom)}]`)
          }
        }
        for (let i = 0; i < report.texts.length; i++) {
          const a = report.texts[i]
          for (let j = i + 1; j < report.texts.length; j++) {
            const b = report.texts[j]
            if (a.block === b.block || (a.visual && b.visual)) continue
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left)
            const iy = Math.min(a.inkBottom, b.inkBottom) - Math.max(a.inkTop, b.inkTop)
            if (ix <= 1 || iy <= 1) continue
            const small = Math.min((a.right - a.left) * (a.inkBottom - a.inkTop), (b.right - b.left) * (b.inkBottom - b.inkTop))
            if (ix * iy > small * 0.15) issues.push(`text "${a.s}" × "${b.s}"`)
          }
        }
        for (const b of report.bands) {
          const k = count(mask, b.left, b.top, b.right, b.bottom)
          if (k > (b.right - b.left) * (b.bottom - b.top) * 0.01) issues.push(`hud-ink ${k}px`)
        }
        for (const b of report.boxes) issues.push(`hud-box ${b}`)
      }

      const unique = [...new Set(issues)]
      if (unique.length) problems++
      const tag = `${w}×${h} ${c.id} t=${t}`
      console.log(`${unique.length ? 'WARN' : 'ok  '} ${tag}${unique.length ? `  ${unique.slice(0, 8).join(' | ')}${unique.length > 8 ? ` (+${unique.length - 8})` : ''}` : ''}`)

      if (SHOTS) {
        const A = await sharp(shotA).removeAlpha().raw().toBuffer()
        for (let i = 0, p = 0; i < mask.length; i++, p += 3) {
          if (!mask[i]) continue
          A[p] = Math.min(255, A[p] * 0.5 + 128)
          A[p + 1] = A[p + 1] * 0.5
          A[p + 2] = A[p + 2] * 0.5
        }
        const box = (r, col) => {
          const x0 = Math.max(0, Math.round(r.left)); const x1 = Math.min(W - 1, Math.round(r.right))
          const y0 = Math.max(0, Math.round(r.top)); const y1 = Math.min(H - 1, Math.round(r.bottom))
          if (x1 < x0 || y1 < y0) return
          for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) { const p = (y * W + x) * 3; A[p] = col[0]; A[p + 1] = col[1]; A[p + 2] = col[2] }
          for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) { const p = (y * W + x) * 3; A[p] = col[0]; A[p + 1] = col[1]; A[p + 2] = col[2] }
        }
        report.texts.forEach((r, i) => { if (!r.visual) box(r, crossed.has(i) ? [230, 0, 0] : [0, 150, 90]) })
        for (const b of report.bands) box(b, [40, 90, 220])
        for (const r of report.regions) box(r, [120, 120, 255])
        const name = `${PAGE.replace(/\W+/g, '_') || 'home'}${REDUCED ? '-rm' : ''}-${w}x${h}-${c.id}-${String(Math.round(t * 100)).padStart(3, '0')}.png`
        await sharp(A, { raw: { width: W, height: H, channels: 3 } }).png().toFile(path.join(OUT, name))
      }
    }
  }
  if (errors.length) console.log(`  page errors at ${w}×${h}: ${errors.join(' | ')}`)
  await context.close()
}
await browser.close()
console.log(`${problems}/${captures} capture(s) with problems${SHOTS ? `; frames in ${OUT}` : ''}`)
if (problems) process.exitCode = 1
