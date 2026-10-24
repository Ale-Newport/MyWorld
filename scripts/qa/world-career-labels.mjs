/* /world Career stop labels: wooden plaques that face the GAMEPLAY camera, built lazily, light on GPU memory.

   QA_BASE=http://localhost:3210 QA_OUT=.qa/runs/impl/career-labels/after node scripts/qa/world-career-labels.mjs [--only=a,b] [--no-phone] [--before]

   sections (--only): structure build firstsight memory orbit drive pass steps relocate devices shots
   --against=<file>  serves that file as the Career controller (the previous revision, saved), to take a before/after without touching the tree.
   --patch=A=1,B=x  serves the working tree's controller with those module constants replaced (a negative control: --patch=SLIDE_MAX_PX=1e9 lets a plaque that the others
              make way for cross the screen in a step, and the `pass` section must FAIL its jump check; --patch=SETTLE_AFTER=0,CROSS_LENGTH=9,SLIDE_MAX_PX=1e9 lets the layout's every change of
              mind through, in a step and over the car, and the `steps` section must FAIL).
   --before   serves the Career controller saved in .qa/runs/impl/career-labels/baseline (the working tree as it was before the plaques:
              the rotated flat labels at 420 px/m), so the same numbers and pictures can be taken "before". Assertions that need the new
              structure (line.pivot, line.sign) are reported as SKIP there.

   What each section proves
   - structure  each stop's label is a pivot Group at the stone with an UNROTATED plaque (+Z reads, +Y up, not mirrored) in it, the pivot is a
                registered spherical Billboards item (moves, layer MAP_HIDDEN), the plaque is on MAP_HIDDEN too, nothing calls lookAt or reads the
                authored label frame, and the texture is 280 px/m with anisotropy 4.
   - build      lazy build, from a fresh page: nothing exists for a car that has never come near; the first approach makes ONE plaque per tick,
                the nearest first; a car dropped onto a stone gets its plaque at once and painted before it can be drawn; every plaque is
                painted out of sight before anyone is level with it; no texture is uploaded for a plaque nobody has seen.
   - firstsight frame times and texture uploads around the first reveal of each plaque, from a fresh page: no frame over budget, and no shader
                compiled for the first plaque (the program is linked under the loading cover by a hidden warm-up mesh).
   - memory     the label textures: canvas pixels, estimated GPU bytes with mips, renderer.info.memory, and the cost of building and painting them.
   - orbit      the three plaques that speak at once, at every camera yaw (every 45 deg) and elevation a player can reach (13..83 deg), at the
                default, close and far zooms, desktop and phone: each faces the camera (-n . forward >= 0.995, right . camRight >= 0.98,
                up . camUp >= 0.9), lies wholly inside the viewport, and no two overlap (default camera: always; other poses: reported).
   - drive      the car drives the whole road while the camera sweeps a full turn, sampled on the ticker AFTER the billboards: a plaque that lags the
                camera by a frame, or is ever mirrored, fails.
   - pass       the car is carried down the whole road at 2 and 5 m/s (placed every tick), desktop, a 834x1112 tablet, a 390x844 phone, a 360x640 phone and a 844x390 phone:
                how far each plaque moves against its own stone in 20 ms (no speaking plaque moves more than 25 px: none, not "almost none"; a slide has a top speed,
                SLIDE_MAX_PX, and a lane that changes its stop does not move a plaque that stands: a far move waits until the layout goes on sending it there, and a way
                over the car is not slid, the plaque wipes away and wipes in), whether a plaque that is only wiping away is left where it stood, the car's cover on the
                way (the shader's own test, feather included, run on the car's vertices), and how long a plaque that speaks has more than 5% of its area under the car's or
                the year plate's hole (the tablet used to have 57% of one under the car for most of a second).
   - steps      the `pass` drive stepped by hand at a fixed dt (the render loop stopped; some runs with dt jittered by a seeded random number), 2 and 5 m/s, down the road and up it, on
                every screen: the same answer every time, so the bound is exact: no speaking plaque moves 25 px against its stone in 20 ms, and none is slid over the car or the
                year plate (not 5% of one under the hole for a single tick). --patch=SETTLE_AFTER=0,CROSS_LENGTH=9,SLIDE_MAX_PX=1e9 (the layout's every change of mind, in a step, over the car) must FAIL
                it on the desktop, the tablet, the phone and the phone on its side (20, 91, 1 and 4 moves over 25 px, up to 184 px), and so must --against= the revision before
                (a plaque dragged over the car on the tablet, 150 ticks with up to 84% of one under the hole; 11 ticks on the phone on its side).
   - relocate   every plaque the layout wipes away to be put elsewhere (the stepped drives, 24 a screen: three lanes, 2 and 6 m/s, down and up, the default camera and zoom 1) is judged
                by where it stands once it has wiped in: one that is still the stop's plaque and has moved less than 0.08 of the canvas's height blinked in place (a lane that changes its
                stop, a stone that rises or a car that crosses the lanes tipped the layout for a few frames, and the plaque that did not need to move was wiped away and in). None may.
   - devices    twelve viewports (desktop, tablets, portrait and LANDSCAPE phones down to 320x568 and 667x375, touch on the phones and tablets) at the
                gameplay camera's default and fully zoomed-out distances, with the car on the work overlap, the projects overlap and every lane at
                once: every plaque is inside the viewport, none stands under a HUD button (the top bar, the touch buttons, the speed readout),
                none covers the car (share of the car's own pixels under a plaque), none overlaps another, and the subtitle is at least 12 CSS px.
                A plaque stands no further from its stone than a quarter of the screen's shorter side and is given up where the car, the year plate and the
                buttons leave it no place that near: all three speak at every spot on a screen with room, at least two on a phone (one on a 320 px phone) and
                60% of all of them. --devices=name,name picks some (names are in DEVICES).
   - shots      the real gameplay camera (FOV 25, 21 m at the default zoom, 15 m at zoom 1; phone 390x844 touch) at every lane head (at rest
                and with the stone up), the overlap on the work and projects lanes, and the camera orbited. */
import fs from 'node:fs'
import path from 'node:path'
import { launch, openPlayer as openOnce, sleep, assert, finish, watch } from './lib.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback }
const BEFORE = args.includes('--before')
const VIEWS = opt('views', 'desk,phone').split(',')
const ONLY = opt('only', '') ? opt('only', '').split(',') : null
const want = (section) => !ONLY || ONLY.includes(section)
const DIR = process.env.QA_OUT ?? path.resolve('.qa/runs/impl/career-labels', BEFORE ? 'before' : 'after')
fs.mkdirSync(DIR, { recursive: true })
const file = (name) => path.join(DIR, name)
const results = []
const skip = (message) => { results.push({ ok: true, message: `SKIP ${message}` }); console.log(`SKIP ${message}`) }
const note = (message) => console.log(`     ${message}`)
const BASELINE = path.resolve('.qa/runs/impl/career-labels/baseline/Career.js')
const CAREER_JS = 'public/archipelago/preview/portfolio/world2/interactions/Career.js'
const CAREER_TS = 'src/world2/interactions/Career.ts'

