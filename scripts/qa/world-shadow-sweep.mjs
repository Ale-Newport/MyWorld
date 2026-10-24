/* Does the fitted shadow (runtime/shadow-rig.js) ever show less than the old fixed box did? The same view is drawn twice, fitted and then
   with the old 240 x 220 m box redrawn every frame (shadow rig's legacy switch), over a sweep of chase-camera poses at some spots: how far the
   camera is orbited (phi: 0.04 straight down ... 0.43 almost level) and turned (theta), zoomed all the way out and in. Both frames are blurred
   (shadow edges are sharper now, which is wanted) and compared: "missing" is where the old box had shadow and the fitted one has none.

     QA_BASE=http://127.0.0.1:3282 node scripts/qa/world-shadow-sweep.mjs [--spots plaza,circuit] [--scenarios poses,plane,cinematic] [--size 1440x900] [--dpr 1] [--out DIR] [--portrait]
   Both pictures of a pose are drawn in the same task and read back from the canvas, so what moves (the plane, the balloon) is in the same place in both.
   Writes DIR/<spot>-<pose>-fitted.png, -legacy.png and -diff.png for the worst; prints one row per pose. Exit 1 when a pose misses more than 0.5 % of the screen. */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launch, BASE, sleep } from './lib.mjs'
import { SPOTS } from './world-spots.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/impl/frame/sweep')), spots = arg('spots', 'plaza,circuit').split(',')
const [W, H] = (process.argv.includes('--portrait') ? '390x844' : arg('size', '1440x900')).split('x').map(Number), DPR = Number(arg('dpr', process.argv.includes('--portrait') ? 2 : 1))
fs.mkdirSync(OUT, { recursive: true })
const PI = Math.PI
const POSES = [
  ['default', {}], ['zoom-out', { zoom: 0 }], ['zoom-in', { zoom: 1 }],
  ['top-down', { phi: .04 * PI }], ['steep', { phi: .15 * PI }], ['low', { phi: .35 * PI }], ['level', { phi: .43 * PI }], ['level-out', { phi: .43 * PI, zoom: 0 }],
  ['east', { theta: 1.0 * PI }], ['north', { theta: 1.75 * PI }], ['west-low', { theta: .6 * PI, phi: .38 * PI, zoom: 0 }], ['top-out', { phi: .04 * PI, zoom: 0 }],
]
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DPR, ...(process.argv.includes('--portrait') ? { hasTouch: true, isMobile: true } : {}) })).newPage()
page.on('pageerror', (e) => console.log('pageerror', String(e).slice(0, 200)))
await page.goto(`${BASE}/archipelago/preview/index.html?qa&perf`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
await sleep(2500)
const frames = (n) => page.evaluate((n) => new Promise((resolve) => { let i = 0; const f = () => (++i >= n ? resolve() : requestAnimationFrame(f)); requestAnimationFrame(f) }), n)
const blurred = async (buffer) => sharp(buffer).removeAlpha().blur(5).raw().toBuffer({ resolveWithObject: true })
let worst = 0
console.log(`viewport ${W}x${H} dpr ${DPR}`)
async function compare(spot, name) {
  await sleep(300); await frames(4)
  // Both pictures are drawn in the same task, from the same pose of everything that moves, and read back from the canvas: nothing differs but the shadow.
  const pair = await page.evaluate(() => {
    const A = __archipelago, r = A.renderer, gl = r.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, rig = A.shadow
    const grab = () => { const u = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, u); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s) }
    const car = A.driving.vehicle.position, ground = A.driving.mode === 'PLANE' ? 0 : Math.min(car.y, 8) - 1
    const cin = A.driving.view.cinematic, cinematic = cin.active || cin.progress > .001 // the fitted shadow of a cinematic view (the Projects board) is another fit
    rig.setLegacy(false); rig.invalidate(); rig.update(A.camera, ground, car, cinematic); r.render(A.scene, A.camera); const fitted = grab(), half = rig.state().half
    rig.setLegacy(true); rig.update(A.camera, ground, car); r.render(A.scene, A.camera); const legacy = grab()
    rig.setLegacy(false); rig.invalidate()
    return { w, h, fitted, legacy, half }
  })
  const raw = (b64) => Buffer.from(b64, 'base64'), flip = (buf, w, h) => { const out = Buffer.alloc(buf.length), row = w * 4; for (let y = 0; y < h; y++) buf.copy(out, y * row, (h - 1 - y) * row, (h - y) * row); return out }
  const png = (buf, w, h) => sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
  const fittedPng = await png(flip(raw(pair.fitted), pair.w, pair.h), pair.w, pair.h), legacyPng = await png(flip(raw(pair.legacy), pair.w, pair.h), pair.w, pair.h)
  const [a, b] = await Promise.all([blurred(fittedPng), blurred(legacyPng)])
  let missing = 0, extra = 0
  const n = a.info.width * a.info.height, diff = Buffer.alloc(n * 3)
  for (let i = 0, j = 0; i < a.data.length; i += a.info.channels, j += 3) {
    const lf = a.data[i] + a.data[i + 1] + a.data[i + 2], ll = b.data[i] + b.data[i + 1] + b.data[i + 2], d = lf - ll
    if (d > 36) missing++; else if (d < -36) extra++
    diff[j] = d > 36 ? 255 : 0; diff[j + 1] = Math.abs(d) > 36 ? 0 : Math.min(255, Math.abs(d) * 3); diff[j + 2] = d < -36 ? 255 : 0
  }
  const missingPct = 100 * missing / n, extraPct = 100 * extra / n
  worst = Math.max(worst, missingPct)
  console.log(`${spot.padEnd(8)} ${name.padEnd(12)} box ±${pair.half} m  missing ${missingPct.toFixed(2)}%  extra ${extraPct.toFixed(2)}%`)
  if (missingPct > 0.3 || process.argv.includes('--all')) {
    const base = path.join(OUT, `${spot}-${name}`)
    fs.writeFileSync(base + '-fitted.png', fittedPng); fs.writeFileSync(base + '-legacy.png', legacyPng)
    await sharp(diff, { raw: { width: a.info.width, height: a.info.height, channels: 3 } }).png().toFile(base + '-diff.png')
  }
}
const scenarios = arg('scenarios', 'poses').split(',')
if (scenarios.includes('poses')) for (const spot of spots) {
  if (SPOTS[spot]) await page.evaluate((s) => { const d = __archipelago.driving, a = d.arrival({ group: null, x: s.x, z: s.z, name: s.name }); d.place(a, { reason: 'travel' }) }, SPOTS[spot])
  for (const [name, pose] of POSES) {
    await page.evaluate((pose) => {
      const v = __archipelago.driving.view
      v.spherical.targetPhi = pose.phi ?? v.spherical.basePhi; v.spherical.targetTheta = pose.theta ?? v.spherical.baseTheta; v.zoom.baseRatio = pose.zoom ?? 0.4
      __archipelago.shadow.setLegacy(false)
    }, pose)
    await sleep(1300); await compare(spot, name)
  }
}
const reset = () => page.evaluate(() => { const v = __archipelago.driving.view; v.spherical.targetPhi = v.spherical.basePhi; v.spherical.targetTheta = v.spherical.baseTheta; v.zoom.baseRatio = 0.4 })
if (scenarios.includes('plane')) {
  await reset(); await page.evaluate(() => { const d = __archipelago.driving, a = d.arrival({ group: null, x: -16, z: 42, name: 'p' }); d.place(a, { reason: 'travel' }) }); await sleep(1500)
  await page.keyboard.press('Space'); await sleep(250); await page.keyboard.press('Space'); await sleep(2500)
  await page.keyboard.down('KeyW'); await sleep(2500)
  await compare('plane', 'cruise'); await page.keyboard.up('KeyW')
  await page.evaluate(() => { const v = __archipelago.driving.view; v.zoom.baseRatio = 0 }); await sleep(1500); await compare('plane', 'zoom-out')
  await page.keyboard.press('Space'); await sleep(200); await page.keyboard.press('Space'); await sleep(2500)
}
if (scenarios.includes('cinematic')) {
  await reset()
  const p = await page.evaluate(() => { const g = __archipelago.gameplay; for (const i of g.instances) for (const item of i.prompts.items) if (item.label === 'Projects') { const w = item.group.getWorldPosition(new __archipelago.THREE.Vector3()); return { x: w.x, z: w.z } } return null })
  if (p) {
    await page.evaluate((p) => { const d = __archipelago.driving, a = d.arrival({ group: null, x: p.x + 3, z: p.z + 3, name: 'p' }); d.place(a, { reason: 'travel' }) }, p); await sleep(2000)
    await page.evaluate(() => __archipelago.gameplay.interact()); await sleep(3500)
    await compare('projects', 'cinematic')
    await page.evaluate(() => __archipelago.gameplay.active()?.exit()); await sleep(1500)
  } else console.log('no Projects prompt found')
}
await browser.close()
console.log(`worst missing ${worst.toFixed(2)}%`)
if (worst > 0.5) process.exitCode = 1
