/* /world floating labels: every label meant to be READ faces the GAMEPLAY camera.

   For each reader label (interaction prompts today; Social plates, Career stop
   labels, the behind-the-scenes board and the plaza plaques once their owners
   adopt Billboards) the car is put on BOTH sides of the label, the chase camera
   is orbited through the range a player can reach (drag-orbit: any yaw,
   elevation 13..83 deg) and in EVERY sample the label's world normal, up and
   right are compared with the camera that is actually rendering
   (window.__archipelago.camera):
     registered spherical label   plate parallel to the screen (-n . forward >= 0.995),
                                  text not mirrored (right . camRight >= 0.98) and upright (up . camUp >= 0.9)
     label not (yet) registered   it must face the camera within ~25 deg (n . toCamera >= 0.9), same text checks
   A drive pass then samples ON the ticker, after the billboard system, while the
   car drives and the camera swings 360 deg: a label that lags by even one frame
   fails. A second pass moves the system BEFORE the camera on purpose to prove
   the sampler would see such a lag. A 390x844 touch pass checks legibility
   (projected cap height) at the phone's default and fully zoomed-out cameras.

   THE SCREEN FIT (section 7). An open prompt hangs a label off one side of its diamond; on a phone held upright (a
   screen ~6 m wide at the chase camera) that label ran off the picture ("e scenes", "chievements"). Prompts.fit() keeps
   it inside the screen (a swap of the side, a slide, a shrink never under 12 px cap height) and pulls what it moved in
   front of the car. Every prompt of the world is opened from nine car positions round its anchor, at the default camera and
   fully zoomed out, on 390x844, 360x640, 375x667 and 667x375 touch screens, and in EVERY pose: the label's rectangle is
   inside the viewport (>= 99.5 %), so is the diamond's, the type is >= 12 px, no more than 5 % of the label is under the
   page's interact button (which stands at the car's height on a short phone: the prompt is lifted clear of it), and, on a
   phone held upright, the car is in front of no more than 2 % of any label (a ray through each of 96 points of the label:
   is the car nearer than the plate? every open prompt is drawn nearer the lens there), and no more than 5 % of any label is
   under the top bar, the touch buttons or the speed readout either: a label too long to stand beside the touch column even at
   its smallest type ('Start the penguin round-up' on 360 px) is lifted above the column and the button, not left under them.
   The acceptance's own spots, and those long labels from the verifier's poses (the car 1 to 2.2 m round the anchor, at the default
   and the fully zoomed-in camera), are read on every upright phone too. Controls: with the fit off (`prompts.fitting = false`) the same measurement MUST find
   clipped labels, and on the short phones labels under the button; with the pull off (`prompts.fitPull = 0`) it MUST find
   the car in front of labels. On the 1440x900 desktop the fit must leave every prompt exactly as authored.

   THE TABLE (SOURCES below). Each area that carries reader labels is one row.
     active: true   asserted: every label of the area must pass the grid
     active: false  PENDING: the owner has not adopted Billboards yet. Its labels are only
                    listed (run with --pending to also measure them, report only). Any label
                    already registered through Billboards.for(driving.ticker) is asserted
                    whatever the row says. To switch an area on, set active: true.
   Adding an area: add a row, then a collector with the same id in COLLECTORS (in page).

   Flags
     --only=prompts,social   limit to some rows
     --pending               also measure the pending rows (report only, never fails)
     --quick                 fewer yaws/elevations (smoke run)
     --no-phone              skip the 390x844 pass
     --no-fit                skip the screen-fit sweeps (section 7)
     --fit-only              only the screen-fit sweeps (section 7, and 5b on the desktop): skips the orbit grid, the drive pass and the legibility pass
     --verbose               print the poses where the car stands in front of a label the fit left as authored
     --phones=390x844,360x640  only these screens in section 7
     --control[=<rev>]       negative control: serves Prompts.js of git <rev> (default HEAD: the static pose,
                             no Billboards) and passes ONLY if the grid then FAILS, proving the test has teeth.
                             Once the billboard change is committed, name the revision before it (HEAD~1).

   QA_BASE=http://localhost:3210 QA_OUT=.qa/runs/impl/labels node scripts/qa/world-labels.mjs */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]
const CONTROL_REV = option('control') ?? (flag('control') ? 'HEAD' : null)
const CONTROL = CONTROL_REV !== null
const QUICK = flag('quick')
const NO_FIT = flag('no-fit')
const FIT_ONLY = flag('fit-only')
const ONLY = option('only')?.split(',')

const INTERACTIONS = 'public/archipelago/preview/portfolio/world2/interactions'

