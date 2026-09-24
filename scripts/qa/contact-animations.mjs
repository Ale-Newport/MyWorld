/* The five "End of journey" animations (src/sections/contact), at every
   size the stage has to compose for.

     node scripts/qa/contact-animations.mjs [--base URL] [--only botanical-gateway,ribbon-aperture]
       [--sizes 1440x900,390x844] [--extremes 1440x900,390x844] [--no-reduced] [--jobs 3] [--out DIR]

   For each option and size the page is loaded with
   `?section-animation=<id>&qa-safe`. The option then publishes its canvas
   and the safe rectangles it composed for on `window.__contactQA`, and
   switches off its last-resort guard, so what is sampled is the geometry
   itself. Checked:

     text safety   the canvas is read back inside every safe rectangle and
                   every pixel must be fully transparent — over 30 frames
                   across 2 s at progress 0.5, 0.9 and the foot of the page,
                   and a few frames at each step of a scroll sweep through
                   the growth (0.15 … 1);
     knobs         the same at intensity 0 and 1 (`&qa-intensity=`) for the
                   `--extremes` sizes, with speed at its 1.5 maximum;
     errors        no uncaught exception and no console error (the dev
                   server 404s a few `src_sections_*` chunks it lists in the
                   HTML before compiling them — that is reported apart, it
                   happens with every option and without any);
     overflow      the document is never wider than the viewport;
     screenshots   at progress 0.5, 0.9 and the foot, and once under
                   reduced motion, in .qa/contact.

   Scroll positions are found from the chapter's own progress (read back
   from the option), not from the section's offset. */
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
const list = (v) => String(v).split(',').filter(Boolean)
const BASE = opt('base', process.env.QA_BASE ?? 'http://localhost:3403')
const OUT = opt('out', process.env.QA_OUT ?? path.resolve('.qa/contact'))
const IDS = list(opt('only', 'botanical-gateway,converging-paths,stepping-path,contour-horizon,ribbon-aperture')).map((s) => (s.startsWith('contact.') ? s : `contact.${s}`))
const SIZES = list(opt('sizes', '1440x900,1024x768,768x1024,390x844,320x640,2560x1440,3440x1440,844x390')).map((s) => s.split('x').map(Number))
const EXTREMES = list(opt('extremes', '1440x900,390x844')).map((s) => s.split('x').map(Number))
const REDUCED = !args.includes('--no-reduced')
const JOBS = Number(opt('jobs', 3))
fs.mkdirSync(OUT, { recursive: true })

const DEV_404 = /Failed to load resource: the server responded with a status of 404/
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Samples the canvas inside every safe rectangle for `frames` frames across `ms`. */
async function sample(page, frames, ms) {
  return page.evaluate(async ({ frames, ms }) => {
    const q = window.__contactQA
    if (!q) return { missing: true }
    const c = q.canvas
    const ctx = c.getContext('2d')
    const sx = c.width / q.w, sy = c.height / q.h
    let bad = 0, worst = null, ink = 0
    for (let f = 0; f < frames; f++) {
      await new Promise((r) => setTimeout(r, ms / frames))
      await new Promise((r) => requestAnimationFrame(() => r()))
      for (const r of q.safe) {
        const x0 = Math.max(0, Math.floor(r.x * sx)), y0 = Math.max(0, Math.floor(r.y * sy))
        const x1 = Math.min(c.width, Math.ceil((r.x + r.w) * sx)), y1 = Math.min(c.height, Math.ceil((r.y + r.h) * sy))
        if (x1 <= x0 || y1 <= y0) continue
        const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] === 0) continue
          bad++
          if (!worst) {
            const k = (i - 3) / 4
            worst = { x: Math.round((x0 + (k % (x1 - x0))) / sx), y: Math.round((y0 + Math.floor(k / (x1 - x0))) / sy), rect: [r.x, r.y, r.w, r.h].map(Math.round) }
          }
        }
      }
    }
    // How much of the canvas carries anything at all (every 4th pixel each way).
    const all = ctx.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let y = 0; y < c.height; y += 4) for (let x = 0; x < c.width; x += 4) { n++; if (all[(y * c.width + x) * 4 + 3] > 0) ink++ }
    return { bad, worst, coverage: ink / Math.max(1, n), p: q.p, ms: q.ms / Math.max(1, q.paints), compose: q.composeMs }
  }, { frames, ms })
}

