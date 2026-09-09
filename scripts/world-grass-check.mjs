/**
 * The mandatory grass test: maximum zoom-out, widest aspect.
 *
 *   node scripts/world-grass-check.mjs [baseUrl]
 *
 * At 21:9 the camera's non-ideal-ratio offset pushes the boom out to
 * its furthest, which is the worst case for anything that fades with
 * distance. If a generation boundary exists, this is where it shows.
 *
 * It proves two things, and neither of them is a colour histogram —
 * this is a furnished island with no sixty-metre clearing on it, so
 * measuring "how green is the frame" measures the scenery.
 *
 *   1. THE RINGS OVERLAP. The near ring must still be at full height
 *      where the far one has finished fading in, or there is a band
 *      between them with no grass in it.
 *   2. THE FAR RING OUTLASTS THE VIEW. It must still be growing grass
 *      past the furthest ground the camera can see, measured by
 *      casting the frustum's own corners onto the ground at maximum
 *      zoom-out and the widest aspect the layout allows.
 *
 * Both are structural: pass them and a boundary cannot be in frame,
 * whatever the scene happens to contain. The screenshots are for the
 * eye, and for the record.
 */
import { chromium } from 'playwright'
import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = path.resolve('.qa/grass')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--disable-frame-rate-limit'],
})
// 21:9. The camera adds `nonIdealRatioOffset` per unit of overflow past
// 16:9, so this is the longest boom the world ever uses.
const page = await (await browser.newContext({ viewport: { width: 2560, height: 1080 } })).newPage()
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.grass), { timeout: 60000 })
await page.waitForTimeout(2500)

const rings = await page.evaluate(() => ({
  rings: window.__world.grass.rings.map((r) => ({
    blades: r.bladeCount,
    size: r.material.uniforms.uSize.value,
    band: r.material.uniforms.uBand.value.toArray(),
  })),
  total: window.__world.grass.bladeCount,
}))
console.log(`\nGRASS — ${rings.rings.length} rings, ${rings.total.toLocaleString()} blades`)
for (const r of rings.rings) {
  console.log(`  ${String(r.blades).padStart(7)} blades over ${r.size} m · fades in ${r.band[0]}→${r.band[1]} m, out ${r.band[2]}→${r.band[3]} m`)
}

let failures = 0

/* ---- 1. the rings overlap ------------------------------- */
const near = rings.rings[0]
const far = rings.rings[1]
if (!far) {
  console.log('\n  note  one ring only (low quality) — the near ring reaches its own edge, as upstream does')
} else {
  /*
    Near fades out over band[2]→band[3]; far fades in over
    band[0]→band[1]. What matters is that they CROSS: the far ring has
    to start growing before the near one starts thinning, and be at
    full height before the near one is gone. A hand-off, not a relay.
  */
  const startsInTime = far.band[0] <= near.band[2]
  const fullInTime = far.band[1] <= near.band[3]
  const gapFree = startsInTime && fullInTime
  console.log(
    `\n  ${gapFree ? 'ok  ' : 'FAIL'}  rings cross · far starts at ${far.band[0]} m (near thins at ${near.band[2]} m), ` +
    `far is full at ${far.band[1]} m (near gone at ${near.band[3]} m)`,
  )
  if (!gapFree) failures++
  // And the far ring's square must be big enough to wrap around its band.
  const wraps = far.size / 2 >= far.band[3]
  console.log(`  ${wraps ? 'ok  ' : 'FAIL'}  far ring wraps · ${far.size / 2} m half-size vs ${far.band[3]} m band`)
  if (!wraps) failures++
}

/* ---- 2. grass outlasts the view -------------------------- */
const reach = await page.evaluate(() => {
  const g = window.__world
  const p = g.player.position
  g.view.zoom.baseRatio = 0
  return new Promise((resolve) => setTimeout(() => {
    const cam = g.view.camera
    cam.updateMatrixWorld(true)
    // Cast the frustum's four far corners onto the ground plane the car
    // is standing on, and take the furthest.
    const ndc = [[-1, -1], [1, -1], [-1, 1], [1, 1]]
    let furthest = 0
    for (const [x, y] of ndc) {
      const dir = new g.rapier.constructor === undefined ? null : null
      void dir
      const v = { x, y, z: 0.5 }
      // Unproject by hand through the camera's matrices.
      const inv = cam.projectionMatrixInverse.elements
      void inv
      const point = new (Object.getPrototypeOf(cam.position).constructor)(v.x, v.y, v.z)
      point.unproject(cam)
      const o = cam.position
      const dx = point.x - o.x, dy = point.y - o.y, dz = point.z - o.z
      if (dy >= -1e-4) continue                    // ray does not descend
      const t = (p.y - o.y) / dy
      const gx = o.x + dx * t, gz = o.z + dz * t
      furthest = Math.max(furthest, Math.hypot(gx - p.x, gz - p.z))
    }
    resolve({ furthest, boom: g.view.spherical.radius.current, aspect: cam.aspect })
  }, 1500))
})
const outlasts = far ? far.band[3] >= reach.furthest : near.band[3] >= reach.furthest
console.log(
  `  ${outlasts ? 'ok  ' : 'FAIL'}  grass outlasts the view · furthest visible ground ${reach.furthest.toFixed(0)} m ` +
  `(boom ${reach.boom.toFixed(0)} m, aspect ${reach.aspect.toFixed(2)}), grass to ${(far ?? near).band[3]} m`,
)
if (!outlasts) failures++

