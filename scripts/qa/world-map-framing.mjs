/* /world M map framing: the island is centred in the stage (a hair above the middle), never clipped, on every aspect ratio, and as large as the stage allows,
   and every transform still agrees with the photograph, so clicking the map travels exactly where it points.
   For each viewport: centre of the island's footprint (land + visible shallows) within ±1 % of the stage width and -1.5 % ±1 % of its
   height; the north and south margins >= 2.5 % of the smaller stage side (the lift lives there) and the east and west margins >= 0.8 % (a portrait stage is limited
   by its width, so sea there is island lost: on one the island spans >= 97 % of the stage width); and a pixel analysis of the real photograph (the sea ring around its edge is
   untouched: no clipped shelf). Then toWorld(toScreen(p)) == p, and a real click at zoom 1 and zoom 4 reaches the travel hook at that point.
   Usage:  QA_OUT=.qa/runs/impl/map/framing node scripts/qa/world-map-framing.mjs      (VIEWPORTS="1440x900,390x844" to limit) */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const results = []
const VIEWPORTS = (process.env.VIEWPORTS ?? '1440x900,2560x1080,1280x720,1024x768,768x1024,390x844,844x390').split(',').map((v) => v.split('x').map(Number))
const browser = await launch()
const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[0][0], height: VIEWPORTS[0][1] } })
const page = await ctx.newPage()
const errors = watch(page)
await openPlayer(page)
await sleep(1500)
// The car must be somewhere on land for the travel checks; the spawn is.
const open = async () => {
  if (await page.evaluate(() => !document.querySelector('.atlas').hidden)) return
  await page.evaluate(() => document.querySelector('#world').focus())
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => { const a = globalThis.__archipelago.atlas; return !a.dialog.hidden && a.photo?.state === 'sharp' }, null, { timeout: 60_000 })
  await sleep(350)
}
const close = async () => { if (await page.evaluate(() => !document.querySelector('.atlas').hidden)) { await page.keyboard.press('Escape'); await sleep(150) } }

const analysis = () => page.evaluate(async () => {
  const A = globalThis.__archipelago, atlas = A.atlas, m = await import('/archipelago/preview/world-bounds.js'), land = m.landFootprint(A.root)
  const sw = atlas.sw, sh = atlas.sh, fw = atlas.fw, fh = atlas.fh, v = atlas.view
  const [x0, y0] = atlas.toScreen(land.minX, land.minZ), [x1, y1] = atlas.toScreen(land.maxX, land.maxZ)
  const plane = { l: (sw - fw) / 2, t: (sh - fh) / 2, r: (sw + fw) / 2, b: (sh + fh) / 2 }
  // The photograph itself: what is not sea.
  const c = document.querySelector('.atlas-base'), W = c.width, H = c.height, px = c.getContext('2d').getImageData(0, 0, W, H).data
  const sea = [px[0], px[1], px[2]], differs = (i) => Math.abs(px[i] - sea[0]) + Math.abs(px[i + 1] - sea[1]) + Math.abs(px[i + 2] - sea[2]) > 40
  let ring = 0, minX = W, maxX = -1, minY = H, maxY = -1
  for (let y = 0; y < H; y++) {
    const edgeRow = y < 2 || y >= H - 2
    for (let x = 0; x < W; x++) {
      const edge = edgeRow || x < 2 || x >= W - 2
      if (!edge && (x & 1 || y & 1)) continue
      if (differs((y * W + x) * 4)) { if (edge) ring++; else { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y } }
    }
  }
  const k = fw / W, shot = { x0: plane.l + minX * k, x1: plane.l + (maxX + 1) * k, y0: plane.t + minY * k, y1: plane.t + (maxY + 1) * k }
  return { sw, sh, fw, fh, zoom: v.zoom, footprint: land, box: { x0, x1, y0, y1 }, plane, ring, shot, dom: { cw: document.querySelector('.atlas-stage').clientWidth, ch: document.querySelector('.atlas-stage').clientHeight }, photo: [W, H], bounds: atlas.photo.bounds }
})

