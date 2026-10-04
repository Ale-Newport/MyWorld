/* Screenshots of the scroll journeys at fixed depths, for before/after comparison.
   node scripts/qa/journey-shots.mjs <baseUrl> <label> */
import { launch, out, sleep } from './lib.mjs'
const [base = 'http://localhost:3210', label = 'after'] = process.argv.slice(2)
const routes = ['/', '/projects']
const depths = [0, 0.18, 0.4, 0.62, 0.85, 1]
const sizes = [[1440, 900], [390, 844]]
const browser = await launch()
for (const [w, h] of sizes) {
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
    for (const route of routes) {
      await page.goto(base + route, { waitUntil: 'networkidle' })
      await sleep(2500)
      for (const d of depths) {
        await page.evaluate((d) => window.scrollTo(0, d * (document.documentElement.scrollHeight - innerHeight)), d)
        await sleep(1800)
        const name = `${label}-${route === '/' ? 'home' : 'projects'}-${w}-${reduced ? 'rm' : 'mo'}-${String(d * 100).padStart(3, '0')}.png`
        await page.screenshot({ path: out(`journey/${name}`) })
      }
    }
    if (errors.length) console.log(label, w, reduced, 'errors:', errors.slice(0, 3))
    await ctx.close()
  }
}
await browser.close()
console.log('done', label)
