/* "Island timber" Lab board and behind-the-scenes board: gameplay-camera screenshots, the black-quad assertion, texture
   memory and render cost before and after, and a walk through every experiment.

   node scripts/qa/world-places-signs.mjs [--suite=shots,materials,memory,walk,firstsight,fit,emblem,world2] [--out=<dir>] [--baseline] [--quick]

   `fit`: the notice board's projected rectangle at ten viewports (a phone upright and sideways, tablets, laptops) and eleven camera
   poses each (every 60 degrees of azimuth, a high and a low pitch, zoomed all the way in and out): it stays inside the screen and
   clear of the page's HUD row. `world2`: in the /world2 route the board is on a layer its camera draws. The `shots` suite also
   measures the Lab's glyph heights on screen at 1440x900 and 390x844.

   Every shot is taken from the player's CHASE camera (`window.__archipelago.camera`), never an editor camera, at a camera
   distance of 22 m, 14 m and 8 m, on a 1440x900 desktop, a 1920x1080 desktop (22 m only) and a 390x844 phone. The distance
   is the one the script MEASURED, not the one it asked for (it is printed).

   --baseline serves Places.js of git HEAD (per page; nothing on disk changes): the same measurements then give the "before"
   column, and the materials suite must FAIL on it (the check has teeth). */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { launch, sleep } from './lib.mjs'