/** One row per area with reader labels. `cap`: the text's cap height in the label's own units, to check legibility on screen. */
const SOURCES = [
  { id: 'prompts', active: true, title: 'interaction prompts (diamond + label), every area', files: ['Prompts'], carLocal: 1.2, cap: { local: 0.37, of: 0.75, minPx: 12 } },
  { id: 'activities', active: true, title: 'activity and race prompts (scene parented)', files: ['Prompts'], carLocal: 1.2, cap: { local: 0.37, of: 0.75, minPx: 12 } },
  // The Social boards are PHYSICAL signs (posts in the ground, a collider): they never turn to follow the camera, so they are judged
  // from the default gameplay camera only (`fixed`) and are not billboards. What floats in the plaza, the four prompts, is in the prompts row.
  { id: 'social', active: true, fixed: true, title: 'Social boards (GitHub, LinkedIn, Email, CV)', files: ['Social'], carMetres: 7, owner: 'social' },
  // A stop's plaque only exists while the car is level with its stone, so the car is put ON the stone (a metre to one side or the other) and
  // given time for the stone to rise and the plaque to wipe in. Its headline is 0.35 m tall: cap height 0.24 m in the plaque's own units.
  { id: 'career', active: true, title: 'Career stop labels (wooden plaques)', files: ['Career'], carMetres: 7, cap: { local: 0.24, minPx: 12 }, owner: 'career-labels', settle: 60 },
  { id: 'places-board', active: true, title: 'behind-the-scenes board', files: ['Places'], carMetres: 7, cap: { local: 0.0946, minPx: 7 }, persistent: true, owner: 'signs-lab' },
  // The plaza's title and four boards are PHYSICAL signs on posts (like Social's): judged from the default gameplay camera, never billboarded.
  // `cap.local`: the numerals' cap height in metres on the boards (the title's lettering is smaller and is checked by world-plaza.mjs).
  { id: 'plaza', active: true, fixed: true, title: 'Achievement Plaza title and group boards', files: ['Achievements', 'AchievementsPlaza'], carMetres: 7, cap: { local: 0.4, minPx: 12 }, owner: 'plaza' },
]
/** No controller may aim a label at the car again: lookAt takes world coordinates and faces the wrong thing. */
const FORBIDDEN = /\.lookAt\(\s*(player|this\.game\.player)/

const results = []
const rows = (id) => SOURCES.find((s) => s.id === id)
const selected = SOURCES.filter((s) => !ONLY || ONLY.includes(s.id))

/* ---- the in-page harness (injected once per page) ------------------------------ */
const HARNESS = async (sources) => {
  const A = globalThis.__archipelago, T = A.THREE
  const { Billboards } = await import('/archipelago/preview/portfolio/world2/interactions/Billboards.js')
  const system = Billboards.for(A.driving.ticker)
  const scale = (inst) => { const v = new T.Vector3(); inst.frame.matrixWorld.decompose(new T.Vector3(), new T.Quaternion(), v); return v.x }
  /** Collectors: one per table row. Each returns { key, obj, gate, carLocal?|carMetres? } for every label of the area. */
  const COLLECTORS = {
    prompts: () => A.gameplay.instances.flatMap((inst, i) => inst.prompts.items.map((it) => ({ key: `${inst.entry.id}#${i}/${it.label}`, obj: it.group, measure: it.labelMesh, gate: () => it.state !== 'hidden', frame: scale(inst) }))),
    activities: () => [['activities', A.activities?.prompts], ['track', A.trackGameplay?.prompts]].flatMap(([name, prompts]) => (prompts?.items ?? []).map((it) => ({ key: `${name}/${it.label}`, obj: it.group, measure: it.labelMesh, gate: () => it.state !== 'hidden', frame: 1 }))),
    social: () => A.gameplay.instances.flatMap((inst, i) => (inst.parts.social?.links ?? []).map((l) => ({ key: `social#${i}/${l.id}`, obj: l.sign, gate: () => true, frame: scale(inst) }))),
    career: () => A.gameplay.instances.flatMap((inst, i) => (inst.parts.career?.lines ?? []).map((l) => ({
      key: `career#${i}/${l.stop?.id ?? l.id}`, obj: l.pivot ?? l.label, gate: () => (l.reveal ?? 1) > 0.3, frame: scale(inst),
      // level with the stone, on the lane's road, a metre either side: the stone rises and its plaque is revealed. Only the shortest stop
      // that covers the car speaks on a lane (a stop inside another's span is shadowed at its own head), so the car is put where this one does.
      carAt: (side) => {
        const lane = inst.parts.career.lines.filter((x) => x.track.id === l.track.id)
        const speaks = (x, z) => { const along = x.origin.z - z; return along > -0.25 && along < x.span + 0.5 }
        let z = l.stoneHome.z - 0.6
        for (let probe = l.stoneHome.z - 0.3; probe > l.stoneHome.z - l.span; probe -= 0.1) {
          const speaker = lane.filter((x) => speaks(x, probe)).sort((a, b) => a.span - b.span)[0]
          if (speaker === l) { z = probe; break }
        }
        return inst.physics.point({ x: l.stoneHome.x + side * 1.0, y: 0.5, z })
      },
    }))),
    // The board is down (hidden, no sign built) until somebody presses its prompt: press it, as a player would, so there is a label to read.
    'places-board': () => A.gameplay.instances.flatMap((inst, i) => { const b = inst.parts.places?.sceneBoard; if (b && !b.shown) inst.prompts.items.find((it) => it.label === 'Behind the scenes')?.onInteract(); return b ? [{ key: `board#${i}/behind-the-scenes`, obj: b.screen.group, gate: () => b.shown, frame: scale(inst) }] : [] }),
    // The boards' painted faces (the title included); the plaza module exists only where the level has the Achievements asset.
    plaza: () => A.gameplay.instances.flatMap((inst, i) => (inst.parts.achievements?.plaza?.signs ?? []).map((sign) => ({ key: `plaza#${i}/${sign.id}`, obj: sign.face, gate: () => true, frame: scale(inst) }))),
  }
  const labels = []
  for (const s of sources) {
    let found = []
    try { found = COLLECTORS[s.id]?.() ?? [] } catch (error) { console.warn(`collector ${s.id} failed: ${error.message}`) }
    for (const l of found) labels.push({ id: `${s.id}:${l.key}`, source: s.id, obj: l.obj, gate: l.gate, frame: l.frame ?? 1, carMetres: s.carLocal ? s.carLocal * (l.frame ?? 1) : s.carMetres ?? 7, cap: s.cap, fixed: !!s.fixed, carAt: l.carAt, measure: l.measure, settle: s.settle ?? 0 })
  }
  // Whatever else registered itself with the system is a label too: it is always asserted.
  for (const it of system.items) if (!labels.some((l) => l.obj === it.object || it.object.getObjectById?.(l.obj.id))) labels.push({ id: `registered:${it.object.name || it.object.uuid.slice(0, 6)}`, source: 'registered', obj: it.object, gate: () => true, frame: 1, carMetres: 7 })
  // A label is registered when it, or an ancestor (a pivot around a plate), is a billboard.
  const registration = (obj) => { for (let a = obj; a; a = a.parent) { const it = system.items.find((x) => x.object === a); if (it) return it } return undefined }
  // A flat plane built lying down (the old Career labels, rotateX(-90deg)) reads along +Y with up -Z: judge it by its geometry.
  const axes = (obj) => {
    const n = obj.geometry?.attributes?.normal
    return n && Math.abs(n.getY(0)) > 0.9 ? { n: new T.Vector3(0, Math.sign(n.getY(0)), 0), up: new T.Vector3(0, 0, -1) } : { n: new T.Vector3(0, 0, 1), up: new T.Vector3(0, 1, 0) }
  }
  const q = new T.Quaternion(), p = new T.Vector3(), n = new T.Vector3(), r = new T.Vector3(), u = new T.Vector3(), c = new T.Vector3(), f = new T.Vector3(), s3 = new T.Vector3()
  const frustum = new T.Frustum(), pv = new T.Matrix4()
  const camRight = new T.Vector3(), camUp = new T.Vector3()
  /** One reading of every label that is visible, active, within 70 m and in the frustum (or of `only`).
   *  `tick`: sampling on the ticker, where the question is "did the system turn it" and not "can a reader see it", so a
   *  prompt that is down (hidden) is read too. */
  const read = (only, tick = false) => {
    const cam = A.camera
    cam.updateMatrixWorld()
    pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pv)
    camRight.set(1, 0, 0).applyQuaternion(cam.quaternion); camUp.set(0, 1, 0).applyQuaternion(cam.quaternion)
    f.set(0, 0, -1).applyQuaternion(cam.quaternion)
    const out = []
    for (const l of labels) {
      if (only && l.id !== only) continue
      const o = l.obj
      let hidden = false; for (let a = o; a; a = a.parent) if (!a.visible) { hidden = true; break }
      if (hidden || (!tick && !l.gate()) || (tick && l.fixed)) continue      // a physical sign is not asked to follow a camera sweep
      o.updateWorldMatrix(true, false)
      o.matrixWorld.decompose(p, q, s3)
      const dist = p.distanceTo(cam.position)
      if (dist > 70 || !frustum.containsPoint(p)) continue
      const ax = axes(o)
      n.copy(ax.n).applyQuaternion(q); r.set(1, 0, 0).applyQuaternion(q); u.copy(ax.up).applyQuaternion(q)
      c.copy(cam.position).sub(p).normalize()
      const reg = registration(o), mode = reg?.mode ?? 'none'
      if (mode === 'sprite') continue          // a THREE.Sprite faces the camera on the GPU: nothing to read off its transform
      const facing = mode === 'none' ? n.dot(c) : -n.dot(f)
      const need = l.fixed ? 0.6 : mode === 'none' ? 0.9 : (tick ? 0.999 : 0.995)
      out.push({ id: l.id, source: l.source, mode, fixed: l.fixed, facing: +facing.toFixed(4), need, right: +r.dot(camRight).toFixed(4), up: +u.dot(camUp).toFixed(4), dist: +dist.toFixed(1), worldScale: +s3.x.toFixed(3) })
    }
    return out
  }
  /** Put the car `distance` m from the label on the camera's side (side 1) or beyond it (-1), aim the camera. */
  const aim = async ({ id, side, theta, phi, distance, zoom }) => {
    const l = labels.find((x) => x.id === id), o = l.obj
    o.updateWorldMatrix(true, false); o.getWorldPosition(p)
    const toward = f.set(Math.sin(theta), 0, Math.cos(theta))
    // a label that only exists while the car is level with something says where the car goes (`carAt`); the rest are read from `carMetres` away
    const at = l.carAt ? l.carAt(side) : p.clone().addScaledVector(toward, side * (distance ?? l.carMetres))
    at.y = A.editor.terrainHeightAt(at.x, at.z) + 1.4
    A.driving.place({ position: at, rotation: 0 }, { reason: 'spawn' })
    const v = A.driving.view, sph = v.spherical
    sph.targetTheta = sph.theta = theta; sph.targetPhi = sph.phi = phi
    if (zoom !== undefined) { v.zoom.baseRatio = v.zoom.smoothedRatio = v.zoom.ratio = zoom }
    settle(v)
    if (l.settle) await frames(l.settle)
  }
  /** snapToTarget() restarts the obstruction easing from 1 m (the camera would crawl out for a second): seed it open, as Driving.restoreCarCamera does. */
  const settle = (v) => { v.snapToTarget(); v.smoothedObstruction = Infinity; v.update() }
  const setPhi = (theta, phi) => { const v = A.driving.view, sph = v.spherical; sph.targetTheta = sph.theta = theta; sph.targetPhi = sph.phi = phi; settle(v) }
  const frames = (k) => new Promise((resolve) => { const step = () => (--k <= 0 ? resolve() : requestAnimationFrame(step)); requestAnimationFrame(step) })
  /** A mesh as the camera sees it: the rectangle of `pts` (local x,y pairs; default the corners of its geometry's box) in CSS px of the canvas. */
  const corner = new T.Vector3()
  const rectOf = (mesh, pts) => {
    const cv = A.renderer.domElement.getBoundingClientRect()
    mesh.updateWorldMatrix(true, false)
    if (!pts) { const bb = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox); pts = [[bb.min.x, bb.min.y], [bb.max.x, bb.min.y], [bb.min.x, bb.max.y], [bb.max.x, bb.max.y]] }
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9
    for (const [x, y] of pts) {
      corner.set(x, y, 0).applyMatrix4(mesh.matrixWorld).project(A.camera)
      const sx = (corner.x * 0.5 + 0.5) * cv.width, sy = (-corner.y * 0.5 + 0.5) * cv.height
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    return { x0, x1, y0, y1, width: cv.width, height: cv.height }
  }
  /** The share of a rectangle that is inside the canvas. */
  const shareOf = (r) => {
    const w = r.x1 - r.x0, h = r.y1 - r.y0
    return Math.max(0, Math.min(r.x1, r.width) - Math.max(r.x0, 0)) * Math.max(0, Math.min(r.y1, r.height) - Math.max(r.y0, 0)) / (w * h)
  }
  /** How much of a rectangle the page's own controls cover (the top bar, the touch column, the interact button, the speed readout). */
  const HUD = ['#player-nav', '#touch-controls', '#interact-action', '#drive-hud']
  const hudCover = (r) => {
    const cv = A.renderer.domElement.getBoundingClientRect(), area = (r.x1 - r.x0) * (r.y1 - r.y0), cover = {}
    for (const sel of HUD) {
      const b = document.querySelector(sel)?.getBoundingClientRect()
      if (!b || !b.width || !b.height) continue
      const w = Math.min(r.x1, b.right - cv.left) - Math.max(r.x0, b.left - cv.left), h = Math.min(r.y1, b.bottom - cv.top) - Math.max(r.y0, b.top - cv.top)
      if (w > 0 && h > 0) cover[sel] = +(w * h / area).toFixed(3)
    }
    return cover
  }
  /** Every prompt of the world (the areas', the activities', the race track's) with the Prompts that owns it. */
  const pulls = new Map()
  const prompts = () => [
    ...A.gameplay.instances.flatMap((inst, i) => inst.prompts.items.map((it) => ({ key: `${inst.entry.id}#${i}/${it.label}`, owner: inst.prompts, it }))),
    ...[['activities', A.activities?.prompts], ['track', A.trackGameplay?.prompts]].flatMap(([name, pr]) => (pr?.items ?? []).map((it) => ({ key: `${name}/${it.label}`, owner: pr, it }))),
  ]
  /** Park the car `ox`, `oz` metres from the prompt's anchor (any `y`), the camera at its default pose and `zoom`, and let the prompt open and settle. */
  const pose = async (P, ox, oz, zoom) => {
    P.it.group.updateWorldMatrix(true, false); P.it.group.getWorldPosition(p)
    const at = p.clone(); at.x += ox; at.z += oz; at.y = A.editor.terrainHeightAt(at.x, at.z) + 1.4
    A.driving.place({ position: at, rotation: 0 }, { reason: 'spawn' })
    const v = A.driving.view, sph = v.spherical
    sph.targetTheta = sph.theta = Math.PI / 4; sph.targetPhi = sph.phi = 0.27 * Math.PI
    v.zoom.baseRatio = v.zoom.smoothedRatio = v.zoom.ratio = zoom
    settle(v)
    await frames(14)                       // the swap of a label's side takes ~0.2 s
    for (let i = 0; i < 40 && P.it.left !== 0 && P.it.left !== 1; i++) await frames(1)     // the dropped car has landed and the camera has settled
    // The prompt itself has come to rest: the car lands for a dozen frames and the lift over the controls glides after the label as it moves,
    // so a reading taken in the first frames is of a label still on its way. Rest is its fit state unchanged for 4 frames in a row.
    for (let i = 0, last = '', still = 0; i < 90 && still < 4; i++) {
      await frames(1)
      const now = `${P.it.lift.toFixed(4)}|${P.it.swap.toFixed(4)}|${P.it.pull.toFixed(4)}|${P.it.left}`
      still = now === last ? still + 1 : 0
      last = now
    }
    // A car the physics threw (dropped into a prop: the clock beside the lap board) is not parked round the prompt: that pose asks nothing.
    const car = A.driving.vehicle.position
    if (Math.hypot(car.x - at.x, car.z - at.z) > 0.8) return false
    return P.owner.activeLabel === P.it.label && P.it.state === 'open'
  }
  /** The share of a label's plate (96 sample points inside the picture) that the car stands in front of: by depth along each point's own ray, no screenshot. */
  const rc = new T.Raycaster(), plateAt = new T.Plane(), plateNormal = new T.Vector3(), plateCentre = new T.Vector3(), ndc = new T.Vector2()
  const carFront = (it) => {
    const m = it.labelMesh, e = (m.updateWorldMatrix(true, false), m.matrixWorld.elements), r = rectOf(m)
    plateAt.setFromNormalAndCoplanarPoint(plateNormal.set(e[8], e[9], e[10]).normalize(), plateCentre.set(e[12], e[13], e[14]))
    const meshes = []
    A.driving.visual.group.traverse((o) => { if (!o.isMesh || o.material?.transparent) return; for (let a = o; a; a = a.parent) if (!a.visible) return; meshes.push(o) })
    let front = 0, total = 0
    for (let i = 0; i < 24; i++) for (let j = 0; j < 4; j++) {
      const sx = r.x0 + (i + 0.5) / 24 * (r.x1 - r.x0), sy = r.y0 + (j + 0.5) / 4 * (r.y1 - r.y0)
      if (sx < 0 || sx > r.width || sy < 0 || sy > r.height) continue
      rc.setFromCamera(ndc.set(sx / r.width * 2 - 1, 1 - sy / r.height * 2), A.camera)
      const t = rc.ray.distanceToPlane(plateAt)
      if (t === null) continue
      total++
      const hit = rc.intersectObjects(meshes, false)[0]
      if (hit && hit.distance < t - 0.02) front++
    }
    return total ? front / total : 0
  }
  /** What the reader of an open prompt gets: where its label and diamond are on the screen, how big the type is, what the fit did. */
  const measure = (P) => {
    const it = P.it, label = rectOf(it.labelMesh), diamond = rectOf(it.diamond, [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]])
    const f = it.fit, own = it.align === 'right' ? 1 : 0
    return {
      share: +shareOf(label).toFixed(4), diamond: +shareOf(diamond).toFixed(4), capPx: +((label.y1 - label.y0) * 0.37 / 0.75).toFixed(1),
      rect: [label.x0, label.y0, label.x1, label.y1].map(Math.round), viewport: [label.width, label.height],
      // moved: by more than a hair (a label a pixel past the 10 px margin slides a thousandth of a unit and is not pulled)
      moved: Math.abs(f.position.x) + Math.abs(f.position.y) + Math.abs(f.position.z) > 0.02 || Math.abs(f.scale.x - 1) > 0.002 || it.left !== own,
      shift: +f.position.x.toFixed(3), scale: +f.scale.x.toFixed(3), left: it.left, flipped: it.flipped, pull: +it.pull.toFixed(2), hud: hudCover(label), carFront: +carFront(it).toFixed(3),
    }
  }
  /** Projected box of the label (CSS px) and its on-screen cap height, when the source says how tall its text is. */
  const project = (id) => {
    const l = labels.find((x) => x.id === id), o = l.obj, cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect()
    // The visible meshes' own corners (a Box3 of the whole subtree is the AABB of a tilted plane: far larger than what is seen).
    o.updateWorldMatrix(true, true)
    const xs = [], ys = [], corner = new T.Vector3()
    o.traverse((m) => {
      if (!m.isMesh) return
      for (let a = m; a; a = a.parent) if (!a.visible) return
      const bb = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox)
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        corner.set(x, y, z).applyMatrix4(m.matrixWorld).project(cam)
        xs.push((corner.x * 0.5 + 0.5) * cv.width + cv.left); ys.push((-corner.y * 0.5 + 0.5) * cv.height + cv.top)
      }
    })
    if (!xs.length) { xs.push(cv.width / 2); ys.push(cv.height / 2) }
    o.updateWorldMatrix(true, false); o.matrixWorld.decompose(p, q, s3)
    const pxPerMetre = cv.height / (2 * p.distanceTo(cam.position) * Math.tan(cam.fov * Math.PI / 360))
    // A prompt's type is measured on the label as it stands (the screen fit may have shrunk it); the rest on the group's own scale.
    let capPx = l.cap ? l.cap.local * s3.x * pxPerMetre : null
    if (l.measure && l.cap?.of) { const r = rectOf(l.measure); capPx = (r.y1 - r.y0) * l.cap.local / l.cap.of }
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), capPx: capPx === null ? null : +capPx.toFixed(1), cssWidth: cv.width, cssHeight: cv.height, radius: A.driving.view.spherical.radius.current }
  }
  // Tick-synchronous sampler at order 99: after the camera (7) and the billboards (21).
  const ticks = { on: false, n: 0, rows: 0, worst: {}, mirrored: 0 }
  A.driving.ticker.events.on('tick', () => {
    if (!ticks.on) return
    for (const row of read(null, true)) {
      const w = (ticks.worst[row.id] ??= { facing: 1, right: 1, need: row.need })
      w.facing = Math.min(w.facing, row.facing); w.right = Math.min(w.right, row.right)
      if (row.right < 0) ticks.mirrored++
      ticks.rows++
    }
    ticks.n++
  }, 99)
  window.__labels = {
    ids: () => labels.map((l) => ({ id: l.id, source: l.source, fixed: l.fixed, carMetres: l.carMetres, registered: !!registration(l.obj), mode: registration(l.obj)?.mode ?? 'none', cap: l.cap ?? null })),
    read, aim, setPhi, project, frames,
    prompts: () => prompts().map((P) => P.key),
    /** Park the car round prompt `key`; returns whether it opened, and what the reader gets. */
    pose: async (key, ox, oz, zoom) => { const P = prompts().find((x) => x.key === key); const open = await pose(P, ox, oz, zoom); return { key, open, ...(open ? measure(P) : {}) } },
    /** Every prompt from every offset at every zoom, in one go. */
    sweep: async ({ offsets, zooms }) => {
      const rows = []
      for (const P of prompts()) for (const zoom of zooms) for (const [ox, oz] of offsets) {
        const open = await pose(P, ox, oz, zoom)
        rows.push({ key: P.key, zoom, ox, oz, open, ...(open ? measure(P) : {}) })
      }
      return rows
    },
    /** The acceptance's own spots: the car put at world x, z facing `deg`; returns what the open prompt gives a reader (null: none opened). */
    spot: async ({ x, z, deg }) => {
      const d = A.driving, a = deg * Math.PI / 180, heading = Math.atan2(-Math.sin(a), Math.cos(a))
      let pose = d.placement.check(x, z, heading, { dynamicMargin: 0.1 })
      if (!pose.ok) pose = d.placement.near?.(x, z, { radius: 6, step: 1, prefer: [{ heading, weight: 1 }], dynamicMargin: 0.1 }) ?? pose
      if (!pose.ok) return null
      d.place(pose, { reason: 'travel' })
      await frames(70)
      const P = prompts().find((q) => q.owner.activeLabel === q.it.label && q.it.state === 'open')
      return P ? { key: P.key, label: P.it.label, ...measure(P) } : null
    },
    /** What one frame of the screen fit costs for the open prompt of `key` (ms, best of five runs of 2000), in the real runtime. */
    fitCost: async (key) => {
      const P = prompts().find((x) => x.key === key)
      if (!await pose(P, 0.3, 0, 0.6)) return null
      let ms = 1e9
      for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 2000; i++) P.owner.fit(); ms = Math.min(ms, (performance.now() - t0) / 2000) }
      return { ms, engaged: P.it.pull }
    },
    fitting: (on) => { const all = new Set(prompts().map((P) => P.owner)); for (const owner of all) owner.fitting = on; return all.size },
    /** Set how far nearer the lens a moved prompt is drawn (null: back to what it was). */
    fitPull: (metres) => { for (const owner of new Set(prompts().map((P) => P.owner))) { if (!pulls.has(owner)) pulls.set(owner, owner.fitPull); owner.fitPull = metres ?? pulls.get(owner) } },
    /** The hardware pixels of the page's controls, for a touch screen: the page shows them only for a finger. */
    touch: () => { document.body.dataset.input = 'touch'; document.body.classList.add('driving') },
    ticks: (on) => { if (on) Object.assign(ticks, { on: true, n: 0, rows: 0, worst: {}, mirrored: 0 }); else ticks.on = false; return ticks },
    /** Run the system BEFORE the camera (order 6) to prove the sampler sees a one-frame lag; restore with lag(false). */
    lag: (on) => { A.driving.ticker.events.off('tick', system.tick); A.driving.ticker.events.on('tick', system.tick, on ? 6 : 21) },
    neighbours: () => labels.map((l) => { l.obj.getWorldPosition(p); return { id: l.id, near: labels.filter((m) => m !== l && m.obj.getWorldPosition(c).distanceTo(p) < 25).length } }).sort((a, b) => b.near - a.near),
    cost: () => { let ms = 1e9; for (let r = 0; r < 5; r++) { const t0 = performance.now(); for (let i = 0; i < 2000; i++) { system.seenValid = false; system.update() } ms = Math.min(ms, (performance.now() - t0) / 2000) } return { items: system.items.length, ms } },
    guard: () => {
      const title = A.gameplay.instances.find((i) => i.parts.title)?.parts.title
      const under = title ? system.items.filter((it) => { for (let a = it.object; a; a = a.parent) if (a === title.group) return true; return false }).length : 0
      return { title: !!title, billboardsUnderTitle: under, items: system.items.map((it) => ({ name: it.object.name || it.object.type, mode: it.mode })).length }
    },
  }
}

