import { chromium } from 'playwright'
const [, , url, chapter, at, out] = process.argv
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)
await page.evaluate(([id, frac]) => {
  const el = document.getElementById('chapter-' + id)
  const top = window.scrollY + el.getBoundingClientRect().top
  window.scrollTo({ top: top + el.offsetHeight * frac - window.innerHeight * 0.5, behavior: 'instant' })
}, [chapter, Number(at)])
await page.waitForTimeout(4000)
const state = await page.evaluate(() => ({
  darkness: window.__frame?.darkness,
  progress: window.__frame?.progress,
  theme: document.documentElement.dataset.theme,
}))
await page.screenshot({ path: out })
await browser.close()
console.log(JSON.stringify({ state, errs: [...new Set(errs)] }, null, 1))