import { openSigns, frameWorldPoint, shoot, hueReport, scaled } from './world-signs.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const args = new Map(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] }))
const OUT = path.resolve(String(args.get('out') ?? process.env.QA_OUT ?? '.qa/runs/impl/signs-lab/final'))
const BASELINE = args.has('baseline')
const QUICK = args.has('quick')
const SUITES = String(args.get('suite') ?? 'shots,materials,memory,walk,firstsight,fit,emblem,world2').split(',')
fs.mkdirSync(OUT, { recursive: true })
const report = { baseline: BASELINE, suites: SUITES, checks: [], shots: [], errors: [] }
const check = (ok, message, detail) => { report.checks.push({ ok: !!ok, message, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${message}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); return !!ok }

const PLACES = 'public/archipelago/preview/portfolio/world2/interactions/Places.js'
/** A context where Places.js is the one git HEAD has: the old Lab (a Screen, black leftovers) and the old board (aimed at the car). */
const prepare = BASELINE ? async (context) => {
  const body = execFileSync('git', ['show', `HEAD:${PLACES}`], { cwd: ROOT, maxBuffer: 1 << 26 })
  await context.route('**/world2/interactions/Places.js*', route => route.fulfill({ body, contentType: 'text/javascript' }))
} : undefined

const open = (browser, o = {}) => openSigns(browser, { ...o, prepare })

/* ------------------------------------------------------------------ in-page probes -- */

/** Finds the lab and notice-board instances. Source of the strings evaluated in the page. */
const LAB = `(() => {
  const a = window.__archipelago, T = a.THREE
  const inst = a.gameplay.instances.find(i => i.parts.places?.labBoard)
  const node = inst.references.node('refImages.001'); node.updateWorldMatrix(true, false)
  return { a, T, inst, places: inst.parts.places, node, centre: node.getWorldPosition(new T.Vector3()) }
})()`
const NOTICE = `(() => {
  const a = window.__archipelago, T = a.THREE
  const inst = a.gameplay.instances.find(i => i.parts.places?.sceneBoard)
  return { a, T, inst, places: inst.parts.places, board: inst.parts.places.sceneBoard }
})()`

const labPoint = (page) => page.evaluate(`(() => { const { centre, inst } = ${LAB}; const r = inst.physics.point(inst.references.position('refInteractivePoint.001')); return { c: centre.toArray(), reader: r.toArray() } })()`)

/** Shows experiment `index` of the lab, optionally mutated into the shape of a QA case. */
async function showExperiment(page, index, mutate) {
  await page.evaluate(`((index, mutate) => {
    const { places } = ${LAB}
    const item = places.labProjects[index]
    if (mutate === 'long') {
      item.title = 'A Remarkably Long Experiment Title That Goes On And On Across Several Words To Test Wrapping And Ellipsis Properly End'.slice(0, 120)
      item.description = ('Detailed description of everything this experiment does, from the first prototype to the last measurement, in many sentences. ').repeat(6).slice(0, 500)
      item.technologies = ['TypeScript', 'PostgreSQL', 'Redis', 'WebGL', 'Rapier', 'Cloudflare']
    } else if (mutate === 'image') {
      const c = document.createElement('canvas'); c.width = 640; c.height = 400
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 640, 400); g.addColorStop(0, '#2f6f5e'); g.addColorStop(1, '#e4a90c'); x.fillStyle = g; x.fillRect(0, 0, 640, 400)
      x.fillStyle = '#fff'; x.font = '700 64px sans-serif'; x.fillText('CMS image', 150, 220)
      item.image = c.toDataURL('image/png')
    }
    places.labBoard.index = index
    places.paintLab()
  })(${JSON.stringify(index)}, ${JSON.stringify(mutate ?? null)})`)
  await sleep(1700)
}

/** The first experiment index that wears each kind of hardware (oak, rope, chain, vine), from the themes the CMS data maps to. */
async function dressIndices(page) {
  return page.evaluate(`(async () => {
    const { places } = ${LAB}
    const { themeForProject } = await import('/archipelago/preview/portfolio/world2/signs/themes.js')
    const found = {}
    places.labProjects.forEach((p, i) => { const t = themeForProject(p); found[t.hardware] ??= { index: i, theme: t.id, charm: t.charm } })
    return found
  })()`)
}

/** Remembers the camera the player starts with (zoom and orbit), so a shot can come back to it. */
const rememberView = (page) => page.evaluate(() => { const v = window.__archipelago.driving.view, s = v.spherical; window.__view0 = { zoom: v.zoom.baseRatio, theta: s.theta, phi: s.phi } })

/**
 * The view a player actually has: the car parked at the prompt, the camera exactly as it was when the world opened (21 m on a desktop,
 * 31 m on a phone held upright). Returns how far the camera is from `point` (world).
 */
async function atPrompt(page, reader, point) {
  await page.evaluate(({ reader }) => {
    const a = window.__archipelago, T = a.THREE, v = a.driving.view, s = v.spherical, z = window.__view0
    a.driving.visual.group.visible = true
    v.zoom.baseRatio = v.zoom.smoothedRatio = v.zoom.ratio = z.zoom
    s.targetTheta = s.theta = z.theta; s.targetPhi = s.phi = z.phi
    a.driving.place({ position: new T.Vector3(reader[0], reader[1] + 0.6, reader[2]), rotation: Math.PI * 1.25 })
  }, { reader })
  await sleep(1800)
  return page.evaluate(({ point }) => { const a = window.__archipelago, T = a.THREE; const q = new T.Vector3(...point).project(a.camera); return { distance: +a.camera.position.distanceTo(new T.Vector3(...point)).toFixed(1), ndc: [+q.x.toFixed(2), +q.y.toFixed(2)] } }, { point })
}

/** Brings the notice board up through its own prompt and waits for it to stand. Returns where it is. */
async function raiseNotice(page) {
  await page.evaluate(`(() => { const { inst, board } = ${NOTICE}; if (!board.shown) inst.prompts.items.find(p => p.label === 'Behind the scenes').onInteract() })()`)
  await sleep(3000)
  return page.evaluate(`(() => { const { T, board } = ${NOTICE}; const g = board.screen.group; return { pos: g.getWorldPosition(new T.Vector3()).toArray(), metrics: board.metrics ?? null } })()`)
}

/* ------------------------------------------------------------------ materials -- */

/** Visible meshes under an instance's frame that would render black: glTF's default material (metalness 1, roughness 1, white, no map). */
const BLACK = (selector) => `(() => {
  const { inst } = ${selector}
  const bad = []
  inst.frame.traverse(o => {
    if (!o.isMesh) return
    for (let p = o; p; p = p.parent) if (!p.visible) return
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && m.isMeshStandardMaterial && !m.map && m.metalness === 1 && m.roughness === 1 && m.color.getHex() === 0xffffff && !m.transparent && m.opacity === 1) bad.push({ node: o.userData.w2Source ?? o.name, batch: !!(o.isBatchedMesh || o.isInstancedMesh), verts: o.geometry?.attributes?.position?.count })
    }
  })
  return bad
})()`

async function suiteMaterials(browser) {
  const { context, page, errors } = await open(browser)
  const lab = await page.evaluate(BLACK(LAB))
  const projects = await page.evaluate(BLACK(`(() => { const a = window.__archipelago; return { inst: a.gameplay.instances.find(i => i.parts.projects) } })()`))
  console.log('default-material meshes under the lab:', JSON.stringify(lab), ' under projects:', JSON.stringify(projects))
  check(lab.length === 0, 'no default-material (black) quad is rendered under the lab', lab)
  check(projects.length === 0, 'no default-material (black) quad is rendered under projects', projects)
  const walls = await page.evaluate(`(() => {
    const { inst } = ${LAB}
    const out = {}
    for (const name of ['refImages.001', 'text.009', 'text.007', 'image', 'text.008']) {
      let node; inst.frame.traverse(o => { if (!node && (o.userData.w2Source ?? o.name) === name) node = o })
      const m = node?.material
      out[name] = node ? { visible: node.visible, painted: !!m?.map?.image, emissiveMap: !!m?.emissiveMap, metalness: m?.metalness, roughness: m?.roughness } : null
    }
    let intersect; inst.frame.traverse(o => { if (!intersect && (o.userData.w2Source ?? o.name) === 'intersect') intersect = o })
    out.intersectHidden = intersect ? !intersect.visible : null
    return out
  })()`)
  console.log(JSON.stringify(walls))
  for (const name of ['refImages.001', 'text.009', 'text.007', 'image', 'text.008']) check(walls[name]?.painted && walls[name].roughness < 1 && walls[name].metalness === 0, `lab ${name} carries a lit painted face`, walls[name])
  check(walls.intersectHidden === true, 'the lab backing slab is hidden for good', walls.intersectHidden)
  report.errors.push(...errors)
  await context.close()
}

/* ------------------------------------------------------------------ shots -- */

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, distances: QUICK ? [22] : [22, 14, 8] },
  { name: '1920x1080', width: 1920, height: 1080, distances: [22] },
  { name: '834x1112', width: 834, height: 1112, mobile: true, distances: [] },
  { name: '844x390', width: 844, height: 390, mobile: true, distances: [] },
  // A phone held upright sits 31 m from the car by default; 22 and 14 m are the player zooming in.
  { name: '390x844', width: 390, height: 844, mobile: true, distances: QUICK ? [31] : [31, 22, 14] },
]