/* ---- helpers -------------------------------------------------------------------- */
const deg = Math.PI / 180
const THETAS = (QUICK ? [45, 225] : [45, 135, 225, 315]).map((d) => d * deg)
const PHIS = QUICK ? [0.27 * Math.PI, 0.06 * Math.PI] : [0.27 * Math.PI, 0.06 * Math.PI, 0.43 * Math.PI]
/** Where the car is parked round a prompt's anchor (world metres: x, z): near it, and a metre away on the compass's eight points (the prompt opens inside 2.5 m of its own frame). */
const OFFSETS = [[0.3, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.9, 0.9], [-0.9, 0.9], [0.9, -0.9], [-0.9, -0.9]]
const slug = (id) => id.replace(/[^\w]+/g, '-').toLowerCase()
// A physical sign (`fixed`) is a vertical board seen from 41 deg above: it must face the lens (>= 0.6) and read un-mirrored, but is not asked to be upright on the screen.
const bad = (row) => (row.fixed ? row.facing < row.need || row.right < 0.9 : row.facing < row.need || row.right < 0.98 || row.up < 0.9)

async function openHarness(browser, context, label) {
  const page = await browser.newPage(context)
  const errors = watch(page, label)
  if (CONTROL) {
    // The unmodified Prompts: static authored pose, no Billboards import. Everything else is the current code.
    const head = execFileSync('git', ['show', `${CONTROL_REV}:${INTERACTIONS}/Prompts.js`], { encoding: 'utf8', maxBuffer: 1 << 24 })
    if (/Billboards/.test(head)) throw new Error(`--control: Prompts.js at ${CONTROL_REV} already uses Billboards; name an earlier revision`)
    await page.route('**/world2/interactions/Prompts.js*', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: head }))
  }
  await openPlayer(page)
  await sleep(1500)
  await page.evaluate(HARNESS, selected.map(({ id, carLocal, carMetres, cap, fixed }) => ({ id, carLocal, carMetres, cap, fixed })))
  return { page, errors }
}

