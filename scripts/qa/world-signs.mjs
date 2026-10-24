/* "Island timber" signs: gameplay-camera screenshots, hue and glyph-size proof, canvas-upload counters, shader-program
   and draw-call deltas, the Portfolio achievement, and a gallery of the kit's variants.

   node scripts/qa/world-signs.mjs [--suite=shots,focus,perf,azimuth,achievement,gallery,firstsight,change,golden,studio] [--baseline] [--out=<dir>] [--quick]

   Every shot is taken from the player's CHASE camera (the one `window.__archipelago.camera` is), never an editor or a
   free camera. The camera sits on a fixed azimuth at 15-30 m from the car, so a distance D from the CAMERA to the
   board is reached by choosing where the car stops (default pose: ~22 m), by the player's own zoom (15 m radius: ~14 m)
   and by the player's own orbit (low elevation: ~8 m). The script reports the distance it actually measured.

   --baseline serves the pre-redesign Projects/screenMotion/boards modules from git HEAD (per page, nothing on disk
   changes) so the same measurements give the "before" column.

   --suite=golden paints every layer of the board for every shipped project, and for stress texts (a 120-character title, a 500-character
   description, an address that cannot wrap, CJK, emoji, no link, six technologies), in the live tree and in the snapshot named by
   --before=<dir>, and compares every canvas pixel for pixel: whatever was changed in how text is fitted must change nothing that is drawn.

   --suite=change times what a PROJECT CHANGE costs on the main thread (per-layer paint ms, measureText calls, the scheduler's
   tick, the worst frames) at 1x and with the CPU throttled 4x (a phone's proxy), for git HEAD, for a snapshot of the kit
   (--before=<dir>, files at their preview-relative paths) and for the live tree:
   --variants=head,before,after --rates=1,4 --runs=2 --changes=12

   --suite=studio opens the world studio (no admin session, nothing saved: the page is served from its template, as world-studio-drive.mjs does), enters
   3D EDIT and checks that the Projects board and the Lab show the timber design there: the signs are built, the face is a painted canvas, and its
   pixels are parchment, not the old black screen (both boards sit in the world document saved by value, so they kept the faces of the day they
   were saved until the studio rebuilt them from the library on load: editor.js, refreshDefinitionInstances).

   Other agents can import { openSigns, frameWorldPoint, shoot, hueReport, uploadsDuring } to screenshot THEIR signs from the
   gameplay camera: frameWorldPoint(page, {x,y,z}, distance) parks the car so the chase camera is `distance` from that point. */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import { BASE, launch, openPlayer, sleep, watch } from './lib.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PREVIEW = 'public/archipelago/preview'
// Places and Screen are here because the Lab imports names from the new screenMotion that HEAD's does not export.
const BASELINE_FILES = [
  'portfolio/world2/interactions/Projects.js', 'portfolio/world2/interactions/screenMotion.js',
  'portfolio/world2/content/boards.js', 'projects-preview.js',
  'portfolio/world2/interactions/Places.js', 'portfolio/world2/interactions/Screen.js',
]

/* ------------------------------------------------------------------ opening -- */

/**
 * A browser context with Geist wired up as the parent page would wire it (the standalone player has no parent, so
 * without this the faces fall back to a system sans), and counters on canvas-to-texture uploads.
 */
export async function openSigns(browser, { width = 1440, height = 900, baseline = false, serveFrom = null, mobile = false, fonts = true, seed = false, prepare } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })
  if (fonts) {
    const sans = path.join(ROOT, 'node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2')
    const mono = path.join(ROOT, 'node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2')
    if (fs.existsSync(sans) && fs.existsSync(mono)) {
      await context.route('**/__qa/geist-sans.woff2', route => route.fulfill({ path: sans, contentType: 'font/woff2' }))
      await context.route('**/__qa/geist-mono.woff2', route => route.fulfill({ path: mono, contentType: 'font/woff2' }))
      await context.addInitScript(() => {
        document.addEventListener('DOMContentLoaded', () => {
          const style = document.createElement('style')
          style.textContent = "@font-face{font-family:'Geist QA';src:url('/__qa/geist-sans.woff2') format('woff2');font-weight:100 900}@font-face{font-family:'Geist Mono QA';src:url('/__qa/geist-mono.woff2') format('woff2');font-weight:100 900}"
          document.head.append(style)
          document.body.style.setProperty('--font-geist-sans', "'Geist QA'")
          document.body.style.setProperty('--font-geist-mono', "'Geist Mono QA'")
        })
      })
    }
  }
  // The published world comes from the dev server's API. When that answers an error (other work in the tree can break the server's
  // build for a while), the player is given the seed world instead, the same one the shipped player falls back to.
  await context.route('**/api/world/release', async route => {
    // `seed`: the world the shipped player falls back to, whatever the server has published (production serves the DB's revision, a fresh deploy the seed).
    const response = seed ? null : await route.fetch().catch(() => null)
    if (response?.ok()) return route.fulfill({ response })
    const file = (name) => ({ url: `/archipelago/seed/${name}`, size: fs.statSync(path.join(ROOT, 'public/archipelago/seed', name)).size })
    return route.fulfill({ json: { revision: 'seed', world: file('editor-world.json.gz'), assets: file('asset-definitions.json') } })
  })
  await context.addInitScript(() => {
    window.__uploads = []
    window.__frame = 0
    const loop = () => { window.__frame++; requestAnimationFrame(loop) }
    requestAnimationFrame(loop)
    const wrap = (name) => {
      const original = WebGL2RenderingContext.prototype[name]
      WebGL2RenderingContext.prototype[name] = function (...args) {
        const source = args[args.length - 1]
        if (source instanceof HTMLCanvasElement) { window.__uploads.push({ t: performance.now(), frame: window.__frame, w: source.width, h: source.height, el: source }); if (window.__uploads.length > 4000) window.__uploads.splice(0, 2000) }
        return original.apply(this, args)
      }
    }
    wrap('texImage2D'); wrap('texSubImage2D')
  })
  if (baseline) {
    for (const file of BASELINE_FILES) {
      const body = execFileSync('git', ['show', `HEAD:${PREVIEW}/${file}`], { cwd: ROOT, maxBuffer: 1 << 26 })
      await context.route(`**/${file}`, route => route.fulfill({ body, contentType: 'text/javascript' }))
    }
  }
  if (serveFrom) {
    // A snapshot of the kit (the directory holds the files at their preview-relative paths): served over the live ones.
    const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])
    for (const file of walk(serveFrom).filter(f => f.endsWith('.js'))) {
      const rel = path.relative(serveFrom, file).split(path.sep).join('/')
      const body = fs.readFileSync(file)
      await context.route(`**/${rel}`, route => route.fulfill({ body, contentType: 'text/javascript' }))
    }
  }
  await prepare?.(context)
  const page = await context.newPage()
  const errors = watch(page)
  await openPlayer(page)
  await sleep(600)
  return { context, page, errors }
}

export const shoot = (page, file, clip) => page.screenshot({ path: file, ...(clip ? { clip } : {}) })

/* ------------------------------------------------------------------ framing -- */

/** Where the Projects face is, in the world and on the screen. Run in the page. */
const BOARD = `(() => {
  const a = window.__archipelago, T = a.THREE
  const inst = a.gameplay.instances.find(i => i.parts.projects)
  const face = inst.references.node('refImages')
  face.updateWorldMatrix(true, false)
  const centre = face.getWorldPosition(new T.Vector3())
  const reader = inst.physics.point(inst.references.position('refInteractivePoint'))
  return { a, T, inst, face, centre, reader, projects: inst.parts.projects }
})()`

/**
 * Parks the car so the player's chase camera ends up `distance` metres from `point` (world coordinates), then returns what
 * it measured. D >= 20 uses the default pose; below that the player's own zoom (15 m radius) and, below ~11 m, a low orbit
 * are used. The camera always looks at the car, so for a camera nearer than its own radius the car stands BEYOND the point,
 * a little to one side (`lateral`, a fraction of the distance) so it is not parked inside the thing being photographed;
 * both sides are tried and the one the car actually reached wins.
 */
