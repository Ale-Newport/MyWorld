/**
 * Confirms the interaction layer did not touch the other two routes.
 *
 * /world2 shares its engine with /world, and the gameplay work reached into
 * World2Environment and the shared input table. This walks all three routes
 * and asserts the two that were not the job still boot clean.
 *
 * Run: node scripts/world2-routes-qa.mjs [http://localhost:3000]
 */
import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'

const base = process.argv.find(a => a.startsWith('http')) ?? 'http://localhost:3000'
await mkdir('.qa/world2-routes', { recursive: true })
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const report = { checks: [] }
const failures = []
const check = (name, pass, detail) => {
  report.checks.push({ name, pass: !!pass, detail })
  console.log(pass ? 'PASS' : 'FAIL', name, detail === undefined ? '' : JSON.stringify(detail))
  if (!pass) failures.push(name)
}
const IGNORE = /preloaded using link preload|Download the React DevTools/

try {
  for (const [route, ready] of [['/', null], ['/world', () => !!window.__world], ['/world2', () => !!window.__world2]]) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e)))
    page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(m.text()) })
    page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`) })
    await page.goto(base + route, { waitUntil: 'domcontentloaded' })
    if (ready) {
      await page.waitForFunction(ready, { timeout: 180000 }).catch(() => {})
    }
    await page.waitForTimeout(route === '/' ? 3000 : 6000)
    const title = await page.title()
    await page.screenshot({ path: `.qa/world2-routes/${route === '/' ? 'home' : route.slice(1)}.png` })
    check(`${route} loads without console errors`, errors.length === 0, errors.slice(0, 3))
    check(`${route} renders`, !!title, { title })
    await page.close()
  }
} finally {
  await writeFile('.qa/world2-routes/report.json', JSON.stringify(report, null, 2))
  await browser.close()
  console.log(`\n${report.checks.filter(c => c.pass).length}/${report.checks.length} checks passed`)
  if (failures.length) process.exitCode = 1
}
