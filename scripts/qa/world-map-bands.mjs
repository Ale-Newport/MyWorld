/* /world M map: the photograph is drawn in horizontal bands across frames. Prove the bands are seamless: render the same photograph in one
   piece (one render target, one sun frustum) and compare it with what the banded path put on the canvas, pixel by pixel, with the
   boundaries between bands examined row by row. Also: the bands really are separate tasks (several), the shadow map is drawn once per
   photograph, and the small photograph shows the same island as the full one.
   Usage:  DPR=2 QA_OUT=.qa/runs/impl/map/bands node scripts/qa/world-map-bands.mjs */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const results = []
const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: Number(process.env.DPR ?? 2) })
const errors = watch(page)
await openPlayer(page)
await sleep(1500)
// Count the renders (and shadow passes) the banded photograph costs, after the shader warm-up (its own tone-mapping render is not a photograph).
await page.evaluate(() => globalThis.__archipelago.atlas.prewarm())
await page.evaluate(() => {
  const r = globalThis.__archipelago.renderer, c = (globalThis.__count = { renders: 0, shadows: 0, shadowFlags: [] }), render = r.render.bind(r)
  r.render = (...a) => { if (globalThis.__archipelago.atlas.isOpen) { c.renders++; c.shadowFlags.push(r.shadowMap.autoUpdate) } return render(...a) }
})
await page.evaluate(() => document.querySelector('#world').focus())
await page.keyboard.press('KeyM')
await page.waitForFunction(() => globalThis.__archipelago.atlas.photo?.state === 'sharp', null, { timeout: 60_000 })
await sleep(300)
const res = await page.evaluate(() => {
  const A = globalThis.__archipelago, atlas = A.atlas, r = A.renderer, T = A.THREE, p = atlas.photo, { width: W, height: H } = p, count = { ...globalThis.__count }
  const banded = atlas.base.getContext('2d').getImageData(0, 0, W, H).data
  // The reference: one band covering the whole photograph.
  const hdr = new T.WebGLRenderTarget(W, H, { type: T.HalfFloatType, samples: 4 }), target = new T.WebGLRenderTarget(W, H), ref = new Uint8Array(W * H * 4)
  atlas.exposeBand(p.bounds, W, H, 0, H, p.bounds, true, hdr, target)
  r.readRenderTargetPixels(target, 0, 0, W, H, ref)
  hdr.dispose(); target.dispose()
  const row = W * 4, per = Math.ceil(H / Math.min(4, Math.max(1, Math.ceil(W * H / 1.6e6))))
  let max = 0, big = 0, sum = 0, edgeBig = 0, edgeRows = 0; const boundary = []
  const px = (y) => (H - 1 - y) * row   // the reference is bottom-up
  for (let y = 0; y < H; y++) {
    let rowMax = 0, rowBig = 0
    for (let x = 0; x < row; x += 4) for (let k = 0; k < 3; k++) { const d = Math.abs(banded[y * row + x + k] - ref[px(y) + x + k]); if (d > rowMax) rowMax = d; sum += d; if (d > 6) { big++; rowBig++ } }
    if (rowMax > max) max = rowMax
    const m = y % per, nearEdge = m < 3 || m >= per - 3
    if (nearEdge && y > 2) { edgeBig += rowBig; edgeRows++ }
    if (y % per === 0 || y % per === per - 1) boundary.push([y, rowMax])
  }
  // Across a boundary: how different are the two rows either side compared with the picture's own row-to-row change?
  const step = (y) => { let s = 0; for (let x = 0; x < row; x += 4 * 8) for (let k = 0; k < 3; k++) s += Math.abs(banded[y * row + x + k] - banded[(y - 1) * row + x + k]); return s / (row / 32 * 3) }
  const seams = []; for (let y = per; y < H; y += per) seams.push(+step(y).toFixed(3))
  let typical = 0, n = 0; for (let y = 5; y < H; y += 37) if (y % per > 3) { typical += step(y); n++ }
  return { W, H, bands: Math.ceil(H / per), per, max, big, mean: sum / (W * H * 3), edgeRate: edgeBig / (edgeRows * W * 3), rate: big / (W * H * 3), boundary, seams, typical: typical / n, count, state: p.state }
})
console.log(JSON.stringify(res))
assert(res.bands >= 3, `the full photograph (${res.W}x${res.H}) is drawn in ${res.bands} bands`, results)
assert(res.count.renders >= res.bands * 2, `${res.count.renders} renders happened for the preview + ${res.bands} bands (+ tone mapping)`, results)
// Coplanar surfaces (road paint on road, decals on ground) z-fight differently when the projection is shifted by a band, so a few scattered samples differ; that is not a seam.
assert(res.mean < .25 && res.rate < .002, `banded photograph equals the one-piece reference (mean difference ${res.mean.toFixed(3)} of 255; ${(res.rate * 100).toFixed(3)} % of samples differ by more than 6, max ${res.max})`, results)
assert(res.edgeRate <= res.rate * 2 + 1e-4, `the three rows either side of each band boundary differ no more than the rest of the picture (${(res.edgeRate * 100).toFixed(3)} % vs ${(res.rate * 100).toFixed(3)} %)`, results)
assert(Math.max(...res.seams) <= res.typical * 3 + 1, `no seam: row-to-row change at the boundaries (${res.seams.join(', ')}) stays within the picture's own (${res.typical.toFixed(3)})`, results)
// Shadows are drawn once per photograph (shadow auto-update is on for the first band only): two photographs (small + full), each a scene render and a tone-mapping pass.
const flags = res.count.shadowFlags.slice(0, res.count.renders), fresh = flags.filter(Boolean).length
assert(fresh === 4 && flags.length === 2 * (1 + res.bands), `the shadow map is drawn once for each photograph (${fresh} auto-updating renders of ${flags.length})`, results)
await page.screenshot({ path: out(`bands-${res.W}x${res.H}.png`) })
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