/* ---------- the page side: everything is read off the live runtime ---------- */
function install() {
  const A = globalThis.__archipelago, T = A.THREE
  const inst = A.gameplay.instances.find((i) => i.parts.career)
  const c = inst.parts.career
  const Q = { A, T, inst, c }
  /** Put the car at a frame position (the career's own metres), facing down the road (local -Z). */
  Q.place = (x, z, y = 0.5) => {
    const d = inst.physics.vector({ x: 0, y: 0, z: -1 })
    return A.driving.place({ position: inst.physics.point({ x, y, z }), rotation: Math.atan2(-d.z, d.x) }, { reason: 'qa' })
  }
  /** The chase camera at azimuth theta, elevation phi (radians from the vertical axis, View's convention), zoom ratio. */
  Q.camera = (theta, phi, zoom) => {
    const v = A.driving.view, s = v.spherical
    if (theta !== undefined) { s.targetTheta = s.theta = theta }
    if (phi !== undefined) { s.targetPhi = s.phi = phi }
    if (zoom !== undefined) { v.zoom.baseRatio = v.zoom.smoothedRatio = v.zoom.ratio = zoom }
    v.snapToTarget(); v.smoothedObstruction = Infinity; v.update()
  }
  Q.frames = (k) => new Promise((resolve) => { const step = () => (--k <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step) })
  /** The label object of a line, whatever the structure: the pivot when there is one. */
  Q.root = (l) => l.pivot ?? l.label
  /** Plaque meshes of a line (the thing that is drawn). */
  Q.meshes = (l) => { const out = []; Q.root(l)?.traverse((o) => { if (o.isMesh) out.push(o) }); return out }
  /** Bytes the label textures take on the GPU: base + mips, 4 bytes a pixel, for each canvas of each label. */
  Q.labelTextures = () => {
    const seen = new Set(), rows = []
    for (const l of c.lines) {
      const textures = []
      for (const m of Q.meshes(l)) {
        const mat = m.material
        if (mat.uniforms?.map?.value) textures.push(mat.uniforms.map.value)
        if (mat.map) textures.push(mat.map)
        if (mat.emissiveMap) textures.push(mat.emissiveMap)
      }
      for (const t of textures) {
        if (seen.has(t.uuid)) continue
        seen.add(t.uuid)
        const w = t.image?.width ?? 0, h = t.image?.height ?? 0
        if (w <= 1) continue
        rows.push({ id: l.stop.id, w, h, mips: t.generateMipmaps, anisotropy: t.anisotropy, bytes: Math.round(w * h * 4 * (t.generateMipmaps ? 4 / 3 : 1)) })
      }
    }
    return { rows, total: rows.reduce((n, r) => n + r.bytes, 0) }
  }
  /** Projected box of the plaque (CSS px) from its visible meshes' own corners; null when it is not showing. */
  Q.box = (l) => {
    const cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect()
    cam.updateMatrixWorld(true)
    const xs = [], ys = [], corner = new T.Vector3()
    for (const m of Q.meshes(l)) {
      if (m.geometry.getAttribute('position').count < 4) continue
      for (let a = m; a; a = a.parent) if (!a.visible) return null
      m.updateWorldMatrix(true, false)
      m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        corner.set(x, y, z).applyMatrix4(m.matrixWorld).project(cam)
        xs.push((corner.x * 0.5 + 0.5) * cv.width + cv.left); ys.push((-corner.y * 0.5 + 0.5) * cv.height + cv.top)
      }
    }
    if (!xs.length) return null
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), cssWidth: cv.width, cssHeight: cv.height }
  }
  /** How the plaque stands against the camera: -n . forward, right . camRight, up . camUp (1 = perfect). */
  Q.facing = (l) => {
    const cam = A.camera, root = Q.root(l)
    cam.updateMatrixWorld(true); root.updateWorldMatrix(true, true)
    const q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3()
    root.matrixWorld.decompose(p, q, s)
    const f = new T.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)
    const n = new T.Vector3(0, 0, 1).applyQuaternion(q), r = new T.Vector3(1, 0, 0).applyQuaternion(q), u = new T.Vector3(0, 1, 0).applyQuaternion(q)
    const cr = new T.Vector3(1, 0, 0).applyQuaternion(cam.quaternion), cu = new T.Vector3(0, 1, 0).applyQuaternion(cam.quaternion)
    return { facing: -n.dot(f), right: r.dot(cr), up: u.dot(cu), worldScale: s.x }
  }
  /** The page's own controls a plaque must not stand under, as CSS-px rectangles: every button of the top bar, the touch buttons that are showing, the speed readout. */
  Q.hudRects = () => {
    const out = []
    const add = (name, el) => { if (!el) return; const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0) out.push({ name, x0: b.left, y0: b.top, x1: b.right, y1: b.bottom }) }
    document.querySelectorAll('#player-nav a, #player-nav button').forEach((el) => add(el.id || 'nav', el))
    document.querySelectorAll('#touch-controls button').forEach((el) => add(el.id || 'touch', el))
    add('speed', document.getElementById('speed'))
    return out
  }
  /**
   * The share of the car that a plaque covers: every vertex of every visible mesh of the car, projected, counted when it falls inside a plaque's rectangle.
   * The car is blocky and its vertices lie on its outline and its edges, so the share follows what a person sees covered (the union of boxes it replaces was a looser fit).
   */
  Q.carShare = (plaques, holes = false) => {
    if (!plaques.length) return 0
    const cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect()
    cam.updateMatrixWorld(true)
    const v = new T.Vector3()
    // `holes`: what is left once the shader has cut the car's rectangle and the year plate's out of every plaque, as the screen shows it: the shader's own test (its feather
    // included, read off the plaque's fragment source), run on each vertex of the car, so that the measure does not depend on a pixel margin guessed here.
    const cut = holes ? Q.shaderCut() : null
    let total = 0, covered = 0
    A.driving.visual.chassis.updateWorldMatrix(true, true)
    A.driving.visual.chassis.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      for (let a = o; a; a = a.parent) if (!a.visible) return
      const pos = o.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld).project(cam)
        const sx = (v.x * 0.5 + 0.5) * cv.width + cv.left, sy = (-v.y * 0.5 + 0.5) * cv.height + cv.top
        total++
        if (cut && cut(v.x, v.y)) continue
        for (const b of plaques) if (sx >= b.x0 && sx <= b.x1 && sy >= b.y0 && sy <= b.y1) { covered++; break }
      }
    })
    return total ? covered / total : 0
  }
  /**
   * The plaque shader's discard for a point in clip space, as the shader computes it: smoothstep edges feathered outwards by HOLE_FEATHER, the product of the two axes
   * past LABEL_HOLE-scaled one half. Reads the feather and the scale off a built plaque's fragment source (null: no plaque is built, nothing is cut or covered).
   */
  Q.shaderCut = () => {
    const src = c.lines.find((l) => l.label)?.label.material.fragmentShader
    const feather = Number(/uCar\.xy - ([0-9.]+)/.exec(src ?? '')?.[1]), scale = Number(/if \(([0-9.]+) \* max\(across/.exec(src ?? '')?.[1])
    if (!(feather > 0 && scale > 0)) return () => false
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
    const box = (r, x, y) => (r.x < r.z ? sm(r.x - feather, r.x, x) * (1 - sm(r.z, r.z + feather, x)) * sm(r.y - feather, r.y, y) * (1 - sm(r.w, r.w + feather, y)) : 0)
    const car = c.carRect.value, plate = c.plateRect.value
    return (x, y) => scale * Math.max(box(plate, x, y), box(car, x, y)) > 0.5
  }
  /** The two lines' sizes on the screen, CSS px (em): what the painter really set them at, times the plaque's world scale, at its distance. */
  Q.typePx = (l) => {
    if (!l.type) return null
    const cv = A.renderer.domElement.getBoundingClientRect()
    const wp = new T.Vector3().setFromMatrixPosition(Q.root(l).matrixWorld)
    const mesh = l.label
    mesh.updateWorldMatrix(true, false)
    const s = new T.Vector3().setFromMatrixScale(mesh.matrixWorld).x
    // a plaque is parallel to the screen, so its size on it goes with its depth along the lens axis, not with its distance
    A.camera.updateMatrixWorld(true)
    const depth = -wp.clone().applyMatrix4(A.camera.matrixWorldInverse).z
    const pxPerMetre = cv.height / (2 * depth * Math.tan(A.camera.fov * Math.PI / 360))
    return { head: (l.type.head / 280) * s * pxPerMetre, sub: (l.type.sub / 280) * s * pxPerMetre, scale: s }
  }
  Q.drawInfo = () => ({ calls: A.renderer.info.render.calls, triangles: A.renderer.info.render.triangles, textures: A.renderer.info.memory.textures, geometries: A.renderer.info.memory.geometries, programs: A.renderer.info.programs?.length ?? null })
  /** Every plaque that is showing, with its box and facing. */
  Q.readings = () => {
    const rows = c.lines.filter((l) => l.label && l.pivot.visible && l.reveal > 0.9).map((l) => ({ id: l.stop.id, lane: l.track.id, box: Q.box(l), ...Q.facing(l) }))
    const hud = Q.hudRects()
    const lapsHud = (b, h) => Math.min(b.x1, h.x1) - Math.max(b.x0, h.x0) > 2 && Math.min(b.y1, h.y1) - Math.max(b.y0, h.y0) > 2
    for (const r of rows) r.hud = r.box ? hud.filter((h) => lapsHud(r.box, h)).map((h) => h.name) : []
    // the car's pixels under any plaque, one number for the frame (every row carries it)
    const share = Q.carShare(rows.filter((r) => r.box).map((r) => r.box))
    const seen = Q.carShare(rows.filter((r) => r.box).map((r) => r.box), true)
    for (const r of rows) { r.carShare = share; r.carSeen = seen }
    return rows
  }
  /** Everything a person could object to about the plaques that are showing, in one reading: where they stand against the viewport, the HUD and the car, and how big the type is. */
  Q.audit = () => {
    const rows = Q.readings()
    const hud = Q.hudRects()
    const boxes = rows.filter((r) => r.box).map((r) => r.box)
    const overlap = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 2 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 2
    const out = rows.map((r) => {
      const l = c.lines.find((x) => x.stop.id === r.id)
      const t = Q.typePx(l)
      const b = r.box
      return {
        id: r.id, lane: r.lane, facing: r.facing, right: r.right, up: r.up, box: b && { x0: +b.x0.toFixed(1), y0: +b.y0.toFixed(1), x1: +b.x1.toFixed(1), y1: +b.y1.toFixed(1) }, viewport: b && [b.cssWidth, b.cssHeight],
        cut: !b || b.x0 < -0.5 || b.y0 < -0.5 || b.x1 > b.cssWidth + 0.5 || b.y1 > b.cssHeight + 0.5,
        hud: b ? hud.filter((h) => overlap(b, h)).map((h) => h.name) : [],
        type: t && { head: +t.head.toFixed(1), sub: +t.sub.toFixed(1), scale: +t.scale.toFixed(2) },
        carShare: b ? +Q.carShare([b]).toFixed(3) : 0,
      }
    })
    let lapped = 0
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlap(boxes[i], boxes[j])) lapped++
    return { plaques: out, lapped, carShare: +Q.carShare(boxes).toFixed(3), carSeen: +Q.carShare(boxes, true).toFixed(3), hud: hud.map((h) => h.name) }
  }
  globalThis.__Q = Q
  return true
}

async function openPlayer(pg) {
  try { await openOnce(pg) } catch (error) { console.log(`openPlayer: ${String(error).split('\n')[0]}; loading once more`); await openOnce(pg) }
}
/** --against=<file> serves that file as the Career controller (e.g. the previous revision, saved), so a before/after is taken without touching the tree. */
const AGAINST = opt('against', '')
async function route(ctx) {
  const patch = opt('patch', '')
  if (patch && !BEFORE && !AGAINST) {
    // a negative control: serve the working tree's controller with some module constants replaced (NAME=value,NAME=value)
    let body = fs.readFileSync(CAREER_JS, 'utf8')
    for (const pair of patch.split(',')) {
      const [name, value] = pair.split('=')
      const pattern = new RegExp(`const ${name} = [^\\n]+`)
      if (!pattern.test(body)) throw new Error(`--patch: no constant ${name} in ${CAREER_JS}`)
      body = body.replace(pattern, `const ${name} = ${value};`)
    }
    await ctx.route('**/portfolio/world2/interactions/Career.js*', (r) => r.fulfill({ contentType: 'text/javascript; charset=utf-8', body }))
    return
  }
  if (!BEFORE && !AGAINST) return
  const body = fs.readFileSync(AGAINST || BASELINE, 'utf8')
  await ctx.route('**/portfolio/world2/interactions/Career.js*', (r) => r.fulfill({ contentType: 'text/javascript; charset=utf-8', body }))
}
/** Counts what the GPU is asked to do, with its cost, from the first line of the page: texture uploads, mipmaps, programs linked. */
const GL_PROBE = () => {
  const g = (globalThis.__gl = { on: false, uploads: [], mips: 0, links: 0, linkMs: 0, frames: [] })
  const proto = WebGL2RenderingContext.prototype
  for (const name of ['texImage2D', 'texSubImage2D']) {
    const original = proto[name]
    proto[name] = function (...a) {
      if (!g.on) return original.apply(this, a)
      const t0 = performance.now()
      const r = original.apply(this, a)
      const src = a[a.length - 1]
      g.uploads.push({ ms: performance.now() - t0, w: src?.width ?? a[3] ?? 0, h: src?.height ?? a[4] ?? 0 })
      return r
    }
  }
  const mip = proto.generateMipmap
  proto.generateMipmap = function (...a) { if (g.on) g.mips++; return mip.apply(this, a) }
  const link = proto.linkProgram
  proto.linkProgram = function (...a) { const t0 = performance.now(); const r = link.apply(this, a); if (g.on) { g.links++; g.linkMs += performance.now() - t0 }; return r }
  let last = performance.now()
  const loop = (now) => { if (g.on) g.frames.push(now - last); last = now; requestAnimationFrame(loop) }
  requestAnimationFrame(loop)
}

const browser = await launch()
const errors = []
/** A page that has loaded the player from scratch, with the probes installed first. */
async function openFresh({ viewport = { width: 1440, height: 900 }, probe = false, extra = {} } = {}) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, ...extra })
  await route(ctx)
  if (probe) await ctx.addInitScript(GL_PROBE)
  const pg = await ctx.newPage()
  const errs = watch(pg)
  await openPlayer(pg)
  await sleep(1500)
  await pg.evaluate(install)
  return { ctx, pg, errs }
}
const goto = async (pg, x, z, wait = 1500) => { await pg.evaluate(([x, z]) => __Q.place(x, z), [x, z]); await sleep(wait) }
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; return { n: s.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(s[s.length - 1] ?? 0).toFixed(1) } }

console.log(BEFORE ? '--before: serving the Career controller saved in ' + path.relative('.', BASELINE) : AGAINST ? '--against: serving the Career controller saved in ' + AGAINST : 'serving the working tree')

/* =============================== the first page: everything that does not need a fresh load =============================== */
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
await route(context)
const page = await context.newPage()
const pageErrors = watch(page)
const sectionsOnMain = ['structure', 'orbit', 'shots'].some(want)