async function suiteShots(browser) {
  const only = args.get('only') ? String(args.get('only')).split(',') : null
  for (const viewport of VIEWPORTS) {
    if (only && !only.includes(viewport.name)) continue
    const { context, page, errors } = await open(browser, viewport)
    await rememberView(page)
    const dpr = viewport.mobile ? 2 : 1
    // ---- the lab
    const where = await labPoint(page)
    const cases = [{ id: 'cinquillo', index: 0 }, { id: 'long', index: 3, mutate: 'long' }, { id: 'image', index: 5, mutate: 'image' }].slice(0, QUICK ? 1 : 3)
    // One experiment per kind of hardware (ivy, rope, chain, plain oak), at the middle distance, on the desktop view only.
    if (viewport.name === '1440x900' && !QUICK) {
      const dress = await dressIndices(page)
      console.log('hardware by experiment:', JSON.stringify(dress))
      for (const [kind, d] of Object.entries(dress)) if (!cases.some(c => c.index === d.index)) cases.push({ id: `dress-${kind}`, index: d.index, only: 14 })
    }
    for (const c of cases) {
      await showExperiment(page, c.index, c.mutate)
      for (const distance of c.only ? [c.only] : ['default', ...viewport.distances]) {
        let framing
        if (distance === 'default') framing = await atPrompt(page, where.reader, where.c)
        else {
          // The camera looks at the car, which stands beyond the board for a camera nearer than its own radius: the board then sits low in
          // the frame, and the 8 m shot is a crop (the share of the face in view is reported). lateral 0 keeps it on the camera's axis.
          const aimUp = distance <= 9 ? 0 : 0.3
          const frame = () => frameWorldPoint(page, { x: where.c[0], y: where.c[1] + aimUp, z: where.c[2] }, distance, { ground: where.reader[1] + 0.5, lateral: 0 })
          framing = await frame()
          for (let attempt = 1; attempt < 4 && Math.abs(framing.distance - distance) > 3; attempt++) framing = await frame()
        }
        await showExperiment(page, c.index)       // the car dropping in near the lab can knock nothing, but be certain what is on the sheet
        await sleep(700)
        const file = path.join(OUT, `lab-${viewport.name}-${c.id}-${distance === 'default' ? 'default' : distance + 'm'}.png`)
        await shoot(page, file)
        const rect = await page.evaluate(`(() => {
          const { a, T, inst, node } = ${LAB}
          const cam = a.camera, size = { w: innerWidth, h: innerHeight }
          node.geometry.computeBoundingBox()
          const b = node.geometry.boundingBox
          let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
          for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) { const q = new T.Vector3(x, y, 0).applyMatrix4(node.matrixWorld).project(cam); const sx = (q.x + 1) / 2 * size.w, sy = (1 - q.y) / 2 * size.h; minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy) }
          return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, camDistance: cam.position.distanceTo(node.getWorldPosition(new T.Vector3())) }
        })()`)
        // The glyph heights the face settled on, in CSS px on screen: design px x (the face's width on screen / its 1024 design px).
        const glyphs = await page.evaluate(`(() => { const { places } = ${LAB}; return places.labBoard.metrics })()`)
        const onScreen = glyphs && { titleEm: +(glyphs.titlePx * rect.w / 1024).toFixed(1), bodyEm: +(glyphs.bodyPx * rect.w / 1024).toFixed(1), tagEm: +(glyphs.tagPx * rect.w / 1024).toFixed(1), truncated: glyphs.truncated }
        if (onScreen) console.log(`lab ${viewport.name} ${c.id} D=${distance}: on screen the title is ${onScreen.titleEm} px em, the description ${onScreen.bodyEm}, the tags ${onScreen.tagEm}${onScreen.truncated ? ' (cut)' : ''}`)
        if (onScreen && distance === 'default' && c.id === 'cinquillo' && (viewport.name === '1440x900' || viewport.name === '390x844')) {
          const phone = viewport.name === '390x844'
          check(onScreen.titleEm >= (phone ? 12 : 18), `the lab's title is >= ${phone ? 12 : 18} px em at the default ${viewport.name} camera (${onScreen.titleEm})`, onScreen)
          check(onScreen.bodyEm >= (phone ? 8 : 12), `the lab's description is >= ${phone ? 8 : 12} px em at the default ${viewport.name} camera (${onScreen.bodyEm})`, onScreen)
        }
        const hue = await hueReport(file, scaled(rect, dpr))
        const faceShare = +(hue.pixels / Math.max(1, rect.w * rect.h * dpr * dpr)).toFixed(2)
        // Pixel height of the face's title, from the painted layout: 62 design px at most, in a 1024-wide design space.
        const designPx = rect.w / 1024
        report.shots.push({ board: 'lab', viewport: viewport.name, case: c.id, glyphs: onScreen, requested: distance, measured: +Number(framing.distance).toFixed(1), toFace: +rect.camDistance.toFixed(1), faceShare, faceWidthPx: Math.round(rect.w), emPxPerDesignPx: +designPx.toFixed(3), blueViolet: hue.blueViolet, dominant: hue.dominant.map(d => `${d.hue}:${d.share}`), file: path.relative(ROOT, file) })
        console.log(`lab ${viewport.name} ${c.id} D=${distance} (to face ${rect.camDistance.toFixed(1)}), face ${Math.round(rect.w)}px wide, ${Math.round(faceShare * 100)}% in view, blue/violet ${hue.blueViolet}`)
      }
    }
    // ---- the notice board
    const risen = await raiseNotice(page)
    const noticeReader = await page.evaluate(`(() => { const { inst } = ${NOTICE}; return inst.physics.point(inst.references.position('refInteractivePoint.004')).toArray() })()`)
    for (const distance of ['default', ...viewport.distances]) {
      const framing = distance === 'default'
        ? await atPrompt(page, noticeReader, risen.pos)
        : await frameWorldPoint(page, { x: risen.pos[0], y: risen.pos[1], z: risen.pos[2] }, distance, { ground: 0.9, lateral: 0 })
      await sleep(1400)
      const file = path.join(OUT, `bts-${viewport.name}-${distance === 'default' ? 'default' : distance + 'm'}.png`)
      await shoot(page, file)
      const facing = await page.evaluate(`(() => {
        const { a, T, board } = ${NOTICE}
        const g = board.screen.group, cam = a.camera
        // The scale that counts is the sign's own (the billboard's scale times the short-viewport boost times the frame's).
        const q = g.getWorldQuaternion(new T.Quaternion()), p = g.getWorldPosition(new T.Vector3()), s = (board.screen.sign?.group ?? g).getWorldScale(new T.Vector3())
        const n = new T.Vector3(0, 0, 1).applyQuaternion(q), f = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
        const r = new T.Vector3(1, 0, 0).applyQuaternion(q), cr = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion)
        const cv = a.renderer.domElement.getBoundingClientRect()
        const pxPerMetre = cv.height / (2 * p.distanceTo(cam.position) * Math.tan(cam.fov * Math.PI / 360))
        // body text: cap height = 0.72 em, em = bodyPx canvas px, the plaque front spans 1024 canvas px
        const bodyPx = board.metrics?.bodyPx ?? 0
        return { facing: +(-n.dot(f)).toFixed(4), mirrored: r.dot(cr) < 0.98, worldScale: +s.x.toFixed(2), bodyPx, capPx: +(bodyPx * 0.72 * (3.56 / 1024) * s.x * pxPerMetre).toFixed(1), emPx: +(bodyPx * (3.56 / 1024) * s.x * pxPerMetre).toFixed(1), widthPx: +(3.6 * s.x * pxPerMetre).toFixed(0), camDistance: +p.distanceTo(cam.position).toFixed(1) }
      })()`)
      report.shots.push({ board: 'bts', viewport: viewport.name, requested: distance, measured: +Number(framing.distance).toFixed(1), ...facing, file: path.relative(ROOT, file) })
      console.log(`bts ${viewport.name} D=${distance} measured ${Number(framing.distance).toFixed(1)}: facing ${facing.facing}, body cap ${facing.capPx}px (em ${facing.emPx}px), board ${facing.widthPx}px wide of ${viewport.width}`)
      if (viewport.name === '1440x900' && distance === 'default') check(facing.capPx >= 12, `the notice board's body type is >= 12 px tall (cap) at the default desktop camera (${facing.capPx} px)`, facing)
      check(facing.facing >= 0.995 && !facing.mirrored, `the notice board faces the camera at ${viewport.name} ${distance === 'default' ? 'the default camera' : distance + ' m'} (${facing.facing})`)
    }
    report.errors.push(...errors)
    await context.close()
  }
}

