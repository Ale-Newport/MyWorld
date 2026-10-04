/* /world M map: a photograph of the real scene, framed from its bounds; M / Esc;
   paused simulation; accurate player arrow; zoom and pan; no typing shortcuts. */
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'
const results = []
const browser = await launch()
const [w, h] = [Number(process.env.W ?? 1440), Number(process.env.H ?? 900)]
const page = await browser.newPage({ viewport: { width: w, height: h } })
const errors = watch(page)
await openPlayer(page)
await sleep(1500)
// Drive a little so the arrow is somewhere particular.
await page.keyboard.down('KeyW'); await sleep(900); await page.keyboard.up('KeyW'); await sleep(600)
const car = () => page.evaluate(() => { const v = globalThis.__archipelago.driving.vehicle; return { x: v.position.x, y: v.position.y, z: v.position.z, speed: v.speedKmh } })

// Typing never opens the map.
await page.evaluate(() => { const i = document.createElement('input'); i.id = 'qa-field'; i.style.cssText = 'position:fixed;top:4px;left:4px;z-index:99'; document.body.append(i); i.focus() })
await page.keyboard.type('mmm m')
assert(await page.evaluate(() => document.querySelector('.atlas').hidden), 'typing M into a field does not open the map', results)
await page.evaluate(() => { document.getElementById('qa-field').remove(); document.querySelector('#world').focus() })

const t0 = Date.now()
await page.keyboard.press('KeyM')
await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
const openMs = Date.now() - t0
assert(true, `M opens the map (${openMs} ms including the photograph)`, results)
await sleep(300)
await page.screenshot({ path: out(`map-${w}x${h}.png`) })

// The arrow is where the car is: same projection the photograph used, computed independently here.
const arrow = await page.evaluate(() => {
  const A = globalThis.__archipelago, a = document.querySelector('.atlas-player').getBoundingClientRect(), stage = document.querySelector('.atlas-stage').getBoundingClientRect()
  const atlasCanvas = document.querySelector('.atlas-base').getBoundingClientRect(), v = A.driving.vehicle.position
  const { authoredBounds } = { authoredBounds: null }
  return { ax: a.left + a.width / 2, ay: a.top + a.height / 2, plane: atlasCanvas, stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height }, car: [v.x, v.z] }
})
const bounds = await page.evaluate(async () => { const m = await import('/archipelago/preview/world-bounds.js'); const b = m.authoredWorldBounds(globalThis.__archipelago.root); return { minX: b.minX - 6, maxX: b.maxX + 6, minZ: b.minZ - 6, maxZ: b.maxZ + 6 } })
const ex = arrow.plane.left + (arrow.car[0] - bounds.minX) / (bounds.maxX - bounds.minX) * arrow.plane.width
const ey = arrow.plane.top + (arrow.car[1] - bounds.minZ) / (bounds.maxZ - bounds.minZ) * arrow.plane.height
assert(Math.hypot(ex - arrow.ax, ey - arrow.ay) < 2, `player arrow within 2 px of the car's true map position (${Math.hypot(ex - arrow.ax, ey - arrow.ay).toFixed(2)} px)`, results)
const ratio = arrow.plane.width / arrow.plane.height, worldRatio = (bounds.maxX - bounds.minX) / (bounds.maxZ - bounds.minZ)
assert(Math.abs(ratio - worldRatio) < 0.01, `map keeps the world's proportions (${ratio.toFixed(3)} vs ${worldRatio.toFixed(3)})`, results)

// Frozen while open: holding W moves nothing and is not applied after closing.
const before = await car()
await page.keyboard.down('KeyW'); await sleep(1200)
const during = await car()
assert(Math.hypot(during.x - before.x, during.z - before.z) < 0.01, `simulation paused while the map is open (moved ${Math.hypot(during.x - before.x, during.z - before.z).toFixed(3)} m)`, results)
const frames = await page.evaluate(() => new Promise((r) => { const i = globalThis.__archipelago.renderer.info.render.frame; setTimeout(() => r(globalThis.__archipelago.renderer.info.render.frame - i), 500) }))
assert(frames === 0, `the 3D view is not re-rendered behind the open map (${frames} frames in 0.5 s)`, results)

// Zoom and pan.
const stage = arrow.stage
await page.mouse.move(stage.left + stage.width * 0.55, stage.top + stage.height * 0.5)
for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -240); await sleep(40) }
await sleep(500)
const zoomed = await page.evaluate(() => ({ t: document.querySelector('.atlas-plane').style.transform, detail: !document.querySelector('.atlas-detail').hidden }))
assert(/scale\((?!1\))/.test(zoomed.t) && zoomed.detail, `wheel zooms in and a sharper detail photograph replaces the base (${zoomed.t})`, results)
await page.mouse.down(); await page.mouse.move(stage.left + stage.width * 0.4, stage.top + stage.height * 0.42, { steps: 8 }); await page.mouse.up()
await sleep(500)
await page.screenshot({ path: out(`map-zoomed-${w}x${h}.png`) })
const panned = await page.evaluate(() => document.querySelector('.atlas-plane').style.transform)
assert(panned !== zoomed.t, 'dragging pans the map', results)

await page.keyboard.up('KeyW')
await page.keyboard.press('Escape')
assert(await page.evaluate(() => document.querySelector('.atlas').hidden), 'Escape closes the map', results)
await sleep(800)
const after = await car()
assert(Math.hypot(after.x - during.x, after.z - during.z) < 0.6, `W held during the map is not driven after it closes (${Math.hypot(after.x - during.x, after.z - during.z).toFixed(2)} m)`, results)
await page.keyboard.press('KeyM'); await sleep(200)
const reopened = await page.evaluate(() => !document.querySelector('.atlas').hidden)
await page.keyboard.press('KeyM'); await sleep(200)
assert(reopened && await page.evaluate(() => document.querySelector('.atlas').hidden), 'M toggles the map open and closed', results)
const markers = await page.evaluate(() => [...document.querySelectorAll('.atlas-pin')].map((p) => p.textContent))
console.log('markers', markers.join(' | '))
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
