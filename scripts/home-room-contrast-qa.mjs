/**
 * Home room: rendered-contrast audit.
 *   node scripts/home-room-contrast-qa.mjs [baseUrl] [viewport,...]
 *
 * Walks every chapter of the home journey by real scrolling (so the
 * room's growth is whatever that scroll position produces), and for
 * every visible line of text measures the contrast between its
 * colour and the pixels actually rendered behind it — the room, its
 * plants, any canvas content — not a token pair on paper.
 *
 * Method: the page is captured with all text made transparent but
 * the layout untouched; each text box's background is the darkest
 * tenth of the pixels inside it (dark type on a light room, so the
 * darkest background is the worst case). WCAG thresholds: 4.5:1, or
 * 3:1 for large type (>= 24px, or >= 18.66px at weight >= 600).
 * Text at less than 90% effective opacity is reported separately
 * (mid-reveal or deliberately faded) and does not fail the run.
 *
 * CHAPTERS=toolbox,contact limits the run to those chapters.
 * REDUCED_MOTION=1 audits the reduced-motion page instead: the room
 * holds one settled state whatever the scroll, so every chapter is
 * read over that same state.
 *
 * Needs a running server (default http://localhost:3000).
 * Writes .qa/home-room/contrast/{report.json, *.png}.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = path.resolve(process.env.CONTRAST_QA_OUT ?? '.qa/home-room/contrast')
const ALL = [
  { name: '360x800', width: 360, height: 800, mobile: true },
  { name: '390x844', width: 390, height: 844, mobile: true },
  { name: '768x1024', width: 768, height: 1024, mobile: true },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '2560x1440', width: 2560, height: 1440 },
  { name: '844x390', width: 844, height: 390, mobile: true },
]
const ONLY = process.argv[3]?.split(',')
const VIEWPORTS = ONLY ? ALL.filter((v) => ONLY.includes(v.name)) : ALL
const SAMPLES = (process.env.SAMPLES ?? '0.15,0.5,0.85').split(',').map(Number)
/* The contact chapter ends in the portal, but nothing grows over the
   page until the reader PUSHES past the foot (a wheel or a touch; a
   programmatic scroll never charges it), so the resting foot itself —
   readout and all — is audited too. */
const CAP = {}
const EXTRA = { contact: [1] }