const rows = []
for (const [w, h] of VIEWPORTS) {
  await close()
  await page.setViewportSize({ width: w, height: h })
  await sleep(300)
  await open()
  await sleep(200)
  const a = await analysis()
  const cx = (a.box.x0 + a.box.x1) / 2, cy = (a.box.y0 + a.box.y1) / 2
  const dx = (cx - a.sw / 2) / a.sw * 100, dy = (cy - a.sh / 2) / a.sh * 100
  const small = Math.min(a.sw, a.sh)
  // East-west and north-south margins apart, to the stage's edges and to the plane's: the stage beyond a plane that does not fill it is sea.
  const marginX = Math.min(a.box.x0 - Math.max(0, a.plane.l), Math.min(a.plane.r, a.sw) - a.box.x1, a.box.x0, a.sw - a.box.x1) / small * 100
  const marginZ = Math.min(a.box.y0 - Math.max(0, a.plane.t), Math.min(a.plane.b, a.sh) - a.box.y1, a.box.y0, a.sh - a.box.y1) / small * 100
  const widthShare = (a.box.x1 - a.box.x0) / a.sw * 100
  const sx = (a.shot.x0 + a.shot.x1) / 2, sy = (a.shot.y0 + a.shot.y1) / 2
  const shotDx = (sx - a.sw / 2) / a.sw * 100, shotDy = (sy - a.sh / 2) / a.sh * 100
  const shotMarginX = Math.min(a.shot.x0 - a.plane.l, a.plane.r - a.shot.x1, a.shot.x0, a.sw - a.shot.x1) / small * 100
  const shotMarginZ = Math.min(a.shot.y0 - a.plane.t, a.plane.b - a.shot.y1, a.shot.y0, a.sh - a.shot.y1) / small * 100
  rows.push({ viewport: `${w}x${h}`, stage: [a.sw, a.sh], plane: [Math.round(a.fw), Math.round(a.fh)], dx: +dx.toFixed(2), dy: +dy.toFixed(2), marginXPct: +marginX.toFixed(2), marginZPct: +marginZ.toFixed(2), widthSharePct: +widthShare.toFixed(1), pixelBoxDx: +shotDx.toFixed(2), pixelBoxDy: +shotDy.toFixed(2), pixelMarginXPct: +shotMarginX.toFixed(2), pixelMarginZPct: +shotMarginZ.toFixed(2), ring: a.ring })
  console.log(JSON.stringify(rows.at(-1)))
  assert(a.sw === a.dom.cw && a.sh === a.dom.ch, `${w}x${h}: layout uses the stage's padding box (${a.sw}x${a.sh})`, results)
  assert(Math.abs(dx) <= 1, `${w}x${h}: island centred horizontally (${dx.toFixed(2)} % of the stage width)`, results)
  assert(dy <= -0.5 && dy >= -2.5, `${w}x${h}: island sits a hair above the middle (${dy.toFixed(2)} % of the stage height, wanted -1.5 ± 1)`, results)
  assert(marginZ >= 2.5, `${w}x${h}: north and south margins to the plane and the stage edges >= 2.5 % of the smaller side (${marginZ.toFixed(2)} %)`, results)
  assert(marginX >= 0.8, `${w}x${h}: east and west margins >= 0.8 % of the smaller side, nothing clipped (${marginX.toFixed(2)} %)`, results)
  if (a.sw < a.sh) assert(widthShare >= 97, `${w}x${h}: a portrait stage is used for the island: it spans ${widthShare.toFixed(1)} % of the stage width (>= 97 %, the 4 % pad on every side gave 92 %)`, results)
  assert(Math.abs(shotDx) <= 1 && shotDy <= -0.5 && shotDy >= -2.5, `${w}x${h}: the drawn island (non-sea pixels of the photograph) is centred ${shotDx.toFixed(2)} % / ${shotDy.toFixed(2)} % of the stage`, results)
  assert(a.ring === 0, `${w}x${h}: photograph shows open sea all round its edge, no clipped shelf (${a.ring} non-sea pixels in the outer ring)`, results)
  assert(shotMarginZ >= 2.5 && shotMarginX >= 0.5, `${w}x${h}: the island's drawn pixels (non-sea, measured on the photograph) keep >= 2.5 % north and south and >= 0.5 % east and west clear of the plane and stage edges (${shotMarginZ.toFixed(2)} % / ${shotMarginX.toFixed(2)} %), centred ${shotDx.toFixed(2)} % / ${shotDy.toFixed(2)} %`, results)
  await page.screenshot({ path: out(`map-${w}x${h}.png`) })
}