/* ------------------------------------------------------------------ memory and cost -- */

async function suiteMemory(browser) {
  const { context, page, errors } = await open(browser)
  const snapshot = (label) => page.evaluate(({ label }) => {
    const a = window.__archipelago, info = a.renderer.info
    const uploads = new Set(), bytes = {}
    for (const u of window.__uploads) if (!uploads.has(u.el)) { uploads.add(u.el); bytes[u.w + 'x' + u.h] = (bytes[u.w + 'x' + u.h] ?? 0) + 1 }
    let uploaded = 0
    for (const el of uploads) uploaded += el.width * el.height * 4
    return { label, textures: info.memory.textures, geometries: info.memory.geometries, programs: info.programs.length, uploadedCanvases: uploads.size, uploadedCanvasMB: +(uploaded / 1048576).toFixed(2), sizes: bytes }
  }, { label })
  const cost = () => page.evaluate(async () => {
    const info = window.__archipelago.renderer.info
    const was = info.autoReset
    info.autoReset = false; info.reset()
    const f0 = info.render.frame
    await new Promise(r => setTimeout(r, 1000))
    const frames = Math.max(1, info.render.frame - f0)
    const out = { calls: Math.round(info.render.calls / frames), triangles: Math.round(info.render.triangles / frames) }
    info.autoReset = was
    return out
  })

  // What the places themselves hold: every canvas that belongs to the lab or the notice board, and what a hidden board costs.
  const held = await page.evaluate(`(() => {
    const { places } = ${LAB}
    const { board } = ${NOTICE}
    const rows = (layers) => layers.map(l => ({ layer: l.name, w: l.canvas.width, h: l.canvas.height, mips: l.texture.generateMipmaps }))
    const lab = places.labBoard?.sign ? rows(places.labBoard.sign.layers) : places.labBoard?.screen ? [{ layer: 'screen', w: places.labBoard.screen.canvas.width, h: places.labBoard.screen.canvas.height, mips: true }] : []
    const notice = board.screen.sign ? rows(board.screen.sign.layers) : board.screen.canvas ? [{ layer: 'screen', w: board.screen.canvas.width, h: board.screen.canvas.height, mips: true }] : []
    return { lab, notice }
  })()`)
  const mb = (list) => list.reduce((n, c) => n + c.w * c.h * 4 * (c.mips ? 4 / 3 : 1), 0) / 1048576
  const labMB = mb(held.lab), noticeMB = mb(held.notice)
  console.log(`at startup: lab canvases ${held.lab.length} = ${labMB.toFixed(2)} MB (with mips), notice board canvases ${held.notice.length} = ${noticeMB.toFixed(2)} MB`)
  report.memory = { startup: { lab: held.lab, notice: held.notice, labMB: +labMB.toFixed(2), noticeMB: +noticeMB.toFixed(2) } }
  if (!BASELINE) check(held.notice.length === 0, 'the behind-the-scenes board holds no canvas at startup', held.notice)
  else console.log('(baseline) the old board holds its canvas from the start:', held.notice.length > 0)

  const start = await snapshot('startup'); console.log(JSON.stringify(start))
  // Look at the lab: its textures upload when it is first drawn.
  const where = await labPoint(page)
  await frameWorldPoint(page, { x: where.c[0], y: where.c[1] + 0.4, z: where.c[2] }, 22, { ground: where.reader[1] + 0.5 })
  await sleep(2500)
  const atLab = await snapshot('at the lab'); console.log(JSON.stringify(atLab))
  const labCost = await cost(); console.log('lab in view', JSON.stringify(labCost))
  // The notice board: first press.
  await raiseNotice(page)
  await sleep(600)
  const atBoard = await snapshot('board up'); console.log(JSON.stringify(atBoard))
  const boardCost = await cost(); console.log('board up', JSON.stringify(boardCost))
  report.memory = { ...report.memory, snapshots: [start, atLab, atBoard], labCost, boardCost }
  report.errors.push(...errors)
  await context.close()
}

