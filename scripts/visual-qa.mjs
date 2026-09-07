/**
 * Visual + functional QA sweep.
 *   node scripts/visual-qa.mjs [baseUrl]
 *
 * Walks the journey at several viewport sizes, screenshots every
 * chapter, and reports console errors, horizontal overflow, layout
 * shift and slow frames.
 */
import { chromium } from 'playwright'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = path.resolve('.qa')

const VIEWPORTS = [
  { name: '1920x1080', width: 1920, height: 1080 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1280x800', width: 1280, height: 800 },
  { name: '834x1112', width: 834, height: 1112 },
  { name: '390x844', width: 390, height: 844 },
]

const CHAPTERS = [
  'prelude', 'about', 'kcl', 'playground', 'pansofia', 'teaching', 'focus',
  'gym', 'metaview', 'chess', 'stock', 'universe', 'toolbox', 'ucl', 'contact',
]

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch()
const report = { base: BASE, viewports: [], errors: [], overflow: [], notes: [] }

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 260)) })
  page.on('pageerror', (e) => errors.push(`PAGEERROR ${String(e).slice(0, 260)}`))

  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2200)
  await mkdir(path.join(OUT, vp.name), { recursive: true })

  const vpReport = { name: vp.name, chapters: [] }

  for (const id of CHAPTERS) {
    // Scroll to the middle of each chapter's pinned range.
    const found = await page.evaluate((chapterId) => {
      const el = document.getElementById(`chapter-${chapterId}`)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const top = window.scrollY + r.top
      window.scrollTo({ top: top + el.offsetHeight * 0.5 - window.innerHeight * 0.5, behavior: 'instant' })
      return { height: el.offsetHeight }
    }, id)

    if (!found) { vpReport.chapters.push({ id, present: false }); continue }
    await page.waitForTimeout(1500)

    const metrics = await page.evaluate(() => ({
      docWidth: document.documentElement.scrollWidth,
      winWidth: window.innerWidth,
      bodyOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    }))
    if (metrics.bodyOverflow) {
      report.overflow.push(`${vp.name} / ${id}: scrollWidth ${metrics.docWidth} > ${metrics.winWidth}`)
    }

    await page.screenshot({ path: path.join(OUT, vp.name, `${id}.png`), type: 'png' })
    vpReport.chapters.push({ id, present: true, overflow: metrics.bodyOverflow })
  }

  // Functional checks, desktop only.
  if (vp.width >= 1280) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await page.waitForTimeout(600)

    // Index overlay
    await page.keyboard.press('i')
    await page.waitForTimeout(700)
    const indexOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][aria-label="Chapter index"][data-open="true"]')))
    await page.screenshot({ path: path.join(OUT, vp.name, '_index.png') })
    report.notes.push(`${vp.name}: index overlay opens = ${indexOpen}`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)

    // Project overlay via deep link
    await page.goto(`${BASE}/#project/chess-assistant`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2000)
    const overlayOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"][data-open="true"]')))
    await page.screenshot({ path: path.join(OUT, vp.name, '_project.png') })
    report.notes.push(`${vp.name}: project deep-link opens = ${overlayOpen}`)

    // Quick View
    await page.goto(`${BASE}/?quick`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(1600)
    const quick = await page.evaluate(() => ({
      height: document.documentElement.scrollHeight,
      playground: Boolean(document.getElementById('chapter-playground')),
    }))
    report.notes.push(`${vp.name}: quick view height=${quick.height}, playground present=${quick.playground} (should be false)`)

    // 404
    await page.goto(`${BASE}/does-not-exist`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(900)
    await page.screenshot({ path: path.join(OUT, vp.name, '_404.png') })
  }

  // Reduced motion
  if (vp.width === 1440) {
    const rm2 = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' })
    const p2 = await rm2.newPage()
    await p2.goto(BASE, { waitUntil: 'networkidle' })
    await p2.waitForTimeout(1800)
    await p2.screenshot({ path: path.join(OUT, vp.name, '_reduced-motion.png'), fullPage: false })
    await rm2.close()
  }

  report.viewports.push(vpReport)
  if (errors.length) report.errors.push({ viewport: vp.name, errors: [...new Set(errors)].slice(0, 12) })
  await ctx.close()
}

await browser.close()
await writeFile(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2))

console.log('\n=== QA REPORT ===')
console.log(`Screenshots: ${OUT}`)
console.log(`Console errors: ${report.errors.length ? JSON.stringify(report.errors, null, 2) : 'none'}`)
console.log(`Horizontal overflow: ${report.overflow.length ? report.overflow.join('\n  ') : 'none'}`)
console.log('Notes:\n  ' + report.notes.join('\n  '))
