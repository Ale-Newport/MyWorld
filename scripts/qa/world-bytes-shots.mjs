/* Screenshots from the real gameplay camera at six places that use what the data-size changes touch (the world document's surfaces and
   terrain, the GLB geometry and the WebP images), and the pixel difference between two runs.

     QA_BASE=http://127.0.0.1:3292 node scripts/qa/world-bytes-shots.mjs --label before --out .qa/runs/impl/bytes
     QA_BASE=http://127.0.0.1:3293 node scripts/qa/world-bytes-shots.mjs --label after  --out .qa/runs/impl/bytes
     node scripts/qa/world-bytes-shots.mjs --compare before after --out .qa/runs/impl/bytes

   The car is placed at each place the way the M map's travel does (driving.arrival + driving.place), the camera is the chase camera,
   reduced motion freezes the grass and the water, and every shot waits for the frame to settle. --compare writes diff-<spot>.png
   (differences x8) and prints, per spot, the share of pixels that differ by more than 24/255 in any channel, the largest difference and
   the mean one, for the whole frame and outside the box the car sits in (it settles differently on every run). Two runs of the SAME tree already differ a little where something moves (balloons, a fountain): run --label twice on one
   tree to see that floor. */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launch, BASE, sleep } from './lib.mjs'

const args = process.argv.slice(2)
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback }
const OUT = path.resolve(arg('out', '.qa/runs/impl/bytes'))
fs.mkdirSync(OUT, { recursive: true })
// [name, [x, z] of the place in the scene]: the plaza spawn, the Ferris wheel's plaza, the career timeline, the cookie bakery, the bowling
// alley, the circuit start, the pit of Behind the scenes (the terrain colour map's WebP), the projects district and a stretch of beach, where the
// shoreline foam that map-terrain-shore.js derives from every terrain triangle is drawn.
const SPOTS = [['spawn', null], ['ferris-wheel', [62, -39]], ['career', [11, 10]], ['cookie', [16, 36]], ['bowling', [21, 62]], ['circuit', [-14, 15]], ['behind-the-scenes', [-97, -22]], ['projects', [36, 18]], ['coast', [112, 62]]]

if (args.includes('--compare')) {
  const [la, lb] = args.slice(args.indexOf('--compare') + 1, args.indexOf('--compare') + 3)
  const rows = []
  for (const [name] of SPOTS) {
    const fa = path.join(OUT, `${la}-${name}.png`), fb = path.join(OUT, `${lb}-${name}.png`)
    if (!fs.existsSync(fa) || !fs.existsSync(fb)) continue
    const [x, y] = await Promise.all([fa, fb].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })))
    if (x.info.width !== y.info.width || x.info.height !== y.info.height) { rows.push({ spot: name, problem: 'size differs' }); continue }
    // The car is always at the middle of the frame and settles on its suspension differently on every run: its box is judged apart.
    const { width, height } = x.info, car = { x0: Math.round(width * .36), x1: Math.round(width * .66), y0: Math.round(height * .3), y1: Math.round(height * .74) }
    const diff = Buffer.alloc(width * height * 3), all = { over: 0, max: 0, sum: 0, n: 0 }, rest = { over: 0, max: 0, sum: 0, n: 0 }
    for (let py = 0; py < height; py++) for (let px = 0; px < width; px++) {
      const i = py * width + px, inCar = px >= car.x0 && px < car.x1 && py >= car.y0 && py < car.y1
      let d = 0, total = 0
      for (let c = 0; c < 3; c++) { const e = Math.abs(x.data[i * 3 + c] - y.data[i * 3 + c]); d = Math.max(d, e); total += e; diff[i * 3 + c] = Math.min(255, e * 8) }
      for (const bucket of inCar ? [all] : [all, rest]) { bucket.n++; bucket.sum += total / 3; if (d > 24) bucket.over++; if (d > bucket.max) bucket.max = d }
    }
    await sharp(diff, { raw: { width, height, channels: 3 } }).png().toFile(path.join(OUT, `diff-${la}-${lb}-${name}.png`))
    const fmt = (b) => ({ over24: +(100 * b.over / b.n).toFixed(4) + '%', largest: b.max, mean: +(b.sum / b.n).toFixed(4) })
    rows.push({ spot: name, everything: fmt(all), outsideCarBox: fmt(rest) })
  }
  console.log(JSON.stringify(rows, null, 1))
  process.exit(0)
}

const label = arg('label', 'run')
const browser = await launch()
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })).newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
await page.goto(BASE + '/archipelago/preview/index.html')
await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 300_000, polling: 100 })
await sleep(3000)
for (const [name, find] of SPOTS) {
  const placed = await page.evaluate((find) => {
    const a = window.__archipelago
    if (!find) return 'spawn'
    const arrival = a.driving.arrival({ group: null, x: find[0], z: find[1], name: 'spot' })
    if (!arrival.ok) return 'no arrival: ' + arrival.reason
    a.driving.place(arrival, { reason: 'travel' })
    return arrival.position.toArray().map((v) => Math.round(v * 10) / 10)
  }, find)
  console.log(name, JSON.stringify(placed))
  await sleep(2500)
  await page.screenshot({ path: path.join(OUT, `${label}-${name}.png`) })
}
console.log(errors.length ? 'ERRORS ' + errors.join(' | ') : 'no errors')
await browser.close()