/* ------------------------------------------------------------------ the walk -- */

async function suiteWalk(browser) {
  const { context, page, errors } = await open(browser)
  const where = await labPoint(page)
  await frameWorldPoint(page, { x: where.c[0], y: where.c[1] + 0.4, z: where.c[2] }, 22, { ground: where.reader[1] + 0.5 })
  await sleep(1200)
  // Press the board's own prompt through every experiment twice; count what it builds.
  const before = await page.evaluate(() => ({ g: window.__archipelago.renderer.info.memory.geometries, t: window.__archipelago.renderer.info.memory.textures }))
  const lap = await page.evaluate(async () => {
    const a = window.__archipelago
    const inst = a.gameplay.instances.find(i => i.parts.places?.labBoard)
    const places = inst.parts.places, board = places.labBoard
    const prompt = inst.prompts.items.find(p => p.label === 'Next experiment')
    const seen = []
    for (let i = 0; i < places.labProjects.length * 2; i++) {
      prompt.onInteract()
      await new Promise(r => setTimeout(r, 160))
      const theme = board.woodNow?.name, charm = board.charmNow?.name ?? null
      seen.push({ index: board.index, title: places.labProjects[board.index].title.slice(0, 28), wood: theme, charm, woods: [...board.woods.values()].filter(m => m.visible).length, charms: [...board.charms.values()].filter(m => m.visible).length })
    }
    return { seen, woodsBuilt: board.woods.size, charmsBuilt: board.charms.size, achievement: a.gameplay.manager?.achievements?.has?.('lab') }
  })
  console.log(`walked ${lap.seen.length} presses: ${lap.woodsBuilt} hardware kinds and ${lap.charmsBuilt} charms built, one visible at a time`)
  check(lap.seen.every(s => s.woods === 1 && s.charms <= 1), 'one hardware kind and at most one charm are shown at a time', lap.seen.filter(s => s.woods !== 1 || s.charms > 1))
  const after = await page.evaluate(() => ({ g: window.__archipelago.renderer.info.memory.geometries, t: window.__archipelago.renderer.info.memory.textures }))
  report.walk = { before, after, woodsBuilt: lap.woodsBuilt, charmsBuilt: lap.charmsBuilt, geometryGrowth: after.g - before.g }
  check(lap.woodsBuilt <= 4 && lap.charmsBuilt <= 13, `building the dress per theme is bounded (${lap.woodsBuilt} hardware kinds, ${lap.charmsBuilt} charms)`)
  // Second lap builds nothing.
  const second = await page.evaluate(async () => {
    const a = window.__archipelago
    const inst = a.gameplay.instances.find(i => i.parts.places?.labBoard)
    const board = inst.parts.places.labBoard
    const prompt = inst.prompts.items.find(p => p.label === 'Next experiment')
    const w = board.woods.size, c = board.charms.size
    for (let i = 0; i < inst.parts.places.labProjects.length; i++) { prompt.onInteract(); await new Promise(r => setTimeout(r, 40)) }
    return { grewWoods: board.woods.size - w, grewCharms: board.charms.size - c }
  })
  check(second.grewWoods === 0 && second.grewCharms === 0, 'a second lap builds no new geometry', second)
  report.errors.push(...errors)
  check(errors.length === 0, `no console errors or exceptions (${errors.slice(0, 2).join(' | ')})`)
  await context.close()
}

/* ------------------------------------------------------------------ first sight -- */

/**
 * Every layer of the lab is made unpainted and the car is dropped at the board: not one rendered frame may show a layer that has
 * never been painted while the board is in sight (the scheduler paints a layer that is in sight the tick it is found).
 */
async function suiteFirstSight(browser) {
  const { context, page, errors } = await open(browser)
  await sleep(2500)
  const where = await labPoint(page)
  // Somewhere the board cannot be seen from, with the lab as it is after a long idle: reset every layer to "never painted".
  await page.evaluate(`(() => {
    const { a, T, places } = ${LAB}
    a.driving.place({ position: new T.Vector3(40, 1.2, 40), rotation: 0 })
    for (const layer of places.labBoard.sign.layers) { layer.paintedAt = -Infinity; layer.dirty = true; layer.paints = 0 }
    window.__first = { frames: 0, unpaintedWhileSeen: 0, seen: 0, worst: [] }
    const camera = a.camera, frustum = new T.Frustum(), m = new T.Matrix4()
    const board = places.labBoard
    const probe = () => {
      camera.updateMatrixWorld()
      frustum.setFromProjectionMatrix(m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
      const p = board.frame.root.getWorldPosition(new T.Vector3())
      const seen = frustum.containsPoint(p)
      window.__first.frames++
      if (seen) {
        window.__first.seen++
        const bad = board.sign.layers.filter(l => l.paintedAt === -Infinity && !l.hold)
        if (bad.length) { window.__first.unpaintedWhileSeen++; if (window.__first.worst.length < 3) window.__first.worst.push(bad.map(l => l.name)) }
      }
    }
    a.driving.ticker.events.on('tick', probe, 99)
    a.driving.place({ position: new T.Vector3(${where.reader[0]}, ${where.reader[1] + 0.6}, ${where.reader[2]}), rotation: Math.PI * 1.25 })
  })()`)
  await sleep(3000)
  const result = await page.evaluate(() => window.__first)
  console.log('first sight:', JSON.stringify(result))
  check(result.seen > 30, `the lab was in sight for ${result.seen} frames`)
  check(result.unpaintedWhileSeen === 0, `no frame showed an unpainted lab layer while the board was in sight (${result.unpaintedWhileSeen} of ${result.seen})`, result.worst)
  report.errors.push(...errors)
  await context.close()
}

