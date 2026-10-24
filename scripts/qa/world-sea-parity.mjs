/* The sea must not change colour or show cracks when its mesh is simplified. Takes the same shots at the coast and of the map
   on two builds of the world (servers that differ only in ocean.js, e.g. world-static-server.mjs on two copies of public/archipelago)
   and reports how many pixels differ:  node scripts/qa/world-sea-parity.mjs http://127.0.0.1:3284 http://127.0.0.1:3283 [outDir]
   Grass sway and shadow edges move a little between two runs (under 0.3% of the pixels by more than 24/255 at the coast); a sea
   that is tinted differently, or a crack, is a block or a line of pixels, many times that. Exits 1 above 0.5%. */
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { launch, sleep } from './lib.mjs'
import { COAST_SPOTS } from './world-spots.mjs'

const [urlA, urlB, outDir = '.qa/runs/sea-parity'] = process.argv.slice(2)
if (!urlA || !urlB) throw new Error('usage: world-sea-parity.mjs <urlA> <urlB> [outDir]')
fs.mkdirSync(outDir, { recursive: true })
const PI = Math.PI
const POSES = [['default', {}], ['zoomout', { zoom: 0, phi: .3 * PI }], ['low', { phi: .4 * PI, zoom: 0, theta: .75 * PI }], ['west', { theta: 1.4 * PI, zoom: .2 }], ['top', { phi: .12 * PI, zoom: 0 }]]
const LIMIT = 0.5

async function shoot(base, label) {
  const browser = await launch(), page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })).newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  await page.goto(`${base}/archipelago/preview/index.html?qa`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
  await sleep(3500)
  const shots = []
  for (const [name, s] of Object.entries(COAST_SPOTS)) {
    const r = await page.evaluate((s) => { const d = __archipelago.driving, a = d.arrival({ group: null, x: s.x, z: s.z, name: s.name }); if (!a.ok) return a.reason; d.place(a, { reason: 'travel' }); return 'ok' }, s)
    if (r !== 'ok') { console.log(`${label} ${name}: ${r}`); continue }
    for (const [pose, p] of POSES) {
      await page.evaluate((p) => { const v = __archipelago.driving.view; v.spherical.targetPhi = p.phi ?? v.spherical.basePhi; v.spherical.targetTheta = p.theta ?? v.spherical.baseTheta; v.zoom.baseRatio = p.zoom ?? .4 }, p)
      await sleep(2600)
      const file = path.join(outDir, `${label}-${name}-${pose}.png`)
      await page.screenshot({ path: file }); shots.push([`${name}-${pose}`, file])
    }
  }
  await page.keyboard.press('KeyM'); await sleep(6000)
  const map = path.join(outDir, `${label}-map.png`); await page.screenshot({ path: map }); shots.push(['map', map])
  await browser.close()
  return { shots, errors }
}

async function differ(a, b, threshold) {
  const [x, y] = await Promise.all([a, b].map((p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true })))
  const { width, height, channels } = x.info
  let over = 0
  for (let i = 0; i < x.data.length; i += channels) if (Math.abs(x.data[i] - y.data[i]) + Math.abs(x.data[i + 1] - y.data[i + 1]) + Math.abs(x.data[i + 2] - y.data[i + 2]) > threshold) over++
  return 100 * over / (width * height)
}

const [A, B] = await Promise.all([shoot(urlA, 'a'), shoot(urlB, 'b')])
let worst = 0
for (const [name, file] of A.shots) {
  const other = B.shots.find(([n]) => n === name)?.[1]
  if (!other) { console.log(`${name}: missing in B`); worst = 100; continue }
  const d24 = await differ(file, other, 24); worst = Math.max(worst, d24)
  console.log(`${name.padEnd(22)} ${d24.toFixed(2)}% of pixels differ by more than 24`)
}
for (const [label, run] of [['a', A], ['b', B]]) if (run.errors.length) { console.log(`${label} errors:`, run.errors); worst = 100 }
console.log(worst <= LIMIT ? `PASS worst ${worst.toFixed(2)}% (limit ${LIMIT}%)` : `FAIL worst ${worst.toFixed(2)}% (limit ${LIMIT}%)`)
if (worst > LIMIT) process.exitCode = 1