/* =============================== build (a fresh page) =============================== */
if (want('build')) {
  if (BEFORE) skip('build: the lazy build is new')
  else {
    const { ctx, pg, errs } = await openFresh()
    const start = await pg.evaluate(() => {
      const { A, c } = __Q
      const player = c.group.worldToLocal(A.driving.vehicle.position.clone())
      return { plaques: c.plaques, reach: c.reach, centre: c.centre.toArray(), spawn: [player.x, player.z], distance: Math.hypot(player.x - c.centre.x, player.z - c.centre.z) }
    })
    note(`fresh page: ${start.plaques} plaques, the car ${start.distance.toFixed(1)} m from the middle of the road (reach ${start.reach.toFixed(1)} m)`)
    assert(start.plaques === 0 || start.distance <= start.reach, `no plaque exists for a car that has never come within reach (${start.plaques} at ${start.distance.toFixed(0)} m)`, results)
    // approach the road but stay clear of every stone's span: one plaque a tick, the nearest to the car first
    const approach = await pg.evaluate(async () => {
      const { A, c } = __Q
      const log = []
      const order = []
      let last = c.plaques
      const handle = () => {
        const now = c.plaques
        if (now !== last) { log.push(now - last); const built = c.lines.filter((l) => l.sign && !order.includes(l.stop.id)); for (const l of built) order.push(l.stop.id); last = now }
      }
      A.driving.ticker.events.on('tick', handle, 99)
      const before = A.renderer.info.memory.textures
      __Q.place(27, c.lines.reduce((m, l) => Math.max(m, l.origin.z), -Infinity) + 14)
      await new Promise((r) => setTimeout(r, 1800))
      const after = A.renderer.info.memory.textures
      A.driving.ticker.events.off('tick', handle)
      const car = c.group.worldToLocal(A.driving.vehicle.position.clone())
      const byDistance = c.lines.map((l) => ({ id: l.stop.id, d: Math.hypot(l.origin.x - car.x, l.origin.z - car.z) })).sort((a, b) => a.d - b.d).map((l) => l.id)
      return { built: c.plaques, log, order, byDistance, texturesBefore: before, texturesAfter: after, unpainted: c.lines.filter((l) => l.sign?.main?.unpainted).length, painted: c.lines.filter((l) => l.sign && !l.sign.main.unpainted).length, visible: c.lines.filter((l) => l.pivot.visible).length }
    })
    note(`approach: built ${approach.built} in steps of ${approach.log.join(',')} per tick; order ${approach.order.join(' ')}; painted ${approach.painted}, unpainted ${approach.unpainted}`)
    assert(approach.built === 9, `driving up to the road makes all nine plaques (${approach.built})`, results)
    assert(approach.log.length >= 8 && approach.log.every((n) => n === 1), `one plaque a tick, never two in a frame (steps ${approach.log.join(',')})`, results)
    assert(approach.order[0] === approach.byDistance[0], `the nearest stone's plaque is made first (${approach.order[0]} vs nearest ${approach.byDistance[0]})`, results)
    assert(approach.unpainted === 0, `every plaque is painted before anyone is level with it (${approach.painted} painted, ${approach.unpainted} not)`, results)
    assert(approach.visible === 0, 'no plaque is showing while the car is clear of every span', results)
    assert(approach.texturesAfter === approach.texturesBefore, `no texture is uploaded for a plaque nobody has seen (renderer.info textures ${approach.texturesBefore} -> ${approach.texturesAfter})`, results)
    errors.push(...errs)
    await ctx.close()

    // dropped straight onto a stone: its plaque exists and is painted before a frame can draw it
    const second = await openFresh()
    const dropped = await second.pg.evaluate(async () => {
      const { A, c } = __Q
      if (c.plaques > 0) return { skipped: `${c.plaques} plaques already exist at spawn` }
      const target = c.lines.find((l) => l.stop.id === 'metaview') ?? c.lines[5]
      const frames = []
      A.driving.ticker.events.on('tick', () => { frames.push({ built: c.plaques, shown: c.lines.filter((l) => l.pivot.visible).length, unpainted: c.lines.filter((l) => l.pivot.visible && l.sign?.main?.unpainted).length }) }, 99)
      __Q.place(target.stoneHome.x + 1, target.stoneHome.z - 0.6)
      await new Promise((r) => setTimeout(r, 600))
      const first = frames.find((f) => f.shown > 0)
      return { id: target.stop.id, first, built: c.plaques, sign: !!target.sign, painted: target.sign ? !target.sign.main.unpainted : false, maxUnpaintedShown: Math.max(0, ...frames.map((f) => f.unpainted)) }
    })
    if (dropped.skipped) skip(`dropped onto a stone: ${dropped.skipped}`)
    else {
      note(`dropped onto ${dropped.id}: first showing frame ${JSON.stringify(dropped.first)}, ${dropped.built} built after 600 ms`)
      assert(dropped.sign && dropped.painted, 'a car dropped onto a stone gets its plaque at once, painted', results)
      assert(dropped.maxUnpaintedShown === 0, `no frame shows a plaque that has not been painted (${dropped.maxUnpaintedShown})`, results)
      assert(dropped.built >= 8, `the rest follow, one a tick (${dropped.built} of 9 after 600 ms)`, results)
    }
    // gone (a map travel): nothing here ticks any more, so the plaques are put away at once, and they wipe in again on the way back
    const away = await second.pg.evaluate(async () => {
      const { c } = __Q
      const target = c.lines.find((l) => l.stop.id === 'metaview') ?? c.lines[5]
      const shown = () => c.lines.filter((l) => l.pivot.visible).length
      __Q.place(target.stoneHome.x + 1, target.stoneHome.z - 0.6)
      await new Promise((r) => setTimeout(r, 1500))
      const before = shown()
      __Q.place(27.06, c.lines.reduce((m, l) => Math.max(m, l.origin.z), -Infinity) + 90)
      await new Promise((r) => setTimeout(r, 700))
      const gone = shown(), reveals = c.lines.map((l) => l.reveal).reduce((m, v) => Math.max(m, v), 0)
      __Q.place(target.stoneHome.x + 1, target.stoneHome.z - 0.6)
      await new Promise((r) => setTimeout(r, 1500))
      return { before, gone, reveals, back: shown() }
    })
    note(`away and back: ${away.before} plaques showing, ${away.gone} 90 m away (reveal ${away.reveals}), ${away.back} on return`)
    assert(away.before >= 1 && away.gone === 0 && away.reveals === 0 && away.back >= 1, 'plaques are put away when the car leaves the road and wipe in again when it returns', results)
    errors.push(...second.errs)
    await second.ctx.close()
  }
}

/* =============================== firstsight (a fresh page, probes installed) =============================== */
if (want('firstsight')) {
  const { ctx, pg, errs } = await openFresh({ probe: true })
  const lanes = await pg.evaluate(() => Object.fromEntries(['education', 'work', 'projects'].map((t) => [t, __Q.c.lines.filter((l) => l.track.id === t).map((l) => ({ id: l.stop.id, x: l.stoneHome.x, head: l.stoneHome.z }))])))
  const window_ = async (label, action, ms = 1600) => {
    await pg.evaluate(() => { const g = globalThis.__gl; g.uploads.length = 0; g.frames.length = 0; g.mips = 0; g.links = 0; g.linkMs = 0; g.programs = __Q.drawInfo().programs; g.on = true })
    await action()
    await sleep(ms)
    const r = await pg.evaluate(() => { const g = globalThis.__gl; g.on = false; return { frames: g.frames.slice(2), uploads: g.uploads.slice(), mips: g.mips, links: g.links, linkMs: g.linkMs, programs: __Q.drawInfo().programs - g.programs, plaques: __Q.c.plaques } })
    const ft = stats(r.frames)
    const up = r.uploads.filter((u) => u.w > 64)
    const bytes = up.reduce((n, u) => n + u.w * u.h * 4, 0)
    note(`${label.padEnd(34)} frames ${ft.n} p50 ${ft.p50} p95 ${ft.p95} max ${ft.max} ms | uploads ${up.length} (${(bytes / 1048576).toFixed(2)} MB, ${up.reduce((n, u) => n + u.ms, 0).toFixed(1)} ms, worst ${Math.max(0, ...up.map((u) => u.ms)).toFixed(1)}) mips ${r.mips} | programs +${r.programs} links ${r.links} (${r.linkMs.toFixed(1)} ms) | plaques ${r.plaques}`)
    return { label, ...ft, uploads: up.length, uploadMs: up.reduce((n, u) => n + u.ms, 0), worstUpload: Math.max(0, ...up.map((u) => u.ms)), bytes, programs: r.programs, links: r.links, linkMs: r.linkMs }
  }
  const rows = []
  rows.push(await window_('idle at spawn', async () => {}, 1200))
  rows.push(await window_('approach (build + paint, hidden)', async () => { await pg.evaluate(([z]) => __Q.place(27, z), [lanes.education[0].head + 14]) }, 2600))
  rows.push(await window_('education head: first reveal', async () => { await pg.evaluate(([x, z]) => __Q.place(x + 1, z), [lanes.education[0].x, lanes.education[0].head - 0.5]) }, 2200))
  rows.push(await window_('work head: first reveal', async () => { await pg.evaluate(([x, z]) => __Q.place(x + 1, z), [lanes.work[0].x, lanes.work[0].head - 0.5]) }, 2200))
  rows.push(await window_('projects head: first reveal', async () => { await pg.evaluate(([x, z]) => __Q.place(x - 1, z), [lanes.projects[0].x, lanes.projects[0].head - 0.5]) }, 2200))
  rows.push(await window_('all lanes at once (overlap)', async () => { await pg.evaluate(() => __Q.place(26.05, -1.2)) }, 2200))
  fs.writeFileSync(file('firstsight.json'), JSON.stringify(rows, null, 1))
  if (!BEFORE) {
    const reveals = rows.filter((r) => /first reveal/.test(r.label))
    assert(reveals.every((r) => r.max < 50), `no frame over 50 ms around any first reveal (worst ${Math.max(...reveals.map((r) => r.max))} ms)`, results)
    assert(reveals.every((r) => r.worstUpload < 8), `no single texture upload over 8 ms (worst ${Math.max(...reveals.map((r) => r.worstUpload)).toFixed(1)} ms)`, results)
    // The first reveal also shows the year readout, whose program is made the first time the controller ticks (career-geo's, and the same +1 as before the plaques);
    // the plaques' own program is linked under the loading cover by the warm-up mesh, so it must not add one.
    const programs = reveals.map((r) => r.programs)
    assert(programs[0] <= 1 && programs.slice(1).every((n) => n === 0), `the plaques' shader is not compiled at a first reveal (programs created in the windows: ${programs.join(',')}; the same +1 as before the plaques is the readout's)`, results)
  }
  errors.push(...errs)
  await ctx.close()
}

/* =============================== the shared page =============================== */
let info = null, newApi = false, byTrack = {}
const side = (track) => (track === 'projects' ? -1 : 1)
if (sectionsOnMain) {
  await openPlayer(page)
  await sleep(1500)
  assert(await page.evaluate(install), 'the Career controller is running in /world', results)
  info = await page.evaluate(() => {
    const { c } = __Q
    return {
      stops: c.lines.length, lanes: c.lanes,
      lines: c.lines.map((l) => ({ id: l.stop.id, track: l.track.id, x: l.stoneHome.x, head: l.stoneHome.z, span: l.span, headline: l.stop.headline, subtitle: l.stop.subtitle, pivot: !!l.pivot })),
    }
  })
  fs.writeFileSync(file('career-info.json'), JSON.stringify(info, null, 1))
  newApi = info.lines.every((l) => l.pivot)
  console.log(`career: ${info.stops} stops, plaque structure ${newApi ? 'present' : 'absent (the rotated flat labels)'}`)
  for (const l of info.lines) (byTrack[l.track] ??= []).push(l)
}
/** Drive the car along every lane so each stone has been near, and every plaque exists. */
async function prime(pg) {
  for (const l of info.lines) await goto(pg, l.x + side(l.track), l.head - 0.5, 450)
  await goto(pg, 26.05, -1.0, 1500)
}