/* ------------------------------------------------------------------ fit -- */

const FIT_VIEWPORTS = [
  { width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 1280, height: 720 }, { width: 1024, height: 600 },
  { width: 932, height: 430, mobile: true }, { width: 844, height: 390, mobile: true }, { width: 667, height: 375, mobile: true },
  { width: 390, height: 844, mobile: true }, { width: 360, height: 640, mobile: true }, { width: 834, height: 1112, mobile: true },
]

/** The board's plaque (3.6 x 2.25 m) projected to the screen, and the page's HUD pills, in CSS px. Run in the page. */
const BOARD_RECT = `(() => {
  const a = window.__archipelago, T = a.THREE
  const inst = a.gameplay.instances.find(i => i.parts.places?.sceneBoard)
  const board = inst.parts.places.sceneBoard, sign = board.screen.sign.group
  sign.updateWorldMatrix(true, false)
  const w = innerWidth, h = innerHeight
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (const [x, y] of [[-1.8, -1.125], [1.8, -1.125], [1.8, 1.125], [-1.8, 1.125]]) {
    const q = new T.Vector3(x, y, 0).applyMatrix4(sign.matrixWorld).project(a.camera)
    const sx = (q.x + 1) / 2 * w, sy = (1 - q.y) / 2 * h
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy)
  }
  const hud = [...document.querySelectorAll('#player-nav, #player-nav *')].map(el => el.getBoundingClientRect()).filter(r => r.width > 8 && r.height > 8 && r.width < w * 0.9).map(r => ({ x: r.x, y: r.y, w: r.width, h: r.height }))
  const g = board.screen.group
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, right: maxX, bottom: maxY, vw: w, vh: h, hud, boost: sign.scale.x, lift: g.position.y - board.home.y, groupY: g.position.y }
})()`

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

async function suiteFit(browser) {
  const worst = {}
  for (const viewport of FIT_VIEWPORTS) {
    const name = `${viewport.width}x${viewport.height}`
    const { context, page, errors } = await open(browser, viewport)
    await rememberView(page)
    const risen = await raiseNotice(page)
    const reader = await page.evaluate(`(() => { const { inst } = ${NOTICE}; return inst.physics.point(inst.references.position('refInteractivePoint.004')).toArray() })()`)
    await atPrompt(page, reader, risen.pos)
    // In /world the gameplay camera draws MAP_HIDDEN (the map's photograph does not): the board is on that layer, and the camera sees it.
    if (viewport === FIT_VIEWPORTS[0]) {
      const layers = await page.evaluate(`(() => { const { a, board } = ${NOTICE}; const masks = new Set(); board.screen.sign.group.traverse(o => masks.add(o.layers.mask)); return { masks: [...masks], camera: a.camera.layers.mask, sees: a.camera.layers.isEnabled(2) } })()`)
      check(layers.sees && layers.masks.every(m => m === 1 << 2), '/world: the board is on the map-hidden layer, which the gameplay camera draws', layers)
    }
    const poses = [
      { id: 'default' },
      ...[1, 2, 3, 4, 5].map(i => ({ id: `azimuth+${i * 60}`, theta: i * 60 })),
      { id: 'high', phi: 0.08 }, { id: 'low', phi: 0.4 },
      { id: 'in', zoom: 1 }, { id: 'out', zoom: 0 }, { id: 'low+out', phi: 0.4, zoom: 0 },
    ]
    const rows = []
    for (const pose of poses) {
      await page.evaluate(({ pose }) => {
        const v = window.__archipelago.driving.view, s = v.spherical, z = window.__view0
        const zoom = pose.zoom ?? z.zoom
        v.zoom.baseRatio = v.zoom.smoothedRatio = v.zoom.ratio = zoom
        s.targetTheta = s.theta = z.theta + (pose.theta ?? 0) * Math.PI / 180
        s.targetPhi = s.phi = pose.phi !== undefined ? Math.PI * pose.phi : z.phi
      }, { pose })
      await sleep(1600)
      const r = await page.evaluate(BOARD_RECT)
      const inside = r.x >= -0.5 && r.y >= -0.5 && r.right <= r.vw + 0.5 && r.bottom <= r.vh + 0.5
      const hit = r.hud.find(h => overlaps(r, h))
      rows.push({ pose: pose.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), boost: +r.boost.toFixed(2), lift: +r.lift.toFixed(2), inside, hud: !!hit })
      if (pose.id === 'default' || !inside || hit) await shoot(page, path.join(OUT, `fit-${name}-${pose.id}.png`))
    }
    // The player drives off with the board still up. It is never dragged along: the fit nudges it by at most its own width, and only
    // while it is near the screen (a phone's camera is so far out that a board 35 m away is still on it). The unit tests pin the taper.
    for (const [metres, dx, dz] of [[18, 16, 9], [35, 30, 17]]) {
      await page.evaluate(({ reader, dx, dz }) => {
        const a = window.__archipelago, T = a.THREE
        a.driving.place({ position: new T.Vector3(reader[0] + dx, reader[1] + 0.6, reader[2] + dz), rotation: 0 })
      }, { reader, dx, dz })
      await sleep(2200)
      const gone = await page.evaluate(`(() => { const { board } = ${NOTICE}; const g = board.screen.group; return { slide: Math.hypot(board.slide.x, board.slide.z), width: 3.6 * g.scale.y * board.screen.sign.group.scale.x, boost: board.screen.sign.group.scale.x, drift: Math.hypot(g.position.x - board.home.x, g.position.z - board.home.z) } })()`)
      const sane = gone.boost >= 0.55 && gone.boost <= 1.6 && Number.isFinite(gone.slide) && gone.slide <= gone.width
      check(sane, `${name}: with the car ${metres} m away the board is not dragged after it (slid ${gone.slide.toFixed(2)} of ${gone.width.toFixed(1)} units wide, boost ${gone.boost.toFixed(2)})`, gone)
    }
    const bad = rows.filter(r => !r.inside || r.hud)
    console.log(`fit ${name}: ${rows.map(r => `${r.pose} ${r.w}x${r.h}@${r.x},${r.y}${!r.inside ? ' OUTSIDE' : ''}${r.hud ? ' HUD' : ''}`).join(' | ')}`)
    check(bad.length === 0, `the notice board stays on the screen and clear of the HUD at ${name} in all ${rows.length} camera poses`, bad)
    const def = rows[0]
    worst[name] = { default: def, smallestWidth: Math.min(...rows.map(r => r.w)), poses: rows.length }
    report.shots.push({ board: 'bts-fit', viewport: name, rows })
    report.errors.push(...errors)
    await context.close()
  }
  report.fit = worst
}