const lum = ([r, g, b]) => {
  const c = (v) => {
    v /= 255
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * c(r) + 0.7152 * c(g) + 0.0722 * c(b)
}
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
const browser = await chromium.launch({ args: ['--use-angle=metal', '--ignore-gpu-blocklist'] })
const report = { base: BASE, reducedMotion: !!process.env.REDUCED_MOTION, viewports: [] }
let failures = 0

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    isMobile: !!vp.mobile,
    hasTouch: !!vp.mobile,
    reducedMotion: process.env.REDUCED_MOTION ? 'reduce' : 'no-preference',
  })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  await page.goto(`${BASE}/?room-still`, { waitUntil: 'load', timeout: 90000 })
  // The development server's own badge is not part of the page.
  await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
  await page.waitForFunction(() => { const s = window.__room?.(); return s && s.cache && s.cache.done >= s.cache.total && s.cache.total > 0 }, null, { timeout: 60000 })
  await page.waitForTimeout(1500)
  const only = process.env.CHAPTERS?.split(',')
  const chapters = (await page.evaluate(() => [...document.querySelectorAll('#journey section[data-chapter]')].map((s) => s.dataset.chapter)))
    .filter((id) => !only || only.includes(id))
  const vpReport = { name: vp.name, samples: [] }
  for (const id of chapters) {
    for (const t0 of [...SAMPLES, ...(EXTRA[id] ?? [])]) {
      const t = Math.min(t0, CAP[id] ?? 1)
      await page.evaluate(([cid, tt]) => {
        const el = document.getElementById(`chapter-${cid}`)
        const top = el.getBoundingClientRect().top + scrollY
        const travel = Math.max(0, el.offsetHeight - innerHeight)
        window.scrollTo({ top: Math.round(top + travel * tt), behavior: 'instant' })
      }, [id, t])
      // Lenis smooths and the room follows with damping: let both land.
      await page.waitForTimeout(1600)
      const boxes = await page.evaluate((cid) => {
        const out = []
        const opacityOf = (el) => {
          let o = 1
          for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
            const cs = getComputedStyle(n)
            if (cs.visibility === 'hidden' || cs.display === 'none') return 0
            // Visually-hidden patterns (clip-path inset 50%, rect(0 0 0 0)).
            if (/inset\(50%/.test(cs.clipPath) || /rect\(0(px)?,? 0(px)?,? 0(px)?,? 0(px)?\)/.test(cs.clip)) return 0
            o *= Number(cs.opacity)
          }
          return o
        }
        const roots = [document.getElementById(`chapter-${cid}`), document.querySelector('[data-hud]')].filter(Boolean)
        const range = document.createRange()
        // Any CSS colour (oklab, color-mix, color()) to 8-bit sRGB + alpha.
        const cv = document.createElement('canvas')
        cv.width = cv.height = 1
        const cx = cv.getContext('2d', { willReadFrequently: true })
        const toRgba = (css) => {
          cx.clearRect(0, 0, 1, 1)
          cx.fillStyle = '#000'
          cx.fillStyle = css
          cx.fillRect(0, 0, 1, 1)
          const d = cx.getImageData(0, 0, 1, 1).data
          return [d[0], d[1], d[2], d[3] / 255]
        }
        for (const root of roots) {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
          let n
          while ((n = walker.nextNode())) {
            const txt = n.textContent.trim()
            if (!txt) continue
            const el = n.parentElement
            if (!el || el.closest('.sr-only, [data-open="false"]')) continue
            const op = opacityOf(el)
            if (op < 0.05) continue
            // Text on a ground of its own (a tile's plate, a button's
            // fill) does not sit on the room at all.
            let plated = false
            for (let q = el; q && q !== root; q = q.parentElement) {
              const qs = getComputedStyle(q)
              const bg = toRgba(qs.backgroundColor)
              if (bg[3] > 0.6 || qs.backgroundImage !== 'none') { plated = true; break }
            }
            const cs = getComputedStyle(el)
            const m = toRgba(cs.color)
            const alpha = m[3]
            range.selectNodeContents(n)
            for (const r of range.getClientRects()) {
              if (r.width < 3 || r.height < 3) continue
              if (r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth) continue
              out.push({
                x: Math.max(0, r.left), y: Math.max(0, r.top),
                w: Math.min(innerWidth, r.right) - Math.max(0, r.left),
                h: Math.min(innerHeight, r.bottom) - Math.max(0, r.top),
                px: parseFloat(cs.fontSize), weight: Number(cs.fontWeight) || 400,
                rgb: m.slice(0, 3), alpha, opacity: op, plated, txt: txt.slice(0, 32), hud: root.hasAttribute('data-hud'),
              })
            }
          }
        }
        return out
      }, id)
      // Background only: same layout, transparent type.
      // Transitions off first: several labels animate their colour,
      // and a capture mid-fade would sample the glyphs themselves.
      // Hairline borders are the control's own chrome, not the room.
      // The journey's own WebGL layer (the project graph, the contact
      // scene) is part of the portfolio's design, not the room: it is
      // hidden for this capture so the audit measures the room itself.
      const style = await page.addStyleTag({ content: '[class*="GlobalCanvas-module"]{visibility:hidden!important}*{transition:none!important;border-color:transparent!important;outline-color:transparent!important;color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;-webkit-text-stroke:0!important;caret-color:transparent!important}' })
      await page.waitForTimeout(120)
      const shot = await page.screenshot()
      await style.evaluate((s) => s.remove())
      const img = sharp(shot)
      const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
      const results = []
      for (const b of boxes) {
        const x0 = Math.floor(b.x)
        const y0 = Math.floor(b.y)
        const x1 = Math.min(info.width - 1, Math.ceil(b.x + b.w))
        const y1 = Math.min(info.height - 1, Math.ceil(b.y + b.h))
        const ls = []
        for (let y = y0; y <= y1; y++) {
          for (let x = x0; x <= x1; x++) {
            const k = (y * info.width + x) * info.channels
            ls.push(lum([data[k], data[k + 1], data[k + 2]]))
          }
        }
        if (!ls.length) continue
        ls.sort((a, c) => a - c)
        const p10 = ls[Math.floor(ls.length * 0.1)]
        const p50 = ls[Math.floor(ls.length * 0.5)]
        const p90 = ls[Math.floor(ls.length * 0.9)]
        // A translucent colour is what it looks like over this ground.
        const a = b.alpha
        const tl = a >= 0.999 ? lum(b.rgb) : a * lum(b.rgb) + (1 - a) * p50
        // Dark type is judged against the darkest tenth behind it,
        // light type against the lightest tenth.
        const bg = tl < p90 ? p10 : p90
        const c = ratio(tl, bg)
        const large = b.px >= 24 || (b.px >= 18.66 && b.weight >= 600)
        const need = large ? 3 : 4.5
        // Element opacity below 0.9 is a reveal in progress or a
        // deliberately dimmed state, not the resting design.
        const faded = b.opacity < 0.9
        results.push({ ...b, contrast: +c.toFixed(2), need, faded, pass: c >= need })
      }
      const fails = results.filter((r) => !r.pass && !r.faded && !r.plated)
      const platedFails = results.filter((r) => !r.pass && !r.faded && r.plated)
      failures += fails.length
      const tag = `${vp.name}_${id}_${Math.round(t * 100)}`
      if (fails.length) {
        // Annotate the failing boxes on the real page.
        const real = await page.screenshot()
        const svg = `<svg width="${info.width}" height="${info.height}" xmlns="http://www.w3.org/2000/svg">${fails.map((f) => `<rect x="${f.x}" y="${f.y}" width="${f.w}" height="${f.h}" fill="none" stroke="#ff00aa" stroke-width="2"/>`).join('')}</svg>`
        await sharp(real).composite([{ input: Buffer.from(svg) }]).png().toFile(path.join(OUT, `${tag}_FAIL.png`))
      }
      const judged = results.filter((r) => !r.faded && !r.plated)
      const min = judged.reduce((m, r) => Math.min(m, r.contrast / r.need), Infinity)
      const worst = judged.find((r) => r.contrast / r.need === min)
      const growth = await page.evaluate(() => window.__room?.()?.growth)
      vpReport.samples.push({
        chapter: id, t, growth, boxes: results.length,
        fails: fails.map(({ txt, contrast, need, px, hud }) => ({ txt, contrast, need, px, hud })),
        platedFails: platedFails.map(({ txt, contrast, need, px }) => ({ txt, contrast, need, px })),
        worstMargin: +min.toFixed(2), faded: results.filter((r) => r.faded).length,
        worst: worst ? { txt: worst.txt, contrast: worst.contrast, need: worst.need, px: worst.px, x: Math.round(worst.x), y: Math.round(worst.y) } : null,
      })
      console.log(`${vp.name.padEnd(10)} ${id.padEnd(10)} t=${t} g=${growth?.toFixed(2)} boxes=${results.length} fails=${fails.length} worst=${min.toFixed(2)}x`)
    }
  }
  vpReport.errors = errors
  report.viewports.push(vpReport)
  await ctx.close()
}
await browser.close()
report.failures = failures
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))
console.log(`\n${failures} failing text boxes. Report: ${path.relative(process.cwd(), OUT)}/report.json`)
process.exit(failures ? 1 : 0)