// One transform for everything: world -> screen -> world is the identity, and the pins agree with it.
await close(); await page.setViewportSize({ width: 1440, height: 900 }); await sleep(300); await open()
const round = await page.evaluate(() => {
  const A = globalThis.__archipelago, atlas = A.atlas, b = atlas.photo.bounds, places = atlas.markers.places, find = (n) => places.find((p) => p.name.startsWith(n)), car = A.driving.vehicle.position
  const pts = { harbor: find('Harbor'), plaza: find('Central Plaza'), car: { x: car.x, z: car.z }, water: { x: b.minX + 4, z: (b.minZ + b.maxZ) / 2 }, outside: { x: b.minX - 40, z: b.maxZ + 30 } }
  const worst = {}
  for (const zoom of [1, 4]) {
    atlas.view.zoom = zoom; atlas.view.cx = atlas.fw * .4; atlas.view.cy = atlas.fh * .6; atlas.apply(true)
    let e = 0; for (const p of Object.values(pts)) { const [sx, sy] = atlas.toScreen(p.x, p.z), q = atlas.toWorld(sx, sy); e = Math.max(e, Math.hypot(q.x - p.x, q.z - p.z)) }
    worst[zoom] = e
  }
  atlas.fit(); atlas.apply(true)
  // Pins sit where toScreen says (their label-free dot centre).
  const pin = atlas.pinEls.find((r) => r.m.name.startsWith('Harbor')), [px, py] = atlas.toScreen(pin.m.x, pin.m.z), box = pin.pin.querySelector('i').getBoundingClientRect(), s = atlas.stage.getBoundingClientRect()
  return { worst, pinErr: Math.hypot(box.left + box.width / 2 - (s.left + atlas.stage.clientLeft + px), box.top + box.height / 2 - (s.top + atlas.stage.clientTop + py)) }
})
assert(round.worst[1] < 1e-6 && round.worst[4] < 1e-6, `toWorld(toScreen(p)) == p at zoom 1 and 4 (worst ${round.worst[1].toExponential(1)} / ${round.worst[4].toExponential(1)} m)`, results)
assert(round.pinErr < 1.01, `a pin's dot is drawn within 1 px of toScreen (${round.pinErr.toFixed(2)} px)`, results)

// Real clicks: the point that reaches the travel hook is the point under the cursor, at zoom 1 and zoom 4.
for (const zoom of [1, 4]) {
  await close(); await open()
  const target = await page.evaluate((zoom) => {
    const A = globalThis.__archipelago, atlas = A.atlas, p = atlas.markers.places.find((m) => m.name.startsWith('Central Plaza')) ?? atlas.markers.places[0]
    if (zoom > 1) { const [sx, sy] = atlas.toScreen(p.x, p.z); atlas.zoomAt(zoom, sx, sy); atlas.apply(true) }
    const calls = (globalThis.__travels = []), hook = (atlas.__hook ??= atlas.onTravel); atlas.onTravel = (t) => { calls.push({ x: t.x, z: t.z, kind: t.kind }); return hook(t) }
    // A point beside the marker, on the same ground.
    const [sx, sy] = atlas.toScreen(p.x + 4, p.z + 3), s = atlas.stage.getBoundingClientRect()
    return { world: { x: p.x + 4, z: p.z + 3 }, client: { x: s.left + atlas.stage.clientLeft + sx, y: s.top + atlas.stage.clientTop + sy } }
  }, zoom)
  await page.mouse.click(target.client.x, target.client.y)
  await sleep(500)
  const got = await page.evaluate(() => ({ calls: globalThis.__travels, open: !document.querySelector('.atlas').hidden, car: (() => { const v = globalThis.__archipelago.driving.vehicle.position; return [v.x, v.z] })() }))
  const asked = got.calls.at(-1)
  assert(asked && Math.hypot(asked.x - target.world.x, asked.z - target.world.z) < 0.5, `zoom ${zoom}: a click reaches travel at the point it points to (${asked ? Math.hypot(asked.x - target.world.x, asked.z - target.world.z).toFixed(3) : 'no call'} m off)`, results)
  assert(!got.open && Math.hypot(got.car[0] - target.world.x, got.car[1] - target.world.z) < 6, `zoom ${zoom}: the car arrives within 6 m of it and the map closes (${Math.hypot(got.car[0] - target.world.x, got.car[1] - target.world.z).toFixed(1)} m)`, results)
}
// Water inside the photograph is refused where it was asked; the margin outside the photograph says so.
await close(); await open()
const refusal = await page.evaluate(() => {
  const A = globalThis.__archipelago, atlas = A.atlas, b = atlas.photo.bounds, [sx, sy] = atlas.toScreen(b.minX + 4, (b.minZ + b.maxZ) / 2), s = atlas.stage.getBoundingClientRect()
  const [ox, oy] = atlas.toScreen(b.minX - 20, b.minZ)
  return { water: [s.left + atlas.stage.clientLeft + sx, s.top + atlas.stage.clientTop + sy], outside: [s.left + atlas.stage.clientLeft + ox, s.top + atlas.stage.clientTop + oy], insideStage: ox > 2 }
})
await page.mouse.click(...refusal.water); await sleep(300)
const water = await page.evaluate(() => ({ open: !document.querySelector('.atlas').hidden, say: document.querySelector('.atlas-feedback').textContent }))
assert(water.open && /^Can.t drive there/.test(water.say), `open sea is refused where it was asked and the map stays open ("${water.say}")`, results)
if (refusal.insideStage) { await page.mouse.click(...refusal.outside); await sleep(300); const say = await page.evaluate(() => document.querySelector('.atlas-feedback').textContent); assert(/outside/i.test(say), `the margin around the photograph says so ("${say}")`, results) }
await page.screenshot({ path: out('map-refusal.png') })
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
console.table(rows)
finish(results)