/* ------------------------------------------------------------------ emblem -- */

/**
 * The lab's live picture repaints about ten times a second while the board is near and in sight. Seen from behind (the picture is on
 * the face's front only) it must not: sweep the camera round the board, and from every side count the emblem canvas's uploads.
 */
async function suiteEmblem(browser) {
  const { context, page, errors } = await open(browser)
  await rememberView(page)
  const where = await labPoint(page)
  await showExperiment(page, 0)
  await atPrompt(page, where.reader, where.c)
  const rows = []
  for (const theta of [0, 45, 90, 135, 180, 225, 270, 315]) {
    await page.evaluate(({ theta }) => {
      const v = window.__archipelago.driving.view, s = v.spherical, z = window.__view0
      s.targetTheta = s.theta = z.theta + theta * Math.PI / 180
    }, { theta })
    await sleep(1200)
    await page.evaluate(`window.__mark = performance.now()`)
    await sleep(2500)
    const row = await page.evaluate(`(() => {
      const { a, T, places } = ${LAB}
      const board = places.labBoard, emblem = board.emblem
      const e = board.frame.root.matrixWorld.elements, c = a.camera.matrixWorld.elements
      const front = e[8] * (c[12] - e[12]) + e[9] * (c[13] - e[13]) + e[10] * (c[14] - e[14]) > 0
      // Is the board in the frustum at all? Only a board in sight is expected to repaint.
      const q = new T.Vector3(e[12], e[13], e[14]).project(a.camera)
      const inSight = Math.abs(q.x) < 1 && Math.abs(q.y) < 1 && q.z < 1
      const mine = window.__uploads.filter(u => u.t >= window.__mark && u.el === emblem.canvas)
      const seconds = (performance.now() - window.__mark) / 1000
      return { front, inSight, hold: emblem.hold, uploads: mine.length, perSecond: +(mine.length / seconds).toFixed(1) }
    })()`)
    rows.push({ theta, ...row })
  }
  console.log('emblem uploads by camera azimuth:', rows.map(r => `${r.theta}deg ${r.front ? 'front' : 'BACK'}${r.inSight ? '' : ' (out of sight)'} ${r.perSecond}/s`).join(' | '))
  const fronts = rows.filter(r => r.front && r.inSight), backs = rows.filter(r => !r.front && r.inSight)
  check(fronts.length > 0 && fronts.every(r => r.perSecond >= 5), 'the live picture repaints (>= 5/s) wherever the face is seen from the front', fronts)
  check(backs.length > 0 && backs.every(r => r.uploads === 0), `the live picture does not upload while the board is seen from behind (${backs.length} azimuths)`, backs)
  report.emblem = rows
  report.errors.push(...errors)
  await context.close()
}

/* ------------------------------------------------------------------ /world2 -- */