export async function frameWorldPoint(page, point, distance, { ground, settle = 1100, lateral, hideCar = distance < 20 } = {}) {
  // A narrow (phone) frame sees little sideways: keep the car nearer the line to the point.
  const { width, height } = page.viewportSize()
  const narrow = width / height < 1
  lateral ??= narrow ? 0.05 : distance < 20 ? 0.18 : 0.12
  await page.evaluate(({ distance, hideCar }) => {
    const a = window.__archipelago, v = a.driving.view
    a.driving.visual.group.visible = !hideCar // a car parked behind the board for a close shot would only be in the way
    // The chase radius runs 15 m (zoomed in) to 30 m + 9 m per unit of narrowness (a phone portrait pulls it back to ~55 m).
    const rMin = v.spherical.radius.edges.min, rMax = v.spherical.radius.edges.max + v.ratioOverflow * v.spherical.radius.nonIdealRatioOffset
    const want = distance < 20 ? rMin : 21
    v.zoom.baseRatio = Math.max(0, Math.min(1, 1 - (want - rMin) / (rMax - rMin)))
    v.spherical.targetPhi = distance < 11 ? Math.PI * 0.42 : Math.PI * 0.27
    v.spherical.targetTheta = v.spherical.baseTheta ?? v.spherical.targetTheta
  }, { distance, hideCar })
  let best = null
  const candidates = [...new Set(narrow ? [lateral, -lateral, lateral * 2, -lateral * 2, 0] : [lateral, 0, -lateral])]
  for (const L of candidates) {
    let measured = null
    for (let step = 0; step < 3; step++) {
      measured = await page.evaluate(async ({ point, distance, ground, L }) => {
        const a = window.__archipelago, T = a.THREE
        const B = new T.Vector3(point.x, point.y, point.z)
        const car = a.driving.vehicle.position, cam = a.camera.position
        const off = cam.clone().sub(car), offH = Math.hypot(off.x, off.z), hx = off.x / offH, hz = off.z / offH
        const lat = L * distance
        const v = cam.y - B.y
        const need = Math.sqrt(Math.max(0, distance * distance - v * v - lat * lat))
        const x = B.x + (need - offH) * hx - lat * hz, z = B.z + (need - offH) * hz + lat * hx
        a.driving.place({ position: new T.Vector3(x, ground ?? B.y, z), rotation: Math.PI * 1.25 })
        await new Promise(r => setTimeout(r, 1000))
        const c2 = a.camera.position.clone()
        const ndc = B.clone().project(a.camera)
        const reached = Math.hypot(a.driving.vehicle.position.x - x, a.driving.vehicle.position.z - z)
        return { distance: c2.distanceTo(B), ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)], car: a.driving.vehicle.position.toArray().map(n => +n.toFixed(1)), reached: +reached.toFixed(2), lateral: L }
      }, { point, distance, ground, L })
    }
    measured.inFrame = Math.abs(measured.ndc[0]) < 0.85 && Math.abs(measured.ndc[1]) < 0.9
    const score = (measured.reached < 1.2 ? 0 : 10) + (measured.inFrame ? 0 : 5) + Math.hypot(...measured.ndc) * 0.01
    measured.score = score
    if (!best || score < best.score) best = measured
    if (score < 1) break
  }
  await sleep(settle)
  return best
}

/**
 * Same, for the Projects board. The camera looks at the car, which is on the ground, so a camera nearer than its radius sees
 * the board low in the frame; the point framed is therefore raised toward the title plate for close shots (`aimUp`, metres).
 * `faceDistance` is the camera's distance to the face's own centre.
 */
export async function frameBoard(page, distance, options = {}) {
  const board = await page.evaluate(`(({ centre, reader }) => ({ centre: centre.toArray(), reader: reader.toArray() }))(${BOARD})`)
  const aimUp = (options.aimUp ?? (distance <= 9 ? 1.5 : distance <= 15 ? 0.8 : 0.2)) + (options.aimShift ?? 0)
  const measured = await frameWorldPoint(page, { x: board.centre[0], y: board.centre[1] + aimUp, z: board.centre[2] }, distance, { ground: board.reader[1] + 0.5, ...options })
  // The aim point is raised for close shots, so it can be in frame while the board is not: judge by the FACE's own centre.
  const face = await page.evaluate(`(() => { const { a, T, centre } = ${BOARD}; const ndc = centre.clone().project(a.camera); return { distance: a.camera.position.distanceTo(centre), ndc: [+ndc.x.toFixed(2), +ndc.y.toFixed(2)] } })()`)
  const faceInFrame = Math.abs(face.ndc[0]) < 0.9 && Math.abs(face.ndc[1]) < 0.9
  return { ...measured, faceDistance: face.distance, faceNdc: face.ndc, aimInFrame: measured.inFrame, inFrame: faceInFrame }
}

/* ------------------------------------------------------------------ pixels -- */

const hsv = (r, g, b) => {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [((h * 60) + 360) % 360, max ? d / max : 0, max]
}
const linear = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const luminance = (r, g, b) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)

async function crop(file, rect) {
  const meta = await sharp(file).metadata()
  const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y))
  const x1 = Math.min(meta.width, Math.ceil(rect.x + rect.w)), y1 = Math.min(meta.height, Math.ceil(rect.y + rect.h))
  if (x1 - x0 < 1 || y1 - y0 < 1) return { data: Buffer.alloc(0), info: { width: 0, height: 0, channels: 3 } } // the rectangle is off screen
  const left = x0, top = y0, width = x1 - x0, height = y1 - y0
  return sharp(file).extract({ left, top, width, height }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
}

/** A css-pixel rectangle in screenshot pixels. */
export const scaled = (r, dpr = 1) => ({ x: r.x * dpr, y: r.y * dpr, w: r.w * dpr, h: r.h * dpr })

/** Hue buckets (30 degrees) of the saturated pixels in `rect`, and how much of it is blue-violet (235..330 degrees). */
export async function hueReport(file, rect) {
  const { data, info } = await crop(file, rect)
  const bins = new Array(12).fill(0)
  let counted = 0, bluish = 0, total = Math.max(1, info.width * info.height)
  for (let i = 0; i < data.length; i += info.channels) {
    const [h, s, v] = hsv(data[i], data[i + 1], data[i + 2])
    if (s < 0.2 || v < 0.15) continue
    counted++
    bins[Math.floor(h / 30) % 12]++
    if (h >= 235 && h < 330) bluish++
  }
  const dominant = bins.map((n, i) => ({ hue: `${i * 30}-${i * 30 + 30}`, share: +(n / Math.max(1, counted)).toFixed(3) })).sort((a, b) => b.share - a.share).slice(0, 3)
  return { pixels: total, saturated: +(counted / total).toFixed(3), blueViolet: +(bluish / Math.max(1, total)).toFixed(4), dominant }
}

/** WCAG contrast between the dark and light ends of a region as RENDERED (text vs its plaque): 3rd vs 97th luminance percentile. */
export async function renderedContrast(file, rect, { low = 0.03, high = 0.97 } = {}) {
  const { data, info } = await crop(file, rect)
  const values = []
  for (let i = 0; i < data.length; i += info.channels) values.push(luminance(data[i], data[i + 1], data[i + 2]))
  values.sort((a, b) => a - b)
  if (!values.length) return null
  const lo = values[Math.floor(values.length * low)], hi = values[Math.min(values.length - 1, Math.floor(values.length * high))]
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2)
}

/* ------------------------------------------------------------------ in-page probes -- */

/** Screen rectangle (css px) of a mesh's bounding box, and the on-screen height of its short side. Run via page.evaluate. */
const SCREEN_RECT = `(mesh, camera, T, size) => {
  mesh.geometry.computeBoundingBox()
  const box = mesh.geometry.boundingBox
  const pts = []
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) pts.push(new T.Vector3(x, y, z))
  mesh.updateWorldMatrix(true, false)
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9
  for (const p of pts) { const q = p.applyMatrix4(mesh.matrixWorld).project(camera); const sx = (q.x + 1) / 2 * size.w, sy = (1 - q.y) / 2 * size.h; minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy) }
  const ext = [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z]
  const order = [0, 1, 2].sort((i, j) => ext[j] - ext[i])
  const shortAxis = order[1]
  const mid = box.getCenter(new T.Vector3())
  const a = mid.clone(), b = mid.clone()
  a.setComponent(shortAxis, box.min.getComponent(shortAxis)); b.setComponent(shortAxis, box.max.getComponent(shortAxis))
  const pa = a.applyMatrix4(mesh.matrixWorld).project(camera), pb = b.applyMatrix4(mesh.matrixWorld).project(camera)
  const shortPx = Math.hypot((pa.x - pb.x) / 2 * size.w, (pa.y - pb.y) / 2 * size.h)
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, shortPx }
}`

