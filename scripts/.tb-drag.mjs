import { chromium } from 'playwright'
const OUT = '/private/tmp/claude-501/-Users-alejandro-Projects-Portfolio/e00adc91-0fb8-45ec-91c2-c79240680fd2/scratchpad'
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 2 })
const errs = []
p.on('pageerror', e => errs.push('PAGEERROR ' + e.message))
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE ' + m.text()) })
await p.goto('http://localhost:3311/vischeck-threebody', { waitUntil: 'networkidle' })
// drive the last self-running canvas (#d) to the end of its run, then drag
await (await p.$('#d')).scrollIntoViewIfNeeded()
await p.waitForTimeout(24000)
const box = await (await p.$('#d')).boundingBox()
// find a body: sample the canvas for the ring centres is hard; instead hover-scan a grid for the grab cursor
const cvs = await p.$('#d canvas')
const cb = await cvs.boundingBox()
let found = null
outer:
for (let gx = 0.05; gx <= 0.9; gx += 0.02) {
  for (let gy = 0.08; gy <= 0.92; gy += 0.03) {
    const x = cb.x + cb.width * gx, y = cb.y + cb.height * gy
    await p.mouse.move(x, y)
    const c = await p.$eval('#d canvas', el => el.style.cursor)
    if (c === 'grab') { found = { x, y }; break outer }
  }
}
console.log('body found at', found ? 'yes' : 'NO')
if (found) {
  await p.mouse.move(found.x, found.y)
  await p.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await p.mouse.move(found.x + i * 9, found.y - i * 5)
    await p.waitForTimeout(28)
  }
  await (await p.$('#d')).screenshot({ path: `${OUT}/drag-mid.png` })
  await p.mouse.up()
  await p.waitForTimeout(2500)
  await (await p.$('#d')).screenshot({ path: `${OUT}/drag-after.png` })
  const cur = await p.$eval('#d canvas', el => el.style.cursor)
  console.log('cursor after release', cur)
}
// reset chip
await p.$$eval('#d button', els => els.forEach(e => e.click()))
await p.waitForTimeout(900)
await (await p.$('#d')).screenshot({ path: `${OUT}/after-reset.png` })
console.log('errors', JSON.stringify(errs.slice(0, 5)))
await b.close()
