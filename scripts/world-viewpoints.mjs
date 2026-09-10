/**
 * THE TWELVE VIEWPOINTS — the pass's before-and-after plate.
 *
 *   node scripts/world-viewpoints.mjs [baseUrl] [outDir]
 *
 * A layout report is not a look. This puts the camera where a player's
 * camera actually goes — behind the car at each landmark, then high
 * above, then low beside the surfaces that are supposed to meet
 * cleanly — and saves a frame from each, so a change can be judged by
 * looking rather than by reading a number that says it should be fine.
 *
 * Default output is `.qa/viewpoints/`; pass a second argument to write
 * a "before" and an "after" set side by side.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'

const BASE = process.argv[2] ?? 'http://localhost:3000'
const OUT = process.argv[3] ?? '.qa/viewpoints'

/*
  Each shot is the car's position and heading, plus how the camera
  should sit behind it. `orbit` is a yaw offset applied to the chase
  camera so a shot can look ACROSS a surface rather than along it —
  a seam is invisible head-on and obvious at a grazing angle.
*/
const SHOTS = [
  { id: '01-landing-name', at: [30, 10], face: 0.2, lift: 1.0, note: 'the name, from the spawn' },
  { id: '02-circuit-lower-left', at: [-105, 71], face: -2.5, lift: 0.9, note: 'THE REPORTED DEFECT: lower-left circuit corner' },
  { id: '03-circuit-lower-left-low', at: [-105, 71], face: -2.5, lift: 0.12, note: 'same corner, grazing angle' },
  { id: '04-circuit-jump', at: [-72, 74], face: -2.2, lift: 0.8, note: 'the circuit ramp' },
  { id: '05-bowling-approach', at: [30, -71], face: 3.14, lift: 0.7, note: 'bowling, from the normal approach' },
  { id: '06-bowling-throw', at: [-2, -71], face: 3.14, lift: 0.5, note: 'bowling: lane + pins + screen together' },
  { id: '07-maze-entrance', at: [79, 8], face: 1.57, lift: 0.8, note: 'the maze mouth' },
  { id: '08-maze-inside', at: [79, 45], face: 0.6, lift: 0.5, note: 'inside the maze' },
  { id: '09-projects-approach', at: [55, -44], face: 0.35, lift: 0.8, note: 'projects, arriving by road' },
  { id: '10-projects-close', at: [68, -46], face: 0.3, lift: 0.4, note: 'projects, close enough to read' },
  { id: '11-road-terrain', at: [69, -40], face: 1.6, lift: 0.15, note: 'road/terrain transition, grazing' },
  { id: '12-ramp-east', at: [70, -20], face: 0.0, lift: 0.6, note: 'the east ramp and its approach' },
  { id: '13-water-transition', at: [56, 8], face: 2.4, lift: 0.2, note: 'river bank and ford' },
  { id: '14-beach', at: [100, 40], face: 0.9, lift: 0.25, note: 'beach and waterline' },
]

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await (await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1,
})).newPage()

await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.terrain), { timeout: 60000 })
await page.waitForTimeout(3000)

mkdirSync(OUT, { recursive: true })
const manifest = []

/** Put the car somewhere, let the world settle, and let the camera catch up. */
const place = async (x, z, face) => {
  await page.evaluate(({ x, z, face }) => {
    const g = window.__world
    const y = g.terrain.colliderHeightAt(x, z) + 2.5
    g.vehicle.moveTo({ x, y, z }, face)
    // Snap the focus point too. Without it the camera eases in from
    // wherever it was, and a frame taken 1.6 s later is a photograph
    // of the journey rather than of the place.
    g.view.focusPoint.trackedPosition.set(x, y, z)
    g.view.snapToTarget()
  }, { x, z, face })
  // Long enough for the suspension to settle and the chase camera to
  // ease in. A frame taken before that is a photograph of a transient.
  await page.waitForTimeout(1600)
}

for (const shot of SHOTS) {
  try {
    await place(shot.at[0], shot.at[1], shot.face)
    const state = await page.evaluate(() => {
      const g = window.__world
      const p = g.player.position
      return {
        car: [+p.x.toFixed(1), +p.y.toFixed(2), +p.z.toFixed(1)],
        ground: +g.terrain.colliderHeightAt(p.x, p.z).toFixed(2),
        district: g.store.getState().district ?? null,
      }
    })
    await page.screenshot({ path: `${OUT}/${shot.id}.png` })
    manifest.push({ ...shot, ...state })
    console.log(`  ${shot.id.padEnd(26)} car ${JSON.stringify(state.car).padEnd(22)} ground ${String(state.ground).padStart(6)}  ${shot.note}`)
  } catch (error) {
    console.log(`  ${shot.id.padEnd(26)} FAILED — ${error.message}`)
    manifest.push({ ...shot, error: String(error.message) })
  }
}

/* ---- and the two views a chase camera never gives you -------- */
try {
  // Maximum zoom-out, straight down. Built by hand rather than by
  // driving the game camera, because the game camera is deliberately
  // not allowed to go this far.
  await page.evaluate(() => {
    const g = window.__world
    const cam = g.view.camera
    // The chase camera is driven every tick, so a position written
    // here is overwritten before the frame is drawn. Detaching the
    // updater is the only way to hold the camera still; the flag is
    // restored by reloading, and this script reloads nothing after.
    g.view.enabled = false
    if (g.view.update) g.view.update = () => {}
    cam.far = 1400
    cam.position.set(0, 330, 0.001)
    cam.lookAt(0, 0, 0)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld(true)
  })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/15-topdown.png` })
  console.log('  15-topdown                 straight down from 330 m')

  await page.evaluate(() => {
    const g = window.__world
    const cam = g.view.camera
    cam.position.set(-150, 95, 150)
    cam.lookAt(-70, 0, 45)
    cam.updateMatrixWorld(true)
  })
  await page.waitForTimeout(900)
  await page.screenshot({ path: `${OUT}/16-circuit-oblique.png` })
  console.log('  16-circuit-oblique         the west of the island from above')
} catch (error) {
  console.log(`  aerial views FAILED — ${error.message}`)
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2))
await browser.close()
console.log(`\n${manifest.length} viewpoints → ${OUT}/\n`)