/** The scroll offset at which the chapter's progress is `p`, from two readings of it. */
async function calibrate(page) {
  const geo = await page.evaluate(() => {
    const s = document.querySelector('section[data-chapter="contact"]')
    return { top: s.offsetTop, end: document.documentElement.scrollHeight - window.innerHeight }
  })
  const read = async (y) => {
    await page.evaluate((y) => window.scrollTo(0, y), y)
    await sleep(1400)
    return page.evaluate(() => window.__contactQA?.p ?? null)
  }
  const pa = await read(geo.top)
  const pb = await read(geo.end)
  return { geo, at: (p) => (pa === null || pb === null || pb === pa ? geo.end : Math.max(0, Math.min(geo.end, geo.top + ((p - pa) / (pb - pa)) * (geo.end - geo.top)))) }
}

async function run(browser, { id, W, H, reduced, intensity }) {
  const tag = `${id.replace('contact.', '')}-${W}x${H}${reduced ? '-reduced' : ''}${intensity !== undefined ? `-i${intensity}` : ''}`
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: W < 800, isMobile: W < 800, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const page = await context.newPage()
  const errors = [], dev404 = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 300)}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    if (DEV_404.test(m.text()) && /_next\/static\/chunks\/src_sections_/.test(m.location()?.url ?? '')) dev404.push(m.location().url)
    else errors.push(`console: ${m.text().slice(0, 300)}`)
  })
  const knobs = intensity !== undefined ? `&qa-intensity=${intensity}&qa-speed=1.5` : ''
  await page.goto(`${BASE}/?section-animation=${id}&qa-safe${knobs}`, { waitUntil: 'load' })
  await sleep(2200)
  const { geo, at } = await calibrate(page)
  const checks = []
  const shot = async (name) => page.screenshot({ path: path.join(OUT, `${tag}-${name}.png`) })
  if (!reduced) {
    // A sweep through the growth, a few frames at each step.
    for (const p of [0.15, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      await page.evaluate((y) => window.scrollTo(0, y), at(p))
      await sleep(500)
      checks.push({ where: `sweep ${p}`, ...(await sample(page, 4, 300)) })
    }
    for (const [name, y] of [['p0.5', at(0.5)], ['p0.9', at(0.9)], ['foot', geo.end]]) {
      await page.evaluate((y) => window.scrollTo(0, y), y)
      await sleep(1600)
      checks.push({ where: name, ...(await sample(page, 30, 2000)) })
      if (intensity === undefined || name === 'p0.9') await shot(name)
    }
  } else {
    await page.evaluate((y) => window.scrollTo(0, y), geo.end)
    await sleep(1600)
    checks.push({ where: 'still', ...(await sample(page, 10, 1000)) })
    await shot('still')
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  await context.close()
  const missing = checks.some((c) => c.missing)
  const bad = checks.reduce((n, c) => n + (c.bad ?? 0), 0)
  const worst = checks.find((c) => c.worst)
  const last = checks[checks.length - 1]
  const ok = !missing && bad === 0 && !errors.length && !overflow
  const line =
    `${ok ? 'PASS' : 'FAIL'} ${tag.padEnd(40)} safe-rect pixels ${bad}${worst ? ` (first at ${worst.worst.x},${worst.worst.y} in ${worst.worst.rect} during ${worst.where})` : ''}` +
    ` · ${checks.length} positions · coverage ${((last?.coverage ?? 0) * 100).toFixed(1)}% · p ${last?.p?.toFixed?.(2)} · draw ${last?.ms?.toFixed?.(2)} ms · compose ${last?.compose?.toFixed?.(1)} ms` +
    `${missing ? ' · QA hook missing' : ''}${overflow ? ' · OVERFLOW' : ''}${errors.length ? ` · errors: ${errors.slice(0, 3).join(' | ')}` : ''}${dev404.length ? ` · dev-server chunk 404s: ${dev404.length}` : ''}`
  return { tag, ok, line }
}

const cases = []
for (const [W, H] of SIZES) for (const id of IDS) cases.push({ id, W, H, reduced: false })
if (REDUCED) for (const [W, H] of SIZES.filter(([w]) => w === 1440 || w === 390)) for (const id of IDS) cases.push({ id, W, H, reduced: true })
for (const [W, H] of EXTREMES) for (const intensity of [0, 1]) for (const id of IDS) cases.push({ id, W, H, reduced: false, intensity })

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
const results = []
let next = 0
await Promise.all(Array.from({ length: Math.max(1, JOBS) }, async () => {
  while (next < cases.length) {
    const c = cases[next++]
    try {
      const r = await run(browser, c)
      results.push(r)
      console.log(r.line)
    } catch (e) {
      results.push({ tag: c.id, ok: false })
      console.log(`FAIL ${c.id} ${c.W}x${c.H}: ${String(e).slice(0, 300)}`)
    }
  }
}))
await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${OUT}`)
if (failed.length) process.exitCode = 1
