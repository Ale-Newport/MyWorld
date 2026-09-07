import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-alejandro-Projects-Portfolio/e00adc91-0fb8-45ec-91c2-c79240680fd2/scratchpad'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 1400 }, deviceScaleFactor: 2 })
const errs = []
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()) })
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
await p.goto('http://localhost:3311/vischeck-threebody', { waitUntil: 'networkidle' })
await p.waitForTimeout(1200)
const setP = async (v) => {
  await p.$eval('#sl', (el, val) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(el, String(val))
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, v)
  await p.waitForTimeout(700)
}
for (const v of [0.0, 0.15, 0.4, 0.62, 0.8, 1.0]) {
  await setP(v)
  await (await p.$('#a')).screenshot({ path: `${OUT}/p${String(v).replace('.','_')}.png` })
}
await (await p.$('#b')).screenshot({ path: `${OUT}/reduced.png` })
await (await p.$('#c')).screenshot({ path: `${OUT}/small.png` })
await p.waitForTimeout(6000)
await (await p.$('#d')).screenshot({ path: `${OUT}/loop6s.png` })
await p.waitForTimeout(8000)
await (await p.$('#d')).screenshot({ path: `${OUT}/loop14s.png` })
// perf probe
const fps = await p.evaluate(() => new Promise(res => {
  let n = 0; const t0 = performance.now()
  const tick = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(n / ((performance.now() - t0) / 1000)) }
  requestAnimationFrame(tick)
}))
console.log('fps', fps.toFixed(1))
console.log('errors', JSON.stringify(errs.slice(0, 6)))
await b.close()