export async function boardRects(page) {
  return page.evaluate(`(() => {
    const { a, T, inst, face, projects } = ${BOARD}
    const rect = ${SCREEN_RECT}
    const size = { w: innerWidth, h: innerHeight }
    const textOf = (holder) => { let found; inst.references.node(holder).traverse(o => { if (!found && o.isMesh && String(o.userData.w2Source ?? o.name).startsWith('text')) found = o }); return found }
    const title = textOf('refTitle')
    const out = { face: rect(face, a.camera, T, size), title: rect(title, a.camera, T, size), url: rect(textOf('refUrl'), a.camera, T, size) }
    out.prev = rect(textOf('refPrevious'), a.camera, T, size); out.next = rect(textOf('refNext'), a.camera, T, size)
    out.attributes = projects.attributes.map(x => rect(x.node, a.camera, T, size))
    const fit = projects.metrics?.title
    const canvasH = projects.flips[0].canvas.height
    out.titleGlyph = fit ? { px: fit.px, lines: fit.lines.length, truncated: fit.truncated, capCanvasPx: +(fit.px * 0.71).toFixed(1), canvasH, capScreenPx: +(fit.px * 0.71 / canvasH * out.title.shortPx).toFixed(1), emScreenPx: +(fit.px / canvasH * out.title.shortPx).toFixed(1), plateScreenPx: +out.title.shortPx.toFixed(1) } : null
    out.dpr = devicePixelRatio
    out.faceFit = projects.metrics?.face ? { descPx: projects.metrics.face.description.px, descLines: projects.metrics.face.description.lines.length, truncated: projects.metrics.face.description.truncated } : null
    return out
  })()`)
}

/** Canvas uploads that belong to the Projects board during `ms`. */
export async function uploadsDuring(page, ms, action = '') {
  await page.evaluate(`(() => { window.__mark = performance.now(); ${action} })()`)
  await sleep(ms)
  return page.evaluate(`(() => {
    const { projects } = ${BOARD}
    const own = new Set([projects.screen?.canvas, ...projects.flips.map(f => f.canvas), ...projects.attributes.map(x => x.canvas), ...(projects.emblem ? [projects.emblem.canvas] : [])])
    const all = window.__uploads.filter(u => u.t >= window.__mark)
    const mine = all.filter(u => own.has(u.el))
    const seconds = (performance.now() - window.__mark) / 1000
    const bytes = mine.reduce((n, u) => n + u.w * u.h * 4, 0)
    const sizes = {}; for (const u of mine) { const k = u.w + 'x' + u.h; sizes[k] = (sizes[k] ?? 0) + 1 }
    const perFrame = {}; for (const u of mine) perFrame[u.frame] = (perFrame[u.frame] ?? 0) + 1
    return { seconds: +seconds.toFixed(1), uploads: mine.length, maxPerFrame: Math.max(0, ...Object.values(perFrame)), perSecond: +(mine.length / seconds).toFixed(1), megabytesPerSecond: +(bytes / 1e6 / seconds).toFixed(2), sizes, maxSide: mine.reduce((m, u) => Math.max(m, u.w, u.h), 0), allCanvasUploads: all.length }
  })()`)
}

/** Draw calls and triangles per rendered frame, averaged over ~1 s, plus the shader programs the renderer holds. */
export async function renderCost(page) {
  return page.evaluate(`(async () => {
    const r = window.__archipelago.renderer
    const info = r.info
    const wasReset = info.autoReset
    info.autoReset = false; info.reset()
    const frame0 = info.render.frame
    await new Promise(res => setTimeout(res, 1000))
    const frames = Math.max(1, info.render.frame - frame0)
    const out = { calls: Math.round(info.render.calls / frames), triangles: Math.round(info.render.triangles / frames), renders: frames, programs: info.programs.length, geometries: info.memory.geometries, textures: info.memory.textures }
    info.autoReset = wasReset
    return out
  })()`)
}

/** Cold swatches (grey-violet 0, purple 20, pink 21) left on the board's own meshes. */
export async function coldSwatches(page) {
  return page.evaluate(`(() => {
    const { inst } = ${BOARD}
    const names = ['Cube.065', 'Cube.080', 'panel', 'Cube.077', 'cube.023', 'refArrowNextProject', 'refArrowPreviousProject', 'medal', 'cube.033', 'cube.021', 'cube.026']
    const pegs = inst.references.node('refPagination').children[0].children
    const out = {}
    const count = (mesh) => { const uv = mesh.geometry.getAttribute('uv'); const h = {}; for (let i = 0; i < uv.count; i++) { const s = Math.min(31, Math.floor(uv.getX(i) * 32)); h[s] = (h[s] ?? 0) + 1 } return h }
    for (const n of names) { const m = inst.environment.nodes.get(n); if (m?.isMesh) out[n] = count(m) }
    pegs.forEach((p, i) => { if (p.isMesh) out['peg' + i] = count(p) })
    const cold = Object.entries(out).map(([k, h]) => [k, (h[0] ?? 0) + (h[20] ?? 0) + (h[21] ?? 0)]).filter(([, n]) => n)
    return { cold, meshes: Object.keys(out).length }
  })()`)
}

/** Default-material quads (metalness 1, roughness 1, white) among the board's meshes: they render black. */
export async function blackQuads(page) {
  return page.evaluate(`(() => {
    const { inst } = ${BOARD}
    const bad = []
    inst.frame.traverse(o => { if (!o.isMesh || !o.visible) return; const m = o.material; if (m && m.isMeshStandardMaterial && !m.map && m.metalness === 1 && m.roughness === 1 && m.color.getHex() === 0xffffff) bad.push(o.userData.w2Source ?? o.name) })
    return bad
  })()`)
}

/** Canvas aspect over plane aspect for every painted surface of the board (1.0 = glyphs are not stretched), and the URL chip against its text. */
export async function aspectReport(page) {
  return page.evaluate(`(() => {
    const { T, inst, projects } = ${BOARD}
    const size = (mesh) => { mesh.geometry.computeBoundingBox(); const s = mesh.geometry.boundingBox.getSize(new T.Vector3()).multiply(mesh.scale); const [w, h] = [s.x, s.y, s.z].sort((a, b) => b - a); return { w, h } }
    const textOf = (holder) => { let found; inst.references.node(holder).traverse(o => { if (!found && o.isMesh && String(o.userData.w2Source ?? o.name).startsWith('text')) found = o }); return found }
    const rows = {}
    const add = (name, mesh, canvas) => { const p = size(mesh); rows[name] = { plane: [+p.w.toFixed(3), +p.h.toFixed(3)], canvas: [canvas.width, canvas.height], stretch: +((canvas.width / canvas.height) / (p.w / p.h)).toFixed(3) } }
    add('face', projects.screen.mesh, projects.screen.canvas)
    projects.flips.forEach((f, i) => add(['title', 'url', 'previous', 'next'][i] ?? 'flip' + i, textOf(['refTitle', 'refUrl', 'refPrevious', 'refNext'][i]), f.canvas))
    projects.attributes.forEach(a => add('attribute-' + a.role, a.node, a.canvas))
    const chip = inst.references.node('refUrl').children[0].children.find(c => c.isMesh && c !== textOf('refUrl'))
    return { rows, urlChipScaleX: chip ? +chip.scale.x.toFixed(3) : null }
  })()`)
}

