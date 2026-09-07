import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-alejandro-Projects-Portfolio/e00adc91-0fb8-45ec-91c2-c79240680fd2/scratchpad'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 })
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
await p.goto('http://localhost:3311/vischeck-threebody', { waitUntil: 'networkidle' })
for (const [w, h, name] of [[340, 300, 'n340'], [560, 260, 'n560'], [820, 620, 'n820']]) {
  await p.$eval('#a', (el, v) => { el.style.width = v.w + 'px'; el.style.height = v.h + 'px' }, { w, h })
  await p.waitForTimeout(2600)
  await (await p.$('#a')).screenshot({ path: `${OUT}/${name}.png` })
}
console.log('errors', JSON.stringify(errs.slice(0, 5)))
await b.close()
