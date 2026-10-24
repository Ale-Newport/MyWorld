/* Achievement Plaza (/world), checked from the REAL gameplay camera in a real browser.

     QA_BASE=http://localhost:3210 node scripts/qa/world-plaza.mjs [flags]

   Suites (default: frames). Several can be given: --suite=frames,unlock,physics,cost,grid; `all` runs every one.
     frames   the car is put down with Driving.place() (the call map travel and R use) at the plaza's canonical poses:
              spawn (real map travel), prompt, dais, the north lanes, the west and east flanks and the trophy court. The
              zoom is pinned to the rest radius (21 m at 16:9), the page waits 4 frames, a screenshot is saved, and per pose:
                hiddenPoints  how many of 5 points of the car a ray from the camera cannot reach (opaque scenery first)
                plaza         where the title sign and the group boards are on screen: how many are fully inside the
                              frame, and the numerals' cap height in px (the plaza module's own measure())
              With --sizes the whole set repeats at 1920x1080, 1440x900, 1024x768, 844x390 and 390x844.
     grid     the occlusion statistic: every drivable 1 m cell of the plaza disc, camera at rest zoom, the share of
              drivable cells where >= 4 of 5 points of the car are hidden, and which object hides it
     unlock   the unlock-refresh test: unlocking an award while standing in the plaza must change the medals' colours
              (instanceColor) and the board numerals; localStorage's payload shape and the awards dialog stay as they were
     physics  the car climbs the dais from standing to 120 km/h without a launch, parks on it without touching the rim
     cost     renderer.info before/after the plaza is hidden (draw calls, triangles) and the module's own counts
     orbit    drag-orbit the camera: every medal must keep facing it; the signs are physical and stay put
     motion   the water, mist, bob and pop stop with prefers-reduced-motion and beyond 40 m
     lanes    the north approach: for each lane (x), how many metres of it hide the car (>= 4/5 points) between z = -30 and the disc
     north    the road in from the north, the acceptance repro: a car held on W down each lane (x = 74 ... 80) runs on to the arch (the banner
              poles and the trophy's pedestal are not in its way: it is stopped no earlier than at the document's own layout, 105), and the
              share of the car's pixels that reach the screen (shown against hidden, as `pixels`) is high all along the road, in the trophy
              court under the golden bowl, and on the east lane under the palm's crown. `--no-cut` shows what it was (the negative control)
     clearance every pair of solid things in the plaza that stand closer than 2.4 m (the car is 1.8 m wide)
     medals   the ring of medals is really on the screen: from the pond front, with awards unlocked, the frame with the medals
              against the frame without them differs by at least their own area, in the colours they should have (earned gold)
     pixels   the occlusion statistic again, but measured in PIXELS of the real frame instead of rays: for every cell the raycast says
              hides the car without the arch's see-through cut, the frame is rendered four times (the car shown / hidden, the arch
              shown / hidden) and the share of the car's pixels that reach the screen is the difference ratio of the pairs.
              A cell is hidden when under a quarter of the car shows. This is what proves the cut in the shader does what the
              rays assume it does (the rays cannot see a shader's discard: they use the same rule, AchievementsPlaza.cutFraction)

   Flags
     --label=NAME    sub-folder of the output (default 'run'); use 'before' and 'after' for the comparison pair
     --variant=before  the same world with this work taken out (HEAD's Achievements.js, no plaza module, and the working tree's
                     world2-gameplay.js and world2-catalog.js minus the plaza's few lines), so a before/after pair is made by the
                     same harness on the same world: `--variant=before --label=before` then `--label=after`
     --world=seed    (default) serve the shipped seed as the published world; --world=release uses whatever the QA
                     server has published (the local database's current revision has LOST the plaza instance, so
                     'release' prints a warning and skips when there is no plaza to look at)
     --sizes         the five viewports (otherwise 1440x900)
     --poses=a,b     only these poses
     --no-cut        switch the arch's see-through cut off (the same world as it was before the cut, for A/B)
     --no-assert     report only (the BEFORE run is expected to fail the acceptance numbers)
   Output: QA_OUT (default .qa/runs)/plaza/<label>/ plaza-<pose>-<WxH>.png and report.json. */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { launch, openPlayer, sleep, watch, OUT } from './lib.mjs'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => { const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`)); return hit === undefined ? fallback : hit.includes('=') ? hit.slice(name.length + 3) : true }
const SIZES = flag('sizes', false) ? [[1920, 1080], [1440, 900], [1024, 768], [844, 390], [390, 844]] : [[1440, 900]]
const SUITES = String(flag('suite', 'frames')).split(',').flatMap((name) => (name === 'all' ? ['frames', 'grid', 'pixels', 'medals', 'unlock', 'physics', 'cost', 'orbit', 'motion', 'lanes', 'north', 'clearance'] : [name]))
const LABEL = String(flag('label', 'run'))
const WORLD = String(flag('world', 'seed'))
const ONLY = flag('poses', null) ? String(flag('poses')).split(',') : null
const ASSERT = !flag('no-assert', false)
const NOCUT = flag('no-cut', false)
const VARIANT = String(flag('variant', 'after'))
const SPEEDS = String(flag('speeds', '0,20,40,80,120')).split(',').map(Number)
const DIR = path.join(OUT, 'plaza', LABEL)
fs.mkdirSync(DIR, { recursive: true })
const shot = (name) => path.join(DIR, name)

/** The plaza centre in the world document (experience group "Achievements Plaza"); +x east, +z south. */
const OX = 78.1207, OZ = 117.39
/** heading = atan2(-dz, dx) of the nose direction (runtime/placement.js headingOf). */
const heading = (dx, dz) => Math.atan2(-dz, dx)
const NW = heading(-1, -1), N = heading(0, -1), S = heading(0, 1)
/** [name, plaza x, plaza z, heading] in plaza metres. 'spawn' and 'prompt' are resolved in the page. */
const POSES = [
  ['spawn', null, null, null],
  ['prompt', null, null, NW],
  ['dais', 6.6, 13.0, NW],
  ['pond-front', 1.2, 9.8, NW],
  ['north-x74', 74 - OX, 100 - OZ, S],
  ['north-x74-near', 72 - OX, 104 - OZ, S],
  ['north-x82', 82 - OX, 100 - OZ, S],
  ['north-x78', 78 - OX, 100 - OZ, S],
  ['north-x78-near', 78 - OX, 103 - OZ, S],
  ['north-x80', 80 - OX, 99 - OZ, S],
  ['east-palm', 88 - OX, 116.4 - OZ, S],
  ['west-flank', -8.5, -2, N],
  ['east-flank', 10, -4, S],
  ['trophy-court', 0.5, -16.5, S],
]

const results = []
let failed = 0
const check = (ok, message, detail) => {
  results.push({ ok: !!ok, message, detail })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${message}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`)
}

