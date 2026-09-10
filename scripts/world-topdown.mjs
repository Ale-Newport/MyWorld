/**
 * scripts/world-topdown.mjs — the picture the map has to be judged on.
 *
 *   node scripts/world-topdown.mjs [baseUrl] [--out=.qa/world/topdown.png]
 *
 * Parks the camera straight down over the middle of the island at the
 * height the whole plan fits in, hides the car and the HUD, and saves
 * one frame. This is the image that gets put beside the hand-drawn map:
 * a third-person screenshot cannot answer "is the race on the left",
 * and that is the question this pass is judged on.
 *
 * Nothing here is a substitute for driving it. It is a substitute for
 * GUESSING whether the drawing was followed.
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const args = process.argv.slice(2)
const BASE = args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'
const OUT = args.find((a) => a.startsWith('--out='))?.slice(6) ?? '.qa/world/topdown.png'
/* 490 m, not 700: the island is 266 x 199.5 now and 700 framed the old
   380 x 285. `scripts/mapcal/compare.mjs` crops to the same number. */
const HEIGHT = Number(args.find((a) => a.startsWith('--height='))?.slice(9) ?? 490)
/** Optional `--at=x,z`: look straight down at somewhere other than the middle. */
const AT = (args.find((a) => a.startsWith('--at='))?.slice(5) ?? '0,0').split(',').map(Number)

await mkdir(path.dirname(path.resolve(OUT)), { recursive: true })

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 1050 }, deviceScaleFactor: 1 })
page.on('pageerror', (e) => console.log('PAGEERROR', e.message))

await page.goto(`${BASE}/world`, { waitUntil: 'networkidle' })
// The loader gates the world behind an ENTER, so the engine exists but
// the scene is not composited until it is pressed.
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'ENTER'),
  null, { timeout: 60000 },
)
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world), null, { timeout: 60000 })
// The world builds terrain, ecology and every venue synchronously, but
// the grass rings and the tree instancing settle over a few frames.
await page.waitForTimeout(6000)

const info = await page.evaluate(({ height, at }) => {
  const g = window.__world
  // Hide the things that are not the map: the car, its shadow, the
  // interaction prompt and the whole HUD.
  g.visualVehicle.group.visible = false
  // The HUD is a sibling of the canvas; hiding the overlay root is
  // enough and does not disturb the engine.
  for (const el of document.querySelectorAll('canvas ~ *')) el.style.display = 'none'
  /*
    NO FOG. The scene fogs out at about two hundred metres, which is
    correct for a camera twenty metres behind a car and useless for one
    seven hundred metres above the island: everything below the water
    goes the colour of the sky and the picture says nothing. Removed
    for the capture only — this script is not the game.
  */
  g.renderer.scene.fog = null
  if (g.grass?.setFog) g.grass.setFog(new (g.renderer.scene.background?.constructor ?? Object)(), 4000, 8000)
  const camera = g.view.camera
  const park = () => {
    camera.position.set(at[0], height, at[1] + 0.01)
    camera.up.set(0, 0, -1)
    camera.lookAt(at[0], 0, at[1])
    camera.updateMatrixWorld()
  }
  g.ticker.events.on('tick', park, 9)
  park()
  return { fov: camera.fov, far: camera.far }
}, { height: HEIGHT, at: AT })

await page.waitForTimeout(2500)
await page.screenshot({ path: OUT })
console.log(`wrote ${OUT}  (camera ${HEIGHT} m, fov ${info.fov}°)`)
await browser.close()