/** Shows project `index` (mutated into the shape of a QA case) and waits for the plates to settle. */
export async function showProject(page, index, mutate) {
  await page.evaluate(({ index, mutate }) => {
    const a = window.__archipelago
    const pr = a.gameplay.instances.find(i => i.parts.projects).parts.projects
    const item = pr.items[index]
    if (mutate === 'long') {
      item.title = 'A Remarkably Long Project Title That Goes On And On Across Several Words To Test Wrapping And Ellipsis Behaviour Properly End'.slice(0, 120)
      item.description = ('Detailed description of everything this project does, from the first prototype to the production release, with many sentences. ').repeat(6).slice(0, 500)
      item.metric = '1,000,000+ records processed per night with zero downtime'
      item.technologies = ['TypeScript', 'PostgreSQL', 'Redis', 'WebGL', 'Rapier', 'Cloudflare']
    } else if (mutate === 'image') {
      const c = document.createElement('canvas'); c.width = 640; c.height = 400
      const x = c.getContext('2d'); const g = x.createLinearGradient(0, 0, 640, 400); g.addColorStop(0, '#2f6f5e'); g.addColorStop(1, '#e4a90c'); x.fillStyle = g; x.fillRect(0, 0, 640, 400)
      x.fillStyle = '#fff'; x.font = '700 64px sans-serif'; x.fillText('CMS image', 150, 220)
      item.image = c.toDataURL('image/png')
    } else if (mutate === 'nolink') { item.link = null }
    pr.select(index, true)
    pr.attract = -1e9 // the attract cycle would otherwise move on to another project mid-shot
  }, { index, mutate })
  await sleep(1700)
}

/* ------------------------------------------------------------------ suites -- */

const args = new Map(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? true] }))
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

const CASES = [
  { id: 'chess', index: 2, label: 'metric + link' },
  { id: 'focus', index: 0, label: 'no link' },
  { id: 'stock', index: 4, label: 'longer title' },
  { id: 'long', index: 5, mutate: 'long', label: '120-char title, 500-char description, metric, 6 techs' },
  { id: 'image', index: 6, mutate: 'image', label: 'CMS image' },
]

async function suiteShots(browser, out, results) {
  const only = args.get('viewports') ? String(args.get('viewports')).split(',') : null
  for (const viewport of [{ name: '1440x900', width: 1440, height: 900 }, { name: '1920x1080', width: 1920, height: 1080, only22: true }, { name: '390x844', width: 390, height: 844, mobile: true }].filter(v => !only || only.includes(v.name))) {
    const { context, page, errors } = await openSigns(browser, { ...viewport, baseline: args.has('baseline') })
    for (const c of CASES) {
      await showProject(page, c.index, c.mutate)
      for (const distance of args.has('quick') || viewport.only22 ? [22] : [22, 14, 8]) {
        let framing = await frameBoard(page, distance)
        // The car is parked by teleport and a prop can shove it: try again until the camera is where it was asked to be and sees the board.
        // Each retry aims a little differently (the face's own centre must be on screen), so a framing that failed is not repeated verbatim.
        for (let attempt = 1; attempt < 5 && ((!framing.inFrame && distance >= 12) || Math.abs(framing.faceDistance - distance) > 3); attempt++) framing = await frameBoard(page, distance, { aimShift: [0, -0.5, 0.6, -1, 1.2][attempt] })
        // Dropping the car near the neighbour signs can knock them (the physical switch): put the right project back.
        const shown = () => page.evaluate(`(() => { const { projects } = ${BOARD}; return { index: projects.index, title: projects.current.title } })()`)
        for (let attempt = 0; attempt < 3 && (await shown()).index !== c.index; attempt++) await showProject(page, c.index)
        await sleep(900) // the scheduler paints what the camera has just brought into view
        const now = await shown()
        const file = path.join(out, `shot-${viewport.name}-${c.id}-${distance}m.png`)
        await shoot(page, file)
        const rects = await boardRects(page)
        const hue = await hueReport(file, scaled(rects.face, rects.dpr))
        // A shot only counts when at least 30% of the face rectangle is in the viewport and 20k of its pixels were sampled. Inside ~12 m the
        // chase camera looks at a car 15 m away, so the board sits low in the frame and a close shot crops the face (the share says by how much).
        const faceShare = +(hue.pixels / Math.max(1, rects.face.w * rects.face.h * rects.dpr * rects.dpr)).toFixed(2)
        const valid = faceShare >= 0.3 && hue.pixels >= 20000
        results.shots.push({ valid, faceShare, viewport: viewport.name, case: c.id, label: c.label, shown: now, requested: distance, measuredToAim: +framing.distance.toFixed(1), measuredToFace: +framing.faceDistance.toFixed(1), aimNdc: framing.ndc, faceNdc: framing.faceNdc, boardInFrame: framing.inFrame, file: path.relative(ROOT, file), titleGlyph: rects.titleGlyph, faceFit: rects.faceFit, faceHue: hue })
        console.log(`${viewport.name} ${c.id.padEnd(6)} D=${distance} (to face ${framing.faceDistance.toFixed(1)}, ${valid ? 'valid' : 'INVALID: face out of frame'}, ${Math.round(faceShare * 100)}% of the face in view, centre ndc ${framing.faceNdc}) title em ${rects.titleGlyph?.emScreenPx}px cap ${rects.titleGlyph?.capScreenPx}px  blue/violet ${hue.blueViolet}  dominant ${hue.dominant.map(d => d.hue + ':' + d.share).join(' ')}`)
      }
    }
    results.errors.push(...errors)
    await context.close()
  }
}

async function suiteFocus(browser, out, results) {
  // Front-on, with the car out of the way: rendered contrast of every plate, and a clean look at the faces.
  const { context, page, errors } = await openSigns(browser, { baseline: args.has('baseline') })
  await page.evaluate(`(() => { const { a, T, inst, centre } = ${BOARD}; a.driving.place({ position: new T.Vector3(centre.x + 40, 1.2, centre.z + 40), rotation: 0 }) })()`)
  await sleep(1000)
  const out2 = []
  for (const c of CASES) {
    await showProject(page, c.index, c.mutate)
    await page.evaluate(`(() => { const { a, T, face, centre } = ${BOARD}; const nz = new T.Vector3(0, 0, 1).transformDirection(face.matrixWorld); const target = centre.clone().add(new T.Vector3(0, 0.5, 0)); a.driving.view.startCinematic(target.clone().add(nz.multiplyScalar(10.5)), target) })()`)
    await sleep(2600)
    const file = path.join(out, `focus-${c.id}.png`)
    await shoot(page, file)
    const r = await boardRects(page)
    const k = (rect) => renderedContrast(file, scaled(rect, r.dpr))
    const contrast = { title: await k(r.title), url: await renderedContrast(file, scaled(r.url, r.dpr), { low: 0.005, high: 0.995 }), face: await k(r.face), prev: await k(r.prev), next: await k(r.next), attributes: await Promise.all(r.attributes.map(k)) }
    out2.push({ case: c.id, file: path.relative(ROOT, file), contrast })
    console.log(`focus ${c.id.padEnd(6)} contrast title ${contrast.title}  url ${contrast.url}  face ${contrast.face}  prev ${contrast.prev} next ${contrast.next}  attributes ${contrast.attributes.join('/')}`)
  }
  results.focus = out2
  results.aspect = await aspectReport(page)
  console.log('stretch (canvas aspect / plane aspect):', JSON.stringify(Object.fromEntries(Object.entries(results.aspect.rows).map(([k, v]) => [k, v.stretch]))), 'url chip scale.x', results.aspect.urlChipScaleX)
  results.cold = await coldSwatches(page)
  results.blackQuads = await blackQuads(page)
  console.log('cold swatches left on the board meshes:', JSON.stringify(results.cold), ' black quads:', JSON.stringify(results.blackQuads))
  results.errors.push(...errors)
  await context.close()
}