/** The shipped seed as the published world (the QA server's own database may have lost the plaza). */
async function routeWorld(page) {
  if (WORLD === 'seed') {
    const seed = JSON.parse(fs.readFileSync(path.resolve('src/server/world-seed.json'), 'utf8'))
    await page.route('**/api/world/release', (r) => r.fulfill({ json: { revision: null, publishedAt: null, world: { url: seed.world.path, sha: seed.world.sha, size: seed.world.size }, assets: { url: seed.assets.path, sha: seed.assets.sha, size: seed.assets.size } } }))
  }
  if (VARIANT !== 'before') return
  // The world as it was before this work: the three modules this work touches, served as they were.
  const preview = 'public/archipelago/preview'
  const working = (rel) => fs.readFileSync(path.resolve(preview, rel), 'utf8')
  const without = (text, pieces) => pieces.reduce((out, [from, to = '']) => { if (!out.includes(from)) throw new Error(`variant=before: cannot find ${from.slice(0, 60)}`); return out.replace(from, to) }, text)
  const served = {
    '**/portfolio/world2/interactions/Achievements.js': execFileSync('git', ['show', `HEAD:${preview}/portfolio/world2/interactions/Achievements.js`], { maxBuffer: 1 << 26 }).toString(),
    '**/world2-gameplay.js': without(working('world2-gameplay.js'), [
      [',plaza:true'], ['a.follow(manager.achievements);'],
      ['  // The document\'s own props around the Achievement plaza are re-seated for the fixed camera (player only; see AchievementsPlaza.adjustWorld).\n  for(const instance of this.instances)instance.parts.achievements?.plaza?.adjustWorld(root,physics,driving);\n'],
    ]),
    '**/world2-catalog.js': without(working('world2-catalog.js'), [
      ["\nimport {plazaArrival} from './portfolio/world2/interactions/PlazaLayout.js';"],
      ["const seat=entry.id==='achievements'?plazaArrival(entry.anchor,source.position[1]):source;const p=new THREE.Vector3(...seat.position)", 'const p=new THREE.Vector3(...source.position)'],
      ['Math.cos(seat.rotation),0,-Math.sin(seat.rotation)', 'Math.cos(source.rotation),0,-Math.sin(source.rotation)'],
    ]),
  }
  for (const [pattern, body] of Object.entries(served)) await page.route(pattern, (r) => r.fulfill({ contentType: 'text/javascript; charset=utf-8', body }))
}

async function open(width, height, { reduced = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: reduced ? 'reduce' : 'no-preference' })
  const errors = watch(page)
  await routeWorld(page)
  await openPlayer(page)
  await sleep(1200)
  const has = await page.evaluate(() => !!globalThis.__archipelago.gameplay.instances.find((i) => i.parts.achievements))
  if (!has) { console.log('WARNING: this world has no Achievements plaza instance (use --world=seed)'); await page.close(); return null }
  if (NOCUT) await page.evaluate(() => { const p = globalThis.__archipelago.gameplay.instances.find((i) => i.parts.achievements).parts.achievements.plaza; if (p?.cut) p.cut.enabled = false })
  return { page, errors }
}

/** In the page: everything the harness needs from the plaza, created once. */
const INSTALL = () => {
  const A = globalThis.__archipelago, T = A.THREE, d = A.driving
  const plazaInstance = () => A.gameplay.instances.find((i) => i.parts.achievements)
  const lib = {
    instance: plazaInstance,
    plaza: () => plazaInstance().parts.achievements.plaza ?? null,
    /** Every opaque, visible mesh within 60 m of the plaza (what can stand between the camera and the car). */
    occluders() {
      if (lib._occluders) return lib._occluders
      const c = new T.Vector3(78.12, 0, 117.39), carRoot = d.visual.group, list = []
      A.scene.updateMatrixWorld(true)
      A.scene.traverse((o) => {
        if (!o.isMesh || !o.visible || o.isSprite) return
        for (let p = o; p; p = p.parent) if (!p.visible || p === carRoot) return
        const m = Array.isArray(o.material) ? o.material[0] : o.material
        if (!m || m.transparent || m.opacity < 1 || m.colorWrite === false || m.depthWrite === false || o.userData?.editorOnly) return
        if (o.layers.mask !== 1 && !(o.layers.mask & 1)) return
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere()
        const s = o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld)
        if (o.isInstancedMesh ? false : Math.hypot(s.center.x - c.x, s.center.z - c.z) - s.radius > 60) return
        if (o.isInstancedMesh && Math.hypot(o.matrixWorld.elements[12] - c.x, o.matrixWorld.elements[14] - c.z) > 400) return
        list.push(o)
      })
      return lib._occluders = list
    },
    /**
     * How many of 5 points of the car a ray from the camera cannot reach. Stone the arch cuts away (plaza.cut, the shader's own
     * rule) is not an obstacle: the ray goes on to what is behind it. `lib.cutOff = true` ignores the cut (the world before it).
     */
    hidden(detail) {
      const cam = A.camera.position, car = d.vehicle.position, ray = new T.Raycaster(), list = lib.occluders(), plaza = lib.plaza()
      const cut = !lib.cutOff && plaza?.cut?.enabled ? plaza : null
      let blocked = 0
      const by = {}
      for (const [dx, dy, dz] of [[0, 0.5, 0], [1, 0.5, 0], [-1, 0.5, 0], [0, 1.3, 0], [0, 0.3, 0.8]]) {
        const target = car.clone().add(new T.Vector3(dx, dy, dz)), dir = target.clone().sub(cam), dist = dir.length()
        ray.set(cam, dir.normalize()); ray.far = dist - 0.3
        const hit = ray.intersectObjects(list, false).find((h) => !(cut && cut.isCut(h.object) && cut.cutFraction(h.point, cam, car) >= 0.999))
        if (hit) {
          blocked++
          if (detail) { let o = hit.object, name = o.name || o.userData.w2Source || o.type; for (let p = o; p; p = p.parent) { if (p.userData?.aw_id || p.userData?.w2Source === 'achievements') { name = p.name || p.userData.w2Source; break } } by[name] = (by[name] ?? 0) + 1 }
        }
      }
      return detail ? { blocked, by } : blocked
    },
    async frames(n = 4) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(r)) },
    async put(x, z, h) {
      const pose = d.placement.check(x, z, h, { dynamicMargin: 0, soft: false })
      if (!pose.ok) return { ok: false, reason: pose.reason, blocker: pose.name ?? null }
      d.place(pose, { reason: 'travel' })
      d.view.zoom.baseRatio = d.view.zoom.smoothedRatio = 0.6
      await lib.frames(4)
      return { ok: true }
    },
    prompt() { const it = plazaInstance().prompts.items.find((i) => i.label === 'Achievements'); if (!it) return null; const w = plazaInstance().physics.point({ x: it.at.x, y: 0, z: it.at.y }); return { x: w.x, z: w.z } },
    /** Screen box (px) of a world-space point list. */
    project(points) {
      const r = A.renderer.domElement.getBoundingClientRect(), v = new T.Vector3()
      const xs = [], ys = []
      let behind = false
      for (const p of points) { v.copy(p).project(A.camera); if (v.z > 1) behind = true; xs.push((v.x * 0.5 + 0.5) * r.width); ys.push((-v.y * 0.5 + 0.5) * r.height) }
      return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), w: r.width, h: r.height, behind }
    },
    /** Screen box of everything within 2.6 m of the car, padded: the rectangle both frames of a car-pixel measure are compared in. */
    carBox() {
      const c = d.vehicle.position, pts = []
      for (const x of [-2.6, 2.6]) for (const y of [-0.6, 1.6]) for (const z of [-2.6, 2.6]) pts.push(new T.Vector3(c.x + x, c.y + y, c.z + z))
      const b = lib.project(pts)
      const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0))
      return { x: x0, y: y0, width: Math.max(8, Math.min(b.w, Math.ceil(b.x1)) - x0), height: Math.max(8, Math.min(b.h, Math.ceil(b.y1)) - y0) }
    },
    carShown(on) { d.visual.group.visible = on },
  }
  globalThis.__plazaQA = lib
}

/** Signage on screen: which of the title and the boards are fully inside the frame, and the numerals' cap height in px. */
const SIGNAGE = () => {
  const lib = globalThis.__plazaQA, plaza = lib.plaza()
  if (!plaza?.measure) return null
  const items = plaza.measure()
  return items.map((it) => {
    const box = lib.project(it.corners)
    const inside = !box.behind && box.x0 >= 0 && box.y0 >= 0 && box.x1 <= box.w && box.y1 <= box.h
    const faceH = box.y1 - box.y0
    return { name: it.name, inside, w: Math.round(box.x1 - box.x0), h: Math.round(faceH), capPx: it.capFraction === undefined || !inside ? undefined : +(faceH * it.capFraction).toFixed(1), box: [box.x0, box.y0, box.x1, box.y1].map(Math.round) }
  })
}

