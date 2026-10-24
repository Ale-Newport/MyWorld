/* What does the player camera's near plane (0.5 m, main.js enterDrive; the editor keeps 0.1) clip? Nothing, if no rendered surface is ever that close to the camera.

     QA_BASE=http://localhost:3210 node scripts/qa/world-frame-near.mjs [--size 1440x900] [--out DIR]

   The near plane was raised from 0.1 to 0.5 for depth precision (the world's far plane is 800 m: five times the precision for the 2.5 cm decals and road slabs at distance). It would clip a surface
   closer than 0.5 m to the camera. Here a grid of 21 x 13 rays is cast from the camera through the picture, against every visible mesh the camera's layers draw, and the nearest hit is recorded in
   the situations whose camera is not the usual one: the chase camera at every spot, zoomed in to the minimum radius and out to the maximum and low and level; the Projects board's cinematic camera
   (landscape and portrait: a phone pulls it back); the plane, from the take-off to a cruise; and a phone's far zoom. Passes when nothing is within the near plane (and a margin) in any of them.
   Also a count of the samples, so a run that found no mode proves nothing. */
import { launch, BASE, sleep, assert, finish, watch } from './lib.mjs'
import { SPOTS } from './world-spots.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
const [W, H] = arg('size', '1440x900').split('x').map(Number)
const NEAR = 0.5, MARGIN = 0.1
const results = []
const browser = await launch()

const nearest = (page) => page.evaluate(() => {
  const A = __archipelago, T = A.THREE, cam = A.camera, list = []
  A.scene.traverseVisible((o) => { if ((o.isMesh || o.isLine || o.isPoints) && o.layers.test(cam.layers) && !o.userData.runtime_collider) list.push(o) })
  const rc = new T.Raycaster(); rc.far = 6; rc.near = 0; rc.layers.mask = cam.layers.mask
  let best = Infinity, who = ''
  for (let iy = 0; iy <= 12; iy++) for (let ix = 0; ix <= 20; ix++) {
    rc.setFromCamera({ x: ix / 10 - 1, y: iy / 6 - 1 }, cam)
    const hit = rc.intersectObjects(list, false)[0]
    if (hit && hit.distance < best) { best = hit.distance; const path = []; for (let p = hit.object; p && path.length < 3; p = p.parent) path.push(p.name || p.type); who = path.join('<') }
  }
  return { best, who, near: cam.near, meshes: list.length }
})