async function suitePerf(browser, out, results) {
  const { context, page, errors } = await openSigns(browser, { baseline: args.has('baseline') })
  const perf = {}
  // Far away and out of sight: the board must cost nothing.
  await page.evaluate(`(() => { const { a, T, centre } = ${BOARD}; a.driving.place({ position: new T.Vector3(centre.x - 110, 1.2, centre.z - 40), rotation: 0 }) })()`)
  await sleep(2500)
  perf.programsAtStart = (await renderCost(page)).programs
  perf.far = await uploadsDuring(page, 8000)
  // In the gameplay frame at the board, nobody touching it.
  await frameBoard(page, 22)
  await sleep(2500)
  perf.nearIdle = await uploadsDuring(page, 6000)
  perf.nearSteady = await uploadsDuring(page, 6000) // includes the attract cycle's content changes (one every ~3.5 s)
  // The same, with the attract cycle held: what a board costs while nothing about it changes.
  await page.evaluate(`(() => { const { projects } = ${BOARD}; projects.attract = -1e9 })()`)
  await sleep(1500)
  perf.nearNoContentChange = await uploadsDuring(page, 6000, `const { projects } = ${BOARD}; projects.attract = -1e9`)
  // What one repaint costs on the main thread (new code only: the old board paints through its own functions).
  perf.paintMs = await page.evaluate(`(async () => {
    const { projects } = ${BOARD}
    if (!projects.sign) return null
    const time = (fn, n = 20) => { fn(); const t = performance.now(); for (let i = 0; i < n; i++) fn(i); return +((performance.now() - t) / n).toFixed(2) }
    const layers = Object.fromEntries(projects.sign.layers.map(l => [l.name, l]))
    const K = await import('/archipelago/preview/portfolio/world2/signs/index.js')
    const ctx = document.createElement('canvas').getContext('2d'); ctx.canvas.width = ctx.canvas.height = 256
    const emblems = {}; for (const kind of K.EMBLEM_KINDS) emblems[kind] = time(() => K.paintEmblem(ctx, kind, 256, 1.3), 30)
    return { face: time(() => layers.face.paint(1)), title: time(() => layers.refTitle.paint(1)), emblemWorst: Math.max(...Object.values(emblems)), emblems }
  })()`)
  perf.cost = await renderCost(page)
  perf.programsAfterSight = perf.cost.programs
  perf.newProgramsOnFirstSight = perf.programsAfterSight - perf.programsAtStart
  // One content change (a select): the bytes that cost.
  perf.afterSelect = await uploadsDuring(page, 2200, `const { projects } = ${BOARD}; projects.step(1)`)
  // Board out of the frame: the camera looks away from it.
  await page.evaluate(`(() => { const { a, T, centre } = ${BOARD}; a.driving.place({ position: new T.Vector3(centre.x + 60, 1.2, centre.z + 60), rotation: 0 }) })()`)
  await sleep(1500)
  perf.offscreenNear = await uploadsDuring(page, 6000)
  // prefers-reduced-motion: the picture is a still, so a board in plain sight stops repainting.
  await frameBoard(page, 22)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await sleep(1500)
  perf.reducedMotion = await uploadsDuring(page, 5000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  results.perf = perf
  console.log(JSON.stringify(perf, null, 1))
  results.errors.push(...errors)
  await context.close()
}

async function suiteAzimuth(browser, out, results) {
  // The player can orbit the chase camera. The sun meets the faces at a grazing angle, so check the faces read from every side.
  const { context, page, errors } = await openSigns(browser, { baseline: args.has('baseline') })
  const rows = []
  for (const [i, theta] of [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75].entries()) {
    await page.evaluate(({ theta }) => { const v = window.__archipelago.driving.view; v.spherical.targetTheta = theta * Math.PI }, { theta })
    await frameBoard(page, 14, { hideCar: true })
    await page.evaluate(({ theta }) => { const v = window.__archipelago.driving.view; v.spherical.targetTheta = theta * Math.PI }, { theta })
    await page.evaluate(`(() => { const { projects } = ${BOARD}; projects.attract = -1e9 })()`)
    await sleep(1800)
    const facing = await page.evaluate(`(() => { const { a, T, face, centre } = ${BOARD}; const n = new T.Vector3(0, 0, 1).transformDirection(face.matrixWorld); return +n.dot(a.camera.position.clone().sub(centre).normalize()).toFixed(2) })()`)
    const file = path.join(out, `azimuth-${String(i).padStart(2, '0')}-${theta}pi.png`)
    await shoot(page, file)
    const r = await boardRects(page)
    const rect = scaled(r.face, r.dpr)
    const { data, info } = await crop(file, rect)
    let sum = 0, n = 0
    for (let k = 0; k < data.length; k += info.channels) { sum += luminance(data[k], data[k + 1], data[k + 2]); n++ }
    rows.push({ theta: theta + 'pi', facing, file: path.relative(ROOT, file), faceMeanLuminance: n ? +(sum / n).toFixed(3) : null, faceContrast: await renderedContrast(file, rect) })
    console.log('azimuth', theta + 'pi', facing > 0.15 ? 'front' : 'behind/edge-on', `(cos ${facing})`, 'face mean luminance', rows.at(-1).faceMeanLuminance, 'contrast', rows.at(-1).faceContrast)
  }
  results.azimuth = rows
  results.errors.push(...errors)
  await context.close()
}

async function suiteAchievement(browser, results) {
  const { context, page, errors } = await openSigns(browser, { baseline: args.has('baseline') })
  await page.evaluate(`(() => { const { a, T, centre } = ${BOARD}; a.driving.place({ position: new T.Vector3(centre.x - 110, 1.2, centre.z - 40), rotation: 0 }) })()`)
  await sleep(1500)
  // A step by hand (keys) or by the car (the neighbour signs are a physical switch; parking on one counts) is a deliberate visit and
  // is allowed to mark. Only the attract cycle must not, so the reading is progress against the steps taken.
  await page.evaluate(`(() => { const { projects } = ${BOARD}; window.__deliberate = 0; const step = projects.step.bind(projects); projects.step = function (d) { window.__deliberate++; return step(d) } })()`)
  const read = () => page.evaluate(`(() => { const a = window.__archipelago; const g = a.gameplay.achievements.groups.get('projects'); const { projects } = ${BOARD}; return { progress: g.progress, unlocked: g.unlocked, index: projects.index, deliberateSteps: window.__deliberate } })()`)
  const before = await read()
  const seconds = args.has('quick') ? 35 : 60
  await sleep(seconds * 1000)
  const far = await read()
  // Near the board but never opening it: attract runs, and still must not count.
  await frameBoard(page, 22)
  await sleep(seconds * 1000)
  const near = await read()
  results.achievement = { seconds, before, farAfter: far, nearAfter: near }
  console.log('achievement Portfolio:', JSON.stringify(results.achievement))
  for (const [name, reading] of [['far', far], ['near', near]]) if (reading.progress > reading.deliberateSteps) results.errors.push(`achievement: ${name} progress ${reading.progress} with ${reading.deliberateSteps} deliberate steps: the attract cycle marked the Portfolio achievement`)
  results.errors.push(...errors)
  await context.close()
}

/** Share of near-black pixels in a css-pixel rectangle of a screenshot: an unpainted emissive face renders as solid black. */
export async function darkShare(file, rect) {
  const { data, info } = await crop(file, rect)
  const n = info.width * info.height
  if (!n) return null
  let dark = 0
  for (let i = 0; i < data.length; i += info.channels) if (Math.max(data[i], data[i + 1], data[i + 2]) < 28) dark++
  return +(dark / n).toFixed(3)
}

/**
 * --old-scheduler serves the sign runtime as it was before warming existed: nothing painted out of sight, no catch-up, no
 * camera-jump probe, no ground colour. The first-sight suite is expected to FAIL with it, which proves the suite can see the bug.
 */
const oldScheduler = async (context) => {
  const file = path.join(ROOT, PREVIEW, 'portfolio/world2/signs/Sign.js')
  let body = fs.readFileSync(file, 'utf8')
  const swap = (from, to) => { if (!body.includes(from)) throw new Error(`--old-scheduler: Sign.js no longer contains: ${from}`); body = body.replace(from, to) }
  swap('let painted = this.catchUp(now, reduced);', 'let painted = 0;')
  swap('if (!seen) {', 'if (!seen) { continue;')
  swap('if (options.base) {', 'if (false) {')
  swap('this.cameraJumped()', 'false')
  await context.route('**/portfolio/world2/signs/Sign.js', route => route.fulfill({ body, contentType: 'text/javascript' }))
}

/** Per-frame recorder for the board: in view or not, and how many of its layers have never been painted (the kit only). */
const RECORD_FRAMES = `(() => {
  const { a, T, face, projects } = ${BOARD}
  window.__rec = []
  const frustum = new T.Frustum(), m = new T.Matrix4(), c = new T.Vector3()
  let last = performance.now()
  const loop = () => {
    const now = performance.now()
    face.updateWorldMatrix(true, false)
    m.multiplyMatrices(a.camera.projectionMatrix, a.camera.matrixWorldInverse); frustum.setFromProjectionMatrix(m)
    face.getWorldPosition(c)
    window.__rec.push({ t: now, dt: now - last, inView: frustum.intersectsSphere(new T.Sphere(c.clone(), 1.5)), unpainted: projects.sign ? projects.sign.layers.filter(l => l.paintedAt === -Infinity).length : null })
    last = now
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
})()`

/**
 * The first time the board comes into view. (1) the real way in: far away for a few seconds, then travel from the map; (2) the
 * worst case the scheduler has to survive: every layer reset to never-painted and the car dropped at the board in the same
 * breath. Either way not one frame with the board in view may have an unpainted layer, and the first screenshot must not
 * show a black face.
 */
async function suiteFirstSight(browser, out, results) {
  const { context, page, errors } = await openSigns(browser, { baseline: args.has('baseline'), prepare: args.has('old-scheduler') ? oldScheduler : undefined })
  await sleep(1200)
  await page.evaluate(RECORD_FRAMES)
  await page.evaluate(`(() => { const { a, T, centre } = ${BOARD}; a.driving.place({ position: new T.Vector3(centre.x - 110, 1.2, centre.z - 40), rotation: 0 }) })()`)
  await sleep(3000)
  const cases = []
  const check = async (id, enter) => {
    await page.evaluate('window.__rec.length = 0')
    await enter()
    const file = path.join(out, `firstsight-${id}.png`)
    await shoot(page, file)
    await sleep(1200)
    const rec = await page.evaluate('window.__rec.slice()')
    const rects = await boardRects(page)
    const inView = rec.filter(r => r.inView)
    const row = {
      id, framesInView: inView.length, framesWithUnpaintedLayer: inView.filter(r => r.unpainted).length,
      worstFrameMs: +Math.max(0, ...rec.slice(0, 12).map(r => r.dt)).toFixed(1), faceDarkShare: await darkShare(file, rects.face), screenshot: path.relative(ROOT, file),
    }
    cases.push(row)
    console.log('firstsight', JSON.stringify(row))
  }
  await check('map-travel', async () => {
    await page.keyboard.press('KeyM'); await sleep(900)
    const dot = await page.locator('.atlas-pin[aria-label="Travel to Projects"]').first().locator('i').boundingBox()
    await page.mouse.click(dot.x + dot.width / 2, dot.y + dot.height / 2)
  })
  if (!args.has('baseline')) {
    await page.evaluate(`(() => { const { a, T, centre } = ${BOARD}; a.driving.place({ position: new T.Vector3(centre.x - 110, 1.2, centre.z - 40), rotation: 0 }) })()`)
    await sleep(2500)
    await check('never-painted-jump', async () => {
      await page.evaluate(`(() => {
        const { a, T, inst, projects } = ${BOARD}
        for (const layer of projects.sign.layers) {
          layer.paintedAt = -Infinity; layer.dirty = true; layer.paints = 0
          layer.context.setTransform(1, 0, 0, 1, 0, 0); layer.context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
          if (layer.name === 'face') { layer.context.fillStyle = '#f1d8a6'; layer.context.fillRect(0, 0, layer.canvas.width, layer.canvas.height) }
          layer.texture.needsUpdate = true
        }
        const reader = inst.physics.point(inst.references.position('refInteractivePoint'))
        a.driving.place({ position: new T.Vector3(reader.x, 1.2, reader.z), rotation: 0 })
      })()`)
    })
  }
  results.firstSight = cases
  const bad = cases.filter(c => c.framesWithUnpaintedLayer > 0 || (c.faceDarkShare ?? 0) > 0.05)
  if (bad.length) results.errors.push(...bad.map(c => `first sight (${c.id}): ${c.framesWithUnpaintedLayer} frames with an unpainted layer, face ${Math.round((c.faceDarkShare ?? 0) * 100)}% black`))
  results.errors.push(...errors)
  await context.close()
}

/* ------------------------------------------------------------------ project change cost -- */

const pct = (xs, q) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * q))] : 0 }
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0 }