/**
 * The pixels of the car that reach the screen with the car at a world cell (x, z): the frame with the car against the same frame without it
 * (the car's group switched off), within the box round the car. `pixels` counts the pixels that differ by more than 36 in their summed RGB
 * (the car's own, and its shadow's edge). The camera distance is read too, so shares can be compared at different zoom.
 * Needs the harness installed (INSTALL) and `sharp`. Null when the cell is refused.
 */
async function carPixels(page, sharp, x, z, heading = 2.356) {
  const put = await page.evaluate(([x, z, h]) => globalThis.__plazaQA.put(x, z, h), [x, z, heading])
  if (!put.ok) return null
  await sleep(500)
  const grab = async (clip) => sharp(await page.screenshot({ clip })).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const changed = (a, b) => { let n = 0; for (let i = 0; i < a.data.length; i += 3) if (Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]) > 36) n++; return n }
  const frames = () => page.evaluate(() => globalThis.__plazaQA.frames(4))
  const clip = await page.evaluate(() => globalThis.__plazaQA.carBox())
  const shown = await grab(clip)
  await page.evaluate(() => globalThis.__plazaQA.carShown(false)); await frames()
  const hidden = await grab(clip)
  await page.evaluate(() => globalThis.__plazaQA.carShown(true)); await frames()
  const radius = await page.evaluate(() => globalThis.__archipelago.camera.position.distanceTo(globalThis.__archipelago.driving.vehicle.position))
  return { clip, pixels: changed(shown, hidden), radius, x: put.x ?? x, z: put.z ?? z }
}

const browser = await launch()

/* ================================================================ frames */
if (SUITES.includes('frames')) {
  for (const [W, H] of SIZES) {
    const ctx = await open(W, H)
    if (!ctx) { check(false, `${W}x${H}: the world has a plaza`); continue }
    const { page, errors } = ctx
    await page.evaluate(INSTALL)
    for (const [name, px, pz, h] of POSES) {
      if (ONLY && !ONLY.includes(name)) continue
      let info
      if (name === 'spawn') {
        // The real thing: M, the Achievements pin, the arrival Driving chooses.
        await page.keyboard.press('KeyM')
        await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
        await sleep(300)
        const pin = page.locator('.atlas-pin[aria-label^="Travel to Achievements"]').first()
        await pin.waitFor({ timeout: 5000 }).catch(() => {})
        if (await pin.count()) { const dot = await pin.locator('i').boundingBox(); await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2) } else await page.keyboard.press('Escape')
        await page.evaluate(() => globalThis.__plazaQA.frames(6))
        await page.evaluate(() => { const A = globalThis.__archipelago; A.driving.view.zoom.baseRatio = A.driving.view.zoom.smoothedRatio = 0.6 })
        await page.evaluate(() => globalThis.__plazaQA.frames(4))
        info = await page.evaluate(() => { const v = globalThis.__archipelago.driving.vehicle.position; return { ok: true, x: +v.x.toFixed(2), z: +v.z.toFixed(2) } })
      } else if (name === 'prompt') {
        // The car where it stops to read the boards: 1.2 m up the screen from the middle of the dais (the marker is above its middle, so
        // the prompt is open), in the mouth of the gate.
        const at = await page.evaluate(() => globalThis.__plazaQA.prompt())
        // (The world before the plaza has no dais: the car goes beside the authored prompt instead.)
        info = at ? await page.evaluate(([heading, at]) => { const w = globalThis.__plazaQA.plaza()?.dais.world ?? at; return globalThis.__plazaQA.put(w.x - 0.8485, w.z - 0.8485, heading) }, [h, at]) : { ok: false, reason: 'no Achievements prompt' }
      } else info = await page.evaluate(([x, z, h]) => globalThis.__plazaQA.put(x, z, h), [OX + px, OZ + pz, h])
      if (!info.ok) { console.log(`${name.padEnd(16)} ${W}x${H} refused: ${info.reason} ${info.blocker ?? ''}`); results.push({ name, size: `${W}x${H}`, ...info }); continue }
      await sleep(450)
      const stats = await page.evaluate(() => { const A = globalThis.__archipelago, v = A.driving.vehicle.position; return { x: +v.x.toFixed(1), z: +v.z.toFixed(1), radius: +A.camera.position.distanceTo(v).toFixed(1), hiddenPoints: globalThis.__plazaQA.hidden(), of: 5 } })
      stats.signage = await page.evaluate(SIGNAGE)
      await page.screenshot({ path: shot(`plaza-${name}-${W}x${H}.png`) })
      const row = { name, size: `${W}x${H}`, ...info, ...stats }
      results.push(row)
      const sign = stats.signage ? ` signage in frame ${stats.signage.filter((s) => s.inside).length}/${stats.signage.length}${stats.signage.length ? ' numeral cap px ' + stats.signage.filter((s) => s.capPx !== undefined).map((s) => s.capPx).join(',') : ''}` : ''
      console.log(`${name.padEnd(16)} ${W}x${H} car (${stats.x}, ${stats.z}) r=${stats.radius} hidden ${stats.hiddenPoints}/5${sign}`)
      if (ASSERT) {
        // The road in from the north, the trophy court and the east lane under the palm: the car is not hidden there either (rays; the `north`
        // suite measures it in pixels).
        if (/^(north-|trophy-court|east-palm)/.test(name) && W === 1440) check(stats.hiddenPoints < 4, `${name} ${W}x${H}: the car is not hidden (${stats.hiddenPoints}/5 points)`)
        // The stage: the arrival, the prompt and the dais are never hidden, and show the signs the way the brief says.
        if (['spawn', 'prompt', 'dais'].includes(name)) {
          check(stats.hiddenPoints < 4, `${name} ${W}x${H}: the car is not hidden (${stats.hiddenPoints}/5 points)`)
          const signs = stats.signage ?? []
          const title = signs.find((x) => x.name === 'plaza-title'), boards = signs.filter((x) => x.name !== 'plaza-title')
          if (W >= 844 && H >= 390 && W > H) {
            check(!!title?.inside && boards.filter((x) => x.inside).length >= 3, `${name} ${W}x${H}: the title and at least 3 of the 4 group boards are fully in the frame (${signs.filter((x) => x.inside).length}/5)`)
            // 38 px at 1080p; the same share of the window's height below that, and 14 px on a phone held sideways.
            const need = H >= 1000 ? 38 : H >= 700 ? Math.round((38 * H) / 1080) : 14
            const caps = boards.filter((x) => x.inside).map((x) => x.capPx)
            check(caps.length > 0 && Math.min(...caps) >= need, `${name} ${W}x${H}: the numerals are >= ${need} px tall (${caps.join(', ')})`)
          }
          if (H > W) {
            const caps = boards.filter((x) => x.inside).map((x) => x.capPx)
            check(caps.length >= 1 && Math.min(...caps) >= 14, `${name} ${W}x${H} (phone): the boards in view read >= 14 px (${caps.join(', ')})`)
          }
        }
      }
    }
    check(errors.length === 0, `${W}x${H}: no console errors`, errors.slice(0, 3))
    await page.close()
  }
  fs.writeFileSync(shot('frames.json'), JSON.stringify(results.filter((r) => r.name), null, 1))
}

