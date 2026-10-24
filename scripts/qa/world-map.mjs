/* /world M map: a photograph of the real scene, framed from the island's footprint; M / Esc;
   paused simulation; accurate player arrow; zoom and pan; no typing shortcuts.
   (Framing and travel: world-map-framing.mjs; what opening costs: world-map-open.mjs.) */
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
// The dialog is up at once; the photograph is drawn behind it, small first and then sharp.
await page.waitForFunction(() => globalThis.__archipelago.atlas.photo?.state === 'sharp', null, { timeout: 30_000 })
const sharpMs = Date.now() - t0
assert(true, `M opens the map (${openMs} ms to the dialog, ${sharpMs} ms to the full photograph)`, results)
await sleep(300)
await page.screenshot({ path: out(`map-${w}x${h}.png`) })

// The arrow is where the car is: same projection the photograph used, computed independently here.
const arrow = await page.evaluate(() => {
  const A = globalThis.__archipelago, a = document.querySelector('.atlas-player').getBoundingClientRect(), stage = document.querySelector('.atlas-stage').getBoundingClientRect()
  const atlasCanvas = document.querySelector('.atlas-base').getBoundingClientRect(), v = A.driving.vehicle.position
  return { ax: a.left + a.width / 2, ay: a.top + a.height / 2, plane: atlasCanvas, stage: { left: stage.left, top: stage.top, width: stage.width, height: stage.height }, car: [v.x, v.z] }
})
// The photograph's own bounds (framed from the island's footprint by the atlas); the projection is computed independently here.
const bounds = await page.evaluate(() => ({ ...globalThis.__archipelago.atlas.photo.bounds }))
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
await page.waitForFunction(() => document.querySelector('.atlas-detail:not([hidden])'), null, { timeout: 10_000 }).catch(() => {})
const zoomed = await page.evaluate(() => ({ t: document.querySelector('.atlas-plane').style.transform, detail: !!document.querySelector('.atlas-detail:not([hidden])') }))
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

// The dim behind the dialog only paints: the HUD buttons that stay visible above it keep working (HEAD's box-shadow dim never took clicks).
await page.keyboard.press('KeyM')
await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
await page.waitForFunction(() => document.querySelector('.atlas').dataset.photo === 'ready', null, { timeout: 30_000 })
const hud = await page.evaluate(() => {
  const dlg = document.querySelector('.atlas').getBoundingClientRect(), scrim = document.querySelector('.atlas-scrim')
  const free = (el) => {      // a point of the button the dialog does not cover (the dialog is above the HUD)
    const r = el.getBoundingClientRect()
    for (const fy of [0.5, 0.2, 0.8, 0.05, 0.95]) for (const fx of [0.5, 0.2, 0.8, 0.05, 0.95]) {
      const x = r.left + r.width * fx, y = r.top + r.height * fy
      if (x < dlg.left || x > dlg.right || y < dlg.top || y > dlg.bottom) return [x, y]
    }
    return null
  }
  const buttons = [...document.querySelectorAll('#player-nav :is(a,button)')].filter((el) => el.getClientRects().length).map((el) => {
    const p = free(el), hit = p && document.elementFromPoint(p[0], p[1])
    return { id: el.id || el.textContent.trim(), point: p, reaches: !!hit && (hit === el || el.contains(hit)), hit: hit ? `${hit.tagName}.${hit.className || hit.id}` : null }
  })
  return { scrimShown: getComputedStyle(scrim).display !== 'none', scrimEvents: getComputedStyle(scrim).pointerEvents, buttons }
})
assert(hud.scrimShown && hud.scrimEvents === 'none', `the dim is shown and takes no pointer events (display block, pointer-events ${hud.scrimEvents})`, results)
const reachable = hud.buttons.filter((b) => b.point)
// A phone's dialog covers the whole HUD (its margin is narrower than any button): the HUD is under it and the dialog's own Close is the way out.
const covered = hud.buttons.length >= 2 && !reachable.length && w < 720
if (covered) {
  const close = await page.evaluate(() => { const b = document.querySelector('.atlas-close').getBoundingClientRect(), a = document.querySelector('.atlas').getBoundingClientRect(); return b.width > 0 && b.left >= a.left - 1 && b.right <= a.right + 1 && b.top >= a.top - 1 && b.bottom <= a.bottom + 1 && b.left >= 0 && b.right <= innerWidth && b.top >= 0 && b.bottom <= innerHeight })
  assert(close, `the dialog covers the HUD on a ${w}-wide screen, and its own Close button is on screen inside it`, results)
  await page.locator('.atlas-close').click(); await sleep(400)
  assert(await page.evaluate(() => document.querySelector('.atlas').hidden), 'and that Close button closes the map', results)
} else assert(reachable.length >= 2 && reachable.every((b) => b.reaches), `every HUD button the dialog leaves visible is still the element under the pointer (${reachable.map((b) => `${b.id}:${b.reaches ? 'ok' : b.hit}`).join(', ')})`, results)
const mapBtn = hud.buttons.find((b) => b.id === 'player-map' && b.point)
if (covered) { /* closed above */ } else if (mapBtn) {
  await page.mouse.click(mapBtn.point[0], mapBtn.point[1]); await sleep(400)
  const closed = await page.evaluate(() => document.querySelector('.atlas').hidden)
  assert(closed, 'clicking the MAP button while the map is open closes it, as it did before the dim became a layer', results)
  if (!closed) await page.keyboard.press('Escape')   // keep going: the checks below need it closed
} else {
  assert(false, 'the MAP button is visible outside the dialog so it can be clicked', results)
  await page.keyboard.press('Escape')
}

// While the photograph is pending the pins are invisible, so they cannot be focused or hit either.
await page.keyboard.press('KeyM')
await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
await page.waitForFunction(() => document.querySelector('.atlas').dataset.photo === 'ready', null, { timeout: 30_000 })
await page.evaluate(() => { document.querySelector('.atlas').dataset.photo = 'pending' })
await sleep(350)   // the fade (0.14 s) runs before visibility flips
const pending = await page.evaluate(() => {
  const pin = document.querySelector('button.atlas-pin:not([hidden])'), r = pin.querySelector('i').getBoundingClientRect()
  pin.focus()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return { focused: document.activeElement === pin, hitPin: !!hit?.closest('.atlas-pin'), vis: getComputedStyle(pin).visibility }
})
await page.evaluate(() => { document.querySelector('.atlas').dataset.photo = 'ready' })
assert(!pending.focused && !pending.hitPin && pending.vis === 'hidden', `pins are neither focusable nor hit while the photograph is pending (visibility ${pending.vis}, focused ${pending.focused}, hit ${pending.hitPin})`, results)
await sleep(300)
const shown = await page.evaluate(() => { const pin = document.querySelector('button.atlas-pin:not([hidden])'); return getComputedStyle(pin).visibility })
assert(shown === 'visible', `and they are back once it is ready (visibility ${shown})`, results)
await page.keyboard.press('Escape')
await sleep(200)
const markers = await page.evaluate(() => [...document.querySelectorAll('.atlas-pin')].map((p) => p.textContent))
console.log('markers', markers.join(' | '))
assert(errors.length === 0, `no runtime errors (${errors.slice(0, 2).join(' | ')})`, results)
await browser.close()
finish(results)