/**
 * One run of the change suite: the board in the gameplay frame, `changes` project changes (step(1), the attract cycle held), and
 * what they cost on the main thread. With `rate` > 1 the CPU is throttled through CDP, which is the nearest thing to a phone.
 * The layer-level numbers need the new kit (`projects.sign`); git HEAD's board has none, so it reports frames only.
 */
async function changeRun(browser, variant, rate, changes) {
  const options = { width: 1280, height: 720, ...(variant === 'head' ? { baseline: true } : variant === 'before' ? { serveFrom: path.resolve(ROOT, String(args.get('before'))) } : {}) }
  const { context, page, errors } = await openSigns(browser, options)
  await frameBoard(page, 22)
  await sleep(1500)
  const cdp = await context.newCDPSession(page)
  await page.evaluate(`(() => {
    const { projects } = ${BOARD}
    const w = window.__chg = { fr: [], layers: {}, tick: [], measure: 0, long: [] }
    const measure = CanvasRenderingContext2D.prototype.measureText
    CanvasRenderingContext2D.prototype.measureText = function (t) { w.measure++; return measure.call(this, t) }
    projects.attract = -1e9
    for (const l of projects.sign?.layers ?? []) {
      const original = l.paint.bind(l)
      l.paint = function (...a) { const t = performance.now(); original(...a); const d = performance.now() - t; const r = (w.layers[l.name] ??= { n: 0, sum: 0, max: 0, samples: [] }); r.n++; r.sum += d; r.max = Math.max(r.max, d); r.samples.push(d); w.events.push({ t, name: 'paint:' + l.name, ms: d }) }
    }
    const runtime = projects.runtime
    if (runtime) { const tick = runtime.tick.bind(runtime); runtime.tick = function () { const t = performance.now(); const r = tick(); w.tick.push(performance.now() - t); return r } }
    // Where the hardware (a theme's ivy, rope or chain, and its charm) is built: inside the frame that swaps the sheet, or ahead of it.
    w.hw = []; w.events = []; w.marks = []; w.at = performance.now()
    if (projects.woodFor && projects.skin) {
      let inSkin = false
      for (const [name, store] of [['woodFor', 'woods'], ['charmFor', 'charms']]) {
        const original = projects[name].bind(projects)
        projects[name] = function (kind) {
          const had = projects[store].has(kind), t = performance.now(), r = original(kind)
          if (!had) { const ms = performance.now() - t; w.hw.push({ name, kind, ms, inSkin }); w.events.push({ t, name: name + ':' + kind + (inSkin ? ' (swap)' : ' (ahead)'), ms }) }
          return r
        }
      }
      const skin = projects.skin.bind(projects)
      projects.skin = function () { inSkin = true; try { return skin() } finally { inSkin = false } }
    }
    let last = performance.now(); const loop = () => { const n = performance.now(); w.fr.push(n - last); w.frameAt.push(n); last = n; requestAnimationFrame(loop) }; w.frameAt = []; requestAnimationFrame(loop)
    try { new PerformanceObserver(list => { for (const e of list.getEntries()) w.long.push(e.duration) }).observe({ type: 'longtask', buffered: false }) } catch {}
  })()`)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate })
  await sleep(2000)
  await page.evaluate(`(() => { const w = window.__chg; w.fr.length = 0; w.frameAt.length = 0; w.long.length = 0; w.tick.length = 0; w.hw.length = 0; w.events.length = 0; w.measure = 0; for (const r of Object.values(w.layers)) { r.n = 0; r.sum = 0; r.max = 0; r.samples.length = 0 } })()`)
  for (let i = 0; i < changes; i++) {
    await page.evaluate(`(() => { const { projects } = ${BOARD}; window.__chg.marks.push(performance.now()); projects.step(1); projects.attract = -1e9 })()`)
    await sleep(1600)
  }
  const r = await page.evaluate((changes) => {
    const w = window.__chg, s = [...w.fr].sort((a, b) => b - a)
    const layers = Object.fromEntries(Object.entries(w.layers).filter(([, v]) => v.n).map(([k, v]) => [k, { n: v.n, avg: +(v.sum / v.n).toFixed(2), max: +v.max.toFixed(2) }]))
    const paintTotal = Object.values(w.layers).reduce((a, v) => a + v.sum, 0)
    return {
      frames: w.fr.length, worst: +(s[0] ?? 0).toFixed(1), top: s.slice(0, 5).map(n => +n.toFixed(0)), over33: w.fr.filter(n => n > 33).length, over50: w.fr.filter(n => n > 50).length,
      longTasks: w.long.length, longestTask: +Math.max(0, ...w.long).toFixed(0), tickMax: +Math.max(0, ...w.tick).toFixed(2), layers,
      paintPerChange: +(paintTotal / changes).toFixed(2), measureTextPerChange: Math.round(w.measure / changes),
      // The worst frame within 1.5 s of each change: a statistic one stray frame on a busy machine cannot move on its own.
      perChangeWorst: w.marks.map(m => Math.max(0, ...w.fr.filter((_, i) => w.frameAt[i] > m && w.frameAt[i] <= m + 1500))).map(n => +n.toFixed(1)),
      hardwareAtSwap: w.hw.filter(h => h.inSkin).length, hardwareAhead: w.hw.filter(h => !h.inSkin).length,
      hardwareMs: +w.hw.filter(h => h.inSkin).reduce((a, h) => a + h.ms, 0).toFixed(2),
      // What ran in each frame over 33 ms: the paints and hardware builds whose time fell inside it.
      longFrames: w.fr.map((dt, i) => ({ dt, from: w.frameAt[i] - dt, to: w.frameAt[i] })).filter(f => f.dt > 33).map(f => ({ dt: +f.dt.toFixed(1), what: w.events.filter(e => e.t >= f.from && e.t <= f.to).map(e => e.name + ' ' + e.ms.toFixed(1)) })),
    }
  }, changes)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  await context.close()
  return { variant, rate, ...r, errors }
}