/* ================================================================ grid (occlusion statistic) */
if (SUITES.includes('grid')) {
  const ctx = await open(1920, 1080)
  if (ctx) {
    const { page } = ctx
    await page.evaluate(INSTALL)
    const report = await page.evaluate(async ([OX, OZ]) => {
      const lib = globalThis.__plazaQA, rows = []
      for (let dz = -13; dz <= 13; dz++) for (let dx = -13; dx <= 13; dx++) {
        if (Math.hypot(dx, dz) > 13) continue
        // Heading NW: whichever way the car points, the camera is fixed; only the cell matters.
        const r = await lib.put(OX + dx, OZ + dz, 2.356)
        if (!r.ok) { rows.push({ dx, dz, drivable: false }); continue }
        const h = lib.hidden(true)
        rows.push({ dx, dz, drivable: true, hidden: h.blocked, by: h.blocked >= 4 ? Object.entries(h.by).sort((a, b) => b[1] - a[1])[0][0] : undefined })
      }
      const drivable = rows.filter((r) => r.drivable)
      const hiddenCells = drivable.filter((r) => r.hidden >= 4)
      return { cells: rows.length, drivable: drivable.length, hiddenCells: hiddenCells.length, share: hiddenCells.length / Math.max(1, drivable.length), map: rows }
    }, [OX, OZ])
    fs.writeFileSync(shot('grid.json'), JSON.stringify(report))
    console.log(`grid: ${report.cells} cells, ${report.drivable} drivable, ${report.hiddenCells} with the car hidden (>= 4/5) = ${(report.share * 100).toFixed(1)} %`)
    results.push({ name: 'grid', ...report, map: undefined })
    // What is left is behind the arch itself (a 9 m asset this work does not move): which object hides each cell is in grid.json (`by`).
    const by = {}
    for (const cell of report.map) if (cell.by) by[cell.by] = (by[cell.by] ?? 0) + 1
    console.log('  hidden cells by the object in front of the car:', JSON.stringify(by))
    const beforeGrid = path.join(OUT, 'plaza', 'before', 'grid.json')
    if (ASSERT && VARIANT !== 'before' && fs.existsSync(beforeGrid)) {
      const before = JSON.parse(fs.readFileSync(beforeGrid, 'utf8'))
      check(report.share < before.share, `the share of drivable plaza ground where the car is hidden fell from ${(before.share * 100).toFixed(1)} % to ${(report.share * 100).toFixed(1)} %`)
    }
    check(!report.map.some((cell) => cell.by && !/^(achievements|World2 \/ plaza)/.test(cell.by)), 'every cell that still hides the car is behind the arch asset (or its gold finial), never behind a prop or a tree')
    if (ASSERT && !NOCUT) check(report.share <= 0.05, `the audit's target: the car hidden on <= 5 % of the drivable plaza ground (${(report.share * 100).toFixed(1)} %)`)
    await ctx.page.close()
  }
}

/* ================================================================ pixels (the cut, measured on the screen) */
if (SUITES.includes('pixels')) {
  const ctx = await open(1920, 1080)
  if (ctx) {
    const { default: sharp } = await import('sharp')
    const { page } = ctx
    await page.evaluate(INSTALL)
    // Which cells hide the car for the rays when the arch's cut is not counted.
    const cells = await page.evaluate(async ([OX, OZ]) => {
      const lib = globalThis.__plazaQA, rows = []
      lib.cutOff = true
      for (let dz = -13; dz <= 13; dz++) for (let dx = -13; dx <= 13; dx++) {
        if (Math.hypot(dx, dz) > 13) continue
        const r = await lib.put(OX + dx, OZ + dz, 2.356)
        if (r.ok) rows.push({ dx, dz, rays: lib.hidden() })
      }
      lib.cutOff = false
      return rows
    }, [OX, OZ])
    const behind = cells.filter((c) => c.rays >= 4), open_ = cells.filter((c) => c.rays < 4)
    const sample = open_.filter((_, i) => i % Math.max(1, Math.floor(open_.length / 14)) === 0)
    console.log(`pixels: ${cells.length} drivable cells, ${behind.length} hide the car from the rays when the cut is not counted; measuring those and ${sample.length} others`)
    /** The pixels of the car that reach the screen at a cell: the frame with the car against the frame without it. */
    const measure = async (dx, dz, heading = 2.356) => carPixels(page, sharp, OX + dx, OZ + dz, heading)
    // The reference: the car in the open, in the middle of the dais, where nothing is in front of it.
    const dais = await page.evaluate(() => { const w = globalThis.__plazaQA.plaza().dais.world; return { dx: w.x - 78.1207, dz: w.z - 117.39 } })
    const reference = await measure(dais.dx, dais.dz)
    console.log(`  reference (the car on the dais, nothing in front): ${reference.pixels} px changed by the car`)
    const rows = []
    for (const [group, list] of [['behind the arch', behind], ['elsewhere', sample]]) {
      for (const cell of list) {
        const m = await measure(cell.dx, cell.dz)
        if (!m) continue
        const share = m.pixels / reference.pixels
        rows.push({ group, dx: cell.dx, dz: cell.dz, rays: cell.rays, pixels: m.pixels, share: +share.toFixed(2) })
        if (share < 0.5 && ctx) await page.screenshot({ path: shot(`pixels-hidden-${cell.dx}_${cell.dz}.png`) })
      }
    }
    fs.writeFileSync(shot('pixels.json'), JSON.stringify({ reference: reference.pixels, rows }, null, 1))
    for (const group of ['behind the arch', 'elsewhere']) {
      const list = rows.filter((r) => r.group === group), lowest = list.length ? Math.min(...list.map((r) => r.share)) : 1
      const seen = list.filter((r) => r.share >= 0.25).length
      console.log(`  ${group}: ${seen}/${list.length} cells show at least a quarter of the car's pixels, the worst shows ${(lowest * 100).toFixed(0)} % (cells under a quarter: ${list.filter((r) => r.share < 0.25).map((r) => `(${r.dx},${r.dz}) ${r.share}`).join(' ') || 'none'})`)
      if (ASSERT && !NOCUT) check(seen === list.length, `${group}: the car shows on the screen (>= a quarter of its pixels) in all ${list.length} measured cells`)
    }
    if (ASSERT && !NOCUT) {
      const list = rows.filter((r) => r.group === 'behind the arch')
      check(list.length === 0 || list.reduce((n, r) => n + r.share, 0) / list.length >= 0.7, `behind the arch the cut shows the car almost whole (mean ${(list.reduce((n, r) => n + r.share, 0) / Math.max(1, list.length) * 100).toFixed(0)} % of its pixels)`)
    }
    results.push({ name: 'pixels', cells: cells.length, behind: behind.length, reference: reference.pixels })
    await ctx.page.close()
  }
}