/* =============================== structure =============================== */
if (want('structure') && sectionsOnMain) {
  const src = fs.readFileSync(CAREER_JS, 'utf8'), ts = fs.readFileSync(CAREER_TS, 'utf8')
  if (!BEFORE) {
    assert(!/\.lookAt\(/.test(src) && !/\.lookAt\(/.test(ts), 'Career never calls lookAt (it aims at the car, in the wrong frame)', results)
    assert(/pivot\.quaternion\.copy\(fallback\)/.test(ts), 'the authored label pose (45 deg yaw, 15 deg lean) survives only as the no-camera fallback of the pivot', results)
    assert(/rotateX\(/.test(src) === false, 'no label geometry is laid flat with rotateX', results)
    assert(/LABEL_DPM = 280/.test(src) && /LABEL_ANISOTROPY = 4/.test(src), 'the plaques are 280 px/m with anisotropy 4', results)
  }
  if (!newApi) skip('structure: the pivot/plaque structure is not there (before)')
  else {
    await prime(page)
    const report = await page.evaluate(async () => {
      const { A, c } = __Q
      const { Billboards, MAP_HIDDEN_LAYER } = await import('/archipelago/preview/portfolio/world2/interactions/Billboards.js')
      const system = Billboards.for(A.driving.ticker)
      return c.lines.map((l) => {
        const item = system.items.find((it) => it.object === l.pivot)
        const mesh = l.label
        const g = mesh.geometry, pos = g.getAttribute('position'), nor = g.getAttribute('normal'), uv = g.getAttribute('uv')
        // the front facet: normal +Z. u must grow with x and v with y, or the text would be mirrored or upside down
        let ok = true, front = 0, minX = Infinity, maxX = -Infinity
        for (let i = 0; i < pos.count; i++) {
          minX = Math.min(minX, pos.getX(i)); maxX = Math.max(maxX, pos.getX(i))
          if (nor.getZ(i) > 0.99) {
            front++
            if (Math.abs((uv.getX(i) - 0.5) * 1 - pos.getX(i) / (l.width - 0.04)) > 1e-6 || Math.abs((uv.getY(i) - 0.5) - pos.getY(i) / (0.91 - 0.04)) > 1e-6) ok = false
          }
        }
        const layers = []
        l.pivot.traverse((o) => { if (!o.isMesh || o.visible !== false || o.name !== 'career label / shader warm-up') layers.push(o.layers.mask) })
        const t = l.sign.main.texture
        return {
          id: l.stop.id, pivot: l.pivot.type, parentIsGroup: l.pivot.parent === c.group, mode: item?.mode, moves: item?.moves, scaled: !!item?.scale, compensate: item?.scale?.compensate,
          pivotLayer: l.pivot.layers.mask === 1 << MAP_HIDDEN_LAYER, plaqueLayers: layers.every((m) => m === 1 << MAP_HIDDEN_LAYER),
          meshQuaternion: mesh.quaternion.toArray(), groupRotation: [l.sign.group.rotation.x, l.sign.group.rotation.y, l.sign.group.rotation.z],
          uvUnmirrored: ok && front >= 4, leftEdge: +(l.sign.group.position.x - l.shiftX + minX).toFixed(3), width: +(maxX - minX).toFixed(3),
          material: mesh.material.type, depthTest: mesh.material.depthTest, transparent: mesh.material.transparent,
          canvas: [t.image.width, t.image.height], anisotropy: t.anisotropy, signMount: l.sign.group.userData.signMount, circular: 'sign' in l.sign.group.userData,
        }
      })
    })
    fs.writeFileSync(file('structure.json'), JSON.stringify(report, null, 1))
    const all = (f) => report.every(f)
    assert(all((r) => r.pivot === 'Group' && r.parentIsGroup), 'every label is a pivot Group in the career group', results)
    assert(all((r) => r.mode === 'spherical' && r.moves && r.scaled && r.compensate), 'every pivot is a registered spherical billboard that moves, scales with distance and cancels the frame scale', results)
    assert(all((r) => r.pivotLayer && r.plaqueLayers), 'the pivot and everything in it are on MAP_HIDDEN (not baked into the map photograph)', results)
    assert(all((r) => r.meshQuaternion.every((v, i) => Math.abs(v - [0, 0, 0, 1][i]) < 1e-9) && r.groupRotation.every((v) => v === 0)), 'the plaque is UNROTATED in its pivot (+Z reads, +Y up)', results)
    assert(all((r) => r.uvUnmirrored), 'the front face maps u with +x and v with +y: the text cannot be mirrored or upside down', results)
    assert(all((r) => Math.abs(r.leftEdge - 0.36) < 1e-3), `every plaque starts 0.36 m right of the stone's axis, where the wipe starts (${[...new Set(report.map((r) => r.leftEdge))].join(', ')})`, results)
    assert(all((r) => r.anisotropy === 4 && r.canvas[1] >= 230 && r.canvas[1] <= 260), `textures are 280 px/m, anisotropy 4 (${report.map((r) => r.canvas.join('x')).join(' ')})`, results)
    assert(all((r) => r.material === 'ShaderMaterial' && r.depthTest === false && r.transparent), 'the plaques share one shader and are drawn over the scene (transparent queue, after the car\'s glass)', results)
    assert(all((r) => !r.circular && r.signMount === 'billboard'), 'no circular userData (the Edit preview clones the group) and the mount says billboard', results)
  }
}

/* =============================== memory (a fresh page) =============================== */
if (want('memory')) {
  const { ctx, pg, errs } = await openFresh()
  // what the label textures are the moment the world is ready, before the car has gone anywhere
  const start = await pg.evaluate(() => ({ labels: __Q.labelTextures(), draw: __Q.drawInfo(), plaques: __Q.c.plaques }))
  const mb = (n) => (n / 1048576).toFixed(2)
  console.log(`at startup: ${start.labels.rows.length} label textures, ${mb(start.labels.total)} MB; renderer.info textures ${start.draw.textures}, geometries ${start.draw.geometries}, programs ${start.draw.programs}`)
  const infoHere = await pg.evaluate(() => __Q.c.lines.map((l) => ({ id: l.stop.id, track: l.track.id, x: l.stoneHome.x, head: l.stoneHome.z })))
  for (const l of infoHere) await goto(pg, l.x + side(l.track), l.head - 0.5, 450)
  await goto(pg, 26.05, -1.0, 2200)
  const mem = await pg.evaluate(() => ({ labels: __Q.labelTextures(), draw: __Q.drawInfo() }))
  fs.writeFileSync(file('memory.json'), JSON.stringify({ start, mem }, null, 1))
  for (const r of mem.labels.rows) note(`${r.id.padEnd(26)} ${String(r.w).padStart(4)} x ${String(r.h).padStart(3)} px  mips ${r.mips ? 'yes' : 'no '} aniso ${r.anisotropy}  ${mb(r.bytes)} MB`)
  console.log(`after every label was seen: ${mem.labels.rows.length} label textures, ${mb(mem.labels.total)} MB on the GPU (base + mips); renderer.info textures ${mem.draw.textures}, geometries ${mem.draw.geometries}, programs ${mem.draw.programs}`)
  const cost = await pg.evaluate(() => {
    const { c } = __Q
    if (typeof c.buildLabel === 'function' && !c.lines[0]?.pivot) {
      const t0 = performance.now()
      const made = c.lines.map((l) => c.buildLabel(l.stop, l.track))
      const ms = performance.now() - t0
      for (const m of made) { m.geometry.dispose(); m.material.dispose(); m.material.uniforms.map.value.dispose() }
      return { ms, built: made.length, kind: 'buildLabel x all' }
    }
    return null
  })
  if (cost) note(`building and painting ${cost.built} labels: ${cost.ms.toFixed(1)} ms (${cost.kind})`)
  if (!BEFORE) {
    assert(start.labels.total === 0 && start.plaques === 0, `no label texture exists at startup (${mb(start.labels.total)} MB; the 420 px/m labels held 23.09 MB from the first frame)`, results)
    assert(mem.labels.total < 12 * 1048576, `the nine label textures take ${mb(mem.labels.total)} MB once all have been seen (the 420 px/m labels took 23.09 MB)`, results)
  }
  errors.push(...errs)
  await ctx.close()
}

/* =============================== orbit =============================== */
async function orbitPass(pg, view, zoom, thetas, phis) {
  const rows = []
  for (const t of thetas) for (const p of phis) {
    await pg.evaluate(([t, p, z]) => __Q.camera(t * Math.PI / 180, p * Math.PI, z), [t, p, zoom])
    // the plaques slide to their places (10 a second): give them time, as an orbit drag does
    await pg.evaluate(() => __Q.frames(45))
    const got = await pg.evaluate(() => __Q.readings())
    for (const r of got) rows.push({ theta: t, phi: p, ...r })
    const boxes = got.filter((r) => r.box)
    let overlaps = 0
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box, b = boxes[j].box
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
      if (w > 2 && h > 2) overlaps++
    }
    rows.push({ pose: true, theta: t, phi: p, shown: got.length, overlaps, hudHits: got.filter((r) => r.hud?.length).length, carShare: got[0]?.carShare ?? 0, carSeen: got[0]?.carSeen ?? 0 })
  }
  return rows
}
if (want('orbit') && sectionsOnMain) {
  if (!newApi) skip('orbit: needs the plaque structure')
  else {
    const thetas = [45, 90, 135, 180, 225, 270, 315, 360], phis = [0.27, 0.06, 0.43]
    const run = async (pg, view, zooms) => {
      const poses = []
      for (const zoom of zooms) {
        await pg.evaluate(() => __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6))
        await goto(pg, 26.05, -1.2, 2600)
        const rows = await orbitPass(pg, view, zoom, thetas, phis)
        poses.push(...rows.map((r) => ({ view, zoom, ...r })))
      }
      return poses
    }
    const desk = await run(page, 'desk', [0.6, 1, 0])
    fs.writeFileSync(file('orbit-desk.json'), JSON.stringify(desk, null, 1))
    const readings = desk.filter((r) => !r.pose), poses = desk.filter((r) => r.pose)
    const badFace = readings.filter((r) => r.facing < 0.995 || r.right < 0.98 || r.up < 0.9)
    const outside = readings.filter((r) => !r.box || r.box.x0 < -0.5 || r.box.y0 < -0.5 || r.box.x1 > r.box.cssWidth + 0.5 || r.box.y1 > r.box.cssHeight + 0.5)
    const lapped = poses.filter((p) => p.overlaps > 0)
    note(`desktop: ${poses.length} poses, ${readings.length} plaque readings, ${badFace.length} not facing the camera, ${outside.length} outside the viewport, ${lapped.length} poses with plaques over each other, ${poses.filter((p) => p.hudHits).length} poses with a plaque under a HUD control, car covered over 12% in ${poses.filter((p) => p.carShare > 0.12).length}`)
    const defaults = poses.filter((p) => p.zoom === 0.6 && p.phi === 0.27 && p.theta === 45)
    assert(poses.filter((p) => p.hudHits).length === 0, `on the desktop no plaque is under a HUD control at any orbit pose (${poses.filter((p) => p.hudHits).length} of ${poses.length})`, results)
    assert(poses.filter((p) => p.carShare > 0.12).length <= Math.ceil(poses.length * 0.05), `on the desktop the plaques are over the car (over 12% of it) in no more than 5% of the orbit poses (${poses.filter((p) => p.carShare > 0.12).length} of ${poses.length})`, results)
    assert(poses.every((p) => p.carSeen <= 0.02), `on the desktop the car is visible at every orbit pose, the shader's hole counted (worst ${(Math.max(...poses.map((p) => p.carSeen)) * 100).toFixed(1)}% covered)`, results)
    assert(poses.every((p) => p.shown === 3), `three plaques speak at every pose (${[...new Set(poses.map((p) => p.shown))].join(',')})`, results)
    assert(badFace.length === 0, `every plaque faces the camera at every yaw, elevation and zoom (${readings.length} readings; worst ${Math.min(...readings.map((r) => r.facing)).toFixed(5)} / ${Math.min(...readings.map((r) => r.right)).toFixed(5)} / ${Math.min(...readings.map((r) => r.up)).toFixed(5)})`, results)
    assert(outside.length === 0, `every plaque lies wholly inside the viewport (${outside.length} cut by an edge${outside[0] ? `, first at theta ${outside[0].theta} phi ${outside[0].phi} zoom ${outside[0].zoom}` : ''})`, results)
    assert(defaults.every((p) => p.overlaps === 0), 'at the default camera no two plaques overlap', results)
    note(`overlap at other poses: ${lapped.length}/${poses.length}${lapped.length ? ` (e.g. ${lapped.slice(0, 4).map((p) => `yaw ${p.theta} phi ${p.phi} zoom ${p.zoom}`).join('; ')})` : ''}`)
    assert(lapped.length === 0, 'no two plaques overlap at any pose', results)
    if (!args.includes('--no-phone')) {
      const { ctx, pg, errs } = await openFresh({ viewport: { width: 390, height: 844 }, extra: { deviceScaleFactor: 2, hasTouch: true, isMobile: true } })
      const phone = await run(pg, 'phone', [0.6, 0])
      fs.writeFileSync(file('orbit-phone.json'), JSON.stringify(phone, null, 1))
      const r2 = phone.filter((r) => !r.pose), p2 = phone.filter((r) => r.pose)
      const bad2 = r2.filter((r) => r.facing < 0.995 || r.right < 0.98 || r.up < 0.9)
      const out2 = r2.filter((r) => !r.box || r.box.x0 < -0.5 || r.box.y0 < -0.5 || r.box.x1 > r.box.cssWidth + 0.5 || r.box.y1 > r.box.cssHeight + 0.5)
      const lap2 = p2.filter((p) => p.overlaps > 0)
      note(`phone: ${p2.length} poses, ${r2.length} readings, ${bad2.length} not facing, ${out2.length} outside the viewport, ${lap2.length} poses with plaques over each other, ${p2.filter((p) => p.hudHits).length} poses with a plaque under a HUD control, car covered over 12% in ${p2.filter((p) => p.carShare > 0.12).length}`)
      // a dragged camera brings the lanes level on the screen and puts the road under the buttons: the layout may fail here only rarely
      assert(p2.filter((p) => p.hudHits).length <= Math.ceil(p2.length * 0.05), `on a 390x844 phone a plaque is under a HUD control in no more than 5% of the orbit poses (${p2.filter((p) => p.hudHits).length} of ${p2.length})`, results)
      assert(p2.filter((p) => p.carShare > 0.12).length <= Math.ceil(p2.length * 0.05), `on a 390x844 phone the plaques are over the car (over 12% of it) in no more than 5% of the orbit poses (${p2.filter((p) => p.carShare > 0.12).length} of ${p2.length})`, results)
      assert(p2.every((p) => p.carSeen <= 0.02), `on a 390x844 phone the car is visible at every orbit pose, the shader's hole counted (worst ${(Math.max(...p2.map((p) => p.carSeen)) * 100).toFixed(1)}% covered)`, results)
      assert(bad2.length === 0, `on a 390x844 phone every plaque faces the camera (${r2.length} readings)`, results)
      assert(out2.length === 0, `on a 390x844 phone every plaque lies wholly inside the viewport (${out2.length} cut${out2[0] ? `, first at theta ${out2[0].theta} phi ${out2[0].phi} zoom ${out2[0].zoom}` : ''})`, results)
      assert(p2.filter((p) => p.zoom === 0.6 && p.phi === 0.27 && p.theta === 45).every((p) => p.overlaps === 0), 'on the phone at the default camera no two plaques overlap', results)
      // legibility: the smallest line of type, in CSS px, at the phone's default and fully zoomed-out cameras
      const type = await pg.evaluate(async () => {
        const { A, c } = __Q
        const out = []
        __Q.place(26.05, -1.2)
        for (const zoom of [0.6, 0]) {
          __Q.camera(Math.PI / 4, 0.27 * Math.PI, zoom)
          await new Promise((r) => setTimeout(r, 1500))
          const cv = A.renderer.domElement.getBoundingClientRect()
          for (const l of c.lines.filter((x) => x.label && x.pivot.visible && x.reveal > 0.9)) {
            const wp = l.pivot.getWorldPosition(new A.THREE.Vector3())
            const s = l.pivot.matrixWorld.getMaxScaleOnAxis()
            const pxPerMetre = cv.height / (2 * wp.distanceTo(A.camera.position) * Math.tan(A.camera.fov * Math.PI / 360))
            // the sizes the painter really set the two lines at (canvas px / 280 px per metre), on the screen, in CSS px
            out.push({ id: l.stop.id, zoom, radius: +A.driving.view.spherical.radius.current.toFixed(1), headPx: +((l.type.head / 280) * s * pxPerMetre).toFixed(1), subPx: +((l.type.sub / 280) * s * pxPerMetre).toFixed(1), scale: +s.toFixed(2) })
          }
        }
        return out
      })
      fs.writeFileSync(file('phone-type.json'), JSON.stringify(type, null, 1))
      for (const z of [0.6, 0]) {
        const rows = type.filter((t) => t.zoom === z)
        note(`phone zoom ${z}: camera ${rows[0]?.radius} m, scale ${rows[0]?.scale}, headline em ${Math.min(...rows.map((r) => r.headPx))} px, subtitle em ${Math.min(...rows.map((r) => r.subPx))} px (as painted)`)
      }
      assert(type.length > 0 && Math.min(...type.map((t) => t.headPx)) >= 20 && Math.min(...type.map((t) => t.subPx)) >= 11, 'phone type: every headline em >= 20 px and every subtitle em >= 11 px as painted, at the default and the fully zoomed-out camera', results)
      errors.push(...errs)
      await ctx.close()
    }
  }
}

/* =============================== drive (a fresh page) =============================== */
if (want('drive')) {
  if (BEFORE) skip('drive: judged on the plaques')
  else {
    const { ctx, pg, errs } = await openFresh()
    await pg.evaluate(() => {
      const { A, c } = __Q
      const first = c.lines.reduce((m, l) => Math.max(m, l.origin.z), -Infinity)
      __Q.place(27.06, first + 2)
      const t = (globalThis.__drive = { on: false, ticks: 0, rows: 0, worstFacing: 1, worstRight: 1, worstUp: 1, mirrored: 0, overshoot: 0, stubOvershoot: 0, shown: 0 })
      A.driving.ticker.events.on('tick', () => {
        if (!t.on) return
        t.ticks++
        let shown = 0
        for (const l of c.lines) {
          if (!l.label || !l.pivot.visible) continue
          shown++
          const f = __Q.facing(l)
          t.rows++
          t.worstFacing = Math.min(t.worstFacing, f.facing); t.worstRight = Math.min(t.worstRight, f.right); t.worstUp = Math.min(t.worstUp, f.up)
          if (f.right < 0) t.mirrored++
          const b = __Q.box(l)
          if (b) {
            const over = Math.max(-b.x0, -b.y0, b.x1 - b.cssWidth, b.y1 - b.cssHeight)
            // a plaque that is only wiping away stays where it stood, beside its stone, and goes off the picture with it
            if (l.reveal > 0.9) t.overshoot = Math.max(t.overshoot, over)
            else t.stubOvershoot = Math.max(t.stubOvershoot, over)
          }
        }
        t.shown = Math.max(t.shown, shown)
      }, 99)
    })
    await sleep(1500)
    await pg.evaluate(() => { globalThis.__drive.on = true })
    // hold W down the road while the camera sweeps a full turn, then back: a plaque that lags the camera by one frame fails
    await pg.keyboard.down('KeyW')
    await sleep(500)
    await pg.evaluate(() => { __Q.A.driving.view.spherical.targetTheta += Math.PI * 2 })
    await sleep(2500)
    await pg.keyboard.up('KeyW')
    await pg.evaluate(() => { __Q.A.driving.view.spherical.targetTheta -= Math.PI * 2 })
    await sleep(2500)
    const t = await pg.evaluate(() => { globalThis.__drive.on = false; return globalThis.__drive })
    note(`drive pass: ${t.ticks} ticks, ${t.rows} plaque readings, up to ${t.shown} plaques at once; worst facing ${t.worstFacing.toFixed(5)}, right ${t.worstRight.toFixed(5)}, up ${t.worstUp.toFixed(5)}; furthest a plaque that is showing went past the viewport edge ${t.overshoot.toFixed(1)} px (one that is wiping away: ${t.stubOvershoot.toFixed(1)} px)`)
    assert(t.ticks > 150 && t.rows > 200, `sampled ${t.ticks} ticks / ${t.rows} plaque readings while driving the road and orbiting`, results)
    assert(t.worstFacing >= 0.999 && t.worstUp >= 0.999, `no plaque was ever off the camera by a frame (worst facing ${t.worstFacing.toFixed(5)}, up ${t.worstUp.toFixed(5)})`, results)
    assert(t.mirrored === 0 && t.worstRight >= 0.999, 'no plaque was ever mirrored or turned while driving and orbiting', results)
    // the plaques slide to their places at 10 a second: even through a full turn of the camera in two seconds they never leave the picture by more than a word
    assert(t.overshoot < 60, `plaques stay within 60 px of the viewport through a full sweep (${t.overshoot.toFixed(1)} px)`, results)
    errors.push(...errs)
    await ctx.close()
  }
}

/* =============================== pass =============================== */
// What is left of the car's own vertices under a plaque, once the shader has cut its holes out (the shader's own test, feather included: see `Q.shaderCut`): the car's corners stand a hair outside
// the hole's rectangle, and a plaque that is wiping away where it stood (the layout does not move it) can be over one or two of them, 0.2 to 0.6% of the car's vertices on the desktop;
// a plaque on the car (the car is not seen) is 10% and more. (The measure used to cut a rectangle 3 px wider than the hole's, and not the feather the shader adds to it: 1.4 to 2.8%, by luck.)
const SEEN_MAX = 0.01
/** The screens the car is driven down the road on (`pass`, `steps`): a desktop, a tablet held upright, a phone, a narrow phone, a phone on its side. */
const DRIVE_DEVICES = [
  { name: 'desk', viewport: { width: 1440, height: 900 }, extra: { deviceScaleFactor: 1 } },
  { name: 'tablet', viewport: { width: 834, height: 1112 }, extra: { deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  { name: 'phone', viewport: { width: 390, height: 844 }, extra: { deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  { name: 'phone360', viewport: { width: 360, height: 640 }, extra: { deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  { name: 'phoneland', viewport: { width: 844, height: 390 }, extra: { deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
]
// How long, in ms of the whole drive, a plaque that speaks may have more than HOLE_SHARE of its area under the car's or the year plate's hole: the layout never slides a plaque over the car
// with its words under the hole (it wipes away and comes back on the other side), so this is the length of a hitch of the machine, a frame or two.
const HOLE_SHARE = 0.05
const HOLE_MS_MAX = 40
if (want('pass')) {
  if (BEFORE) skip('pass: judged on the plaques')
  else {
    const runs = []
    for (const device of DRIVE_DEVICES) {
      const { ctx, pg, errs } = await openFresh({ viewport: device.viewport, extra: device.extra })
      await pg.evaluate(() => __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6))
      for (const speed of [2, 5]) {
        const r = await pg.evaluate(async ({ speed, SEEN, HOLE }) => {
          const { A, c } = __Q
          const zs = c.lines.map((l) => l.origin.z)
          const start = Math.max(...zs) + 4, end = Math.min(...zs) - 4
          __Q.place(27.06, start)
          await new Promise((r) => setTimeout(r, 1800))
          const prev = new Map(), T = A.THREE
          const stats = { ticks: 0, rows: 0, jumps: 0, worstJump: 0, retractRows: 0, retractDrift: 0, retractMoved: 0, carMax: 0, cars: 0, carOver: 0, seenMax: 0, seenOver: 0, hudRows: 0, hudOver: 0, holeMax: 0, holeMs: 0 }
          let z = start, last = performance.now()
          const v = new T.Vector3()
          await new Promise((resolve) => {
            const handle = () => {
              try { tick() } catch (e) { stats.err = String(e.stack ?? e); A.driving.ticker.events.off('tick', handle); resolve() }
            }
            const tick = () => {
              const now = performance.now(), real = now - last, dt = Math.min(0.05, real / 1000); last = now
              z -= speed * dt
              if (z < end) { A.driving.ticker.events.off('tick', handle); resolve(); return }
              __Q.place(27.06, z)
              stats.ticks++
              const boxes = [], hud = __Q.hudRects()
              let holeWorst = 0
              for (const l of c.lines) {
                if (!l.label || !l.pivot.visible) { prev.delete(l.stop.id); continue }
                const b = __Q.box(l)
                if (!b) continue
                v.setFromMatrixPosition(l.pivot.matrixWorld).project(A.camera)
                const px = (v.x * 0.5 + 0.5) * b.cssWidth, py = (-v.y * 0.5 + 0.5) * b.cssHeight
                // where the plaque's left edge (the end that grows out of the stone) stands against its stone: the thing the layout moves
                const off = { x: b.x0 - px, y: (b.y0 + b.y1) / 2 - py }
                const before = prev.get(l.stop.id)
                const speaking = l.reveal > 0.9
                const retracting = !!before && l.reveal < before.reveal - 1e-6
                if (before) {
                  // a plaque slides at a speed, so a frame that took longer (a hitch of the machine) moves it further: judged per 20 ms of the clock, which is what a person sees
                  const jump = Math.hypot(off.x - before.x, off.y - before.y) * (20 / Math.max(20, real))
                  stats.rows++
                  if (speaking && before.speaking) { if (jump > 25) stats.jumps++; stats.worstJump = Math.max(stats.worstJump, jump) }
                  // a plaque that is wiping away stays where it stood against its stone: its own shift does not change
                  if (retracting) {
                    stats.retractRows++
                    stats.retractDrift = Math.max(stats.retractDrift, jump)
                    if (Math.abs(l.shiftX - before.shiftX) > 1e-6 || Math.abs(l.shiftY - before.shiftY) > 1e-6) stats.retractMoved++
                  }
                }
                prev.set(l.stop.id, { x: off.x, y: off.y, speaking, reveal: l.reveal, shiftX: l.shiftX, shiftY: l.shiftY })
                // the share of a plaque that speaks that the shader's holes (the car's, the year plate's) take out of it: a plaque dragged across the car has its words cut
                if (speaking) {
                  for (const r of [c.carRect.value, c.plateRect.value]) {
                    if (!(r.x < r.z)) continue
                    const hx0 = (r.x * 0.5 + 0.5) * b.cssWidth, hx1 = (r.z * 0.5 + 0.5) * b.cssWidth, hy0 = (-r.w * 0.5 + 0.5) * b.cssHeight, hy1 = (-r.y * 0.5 + 0.5) * b.cssHeight
                    const ox = Math.max(0, Math.min(b.x1, hx1) - Math.max(b.x0, hx0)), oy = Math.max(0, Math.min(b.y1, hy1) - Math.max(b.y0, hy0))
                    holeWorst = Math.max(holeWorst, (ox * oy) / Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0)))
                  }
                }
                // what a person sees of it: the part the wipe has reached (it grows from the stone, the left end)
                const seen = { x0: b.x0, x1: b.x0 + (b.x1 - b.x0) * l.reveal, y0: b.y0, y1: b.y1 }
                if (l.reveal > 0.15) {
                  boxes.push(seen)
                  stats.hudRows++
                  if (hud.some((h) => Math.min(seen.x1, h.x1) - Math.max(seen.x0, h.x0) > 2 && Math.min(seen.y1, h.y1) - Math.max(seen.y0, h.y0) > 2)) stats.hudOver++
                }
              }
              stats.holeMax = Math.max(stats.holeMax, holeWorst)
              if (holeWorst > HOLE) stats.holeMs += Math.min(100, real) /* (HOLE_SHARE: this runs in the page) */
              if (stats.ticks % 6 === 0 && boxes.length) {
                const share = __Q.carShare(boxes), seen = __Q.carShare(boxes, true)
                stats.cars++; stats.carMax = Math.max(stats.carMax, share); if (share > 0.12) stats.carOver++
                stats.seenMax = Math.max(stats.seenMax, seen); if (seen > SEEN) stats.seenOver++ /* (SEEN_MAX: this runs in the page) */
              }
            }
            A.driving.ticker.events.on('tick', handle, 99)
          })
          return stats
        }, { speed, SEEN: SEEN_MAX, HOLE: HOLE_SHARE })
        runs.push({ device: device.name, speed, ...r })
        note(`${device.name.padEnd(9)} ${speed} m/s: ${r.ticks} ticks, ${r.rows} plaque readings | moves over 25 px in 20 ms ${r.jumps} (worst ${r.worstJump.toFixed(1)} px) | wiping away ${r.retractRows} frames: drift against the stone up to ${r.retractDrift.toFixed(1)} px, shift changed in ${r.retractMoved} | plaque boxes over the car up to ${(r.carMax * 100).toFixed(1)}% (${r.carOver}/${r.cars} samples over 12%), car pixels still covered up to ${(r.seenMax * 100).toFixed(2)}% | a speaking plaque under the car's or the plate's hole: up to ${(r.holeMax * 100).toFixed(0)}% of its area, ${Math.round(r.holeMs)} ms over ${HOLE_SHARE * 100}% | under a HUD control in ${r.hudOver}/${r.hudRows} readings`)
      }
      errors.push(...errs)
      await ctx.close()
    }
    fs.writeFileSync(file('pass.json'), JSON.stringify(runs, null, 1))
    for (const r of runs) {
      assert(!r.err, `${r.device} ${r.speed} m/s: the drive ran (${r.err ?? 'no error'})`, results)
      assert(r.ticks > 100, `${r.device} ${r.speed} m/s: sampled ${r.ticks} ticks`, results)
      assert(r.jumps === 0, `${r.device} ${r.speed} m/s: a speaking plaque never moves more than 25 px against its stone in 20 ms (${r.jumps} times, worst ${r.worstJump.toFixed(1)} px)`, results)
      assert(r.retractDrift < 6 && r.retractMoved === 0, `${r.device} ${r.speed} m/s: a plaque that is wiping away is not laid out again and stays beside its stone (drift up to ${r.retractDrift.toFixed(1)} px, shift changed in ${r.retractMoved} of ${r.retractRows} frames)`, results)
      assert(r.carOver <= Math.ceil(r.cars * 0.2), `${r.device} ${r.speed} m/s: the plaques' boxes are off the car almost all the way (${r.carOver} of ${r.cars} samples over 12%: a plaque that is wiping away stays where it stood), worst ${(r.carMax * 100).toFixed(1)}%`, results)
      assert(r.seenOver === 0, `${r.device} ${r.speed} m/s: the car is visible all the way along the road, the shader's hole counted (${r.seenOver} of ${r.cars} samples over ${SEEN_MAX * 100}%, worst ${(r.seenMax * 100).toFixed(2)}%)`, results)
      assert(r.holeMs <= HOLE_MS_MAX, `${r.device} ${r.speed} m/s: a plaque that speaks is not slid over the car or the year plate with its words under the hole (${Math.round(r.holeMs)} ms with more than ${HOLE_SHARE * 100}% of one under it, at most ${HOLE_MS_MAX}; worst ${(r.holeMax * 100).toFixed(0)}%)`, results)
      assert(r.hudOver <= Math.ceil(r.hudRows * 0.01), `${r.device} ${r.speed} m/s: what is shown of the plaques is clear of the HUD controls along the road (${r.hudOver} of ${r.hudRows} readings)`, results)
    }
  }
}

/* =============================== steps =============================== */
// The `pass` drive, stepped by hand at a fixed dt: the page's render loop is stopped and the game is ticked 1/60 s at a time, so a run is the same on any machine, every time (some
// runs jitter dt by a seeded random number, as a busy machine does). `pass` measures in real time and can only bound what it sees with a margin; this is the bound that holds exactly:
// no speaking plaque moves 25 px against its stone in 20 ms, and none is slid over the car or the year plate (not 5% of one under the hole for a single tick), both ways down the road,
// at 2 and 5 m/s, on every screen. (A lane that changes its stop, a stone that rises and a car that crosses the lanes tip the layout from one arrangement to another for a few ticks.)
if (want('steps')) {
  if (BEFORE) skip('steps: judged on the plaques')
  else {
    const specs = []
    for (const speed of [2, 5]) for (const dirn of ['down', 'up']) for (const [jitter, seed] of [[0, 1], [0.4, 2]]) specs.push({ speed, dirn, jitter, seed })
    const runs = []
    for (const device of DRIVE_DEVICES) {
      const { ctx, pg, errs } = await openFresh({ viewport: device.viewport, extra: device.extra })
      await pg.evaluate(() => __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6))
      await sleep(1500)
      const results1 = await pg.evaluate(async ({ specs, HOLE }) => {
        const { A, c, T } = __Q
        const zs = c.lines.map((l) => l.origin.z)
        const hi = Math.max(...zs) + 4, lo = Math.min(...zs) - 4
        const cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect(), W = cv.width, H = cv.height, v = new T.Vector3()
        // from here on the game is ticked by hand
        globalThis.requestAnimationFrame = () => 0
        await new Promise((r) => setTimeout(r, 150))
        const tick = (dt) => { A.driving.render(dt, 0); cam.updateMatrixWorld(true) }
        const box = (l) => {
          const xs = [], ys = [], corner = new T.Vector3()
          l.pivot.traverse((m) => {
            if (!m.isMesh || m.geometry.getAttribute('position').count < 4) return
            for (let a = m; a; a = a.parent) if (!a.visible) return
            m.updateWorldMatrix(true, false); if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox
            for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { corner.set(x, y, z).applyMatrix4(m.matrixWorld).project(cam); xs.push((corner.x * 0.5 + 0.5) * W); ys.push((-corner.y * 0.5 + 0.5) * H) }
          })
          return xs.length ? { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) } : null
        }
        const out = []
        for (const { speed, dirn, jitter, seed } of specs) {
          const start = dirn === 'down' ? hi : lo, end = dirn === 'down' ? lo : hi, sgn = dirn === 'down' ? -1 : 1
          __Q.place(27.06, start)
          for (let i = 0; i < 150; i++) tick(1 / 60)
          let rng = seed >>> 0
          const rand = () => { rng = (rng + 0x6d2b79f5) >>> 0; let t = rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
          const prev = new Map(), r = { speed, dirn, jitter, ticks: 0, jumps: 0, worst: 0, holeTicks: 0, holeMax: 0, wanted: 0, spoke: 0 }
          let z = start
          for (;;) {
            const dt = (1 / 60) * (1 + jitter * (rand() * 2 - 1))
            z += sgn * speed * dt
            if ((sgn < 0 && z < end) || (sgn > 0 && z > end)) break
            __Q.place(27.06, z)
            tick(dt)
            r.ticks++
            let holeWorst = 0
            for (const l of c.lines) {
              if (l.wants) { r.wanted++; if (l.reveal > 0.9) r.spoke++ }
              if (!l.label || !l.pivot.visible) { prev.delete(l.stop.id); continue }
              const b = box(l)
              if (!b) { prev.delete(l.stop.id); continue }
              v.setFromMatrixPosition(l.pivot.matrixWorld).project(cam)
              const off = { x: b.x0 - (v.x * 0.5 + 0.5) * W, y: (b.y0 + b.y1) / 2 - (-v.y * 0.5 + 0.5) * H }
              const before = prev.get(l.stop.id), speaking = l.reveal > 0.9
              if (before && speaking && before.speaking) {
                const jump = Math.hypot(off.x - before.x, off.y - before.y) * (0.02 / Math.max(0.02, dt))
                r.worst = Math.max(r.worst, jump)
                if (jump > 25) r.jumps++
              }
              prev.set(l.stop.id, { x: off.x, y: off.y, speaking })
              if (speaking) {
                for (const k of [c.carRect.value, c.plateRect.value]) {
                  if (!(k.x < k.z)) continue
                  const hx0 = (k.x * 0.5 + 0.5) * W, hx1 = (k.z * 0.5 + 0.5) * W, hy0 = (-k.w * 0.5 + 0.5) * H, hy1 = (-k.y * 0.5 + 0.5) * H
                  const ox = Math.max(0, Math.min(b.x1, hx1) - Math.max(b.x0, hx0)), oy = Math.max(0, Math.min(b.y1, hy1) - Math.max(b.y0, hy0))
                  holeWorst = Math.max(holeWorst, (ox * oy) / Math.max(1, (b.x1 - b.x0) * (b.y1 - b.y0)))
                }
              }
            }
            r.holeMax = Math.max(r.holeMax, holeWorst)
            if (holeWorst > HOLE) r.holeTicks++
          }
          out.push(r)
        }
        return out
      }, { specs, HOLE: HOLE_SHARE })
      for (const r of results1) runs.push({ device: device.name, ...r })
      errors.push(...errs)
      await ctx.close()
    }
    fs.writeFileSync(file('steps.json'), JSON.stringify(runs, null, 1))
    for (const device of DRIVE_DEVICES) {
      const mine = runs.filter((r) => r.device === device.name)
      const jumps = mine.reduce((n, r) => n + r.jumps, 0), holes = mine.reduce((n, r) => n + r.holeTicks, 0)
      const worst = Math.max(...mine.map((r) => r.worst)), holeMax = Math.max(...mine.map((r) => r.holeMax))
      const spoke = mine.reduce((n, r) => n + r.spoke, 0), wanted = mine.reduce((n, r) => n + r.wanted, 0)
      note(`${device.name.padEnd(9)} ${mine.length} drives (2 and 5 m/s, down and up, steady and jittered): ${mine.reduce((n, r) => n + r.ticks, 0)} ticks | moves over 25 px in 20 ms: ${jumps} (worst ${worst.toFixed(1)} px) | ticks with more than ${HOLE_SHARE * 100}% of a speaking plaque under the car's or the plate's hole: ${holes} (worst ${(holeMax * 100).toFixed(0)}%) | speaking ${(100 * spoke / Math.max(1, wanted)).toFixed(1)}% of the ticks a plaque was wanted`)
      assert(mine.length === 8 && mine.every((r) => r.ticks > 100), `${device.name}: eight stepped drives`, results)
      assert(jumps === 0, `${device.name}: stepped by hand, no speaking plaque moves more than 25 px against its stone in 20 ms, in any of the eight drives (${jumps} times, worst ${worst.toFixed(1)} px)`, results)
      assert(holes === 0, `${device.name}: stepped by hand, no speaking plaque is slid over the car or the year plate (${holes} ticks with more than ${HOLE_SHARE * 100}% of one under the hole, worst ${(holeMax * 100).toFixed(0)}%)`, results)
    }
  }
}

/* =============================== relocate =============================== */
// A plaque the layout sends across the car is wiped away where it stands and wiped in on the other side. When the layout changes its mind for a few frames (a lane's stop that
// changes, a stone that rises, a car that crosses the lanes) and comes back, that was a plaque that blinked in place. Every wipe away to be put elsewhere is judged here, in the
// stepped (repeatable) drives: how far the plaque stands from where it stood when it wiped away, after it has wiped in, in clip units of the canvas's height (the layout's own
// measure, as its SETTLE_FAR): one that is still the stop's plaque and has moved less than BLINK_NET stood still and blinked (if it dipped below BLINK_DIP of its reveal: a wipe the layout takes back in its first frames is a hair of one). (A plaque that stops speaking in the middle of it
// is leaving anyway, and its wipe is only faster.) No plaque blinks, on any screen, at three lanes, at 2 and 6 m/s, down the road and up it, at the default camera and at zoom 1.
// --against= the revision before the plaques were made to keep their places FAILS it on the tablet and the phone on its side.
const BLINK_NET = 0.08
const BLINK_DIP = 0.7
if (want('relocate')) {
  if (BEFORE) skip('relocate: judged on the plaques')
  else {
    const specs = []
    for (const lane of [25.05, 27.06, 29.05]) for (const speed of [2, 6]) for (const dirn of ['down', 'up']) for (const cam of ['def', 'z1']) specs.push({ lane, speed, dirn, cam })
    const runs = []
    for (const device of DRIVE_DEVICES) {
      const { ctx, pg, errs } = await openFresh({ viewport: device.viewport, extra: device.extra })
      await sleep(1500)
      const out = await pg.evaluate(async ({ specs }) => {
        const { A, c } = __Q
        const zs = c.lines.map((l) => l.origin.z)
        const hi = Math.max(...zs) + 4, lo = Math.min(...zs) - 4
        const cam = A.camera, view = A.driving.view, sph = view.spherical
        const cv = A.renderer.domElement.getBoundingClientRect()
        const aspect = cv.width / cv.height
        // from here on the game is ticked by hand
        globalThis.requestAnimationFrame = () => 0
        await new Promise((r) => setTimeout(r, 150))
        const tick = (dt) => { A.driving.render(dt, 0); A.scene.updateMatrixWorld(true); cam.updateMatrixWorld(true) }
        const CAMS = { def: [Math.PI / 4, 0.27 * Math.PI, 0.6], z1: [Math.PI / 4, 0.27 * Math.PI, 1] }
        const rows = []
        for (const { lane, speed, dirn, cam: camName } of specs) {
          const [th, ph, zm] = CAMS[camName]
          sph.targetTheta = sph.theta = th; sph.targetPhi = sph.phi = ph; view.zoom.baseRatio = view.zoom.smoothedRatio = view.zoom.ratio = zm; view.snapToTarget(); view.smoothedObstruction = Infinity; view.update()
          const start = dirn === 'down' ? hi : lo, end = dirn === 'down' ? lo : hi, sgn = dirn === 'down' ? -1 : 1
          __Q.place(lane, start)
          for (let i = 0; i < 150; i++) tick(1 / 60)
          const st = {}
          let z = start, n = 0
          for (;;) {
            z += sgn * speed / 60
            if ((sgn < 0 && z < end) || (sgn > 0 && z > end)) break
            __Q.place(lane, z)
            tick(1 / 60)
            n++
            for (let i = 0; i < c.lines.length; i++) {
              const l = c.lines[i], slot = c.slots[i]
              const s = (st[l.stop.id] ??= { rel: false, check: 0 })
              if (l.relocating && !s.rel) { s.rel = true; s.from = [l.shiftX * slot.kx * aspect, l.shiftY * slot.ky]; s.n0 = n; s.rv0 = l.reveal; s.z0 = z; s.min = l.reveal }
              else if (s.rel && !l.relocating) { s.rel = false; s.check = n + 2; s.end = n }
              if (s.rel) s.min = Math.min(s.min, l.reveal)
              if (s.check === n) {
                s.check = 0
                const net = Math.hypot(l.shiftX * slot.kx * aspect - s.from[0], l.shiftY * slot.ky - s.from[1])
                rows.push({ lane, speed, dirn, cam: camName, id: l.stop.id, tick: s.n0, z: +s.z0.toFixed(2), rv0: +s.rv0.toFixed(2), min: +s.min.toFixed(2), net: +net.toFixed(3), ticks: s.end - s.n0, wants: l.wants })
              }
            }
          }
        }
        return rows
      }, { specs })
      runs.push({ device: device.name, drives: specs.length, rows: out })
      errors.push(...errs)
      await ctx.close()
    }
    fs.writeFileSync(file('relocate.json'), JSON.stringify(runs, null, 1))
    for (const run of runs) {
      // (a wipe the layout took back before the plaque had dipped to BLINK_DIP of its reveal was a hair of one, not a blink)
      const blinks = run.rows.filter((r) => r.wants && r.net < BLINK_NET && r.min < BLINK_DIP)
      const still = run.rows.filter((r) => r.net < BLINK_NET)
      const speaking = run.rows.filter((r) => r.rv0 >= 0.9)
      note(`${run.device.padEnd(9)} ${run.drives} drives: ${run.rows.length} plaques wiped away to be put elsewhere (${speaking.length} of them speaking whole), ${still.length} put back where they stood (${still.length - blinks.length} of them leaving), blinks in place: ${blinks.length}${blinks[0] ? ` (${blinks.slice(0, 3).map((r) => `${r.id} lane ${r.lane} ${r.speed} m/s ${r.dirn} ${r.cam} z ${r.z}`).join('; ')})` : ''}`)
      assert(run.drives === 24, `${run.device}: twenty-four stepped drives`, results)
      assert(blinks.length === 0, `${run.device}: no plaque that goes on speaking is wiped away and in again where it stood (moved less than ${BLINK_NET} of the canvas's height): ${blinks.length}`, results)
    }
  }
}

/* =============================== devices =============================== */
const DEVICES = [
  { name: 'desk1440x900', width: 1440, height: 900, touch: false, dpr: 1 },
  { name: 'laptop1280x720', width: 1280, height: 720, touch: false, dpr: 1 },
  { name: 'fhd1920x1080', width: 1920, height: 1080, touch: false, dpr: 1 },
  { name: 'tablet768x1024', width: 768, height: 1024, touch: true, dpr: 2 },
  { name: 'tabletland1024x768', width: 1024, height: 768, touch: true, dpr: 2 },
  { name: 'phone390x844', width: 390, height: 844, touch: true, dpr: 2 },
  { name: 'phone360x740', width: 360, height: 740, touch: true, dpr: 2 },
  { name: 'phone360x640', width: 360, height: 640, touch: true, dpr: 2 },
  { name: 'phone320x568', width: 320, height: 568, touch: true, dpr: 2 },
  { name: 'phoneland844x390', width: 844, height: 390, touch: true, dpr: 2 },
  { name: 'phoneland932x430', width: 932, height: 430, touch: true, dpr: 2 },
  { name: 'phoneland667x375', width: 667, height: 375, touch: true, dpr: 2 },
]
if (want('devices')) {
  if (BEFORE) skip('devices: judged on the plaques')
  else {
    const picked = opt('devices', '') ? opt('devices', '').split(',') : null
    const SPOTS = [
      ['work-overlap', 26.05, -1.2],
      ['projects-overlap', 28.05, -1.4],
      ['all-lanes', 27.06, -3.9],
    ]
    const table = []
    for (const device of DEVICES.filter((d) => !picked || picked.includes(d.name))) {
      const { ctx, pg, errs } = await openFresh({ viewport: { width: device.width, height: device.height }, extra: { deviceScaleFactor: device.dpr, hasTouch: device.touch, isMobile: device.touch } })
      const heads = await pg.evaluate(() => __Q.c.lines.filter((l) => l.track.id === 'education').slice(0, 1).map((l) => ({ x: l.stoneHome.x, head: l.stoneHome.z })))
      await pg.evaluate(() => { __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6) })
      for (const [zoomName, zoom] of [['default', 0.6], ['far', 0]]) {
        await pg.evaluate((z) => __Q.camera(undefined, undefined, z), zoom)
        const spots = [...SPOTS, ['education-head', heads[0].x + 1, heads[0].head - 0.4]]
        for (const [spot, x, z] of spots) {
          await goto(pg, x, z, 2800)
          const a = await pg.evaluate(() => ({ ...__Q.audit(), radius: +__Q.A.driving.view.spherical.radius.current.toFixed(1), input: document.body.dataset.input }))
          table.push({ device: device.name, zoom: zoomName, spot, ...a })
          if (spot === 'work-overlap' || spot === 'all-lanes') await pg.screenshot({ path: file(`dev-${device.name}-${zoomName}-${spot}.png`) })
        }
      }
      const mine = table.filter((r) => r.device === device.name)
      const subs = mine.flatMap((r) => r.plaques.map((p) => p.type?.sub ?? 99))
      const worstSub = Math.min(...subs), worstHead = Math.min(...mine.flatMap((r) => r.plaques.map((p) => p.type?.head ?? 99)))
      const hits = mine.flatMap((r) => r.plaques.filter((p) => p.hud.length).map((p) => `${r.zoom}/${r.spot}:${p.id}>${p.hud.join('+')}`))
      const cars = mine.map((r) => r.carShare), worstCar = Math.max(...cars)
      note(`${device.name.padEnd(20)} input ${mine[0]?.input} camera ${[...new Set(mine.map((r) => r.radius))].join('/')} m | subtitle em >= ${worstSub.toFixed(1)} px, headline >= ${worstHead.toFixed(1)} px | cut ${mine.reduce((n, r) => n + r.plaques.filter((p) => p.cut).length, 0)} | HUD hits ${hits.length}${hits.length ? ` (${hits.slice(0, 4).join(', ')})` : ''} | car covered up to ${(worstCar * 100).toFixed(1)}% | plaques over each other ${mine.reduce((n, r) => n + r.lapped, 0)}`)
      errors.push(...errs)
      await ctx.close()
    }
    fs.writeFileSync(file('devices.json'), JSON.stringify(table, null, 1))
    const byDevice = (d) => table.filter((r) => r.device === d.name)
    const here = DEVICES.filter((d) => table.some((r) => r.device === d.name))
    // A plaque stands no further from its stone than a quarter of the screen's shorter side (GAP_SHARE), and where the car, the year plate and the page's buttons leave it no place that near it does not speak. A screen with room shows all three at every spot; a phone held upright (the car is half its width) or on its side (the top bar, the plate and the car fill its height) shows at least two (one on a 320 px phone), and at least 60% of all of them.
    const dev = (r) => DEVICES.find((d) => d.name === r.device)
    const cramped = (d) => d.width < 768 || d.height < 500
    const least = (r) => (r.spot === 'education-head' ? 1 : !cramped(dev(r)) ? 3 : dev(r).width < 340 ? 1 : 2)
    assert(table.every((r) => r.plaques.length >= least(r)), `the plaques that should speak are showing at every spot of every viewport: all three on a screen with room, two on a phone (${table.filter((r) => r.plaques.length < least(r)).map((r) => `${r.device}/${r.zoom}/${r.spot}:${r.plaques.length}`).slice(0, 4).join(', ') || 'all'})`, results)
    for (const d of DEVICES.filter((x) => table.some((r) => r.device === x.name) && cramped(x))) {
      const rows = table.filter((r) => r.device === d.name && r.spot !== 'education-head')
      const share = rows.reduce((n, r) => n + r.plaques.length, 0) / Math.max(1, 3 * rows.length)
      note(`${d.name}: ${(100 * share).toFixed(0)}% of the plaques that should speak at the work, projects and all-lanes spots do`)
      assert(share >= 0.6, `${d.name}: at least 60% of the plaques that should speak are showing (${(100 * share).toFixed(0)}%)`, results)
    }
    assert(table.every((r) => r.plaques.every((p) => p.facing >= 0.995 && p.right >= 0.98 && p.up >= 0.9)), 'every plaque faces the camera at every viewport', results)
    assert(table.every((r) => r.plaques.every((p) => !p.cut)), `no plaque is cut by the edge of any viewport (${table.flatMap((r) => r.plaques.filter((p) => p.cut).map((p) => `${r.device}/${r.zoom}/${r.spot}:${p.id}`)).slice(0, 4).join(', ') || 'none'})`, results)
    assert(table.every((r) => r.lapped === 0), `no two plaques overlap at any viewport (${table.filter((r) => r.lapped).map((r) => `${r.device}/${r.zoom}/${r.spot}`).slice(0, 4).join(', ') || 'none'})`, results)
    for (const d of here) {
      const rows = byDevice(d)
      const hits = rows.flatMap((r) => r.plaques.filter((p) => p.hud.length).map((p) => `${r.zoom}/${r.spot}:${p.id}>${p.hud.join('+')}`))
      assert(hits.length === 0, `${d.name}: no plaque stands under a HUD control (${hits.slice(0, 3).join(', ') || 'none'})`, results)
      const worstSub = Math.min(...rows.flatMap((r) => r.plaques.map((p) => p.type?.sub ?? 99)))
      assert(worstSub >= 11.5, `${d.name}: every subtitle is at least 12 CSS px (smallest ${worstSub.toFixed(1)} px)`, results)
      const car = Math.max(...rows.map((r) => r.carShare))
      assert(car <= 0.12, `${d.name}: no more than 12% of the car is under a plaque (worst ${(car * 100).toFixed(1)}%)`, results)
      const seen = Math.max(...rows.map((r) => r.carSeen))
      assert(seen <= 0.02, `${d.name}: the car is fully visible, the shader's hole counted (worst ${(seen * 100).toFixed(1)}% covered)`, results)
    }
  }
}

/* =============================== shots =============================== */
async function shots(pg, tag, viewportLabel, zooms) {
  for (const zoom of zooms) {
    await pg.evaluate(() => __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6))
    if (zoom === 'close') await pg.evaluate(() => __Q.camera(undefined, undefined, 1))
    if (zoom === 'far') await pg.evaluate(() => __Q.camera(undefined, undefined, 0))
    await sleep(1200)
    const t = `${tag}-${zoom}`
    for (const track of ['education', 'work', 'projects']) {
      const first = byTrack[track][0]
      await goto(pg, first.x + side(track), first.head + 2.6, 1500)
      await pg.screenshot({ path: file(`${t}-head-${track}-rest.png`) })
      await goto(pg, first.x + side(track), first.head - 0.4, 2600)
      await pg.screenshot({ path: file(`${t}-head-${track}-up.png`) })
    }
    // the overlap on the work lane (Focus, Pansofia and KCL-GTA stand there) and on the projects lane
    await goto(pg, 26.05, -1.2, 2800)
    await pg.screenshot({ path: file(`${t}-overlap-work.png`) })
    await goto(pg, 28.05, -1.4, 2800)
    await pg.screenshot({ path: file(`${t}-overlap-projects.png`) })
    // every lane speaking at once: the car where all three have a stop under it
    await goto(pg, 27.06, -3.9, 2800)
    await pg.screenshot({ path: file(`${t}-all-lanes.png`) })
  }
  console.log(`shots: ${viewportLabel} done`)
}
if (want('shots') && sectionsOnMain) {
  if (VIEWS.includes('desk')) {
    await shots(page, 'desk', '1440x900', ['default', 'close', 'far'])
    // orbited cameras: a quarter turn each way, from behind, and from nearly overhead / low
    await goto(page, 26.05, -1.2, 600)
    for (const [name, theta, phi] of [['yaw-90', 45 + 90, 0.27], ['yaw-180', 45 + 180, 0.27], ['yaw-270', 45 + 270, 0.27], ['high', 45, 0.07], ['low', 45, 0.42], ['low-yaw-135', 135, 0.4]]) {
      await page.evaluate(([t, p]) => __Q.camera(t * Math.PI / 180, p * Math.PI, 0.6), [theta, phi])
      await sleep(1800)
      await page.screenshot({ path: file(`desk-orbit-${name}.png`) })
    }
    await page.evaluate(() => __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6))
  }
  if (VIEWS.includes('phone') && !args.includes('--no-phone')) {
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
    await route(phone)
    const mobile = await phone.newPage()
    const mobileErrors = watch(mobile, 'phone ')
    await openPlayer(mobile)
    await sleep(1500)
    await mobile.evaluate(install)
    await shots(mobile, 'phone', '390x844 touch', ['default', 'far'])
    await mobile.evaluate(() => __Q.camera(Math.PI / 4, 0.27 * Math.PI, 0.6))
    await goto(mobile, 26.05, -1.2, 1200)
    for (const [name, theta, phi] of [['yaw-90', 135, 0.27], ['yaw-180', 225, 0.27], ['high', 45, 0.07]]) {
      await mobile.evaluate(([t, p]) => __Q.camera(t * Math.PI / 180, p * Math.PI, 0.6), [theta, phi])
      await sleep(1800)
      await mobile.screenshot({ path: file(`phone-orbit-${name}.png`) })
    }
    errors.push(...mobileErrors)
    await phone.close()
  }
}

errors.push(...pageErrors)
assert(errors.length === 0, `no console errors or page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`, results)
await browser.close()
finish(results)
