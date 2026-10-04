/* Photographs regions of /world from straight above with the map camera and
   draws a labelled world-coordinate grid over them, for layout work.
   node scripts/qa/world-photo.mjs '[{"name":"infield","minX":-90,"maxX":-10,"minZ":-60,"maxZ":20,"grid":10}]' */
import { launch, openPlayer, out, sleep } from './lib.mjs'
import fs from 'node:fs'
const regions = JSON.parse(process.argv[2] ?? '[{"name":"world"}]')
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
await openPlayer(page)
await sleep(800)
for (const r of regions) {
  const png = await page.evaluate(async (r) => {
    const A = globalThis.__archipelago
    const { authoredWorldBounds } = await import('/archipelago/preview/world-bounds.js')
    const b = r.minX === undefined ? authoredWorldBounds(A.root) : r
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ, long = r.px ?? 2400
    const width = Math.round(w >= d ? long : long * w / d), height = Math.round(w >= d ? long * d / w : long)
    A.atlas.photo ??= { bounds: b }
    const image = A.atlas.render(b, width, height)
    const c = document.createElement('canvas'); c.width = width; c.height = height
    const g = c.getContext('2d'); g.putImageData(image, 0, 0)
    const step = r.grid ?? 10, sx = width / w, sz = height / d
    g.font = '600 13px monospace'; g.lineWidth = 1
    for (let x = Math.ceil(b.minX / step) * step; x <= b.maxX; x += step) { const px = (x - b.minX) * sx; g.strokeStyle = x % 50 === 0 ? '#ff0a' : '#fff5'; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, height); g.stroke(); g.fillStyle = '#ff0'; g.fillText(String(x), px + 2, 14) }
    for (let z = Math.ceil(b.minZ / step) * step; z <= b.maxZ; z += step) { const pz = (z - b.minZ) * sz; g.strokeStyle = z % 50 === 0 ? '#ff0a' : '#fff5'; g.beginPath(); g.moveTo(0, pz); g.lineTo(width, pz); g.stroke(); g.fillStyle = '#0ff'; g.fillText(String(z), 2, pz - 2) }
    return c.toDataURL('image/png')
  }, r)
  fs.writeFileSync(out(`photo-${r.name}.png`), Buffer.from(png.split(',')[1], 'base64'))
  console.log('wrote', out(`photo-${r.name}.png`))
}
await browser.close()