async function suiteChange(browser, out, results) {
  const variants = String(args.get('variants') ?? 'head,before,after').split(',').filter(v => v !== 'before' || args.get('before'))
  const rates = String(args.get('rates') ?? '1,4').split(',').map(Number)
  const runs = Number(args.get('runs') ?? 2), changes = Number(args.get('changes') ?? 12)
  results.change = []
  for (let run = 0; run < runs; run++) for (const rate of rates) for (const variant of variants) {
    const r = await changeRun(browser, variant, rate, changes)
    results.change.push(r)
    results.errors.push(...r.errors)
    console.log(`${variant.padEnd(6)} ${rate}x run ${run + 1}: worst ${r.worst} ms, top ${r.top.join('/')}, >33 ms ${r.over33}, >50 ms ${r.over50}, long tasks ${r.longTasks} (longest ${r.longestTask}), tick max ${r.tickMax}, paint/change ${r.paintPerChange} ms, measureText/change ${r.measureTextPerChange}, hardware built at the swap ${r.hardwareAtSwap} (${r.hardwareMs} ms) / ahead ${r.hardwareAhead}`)
    if (args.has('long-frames')) for (const f of r.longFrames) console.log(`    frame ${f.dt} ms: ${f.what.join(', ') || '(nothing of ours)'}`)
    for (const [name, v] of Object.entries(r.layers)) console.log(`    ${name.padEnd(10)} n=${v.n} avg ${v.avg} max ${v.max}`)
  }
  const table = {}
  for (const rate of rates) for (const variant of variants) {
    const rows = results.change.filter(r => r.rate === rate && r.variant === variant)
    if (rows.length) table[`${variant} ${rate}x`] = { perChangeMedian: median(rows.flatMap(r => r.perChangeWorst)), perChangeP90: pct(rows.flatMap(r => r.perChangeWorst), 0.9), over33Total: rows.reduce((n, r) => n + r.over33, 0), changesTotal: rows.reduce((n, r) => n + r.perChangeWorst.length, 0), worst: median(rows.map(r => r.worst)), worstMax: Math.max(...rows.map(r => r.worst)), over33: median(rows.map(r => r.over33)), over50: median(rows.map(r => r.over50)), longest: median(rows.map(r => r.longestTask)), paintPerChange: median(rows.map(r => r.paintPerChange)), measureTextPerChange: median(rows.map(r => r.measureTextPerChange)), hardwareAtSwap: median(rows.map(r => r.hardwareAtSwap)) }
  }
  results.changeSummary = table
  console.table(table)
}

/* ------------------------------------------------------------------ golden: the same pixels as the snapshot -- */

const STRESS = {
  'long': { title: 'A Remarkably Long Project Title That Goes On And On Across Several Words To Test Wrapping And Ellipsis Behaviour Properly End', description: 'Detailed description of everything this project does, from the first prototype to the production release, with many sentences. '.repeat(6).slice(0, 500), metric: '1,000,000+ records processed per night with zero downtime', technologies: ['TypeScript', 'PostgreSQL', 'Redis', 'WebGL', 'Rapier', 'Cloudflare'] },
  'address': { link: 'https://github.com/an-owner-with-a-long-name/Designing-and-Analysing-a-Fair-Variant-of-Cinquillo-and-its-Strategies-With-More-Words' },
  'oneword': { title: 'Supercalifragilisticexpialidocious-and-then-some-more-letters-without-a-break', short: 'Supercalifragilisticexpialidocious-and-more', description: 'x'.repeat(300), category: 'Uncategorisable-beyond-reason', year: '2019-2026-and-ongoing', technologies: ['Supercalifragilisticexpialidocious', 'b'] },
  'cjk': { title: '日本語のとても長いプロジェクト名前がここにあります', short: '日本語', description: '日本語の説明です。'.repeat(30), category: '機械学習', metric: '百万人のユーザー', technologies: ['Rust', '日本語'] },
  'emoji': { title: '🚀🚀 Launch day 🚀🚀 and more words to wrap', short: '🚀 Launch', description: 'Rocket 🚀 science 🔬 and cooking 🍳 '.repeat(14), metric: '🔥 100% 🔥', technologies: ['🚀', '🔬'] },
  'tiny': { title: 'A', short: 'A', description: 'B', category: 'C', year: '1', metric: 'D', link: null, technologies: [] },
  'blank': { title: '   ', short: ' ', description: '   ', category: ' ', year: '', metric: '   ', link: 'https://x.io', technologies: ['', ' ', 'ok'] },
}

async function goldenRun(browser, options) {
  const { context, page, errors } = await openSigns(browser, { width: 1280, height: 720, ...options })
  const frames = []
  const result = await page.evaluate(async (stress) => {
    const a = window.__archipelago
    const K = await import('/archipelago/preview/portfolio/world2/signs/index.js')
    await K.loadSignFonts()
    await document.fonts.ready
    const pr = a.gameplay.instances.find(i => i.parts.projects).parts.projects
    const hash = (text) => { let h = 2166136261; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) } return (h >>> 0).toString(16) }
    const rows = []
    const one = (label, index, patch) => {
      const item = pr.items[index], original = { ...item }
      if (patch) Object.assign(item, patch)
      pr.select(index, true); pr.attract = -1e9
      pr.paintNow()
      const layers = {}
      for (const layer of pr.sign.layers) if (!layer.live) layers[layer.name] = hash(layer.canvas.toDataURL())
      const m = pr.metrics
      rows.push({ label, layers, face: m.face ? { px: m.face.description.px, lines: m.face.description.lines.length, cut: m.face.description.truncated } : null, title: m.title ? { px: m.title.px, lines: m.title.lines.length, cut: m.title.truncated } : null })
      for (const key of Object.keys(patch ?? {})) item[key] = original[key]
    }
    for (let i = 0; i < pr.items.length; i++) one(`project ${i} ${pr.items[i].id}`, i)
    for (const [name, patch] of Object.entries(stress)) for (const index of [0, 5, 20]) one(`${name} on ${index}`, index, patch)
    return rows
  }, STRESS)
  frames.push(...result)
  await context.close()
  return { rows: frames, errors }
}