/* ================================================================ medals (really drawn, in their colours) */
if (SUITES.includes('medals')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { default: sharp } = await import('sharp')
    const { page, errors } = ctx
    await page.evaluate(INSTALL)
    await page.evaluate(() => localStorage.removeItem('helloworld-world2-achievements-v1'))
    const put = await page.evaluate(([x, z]) => globalThis.__plazaQA.put(x, z, 2.356), [OX + 1.2, OZ + 9.8])
    check(put.ok, 'the car is at the pond front', put.reason)
    // The screen box of the whole ring.
    const box = await page.evaluate(() => {
      const lib = globalThis.__plazaQA, A = globalThis.__archipelago, T = A.THREE, a = lib.plaza().owner, pts = []
      a.glyphs.updateWorldMatrix(true, false)
      for (const p of a.medalAt) for (const d of [[-0.5, -0.5], [0.5, 0.5]]) pts.push(new T.Vector3(p.x + d[0], p.y + d[1], p.z).applyMatrix4(a.glyphs.matrixWorld))
      const b = lib.project(pts)
      const x0 = Math.max(0, Math.floor(b.x0)), y0 = Math.max(0, Math.floor(b.y0))
      return { x: x0, y: y0, width: Math.min(b.w, Math.ceil(b.x1)) - x0, height: Math.min(b.h, Math.ceil(b.y1)) - y0 }
    })
    const grab = async () => sharp(await page.screenshot({ clip: box })).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const frames = () => page.evaluate(() => globalThis.__plazaQA.frames(5))
    const measure = async () => {
      const shown = await grab()
      await page.evaluate(() => { globalThis.__plazaQA.plaza().owner.glyphs.visible = false }); await frames()
      const hidden = await grab()
      await page.evaluate(() => { globalThis.__plazaQA.plaza().owner.glyphs.visible = true }); await frames()
      let changed = 0, gold = 0
      for (let i = 0; i < shown.data.length; i += 3) {
        const d = Math.abs(shown.data[i] - hidden.data[i]) + Math.abs(shown.data[i + 1] - hidden.data[i + 1]) + Math.abs(shown.data[i + 2] - hidden.data[i + 2])
        if (d <= 40) continue
        changed++
        const [r, g, b] = [shown.data[i], shown.data[i + 1], shown.data[i + 2]]
        if (r > 190 && g > 130 && g < 215 && b < 90 && r - b > 120) gold++
      }
      return { changed, gold }
    }
    await frames()
    const locked = await measure()
    await page.evaluate(() => { const g = globalThis.__archipelago.gameplay; [...g.achievements.groups.keys()].filter((_, i) => i % 3 === 0).forEach((id) => g.achievements.unlock(id)) })
    await sleep(1200)
    const earned = await measure()
    await page.screenshot({ path: shot('medals-pond.png') })
    console.log('medals: locked', JSON.stringify(locked), 'after 11 unlocks', JSON.stringify(earned), 'box', JSON.stringify(box))
    // 31 medals of 0.56 m: at least 150 px each once it is on the screen (a medal is about 40 x 40 px here).
    check(locked.changed >= 31 * 150, `the medals are drawn: ${locked.changed} px of the pond frame are theirs (>= ${31 * 150})`)
    check(locked.gold < 200, `locked medals are not gold (${locked.gold} gold px)`)
    check(earned.gold >= 11 * 250, `eleven earned medals show gold: ${earned.gold} gold px (>= ${11 * 250})`)
    check(errors.length === 0, 'no console errors', errors.slice(0, 3))
    await ctx.page.close()
  }
}

/* ================================================================ unlock */
if (SUITES.includes('unlock')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { page, errors } = ctx
    const read = () => page.evaluate(() => {
      const A = globalThis.__archipelago, g = A.gameplay, i = g.instances.find((x) => x.parts.achievements), a = i.parts.achievements
      return { colours: [...a.glyphs.instanceColor.array], payload: localStorage.getItem('helloworld-world2-achievements-v1'), plaza: a.plaza?.snapshot?.() ?? null, awards: (document.querySelector('#awards-list')?.children.length ?? 0) }
    })
    await page.evaluate(() => localStorage.removeItem('helloworld-world2-achievements-v1'))
    const before = await read()
    await page.evaluate(() => globalThis.__archipelago.gameplay.achievements.unlock('lab'))
    await sleep(120)
    const mid = await read()
    const same = before.colours.join() === mid.colours.join()
    check(!same, `unlocking 'lab' changes the medals' instanceColor (the audit snippet is ${same}; it must be false)`)
    const changed = before.colours.map((c, i) => c === mid.colours[i] ? -1 : Math.floor(i / 3)).filter((v) => v >= 0)
    check(new Set(changed).size === 1, `exactly one medal changed colour (${[...new Set(changed)].join(',')})`)
    if (before.plaza && mid.plaza) check(JSON.stringify(before.plaza) !== JSON.stringify(mid.plaza), 'the boards refreshed their numerals', { before: before.plaza, after: mid.plaza })
    const pay = (s) => { const o = JSON.parse(s ?? 'null'); return o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? 'set' : typeof v])) }
    check(JSON.stringify(pay(mid.payload)) === JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(mid.payload)).map((k) => [k, Array.isArray(JSON.parse(mid.payload)[k]) ? 'set' : 'number']))) && Object.keys(JSON.parse(mid.payload)).length === 31, 'localStorage keeps its payload shape (31 ids, number or id-list)')
    check(JSON.parse(mid.payload).lab === 1, 'and records the unlock (lab = 1)')
    // The dialog, unchanged: 31 rows, the unlocked one marked.
    await page.evaluate(() => globalThis.__archipelago.gameplay.ui.achievements())
    await sleep(200)
    const dialog = await page.evaluate(() => ({ rows: document.querySelector('#awards-list')?.children.length, text: [...document.querySelectorAll('#awards-list > *')].slice(0, 3).map((e) => e.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)) }))
    check(dialog.rows === 31, 'the awards dialog still lists 31 rows', dialog)
    await page.screenshot({ path: shot('unlock-dialog.png') })
    await page.keyboard.press('Escape')
    // The reset path fires the same event and puts the colours back.
    await page.evaluate(() => globalThis.__archipelago.gameplay.achievements.reset())
    await sleep(120)
    const reset = await read()
    check(reset.colours.join() === before.colours.join(), 'reset() puts every medal back to locked')
    check(errors.length === 0, 'no console errors', errors.slice(0, 3))
    await ctx.page.close()
  }
}

