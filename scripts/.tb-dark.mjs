import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-alejandro-Projects-Portfolio/e00adc91-0fb8-45ec-91c2-c79240680fd2/scratchpad'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 })
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
await p.goto('http://localhost:3311/vischeck-threebody', { waitUntil: 'networkidle' })
await p.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark')
  document.body.style.background = 'var(--bg-primary)'
})
await p.waitForTimeout(2500)
await (await p.$('#b')).screenshot({ path: `${OUT}/dark-reduced.png` })
await p.waitForTimeout(4000)
await (await p.$('#d')).screenshot({ path: `${OUT}/dark-loop.png` })
// narrow layout probe
await p.setViewportSize({ width: 420, height: 900 })
await p.waitForTimeout(2500)
await (await p.$('#a')).screenshot({ path: `${OUT}/narrow.png` })
console.log('errors', JSON.stringify(errs.slice(0, 5)))
await b.close()