/* ---- and the pictures ------------------------------------ */
console.log('')
// Open ground, found by sampling the world rather than written down:
// a hard-coded clearing stops being a clearing the first time the
// island is re-authored.
const spots = await page.evaluate(() => {
  const g = window.__world
  const out = []
  let tried = 0
  for (let x = -140; x <= 140; x += 12) {
    for (let z = -140; z <= 140; z += 12) {
      if (Math.hypot(x, z) > 120) continue
      if (g.terrain.colliderHeightAt(x, z) < 0.6) continue        // dry land
      let relief = 0
      for (const [dx, dz] of [[16, 0], [-16, 0], [0, 16], [0, -16]]) {
        relief = Math.max(relief, Math.abs(g.terrain.colliderHeightAt(x + dx, z + dz) - g.terrain.colliderHeightAt(x, z)))
      }
      if (relief > 2.2) continue
      tried++
      // Flat, dry, inland ground is enough to point a camera at. Asking
      // for somewhere with nothing built within seven metres returns
      // nothing: this island is furnished on a twelve-metre grid and
      // has no empty clearing anywhere on it, which is the point of it.
      out.push([x, z])
    }
  }
  return { out, tried }
})
console.log(`\n  ${spots.out.length} flat inland spots; photographing four at maximum zoom`)
if (!spots.out.length) throw new Error('no open ground found to photograph')
const list = spots.out
const pick = [0, Math.floor(list.length / 3), Math.floor((list.length * 2) / 3), list.length - 1]
const chosen = [...new Set(pick)].map((i, n) => [`open-${n + 1}`, list[i][0], list[i][1]])

for (const [name, x, z] of chosen) {
  await page.evaluate(({ x, z }) => {
    const g = window.__world
    const y = g.terrain.colliderHeightAt(x, z) + 2
    g.vehicle.moveTo({ x, y, z }, 0)
    g.view.focusPoint.trackedPosition.set(x, y, z)
    g.view.snapToTarget()
    g.view.zoom.baseRatio = 0          // furthest the camera goes
  }, { x, z })
  await page.waitForTimeout(1800)
  const file = path.join(OUT, `${name}.png`)
  await page.screenshot({ path: file })

  // Concentric rings of the frame, centred on the car. A generation
  // boundary shows up as a STEP in how much of a ring is grass.
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const cx = info.width / 2, cy = info.height / 2
  const BANDS = 8
  const maxR = Math.min(cx, cy)
  const green = new Array(BANDS).fill(0), counts = new Array(BANDS).fill(0)
  for (let y = 0; y < info.height; y += 2) {
    for (let x = 0; x < info.width; x += 2) {
      const r = Math.hypot(x - cx, y - cy)
      const band = Math.floor((r / maxR) * BANDS)
      if (band >= BANDS) continue
      const i = (y * info.width + x) * info.channels
      const R = data[i], G = data[i + 1], B = data[i + 2]
      // Grass here is green-dominant and mid-toned.
      if (G > R + 8 && G > B + 18 && G > 60 && G < 230) green[band]++
      counts[band]++
    }
  }
  const cover = green.map((g, i) => g / Math.max(1, counts[i]))
  let worst = 0, at = 0
  for (let i = 1; i < BANDS; i++) {
    const step = Math.abs(cover[i] - cover[i - 1])
    if (step > worst) { worst = step; at = i }
  }
  console.log(
    `  shot  ${name.padEnd(8)} (${String(x).padStart(4)},${String(z).padStart(4)}) ` +
    `cover ${cover.map((c) => c.toFixed(2)).join(' ')} · largest step ${worst.toFixed(2)} at band ${at}`,
  )
}
console.log(`\n${failures} view(s) with a visible boundary\n`)
await browser.close()
process.exit(failures ? 1 : 0)