/* ================================================================ physics */
if (SUITES.includes('physics')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { page, errors } = ctx
    await page.evaluate(INSTALL)
    const info = await page.evaluate(() => { const p = globalThis.__plazaQA.plaza(); return p?.dais ? { world: p.dais.world, tiers: p.dais.tiers } : null })
    if (!info) console.log('physics: no dais in this build, skipped')
    else {
      // Approaches over the skirt, at the speeds a player reaches: from the east lane (NE of the dais) and through the gate in
      // the boards (NW). The car is put down short of the skirt facing the dais centre; at 0 km/h the throttle (W) does the climb,
      // above it the speed is injected and held until the car is past the foot, like a driver who keeps the pedal down.
      // Starts (plaza metres) on the two ways in: down the east lane, and through the gate between the boards.
      for (const [start, label] of [[[11.2, 8.2], 'east lane'], [[2.4, 9.0], 'the gate']]) {
        for (const kmh of SPEEDS) {
          const placed = await page.evaluate(async ([start]) => {
            const A = globalThis.__archipelago, lib = globalThis.__plazaQA, T = A.THREE
            const w = lib.plaza().dais.world
            const at = new T.Vector3(78.1207 + start[0], 0, 117.39 + start[1])
            const dir = new T.Vector3(at.x - w.x, 0, at.z - w.z).normalize()          // from the dais out toward the start
            const heading = Math.atan2(dir.z, -dir.x)                                  // nose toward the dais
            const r = await lib.put(at.x, at.z, heading)
            await new Promise((resolve) => setTimeout(resolve, 600))
            return { ...r, dir: [dir.x, dir.z] }
          }, [start])
          if (!placed.ok) { console.log(`  climb ${label} ${kmh} km/h refused: ${placed.reason} ${placed.blocker ?? ''}`); continue }
          if (kmh === 0) await page.keyboard.down('KeyW')
          const run = await page.evaluate(async ([kmh, dir]) => {
            const A = globalThis.__archipelago, lib = globalThis.__plazaQA, d = A.driving, v = d.vehicle, body = v.chassis.physical.body
            const w = lib.plaza().dais.world, speed = kmh / 3.6
            if (speed) body.setLinvel({ x: -dir[0] * speed, y: 0, z: -dir[1] * speed }, true)
            const rows = [], t0 = performance.now()
            const touched = new Set()
            while (performance.now() - t0 < (kmh ? 2200 : 4500)) {
              await new Promise((r) => requestAnimationFrame(r))
              const p = v.position, lv = body.linvel(), toDais = Math.hypot(p.x - w.x, p.z - w.z)
              // Hold the injected speed until the car is on the first tier (a driver with the pedal down).
              if (kmh && toDais > w.radius * 0.55) { const s = Math.hypot(lv.x, lv.z); if (s > 0.5 && s < speed) body.setLinvel({ x: lv.x * speed / s, y: lv.y, z: lv.z * speed / s }, true) }
              rows.push({ y: p.y, vy: lv.y, speed: Math.hypot(lv.x, lv.z), contacts: v.wheels.inContactCount, up: v.upward.y, toDais })
              const collider = body.collider?.(0)
              if (collider) A.physics.world.contactPairsWith(collider, (other) => touched.add(String(other.parent()?.userData?.physical?.owner ?? other.userData?.name ?? 'other')))
            }
            // The entry is what the dais is responsible for: from the start to the first frame the car is over the middle of it.
            const centre = rows.findIndex((r) => r.toDais < 1.2)
            const entry = rows.slice(0, centre < 0 ? rows.length : centre + 1)
            const air = entry.filter((r) => r.contacts === 0).length
            return {
              kmh, frames: entry.length, airFrames: air, maxVy: +Math.max(...entry.map((r) => r.vy)).toFixed(2), minUp: +Math.min(...entry.map((r) => r.up)).toFixed(2),
              reached: +Math.min(...rows.map((r) => r.toDais)).toFixed(2), topY: +Math.max(...entry.map((r) => r.y)).toFixed(2), touched: [...touched],
              trace: entry.map((r) => [+r.toDais.toFixed(1), +r.y.toFixed(2), r.contacts]).filter((_, i) => i % 2 === 0).slice(0, 40),
            }
          }, [kmh, placed.dir])
          if (kmh === 0) await page.keyboard.up('KeyW')
          console.log('  climb', label, JSON.stringify({ ...run, trace: undefined }))
          if (process.argv.includes('--trace')) console.log('   trace', JSON.stringify(run.trace))
          check(run.minUp > 0.8 && run.airFrames <= (kmh >= 80 ? 12 : 4), `${label} ${kmh} km/h: climbs without a launch (${run.airFrames}/${run.frames} frames airborne, vy max ${run.maxVy}, upright ${run.minUp})`)
          if (kmh === 0) check(run.reached < 2.2, `${label} 0 km/h: the throttle alone gets it onto the dais (${run.reached} m from the centre)`)
        }
      }
      // Parked on the dais: four wheels down, still, and nothing but the dais under it.
      const park = await page.evaluate(async () => {
        const A = globalThis.__archipelago, lib = globalThis.__plazaQA, d = A.driving, v = d.vehicle, body = v.chassis.physical.body, w = lib.plaza().dais.world
        await lib.put(w.x, w.z, 2.356)
        await new Promise((r) => setTimeout(r, 2600))
        const lv = body.linvel(), touched = new Set()
        A.physics.world.contactPairsWith?.(v.chassis.physical.colliders?.[0] ?? body.collider(0), (other) => touched.add(other.parent()?.userData?.physical?.owner ?? 'other'))
        return { horizontal: Math.hypot(lv.x, lv.z), vy: lv.y, wheels: v.wheels.inContactCount, y: v.position.y, top: w.top, touched: [...touched], prompt: lib.instance().prompts.activeLabel }
      })
      console.log('  park', JSON.stringify(park))
      check(park.wheels === 4 && park.horizontal < 0.05 && Math.abs(park.vy) < 0.3, `parked on the dais: four wheels down and still (${park.horizontal.toFixed(3)} m/s along the ground, ${park.vy.toFixed(3)} vertical: the suspension's last settling, the same bound world-spawn.mjs uses)`)
      check(park.prompt === 'Achievements', 'the Achievements prompt is open there')
      check(!park.touched.some((o) => /physicalFixed|cuboid|hull/.test(String(o))), 'and the car touches no part of the pond or its rim', park.touched)
    }
    check(errors.length === 0, 'no console errors', errors.slice(0, 3))
    await ctx.page.close()
  }
}

/* ================================================================ cost */
if (SUITES.includes('cost')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { page } = ctx
    await page.evaluate(INSTALL)
    const cost = await page.evaluate(async () => {
      const A = globalThis.__archipelago, lib = globalThis.__plazaQA, info = A.renderer.info
      // The same spot in both variants: the middle of where the dais is (or would be), nose to the far corner of the screen.
      await lib.put(78.1207 + 6.6, 117.39 + 13.0, 2.356)
      const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => requestAnimationFrame(r)) }
      const measure = async () => { await settle(); let calls = 0, triangles = 0, n = 0; for (let i = 0; i < 8; i++) { await new Promise((r) => requestAnimationFrame(r)); calls += info.render.calls; triangles += info.render.triangles; n++ } return { calls: calls / n, triangles: triangles / n, geometries: info.memory.geometries, textures: info.memory.textures, programs: programs() } }
      const plaza = lib.plaza(), group = plaza?.group
      const programs = () => info.programs?.length
      const withPlaza = await measure()
      let without = null
      if (group) { group.visible = false; without = await measure(); group.visible = true }
      return { withPlaza, without, counts: plaza?.counts?.() ?? null, timing: plaza?.timing ?? null, medals: { draws: 1, triangles: plaza?.owner?.glyphs ? (plaza.owner.glyphs.geometry.index?.count ?? plaza.owner.glyphs.geometry.getAttribute('position').count) / 3 * plaza.owner.glyphs.count : 0 } }
    })
    fs.writeFileSync(shot('cost.json'), JSON.stringify(cost, null, 1))
    console.log('cost', JSON.stringify(cost))
    // What the plaza adds, two ways: the module's own meshes (the toggle) and the whole frame against the 'before' variant's.
    if (cost.without) console.log(`  the plaza group alone: +${(cost.withPlaza.calls - cost.without.calls).toFixed(1)} draw calls, +${Math.round(cost.withPlaza.triangles - cost.without.triangles)} triangles (module counts ${JSON.stringify(cost.counts)}, medals +1 draw, ${Math.round(cost.medals.triangles)} triangles)`)
    const beforeFile = path.join(OUT, 'plaza', 'before', 'cost.json')
    if (VARIANT !== 'before' && fs.existsSync(beforeFile)) {
      const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8')).withPlaza
      const calls = cost.withPlaza.calls - before.calls, triangles = cost.withPlaza.triangles - before.triangles
      console.log(`  whole frame at the dais, after vs before: ${before.calls.toFixed(0)} -> ${cost.withPlaza.calls.toFixed(0)} draw calls (+${calls.toFixed(1)}), ${Math.round(before.triangles)} -> ${Math.round(cost.withPlaza.triangles)} triangles (+${Math.round(triangles)}), geometries ${before.geometries} -> ${cost.withPlaza.geometries}, textures ${before.textures} -> ${cost.withPlaza.textures}`)
      if (ASSERT) {
        check(calls <= 8, `the whole frame at the dais costs <= 8 more draw calls than before (+${calls.toFixed(1)}, the audit's budget)`)
        check(triangles <= 6000, `and <= 6 k more triangles (+${Math.round(triangles)}, the audit's budget)`)
      }
    }
    check(cost.timing === null || cost.timing.build + cost.timing.adjust < 60, `building the plaza and re-seating the props takes < 60 ms in all (${cost.timing ? (cost.timing.build + cost.timing.adjust).toFixed(1) : 'n/a'} ms)`)
    await ctx.page.close()
  }
}