/** The standalone /world2 route: its camera does not draw MAP_HIDDEN, so the board must not be on it. */
async function suiteWorld2(browser) {
  const { chromium } = await import('playwright')
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  void chromium
  await page.goto(`${process.env.QA_BASE ?? 'http://localhost:3210'}/world2`, { waitUntil: 'domcontentloaded' })
  // This stage drives the engine through window.__world2, which only a development build exposes ("a production bundle deliberately ships no
  // debug handle", world2-interaction-qa.mjs). The handle is there before the game offers "Start driving"; a page that offers it without one is a production build.
  await page.waitForFunction(() => typeof window.__world2 !== 'undefined' || [...document.querySelectorAll('button')].some(b => /start driving/i.test(b.textContent)), { timeout: 180000 })
  if (!(await page.evaluate(() => typeof window.__world2 !== 'undefined'))) {
    console.log('world2 stage skipped: /world2 exposes window.__world2 only in a development build, and this server is a production build (run the suite against `npm run dev` for it)')
    await context.close()
    return
  }
  await page.waitForFunction(() => typeof window.__world2 !== 'undefined' && window.__world2.status?.ready, { timeout: 180000 })
  await page.getByRole('button', { name: 'Start driving' }).click()
  await sleep(1800)
  const bts = await page.evaluate(() => window.__world2.interactions.places.references.position('refInteractivePoint.004').toArray())
  await page.evaluate(([x, y, z]) => window.__world2.vehicle.moveTo({ x, y: y + 0.8, z }, 0), bts)
  await sleep(1500)
  await page.evaluate(() => { const g = window.__world2; g.interactions.prompts.items.find(p => p.label === 'Behind the scenes').onInteract() })
  await sleep(3500)
  const state = await page.evaluate(() => {
    const g = window.__world2, b = g.interactions.places.sceneBoard, cam = g.view.camera
    const masks = new Set(); b.screen.sign.group.traverse(o => masks.add(o.layers.mask))
    // The same test three's renderer makes: an object is drawn when its layers share a bit with the camera's.
    const seen = [...masks].every(m => (m & cam.layers.mask) !== 0)
    return { shown: b.shown, visible: b.screen.group.visible, camMask: cam.layers.mask, masks: [...masks], seen, y: +b.screen.group.position.y.toFixed(2), home: +b.home.y.toFixed(2) }
  })
  console.log('world2 board:', JSON.stringify(state))
  check(state.shown && state.visible && state.y > state.home, 'in /world2 the board rises', state)
  check(state.seen, 'in /world2 the board is on a layer the camera draws (camera mask vs board masks)', state)
  await shoot(page, path.join(OUT, 'world2-bts.png'))
  // A pixel check, not only a mask check: the same view with the board put away must differ from the view with it up, where it stands.
  const centre = await page.evaluate(() => {
    const g = window.__world2, cam = g.view.camera, sign = g.interactions.places.sceneBoard.screen.sign.group
    sign.updateWorldMatrix(true, false)
    const q = new sign.position.constructor(0, 0, 0).applyMatrix4(sign.matrixWorld).project(cam)
    return { x: (q.x + 1) / 2 * innerWidth, y: (1 - q.y) / 2 * innerHeight }
  })
  // Control (the check has teeth): the old behaviour, the board forced onto layer 2 that this camera does not draw, must look like no board.
  await page.evaluate(() => { window.__w2layers = []; window.__world2.interactions.places.sceneBoard.screen.sign.group.traverse(o => { window.__w2layers.push([o, o.layers.mask]); o.layers.set(2) }) })
  await sleep(700)
  const forced = path.join(OUT, 'world2-bts-forced-layer2.png')
  await shoot(page, forced)
  await page.evaluate(() => { for (const [o, mask] of window.__w2layers) o.layers.mask = mask })
  await page.evaluate(() => { const g = window.__world2; g.interactions.prompts.items.find(p => p.label === 'Behind the scenes').onInteract() })
  await sleep(4000)
  const away = path.join(OUT, 'world2-bts-away.png')
  await shoot(page, away)
  const sharp = (await import('sharp')).default
  const crop = async (file) => sharp(file).extract({ left: Math.max(0, Math.round(centre.x) - 140), top: Math.max(0, Math.round(centre.y) - 80), width: 280, height: 160 }).raw().toBuffer({ resolveWithObject: true })
  const up = await crop(path.join(OUT, 'world2-bts.png')), down = await crop(away)
  let diff = 0
  for (let i = 0; i < up.data.length; i++) diff += Math.abs(up.data[i] - down.data[i])
  const mean = diff / up.data.length
  const hidden = await crop(forced)
  let controlDiff = 0
  for (let i = 0; i < hidden.data.length; i++) controlDiff += Math.abs(hidden.data[i] - down.data[i])
  const control = controlDiff / hidden.data.length
  console.log('world2 board region: mean pixel difference between the board up and put away', mean.toFixed(1), '; forced onto layer 2 (the old behaviour) versus put away', control.toFixed(1))
  check(control < mean / 2, `the check has teeth: with the board forced onto the layer /world2's camera does not draw, the region looks like no board (${control.toFixed(1)} vs ${mean.toFixed(1)})`, { control, mean })
  check(mean > 20, `in /world2 the board is on screen: the region where it stands differs by ${mean.toFixed(0)}/255 from the same view with it put away`, { mean })
  report.errors.push(...errors)
  await context.close()
}

/* ------------------------------------------------------------------ main -- */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const browser = await launch()
  try {
    if (SUITES.includes('materials')) await suiteMaterials(browser)
    if (SUITES.includes('shots')) await suiteShots(browser)
    if (SUITES.includes('memory')) await suiteMemory(browser)
    if (SUITES.includes('walk')) await suiteWalk(browser)
    if (SUITES.includes('firstsight')) await suiteFirstSight(browser)
    if (SUITES.includes('fit')) await suiteFit(browser)
    if (SUITES.includes('emblem')) await suiteEmblem(browser)
    if (SUITES.includes('world2')) await suiteWorld2(browser)
  } finally {
    await browser.close()
    report.errors = [...new Set(report.errors)]
    fs.writeFileSync(path.join(OUT, BASELINE ? 'places-signs-baseline.json' : 'places-signs-report.json'), JSON.stringify(report, null, 1))
    const failed = report.checks.filter(c => !c.ok)
    console.log(`\n${report.checks.length - failed.length}/${report.checks.length} checks passed; ${report.errors.length} console errors`)
    if (failed.length || report.errors.length) process.exitCode = 1
  }
}
