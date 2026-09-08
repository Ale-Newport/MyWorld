import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:52570'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)))
await page.goto(`${base}/world`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'ENTER', exact: true }).click({ timeout: 120000 })
await page.waitForFunction(() => window.__world?.player?.state === 'default')
const out = await page.evaluate(() => {
  const g = window.__world
  const boxes = [
    ['gutter +X x79.7..81.4 z30..55', 79.7, 81.4, 30, 55],
    ['gutter -X x70.6..72.3 z30..55', 70.6, 72.3, 30, 55],
    ['pit x70.6..81.4 z30..34.4', 70.6, 81.4, 30, 34.4],
    ['whole venue x70.2..81.9 z29..62', 70.2, 81.9, 29, 62],
    ['apron x70.2..81.9 z62..68', 70.2, 81.9, 62, 68],
  ]
  return boxes.map(([name, x0, x1, z0, z1]) => {
    let min = Infinity, max = -Infinity, maxAt = null
    for (let z = z0; z <= z1; z += 0.5) for (let x = x0; x <= x1; x += 0.5) {
      const h = g.terrain.colliderHeightAt(x, z)
      if (h < min) min = h
      if (h > max) { max = h; maxAt = [x, z] }
    }
    return { name, min: +min.toFixed(2), max: +max.toFixed(2), maxAt }
  })
})
console.log(JSON.stringify(out))
await browser.close()