/** Runs the grid of a set of labels; returns the bad rows and the number of readings. */
async function grid(page, labels, { screenshots, mode }) {
  const failures = []
  let readings = 0
  for (const { id } of labels) {
    let shot = 0
    const fixed = !!inventory.find((l) => l.id === id)?.fixed
    for (const side of [1, -1]) for (const theta of fixed ? THETAS.slice(0, 1) : THETAS) {
      await page.evaluate((a) => window.__labels.aim(a), { id, side, theta, phi: PHIS[0] })
      for (const phi of fixed ? PHIS.slice(0, 1) : PHIS) {
        if (phi !== PHIS[0]) await page.evaluate(([t, ph]) => window.__labels.setPhi(t, ph), [theta, phi])
        await page.evaluate(() => window.__labels.frames(3))
        const got = await page.evaluate((id) => window.__labels.read(id), id)
        for (const row of got) {
          readings++
          if (bad(row)) failures.push({ ...row, side, yaw: Math.round(theta / deg), phi: +(phi / Math.PI).toFixed(2) })
        }
        if (screenshots && got.length && shot < 2 && Math.abs(theta - 45 * deg) < 1e-6 && Math.abs(phi - 0.27 * Math.PI) < 1e-6) {
          shot++
          await sleep(1800)                         // the prompt's reveal (diamond pops, label wipes in) takes ~1.5 s
          const box = await page.evaluate((id) => window.__labels.project(id), id)
          const pad = 90, vw = box.cssWidth, vh = box.cssHeight
          const x = Math.max(0, box.x - pad), y = Math.max(0, box.y - pad)
          await page.screenshot({ path: out(`label-${mode}-${slug(id)}-side${side}.png`), clip: { x, y, width: Math.max(40, Math.min(vw - x, box.w + pad * 2)), height: Math.max(40, Math.min(vh - y, box.h + pad * 2)) } })
        }
      }
    }
  }
  return { failures, readings }
}

