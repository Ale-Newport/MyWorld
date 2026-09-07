import { chromium } from 'playwright'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 1 })
p.on('pageerror', e => console.log('PAGEERROR', e.message))
await p.goto('http://localhost:3311/vischeck-threebody', { waitUntil: 'networkidle' })
await (await p.$('#d')).scrollIntoViewIfNeeded()
await p.evaluate(() => {
  const c = document.querySelector('#d canvas')
  window.__n = 0
  c.addEventListener('pointermove', () => { window.__n++ }, true)
})
await p.waitForTimeout(4000)
const cb = await (await p.$('#d canvas')).boundingBox()
console.log('canvas box', cb)
let hits = []
for (let gx = 0.05; gx <= 0.95; gx += 0.015) {
  for (let gy = 0.05; gy <= 0.95; gy += 0.03) {
    await p.mouse.move(cb.x + cb.width * gx, cb.y + cb.height * gy)
    const s = await p.$eval('#d canvas', el => el.style.cursor)
    if (s === 'grab') hits.push([gx.toFixed(2), gy.toFixed(2)])
  }
}
console.log('pointermove count', await p.evaluate(() => window.__n))
console.log('grab hits', hits.length, hits.slice(0, 6))
await b.close()