async function session(name, { width = W, height = H, dpr = 1, touch = false } = {}, run) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, ...(touch ? { hasTouch: true, isMobile: true } : {}) })
  const page = await ctx.newPage(), errors = watch(page)
  await page.goto(`${BASE}/archipelago/preview/index.html?qa`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 600_000 })
  await sleep(2500)
  const samples = []
  const sample = async (label) => { const r = await nearest(page); samples.push({ label, ...r }); return r }
  await run(page, sample)
  const closest = samples.reduce((a, b) => (b.best < a.best ? b : a), { best: Infinity })
  console.log(`  ${name}: ${samples.length} samples, near plane ${samples[0]?.near} m, closest surface ${closest.best.toFixed(2)} m (${closest.label}: ${closest.who})`)
  assert(samples.length >= 3 && samples.every((s) => s.near === NEAR), `${name}: sampled in the player camera (near ${NEAR})`, results)
  assert(closest.best > NEAR + MARGIN, `${name}: no surface within the near plane of ${NEAR} m (closest ${closest.best.toFixed(2)} m)`, results)
  assert(errors.length === 0, `${name}: no console errors ${errors.slice(0, 2).join(' | ')}`, results)
  await ctx.close()
}
/** The check must be able to see: a plate 0.3 m in front of the camera is found at 0.3 m. */
const selfTest = async (page) => {
  await page.evaluate(() => { const A = __archipelago, T = A.THREE, m = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ side: T.DoubleSide })); m.name = 'near-probe'; m.position.copy(A.camera.position).addScaledVector(A.camera.getWorldDirection(new T.Vector3()), .3); m.quaternion.copy(A.camera.quaternion); A.scene.add(m); m.updateMatrixWorld(true) })
  const r = await nearest(page)
  await page.evaluate(() => { const m = __archipelago.scene.getObjectByName('near-probe'); m.parent.remove(m); m.geometry.dispose(); m.material.dispose() })
  assert(Math.abs(r.best - .3) < .05 && r.who.startsWith('near-probe'), `the ray grid finds a plate 0.3 m in front of the camera (${r.best.toFixed(2)} m, ${r.who})`, results)
}
const goTo = (page, spot) => page.evaluate((spot) => { const d = __archipelago.driving, a = d.arrival({ group: null, x: spot.x, z: spot.z, name: spot.name ?? 'p' }); if (!a.ok) return false; d.place(a, { reason: 'travel' }); return true }, spot)
const pose = (page, p) => page.evaluate((p) => { const v = __archipelago.driving.view; if (p.zoom !== undefined) v.zoom.baseRatio = p.zoom; if (p.phi !== undefined) { v.spherical.targetPhi = p.phi; v.spherical.phi = p.phi } if (p.theta !== undefined) { v.spherical.targetTheta = p.theta; v.spherical.theta = p.theta } }, p)
const open = async (page) => {
  const p = await page.evaluate(() => { const g = __archipelago.gameplay; for (const i of g.instances) for (const item of i.prompts.items) if (item.label === 'Projects') { const w = item.group.getWorldPosition(new __archipelago.THREE.Vector3()); return { x: w.x, z: w.z } } return null })
  await page.evaluate((p) => { const d = __archipelago.driving; for (const radius of [2.3, 2.9, 3.5]) { const pose = d.placement.near(p.x, p.z, { radius, step: .5, margin: .3, dynamicMargin: .2, maxEdge: 4 }); if (pose) { d.place(pose, { reason: 'travel' }); return } } }, p)
  await sleep(1500); await page.evaluate(() => __archipelago.gameplay.interact()); await sleep(3500)
}

const PI = Math.PI
await session('chase camera, five spots, six poses', {}, async (page, sample) => {
  await selfTest(page)
  for (const [name, spot] of Object.entries(SPOTS)) {
    if (spot) await goTo(page, spot); await sleep(1500)
    for (const [label, p] of [['default', { zoom: .5, phi: .27 * PI, theta: .25 * PI }], ['zoom-in', { zoom: 1 }], ['zoom-out', { zoom: 0 }], ['level', { zoom: .5, phi: .43 * PI }], ['top-down', { phi: .04 * PI }], ['east', { phi: .27 * PI, theta: 1.0 * PI }]]) {
      await pose(page, p); await sleep(900); await sample(`${name} ${label}`)
    }
  }
})
await session('Projects cinematic, desktop', {}, async (page, sample) => { await open(page); for (let i = 0; i < 4; i++) { await sample('open ' + i); await page.evaluate(() => __archipelago.gameplay.active()?.parts.projects?.step(1)); await sleep(900); await sample('next ' + i) } })
await session('Projects cinematic, phone portrait', { width: 390, height: 844, dpr: 2, touch: true }, async (page, sample) => { await open(page); for (let i = 0; i < 4; i++) { await sample('open ' + i); await page.evaluate(() => __archipelago.gameplay.active()?.parts.projects?.step(1)); await sleep(900); await sample('next ' + i) } })
await session('plane, take-off to cruise', {}, async (page, sample) => {
  await page.keyboard.press('Space'); await sleep(250); await page.keyboard.press('Space'); await sleep(600)
  await page.keyboard.down('KeyW')
  for (let i = 0; i < 14; i++) { await sleep(500); await sample('flight ' + i) }
  await page.keyboard.up('KeyW'); await page.keyboard.press('Space'); await page.keyboard.press('Space')
})
await session('phone portrait, far zoom', { width: 390, height: 844, dpr: 2, touch: true }, async (page, sample) => {
  for (const [name, spot] of Object.entries(SPOTS)) { if (spot) await goTo(page, spot); await sleep(1200); await pose(page, { zoom: 0 }); await sleep(900); await sample(name + ' far'); await pose(page, { zoom: 1 }); await sleep(900); await sample(name + ' close') }
})
await browser.close()
finish(results)