/* ===================================================================================== */
const browser = await launch()
const desktop = await openHarness(browser, { viewport: { width: 1440, height: 900 } }, '')
const { page, errors } = desktop

/* ---- 0. static guard ------------------------------------------------------------- */
for (const s of selected) {
  const clean = s.files.every((f) => fs.existsSync(`${INTERACTIONS}/${f}.js`) ? !FORBIDDEN.test(fs.readFileSync(`${INTERACTIONS}/${f}.js`, 'utf8')) : true)
  if (s.active) assert(clean, `${s.id}: no lookAt(player) in ${s.files.join(', ')} (faces the car, not the camera)`, results)
  else console.log(`${clean ? 'ok     ' : 'PENDING'} ${s.id}: ${clean ? 'no lookAt(player)' : `lookAt(player) still in ${s.files.join(', ')} (${s.owner})`}`)
}

/* ---- 1. inventory ---------------------------------------------------------------- */
const inventory = await page.evaluate(() => window.__labels.ids())
const bySource = (id) => inventory.filter((l) => l.source === id)
for (const s of selected) {
  const list = bySource(s.id)
  console.log(`${s.active ? 'ACTIVE ' : 'PENDING'} ${s.id.padEnd(13)} ${String(list.length).padStart(3)} labels, ${list.filter((l) => l.registered).length} registered  (${s.title})`)
}
const extra = bySource('registered')
if (extra.length) console.log(`        registered elsewhere: ${extra.length} (${extra.map((l) => l.id).join(', ')})`)
for (const s of selected.filter((x) => x.active)) {
  assert(bySource(s.id).length > 0, `${s.id}: the area's labels were found (${bySource(s.id).length})`, results)
}
// Asserted: every label of an active row, and any label that is a billboard already (a pending row's owner has started adopting).
const asserted = inventory.filter((l) => rows(l.source)?.active || l.registered)
const ofActive = asserted.filter((l) => rows(l.source)?.active && !rows(l.source)?.fixed)
const registered = ofActive.filter((l) => l.registered && l.mode === 'spherical').length
if (!CONTROL) assert(ofActive.length > 0 && registered === ofActive.length, `every label of an active row is a registered spherical billboard (${registered}/${ofActive.length})`, results)
else assert(registered < ofActive.length, `control: the old Prompts are not registered (${registered}/${ofActive.length})`, results)

if (!FIT_ONLY) {
  /* ---- 2. orbit grid ----------------------------------------------------------------- */
  const t0 = Date.now()
  const main = await grid(page, asserted, { screenshots: true, mode: CONTROL ? 'control' : 'grid' })
  console.log(`${main.readings} label readings over ${asserted.length} labels in ${((Date.now() - t0) / 1000).toFixed(0)} s`)
  if (main.failures.length) console.table(main.failures.slice(0, 12))
  const possible = asserted.reduce((n, l) => n + (l.fixed ? 2 : 2 * THETAS.length * PHIS.length), 0)
  assert(main.readings >= possible * 0.6, `the grid actually saw its labels (${main.readings} readings of ${possible} poses)`, results)
  if (CONTROL) {
    const worst = main.failures.reduce((m, r) => Math.min(m, r.facing), 1)
    assert(main.failures.length > 0, `control: the unmodified Prompts FAIL the grid (${main.failures.length}/${main.readings} bad readings, worst facing ${worst})`, results)
  } else {
    const worst = main.failures.reduce((m, r) => Math.min(m, r.facing), 1)
    assert(main.failures.length === 0, `no label ever reads sideways, backwards, mirrored or rotated across ${main.readings} readings (${main.failures.length} bad, worst facing ${worst})`, results)
  }

  /* ---- 2b. pending rows: measured, never fail ----------------------------------------- */
  if (flag('pending')) {
    for (const s of selected.filter((x) => !x.active)) {
      const list = inventory.filter((l) => l.source === s.id && !l.registered)
      if (!list.length) { console.log(`PENDING ${s.id}: no unregistered labels to measure (${bySource(s.id).length} found)`); continue }
      const r = await grid(page, list, { screenshots: true, mode: `pending-${s.id}` })
      const worst = r.failures.reduce((m, row) => Math.min(m, row.facing), 1)
      console.log(`PENDING ${s.id}: ${r.failures.length}/${r.readings} bad readings today (worst facing ${worst}) — owner: ${s.owner}`)
    }
  }

  /* ---- 3. drive pass: tick-synchronous, no frame of lag --------------------------------- */
  if (!CONTROL) {
    const neighbours = await page.evaluate(() => window.__labels.neighbours())
    // A label that can actually be read from where the car stands (a prompt is only up near its post, a board only while it is shown, and a
    // 12 m car puts a tall board over the top of the frame, so a nearer car is tried too). The ones that do not depend on the car's
    // position (boards, plates) come first: a prompt leaves the scene as the car drives away from it.
    const readable = []
    for (const l of neighbours.filter((n) => asserted.some((a) => a.id === n.id))) {
      for (const distance of [12, 7]) {
        await page.evaluate((a) => window.__labels.aim(a), { id: l.id, side: 1, theta: Math.PI / 4, phi: 0.27 * Math.PI, distance })
        await sleep(300)
        if ((await page.evaluate((id) => window.__labels.read(id, true), l.id)).length) { readable.push({ ...l, distance }); break }
      }
    }
    // `persistent: true` on a row: its label stays up wherever the car is (a board that has been shown), so a drive past it keeps being read.
    const persistent = (l) => !!rows(l.id.split(':')[0])?.persistent
    const sample = readable.find(persistent) ?? readable.find((l) => !/^(prompts|activities|career):/.test(l.id)) ?? readable[0] ?? { ...neighbours.find((l) => asserted.some((a) => a.id === l.id)), distance: 12 }
    await page.evaluate((a) => window.__labels.aim(a), { id: sample.id, side: 1, theta: Math.PI / 4, phi: 0.27 * Math.PI, distance: sample.distance })
    await sleep(600)
    await page.evaluate(() => window.__labels.ticks(true))
    // Hold W+D and orbit WHILE rolling: the camera yaw sweeps 360 deg within ~2 s (View damps theta at 12/s, so the first
    // frames turn ~70 deg each), then the other way once the keys are up and the car coasts.
    await page.keyboard.down('KeyW'); await page.keyboard.down('KeyD')
    await sleep(900)
    await page.evaluate(() => { globalThis.__archipelago.driving.view.spherical.targetTheta += Math.PI * 2 })
    await sleep(1600)
    await page.keyboard.up('KeyW'); await page.keyboard.up('KeyD')
    await page.evaluate(() => { globalThis.__archipelago.driving.view.spherical.targetTheta -= Math.PI * 2 })
    await sleep(2000)
    const ticks = await page.evaluate(() => window.__labels.ticks(false))
    const worst = Object.entries(ticks.worst).sort((a, b) => a[1].facing - b[1].facing)[0]
    console.log(`drive pass around ${sample.id}: ${ticks.n} ticks, ${ticks.rows} label readings, ${Object.keys(ticks.worst).length} labels`)
    assert(ticks.n > 150 && ticks.rows > 200, `sampled ${ticks.n} ticks / ${ticks.rows} readings while driving and orbiting`, results)
    assert(!worst || worst[1].facing >= worst[1].need, `no label was ever off the camera by one frame (worst ${worst?.[0]} facing ${worst?.[1].facing})`, results)
    assert(ticks.mirrored === 0, 'no label was ever mirrored while driving and orbiting', results)

    // Control for the sampler itself: run the billboards BEFORE the camera and the same orbit must show the lag.
    await page.evaluate(() => window.__labels.lag(true))
    await page.evaluate((a) => window.__labels.aim(a), { id: sample.id, side: 1, theta: Math.PI / 4, phi: 0.27 * Math.PI, distance: sample.distance })
    await sleep(500)
    await page.evaluate(() => window.__labels.ticks(true))
    await page.evaluate(() => { globalThis.__archipelago.driving.view.spherical.targetTheta += Math.PI * 2 })
    await sleep(1500)
    const lagged = await page.evaluate(() => { const t = window.__labels.ticks(false); window.__labels.lag(false); return t })
    const lagWorst = Object.values(lagged.worst).reduce((m, w) => Math.min(m, w.facing), 1)
    assert(lagWorst < 0.9, `control: the sampler sees a one-frame lag when the system runs before the camera (worst facing ${lagWorst})`, results)
  }
}