/* ================================================================ orbit */
if (SUITES.includes('orbit')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { page, errors } = ctx
    await page.evaluate(INSTALL)
    await page.evaluate(() => { const w = globalThis.__plazaQA.plaza().dais.world; return globalThis.__plazaQA.put(w.x - 0.3, w.z + 0.3, 2.356) })
    const read = () => page.evaluate(() => {
      const A = globalThis.__archipelago, T = A.THREE, plaza = globalThis.__plazaQA.plaza(), mesh = plaza.owner.glyphs
      mesh.updateWorldMatrix(true, false)
      const forward = new T.Vector3(0, 0, -1).applyQuaternion(A.camera.quaternion), m = new T.Matrix4(), normal = new T.Vector3(), up = new T.Vector3(), right = new T.Vector3()
      const camUp = new T.Vector3(0, 1, 0).applyQuaternion(A.camera.quaternion), camRight = new T.Vector3(1, 0, 0).applyQuaternion(A.camera.quaternion)
      let worst = 1, worstUp = 1, worstRight = 1
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m); m.premultiply(mesh.matrixWorld)
        normal.set(0, 0, 1).transformDirection(m); up.set(0, 1, 0).transformDirection(m); right.set(1, 0, 0).transformDirection(m)
        worst = Math.min(worst, -normal.dot(forward)); worstUp = Math.min(worstUp, up.dot(camUp)); worstRight = Math.min(worstRight, right.dot(camRight))
      }
      return { facing: +worst.toFixed(4), up: +worstUp.toFixed(4), right: +worstRight.toFixed(4), yaw: plaza.signs.map((s) => +s.group.rotation.y.toFixed(3)), theta: +A.driving.view.spherical.theta.toFixed(3), phi: +A.driving.view.spherical.phi.toFixed(3) }
    })
    const rest = await read()
    check(rest.facing >= 0.999 && rest.up >= 0.99, `at rest the medals face the camera (${rest.facing}, up ${rest.up})`)
    const box = await page.locator('#world').boundingBox()
    for (const [dx, dy] of [[260, 0], [-420, 60], [200, -150], [0, 220]]) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 12 })
      await page.mouse.up()
      await sleep(900)
      const o = await read()
      check(o.facing >= 0.999 && o.right >= 0.99 && o.up >= 0.99, `after a drag of (${dx}, ${dy}) the camera is at theta ${o.theta}, phi ${o.phi} and every medal still faces it (${o.facing}, right ${o.right}, up ${o.up})`)
      check(JSON.stringify(o.yaw) === JSON.stringify(rest.yaw), 'the signs did not turn: they are physical boards, fixed in the ground')
    }
    check(errors.length === 0, 'no console errors', errors.slice(0, 3))
    await ctx.page.close()
  }
}

/* ================================================================ motion */
if (SUITES.includes('motion')) {
  for (const reduced of [false, true]) {
    const ctx = await open(1440, 900, { reduced })
    if (!ctx) continue
    const { page, errors } = ctx
    await page.evaluate(INSTALL)
    const sample = () => page.evaluate(() => {
      const A = globalThis.__archipelago, plaza = globalThis.__plazaQA.plaza(), ach = plaza.owner
      return { time: plaza.water.time.value, mist: plaza.water.mist?.visible, bob: ach.pillar.position.y, medal: ach.glyphs.position.y, elapsed: A.driving.ticker.elapsed }
    })
    const near = await page.evaluate(() => { const w = globalThis.__plazaQA.plaza().dais.world; return globalThis.__plazaQA.put(w.x, w.z, 2.356) })
    await sleep(1500)
    const a = await sample()
    await sleep(2500)
    const b = await sample()
    if (reduced) {
      check(a.time === b.time && a.bob === b.bob, `reduced motion: the water clock and the pillar stand still (${a.time.toFixed(2)} -> ${b.time.toFixed(2)})`)
      await page.evaluate(() => globalThis.__archipelago.gameplay.achievements.unlock('strike'))
      const popped = await page.evaluate(() => globalThis.__plazaQA.plaza().owner.pops.size)
      check(popped === 0, 'reduced motion: an unlocked medal does not pop')
    } else {
      check(b.time > a.time + 1, `near: the water flows (${a.time.toFixed(2)} -> ${b.time.toFixed(2)})`)
      check(a.mist === true, 'near: the mist is drawn')
      // Beyond 40 m the whole thing stops: drive off to the north lane (60 m away) and look again.
      const far = await page.evaluate(async () => {
        // Somewhere drivable on the island's spine, 50-70 m north of the plaza.
        for (const [x, z] of [[78, 62], [80, 64], [76, 66], [82, 60], [78, 70], [74, 68], [84, 66], [78, 58]]) { const r = await globalThis.__plazaQA.put(x, z, 3.14); if (r.ok) return { ...r, x, z } }
        return { ok: false, reason: 'no drivable spot found' }
      })
      check(far.ok, `the car was put 60 m north of the plaza (${far.reason ?? 'ok'})`)
      await sleep(1500)
      const c = await sample()
      await sleep(2000)
      const d = await sample()
      check(c.time === d.time && c.bob === d.bob, `beyond 40 m: the water clock and the pillar stop (${c.time.toFixed(2)} -> ${d.time.toFixed(2)})`)
    }
    check(near.ok, 'the car was put on the dais')
    check(errors.length === 0, `no console errors${reduced ? ' (reduced)' : ''}`, errors.slice(0, 3))
    await ctx.page.close()
  }
}

/* ================================================================ lanes */
if (SUITES.includes('lanes')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { page } = ctx
    await page.evaluate(INSTALL)
    const report = await page.evaluate(async ([OX, OZ]) => {
      const lib = globalThis.__plazaQA, lanes = {}
      for (const dx of [-8, -6, -4, -2, 0, 2, 4, 6, 8]) {
        const row = []
        for (let dz = -30; dz <= -9; dz++) {
          const r = await lib.put(OX + dx, OZ + dz, 1.5708)
          row.push(r.ok ? lib.hidden() : -1)
        }
        lanes[dx] = row
      }
      return lanes
    }, [OX, OZ])
    fs.writeFileSync(shot('lanes.json'), JSON.stringify(report))
    console.log('lanes (x offset from the plaza centre: z from -30 to -9, one char per metre; # hidden (>= 4/5), o part hidden, + visible, . not drivable)')
    let hiddenMetres = 0
    for (const [dx, row] of Object.entries(report)) {
      const line = row.map((v) => (v < 0 ? '.' : v >= 4 ? '#' : v > 0 ? 'o' : '+')).join('')
      hiddenMetres += row.filter((v) => v >= 4).length
      console.log(`  x ${String(dx).padStart(3)}  ${line}  ${row.filter((v) => v >= 4).length} m hidden`)
    }
    results.push({ name: 'lanes', hiddenMetres })
    await ctx.page.close()
  }
}

