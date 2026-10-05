/* Screenshots of every chapter of a journey at the widths the site has
   to compose for, plus an overflow check at each.

     node scripts/qa/responsive-shots.mjs [--base URL] [--path /] [--widths 320,390,768]
       [--engine chromium|firefox|webkit] [--at 0.5] [--landscape]
       [--storage state.json] [--cut] [--overlap]

   For each width the page is loaded once, then each chapter is
   scrolled to `--at` of its length (default: the middle, where its
   stage is pinned) and captured. Reported per width:

     overflow   the document is wider than the viewport (a horizontal
                scrollbar), with the widest offending elements
     clipped    text boxes that leave the viewport horizontally (text in
                a row that deliberately scrolls sideways is not counted)
     cut        with --cut: visible text partly hidden by a box that clips
                its overflow (a pinned stage too short for its words)
     overlap    with --overlap: lines of text that run into other text,
                the HUD's labels included (`data-over-copy` marks a layer
                drawn over the copy on purpose)
     travels    the stage's words are taller than the screen and travel
                through it (stageFit.ts): checked at both ends of the
                travel, first line clear of the HUD's header, last line
                clear of its footer

   --storage loads a Playwright storage state, e.g. a signed-in
   administrator with Draft Mode on, to check a draft (long-text.mjs).
   QA_INJECT_CSS adds a stylesheet after load: a negative control that
   undoes a fix should make the check fail.
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
const STORAGE = opt('storage', null)
const CUT = Boolean(opt('cut', false))
const OVERLAP = Boolean(opt('overlap', false))
const HEIGHT_FOR = (w) => (LANDSCAPE ? Math.round(w * 0.46) : w <= 420 ? Math.round(w * 2.16) : w <= 800 ? 1024 : w <= 1100 ? 768 : w <= 1500 ? 900 : w <= 2000 ? 1080 : 1440)
const OUT = opt('out', process.env.QA_OUT ?? path.resolve('.qa/responsive'))
fs.mkdirSync(OUT, { recursive: true })

const engines = { chromium, firefox, webkit }
const launchArgs = ENGINE === 'chromium' ? { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] } : {}
const browser = await engines[ENGINE].launch({ headless: true, ...launchArgs })
let problems = 0

for (const w of WIDTHS) {
  const h = HEIGHT_FOR(w)
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: w < 800, isMobile: ENGINE === 'chromium' && w < 800, ...(STORAGE ? { storageState: STORAGE } : {}) })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await page.goto(`${BASE}${PAGE}`, { waitUntil: 'load' })
  // A negative control: undo a fix with a stylesheet and see the check fail.
  if (process.env.QA_INJECT_CSS) await page.addStyleTag({ content: process.env.QA_INJECT_CSS })
  await page.waitForTimeout(2500)
  const chapters = await page.evaluate(() => [...document.querySelectorAll('section[data-chapter]')].map((s) => ({ id: s.dataset.chapter, top: s.offsetTop, h: s.offsetHeight })))
  const list = chapters.length ? chapters : [{ id: 'page', top: 0, h: 0 }]
  for (const c of list) {
    await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, c.top + (c.h - h) * AT))
    await page.waitForTimeout(1400)
    const file = path.join(OUT, `${PAGE.replace(/\W+/g, '_') || 'home'}-${ENGINE}-${w}x${h}-${c.id}.png`)
    await page.screenshot({ path: file })
    const report = await page.evaluate(([CUT, OVERLAP]) => {
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
      const cut = []
      const walker = document.createTreeWalker(document.querySelector('main') ?? document.body, NodeFilter.SHOW_TEXT)
      const range = document.createRange()
      let n
      while ((n = walker.nextNode())) {
        if (!n.textContent.trim()) continue
        const el = n.parentElement
        if (!el || el.closest('[aria-hidden="true"], .sr-only')) continue
        const cs = getComputedStyle(el)
        if (cs.visibility === 'hidden') continue
        // Seen at all? Text under a faded-out box (a label waiting its turn, a closed sheet) is not on screen.
        let seen = true
        for (let a = el; a && a !== document.body; a = a.parentElement) if (Number(getComputedStyle(a).opacity) < 0.05) { seen = false; break }
        if (!seen) continue
        // A row that scrolls sideways on purpose (the filter chips on a phone) is not clipping.
        let scroller = el.parentElement
        while (scroller && !['auto', 'scroll'].includes(getComputedStyle(scroller).overflowX)) scroller = scroller.parentElement
        if (scroller && scroller !== document.documentElement && scroller !== document.body) continue
        range.selectNodeContents(n)
        for (const r of range.getClientRects()) {
          if (r.width === 0 || r.bottom < 0 || r.top > innerHeight) continue
          if (r.left < -1 || r.right > vw + 1) clipped.push(`${n.textContent.trim().slice(0, 30)} [${Math.round(r.left)}..${Math.round(r.right)}]`)
          // A stage whose words travel through the window (stageFit.ts) is read
          // like a scrolled page: its ends are checked at the ends of its travel.
          if (CUT && cut.length < 6 && !el.closest('[data-stage-travel]')) {
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
              const s = getComputedStyle(a)
              if (![s.overflowX, s.overflowY].some((o) => o === 'hidden' || o === 'clip')) continue
              const b = a.getBoundingClientRect()
              const partly = (r.top < b.top - 1 && r.bottom > b.top + 1) || (r.bottom > b.bottom + 1 && r.top < b.bottom - 1) || (r.left < b.left - 1 && r.right > b.left + 1) || (r.right > b.right + 1 && r.left < b.right - 1)
              if (partly) { cut.push(`${n.textContent.trim().slice(0, 30)} [${Math.round(r.top)}..${Math.round(r.bottom)} in ${a.tagName.toLowerCase()}.${String(a.className).slice(0, 30)} ${Math.round(b.top)}..${Math.round(b.bottom)}]`); break }
            }
          }
        }
        if (clipped.length > 5) break
      }
      // Text running into other text: every visible line of the page and
      // the HUD, compared pairwise (different elements, neither inside
      // the other). Words travelling under the HUD are veiled, not crossed.
      const overlaps = []
      if (OVERLAP) {
        const lines = []
        const visible = (el) => {
          if (el.closest('.sr-only')) return false
          for (let a = el; a && a !== document.body; a = a.parentElement) {
            const s = getComputedStyle(a)
            if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.05) return false
          }
          return true
        }
        // What of a line is really painted: cut by every box that clips it
        // (an ellipsis, a visually hidden label), and only its ink band —
        // a line box of display type carries air above and below the glyphs.
        const clipBoxes = new Map()
        const clipsOf = (el) => {
          if (clipBoxes.has(el)) return clipBoxes.get(el)
          const out = []
          for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
            const s = getComputedStyle(a)
            if ([s.overflowX, s.overflowY].some((o) => o !== 'visible') || s.clipPath !== 'none') out.push(a.getBoundingClientRect())
          }
          clipBoxes.set(el, out)
          return out
        }
        const BLOCK = 'h1, h2, h3, h4, h5, h6, p, li, dt, dd, a, button, label, figcaption, blockquote'
        for (const root of [document.querySelector('main') ?? document.body, document.querySelector('[data-hud]')]) {
          if (!root) continue
          const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let t
          while ((t = w.nextNode())) {
            if (!t.textContent.trim() || !t.parentElement || !visible(t.parentElement)) continue
            // Marked as drawn over the copy on purpose (collaborators' cursors over code).
            if (t.parentElement.closest('[data-over-copy]')) continue
            range.selectNodeContents(t)
            for (const r of range.getClientRects()) {
              let l = r.left, rt = r.right, tp = r.top + r.height * 0.18, bt = r.bottom - r.height * 0.18
              for (const c of clipsOf(t.parentElement)) { l = Math.max(l, c.left); rt = Math.min(rt, c.right); tp = Math.max(tp, c.top); bt = Math.min(bt, c.bottom) }
              if (rt - l > 1 && bt - tp > 1 && bt > 0 && tp < innerHeight) lines.push({ l, r: rt, t: tp, b: bt, el: t.parentElement, block: t.parentElement.closest(BLOCK), text: t.textContent.trim().slice(0, 24), hud: !!t.parentElement.closest('[data-hud]'), travels: !!t.parentElement.closest('[data-stage-travel]') })
            }
          }
        }
        for (let i = 0; i < lines.length && overlaps.length < 6; i++) {
          for (let j = i + 1; j < lines.length && overlaps.length < 6; j++) {
            const a = lines[i], b = lines[j]
            if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue
            // The lines of one heading or paragraph are one block of text.
            if (a.block && a.block === b.block) continue
            if ((a.hud && b.travels) || (b.hud && a.travels)) continue
            const x = Math.min(a.r, b.r) - Math.max(a.l, b.l)
            const y = Math.min(a.b, b.b) - Math.max(a.t, b.t)
            if (x <= 0 || y <= 0) continue
            const small = Math.min((a.r - a.l) * (a.b - a.t), (b.r - b.l) * (b.b - b.t))
            if (x * y > Math.max(16, small * 0.1)) overlaps.push(`'${a.text}' × '${b.text}'`)
          }
        }
      }
      return { overflow, offenders, clipped, cut, overlaps }
    }, [CUT, OVERLAP])
    // Words taller than the screen travel through it: the first line must
    // stand clear of the HUD's header when the stage pins, the last clear
    // of its footer when it lets go.
    const travel = await page.evaluate((id) => document.querySelector(`section[data-chapter="${id}"]`)?.firstElementChild?.firstElementChild?.dataset.stageTravel ?? null, c.id)
    const ends = []
    if (travel) {
      for (const [at, edge] of [[0.02, 'top'], [0.98, 'bottom']]) {
        await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, c.top + (c.h - h) * at))
        await page.waitForTimeout(900)
        await page.screenshot({ path: file.replace(/\.png$/, `-${edge}.png`) })
        const e = await page.evaluate(([id, edge]) => {
          const root = document.querySelector(`section[data-chapter="${id}"]`).firstElementChild.firstElementChild
          // The HUD's words, not its padded boxes.
          const extent = (sel) => {
            let lo = Infinity, hi = -Infinity
            for (const el of document.querySelectorAll(`${sel} a, ${sel} button, ${sel} span, ${sel} p`)) { const r = el.getBoundingClientRect(); if (r.width >= 1 && r.height >= 1) { lo = Math.min(lo, r.top); hi = Math.max(hi, r.bottom) } }
            return Number.isFinite(lo) ? { top: lo, bottom: hi } : null
          }
          const h0 = extent('[data-hud] header'), f0 = extent('[data-hud] footer')
          const head = h0 && { bottom: h0.bottom }, foot = f0 && { top: f0.top }
          let lo = Infinity, hi = -Infinity
          const range = document.createRange()
          for (const child of root.children) {
            const cs = getComputedStyle(child)
            if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue
            const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT)
            let n
            while ((n = walker.nextNode())) {
              if (!n.textContent.trim() || n.parentElement.closest('.sr-only, [aria-hidden="true"]')) continue
              range.selectNodeContents(n)
              for (const r of range.getClientRects()) { if (r.width) { lo = Math.min(lo, r.top); hi = Math.max(hi, r.bottom) } }
            }
          }
          return edge === 'top' ? (head && lo < head.bottom - 1 ? `first line at ${Math.round(lo)} under the header (${Math.round(head.bottom)})` : null)
            : (foot && hi > foot.top + 1 ? `last line at ${Math.round(hi)} under the footer (${Math.round(foot.top)})` : null)
        }, [c.id, edge])
        if (e) ends.push(e)
      }
    }
    const bad = report.overflow || report.clipped.length || report.cut.length || report.overlaps.length || ends.length
    if (bad) problems++
    console.log(`${bad ? 'WARN' : 'ok  '} ${w}×${h} ${c.id}${travel ? `  (travels ${travel.split(' ')[0]})` : ''}${report.overflow ? `  overflow: ${report.offenders.join(', ')}` : ''}${report.clipped.length ? `  clipped: ${report.clipped.join(' | ')}` : ''}${report.cut.length ? `  cut: ${report.cut.join(' | ')}` : ''}${report.overlaps.length ? `  overlap: ${report.overlaps.join(' | ')}` : ''}${ends.length ? `  ends: ${ends.join(' | ')}` : ''}`)
  }
  if (errors.length) console.log(`  page errors at ${w}: ${errors.join(' | ')}`)
  await context.close()
}
await browser.close()
console.log(`${problems} capture(s) with problems; screenshots in ${OUT}`)
if (problems) process.exitCode = 1