/* ---- 4. decorative / physical text must NOT have been touched --------------------------- */
const guard = await page.evaluate(() => window.__labels.guard())
assert(guard.billboardsUnderTitle === 0, `the Title letters are not billboards (decorative; ${guard.title ? 'found' : 'no Title instance'})`, results)

/* ---- 5. cost ------------------------------------------------------------------------- */
const cost = await page.evaluate(() => window.__labels.cost())
assert(cost.ms < 0.05, `${cost.items} billboards cost ${(cost.ms * 1000).toFixed(1)} us per tick, worst case (camera moving every tick; budget 50 us)`, results)

/* ---- 5b. desktop: where the prompt fits, the fit leaves it exactly as authored ------------------------ */
if (!NO_FIT && !CONTROL) {
  const rowsDesk = await page.evaluate((a) => window.__labels.sweep(a), { offsets: OFFSETS.slice(0, 5), zooms: [0.6, 0] })
  const opened = rowsDesk.filter((r) => r.open)
  const touched = opened.filter((r) => r.moved)
  const clipped = opened.filter((r) => r.share < 0.995 || r.diamond < 0.98)
  console.log(`desktop 1440x900: ${opened.length}/${rowsDesk.length} poses opened a prompt, ${touched.length} moved by the fit, ${clipped.length} clipped`)
  if (touched.length) console.table(touched.slice(0, 6).map(({ key, zoom, ox, oz, shift, scale, left, flipped, pull }) => ({ key, zoom, ox, oz, shift, scale, left, flipped, pull })))
  assert(opened.length >= 15, `desktop: the sweep opened prompts (${opened.length} poses)`, results)
  assert(touched.length === 0, `desktop: the screen fit leaves every prompt exactly as authored (${touched.length} of ${opened.length} moved)`, results)
  assert(clipped.length === 0, `desktop: no label or diamond is cut by the screen (${clipped.length} of ${opened.length})`, results)
}

assert(errors.length === 0, `no console errors on desktop (${errors.slice(0, 2).join(' | ')})`, results)
await page.close()

/* ---- 6. phone: 390x844 touch ----------------------------------------------------------- */
if (!flag('no-phone') && !CONTROL && !FIT_ONLY) {
  const phone = await openHarness(browser, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'phone ')
  const list = await phone.page.evaluate(() => window.__labels.ids())
  const phoneLabels = list.filter((l) => rows(l.source)?.active || l.registered)
  const legible = []
  const grid2 = []
  let shots = 0
  for (const { id, cap } of phoneLabels) {
    for (const zoom of [0.6, 0]) {                // the default zoom and fully zoomed out (a phone sits 31 m / 56 m away)
      await phone.page.evaluate((a) => window.__labels.aim(a), { id, side: 1, theta: Math.PI / 4, phi: 0.27 * Math.PI, zoom })
      await phone.page.evaluate(() => window.__labels.frames(4))
      const got = await phone.page.evaluate((id) => window.__labels.read(id), id)
      if (!got.length) continue
      for (const row of got) if (bad(row)) grid2.push({ ...row, zoom })
      const box = await phone.page.evaluate((id) => window.__labels.project(id), id)
      if (cap && box.capPx !== null) legible.push({ id, zoom, capPx: box.capPx, minPx: cap.minPx, radius: +box.radius.toFixed(1), worldScale: got[0].worldScale })
      if (shots < 12 && zoom === 0.6) {
        shots++
        await sleep(1800)                           // let the prompt finish revealing
        const shot = await phone.page.evaluate((id) => window.__labels.project(id), id)
        const pad = 70, x = Math.max(0, shot.x - pad), y = Math.max(0, shot.y - pad)
        await phone.page.screenshot({ path: out(`phone-${slug(id)}.png`), clip: { x, y, width: Math.max(40, Math.min(390 - x, shot.w + pad * 2)), height: Math.max(40, Math.min(844 - y, shot.h + pad * 2)) } })
      }
    }
  }
  const tooSmall = legible.filter((l) => l.capPx < l.minPx)
  const min = (zoom) => legible.filter((l) => l.zoom === zoom).reduce((m, l) => Math.min(m, l.capPx), 1e9)
  const radii = (zoom) => { const r = legible.filter((l) => l.zoom === zoom).map((l) => l.radius); return `${Math.min(...r)}-${Math.max(...r)} m` }
  console.log(`phone 390x844: ${legible.length} text readings; smallest cap height ${min(0.6)} px at the default zoom (camera ${radii(0.6)} away), ${min(0)} px fully zoomed out (camera ${radii(0)} away)`)
  if (tooSmall.length) console.table(tooSmall.slice(0, 10))
  assert(legible.length > 0, `the phone pass measured text (${legible.length} readings)`, results)
  assert(tooSmall.length === 0, `label text stays >= 12 px tall on a 390x844 phone, at the default and the fully zoomed-out camera`, results)
  assert(grid2.length === 0, `labels face the camera on the phone camera too (${grid2.length} bad)`, results)
  assert(phone.errors.length === 0, `no console errors on the phone (${phone.errors.slice(0, 2).join(' | ')})`, results)
}