/* ================================================================ north */
if (SUITES.includes('north')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { default: sharp } = await import('sharp')
    const { page, errors } = ctx
    await page.evaluate(INSTALL)
    // 1. Held on W from z = 84 south down each lane, the car runs on to the arch (its front is at z = 109.6): nothing stands in the lanes before it.
    //    (The document's own layout, the world before the plaza dressing, stopped the car at z = 105 on every lane.)
    const stops = {}
    for (const x0 of [74, 76, 78, 79, 80]) {
      const put = await page.evaluate(([x, z, h]) => globalThis.__plazaQA.put(x, z, h), [x0, 84, S])
      if (!put.ok) { console.log(`  lane x=${x0} refused: ${put.reason}`); continue }
      await sleep(900)
      await page.keyboard.down('KeyW')
      // 3 s of throttle is twice what the 24 m take (the car is at the arch after about 2 s). A car that is stopped by something in the lane sits
      // against it for seconds (the pole that stood on x = 80 held it at z = 100 until the wheels walked it round, 4 s on), so one early reading shows it.
      await sleep(3000)
      const at = await page.evaluate(() => { const v = globalThis.__archipelago.driving.vehicle, p = v.position, l = v.chassis.physical.body.linvel(); return { x: +p.x.toFixed(1), z: +p.z.toFixed(1), speed: +Math.hypot(l.x, l.z).toFixed(1) } })
      await page.keyboard.up('KeyW')
      stops[x0] = at
      console.log(`  lane x=${x0}: held on W from z=84 for 3 s, the car is at (${at.x}, ${at.z}) at ${at.speed} m/s`)
      if (ASSERT) check(at.z >= 106, `lane x=${x0}: the car has run on to the arch after 3 s (z=${at.z}; the arch stops it at about 108, the layout's own trophy at 105)`)
    }
    // 2. The car's pixels along the road, in the trophy court and on the east lane. The reference is the car in the open at the same heading.
    await page.evaluate(() => { globalThis.__plazaQA.cutOff = false })
    const ref = await carPixels(page, sharp, 74, 94, S)
    console.log(`  reference (the car on the road at (74, 94), nothing in front): ${ref.pixels} px changed by the car, camera ${ref.radius.toFixed(1)} m away`)
    const groups = {
      'the north road': [74, 76, 78, 80].flatMap((x) => [96, 98, 100, 102, 104, 106].map((z) => [x, z])),
      'the trophy court': [[78.6, 100.9], [77, 101], [79, 99], [76, 103], [78, 102.5], [79.5, 99.5]],
      'the east lane': [[88, 110], [88, 112], [88, 114], [88, 116.4], [88, 118], [87, 116], [86.5, 112]],
    }
    const rows = []
    for (const [group, cells] of Object.entries(groups)) {
      const got = []
      for (const [x, z] of cells) {
        const m = await carPixels(page, sharp, x, z, S)
        if (!m) continue
        const share = m.pixels / ref.pixels * (m.radius / ref.radius) ** 2
        got.push({ group, x, z, share: +share.toFixed(2) })
        if (share < 0.6) await page.screenshot({ path: shot(`north-hidden-${x}_${z}.png`) })
      }
      rows.push(...got)
      const worst = got.slice().sort((a, b) => a.share - b.share).slice(0, 3)
      console.log(`  ${group}: ${got.length} cells measured, the worst show ${worst.map((r) => `(${r.x}, ${r.z}) ${(r.share * 100).toFixed(0)} %`).join(', ')}`)
      if (ASSERT) check(got.length >= cells.length / 2 && got.every((r) => r.share >= 0.6), `${group}: the car shows on the screen (>= 60 % of its pixels) in all ${got.length} measured cells`, got.filter((r) => r.share < 0.6))
    }
    fs.writeFileSync(shot('north.json'), JSON.stringify({ stops, reference: ref.pixels, rows }, null, 1))
    check(errors.length === 0, 'no console errors', errors.slice(0, 3))
    results.push({ name: 'north', stops, cells: rows.length })
    await ctx.page.close()
  }
}

/* ================================================================ clearance */
if (SUITES.includes('clearance')) {
  const ctx = await open(1440, 900)
  if (ctx) {
    const { page } = ctx
    const report = await page.evaluate(([OX, OZ]) => {
      const A = globalThis.__archipelago, W = A.physics.world, T = A.THREE
      const items = []
      const q = new T.Quaternion(), p = new T.Vector3(), v = new T.Vector3()
      W.forEachCollider((c) => {
        const body = c.parent(), t = c.translation(), s = c.shape
        if (Math.hypot(t.x - OX, t.z - OZ) > 19 || c.isSensor?.()) return
        const r = c.rotation(); q.set(r.x, r.y, r.z, r.w); p.set(t.x, t.y, t.z)
        const pts = []
        if (s.type === 1) for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pts.push(v.set(sx * s.halfExtents.x, sy * s.halfExtents.y, sz * s.halfExtents.z).applyQuaternion(q).add(p).clone())
        else if (s.type === 10 || s.type === 11) for (const sy of [-1, 1]) for (let k = 0; k < 8; k++) pts.push(v.set(Math.cos(k / 8 * 6.2832) * s.radius, sy * s.halfHeight, Math.sin(k / 8 * 6.2832) * s.radius).applyQuaternion(q).add(p).clone())
        else if ((s.type === 6 || s.type === 9) && s.vertices) { const a = s.vertices; for (let i = 0; i < a.length; i += 3) pts.push(v.set(a[i], a[i + 1], a[i + 2]).applyQuaternion(q).add(p).clone()) }
        else return
        if (!pts.length) return
        const box = new T.Box3().setFromPoints(pts)
        const wide = Math.max(box.max.x - box.min.x, box.max.z - box.min.z)
        // Ground: low (under 0.45 m above the plaza's ground, 0.15 in the world) or huge (a floor, the sea) things are not obstacles.
        const ground = 0.15
        if (box.max.y - ground < 0.45 || wide > 16) return
        items.push({ body: body.handle, owner: String(body.userData?.physical?.owner ?? c.userData?.name ?? 'body'), hull: hull(pts.map((q2) => [q2.x - OX, q2.z - OZ])), top: +(box.max.y - ground).toFixed(2) })
      })
      // Convex hull of a point cloud (Andrew's monotone chain), then the exact distance between two convex footprints.
      function hull(points) {
        const p2 = [...new Map(points.map((q3) => [q3.map((v) => v.toFixed(3)).join(), q3])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1])
        if (p2.length < 3) return p2
        const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
        const lower = [], upper = []
        for (const q4 of p2) { while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), q4) <= 0) lower.pop(); lower.push(q4) }
        for (const q4 of [...p2].reverse()) { while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), q4) <= 0) upper.pop(); upper.push(q4) }
        return [...lower.slice(0, -1), ...upper.slice(0, -1)]
      }
      const segment = (pt, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], len2 = dx * dx + dz * dz || 1; const k = Math.max(0, Math.min(1, ((pt[0] - a[0]) * dx + (pt[1] - a[1]) * dz) / len2)); return Math.hypot(pt[0] - a[0] - k * dx, pt[1] - a[1] - k * dz) }
      const inside = (pt, poly) => { let sign = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c2 = (b[0] - a[0]) * (pt[1] - a[1]) - (b[1] - a[1]) * (pt[0] - a[0]); if (c2 !== 0) { if (sign && Math.sign(c2) !== sign) return false; sign = Math.sign(c2) } } return true }
      const gap = (a, b) => {
        if (a.hull.some((pt) => inside(pt, b.hull)) || b.hull.some((pt) => inside(pt, a.hull))) return 0
        let best = Infinity
        for (const [from, to] of [[a.hull, b.hull], [b.hull, a.hull]]) for (const pt of from) for (let i = 0; i < to.length; i++) best = Math.min(best, segment(pt, to[i], to[(i + 1) % to.length]))
        return best
      }
      const pairs = []
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        if (items[i].body === items[j].body) continue
        const g = gap(items[i], items[j])
        if (g < 2.4) pairs.push({ gap: +g.toFixed(2), a: `${items[i].owner} at (${centre(items[i])}) ${items[i].top}m`, b: `${items[j].owner} at (${centre(items[j])}) ${items[j].top}m` })
      }
      function centre(it) { return [it.hull.reduce((n, pt) => n + pt[0], 0) / it.hull.length, it.hull.reduce((n, pt) => n + pt[1], 0) / it.hull.length].map((v) => v.toFixed(1)).join(', ') }
      return { items: items.length, pairs: pairs.sort((x, y) => x.gap - y.gap) }
    }, [OX, OZ])
    fs.writeFileSync(shot('clearance.json'), JSON.stringify(report, null, 1))
    console.log(`clearance: ${report.items} solid things within 19 m of the plaza centre, ${report.pairs.length} pairs closer than 2.4 m`)
    for (const pair of report.pairs.slice(0, 30)) console.log(`  ${pair.gap.toFixed(2)} m  ${pair.a}  |  ${pair.b}`)
    results.push({ name: 'clearance', pairs: report.pairs.length })
    await ctx.page.close()
  }
}

await browser.close()
const bad = results.filter((r) => r.ok === false)
fs.writeFileSync(shot('report.json'), JSON.stringify({ label: LABEL, world: WORLD, results }, null, 1))
console.log(`\n${results.filter((r) => r.ok !== undefined).length - bad.length}/${results.filter((r) => r.ok !== undefined).length} checks passed; report ${shot('report.json')}`)
if (ASSERT && failed) process.exitCode = 1