async function suiteGolden(browser, out, results) {
  if (!args.get('before')) throw new Error('--suite=golden needs --before=<dir>')
  const before = await goldenRun(browser, { serveFrom: path.resolve(ROOT, String(args.get('before'))) })
  const after = await goldenRun(browser, {})
  results.errors.push(...before.errors, ...after.errors)
  const different = []
  let compared = 0
  for (const [i, row] of after.rows.entries()) {
    const old = before.rows[i]
    for (const name of new Set([...Object.keys(row.layers), ...Object.keys(old.layers)])) {
      compared++
      if (row.layers[name] !== old.layers[name]) different.push(`${row.label}: ${name}`)
    }
    if (JSON.stringify([row.face, row.title]) !== JSON.stringify([old.face, old.title])) different.push(`${row.label}: fitted sizes ${JSON.stringify([old.face, old.title])} -> ${JSON.stringify([row.face, row.title])}`)
  }
  results.golden = { cases: after.rows.length, canvasesCompared: compared, different }
  console.log(`golden: ${after.rows.length} cases, ${compared} canvases compared with the snapshot, ${different.length} differ`)
  for (const line of different.slice(0, 30)) console.log('  DIFFERENT', line)
  if (different.length) process.exitCode = 1
}

async function suiteStudio(browser, out, results) {
  const html = (await import(new URL('../../src/server/world-studio/studio-template.ts', import.meta.url))).STUDIO_HTML.replace('<!--CONFIG-->', '<script>window.ARCHIPELAGO_CONFIG={}</script>')
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  const errors = watch(page)
  await page.route(`${BASE}/archipelago/preview/studio-qa.html`, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
  // --old-editor: the editor without the rebuild of saved boards. The suite is expected to FAIL with it, which proves the suite can see the bug.
  if (args.has('old-editor')) await page.route('**/archipelago/preview/editor.js', async route => { const r = await route.fetch(); await route.fulfill({ response: r, body: (await r.text()).replace('||staleDesign(n,d)', '') }) })
  await page.goto(`${BASE}/archipelago/preview/studio-qa.html`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 240_000 })
  await page.locator('#edit').click()
  await sleep(2500)
  const rows = await page.evaluate(() => {
    const A = globalThis.__archipelago, out = []
    const darkShare = (canvas) => {
      const c = document.createElement('canvas'); c.width = 96; c.height = 54
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(canvas, 0, 0, 96, 54)
      const d = g.getImageData(0, 0, 96, 54).data; let dark = 0
      for (let i = 0; i < d.length; i += 4) if ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 < 0.2) dark++
      return dark / (d.length / 4)
    }
    for (const id of ['projects', 'lab']) {
      let found = null
      A.root.traverse(o => { if (found || o.userData.world2Asset !== id) return; for (let n = o; n; n = n.parent) if (!n.visible) return; found = o })
      if (!found) { out.push({ id, error: 'no visible instance in the Edit scene' }); continue }
      let signs = 0, face = null
      found.traverse(n => { if (/^sign:/.test(n.name)) signs++; if (n.name === `sign:${id}:emblem`) face = n.parent?.parent })
      const map = Array.isArray(face?.material) ? face.material[0]?.map : face?.material?.map
      out.push({ id, signs, canvas: !!map?.isCanvasTexture, dark: map?.image ? +darkShare(map.image).toFixed(2) : null, design: (() => { let v = 0; found.traverse(n => { if (n.userData.signDesign > v) v = n.userData.signDesign }); return v })() })
    }
    return out
  })
  for (const row of rows) {
    const good = !row.error && row.signs > 0 && row.canvas && row.dark !== null && row.dark < 0.25 && row.design > 0
    console.log(`${good ? 'PASS' : 'FAIL'} studio 3D EDIT, ${row.id}: ${JSON.stringify(row)}`)
    if (!good) results.errors.push(`studio 3D EDIT shows the old ${row.id} board: ${JSON.stringify(row)}`)
  }
  await page.evaluate(() => { const E = globalThis.__archipelago.editor; E.select([]); E.orbit.target.set(88.3, 1.4, 1.1); E.camera.position.set(95.3, 5.5, 11.1); E.orbit.update?.() })
  await sleep(2000)
  await shoot(page, path.join(out, 'studio-edit-projects.png'))
  await page.evaluate(() => { const E = globalThis.__archipelago.editor; E.orbit.target.set(70.5, 1.4, 1.4); E.camera.position.set(77.5, 5.5, 11.4); E.orbit.update?.() })
  await sleep(2000)
  await shoot(page, path.join(out, 'studio-edit-lab.png'))
  results.studio = rows
  results.errors.push(...errors)
  await context.close()
}

async function suiteGallery(browser, out, results) {
  const { context, page, errors } = await openSigns(browser)
  await page.evaluate(async () => {
    const a = window.__archipelago
    const K = await import('/archipelago/preview/portfolio/world2/signs/index.js')
    const inst = a.gameplay.instances[0]
    const materials = K.signMaterials(inst.environment.group)
    const runtime = new K.SignRuntime({ ticker: a.driving.ticker, camera: () => a.camera })
    const car = a.driving.vehicle.position
    const make = (opts, dx, dz) => { const s = new K.Sign({ materials, runtime, ...opts }); s.group.position.set(car.x + dx, car.y - 0.5, car.z + dz); s.group.rotation.y = a.driving.view.spherical.theta; a.scene.add(s.group) }
    make({ id: 'g-board', variant: 'board', width: 2.6, height: 1.45, title: 'Achievement Plaza', subtitle: 'Every badge you have earned, on one board.', kicker: 'Plaza', theme: 'stock' }, -2, -2)
    make({ id: 'g-plank', variant: 'plank', width: 1.5, height: 0.5, title: 'GitHub', subtitle: '@alejandro', hang: 'rope' }, -5, 1)
    make({ id: 'g-number', variant: 'plank', width: 1.1, height: 0.8, title: 'Visited', value: 42 }, -6.5, -3)
    make({ id: 'g-label', variant: 'label', width: 2.6, height: 0.7, title: 'Software Engineer', subtitle: 'Newport Media · 2024', accent: '#5390ff' }, 1, 3)
  })
  await sleep(2500)
  const file = path.join(out, 'gallery.png')
  await shoot(page, file)
  results.gallery = path.relative(ROOT, file)
  results.errors.push(...errors)
  await context.close()
}

if (isMain) {
  const out = path.resolve(ROOT, String(args.get('out') ?? '.qa/runs/impl/signs-kit'))
  fs.mkdirSync(out, { recursive: true })
  const suites = String(args.get('suite') ?? 'shots,focus,perf,achievement,gallery').split(',')
  const results = { baseline: args.has('baseline'), shots: [], errors: [] }
  const browser = await launch()
  try {
    if (suites.includes('shots')) {
      await suiteShots(browser, out, results)
      console.log(`shots: ${results.shots.filter(shot => shot.valid).length}/${results.shots.length} valid (>= 30% of the face in view and >= 20k face pixels sampled)`)
    }
    if (suites.includes('focus')) await suiteFocus(browser, out, results)
    if (suites.includes('perf')) await suitePerf(browser, out, results)
    if (suites.includes('azimuth')) await suiteAzimuth(browser, out, results)
    if (suites.includes('achievement')) await suiteAchievement(browser, results)
    if (suites.includes('gallery')) await suiteGallery(browser, out, results)
    if (suites.includes('firstsight')) await suiteFirstSight(browser, out, results)
    if (suites.includes('change')) await suiteChange(browser, out, results)
    if (suites.includes('golden')) await suiteGolden(browser, out, results)
    if (suites.includes('studio')) await suiteStudio(browser, out, results)
  } finally {
    await browser.close()
    const name = `world-signs-report${args.has('baseline') ? '-baseline' : ''}.json`
    fs.writeFileSync(path.join(out, name), JSON.stringify(results, null, 1))
    console.log(`\nerrors: ${results.errors.length ? results.errors.join('\n  ') : 'none'}\nreport: ${path.relative(ROOT, path.join(out, name))}`)
    if (results.errors.length) process.exitCode = 1
  }
}