/* ---- 7. phones: every open prompt is inside the screen, readable, clear of the interact button, and not behind the car --------------- */
const portrait = (ph) => ph.viewport.width < 600 && ph.viewport.height > ph.viewport.width        // a phone held upright
const PHONES = [
  { name: '390x844', viewport: { width: 390, height: 844 }, zooms: [0.6, 0] },
  { name: '360x640', viewport: { width: 360, height: 640 }, zooms: [0.6, 0] },
  { name: '375x667', viewport: { width: 375, height: 667 }, zooms: [0.6] },
  { name: '667x375 (landscape)', viewport: { width: 667, height: 375 }, zooms: [0.6] },
  { name: '834x1112 (tablet)', viewport: { width: 834, height: 1112 }, zooms: [0.6] },
]
// The prompts a phone reader meets first: where the acceptance found them cut (a spot is the car's own position and heading).
const SPOTS = [
  { label: 'Behind the scenes', x: -95, z: -21, deg: 135 }, { label: 'Next experiment', x: 78.8, z: 3, deg: 135 }, { label: 'Take a cookie', x: -15.5, z: 13.1, deg: 45 },
  { label: 'Achievements', x: 85, z: 130.7, deg: 135 }, { label: 'Projects', x: 95.8, z: 19.2, deg: 135 }, { label: 'GitHub', x: 25, z: 47.7, deg: -135 },
  // The verifier's: the anchor is (91.5, 65.5); the car 2.2 m north of it, the label as long as the screen and the touch column in its way (25 % under it).
  { label: 'Start the penguin round-up', x: 91.5, z: 63.3, deg: 135 },
]
// The long labels (a 360 px screen has no room beside the touch column for them even at 12.5 px type): from where the car stands the label hangs
// across the column and the interact button. `[ox, oz]` metres from the anchor, at the default camera (0.6) and fully zoomed in (1).
const LONG_LABELS = ['Start the penguin round-up', 'Start the infield slalom']
const LONG_OFFSETS = [[0, -2.2], [-0.9, -0.9], [-2.2, 0], [-1, 0], [0, -1], [2.2, 0], [0, 2.2], [0.9, 0.9]]
const LONG_ZOOMS = [0.6, 1]
if (!NO_FIT && !flag('no-phone') && !CONTROL) {
  for (const ph of PHONES.filter((x) => !option('phones') || option('phones').split(',').includes(x.name.split(' ')[0]))) {
    const tag = ph.name
    const { page: fp, errors: fitErrors } = await openHarness(browser, { viewport: ph.viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, `${tag} `)
    await fp.evaluate(() => window.__labels.touch())
    const offsets = QUICK ? OFFSETS.slice(0, 5) : OFFSETS
    const rows = await fp.evaluate((a) => window.__labels.sweep(a), { offsets, zooms: ph.zooms })
    const opened = rows.filter((r) => r.open)
    const keys = new Set(opened.map((r) => r.key)), all = new Set(rows.map((r) => r.key))
    const clipped = opened.filter((r) => r.share < 0.995 || r.diamond < 0.98)
    const moved = opened.filter((r) => r.moved)
    const covers = {}
    for (const r of opened) for (const [sel, v] of Object.entries(r.hud)) covers[sel] = Math.max(covers[sel] ?? 0, v)
    console.log(`${tag}: ${opened.length}/${rows.length} poses opened one of ${keys.size}/${all.size} prompts; fit moved ${moved.length}; flipped ${opened.filter((r) => r.flipped).length}; shrunk ${opened.filter((r) => r.scale < 0.999 && r.pull > 0).length}; smallest cap ${Math.min(...opened.map((r) => r.capPx))} px; worst label share ${Math.min(...opened.map((r) => r.share))}; HUD cover ${JSON.stringify(covers)}`)
    if (flag('verbose')) console.table(opened.filter((r) => Object.entries(r.hud).some(([sel, v]) => sel !== '#interact-action' && v > 0.05)).sort((a, b) => Math.max(...Object.values(b.hud)) - Math.max(...Object.values(a.hud))).slice(0, 12).map(({ key, zoom, ox, oz, hud, rect, moved }) => ({ key, zoom, ox, oz, hud: JSON.stringify(hud), rect: rect.join(','), moved })))
    if (clipped.length) console.table(clipped.slice(0, 10).map(({ key, zoom, ox, oz, share, diamond, rect, shift, scale, left, flipped }) => ({ key, zoom, ox, oz, share, diamond, rect: rect.join(','), shift, scale, left, flipped })))
    assert(keys.size >= 10 && keys.size >= all.size * 0.6, `${tag}: the sweep opened most prompts (${keys.size} of ${all.size}, ${opened.length} poses)`, results)
    assert(clipped.length === 0, `${tag}: every open prompt's label and diamond are inside the screen in all ${opened.length} poses (${clipped.length} cut; worst label share ${Math.min(...opened.map((r) => r.share))})`, results)
    assert(!(covers['#player-nav'] > 0), `${tag}: no label runs under the top bar (${covers['#player-nav'] ?? 0})`, results)
    // The interact button says what the label says, but it stands on top of the label on a short phone (the car is at its height) and
    // the label read 'Tak': the prompt is lifted clear of it. At most a hair of a label (5 %) may be under it, in any pose.
    const underButton = opened.filter((r) => (r.hud['#interact-action'] ?? 0) > 0.05)
    if (underButton.length) console.table(underButton.slice(0, 10).map(({ key, zoom, ox, oz, hud, rect, shift, scale, pull }) => ({ key, zoom, ox, oz, hud: JSON.stringify(hud), rect: rect.join(','), shift, scale, pull })))
    assert(underButton.length === 0, `${tag}: no label has more than 5 % of itself under the interact button, in ${opened.length} poses (${underButton.length} do; worst ${((covers['#interact-action'] ?? 0) * 100).toFixed(1)} %, ${opened.filter((r) => (r.hud['#interact-action'] ?? 0) > 0).length} touch it at all)`, results)
    assert(fitErrors.length === 0, `${tag}: no console errors (${fitErrors.slice(0, 2).join(' | ')})`, results)

    // Control, and the baseline: with the fit off every prompt is as authored (what the area shipped with). The same poses must show labels
    // cut by the screen there, and the fit must not cover more of any label with the page's controls than the authored prompt did.
    await fp.evaluate(() => window.__labels.fitting(false))
    const authoredRows = (await fp.evaluate((a) => window.__labels.sweep(a), { offsets, zooms: ph.zooms })).filter((r) => r.open)
    await fp.evaluate(() => window.__labels.fitting(true))
    const cut = authoredRows.filter((r) => r.share < 0.995)
    const byPose = new Map(authoredRows.map((r) => [`${r.key}|${r.zoom}|${r.ox}|${r.oz}`, r]))
    // The fit never shrinks the type under 12 px (the legibility floor), nor under what the authored prompt had where that was already smaller (a short landscape screen).
    const small = opened.filter((r) => r.capPx < 11.95 && r.capPx < (byPose.get(`${r.key}|${r.zoom}|${r.ox}|${r.oz}`)?.capPx ?? 99) - 0.1)
    if (small.length) console.table(small.slice(0, 6).map(({ key, zoom, ox, oz, capPx, scale }) => ({ key, zoom, ox, oz, capPx, scale })))
    assert(small.length === 0, `${tag}: the fit never takes the type under 12 px or under what it was (smallest ${Math.min(...opened.map((r) => r.capPx))} px, authored smallest ${Math.min(...authoredRows.map((r) => r.capPx))} px)`, results)
    // The page's fixed controls (top bar, touch buttons, speed readout); the interact button has its own assertion above.
    const hudSum = (r) => Object.entries(r.hud).filter(([sel]) => sel !== '#interact-action').reduce((n, [, v]) => n + v, 0)
    const buttonSum = (rows) => rows.reduce((n, r) => n + (r.hud['#interact-action'] ?? 0), 0)
    const worse = opened.filter((r) => { const o = byPose.get(`${r.key}|${r.zoom}|${r.ox}|${r.oz}`); return o && hudSum(r) > hudSum(o) + 0.03 })
    const sumOn = opened.reduce((n, r) => n + hudSum(r), 0), sumOff = authoredRows.reduce((n, r) => n + hudSum(r), 0)
    console.log(`${tag}: fit off (as authored): ${cut.length} of ${authoredRows.length} poses cut a label (worst share ${Math.min(...authoredRows.map((r) => r.share))}); label share under the page's fixed controls, summed over the poses: authored ${sumOff.toFixed(2)}, fitted ${sumOn.toFixed(2)}; poses where the fit covers more: ${worse.length}; under the interact button: authored ${buttonSum(authoredRows).toFixed(2)}, fitted ${buttonSum(opened).toFixed(2)}`)
    if (worse.length) console.table(worse.slice(0, 8).map((r) => ({ key: r.key, zoom: r.zoom, ox: r.ox, oz: r.oz, fitted: JSON.stringify(r.hud), authored: JSON.stringify(byPose.get(`${r.key}|${r.zoom}|${r.ox}|${r.oz}`).hud) })))
    if (ph.viewport.width < 500 && ph.viewport.height > ph.viewport.width) assert(cut.length >= 5, `${tag}: control: with the fit off the labels ARE cut by the screen (${cut.length} of ${authoredRows.length} poses)`, results)
    // And on the short phones the authored label IS under the button (the car, so the label, stands at the button's height there).
    const buttonBare = authoredRows.filter((r) => (r.hud['#interact-action'] ?? 0) > 0.3)
    if (portrait(ph) && ph.viewport.height <= 700) assert(buttonBare.length >= 5, `${tag}: control: with the fit off the label IS under the interact button (${buttonBare.length} of ${authoredRows.length} poses over 30 %, worst ${(Math.max(0, ...authoredRows.map((r) => r.hud['#interact-action'] ?? 0)) * 100).toFixed(0)} %)`, results)
    // A long activity label on a 360 px screen cannot stand beside the touch column even at its smallest type (12.5 px): it is lifted above
    // the column (and the button) instead, so it is no more under them than under the interact button: a hair (5 %), in any pose.
    const underControls = opened.filter((r) => hudSum(r) > 0.05)
    if (underControls.length) console.table(underControls.slice(0, 10).map(({ key, zoom, ox, oz, hud, rect, shift, scale, pull }) => ({ key, zoom, ox, oz, hud: JSON.stringify(hud), rect: rect.join(','), shift, scale, pull })))
    assert(underControls.length === 0, `${tag}: no fitted label is more than 5 % under the top bar, the touch buttons or the speed readout (${underControls.length} of ${opened.length} poses; worst ${Math.max(0, ...opened.map(hudSum)).toFixed(3)}, ${opened.filter((r) => hudSum(r) > 0.01).length} touch it at all)`, results)
    assert(worse.length === 0, `${tag}: the fit never covers more of a label with the page's fixed controls than the authored prompt did (${worse.length} poses worse; summed cover ${sumOn.toFixed(2)} vs ${sumOff.toFixed(2)} authored)`, results)

    if (portrait(ph)) {
      // On a phone held upright every open prompt is drawn nearer the lens than the car (the car stood in front of 'Bumpers', 'Jukebox',
      // 'Clear best laps' and read 'mpers', 'ebox', 'et laps'). By depth along each point's own ray, over every pose of the sweep.
      const worstFront = opened.reduce((m, r) => Math.max(m, r.carFront), 0)
      const inFront = opened.filter((r) => r.carFront > 0.02)
      console.log(`${tag}: the car is in front of at most ${(worstFront * 100).toFixed(1)} % of a label over ${opened.length} poses (${inFront.length} over 2 %); drawn nearer the lens: ${opened.filter((r) => r.pull >= 0.95).length} of them`)
      if (flag('verbose')) console.table(inFront.sort((a, b) => b.carFront - a.carFront).slice(0, 12).map(({ key, zoom, ox, oz, carFront, share, rect, pull }) => ({ key, zoom, ox, oz, carFront, share, rect: rect.join(','), pull })))
      assert(opened.length >= 40 && opened.every((r) => r.pull >= 0.95), `${tag}: every open prompt on a phone held upright is drawn nearer the lens (${opened.filter((r) => r.pull >= 0.95).length} of ${opened.length} poses)`, results)
      assert(inFront.length === 0, `${tag}: the car is never in front of more than 2 % of a label (${inFront.length} of ${opened.length} poses; worst ${(worstFront * 100).toFixed(1)} %)`, results)
      // Control: draw the prompts at their own depth (no pull) and the car IS in front of labels in this very set of poses.
      await fp.evaluate(() => window.__labels.fitPull(0))
      const bare = (await fp.evaluate((a) => window.__labels.sweep(a), { offsets: OFFSETS.slice(0, 5), zooms: [ph.zooms[0]] })).filter((r) => r.open)
      await fp.evaluate(() => window.__labels.fitPull(null))
      const hiddenBare = bare.filter((r) => r.carFront > 0.05)
      assert(hiddenBare.length >= 3, `${tag}: control: with no pull the car IS in front of labels (${hiddenBare.length} of ${bare.length} poses over 5 %, worst ${(Math.max(0, ...bare.map((r) => r.carFront)) * 100).toFixed(0)} %)`, results)

      // The acceptance's own spots, at the world's coordinates (skipped where this world has no such prompt there).
      const spots = []
      for (const sp of SPOTS) {
        const m = await fp.evaluate((a) => window.__labels.spot(a), sp)
        if (!m || m.label !== sp.label) { console.log(`spot ${sp.label}: not in this world at (${sp.x}, ${sp.z}) (${m ? `opened "${m.label}"` : 'no prompt'})`); continue }
        await sleep(1700)
        spots.push({ spot: sp.label, share: m.share, diamond: m.diamond, button: m.hud['#interact-action'] ?? 0, controls: Object.entries(m.hud).filter(([sel]) => sel !== '#interact-action').reduce((n, [, v]) => n + v, 0), front: m.carFront, rect: m.rect.join(','), left: m.left, shift: m.shift, scale: m.scale, pull: m.pull })
        await fp.screenshot({ path: out(`fit-${slug(tag)}-spot-${slug(sp.label)}.png`) })
      }
      if (spots.length) console.table(spots)
      assert(spots.every((x) => x.share >= 0.995 && x.diamond >= 0.98), `${tag}: the acceptance's spots read whole (${spots.length} found: ${spots.map((x) => `${x.spot} ${x.share}`).join(', ')})`, results)
      assert(spots.every((x) => x.button <= 0.05 && x.front <= 0.02), `${tag}: and clear of the interact button and the car (${spots.map((x) => `${x.spot} ${(x.button * 100).toFixed(0)} % / ${(x.front * 100).toFixed(0)} %`).join(', ')})`, results)
      assert(spots.every((x) => x.controls <= 0.05), `${tag}: and of the touch buttons, the speed readout and the top bar (${spots.map((x) => `${x.spot} ${(x.controls * 100).toFixed(0)} %`).join(', ')})`, results)
      assert(spots.some((x) => x.spot === 'Start the penguin round-up'), `${tag}: the verifier's spot, the penguin round-up with the car 2.2 m from its anchor, opened`, results)

      // The long labels from the verifier's poses: whole, and clear of the touch column, the button, the readout and the top bar.
      const longKeys = [...all].filter((key) => LONG_LABELS.some((label) => key.endsWith(`/${label}`)))
      const longRows = []
      for (const key of longKeys) for (const zoom of LONG_ZOOMS) for (const [ox, oz] of LONG_OFFSETS) {
        const row = await fp.evaluate(([k, a, b, z]) => window.__labels.pose(k, a, b, z), [key, ox, oz, zoom])
        if (row.open) longRows.push({ ...row, zoom, ox, oz })
      }
      const under = (r) => Math.max(0, ...Object.values(r.hud))
      const lbad = longRows.filter((r) => r.share < 0.995 || r.diamond < 0.98 || under(r) > 0.05)
      if (lbad.length) console.table(lbad.slice(0, 10).map(({ key, zoom, ox, oz, share, diamond, hud, rect, shift, scale }) => ({ key, zoom, ox, oz, share, diamond, hud: JSON.stringify(hud), rect: rect.join(','), shift, scale })))
      console.log(`${tag}: long labels: ${longRows.length} poses opened of ${longKeys.length * LONG_ZOOMS.length * LONG_OFFSETS.length}; worst under a control ${(Math.max(0, ...longRows.map(under)) * 100).toFixed(1)} %; smallest cap ${Math.min(...longRows.map((r) => r.capPx))} px`)
      assert(longRows.length >= 12 && longKeys.length === LONG_LABELS.length, `${tag}: the long labels were posed (${longRows.length} poses of ${longKeys.length} prompts)`, results)
      assert(lbad.length === 0, `${tag}: every long label stands whole and clear of every control of the page in all ${longRows.length} poses (${lbad.length} do not)`, results)
      // Control: as authored (fit off) the same poses ARE under the touch column or the button, so the measurement can see what the lift cures.
      await fp.evaluate(() => window.__labels.fitting(false))
      const longBare = []
      for (const key of longKeys) for (const zoom of LONG_ZOOMS) for (const [ox, oz] of LONG_OFFSETS) {
        const row = await fp.evaluate(([k, a, b, z]) => window.__labels.pose(k, a, b, z), [key, ox, oz, zoom])
        if (row.open) longBare.push({ ...row, zoom, ox, oz })
      }
      await fp.evaluate(() => window.__labels.fitting(true))
      const longUnder = longBare.filter((r) => under(r) > 0.15)
      if (ph.viewport.height <= 700) assert(longUnder.length >= 4, `${tag}: control: with the fit off the long labels ARE under the page's controls (${longUnder.length} of ${longBare.length} poses over 15 %, worst ${(Math.max(0, ...longBare.map(under)) * 100).toFixed(0)} %)`, results)
    }
    if (ph.name === '390x844') {
      const cost = await fp.evaluate((k) => window.__labels.fitCost(k), [...keys][0])
      console.log(`${tag}: one frame of the fit costs ${(cost.ms * 1000).toFixed(2)} us (prompt pull ${cost.engaged})`)
      assert(cost && cost.ms < 0.02, `${tag}: the per-frame fit costs ${(cost.ms * 1000).toFixed(2)} us (budget 20 us)`, results)
    }
    await fp.close()
  }
}

await browser.close()
finish(results)
