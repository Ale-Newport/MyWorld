/* /world Career area (the road that is the CV): borders against the coloured shapes the stones rise from, the
   year readout, the phantom colliders, and the area from the REAL gameplay camera (the chase camera of the player
   runtime: FOV 25, 45 degrees of azimuth, ~41 degrees of elevation, 21 m at the default zoom, 15 m at zoom 1).

   QA_BASE=http://localhost:3210 node scripts/qa/world-career.mjs [--phase=after] [--only=a,b] [--no-shots] [--legacy]

   sections (--only): physics alignment years edges plate readout labels car reach still shuffle pinch approach hop collapse ontop draws bump shots studio world2
   --phase=<name> only names the output folder (.qa/runs/impl/career-geo/<name>, or QA_OUT).
   --calm         (with --legacy) takes the phantom colliders out of the physics before the years and the pictures, so the car
                  stays where it is put: with them in, placing it between two lanes throws it about, which is the bug but makes
                  a poor picture. The physics and bump sections ignore it.
   --patch=A=1,B=x  serves the working tree's controller with those module constants replaced (a negative control: for example
                  --patch=PLATE_SLOT=false,PLATE_LEAD=-0.1,PLATE_LEAD_MAX=0,READOUT_ON_TOP=false puts the plate back beside the car
                  and its bars back in the scene, and the readout section must FAIL; --patch=PLATE_SLOT=false,LABEL_HOLE=0 puts the
                  plate back where the labels run and lets them over it, and the labels section must FAIL; --patch=PLATE_MIN_PX=9999,PLATE_AWAY=false,SAFE_X=0.84
                  keeps the plate full size on a phone, under the car, and the car section must FAIL; --patch=PLATE_AWAY=false keeps it at its
                  floor beside a car that fills a pinched-in phone, on it, and the car section must FAIL at 390x844 from zoom 0.8 (and 360x640);
                  --patch=DODGE_ENTER=-9,DODGE_EXIT=-9 makes the
                  plate wait at its home for a car to drive over it, and the car, approach and hop sections must FAIL; --patch=FOLLOW_CLAMP=false
                  lets the slide trail the screen's edge, and the approach section must FAIL; --patch=READOUT_ON_TOP=false puts the
                  bars back in the scene, and the ontop and readout sections must FAIL).
   --views=a,b    (readout, labels, car and approach sections) only these screens: desk phone390 phone360 tablet768 tablet phoneLand
   --zooms=a,b    (car section) the chase camera's zoom (view.zoom.baseRatio, 0.6 default .. 1 closest), instead of 0.6 (landscape) or 0.6, 0.8 and 1 (portrait)
   --lanes=a,b --stops=a,b  (car section) the lanes (x) and the places down the road (z) to judge, instead of the full set
   --against=<file>  serves that file as the Career controller (the previous revision, saved), for a before/after or a negative control: the `still` section
                  must FAIL on .qa/runs/impl/career-solve/base/Career.js (the revision before the verdicts were made to hold: 14 of the 108 poses of its
                  neighbourhood grid flicker on a landscape phone).
   --legacy       serves this browser the Career controller of git HEAD (the one before the rim/readout rebuild) in place
                  of the working tree's, so the same numbers and pictures can be taken "before": assertions that need the
                  new API (career.sockets / career.rim / career.litSegments) are reported as SKIP there, the rest FAIL
                  where the old code is wrong. Use --phase=before with it.

   What each section proves
   - physics    no collider is left under the authored plate, strips, year box, digits or stone bodies (owners are
                resolved from the nodes, so the list cannot go stale), and the visible rim is visual-only.
   - alignment  from career.sockets: a raycast scan of every socket measures the hole in the rim — 0.505 m square,
                centred within 1 mm — and the coloured floor fills it; every stone's x/z is its socket's, and after
                sliding it ends on its tail socket. Without sockets (before) it measures the authored rim at the
                stones' heads instead.
   - years      the car is driven to 2023..2027; the readout shows that year, litSegments equal the digit table, and
                the pixel luminance at every segment centre is bright for a lit bar and dark for an unlit one.
   - edges      writeYear(8888) and writeYear(2019), same pixel test, and a year boundary crossed back and forth
                changes the year once (hysteresis).
   - plate      the readout faces the camera (a digit's up is the camera's, within 3 degrees) and follows an orbit; at every
                heading its footprint stays clear of the education rim; a bar that changes rises or sinks by itself while
                the others do not move.
   - draws      draw calls and triangles with the Career area in view, to compare before and after (--legacy).
   - readout    the year is READABLE: on every lane (25.05..29.05) and at every year, on the desktop, on 390x844 and 360x640 portrait
                phones, an 820x1180 tablet and an 844x390 landscape phone, EVERY lit bar is bright in the real screenshot (a bar behind
                the car, a raised stone or a label is judged too, not skipped), and the whole housing is inside the viewport.
   - labels     the year is not tangled with the lane labels: at 13 places down the road on every lane of every screen the scene is
                rendered three times in the same frame (labels as they are, labels with no hole for the plate, no labels), and
                the label pixels inside the housing's rectangle must be nil, while the hole must not take the labels' own text
                (it takes none on a desktop, a tablet or a landscape phone: the plate stands left of the car where no label runs).
   - car        the year plate is not on the car: at 77 places on every lane from 22.3 (a car on the plate itself) to 29, from the plaza before the walk (z 10, where the
                plate's home is 3.5 m up the road) to the end of the road, on every screen (the portrait phones and tablets 390x844,
                360x640, 768x1024 and 820x1180, the desktop and a landscape phone), the scene is rendered four ways in the same frame
                (as it is, the readout's bars off, the car gone too, the raised stones gone too), and the car's pixels inside the
                housing's rectangle must stay under 5% of it, no bar may be painted on the car (a digit on the bonnet), and the plate
                must still be big enough to read (at least 80 x 28 px). The plaza was once skipped as "the plate is at its home and the
                car drives over it" and had up to 83% of the plate under the car. A plate that is not shrunk to fit puts 30-70% of the
                rectangle under the car on a phone: --patch=PLATE_MIN_PX=9999,PLATE_AWAY=false,SAFE_X=0.84 must FAIL this section, and so must
                --patch=DODGE_ENTER=-9,DODGE_EXIT=-9 (a plate that waits at its home for the car to drive over it).
                The same at the camera pinched in (zoom 0.8 and 1, a 23 m and a 15 m camera; a phone's marginal zoom too), where a portrait
                phone sees 2 to 3 m of the road across and the car fills it: the plate is shown (all there, in the picture, beside the car) at every place in
                the walk on lanes 24 and up up to the zoom `shownTo` of the screen, and beyond it it is away or shown, never half way and
                never on the car (--patch=PLATE_AWAY=false must FAIL). It was once put back at full size there and lay across the bonnet
                (up to 85% of the plate, 90% of the lit pixels). A screen that is wide enough shows it at every zoom, as small as 74 px.
   - reach      a plaque speaks only near its stone, and is never bigger than it is designed to be: the car is put at 112 poses on a ring grid round
                the lane group (7 radii from 6 to 42 m, 16 directions) on every screen, at the default camera, and at 36 more on a ring of 3 radii under
                each of three orbited cameras on the desktop and the 390x844 phone. At every pose every plaque that is drawn is judged: its width is at most 1.4
                times the width it has standing at the car's depth (the size it is designed at) and, on a screen that is 768 px wide or more and wider than high, at most 40% of the
                canvas; its stone's pivot is in the picture or just outside it; no corner is behind the lens; and no plaque is drawn at all when the car is more
                than 17.5 m from every stone across the lanes. Then the edge of the reach does not flicker: the car is carried across it at 5 m/s from the west
                and from the east, and each stop's plaque turns on once and off once at most, with its wipe never reversing more than twice; and a car held on
                the edge and jittered by 6 cm each tick turns it on and off at most twice (--patch=REVEAL_HOLD=0,VIEW_HOLD=0 must FAIL the jitter).
                The design is the screen's DEFAULT camera's (measured: the car's depth at zoom 0.6), not the live one: the camera is also put at zoom 0.8 and 1 (a
                pinch on a phone, a wheel on a desktop; the 390x844 phone, the desktop, a portrait tablet and a landscape phone), on the ring and ON the lanes, where
                the plaques are no wider than 1.4x that design, no wider than the default camera's widest by more than 15%, no subtitle is under 90% of the
                smallest at the default camera, and no speaking plaque is more than 5% under the page's controls (--patch=DESIGN_SLACK=1e9 must FAIL them: the plaque
                is then up to 176% of a phone at zoom 1, 16% of it under the JUMP button). The edge of the reach is also carried at zoom 1.
                A speaking plaque STANDS BESIDE ITS STONE: its nearest edge is no further than REACH_GAP (0.3) of the canvas's shorter side from the stone's anchor, from every
                camera and every pose of the grid, and while the car is carried past at 5 m/s no plaque that is drawn is further than 0.4 (--patch=GAP_SHARE=9 must FAIL: the layout
                then sends a plaque across the picture to clear the car: 0.60 on a phone, 0.39 on a tablet, 0.35 on a desktop on the quick grid, 2.0 canvas widths when the camera is orbited). It is not given up by the layout for nothing: on the lanes at least
                97% of the plaques that are wanted speak on a screen with room (a desktop, a tablet), 60% on a phone held upright or on its side (--patch=GAP_SHARE=0.001 must FAIL).
                No plaque is wider than 40% of a canvas 768 px wide or more, in either orientation, unless its subtitle is then at the 12 px floor (--patch=WIDTH_SHARE=9 must FAIL on
                the tablets). A plaque speaks for at least 12 ticks at a time while the car is carried past, and the edge of the place the layout has for it (not only the edge of its
                reach) does not flicker under a 6 cm shake (--patch=GIVE_UP_AFTER=0,REVIVE_AFTER=0 must FAIL).
                --patch=REVEAL_RADIUS=1e9,VIEW_MARGIN=1e9,VIEW_HOLD=0,REVEAL_HOLD=0,NEAR_CUT=-1,NEAR_SHARE=0 (the controller as it was: a stone is revealed from anywhere
                along the road, and a plaque is as big as the lens' nearness makes it) must FAIL the size, anchor and reach checks. --grid=quick takes 8 directions and 4 radii, --grid=none only the flicker checks, --cameras=zoom-1,default only those cameras (default, yaw-135, yaw-225, yaw-315-low, zoom-0.8, zoom-1, zoom-1-yaw-225), --flicker=off no flicker checks.
   - still      the verdicts HOLD. With the car parked and the camera still no plaque goes on and off: at every pose the car is put (and the camera set) and
                left 3 s, and over the last 1.5 s the (wants, near, crowded) of every line must not change once (the plaque that cycled between speaking and silent, forever,
                every 230 ms, standing half wiped under another and under a button: the reach and orbit sections look at a pose 0.85 s after it, and never saw it). The plaques
                on the screen at the end (more than a third revealed) are judged too: none is left half revealed, none is cut by the canvas by more than 2% of its area, none is
                more than REACH_HUD (5%) under the page's controls. The poses:
                the REACH grid as arrivals (the car put from far away at the ring of radii round the lane group, in 12 directions, the default camera, and the lanes), the
                ORBIT grid (the car on three spots of the lanes, the camera snapped to zooms 0.3, 0.6 and 1, elevations 0.05, 0.27 and 0.45 pi and eight azimuths), and the
                landscape-phone neighbourhood of the cycle (the projects lane at local x 29, z 2 to -1.5, zoom 0.85 and 1, a low rear view of 0.4 to 0.55 pi, azimuths 135 to 315).
                --grid=quick (default) takes every third pose of the reach grid and every fourth of the orbit grid, the whole neighbourhood on the landscape phone and a sample of it (the repro pose among them) on
                every other screen: 118 poses a screen, 3 s each; --grid=full all of them (every screen: the whole neighbourhood too), --grid=hood only the neighbourhood.
   - shuffle    the car shuffled a quarter of a metre to and fro (period 0.8 s, real time) across the lanes (16 places) in turn, on a phone on its side,
                an upright phone and a desktop: no plaque changes its (wants, near, crowded) more than 3 times, crosses half revealed more than twice (the first wipe in is one)
                or is wiped away and in more than once, at any place in 4 s (a plaque that depends on a hair is on and off, or blinks, with the car). Judged without the car being
                put away between the places, as a car arrives. --against=.qa/runs/impl/career-solve3/Career.js.cur (the revision before the plaques kept their places) FAILS it
                on the phone on its side. --amp= --per= --dur=(ms) change the shuffle.
   - pinch      the zoom ramped like a pinch (0.6 to 0.9 on a 390x844 phone, to 1 on a tablet and a desktop, in 1.2 s, and back) with the car in the
                walk on lanes 24 and 25.05: judged on every animation frame, the car under at most 6% of the plate while it shows, it goes
                away (and comes back) at most once and never flickers, and a screen with room never loses it (--patch=PLATE_SHRINK=6,CAMERA_MOVING=9
                must FAIL: a plate that gives way at 6 a second and is solved every tenth of a second was 8% to 15% on the bumper).
   - approach   W held from the plaza on lanes 24 and 25.05 (desktop, 390x844, 820x1180): every sampled frame of the drive is judged on
                its own pixels (the car under at most 5% of the plate, 0.5% of the lit pixels on it), the housing stays in view in the
                walk, and the plate's scale never steps by more than 8% between frames (--patch=FOLLOW_CLAMP=false must FAIL the edge).
   - hop        the car put by the plate's home: the plate shrinks out of sight, is put where it is going while it is nothing and grows
                back; it is never seen sliding across the plaza (less than a metre of travel while it shows).
   - collapse   the canvas collapsing to nothing for a moment (a camera aspect of NaN) leaves nothing NaN behind: the plate comes back.
   - ontop      the readout's bars are lifted toward the lens in depth (not on the screen): a wall 2 m in front of the plate (the
                car's height and a stone's) does not hide them, a wall 10 m in front (a hill, a sign, a tree) does, as it hides the housing.
   - bump       the chassis is driven across the three lanes at 25 km/h and along one at 20 km/h: its height must not
                move more than 2 cm (the old solid rim gave a 9.6 cm step).
   - shots      the gameplay camera at 1440x900 (default zoom and 15 m) and 390x844 touch (default zoom), at each lane head (at
                rest, and with the stone up), the work-lane overlap, the five years, 8888 and 2019.
   - studio     the admin world studio (its own template, served the way world-studio-drive.mjs serves it): Edit shows the
                generated career with its rim, floor and a readout at 2023; Drive builds the same controller, retires the
                same colliders and reads a year; neither throws.
   - world2     GET /world2 still answers 200. */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { BASE, launch, openPlayer as openOnce, sleep, assert, finish, watch } from './lib.mjs'

const args = process.argv.slice(2)
const opt = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback }
const PHASE = opt('phase', args.includes('--legacy') ? 'before' : 'after')
const ONLY = opt('only', '') ? opt('only', '').split(',') : null
const want = (section) => !ONLY || ONLY.includes(section)
const DIR = process.env.QA_OUT ?? path.resolve('.qa/runs/impl/career-geo', PHASE)
fs.mkdirSync(DIR, { recursive: true })
const file = (name) => path.join(DIR, name)
const results = []
const skip = (message) => { results.push({ ok: true, message: `SKIP ${message}` }); console.log(`SKIP ${message}`) }
const note = (message) => console.log(`     ${message}`)

/** Digit -> segments A..G as bits 0..6 (A top, B top-right, C bottom-right, D bottom, E bottom-left, F top-left, G middle). */
const DIGIT = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111]
const masksOf = (year) => [...String(year)].map((d) => DIGIT[Number(d)])
/** Frame z, per year, of a point the car can be driven to. YEAR_X is a place between the work and projects lanes for the
    single-lane checks; the `readout` section reads every year from every lane on every screen. */
const YEAR_POINTS = { 2023: 5.82, 2024: 2.99, 2025: -1.26, 2026: -5.51, 2027: -9.05 }
const YEAR_X = 28.05

/* ---------- the page side: everything is read off the live runtime, nothing is stubbed ---------- */
function install() {
  const A = globalThis.__archipelago, T = A.THREE
  const inst = A.gameplay.instances.find((i) => i.parts.career)
  const c = inst.parts.career
  const dir = inst.physics.vector({ x: 0, y: 0, z: -1 })
  const Q = { A, T, inst, c, heading: Math.atan2(-dir.z, dir.x) }
  /** Put the car at a frame position (the career's own metres), facing down the road (local -Z) or along `local` = [dx, dz]. */
  Q.place = (x, z, local = [0, -1], y = 0.5) => {
    const d = inst.physics.vector({ x: local[0], y: 0, z: local[1] })
    return A.driving.place({ position: inst.physics.point({ x, y, z }), rotation: Math.atan2(-d.z, d.x) }, { reason: 'qa' })
  }
  /** Every owner a collider would carry for the authored pieces the Career replaces. */
  Q.phantomOwners = () => {
    const names = ['Plane.049', 'Plane.018', 'Plane.022', 'Plane.035', 'Plane.048', 'Plane.030']
    const roots = names.map((n) => inst.references.bySource.get(n)).filter(Boolean)
    const year = inst.references.bySource.get('refYear')
    for (const child of year?.children ?? []) if (String(child.userData.w2Source ?? child.name).startsWith('digit')) roots.push(child)
    for (const [source, node] of inst.references.bySource) if (/^stone(\.\d+)?$/.test(source)) roots.push(node)
    const owners = new Map()
    for (const root of roots) root.traverse((n) => { if (n.isMesh) owners.set(String(n.userData.w2Source ?? n.name), root.userData.w2Source ?? root.name) })
    return owners
  }
  Q.calm = () => { const owners = Q.phantomOwners(); for (const p of A.physics.physicals.filter((q) => typeof q.owner === 'string' && owners.has(q.owner))) inst.physics.remove(p) }
  Q.phantoms = () => {
    const owners = Q.phantomOwners()
    return A.physics.physicals.filter((p) => typeof p.owner === 'string' && owners.has(p.owner)).map((p) => p.owner)
  }
  /** Segment centroids per digit in the digit's own local space, from the geometry's second UV set (bar index = floor(uv1.x * 7)). */
  Q.centroids = () => c.digits.map((d) => {
    const g = d.mesh.geometry, pos = g.getAttribute('position'), uv1 = g.getAttribute('uv1')
    const sum = Array.from({ length: 7 }, () => [0, 0, 0, 0])
    for (let i = 0; i < uv1.count; i++) {
      const s = Math.floor(Math.min(0.999, Math.max(0, uv1.getX(i))) * 7), k = sum[s]
      k[0] += pos.getX(i); k[1] += pos.getY(i); k[2] += pos.getZ(i); k[3]++
    }
    return sum.map((k) => new T.Vector3(k[0] / k[3], k[1] / k[3], k[2] / k[3]))
  })
  /** Screen position (css px) of every segment centre: at the height a lit bar stands (0.42 digit-local), an unlit one at rest. */
  Q.segmentPoints = (masks) => {
    A.camera.updateMatrixWorld(true)
    const rect = A.renderer.domElement.getBoundingClientRect()
    const world = Q.centroids().map((row, di) => row.map((v, s) => {
      const lift = (masks[di] >> s) & 1 ? 0.42 : 0
      return c.digits[di].mesh.localToWorld(v.clone().add(new T.Vector3(0, lift, 0)))
    }))
    const screen = world.map((row) => row.map((w) => { const p = w.clone().project(A.camera); return [rect.left + (p.x * 0.5 + 0.5) * rect.width, rect.top + (-p.y * 0.5 + 0.5) * rect.height] }))
    return { screen, hidden: Q.hidden(world.map((row) => row.map((w) => w.toArray()))) }
  }
  /** Is anything between the camera and this world point? (the car, a raised stone, a label): such a bar is not judged. */
  Q.hidden = (points) => points.map((row) => row.map((p) => {
    const target = new T.Vector3(...p)
    const toTarget = target.clone().sub(A.camera.position)
    const ray = new T.Raycaster(A.camera.position.clone(), toTarget.clone().normalize(), 0, toTarget.length() - 0.04)
    const mine = new Set(); c.digits.forEach((d) => d.mesh.traverse((o) => mine.add(o)))
    const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true }
    return ray.intersectObjects(A.scene.children, true).some((hit) => shown(hit.object) && !mine.has(hit.object) && hit.object.material?.visible !== false && !(hit.object.material?.transparent && hit.object.material?.opacity === 0))
  }))
  /** The plate's housing on screen, css px: the box of its eight corners, and the viewport it is in. */
  Q.housing = () => {
    A.camera.updateMatrixWorld(true)
    const rect = A.renderer.domElement.getBoundingClientRect()
    const box = inst.references.bySource.get('Plane.030')
    box.updateWorldMatrix(true, false)
    box.geometry.computeBoundingBox()
    const bb = box.geometry.boundingBox
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const p = box.localToWorld(new T.Vector3(x, y, z)).project(A.camera)
      const sx = rect.left + (p.x * 0.5 + 0.5) * rect.width, sy = rect.top + (-p.y * 0.5 + 0.5) * rect.height
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    return { x0, x1, y0, y1, width: rect.width, height: rect.height }
  }
  /**
   * Label pixels against the year plate, exact: the scene is rendered three times in this one task (nothing moves), with the
   * labels as they are, with the plate's hole switched off, and with no labels at all. `over` is the pixels inside the housing's
   * rectangle that a label still paints; `cut` the label pixels the hole takes away; `labels` all the label pixels there are.
   */
  Q.labelPixels = () => {
    const canvas = A.renderer.domElement
    const g = (Q.grab2d ??= new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true }))
    const grab = () => { A.renderer.render(A.scene, A.camera); g.drawImage(canvas, 0, 0); return g.getImageData(0, 0, canvas.width, canvas.height).data }
    const hole = c.plateRect.value, keep = hole.clone()
    const withHole = grab()
    hole.set(2, 2, -2, -2)
    const noHole = grab()
    hole.copy(keep)
    // a label is a plaque mesh in a pivot, built when the car first comes near: only the ones that exist can be hidden
    const built = c.lines.filter((l) => l.label)
    const masks = built.map((l) => l.label.layers.mask)
    for (const l of built) l.label.layers.mask = 0
    const none = grab()
    built.forEach((l, i) => { l.label.layers.mask = masks[i] })
    const H = Q.housing(), sx = canvas.width / H.width, sy = canvas.height / H.height
    const x0 = Math.max(0, Math.floor(H.x0 * sx)), x1 = Math.min(canvas.width, Math.ceil(H.x1 * sx)), y0 = Math.max(0, Math.floor(H.y0 * sy)), y1 = Math.min(canvas.height, Math.ceil(H.y1 * sy))
    const d = (X, Y, i) => Math.max(Math.abs(X[i] - Y[i]), Math.abs(X[i + 1] - Y[i + 1]), Math.abs(X[i + 2] - Y[i + 2]))
    let labels = 0, cut = 0, over = 0, rect = 0
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
      const i = (y * canvas.width + x) * 4
      const inside = x >= x0 && x < x1 && y >= y0 && y < y1
      if (inside) rect++
      if (d(noHole, none, i) > 24) { labels++; if (d(withHole, noHole, i) > 24) cut++ }
      if (inside && d(withHole, none, i) > 24) over++
    }
    return { labels, cut, over, rect, shown: c.lines.filter((l) => (l.pivot ?? l.label)?.visible && l.reveal > 0.3).length }
  }
  /**
   * What is on the year plate, exact: the scene is rendered four times in this one task (nothing moves): as it is, with the readout's
   * bars switched off, with the car gone too, and with the career's raised stones gone as well. `car` and `stone` are the pixels of
   * the housing's rectangle that each paints, `lit` the pixels the bars paint, `litOnCar` the part of those that lies on the car (a
   * digit painted on the bonnet) and `litOnStone` on a stone. `offset` is how far the plate has run from its home, down the road.
   */
  Q.platePixels = () => {
    const canvas = A.renderer.domElement
    const g = (Q.grab2d ??= new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true }))
    const grab = () => { A.renderer.render(A.scene, A.camera); g.drawImage(canvas, 0, 0); return g.getImageData(0, 0, canvas.width, canvas.height).data }
    const car = A.driving.visual.group, wasCar = car.visible, stones = c.lines.map((l) => l.stone), wasStones = stones.map((m) => m.visible)
    const all = grab()
    for (const d of c.digits) d.mesh.visible = false
    const noBars = grab()
    car.visible = false
    const noCar = grab()
    for (const m of stones) m.visible = false
    const noStones = grab()
    car.visible = wasCar
    stones.forEach((m, i) => { m.visible = wasStones[i] })
    for (const d of c.digits) d.mesh.visible = true
    const H = Q.housing(), sx = canvas.width / H.width, sy = canvas.height / H.height
    const x0 = Math.max(0, Math.floor(H.x0 * sx)), x1 = Math.min(canvas.width, Math.ceil(H.x1 * sx)), y0 = Math.max(0, Math.floor(H.y0 * sy)), y1 = Math.min(canvas.height, Math.ceil(H.y1 * sy))
    const d = (X, Y, i) => Math.max(Math.abs(X[i] - Y[i]), Math.abs(X[i + 1] - Y[i + 1]), Math.abs(X[i + 2] - Y[i + 2]))
    let area = 0, carPx = 0, stonePx = 0, lit = 0, litOnCar = 0, litOnStone = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * canvas.width + x) * 4
      area++
      const onCar = d(noBars, noCar, i) > 60, onStone = d(noCar, noStones, i) > 60, onBar = d(all, noBars, i) > 40
      if (onCar) carPx++
      if (onStone) stonePx++
      if (onBar) { lit++; if (onCar) litOnCar++; if (onStone) litOnStone++ }
    }
    return { area, car: carPx, stone: stonePx, lit, litOnCar, litOnStone, offset: c.yearOffset, size: c.plateSize, pop: c.pop, z: c.game.player.position.z, box: [H.x0, H.y0, H.x1, H.y1], width: H.x1 - H.x0, height: H.y1 - H.y0, viewport: [H.width, H.height], behind: !!H.behind }
  }
  /**
   * A pinch: view.zoom.baseRatio goes from `from` to `to` in `ms` while the car stands where it is, and on every animation frame the
   * plate is judged against the car (the scene rendered with the bars off, and with the car gone too: `car` is the share of the housing's
   * rectangle the car paints). `place` is where the plate says it stands, `pop` how much of it there is.
   */
  Q.pinch = (from, to, ms) => new Promise((resolve) => {
    const canvas = A.renderer.domElement
    const g = (Q.grab2d ??= new OffscreenCanvas(canvas.width, canvas.height).getContext('2d', { willReadFrequently: true }))
    const grab = () => { A.renderer.render(A.scene, A.camera); g.drawImage(canvas, 0, 0); return g.getImageData(0, 0, canvas.width, canvas.height).data }
    const car = A.driving.visual.group, view = A.driving.view
    const rows = [], t0 = performance.now()
    const tick = () => {
      const t = performance.now() - t0, k = Math.min(1, t / ms)
      view.zoom.baseRatio = from + (to - from) * k
      for (const d of c.digits) d.mesh.visible = false
      const noBars = grab()
      car.visible = false
      const noCar = grab()
      car.visible = true
      for (const d of c.digits) d.mesh.visible = true
      const H = Q.housing(), sx = canvas.width / H.width, sy = canvas.height / H.height
      const x0 = Math.max(0, Math.floor(H.x0 * sx)), x1 = Math.min(canvas.width, Math.ceil(H.x1 * sx)), y0 = Math.max(0, Math.floor(H.y0 * sy)), y1 = Math.min(canvas.height, Math.ceil(H.y1 * sy))
      let area = 0, carPx = 0
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const i = (y * canvas.width + x) * 4
        area++
        if (Math.max(Math.abs(noBars[i] - noCar[i]), Math.abs(noBars[i + 1] - noCar[i + 1]), Math.abs(noBars[i + 2] - noCar[i + 2])) > 60) carPx++
      }
      rows.push({ t, zoom: view.zoom.baseRatio, place: c.platePlace, pop: c.pop, size: c.plateSize, fitted: c.fitted, car: carPx / Math.max(1, area) })
      if (t < ms + 700) requestAnimationFrame(tick); else resolve(rows)
    }
    requestAnimationFrame(tick)
  })
  /** The plate's offset and size-while-hopping, once a frame, for `ms` (a hop must not be seen as a slide across the plaza). */
  Q.watch = (ms) => new Promise((resolve) => {
    const rows = [], t0 = performance.now()
    const tick = () => { rows.push({ t: performance.now() - t0, pop: c.pop, offset: c.yearOffset, size: c.plateSize }); if (performance.now() - t0 < ms) requestAnimationFrame(tick); else resolve(rows) }
    requestAnimationFrame(tick)
  })
  /** A black wall `distance` metres in front of the plate along the lens axis, big enough to cover all of it (null: take it away). */
  Q.occlude = (distance) => {
    if (Q.wall) { Q.wall.removeFromParent(); Q.wall.geometry.dispose(); Q.wall.material.dispose(); Q.wall = null }
    if (distance == null) return
    A.camera.updateMatrixWorld(true)
    const plate = c.yearGroup.getWorldPosition(new T.Vector3())
    const forward = A.camera.getWorldDirection(new T.Vector3())
    const depth = plate.clone().sub(A.camera.position).dot(forward)
    const wall = new T.Mesh(new T.PlaneGeometry(40, 40), new T.MeshBasicMaterial({ color: 0x101010, side: T.DoubleSide, toneMapped: false }))
    wall.quaternion.copy(A.camera.quaternion)
    wall.position.copy(A.camera.position).addScaledVector(forward, depth - distance)
    wall.frustumCulled = false
    A.scene.add(wall)
    Q.wall = wall
  }
  Q.raycaster = new T.Raycaster()
  /** First thing a ray dropped at frame (x, z) hits among `objects`: { object, y } in frame metres, or null. */
  Q.drop = (objects, x, z) => {
    const world = c.group.localToWorld(new T.Vector3(x, 5, z))
    Q.raycaster.set(world, new T.Vector3(0, -1, 0))
    Q.raycaster.far = 20
    const hit = Q.raycaster.intersectObjects(objects, false)[0]
    if (!hit) return null
    return { object: hit.object, y: c.group.worldToLocal(hit.point.clone()).y }
  }
  /** The chase camera at azimuth theta, elevation phi (radians from the vertical axis, View's convention), zoom ratio; undefined keeps the current one. */
  Q.camera = (theta, phi, zoom) => {
    const v = A.driving.view, s = v.spherical
    if (theta !== undefined) { s.targetTheta = s.theta = theta }
    if (phi !== undefined) { s.targetPhi = s.phi = phi }
    if (zoom !== undefined) { v.zoom.baseRatio = v.zoom.smoothedRatio = v.zoom.ratio = zoom }
    v.snapToTarget(); v.smoothedObstruction = Infinity; v.update()
  }
  /** The car in the career's own frame (the one the lanes are measured in). */
  Q.carFrame = () => { const p = A.driving.vehicle.position, l = c.group.worldToLocal(new T.Vector3(p.x, p.y, p.z)); return [l.x, l.z] }
  /**
   * What the `reach` section judges, once: every plaque that is being drawn (revealed above 0.05, every ancestor visible), as this frame's camera
   * sees its slab. `share` is its width over the canvas's, `design` the share the same plaque has when it stands at the car's depth (the size the
   * design is made for: the billboard's distance factor at the car, grown to a 12 px subtitle as the layout does), `anchor` where its stone's
   * pivot is in clip space, `inside` whether its quad is wholly in the canvas, `behind` whether any corner is at or behind the lens.
   */
  Q.reachRow = (designDepth) => {
    const cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect(), car = A.driving.vehicle.position
    cam.updateMatrixWorld(true)
    const e = cam.matrixWorldInverse.elements, pr = cam.projectionMatrix.elements, v = new T.Vector3()
    // The design is the one the screen's DEFAULT camera gives (measured, by `defaultDepth`, from the camera itself): a pinch or a wheel that brings the camera in does not make the design bigger.
    const carDepth = designDepth ?? -(e[2] * car.x + e[6] * car.y + e[10] * car.z + e[14])
    const kCar = Math.min(1.8, Math.max(1, carDepth / 31))
    const subPx = (c.subMin * kCar * cv.height * 0.5 * pr[5]) / carDepth
    const fitCar = Math.min(2.2, Math.max(1, 12 / subPx))
    const rect = (id) => { const b = document.getElementById(id)?.getBoundingClientRect(); return b && b.width > 0 && b.height > 0 ? { x0: b.left - cv.left, y0: b.top - cv.top, x1: b.right - cv.left, y1: b.bottom - cv.top } : null }
    const hud = [rect('player-nav'), rect('touch-controls'), rect('drive-hud')]
    const overlap = (a, b) => { if (!b) return 0; const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0); return w > 0 && h > 0 ? (w * h) / Math.max(1, (a.x1 - a.x0) * (a.y1 - a.y0)) : 0 }
    const frame = Q.carFrame()
    const drawn = []
    for (const l of c.lines) {
      if (!l.label || !(l.reveal > 0.05)) continue
      let hidden = false
      for (let a = l.label; a; a = a.parent) if (!a.visible) hidden = true
      if (hidden) continue
      const m = l.label
      m.updateWorldMatrix(true, false); m.geometry.computeBoundingBox()
      const bb = m.geometry.boundingBox
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, behind = false
      for (const xx of [bb.min.x, bb.max.x]) for (const yy of [bb.min.y, bb.max.y]) {
        v.set(xx, yy, 0).applyMatrix4(m.matrixWorld)
        if (-(e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14]) < 0.1) behind = true
        v.project(cam)
        const sx = (v.x * 0.5 + 0.5) * cv.width, sy = (-v.y * 0.5 + 0.5) * cv.height
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
      }
      const pw = l.pivot.getWorldPosition(new T.Vector3())
      const a = pw.clone().project(cam)
      // how far the plaque's nearest edge is from its stone's anchor (the pivot), over the canvas's shorter side
      const ax = (a.x * 0.5 + 0.5) * cv.width, ay = (-a.y * 0.5 + 0.5) * cv.height
      const gap = Math.hypot(Math.max(x0 - ax, 0, ax - x1), Math.max(y0 - ay, 0, ay - y1)) / Math.min(cv.width, cv.height)
      const design = (l.width * fitCar * kCar * pr[0]) / carDepth / 2
      drawn.push({
        id: l.stop.id, track: l.track.id, reveal: l.reveal, share: (x1 - x0) / cv.width, high: (y1 - y0) / cv.height, design, ratio: (x1 - x0) / cv.width / design,
        anchor: [a.x, a.y], gap, x0, x1, y0, y1, behind, inside: x0 >= -4 && x1 <= cv.width + 4 && y0 >= -4 && y1 <= cv.height + 4, near: l.near, fit: l.fit,
        hud: Math.max(...hud.map((b) => overlap({ x0, x1, y0, y1 }, b))),
        // the smallest subtitle as drawn, in CSS px: the quad's height is the plaque's, and the subtitle is the same share of it on every plaque
        subPx: ((y1 - y0) * c.subMin) / c.plaqueHeight,
      })
    }
    return { frame, lateral: Math.min(...c.lines.map((l) => Math.abs(frame[0] - l.origin.x))), near: c.lines.filter((l) => l.near).length, wants: c.lines.filter((l) => l.wants).length, drawn, canvas: [cv.width, cv.height] }
  }
  /** How far the car is from the lens along its axis, in metres, now: at the screen's default zoom this is the depth the design is made for (see `reachRow`). */
  Q.carDepth = () => { const cam = A.camera, car = A.driving.vehicle.position; cam.updateMatrixWorld(true); const e = cam.matrixWorldInverse.elements; return -(e[2] * car.x + e[6] * car.y + e[10] * car.z + e[14]) }
  /**
   * A static pose, judged (the `still` section). `pose.mode` 'arrive': the camera is set, the car put from far away (every plaque is put away first), then
   * left; 'orbit': the car put at the default camera and left 1.2 s, then the camera snapped to the pose. Either way the pose is then left for `settle` ms, and
   * every tick of the last `window` ms the (wants, near, crowded) of every line is read after the controller has run; a change of any of them is counted. At
   * the end every plaque that speaks is measured: how much of it the canvas cuts, how much of it is under the page's controls. Nothing moves meanwhile.
   */
  Q.still = async (pose, settle, window) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const camera = (theta, phi, zoom) => Q.camera(theta, phi, zoom)
    // The car is put where the game would put it (a pose the placement accepts, nudged to the nearest that is free: the cycle was found at such poses, and the exact place the
    // QA's `place` puts it at is a pose a player's car is not at).
    const put = (x, z, local) => {
      // (the heading is the one the cycle was found with; the camera's azimuth is fixed, the car's heading does not move a plaque)
      const w = c.group.localToWorld(new T.Vector3(x, 0, z))
      const heading = 0.3
      const d = A.driving
      let pose = d.placement.check(w.x, w.z, heading, { dynamicMargin: 0.1 })
      if (!pose.ok) pose = d.placement.near?.(w.x, w.z, { radius: 6, step: 1, prefer: [{ heading, weight: 1 }], dynamicMargin: 0.1 }) ?? pose
      if (pose.ok) d.place(pose, { reason: 'travel' })
      else Q.place(x, z, local)
    }
    if (pose.mode === 'arrive') {
      camera(pose.theta, pose.phi, pose.zoom)
      put(pose.far[0], pose.far[1], pose.local)
      await wait(150)
      put(pose.x, pose.z, pose.local)
    } else {
      camera(Math.PI / 4, 0.27 * Math.PI, 0.6)
      put(pose.far[0], pose.far[1], pose.local)
      await wait(150)
      put(pose.x, pose.z, pose.local)
      await wait(1200)
      camera(pose.theta, pose.phi, pose.zoom)
    }
    const key = (l) => (l.wants ? 1 : 0) | (l.near ? 2 : 0) | (l.crowded ? 4 : 0)
    const last = new Map(), changes = {}
    let frames = 0
    const t0 = performance.now()
    const handle = () => {
      const t = performance.now() - t0
      for (const l of c.lines) {
        const k = key(l), id = l.stop.id
        if (t >= settle - window && last.has(id) && last.get(id) !== k) changes[id] = (changes[id] ?? 0) + 1
        last.set(id, k)
      }
      if (t >= settle - window) frames++
    }
    A.driving.ticker.events.on('tick', handle, 99)
    await wait(settle)
    A.driving.ticker.events.off('tick', handle)
    const cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect(), v = new T.Vector3()
    cam.updateMatrixWorld(true)
    const rect = (id) => { const b = document.getElementById(id)?.getBoundingClientRect(); return b && b.width > 0 && b.height > 0 ? { x0: b.left - cv.left, y0: b.top - cv.top, x1: b.right - cv.left, y1: b.bottom - cv.top } : null }
    const hud = ['player-nav', 'touch-controls', 'drive-hud'].map(rect).filter(Boolean)
    const rows = []
    for (const l of c.lines) {
      if (!l.wants && !(l.reveal > 0.05)) continue
      const row = { id: l.stop.id, wants: l.wants, near: l.near, crowded: l.crowded, latched: !!l.latched, reveal: +l.reveal.toFixed(3), off: 0, hud: 0 }
      const m = l.label
      if (m && l.reveal > 0.05) {
        m.updateWorldMatrix(true, false); m.geometry.computeBoundingBox()
        const bb = m.geometry.boundingBox
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
        for (const xx of [bb.min.x, bb.max.x]) for (const yy of [bb.min.y, bb.max.y]) {
          v.set(xx, yy, 0).applyMatrix4(m.matrixWorld).project(cam)
          const sx = (v.x * 0.5 + 0.5) * cv.width, sy = (-v.y * 0.5 + 0.5) * cv.height
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
        }
        const area = Math.max(1, (x1 - x0) * (y1 - y0))
        const ix = Math.max(0, Math.min(cv.width, x1) - Math.max(0, x0)), iy = Math.max(0, Math.min(cv.height, y1) - Math.max(0, y0))
        row.off = +(1 - (ix * iy) / area).toFixed(3)
        for (const h of hud) {
          const ox = Math.max(0, Math.min(x1, h.x1) - Math.max(x0, h.x0)), oy = Math.max(0, Math.min(y1, h.y1) - Math.max(y0, h.y0))
          row.hud = Math.max(row.hud, +((ox * oy) / area).toFixed(3))
        }
      }
      rows.push(row)
    }
    return { changes, frames, rows }
  }
  /**
   * The car shuffles `amp` m to and fro along `axis` ('x': across the lanes, 'z': along the road) with the period `per` s (real time: the game's own loop, its own
   * frame times) round (cx, cz), `settle` ms after it was put there, for `dur` ms, and every tick records, for each stop, the changes of (wants, near, crowded), the
   * crossings of 0.5 by its reveal and the plaques wiped away to be put elsewhere (`relocating`). Called for one
   * centre after another without putting the car away between them: the plaques are as the centre before left them (that is how a player's car reaches a place).
   */
  Q.shuffle = async (cx, cz, axis, amp, per, settle, dur) => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    Q.place(cx, cz)
    await wait(settle)
    const key = (l) => (l.wants ? 1 : 0) | (l.near ? 2 : 0) | (l.crowded ? 4 : 0)
    const per_ = {}
    for (const l of c.lines) per_[l.stop.id] = { events: 0, cross: 0, relocations: 0, last: key(l), hi: l.reveal > 0.5, rel: l.relocating, steps: 0 }
    const t0 = performance.now()
    let frames = 0
    await new Promise((resolve) => {
      const handle = () => {
        const t = performance.now() - t0
        if (t > dur) { A.driving.ticker.events.off('tick', handle); resolve(); return }
        const o = amp * Math.sin((2 * Math.PI * (t / 1000)) / per)
        if (axis === 'z') Q.place(cx, cz + o); else Q.place(cx + o, cz)
        frames++
        for (const l of c.lines) {
          const r = per_[l.stop.id], k = key(l), hi = l.reveal > 0.5
          if (k !== r.last) { r.events++; r.last = k }
          if (hi !== r.hi) { r.cross++; r.hi = hi }
          if (l.relocating && !r.rel) r.relocations++
          r.rel = l.relocating
        }
      }
      A.driving.ticker.events.on('tick', handle, 99)
    })
    return { frames, per: Object.fromEntries(Object.entries(per_).map(([id, r]) => [id, { events: r.events, cross: r.cross, relocations: r.relocations }])) }
  }
  /**
   * The car is carried along a straight line, `speed` m/s, placed every tick after the controller has run (the labels QA's pass), while every
   * tick records which stops' plaques may speak (`near`) and how revealed each is: for the flicker judgement of the `reach` section.
   * `from` and `to` are [x, z] in the career's frame.
   */
  /** How far a plaque's nearest edge is from its stone's anchor, over the canvas's shorter side, as this frame's camera sees it (NaN: not drawn). */
  Q.gapShare = (l) => {
    if (!l.label || !(l.reveal > 0.3) || !l.pivot.visible) return NaN
    const cam = A.camera, cv = A.renderer.domElement.getBoundingClientRect(), v = new T.Vector3()
    cam.updateMatrixWorld(true)
    const m = l.label
    m.updateWorldMatrix(true, false)
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    const bb = m.geometry.boundingBox
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const xx of [bb.min.x, bb.max.x]) for (const yy of [bb.min.y, bb.max.y]) {
      v.set(xx, yy, 0).applyMatrix4(m.matrixWorld).project(cam)
      const sx = (v.x * 0.5 + 0.5) * cv.width, sy = (-v.y * 0.5 + 0.5) * cv.height
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy)
    }
    const a = l.pivot.getWorldPosition(v).project(cam), ax = (a.x * 0.5 + 0.5) * cv.width, ay = (-a.y * 0.5 + 0.5) * cv.height
    return Math.hypot(Math.max(x0 - ax, 0, ax - x1), Math.max(y0 - ay, 0, ay - y1)) / Math.min(cv.width, cv.height)
  }
  Q.carry = (from, to, speed) => new Promise((resolve) => {
    const ticker = A.driving.ticker
    const total = Math.hypot(to[0] - from[0], to[1] - from[1]), dir = [(to[0] - from[0]) / total, (to[1] - from[1]) / total]
    const series = c.lines.map(() => ({ near: [], reveal: [], gap: [], rel: [] }))
    let travelled = 0, last = performance.now()
    const handle = () => {
      const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now
      travelled += speed * dt
      if (travelled >= total) { ticker.events.off('tick', handle); resolve({ series, ticks: series[0].near.length }); return }
      Q.place(from[0] + dir[0] * travelled, from[1] + dir[1] * travelled, [dir[0], dir[1]])
      c.lines.forEach((l, i) => { series[i].near.push(l.near ? 1 : 0); series[i].reveal.push(l.reveal); series[i].gap.push(Q.gapShare(l)); series[i].rel.push(l.relocating ? 1 : 0) })
    }
    ticker.events.on('tick', handle, 99)
  })
  /** The car held on `x`, then moved a little either side of it every tick for `ticks` ticks: the flicker of an edge that is not moving. */
  Q.jitter = (x, z, amplitude, ticks, field = 'near') => new Promise((resolve) => {
    const ticker = A.driving.ticker
    const near = c.lines.map(() => [])
    let n = 0
    const handle = () => {
      Q.place(x + (n % 2 ? amplitude : -amplitude), z)
      c.lines.forEach((l, i) => near[i].push(l[field] ? 1 : 0))
      if (++n >= ticks) { ticker.events.off('tick', handle); resolve(near) }
    }
    ticker.events.on('tick', handle, 99)
  })
  globalThis.__Q = Q
  return true
}

/**
 * Luminance (Rec. 709, 0..255) at every css-px point of every digit, read out of a real screenshot: `mean` of the 3x3 patch centred on
 * it, and `best`, the brightest 3x3 patch within a pixel of it. A lit bar of a plate that is 74 to 90 px wide is 3 or 4 device px
 * thick across (the horizontal ones are foreshortened), so a patch that is a pixel off its middle takes in a row of the plate and reads
 * 190 to 230 for a bar that is 241 where it is drawn: `best` is the bar's own colour, `mean` is what an unlit one must stay under.
 */
async function sample(page, points, buffer) {
  const b64 = buffer.toString('base64')
  return page.evaluate(async ({ b64, points }) => {
    const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob())
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height), g = canvas.getContext('2d', { willReadFrequently: true })
    g.drawImage(bitmap, 0, 0)
    const sx = bitmap.width / innerWidth, sy = bitmap.height / innerHeight
    const patch = (px, py, r) => {
      const data = g.getImageData(px - r, py - r, 2 * r + 1, 2 * r + 1).data
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
      return sum / (data.length / 4)
    }
    return points.map((row) => row.map(([x, y]) => {
      const px = Math.round(x * sx), py = Math.round(y * sy), r = 1
      if (px < r + 1 || py < r + 1 || px >= bitmap.width - r - 1 || py >= bitmap.height - r - 1) return null
      let best = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) best = Math.max(best, patch(px + dx, py + dy, r))
      return { mean: patch(px, py, r), best }
    }))
  }, { b64, points })
}

const ZOOMS = { default: 0.6, close: 1 }
const setZoom = async (page, name) => { await page.evaluate((r) => { __Q.A.driving.view.zoom.baseRatio = r }, ZOOMS[name]); await sleep(1400) }

/** Car at frame (x, z), the camera snapped behind it, the plate and the stones given time to follow. */
async function goto(page, x, z, local, wait = 1300) {
  await page.evaluate(([x, z, local]) => __Q.place(x, z, local), [x, z, local])
  await sleep(wait)
}

/** Tell lit from unlit bars at the screen positions of a digit table; `masks` are what the readout should show. */
async function pixelTest(page, masks, label, shotName) {
  const { screen, hidden } = await page.evaluate((m) => __Q.segmentPoints(m), masks)
  const buffer = await page.screenshot({ path: shotName ? file(shotName) : undefined })
  const lum = await sample(page, screen, buffer)
  const lit = [], unlit = [], missing = [], covered = []
  lum.forEach((row, d) => row.forEach((cell, s) => {
    if (cell === null) { missing.push(`${d}${'ABCDEFG'[s]}`); return }
    const v = (masks[d] >> s) & 1 ? cell.best : cell.mean
    // A bar behind the car, a raised stone or a label is still judged: the readout is drawn over them, and a year that
    // is half hidden is a wrong year. `covered` only says how many of them the scene stands in front of.
    if (hidden[d][s]) covered.push(`${d}${'ABCDEFG'[s]}`)
    // An unlit bar shows whatever is behind it; if the car, a stone or a label is there, a bright pixel says nothing about the readout.
    if ((masks[d] >> s) & 1) lit.push(v)
    else if (!hidden[d][s]) unlit.push(v)
  }))
  const litMin = lit.length ? Math.min(...lit) : NaN, unlitMax = unlit.length ? Math.max(...unlit) : NaN
  note(`${label}: lit bars L ${lit.length ? litMin.toFixed(0) : '-'}..${lit.length ? Math.max(...lit).toFixed(0) : '-'} (${lit.length}), unlit L ${unlit.length ? Math.min(...unlit).toFixed(0) : '-'}..${unlit.length ? unlitMax.toFixed(0) : '-'} (${unlit.length})${missing.length ? `, off screen ${missing.join(' ')}` : ''}${covered.length ? `, scene in front of ${covered.join(' ')}` : ''}`)
  return { litMin, litMax: lit.length ? Math.max(...lit) : NaN, unlitMax, lit: lit.length, unlit: unlit.length, missing: missing.length, covered: covered.length }
}

/** The runtime can need more than the 180 s lib allows for its first frame when other browsers share the GPU: one more go, on a fresh load. */
async function openPlayer(pg) {
  try { await openOnce(pg) } catch (error) { console.log(`openPlayer: ${String(error).split('\n')[0]}; loading once more`); await openOnce(pg) }
}

const browser = await launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
const errors = watch(page)
const CAREER_MODULE = 'public/archipelago/preview/portfolio/world2/interactions/Career.js'
async function legacyRoute(ctx) {
  const patch = opt('patch', '')
  if (patch && !args.includes('--legacy')) {
    // a negative control: serve the working tree's controller with some module constants replaced (NAME=value,NAME=value)
    let source = fs.readFileSync(CAREER_MODULE, 'utf8')
    for (const pair of patch.split(',')) {
      const [name, value] = pair.split('=')
      const pattern = new RegExp(`const ${name} = [^\\n]+`)
      if (!pattern.test(source)) throw new Error(`--patch: no constant ${name} in ${CAREER_MODULE}`)
      source = source.replace(pattern, `const ${name} = ${value}`)
    }
    await ctx.route('**/portfolio/world2/interactions/Career.js*', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: source }))
    console.log(`--patch: serving the working tree's Career controller with ${patch}`)
    return
  }
  const against = opt('against', '')
  if (against && !args.includes('--legacy')) {
    const body = fs.readFileSync(against, 'utf8')
    await ctx.route('**/portfolio/world2/interactions/Career.js*', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body }))
    console.log(`--against: serving the Career controller saved in ${against}`)
    return
  }
  if (!args.includes('--legacy')) return
  const legacy = spawnSync('git', ['show', `HEAD:${CAREER_MODULE}`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  if (legacy.status !== 0) throw new Error(`git show HEAD:${CAREER_MODULE} failed: ${legacy.stderr}`)
  await ctx.route('**/portfolio/world2/interactions/Career.js*', (route) => route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: legacy.stdout }))
  console.log('--legacy: serving the Career controller of git HEAD')
}
await legacyRoute(context)
await openPlayer(page)
await sleep(1500)
assert(await page.evaluate(install), 'the Career controller is running in /world', results)
const info = await page.evaluate(() => {
  const { c } = __Q
  return {
    stops: c.lines.length, lanes: c.lanes,
    sockets: c.sockets ?? null, rim: !!c.rim, lit: !!c.litSegments,
    lines: c.lines.map((l) => ({ id: l.stop.id, track: l.track.id, x: l.origin.x, head: l.origin.z, span: l.span, hasEnd: l.hasEnd })),
  }
})
const newApi = !!(info.sockets && info.rim)
const calm = async (pg, section) => { if (args.includes('--calm') && section !== 'physics' && section !== 'bump') await pg.evaluate(() => __Q.calm()) }
console.log(`career: ${info.stops} stops, new API ${newApi ? 'present' : 'absent (before the fix)'}`)
fs.writeFileSync(file('career-info.json'), JSON.stringify(info, null, 1))

/* =============================== physics =============================== */
if (want('physics')) {
  const remaining = await page.evaluate(() => __Q.phantoms())
  assert(remaining.length === 0, `no collider is left under the replaced authored pieces (${remaining.length}: ${remaining.join(', ') || 'none'})`, results)
  const owners = await page.evaluate(() => [...__Q.phantomOwners().entries()])
  note(`authored owners checked (${owners.length}): ${owners.map(([o]) => o).join(', ')}`)
  const rimBodies = await page.evaluate(() => __Q.A.physics.physicals.filter((p) => /career/i.test(String(p.owner))).map((p) => p.owner))
  assert(rimBodies.length === 0, `the generated rim has no collider of its own (${rimBodies.join(', ') || 'none'})`, results)
}

/* =============================== alignment =============================== */
if (want('alignment')) {
  if (newApi) {
    const report = await page.evaluate(() => {
      const { c, drop } = __Q
      const { rim, floor } = c.rim
      rim.updateWorldMatrix(true, false); floor.updateWorldMatrix(true, false)
      const objects = [rim, floor]
      const HALF = 0.2525
      /** Distance from (x, z) to where the ground stops being floor along a direction, 0.5 mm steps. */
      const reach = (x, z, dx, dz) => {
        let last = -1
        for (let d = 0; d <= 0.5; d += 0.0005) {
          const hit = drop(objects, x + dx * d, z + dz * d)
          if (hit?.object === floor) last = d
          else if (hit?.object === rim) return { edge: d, last }
        }
        return { edge: null, last }
      }
      const rows = []
      for (const s of c.sockets) {
        const row = { lane: s.lane, x: s.x, z: s.z, stops: s.stops }
        const centre = drop(objects, s.x, s.z)
        row.centre = centre && (centre.object === floor ? 'floor' : 'rim')
        // across the road: the socket walls are the only thing at +-0.2525 for any z in the hole
        const left = reach(s.x, s.z, -1, 0), right = reach(s.x, s.z, 1, 0)
        // down the road: off the channel (0.15 m to the side) so a line running on does not read as an opening
        const sideX = s.x + 0.15
        const back = reach(sideX, s.z, 0, 1), ahead = reach(sideX, s.z, 0, -1)
        row.width = left.edge !== null && right.edge !== null ? left.edge + right.edge : null
        row.centreX = left.edge !== null && right.edge !== null ? (right.edge - left.edge) / 2 : null
        row.length = back.edge !== null && ahead.edge !== null ? back.edge + ahead.edge : null
        row.centreZ = back.edge !== null && ahead.edge !== null ? (back.edge - ahead.edge) / 2 : null
        // a point 1 cm inside / outside the wall
        row.inside = [[-1, 0], [1, 0]].map(([dx]) => drop(objects, s.x + dx * (HALF - 0.01), s.z)?.object === floor).every(Boolean)
        row.outside = [[-1, 0], [1, 0]].map(([dx]) => drop(objects, s.x + dx * (HALF + 0.01), s.z)?.object === rim).every(Boolean)
        rows.push(row)
      }
      // stones against sockets
      const stones = c.lines.map((l) => {
        const socket = c.sockets.find((s) => s.lane === l.track.id && Math.abs(s.z - l.stoneHome.z) < 1e-6)
        return { id: l.stop.id, dx: socket ? Math.abs(l.stoneHome.x - socket.x) : null, dz: socket ? Math.abs(l.stoneHome.z - socket.z) : null }
      })
      // every floor triangle is a hole: sample the floor mesh and check it sits inside a rim opening, never under a wall
      let covered = 0, total = 0
      for (let i = 0; i < 4000; i++) {
        const s = c.sockets[i % c.sockets.length]
        const x = s.x + (Math.random() * 2 - 1) * 0.24, z = s.z + (Math.random() * 2 - 1) * 0.24
        total++
        if (drop(objects, x, z)?.object === floor) covered++
      }
      return { rows, stones, covered, total, colours: [...new Set(Array.from(floor.geometry.getAttribute('color').array.slice(0, 3)))].length }
    })
    fs.writeFileSync(file('alignment.json'), JSON.stringify(report, null, 1))
    const worst = (key) => Math.max(...report.rows.map((r) => (r[key] === null ? Infinity : Math.abs(r[key]))))
    const widths = report.rows.map((r) => r.width), lengths = report.rows.map((r) => r.length)
    assert(report.rows.every((r) => r.centre === 'floor'), `every socket centre is coloured floor (${report.rows.filter((r) => r.centre !== 'floor').length} are not)`, results)
    assert(widths.every((w) => w !== null && Math.abs(w - 0.505) < 0.0015), `every hole is 0.505 m across (${Math.min(...widths).toFixed(4)}..${Math.max(...widths).toFixed(4)})`, results)
    assert(lengths.every((w) => w !== null && Math.abs(w - 0.505) < 0.0015), `every hole is 0.505 m along the road (${Math.min(...lengths).toFixed(4)}..${Math.max(...lengths).toFixed(4)})`, results)
    assert(worst('centreX') < 0.001 && worst('centreZ') < 0.001, `every hole is centred on its socket within 1 mm (x ${(worst('centreX') * 1000).toFixed(2)} mm, z ${(worst('centreZ') * 1000).toFixed(2)} mm)`, results)
    assert(report.rows.every((r) => r.inside && r.outside), 'the rim wall is exactly 0.2525 m from every socket centre (floor 1 cm inside, rim 1 cm outside)', results)
    assert(report.covered === report.total, `the coloured floor fills the whole hole (${report.covered}/${report.total} probes)`, results)
    assert(report.stones.every((s) => s.dx !== null && s.dx < 1e-6 && s.dz < 1e-6), `every stone stands on its socket (max ${Math.max(...report.stones.map((s) => Math.max(s.dx, s.dz))).toExponential(1)} m)`, results)
    note(`${report.rows.length} sockets: ${report.rows.map((r) => `${r.lane[0]}${r.z.toFixed(2)}`).join(' ')}`)
    // After sliding, a stone ends on its tail socket.
    const slid = await page.evaluate(async () => {
      const { c } = __Q
      const out = []
      for (const l of c.lines) {
        __Q.place(l.stoneHome.x + (l.track.id === 'projects' ? -1 : 1), l.stoneHome.z - l.span - 1.2)
        await new Promise((r) => setTimeout(r, 2400))
        const socket = c.sockets.find((s) => s.lane === l.track.id && Math.abs(s.z - (l.stoneHome.z - l.span)) < 0.02)
        out.push({ id: l.stop.id, tail: l.stoneHome.z - l.span, z: l.stone.position.z, up: l.isUp, hasEnd: l.hasEnd, socket: !!socket })
      }
      return out
    })
    assert(slid.every((s) => Math.abs(s.z - s.tail) < 0.02 && (!s.hasEnd || s.socket)), `every stone that has an end slides to its tail socket (${slid.filter((s) => s.hasEnd).length} stones; worst ${Math.max(...slid.map((s) => Math.abs(s.z - s.tail))).toFixed(3)} m)`, results)
  } else {
    skip('alignment: career.sockets / career.rim are not there yet (before the fix); measuring the authored rim at the stones\' heads instead')
    const before = await page.evaluate(() => {
      const { c, drop, inst } = __Q
      const plate = inst.references.bySource.get('Plane.049')
      plate.updateWorldMatrix(true, false)
      const rimTop = (x, z) => { const h = drop([plate], x, z); return h && h.y > 0.08 ? 'rim' : null }
      const scan = (x, z, dx, dz) => { for (let d = 0; d <= 0.6; d += 0.0005) if (rimTop(x + dx * d, z + dz * d) === 'rim') return d; return null }
      return c.lines.map((l) => {
        const x = l.stoneHome.x, z = l.stoneHome.z
        const onRim = rimTop(x, z) === 'rim'
        const left = scan(x, z, -1, 0), right = scan(x, z, 1, 0)
        const width = left !== null && right !== null ? left + right : null
        return { id: l.stop.id, head: z, onRim, width, dx: width !== null ? (right - left) / 2 : null, inHole: !onRim && width !== null && Math.abs(width - 0.505) < 0.01 && Math.abs((right - left) / 2) < 0.02 }
      })
    })
    fs.writeFileSync(file('alignment-before.json'), JSON.stringify(before, null, 1))
    for (const r of before) note(`${r.id.padEnd(24)} head ${r.head.toFixed(3).padStart(7)}  rim under the stone: ${r.onRim ? 'yes' : 'no '}  hole across ${r.width === null ? 'none' : `${(r.width * 1000).toFixed(0)} mm`}  centre off ${r.dx === null ? '-' : `${(r.dx * 1000).toFixed(0)} mm`}  ${r.inHole ? 'IN A SOCKET' : ''}`)
    assert(before.every((r) => r.inHole), `every stone's head sits in a 0.505 m hole of the rim (${before.filter((r) => r.inHole).length}/${before.length} do)`, results)
  }
}

/* =============================== years =============================== */
if (want('years')) {
  await calm(page)
  for (const [year, z] of Object.entries(YEAR_POINTS)) {
    await goto(page, YEAR_X, z, [0, -1], 1700)
    const state = await page.evaluate(() => ({ year: __Q.c.year, masks: __Q.c.digitMasks, lit: __Q.c.litSegments ?? null }))
    const expected = masksOf(year)
    assert(state.year === Number(year), `z ${z}: the readout shows ${year} (${state.year})`, results)
    assert(JSON.stringify(state.masks) === JSON.stringify(expected), `z ${z}: the masks are the digit table for ${year} (${state.masks.join(',')})`, results)
    if (state.lit) assert(state.lit.every((row, d) => row.every((on, s) => on === !!((expected[d] >> s) & 1))), `z ${z}: litSegments equal the digit table for ${year}`, results)
    else skip(`z ${z}: career.litSegments is not there yet`)
    const px = await pixelTest(page, expected, `${year}`, `year-${year}-pixels.png`)
    assert(px.missing === 0 && px.lit >= 14 && px.litMin > 200, `${year}: every lit bar is bright (min L ${px.litMin.toFixed(0)}, ${px.lit} judged, ${px.covered} with the scene in front)`, results)
    assert(px.unlit === 0 || px.unlitMax < 130, `${year}: every visible unlit bar is dark (max L ${px.unlitMax.toFixed(0)}, ${px.unlit} judged)`, results)
  }
}

/* =============================== edges =============================== */
if (want('edges')) {
  await calm(page)
  await goto(page, YEAR_X, -1.26, [0, -1], 1500)
  for (const value of [8888, 2019]) {
    await page.evaluate((v) => __Q.c.writeYear(v), value)
    await sleep(1300)
    const state = await page.evaluate(() => ({ masks: __Q.c.digitMasks, lit: __Q.c.litSegments ?? null }))
    const expected = masksOf(value)
    assert(JSON.stringify(state.masks) === JSON.stringify(expected), `writeYear(${value}): masks ${state.masks.join(',')}`, results)
    if (state.lit) assert(state.lit.every((row, d) => row.every((on, s) => on === !!((expected[d] >> s) & 1))), `writeYear(${value}): litSegments equal the digit table`, results)
    const px = await pixelTest(page, expected, `writeYear(${value})`, `year-${value}-pixels.png`)
    assert(px.missing === 0 && px.lit >= 14 && px.litMin > 200 && (px.unlit === 0 || px.unlitMax < 130), `writeYear(${value}): visible lit bars bright (min ${px.litMin.toFixed(0)}, ${px.lit} judged), unlit dark (${px.unlit ? px.unlitMax.toFixed(0) : 'none'})`, results)
  }
  // Boundary jitter: 2024 -> 2025 is at z 0.867 (frame). Cross it back and forth by +-0.1 m: the year must change at most once.
  await goto(page, YEAR_X, 1.6, [0, -1], 1500)
  const changes = await page.evaluate(async () => {
    const { c } = __Q
    let last = c.year, n = 0
    const zs = [0.95, 0.80, 0.93, 0.78, 0.97, 0.82, 0.9, 0.85, 0.92, 0.8]
    for (const z of zs) { __Q.place(28.05, z); await new Promise((r) => setTimeout(r, 120)); if (c.year !== last) { n++; last = c.year } }
    return { changes: n, year: c.year }
  })
  assert(changes.changes === 0, `jitter of +-0.1 m around the 2024/2025 boundary changes the year ${changes.changes} times (year ${changes.year})`, results)
}

/* =============================== plate =============================== */
if (want('plate')) {
  await calm(page)
  await goto(page, YEAR_X, 2.99, [0, -1], 2200)
  const facing = await page.evaluate(() => {
    const { A, T, inst } = __Q
    const group = inst.references.bySource.get('refYear')
    group.updateWorldMatrix(true, false)
    // a digit's "up" is local -Z; where does it point on the ground, against where the lens looks?
    const up = new T.Vector3(0, 0, -1).transformDirection(group.matrixWorld); up.y = 0; up.normalize()
    const look = A.camera.getWorldDirection(new T.Vector3()); look.y = 0; look.normalize()
    return { degrees: Math.acos(Math.min(1, up.dot(look))) * 180 / Math.PI, scale: group.scale.x, yaw: group.rotation.y * 180 / Math.PI }
  })
  if (newApi) assert(facing.degrees < 3, `a digit's up is the camera's up within ${facing.degrees.toFixed(2)} degrees (plate yaw ${facing.yaw.toFixed(1)}, scale ${facing.scale.toFixed(2)})`, results)
  else { note(`before: a digit's up is ${facing.degrees.toFixed(1)} degrees off the camera's (scale ${facing.scale.toFixed(2)})`); assert(facing.degrees < 3, `a digit's up is the camera's up (${facing.degrees.toFixed(1)} degrees off)`, results) }
  // orbit the camera a quarter turn each way: the plate follows
  for (const turn of [90, -90, 180]) {
    const after = await page.evaluate(async (turn) => {
      const { A, T, inst } = __Q
      const view = A.driving.view
      const base = view.spherical.baseTheta ?? Math.PI * 0.25
      view.spherical.targetTheta = base + turn * Math.PI / 180
      await new Promise((r) => setTimeout(r, 2600))
      const group = inst.references.bySource.get('refYear')
      group.updateWorldMatrix(true, false)
      const up = new T.Vector3(0, 0, -1).transformDirection(group.matrixWorld); up.y = 0; up.normalize()
      const look = A.camera.getWorldDirection(new T.Vector3()); look.y = 0; look.normalize()
      return Math.acos(Math.min(1, up.dot(look))) * 180 / Math.PI
    }, turn)
    if (newApi) assert(after < 3, `after orbiting the camera ${turn} degrees the digits' up is still the camera's (${after.toFixed(2)} degrees off)`, results)
    else skip(`orbit ${turn}: the plate does not follow the camera before the fix (${after.toFixed(1)} degrees off)`)
  }
  await page.evaluate(() => { const v = __Q.A.driving.view; v.spherical.targetTheta = v.spherical.baseTheta ?? Math.PI * 0.25 })
  await sleep(1800)
  // the box never touches the education rim, whatever the heading
  const clearance = await page.evaluate(() => {
    const { T, inst, c } = __Q
    const group = inst.references.bySource.get('refYear'), box = inst.references.bySource.get('Plane.030')
    box.geometry.computeBoundingBox()
    const bb = box.geometry.boundingBox, saved = group.rotation.y
    const eduX = c.lanes.education - 0.3915
    let worst = Infinity, at = 0
    for (let deg = 0; deg < 360; deg += 2) {
      group.rotation.y = deg * Math.PI / 180
      group.updateWorldMatrix(true, true)
      let maxX = -Infinity
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const p = c.group.worldToLocal(box.localToWorld(new T.Vector3(x, y, z)))
        maxX = Math.max(maxX, p.x)
      }
      if (eduX - maxX < worst) { worst = eduX - maxX; at = deg }
    }
    group.rotation.y = saved; group.updateWorldMatrix(true, true)
    return { worst, at, eduX }
  })
  assert(clearance.worst > 0, `the plate's box stays ${(clearance.worst * 100).toFixed(1)} cm clear of the education rim at every heading (tightest at ${clearance.at} degrees)`, results)
  // a year change moves only the bars that change
  if (newApi) {
    await goto(page, YEAR_X, 1.6, [0, -1], 1600)
    const run = await page.evaluate(async () => {
      const { c } = __Q
      const before = c.digits.map((d) => Array.from(d.lift))
      const frames = []
      __Q.place(28.05, 0.3)
      const t0 = performance.now()
      while (performance.now() - t0 < 900) { frames.push({ t: performance.now() - t0, lift: c.digits.map((d) => Array.from(d.lift)), year: c.year }); await new Promise((r) => requestAnimationFrame(r)) }
      return { before, frames, goal: c.digits.map((d) => Array.from(d.goal)) }
    })
    const changing = run.goal.map((row, d) => row.map((g, s) => g !== run.before[d][s]))
    const flat = changing.flat()
    let strays = 0, midway = 0
    for (const f of run.frames) f.lift.forEach((row, d) => row.forEach((v, s) => { if (!changing[d][s] && v !== run.before[d][s]) strays++; if (changing[d][s] && v > 0.05 && v < 0.95) midway++ }))
    const settled = run.frames.find((f) => f.lift.every((row, d) => row.every((v, s) => v === run.goal[d][s])))
    assert(run.frames.at(-1).year === 2025 && flat.filter(Boolean).length === 3, `2024 -> 2025 changes exactly ${flat.filter(Boolean).length} bars (A, B, D of the last digit)`, results)
    assert(strays === 0, `the bars that do not change never move (${strays} stray frames)`, results)
    assert(midway > 2, `the bars that change rise or sink in between (${midway} frames part-way)`, results)
    assert(settled && settled.t < 700, `and settle in ${settled ? settled.t.toFixed(0) : '>900'} ms`, results)
  } else skip('plate: per-bar animation needs the new readout')
}

/* =============================== readout =============================== */
/*
  The year has to be READ, not just lit: the chase camera looks along a diagonal, so the car beside the plate, the stone that
  slides with it 2.5 m up, and a lane's label can each stand between the lens and a bar; and a phone held upright sees
  about +-5 m either side of the car while the plate is 6.5 m in from the far lane. Every lit bar of every year is therefore
  judged in the real screenshot, on every lane, and the whole housing must be inside the viewport.
*/
const READOUT_VIEWS = [
  { name: 'desk', shownTo: 1, viewport: { width: 1440, height: 900 }, dsf: 1, mobile: false, lanes: [25.051, 26.05, 27.064, 28.05, 29.054], years: [2023, 2024, 2025, 2026, 2027], shots: [[25.051, 2027], [27.064, 2025], [29.054, 2027]] },
  { name: 'phone390', shownTo: 0.65, viewport: { width: 390, height: 844 }, dsf: 2, mobile: true, lanes: [25.051, 27.064, 29.054], years: [2023, 2025, 2027], shots: 'all' },
  { name: 'phone360', shownTo: 0.7, viewport: { width: 360, height: 640 }, dsf: 2, mobile: true, lanes: [25.051, 29.054], years: [2025, 2027], shots: 'all' },
  { name: 'tablet768', shownTo: 1, viewport: { width: 768, height: 1024 }, dsf: 1, mobile: true, lanes: [25.051, 29.054], years: [2024, 2027], shots: 'all' },
  { name: 'tablet', shownTo: 1, viewport: { width: 820, height: 1180 }, dsf: 1, mobile: true, lanes: [25.051, 29.054], years: [2024, 2027], shots: 'all' },
  { name: 'phoneLand', shownTo: 1, viewport: { width: 844, height: 390 }, dsf: 2, mobile: true, lanes: [25.051, 29.054], years: [2025, 2027], shots: 'all' },
]
if (want('readout')) {
  const only = opt('views', '') ? opt('views', '').split(',') : null
  for (const view of READOUT_VIEWS.filter((v) => !only || only.includes(v.name))) {
    const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
    let pg = page
    let extraErrors = null
    if (ctx) {
      await legacyRoute(ctx)
      pg = await ctx.newPage()
      extraErrors = watch(pg, `${view.name} `)
      await openPlayer(pg)
      await sleep(1500)
      await pg.evaluate(install)
    }
    await calm(pg)
    const failures = [], outside = []
    let judged = 0, lowest = Infinity, covered = 0, leads = []
    for (const x of view.lanes) {
      for (const year of view.years) {
        await goto(pg, x, YEAR_POINTS[year], [0, -1], 1700)
        const housing = await pg.evaluate(() => __Q.housing())
        const wantShot = view.shots === 'all' || view.shots.some(([sx, sy]) => sx === x && sy === year)
        const px = await pixelTest(pg, masksOf(year), `${view.name} x ${x} ${year}`, wantShot ? `readout-${view.name}-x${x}-${year}.png` : null)
        judged += px.lit
        covered += px.covered
        if (Number.isFinite(px.litMin)) lowest = Math.min(lowest, px.litMin)
        if (px.missing > 0 || !(px.litMin > 200) || (px.unlit > 0 && !(px.unlitMax < 130))) failures.push(`x ${x} ${year}: min lit L ${Number.isFinite(px.litMin) ? px.litMin.toFixed(0) : '-'}, ${px.missing} off screen`)
        const m = 4
        if (housing.x0 < m || housing.y0 < m || housing.x1 > housing.width - m || housing.y1 > housing.height - m) outside.push(`x ${x} ${year}: housing ${housing.x0.toFixed(0)}..${housing.x1.toFixed(0)} x ${housing.y0.toFixed(0)}..${housing.y1.toFixed(0)} of ${housing.width}x${housing.height}`)
        leads.push(await pg.evaluate(() => __Q.c.plateLead ?? null))
      }
    }
    assert(failures.length === 0, `${view.name} ${view.viewport.width}x${view.viewport.height}: all ${judged} lit bars of ${view.lanes.length * view.years.length} readouts are bright (lowest L ${lowest.toFixed(0)}; the scene stands in front of ${covered}, drawn over)${failures.length ? `: ${failures.slice(0, 3).join(' | ')}` : ''}`, results)
    assert(outside.length === 0, `${view.name}: the whole housing is inside the viewport on every lane and year${outside.length ? `: ${outside.slice(0, 3).join(' | ')}` : ''}`, results)
    if (ctx) { errors.push(...extraErrors); await ctx.close() }
  }
}

/* =============================== labels =============================== */
/*
  The year plate stands where nothing else does: left of the car on the screen, where the car, the stone that slides with it and the
  labels (which run up and to the right from the lane they speak on) never are. Where a screen has no room for that, the plate wins
  over a label instead, by a hole in the label. Both are judged on pixels of ONE frame, rendered three ways (see Q.labelPixels), at
  13 places down the road on every lane of every screen.
*/
const LABEL_STOPS = [7, 5.5, 4, 2.5, 1, -0.5, -2, -3.5, -5, -6.5, -8, -9.5, -11]
/** How much of all the label pixels the plate's hole may take, per screen: none on a screen with room, a little where a phone has not. */
const HOLE_BUDGET = { desk: 0.01, tablet: 0.01, tablet768: 0.01, phoneLand: 0.01, phone390: 0.06, phone360: 0.06 }
if (want('labels')) {
  const hasHole = await page.evaluate(() => !!__Q.c.plateRect)
  if (!hasHole) skip('labels: the plate\'s hole needs the new controller')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : null
    for (const view of READOUT_VIEWS.filter((v) => !only || only.includes(v.name))) {
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      let labels = 0, cut = 0, places = 0, worstOver = 0, worstCut = 0, worstAt = ''
      const overAt = []
      for (const x of view.lanes) {
        for (const z of LABEL_STOPS) {
          await goto(pg, x, z, [0, -1], 1700)
          const r = await pg.evaluate(() => __Q.labelPixels())
          places++
          labels += r.labels
          cut += r.cut
          const over = r.rect ? r.over / r.rect : 0
          worstOver = Math.max(worstOver, over)
          if (over > 0.005) overAt.push(`x ${x} z ${z}: ${(100 * over).toFixed(1)}% of the housing`)
          const share = r.labels ? r.cut / r.labels : 0
          if (share > worstCut) { worstCut = share; worstAt = `x ${x} z ${z}` }
        }
      }
      const took = labels ? cut / labels : 0
      note(`${view.name}: ${places} places, ${labels} label pixels, the hole takes ${cut} (${(100 * took).toFixed(2)}%), worst ${(100 * worstCut).toFixed(1)}% at ${worstAt || '-'}`)
      assert(labels > 0, `${view.name}: the labels are on the screen to be judged (${labels} label pixels at ${places} places)`, results)
      assert(overAt.length === 0, `${view.name} ${view.viewport.width}x${view.viewport.height}: no label is drawn over the year plate at ${places} places on ${view.lanes.length} lanes (worst ${(100 * worstOver).toFixed(2)}% of the housing's rectangle)${overAt.length ? `: ${overAt.slice(0, 3).join(' | ')}` : ''}`, results)
      assert(took <= HOLE_BUDGET[view.name], `${view.name}: the plate stands clear of the labels, so the hole takes ${(100 * took).toFixed(2)}% of their pixels (at most ${(100 * HOLE_BUDGET[view.name]).toFixed(0)}%)`, results)
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== car =============================== */
/*
  The year plate must not be on the car. The chase camera looks along a diagonal and a phone held upright sees only about 6 m of the
  road across, so the plate that stands left of the car on a desktop had no room to do so on a phone: it stood under the car and its
  digits were painted on the bonnet (30 of 60 positions at 390x844, up to 74% of the lit pixels on the car), and a QA that only asked
  "is every bar bright" called that a pass. The plate now takes the size the screen leaves it (see PLATE_MIN_PX in Career.ts), and
  where not even its floor fits, with the camera pinched in on a phone, it is away. This section judges the pixels of the same frame,
  rendered four ways (see Q.platePixels), on every lane of every screen, at the default camera and pinched in.

  It judges EVERY place down the road, the plaza before the walk too. That stretch used to be skipped as "the plate is at its home and
  the car drives over it", and it was the worst of all: up to 83% of the plate under the car and 91% of the lit pixels on it, on lanes
  23 to 26, on every screen. The plate now steps aside before the car reaches it (see DODGE_ENTER in Career.ts).
*/
const CAR_LANES = opt('lanes', '') ? opt('lanes', '').split(',').map(Number) : [22.3, 23.04, 24.0, 25.051, 26.05, 27.064, 29.054]
/** Down the road: the plaza before the walk (the plate's home is at 6.5), the walk's first metres, and the walk. */
const CAR_STOPS = opt('stops', '') ? opt('stops', '').split(',').map(Number) : [10, 8.5, 7, 6, 5, 4, 2, -1, -4, -7, -10]
/** Of the housing's rectangle, the car may cover this much (a wheel arch at the edge of the frame); of the lit pixels, this much may lie on the car. */
const CAR_BUDGET = { car: 0.05, lit: 0.005 }
/**
 * A pinch on a phone is how it is played, so every screen is judged at more than the default camera too (view.zoom.baseRatio: 0.6 is
 * the default, 1 the closest, a 15 m camera), at fewer places each. A screen that is wide enough keeps the plate beside the car at every
 * zoom; a phone held upright sees only 3 m of the road across at the closest, the car fills it, and there is no room left of it: past
 * `view.shownTo` the plate is away (nothing is drawn), and that is the only other thing it may be. It is never on the car.
 */
const CAR_ZOOMS = (view) => [...new Set([0.6, view.shownTo < 1 ? view.shownTo : 0.8, 0.8, 1])].sort((a, b) => a - b)
const CAR_STOPS_ZOOM = opt('stops', '') ? CAR_STOPS : [10, 6, 2, -3, -7, -10]
const ZOOM_ARG = opt('zooms', '') ? opt('zooms', '').split(',').map(Number) : null
/** The least plate that is worth reading, in css px (the housing's box): a 390x844 phone gets 90 x 33 at the default camera (the floor in Career.ts, PLATE_MIN_PX, is 74 px); pinched in, it may be as small as the floor. */
const PLATE_PX = { width: 80, height: 28 }
const PLATE_PX_ZOOMED = { width: 64, height: 22 }
if (want('car')) {
  const hasSize = await page.evaluate(() => typeof __Q.c.plateSize === 'number')
  if (!hasSize) skip('car: the plate does not take the size the screen leaves it before the fix')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : null
    for (const view of READOUT_VIEWS.filter((v) => !only || only.includes(v.name))) {
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      const portrait = view.viewport.height > view.viewport.width
      const zooms = ZOOM_ARG ?? (portrait ? CAR_ZOOMS(view) : [0.6, 1])
      for (const zoom of zooms) {
        const base = zoom === 0.6
        await pg.evaluate((r) => { __Q.A.driving.view.zoom.baseRatio = r }, zoom)
        await sleep(1200)
        const stops = base ? CAR_STOPS : CAR_STOPS_ZOOM
        const tag = base ? view.name : `${view.name} at zoom ${zoom}`
        const required = zoom <= view.shownTo
        const bad = [], missing = [], halfway = []
        let places = 0, aside = 0, worstCar = 0, worstLit = 0, worstStone = 0, worstLitStone = 0, smallest = null, worstAt = '', worstPlaza = 0, radius = 0
        const widths = [], sizes = [], away = [], seen = []
        for (const x of CAR_LANES) {
          for (const z of stops) {
            await goto(pg, x, z, [0, -1], 1300)
            const r = await pg.evaluate(() => ({ ...__Q.platePixels(), radius: __Q.A.driving.view.spherical.radius.current, place: __Q.c.platePlace }))
            radius = r.radius
            const car = r.car / Math.max(1, r.area), lit = r.litOnCar / Math.max(1, r.lit), stone = r.stone / Math.max(1, r.area)
            // Shown: the plate is all there and the whole housing is in the picture. Away: it is nothing (pop 0), and paints no pixel. A plate
            // in the walk next to the car is one or the other once it has had time to settle; and it is shown wherever the screen has the room.
            const inView = r.box[0] >= 4 && r.box[1] >= 4 && r.box[2] <= r.viewport[0] - 4 && r.box[3] <= r.viewport[1] - 4
            const shown = r.pop >= 0.99 && inView, gone = r.pop < 0.05
            // (the far lane's plate stands 6 m from the car: on a portrait tablet at the closest camera that is off the side of the picture whatever the car does)
            const walk = z <= 4 && x >= 24 && (zoom <= 0.8 || x <= 27.064)
            if (shown) { widths.push(r.width); sizes.push(r.size); seen.push({ x, z, width: r.width, height: r.height, size: r.size, place: r.place }) } else away.push(`x ${x} z ${z}${gone ? '' : ' (not there)'}`)
            if (walk && required && !shown) missing.push(`x ${x} z ${z}: ${gone ? 'away' : `pop ${r.pop.toFixed(2)}, ${inView ? 'in the picture' : 'out of the picture'}`}`)
            if (walk && !shown && !gone) halfway.push(`x ${x} z ${z}: pop ${r.pop.toFixed(2)}, ${inView ? 'in' : 'out of'} the picture`)
            if (shown && (!smallest || r.width < smallest.width)) smallest = { width: r.width, height: r.height, size: r.size }
            places++
            if (r.offset < -0.05) aside++
            if (gone) continue
            if (z > 4) worstPlaza = Math.max(worstPlaza, car)
            if (car > worstCar) { worstCar = car; worstAt = `x ${x} z ${z}` }
            worstLit = Math.max(worstLit, lit)
            worstStone = Math.max(worstStone, stone)
            worstLitStone = Math.max(worstLitStone, r.litOnStone / Math.max(1, r.lit))
            if (car > CAR_BUDGET.car || lit > CAR_BUDGET.lit) bad.push(`x ${x} z ${z}: car ${(100 * car).toFixed(1)}% of the plate, ${(100 * lit).toFixed(1)}% of the lit pixels on it`)
          }
        }
        smallest ??= { width: 0, height: 0, size: 0 }
        const widest = widths.length ? Math.max(...widths) : 0, narrowest = widths.length ? Math.min(...widths) : 0
        const gones = away.filter((a) => !a.includes('not there')).length
        note(`${tag} (camera ${radius.toFixed(1)} m): ${places} places (the plate stood behind its home at ${aside}; away or out of the picture at ${away.length}, away at ${gones}); plate ${narrowest.toFixed(0)}..${widest.toFixed(0)} px wide (smallest scale ${smallest.size.toFixed(2)}), ${smallest.height.toFixed(0)} px tall; worst car share ${(100 * worstCar).toFixed(1)}% at ${worstAt || '-'} (${(100 * worstPlaza).toFixed(1)}% before the walk), a raised stone under ${(100 * worstStone).toFixed(1)}% of it (${(100 * worstLitStone).toFixed(1)}% of the lit pixels)`)
        if (away.length) note(`${tag}: no plate in the picture at ${away.join(', ')}`)
        fs.writeFileSync(file(`car-${tag.replace(/[^a-z0-9.]+/gi, '-')}.json`), JSON.stringify({ tag, radius, places, away, seen }, null, 1))
        if (base) assert(places >= 60, `${tag}: the plate is judged at ${places} places, the plaza before the walk included`, results)
        assert(bad.length === 0, `${tag} ${view.viewport.width}x${view.viewport.height}: the plate is not on the car at ${places} places on ${CAR_LANES.length} lanes, from z ${stops[0]} in the plaza to z ${stops[stops.length - 1]} (car under at most ${(100 * worstCar).toFixed(1)}% of the plate, ${(100 * worstLit).toFixed(1)}% of the lit pixels on it)${bad.length ? `: ${bad.slice(0, 3).join(' | ')}` : ''}`, results)
        assert(halfway.length === 0, `${tag}: in the walk the plate is either all there or away, never half way or out of the picture (${halfway.length}${halfway.length ? `: ${halfway.slice(0, 3).join(' | ')}` : ''})`, results)
        if (required) assert(missing.length === 0, `${tag}: the screen has the room (zoom ${zoom} is no further in than ${view.shownTo}), so the plate stands beside the car at every place in the walk on lanes 24 and up (${missing.length} do not${missing.length ? `: ${missing.slice(0, 3).join(' | ')}` : ''})`, results)
        const floor = base ? PLATE_PX : PLATE_PX_ZOOMED
        if (seen.length) assert(smallest.width >= floor.width && smallest.height >= floor.height, `${tag}: the plate is still big enough to read at its smallest (${smallest.width.toFixed(0)} x ${smallest.height.toFixed(0)} px, scale ${smallest.size.toFixed(2)}; at least ${floor.width} x ${floor.height})`, results)
        if (base) {
          // Its scale follows the lane a little (the further lane is further from the lens, so the same room holds a bigger plate), which keeps its size on the screen about the same: it must not breathe as the car changes lane.
          const smallestSize = Math.min(...sizes), biggestSize = Math.max(...sizes)
          assert(biggestSize / smallestSize < 1.3, `${tag}: the plate's scale changes by at most 30% from one lane to another and not at all down the road (${smallestSize.toFixed(2)}..${biggestSize.toFixed(2)})`, results)
        }
      }
      await pg.evaluate((r) => { __Q.A.driving.view.zoom.baseRatio = r }, 0.6)
      await sleep(900)
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== reach =============================== */
/*
  A stop speaks while the car is level with it down the road, which is true of a car 40 m away across the grass. Before the reach was
  limited, every plaque of the walk was revealed from there, and the layout pulled each of them across the screen to the lens: slabs
  up to 3000 px wide, with a hole cut for the car. The first QA only ever drove the car along the lanes, so it never saw it. This one
  puts the car all round the lane group, from every direction and at every distance, and looks at what is drawn.
*/
const REACH_CENTRE = [26.05, -2]
const REACH_FAR = 17.5
const REACH_RATIO = 1.4
const REACH_DESK_SHARE = 0.4
const REACH_ANCHOR = 1.7
// a speaking plaque's nearest edge is no further from its stone's anchor than this share of the canvas's shorter side (the layout's own limit is GAP_SHARE, 0.26)
const REACH_GAP = 0.3
// while the car drives (5 m/s) and a plaque is more than 30% revealed, wiping in or out where it stood: the slide trails a moving car, so a little more
const REACH_DRIVE_GAP = 0.4
// the shortest time a plaque speaks for while the car is carried past (ticks of about 16 ms): the shortest stop speaks for 10 of them at 5 m/s, a plaque given up for a blip would be 1 to 5
const REACH_MIN_RUN = 6
// a plaque is no wider than this share of a canvas 768 px wide or more, unless its subtitle is then at the floor (12 px, with this much room for the measure)
const REACH_SUB_FLOOR = 12.6
// at the places on the lanes where the car is played, this share of the plaques that want to speak does (a layout that gives up every plaque it cannot place beside its stone passes the gap check for nothing). A phone held upright or on its side has no room for all three beside their stones at every place (the car is half its width, or the top bar, the year plate and the car fill its height): 68 to 88% do there
const REACH_SPEAK = { wide: 0.97, narrow: 0.6 }
// pinched in: no wider than the default camera's widest by more than this, no subtitle under this share of the default's smallest, no more than this share of a plaque under the page's controls
const REACH_PINCH = 1.15
const REACH_SUB = 0.9
const REACH_HUD = 0.05
if (want('reach')) {
  const gated = await page.evaluate(() => __Q.c.lines.length > 0 && 'near' in __Q.c.lines[0])
  if (!gated) skip('reach: the controller has no reach gate before the fix')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : null
    const quick = opt('grid', '') === 'quick', none = opt('grid', '') === 'none'
    const cameraArg = opt('cameras', '') ? opt('cameras', '').split(',') : null, noFlicker = opt('flicker', '') === 'off'
    const radii = none ? [] : quick ? [6, 12, 22, 42] : [6, 9, 12, 16, 22, 30, 42]
    const directions = quick ? 8 : 16
    const ring = (count, r) => Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2; return { x: REACH_CENTRE[0] + r * Math.cos(a), z: REACH_CENTRE[1] + r * Math.sin(a), a } })
    // the camera: azimuth theta and elevation phi in the View's own units (degrees round, and a share of pi from the vertical), as the labels QA orbits it
    const CAMERAS = [
      { name: 'default', theta: 45, phi: 0.27, radii, directions, lanes: true, views: null },
      { name: 'yaw-135', theta: 135, phi: 0.27, radii: [8, 14, 22], directions: 12, views: ['desk', 'phone390'] },
      { name: 'yaw-225', theta: 225, phi: 0.27, radii: [8, 14, 22], directions: 12, views: ['desk', 'phone390'] },
      { name: 'yaw-315-low', theta: 315, phi: 0.4, radii: [8, 14, 22], directions: 12, views: ['desk', 'phone390'] },
      // The camera pinched or wheeled in (0.8: a 23 m camera on a phone, 18 m on a desktop; 1: 15 m on both): the car round the lane group as before, and ON the lanes, which is where it is played. The size a plaque has is its design's at the default camera, not the zoom's.
      { name: 'zoom-0.8', theta: 45, phi: 0.27, zoom: 0.8, radii: [6, 12, 22], directions: 12, lanes: true, views: ['desk', 'phone390'] },
      { name: 'zoom-1', theta: 45, phi: 0.27, zoom: 1, radii: [6, 12, 22], directions: 12, lanes: true, views: ['desk', 'phone390', 'tablet', 'phoneLand'] },
      { name: 'zoom-1-yaw-225', theta: 225, phi: 0.27, zoom: 1, radii: [8, 14], directions: 8, lanes: true, views: ['desk', 'phone390'] },
    ]
    // the car on the lanes, driving down the road, at the places it passes a stop (a lane is 2 m from the next; z is the road's own)
    const LANE_POSES = [25.05, 27.06, 29.05].flatMap((x) => [-8, -3, 1, 6].map((z) => ({ x, z, a: Math.PI / 2 })))
    for (const view of READOUT_VIEWS.filter((v) => !only || only.includes(v.name))) {
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      // The depth the design is made for: the car's depth along the lens axis with the camera at the screen's default zoom, measured off the camera itself.
      await pg.evaluate(() => __Q.camera((45 * Math.PI) / 180, 0.27 * Math.PI, 0.6))
      await goto(pg, 27.05, 2, [0, -1], 1300)
      const designDepth = await pg.evaluate(() => __Q.carDepth())
      note(`${view.name} ${view.viewport.width}x${view.viewport.height}: the camera at its default zoom is ${designDepth.toFixed(1)} m from the car`)
      // Wider than 40% of the canvas is a slab on a screen 768 px wide or more, whichever way it is held (a desktop, a tablet upright or on its side, a landscape phone); a phone held upright is narrow, and its plaques are about half of it by design (the subtitle must be 12 px), so there it is the design width that is judged.
      const wide = view.viewport.width >= 768
      const rows = []
      for (const camera of CAMERAS.filter((k) => !cameraArg || cameraArg.includes(k.name)).filter((k) => !none && (!k.views || (quick ? k.views.includes(view.name) && view.name === 'desk' : k.views.includes(view.name))))) {
        await pg.evaluate(([t, p, z]) => __Q.camera((t * Math.PI) / 180, p * Math.PI, z), [camera.theta, camera.phi, camera.zoom ?? 0.6])
        const poses = []
        for (const r of camera.radii) for (const pose of ring(camera.directions, r)) poses.push({ r, x: pose.x, z: pose.z, heading: [-Math.cos(pose.a), -Math.sin(pose.a)] })
        if (camera.lanes) for (const pose of LANE_POSES) poses.push({ r: 0, x: pose.x, z: pose.z, heading: [0, -1] })
        for (const pose of poses) {
          // From further off than the whole area reaches (40 m): every plaque of the pose before is put away, so each pose is judged as an arrival, not as what a wipe left behind.
          await pg.evaluate(([x, z]) => __Q.place(x, z), [REACH_CENTRE[0] + 90, REACH_CENTRE[1]])
          await sleep(120)
          await goto(pg, pose.x, pose.z, pose.heading, 850)
          const row = await pg.evaluate((d) => __Q.reachRow(d), designDepth)
          rows.push({ camera: camera.name, r: pose.r, x: pose.x, z: pose.z, ...row })
        }
      }
      await pg.evaluate(() => __Q.camera((45 * Math.PI) / 180, 0.27 * Math.PI, 0.6))
      fs.writeFileSync(file(`reach-${view.name}.json`), JSON.stringify(rows))
      const drawn = rows.flatMap((row) => row.drawn.map((d) => ({ ...d, at: `${row.camera} r${row.r} (${row.frame.map((v) => v.toFixed(1))})`, lateral: row.lateral })))
      const big = drawn.filter((d) => d.ratio > REACH_RATIO)
      const wideOver = wide ? drawn.filter((d) => d.share > REACH_DESK_SHARE * 1.01 && d.subPx > REACH_SUB_FLOOR) : []
      // The plaque that speaks stands beside its stone: its nearest edge is within REACH_GAP of its anchor. (A plaque that is only wiping away, `near` false, goes where it stood.)
      const stranded = drawn.filter((d) => d.near && d.reveal > 0.9 && d.gap > REACH_GAP)
      const gapWorst = drawn.filter((d) => d.near && d.reveal > 0.9).reduce((m, d) => Math.max(m, d.gap), 0)
      // (a plaque that is only wiping away, `near` false, goes where its stone goes: the car's jitter on the edge of a stop's span can leave one such at any anchor, and its size is judged all the same)
      const stray = drawn.filter((d) => d.near && (Math.abs(d.anchor[0]) > REACH_ANCHOR || Math.abs(d.anchor[1]) > REACH_ANCHOR))
      const behind = drawn.filter((d) => d.behind)
      const far = rows.filter((row) => row.lateral > REACH_FAR && (row.drawn.length > 0 || row.near > 0))
      const out = drawn.filter((d) => d.reveal > 0.9 && !d.inside)
      const widest = drawn.reduce((m, d) => Math.max(m, d.share), 0), worstRatio = drawn.reduce((m, d) => Math.max(m, d.ratio), 0)
      const poses = rows.filter((row) => row.drawn.length > 0).length
      note(`${view.name} ${view.viewport.width}x${view.viewport.height}: ${rows.length} poses, plaques drawn at ${poses}; widest ${(100 * widest).toFixed(1)}% of the canvas, worst ${worstRatio.toFixed(2)}x its design width; furthest anchor ${drawn.reduce((m, d) => Math.max(m, Math.abs(d.anchor[0]), Math.abs(d.anchor[1])), 0).toFixed(2)}; ${out.length} fully-revealed plaques not wholly in the canvas`)
      const where = (list) => list.slice(0, 3).map((d) => `${d.id} ${(100 * d.share).toFixed(0)}% at ${d.at}`).join(' | ')
      for (const camera of CAMERAS.filter((k) => rows.some((row) => row.camera === k.name))) {
        const mine = drawn.filter((d) => d.at.startsWith(`${camera.name} `)), still = mine.filter((d) => d.reveal > 0.9 && d.near)
        note(`${view.name} ${camera.name}: ${mine.length} plaques drawn; widest ${(100 * mine.reduce((m, d) => Math.max(m, d.share), 0)).toFixed(1)}% of the canvas, worst ${mine.reduce((m, d) => Math.max(m, d.ratio), 0).toFixed(2)}x its design; speaking ones: smallest subtitle ${still.reduce((m, d) => Math.min(m, d.subPx), Infinity).toFixed(1)} px, most under the page's controls ${(100 * still.reduce((m, d) => Math.max(m, d.hud), 0)).toFixed(0)}%`)
      }
      assert(poses >= rows.length / 8, `${view.name}: the grid sees plaques (drawn at ${poses} of ${rows.length} poses)`, results)
      assert(big.length === 0, `${view.name} ${view.viewport.width}x${view.viewport.height}: no plaque is more than ${REACH_RATIO}x the width it is designed at, from any direction at any distance (${big.length} of ${drawn.length}${big.length ? `: ${where(big)}` : `; worst ${worstRatio.toFixed(2)}x`})`, results)
      if (wide) assert(wideOver.length === 0, `${view.name}: no plaque is wider than ${100 * REACH_DESK_SHARE}% of the canvas unless its subtitle is at ${REACH_SUB_FLOOR} px (${wideOver.length}; widest ${(100 * widest).toFixed(1)}%${wideOver.length ? `: ${where(wideOver)}` : ''})`, results)
      else assert(drawn.every((d) => d.share <= 1), `${view.name}: no plaque is wider than the canvas (widest ${(100 * widest).toFixed(1)}%)`, results)
      note(`${view.name}: the speaking plaques stand at most ${gapWorst.toFixed(2)} of the canvas's shorter side from their stones (${drawn.filter((d) => d.near && d.reveal > 0.9).length} judged)`)
      assert(stranded.length === 0, `${view.name}: a speaking plaque is no further than ${REACH_GAP} of the canvas's shorter side from its stone, whatever the camera (${stranded.length}; worst ${gapWorst.toFixed(2)}${stranded.length ? `: ${stranded.slice(0, 3).map((d) => `${d.id} ${d.gap.toFixed(2)} at ${d.at}`).join(' | ')}` : ''})`, results)
      // Not by giving everything up: on the lanes the plaques of the stops the car is level with do speak.
      const lanePoses = rows.filter((row) => row.r === 0 && row.wants > 0)
      const wanted = lanePoses.reduce((n, row) => n + row.wants, 0), spoken = lanePoses.reduce((n, row) => n + row.near, 0)
      const portrait = view.viewport.width < 768 || view.viewport.height < 500
      note(`${view.name}: at ${lanePoses.length} places on the lanes ${spoken} of the ${wanted} plaques that are wanted speak (${(100 * spoken / Math.max(1, wanted)).toFixed(0)}%)`)
      if (!none) assert(lanePoses.length >= 10 && spoken / Math.max(1, wanted) >= (portrait ? REACH_SPEAK.narrow : REACH_SPEAK.wide), `${view.name}: on the lanes at least ${100 * (portrait ? REACH_SPEAK.narrow : REACH_SPEAK.wide)}% of the plaques that are wanted speak (${spoken} of ${wanted} at ${lanePoses.length} places)`, results)
      assert(stray.length === 0, `${view.name}: a plaque speaks only while its stone is in the picture or just outside it (${stray.length}${stray.length ? `: ${where(stray)}` : ''})`, results)
      assert(behind.length === 0, `${view.name}: no plaque has a corner at the lens (${behind.length}${behind.length ? `: ${where(behind)}` : ''})`, results)
      assert(far.length === 0, `${view.name}: nothing is drawn or speaks when the car is more than ${REACH_FAR} m from every stone across the lanes (${far.length} of ${rows.filter((row) => row.lateral > REACH_FAR).length} poses${far.length ? `: ${far.slice(0, 3).map((row) => `${row.camera} r${row.r} (${row.frame.map((v) => v.toFixed(1))}) drawn ${row.drawn.length}`).join(' | ')}` : ''})`, results)
      assert(out.length === 0, `${view.name}: a fully revealed plaque is wholly in the canvas (${out.length}${out.length ? `: ${where(out)}` : ''})`, results)

      // The camera pinched or wheeled in. The size a plaque is designed at is the one at the screen's default camera, so zooming in must not make it bigger (it filled 117% to 173% of a phone at zoom 1,
      // with the first plaque cut off by the screen's edge and the next under the JUMP button), its subtitle must not shrink under what the default camera gives, and it stays clear of the page's controls.
      const pinched = CAMERAS.filter((k) => k.zoom && rows.some((row) => row.camera === k.name)).map((k) => k.name)
      if (pinched.length) {
        const speaking = (name) => drawn.filter((d) => d.at.startsWith(`${name} `) && d.reveal > 0.9 && d.near)
        const base = speaking('default'), close = pinched.flatMap(speaking)
        const baseWidest = base.reduce((m, d) => Math.max(m, d.share), 0), closeWidest = close.reduce((m, d) => Math.max(m, d.share), 0)
        const baseSub = base.reduce((m, d) => Math.min(m, d.subPx), Infinity)
        const covered = close.filter((d) => d.hud > REACH_HUD), small = close.filter((d) => d.subPx < baseSub * REACH_SUB)
        note(`${view.name}: at the default camera the widest speaking plaque is ${(100 * baseWidest).toFixed(1)}% of the canvas, its smallest subtitle ${baseSub.toFixed(1)} px; pinched in (${pinched.join(', ')}): ${(100 * closeWidest).toFixed(1)}%, smallest subtitle ${close.reduce((m, d) => Math.min(m, d.subPx), Infinity).toFixed(1)} px, most under the page's controls ${(100 * close.reduce((m, d) => Math.max(m, d.hud), 0)).toFixed(0)}%`)
        assert(close.length >= 12 && base.length >= 20, `${view.name}: the grid sees speaking plaques at the default camera (${base.length}) and pinched in (${close.length})`, results)
        assert(closeWidest <= baseWidest * REACH_PINCH, `${view.name}: pinched in, the widest plaque is no wider than at the default camera (${(100 * closeWidest).toFixed(1)}% of the canvas against ${(100 * baseWidest).toFixed(1)}%, at most ${REACH_PINCH}x)`, results)
        assert(small.length === 0, `${view.name}: pinched in, no subtitle is under ${100 * REACH_SUB}% of the smallest the default camera gives (${baseSub.toFixed(1)} px; ${small.length}${small.length ? `: ${small.slice(0, 3).map((d) => `${d.id} ${d.subPx.toFixed(1)} px at ${d.at}`).join(' | ')}` : ''})`, results)
        assert(covered.length === 0, `${view.name}: pinched in, no speaking plaque is more than ${100 * REACH_HUD}% under the page's controls (${covered.length}${covered.length ? `: ${covered.slice(0, 3).map((d) => `${d.id} ${(100 * d.hud).toFixed(0)}% at ${d.at}`).join(' | ')}` : ''})`, results)
      }

      // the edge of the reach does not flicker (the desktop and the 390x844 phone)
      if ((view.name === 'desk' || view.name === 'phone390') && !noFlicker) {
        const flips = (series) => { let n = 0; for (let i = 1; i < series.length; i++) if (series[i] !== series[i - 1]) n++; return n }
        const turns = (series) => { let n = 0, dir = 0; for (let i = 1; i < series.length; i++) { const d = series[i] - series[i - 1]; if (Math.abs(d) < 0.004) continue; const s = d > 0 ? 1 : -1; if (dir && s !== dir) n++; dir = s } return n }
        // Across the lanes (west, east) a stop's plaque speaks once, then is out of reach once: two changes. Along them a longer stop that a shorter one
        // interrupts (a project inside a job) can speak, give way and speak again: four.
        const carries = [['from the west', [-4, -1], [36, -1], 2], ['from the east', [40, -1], [0, -1], 2], ['from the north', [27, -30], [27, 14], 4], ['from the south', [27, 40], [27, -14], 4]]
        let zoomNow = 0.6
        // at the default camera, and at the closest (a plaque's anchor spreads further across the screen there, so the edge of the reach is in another place)
        for (const [zoom, name, from, to, most] of [0.6, 1].flatMap((z) => carries.map((c) => [z, ...c]))) {
          if (zoom !== zoomNow) { await pg.evaluate((z) => __Q.camera((45 * Math.PI) / 180, 0.27 * Math.PI, z), zoom); zoomNow = zoom }
          const tag = zoom === 0.6 ? name : `${name} at zoom ${zoom}`
          await goto(pg, from[0], from[1], [to[0] - from[0], to[1] - from[1]], 1500)
          const run = await pg.evaluate(([f, t]) => __Q.carry(f, t, 5), [from, to])
          const names = await pg.evaluate(() => __Q.c.lines.map((l) => l.stop.id))
          // A plaque the layout wipes away to be put on the other side of the car (`relocating`) turns its wipe back once for it, and again when it wipes in: two reversals for each, which are not an edge's flicker.
          const wipes = (series) => { let n = 0; for (let i = 1; i < series.length; i++) if (series[i] && !series[i - 1]) n++; return n }
          const worstFlips = Math.max(...run.series.map((s) => flips(s.near))), worstTurns = Math.max(...run.series.map((s) => turns(s.reveal) - 2 * wipes(s.rel))), worstWipes = Math.max(...run.series.map((s) => wipes(s.rel)))
          // while a plaque is drawn (more than 30% revealed), driving: no further from its stone than the layout's limit allows plus what a slide that trails a moving car costs
          // a plaque that speaks speaks for a while: no run of `near` that begins and ends inside the drive is shorter than REACH_MIN_RUN ticks (a car crossing the lanes can leave a plaque with no place for a tenth of a second, and a plaque that is given up for that long flashes)
          const runs = run.series.flatMap((s) => { const out = []; let n = 0; for (let i = 0; i < s.near.length; i++) { if (s.near[i] === 1) n++; else { if (n && i - n > 0) out.push(n); n = 0 } } return out })
          const shortest = runs.length ? Math.min(...runs) : Infinity
          assert(shortest >= REACH_MIN_RUN, `${view.name} carried ${tag} at 5 m/s: a plaque speaks for at least ${REACH_MIN_RUN} ticks at a time (the shortest run is ${shortest} ticks; kcl-gta, the shortest stop, speaks for 10)`, results)
          const driveGap = Math.max(0, ...run.series.flatMap((s) => s.gap.filter((g) => Number.isFinite(g))))
          const driveSpeaking = Math.max(0, ...run.series.flatMap((s) => s.gap.filter((g, i) => Number.isFinite(g) && s.near[i] === 1 && s.reveal[i] > 0.9)))
          note(`${view.name} carried ${tag}: while drawn a plaque stands at most ${driveGap.toFixed(2)} of the canvas's shorter side from its stone (speaking: ${driveSpeaking.toFixed(2)})`)
          assert(driveGap <= REACH_DRIVE_GAP, `${view.name} carried ${tag} at 5 m/s: a plaque that is drawn is never further than ${REACH_DRIVE_GAP} of the canvas's shorter side from its stone (${driveGap.toFixed(2)}; speaking ${driveSpeaking.toFixed(2)})`, results)
          const worst = run.series.map((s, i) => ({ id: names[i], flips: flips(s.near), turns: turns(s.reveal) - 2 * wipes(s.rel) })).sort((a, b) => b.flips - a.flips || b.turns - a.turns)[0]
          note(`${view.name} carried ${tag} at 5 m/s: ${run.ticks} ticks, a stop's plaque is turned on and off at most ${worstFlips} times, its wipe reverses at most ${worstTurns} times besides the ones a wipe away to be put elsewhere explains, and one plaque is wiped away and in ${worstWipes} times at most (${worst.id})`)
          assert(run.ticks > 100, `${view.name} ${tag}: sampled ${run.ticks} ticks`, results)
          assert(worstFlips <= most, `${view.name} carried ${tag} at 5 m/s: the reach of a plaque is crossed once in and once out (${worstFlips} changes, at most ${most}; ${worst.id})`, results)
          assert(worstTurns <= 4, `${view.name} carried ${tag} at 5 m/s: the wipe of a plaque is not turned back and forth at the edge (${worstTurns} reversals besides its wipes away to be put elsewhere; ${worst.id})`, results)
          assert(worstWipes <= 2, `${view.name} carried ${tag} at 5 m/s: a plaque is wiped away to be put on the other side of the car twice at most in a carry across the lanes (${worstWipes})`, results)
        }
        await pg.evaluate(() => __Q.camera((45 * Math.PI) / 180, 0.27 * Math.PI, 0.6))
        // Find the edge on the way in from the west (to a centimetre, from a car that starts outside it every time: the edge has a memory), then hold the car on it and shake it.
        // There are two: where a plaque WANTS to speak (the car within reach of its stone, the stone in the picture) and where it DOES (the layout has a place for it near its stone).
        for (const field of ['wants', 'near']) {
          const inside = async (x) => {
            await pg.evaluate(([x, z]) => __Q.place(x, z), [0, -1]); await sleep(160)
            await pg.evaluate(([x, z]) => __Q.place(x, z), [x, -1]); await sleep(160)
            return pg.evaluate((f) => __Q.c.lines.some((l) => l[f]), field)
          }
          let low = 0, high = 24
          const found = await inside(high)
          if (!found) assert(false, `${view.name}: the car is inside the ${field === 'wants' ? 'reach' : 'layout'} of a plaque at x ${high}, z -1`, results)
          else {
            for (let i = 0; i < 9; i++) { const mid = (low + high) / 2; if (await inside(mid)) high = mid; else low = mid }
            const edge = (low + high) / 2
            await pg.evaluate(([x, z]) => __Q.place(x, z), [0, -1]); await sleep(300)
            const series = await pg.evaluate(([x, z, f]) => __Q.jitter(x, z, 0.06, 120, f), [edge, -1, field])
            const worstJitter = Math.max(...series.map(flips)), seen = series.some((one) => one.includes(1))
            const what = field === 'wants' ? 'the edge of the reach' : 'the edge of the place the layout has for a plaque'
            note(`${view.name}: ${what} from the west is at x ${edge.toFixed(2)}; shaken by 6 cm each tick for 120 ticks, a plaque is turned on and off at most ${worstJitter} times`)
            // (the car is held ON the edge of the place the layout has: a plaque that has none for a moment is not let back for a moment, so it may stay away: no crossing is asked of it)
            if (field === 'wants') assert(seen, `${view.name}: the car shaken on the edge of the reach does cross it (a plaque is on at some tick)`, results)
            assert(worstJitter <= 2, `${view.name}: a car shaken by 6 cm on ${what} turns a plaque on and off at most twice (${worstJitter} times)`, results)
          }
        }
      }
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== still =============================== */
/*
  The verdicts hold. The reach section looks at a pose 0.85 s after the car is put there and the orbit section 1 s after the camera is: a plaque that is
  given up and let back every 230 ms, for ever, was never seen, because at any one look it is either on or off. Here every pose is left 3 s and the last
  1.5 s are read tick by tick: the (wants, near, crowded) of no line may change once.
*/
const STILL_SETTLE = 3000
const STILL_WINDOW = 1500
// a plaque that speaks is cut by the canvas by at most this share of its area
const STILL_OFF = 0.02
if (want('still')) {
  const gated = await page.evaluate(() => __Q.c.lines.length > 0 && 'near' in __Q.c.lines[0] && 'crowded' in __Q.c.lines[0])
  if (!gated) skip('still: the controller has no verdicts before the fix')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : null
    const grid = opt('grid', 'quick')
    const stride = (list, n) => (grid === 'full' ? list : list.filter((_, i) => i % n === 0))
    const DEG = Math.PI / 180
    const far = [REACH_CENTRE[0] + 90, REACH_CENTRE[1]]
    const ring = (radii, count) => radii.flatMap((r) => Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2; return { x: REACH_CENTRE[0] + r * Math.cos(a), z: REACH_CENTRE[1] + r * Math.sin(a), local: [-Math.cos(a), -Math.sin(a)] } }))
    const lanes = [25.05, 27.06, 29.05].flatMap((x) => [-8, -3, 1, 6].map((z) => ({ x, z, local: [0, -1] })))
    // the reach grid, as arrivals: the default camera on the ring and the lanes, and the camera pinched in all the way on the inner rings and the lanes
    const reachGrid = [
      ...stride(ring([6, 9, 12, 16, 22, 30, 42], 16).concat(lanes), 3).map((p) => ({ ...p, mode: 'arrive', theta: 45 * DEG, phi: 0.27 * Math.PI, zoom: 0.6, far, name: `reach default (${p.x.toFixed(1)}, ${p.z.toFixed(1)})` })),
      ...stride(ring([6, 12, 22], 12).concat(lanes), 3).map((p) => ({ ...p, mode: 'arrive', theta: 45 * DEG, phi: 0.27 * Math.PI, zoom: 1, far, name: `reach zoom-1 (${p.x.toFixed(1)}, ${p.z.toFixed(1)})` })),
    ]
    // the orbit grid: the car on three spots of the lanes, the camera dragged round it
    const orbitAll = []
    for (const [x, z] of [[27.1, -1], [25, 5], [29, 0.5]]) for (const zoom of [0.3, 0.6, 1]) for (const phi of [0.05, 0.27, 0.45]) for (let t = 0; t < 8; t++) orbitAll.push({ x, z, local: [0, -1], mode: 'orbit', theta: Math.PI / 4 + (t * 2 * Math.PI) / 8, phi: phi * Math.PI, zoom, far, name: `orbit (${x}, ${z}) zoom ${zoom} phi ${phi} yaw ${45 + t * 45}` })
    const orbitGrid = stride(orbitAll, 4)
    // the neighbourhood of the cycle that was found: a landscape phone pinched in, a low rear view, the car on the projects lane (local x 29)
    const hoodAll = []
    for (const z of [2, 0.5, -1.5]) for (const zoom of [0.85, 1]) for (const phi of [0.4, 0.45, 0.5, 0.55]) for (const yaw of [135, 180, 225, 270, 315]) hoodAll.push({ x: 29, z, zoomSet: zoom, phiSet: phi, yawSet: yaw, local: [0, -1], mode: 'orbit', theta: yaw * DEG, phi: phi * Math.PI, zoom, far, name: `hood (29, ${z}) zoom ${zoom} phi ${phi} yaw ${yaw}` })
    for (const view of READOUT_VIEWS.filter((v) => !only || only.includes(v.name))) {
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      // On the landscape phone the whole neighbourhood; on every screen the repro pose of the cycle and a sample of the neighbourhood.
      const hood = view.name === 'phoneLand' || grid === 'full' ? hoodAll : hoodAll.filter((p) => p.z === 0.5 && p.zoomSet === 1 && [0.45, 0.5].includes(p.phiSet) && [180, 225, 270].includes(p.yawSet))
      const poses = grid === 'hood' ? hood : [...reachGrid, ...orbitGrid, ...hood]
      const rows = []
      for (const pose of poses) {
        const row = await pg.evaluate(([pose, settle, window]) => __Q.still(pose, settle, window), [pose, STILL_SETTLE, STILL_WINDOW])
        rows.push({ name: pose.name, ...row })
      }
      await pg.evaluate(() => __Q.camera((45 * Math.PI) / 180, 0.27 * Math.PI, 0.6))
      fs.writeFileSync(file(`still-${view.name}.json`), JSON.stringify(rows))
      const flickering = rows.filter((r) => Object.values(r.changes).some((n) => n > 0))
      // what is on the screen at the end (a plaque more than a third revealed: speaking, or wiping away) is judged, not only what speaks: the cycle left plaques half wiped, under a button and over the edge
      const speaking = (r) => r.rows.filter((q) => q.reveal > 0.3)
      const half = rows.flatMap((r) => r.rows.filter((q) => q.reveal > 0.05 && q.reveal < 0.9).map((q) => `${r.name}: ${q.id} at ${q.reveal}`))
      const cut = rows.flatMap((r) => speaking(r).filter((q) => q.off > STILL_OFF).map((q) => `${r.name}: ${q.id} cut ${(100 * q.off).toFixed(0)}%`))
      const under = rows.flatMap((r) => speaking(r).filter((q) => q.hud > REACH_HUD).map((q) => `${r.name}: ${q.id} ${(100 * q.hud).toFixed(0)}% under a control`))
      const held = rows.filter((r) => r.rows.some((q) => q.latched)).length
      const worstOff = Math.max(0, ...rows.flatMap((r) => speaking(r).map((q) => q.off))), worstHud = Math.max(0, ...rows.flatMap((r) => speaking(r).map((q) => q.hud)))
      note(`${view.name} ${view.viewport.width}x${view.viewport.height}: ${rows.length} poses left ${STILL_SETTLE / 1000} s (${rows.filter((r) => r.name.startsWith('reach')).length} reach, ${rows.filter((r) => r.name.startsWith('orbit')).length} orbit, ${rows.filter((r) => r.name.startsWith('hood')).length} neighbourhood), ${flickering.length} with a verdict that changed in the last ${STILL_WINDOW / 1000} s, ${held} with a plaque held silent; ${rows.filter((r) => speaking(r).length > 0).length} poses with a plaque speaking; the plaques on the screen are cut by the canvas by at most ${(100 * worstOff).toFixed(1)}% and are under a control by at most ${(100 * worstHud).toFixed(1)}%`)
      if (flickering.length) note(`${view.name}: changed at ${flickering.slice(0, 6).map((r) => `${r.name} ${JSON.stringify(r.changes)}`).join(' | ')}`)
      assert(rows.length >= (grid === 'hood' ? 6 : 40), `${view.name}: ${rows.length} static poses judged`, results)
      assert(flickering.length === 0, `${view.name}: with the car parked and the camera still no plaque goes on and off, at any of ${rows.length} poses (${flickering.length} do${flickering[0] ? `: ${flickering[0].name} ${JSON.stringify(flickering[0].changes)}` : ''})`, results)
      assert(half.length === 0, `${view.name}: after 3 s no plaque is left half revealed (${half.length}${half[0] ? `: ${half.slice(0, 3).join(' | ')}` : ''})`, results)
      assert(cut.length === 0, `${view.name}: no plaque on the screen is cut by the canvas by more than ${STILL_OFF * 100}% at a still pose (${cut.length}${cut[0] ? `: ${cut.slice(0, 3).join(' | ')}` : ''})`, results)
      assert(under.length === 0, `${view.name}: no plaque on the screen is more than ${REACH_HUD * 100}% under the page's controls at a still pose (${under.length}${under[0] ? `: ${under.slice(0, 3).join(' | ')}` : ''})`, results)
      assert(rows.filter((r) => speaking(r).length > 0).length >= rows.length * 0.5, `${view.name}: a plaque speaks at half the poses at least, so that the stillness is not an empty screen (${rows.filter((r) => speaking(r).length > 0).length} of ${rows.length})`, results)
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== shuffle =============================== */
/*
  The car does not stand still on a lane either: a player's car rocks, reverses a little, is nudged by the fences. The car is shuffled a quarter of a metre to and fro, twice
  a second and a quarter, across the lanes, round a row of places in turn (the plaques as the place before left them: the state of a car that has just
  come from the next lane over), in real time, on the screens where the plaques have least room: a plaque whose verdict or place depends on a hair is on and off, or wiped
  away and in again, with the car. For each plaque at each place in 4 s: at most SHUFFLE_EVENTS changes of (wants, near, crowded), at most SHUFFLE_CROSS crossings of half
  revealed (the first wipe in is one), and at most SHUFFLE_RELOCATIONS wipes away to be put elsewhere. (The revision before the plaques were made to keep their places had
  3 of 33 places on a phone on its side that failed this: --against=.qa/runs/impl/career-solve3/Career.js.cur.)
*/
const SHUFFLE_EVENTS = 3
const SHUFFLE_CROSS = 2
const SHUFFLE_RELOCATIONS = 1
const SHUFFLE_VIEWS = ['phoneLand', 'phone390', 'desk']
if (want('shuffle')) {
  const gated = await page.evaluate(() => __Q.c.lines.length > 0 && 'crowded' in __Q.c.lines[0] && 'relocating' in __Q.c.lines[0])
  if (!gated) skip('shuffle: the controller has no verdicts or relocations before the fix')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : SHUFFLE_VIEWS
    const AMP = Number(opt('amp', '0.25')), PER = Number(opt('per', '0.8')), DUR = Number(opt('dur', '4000'))
    // across the lanes at two heights of the road, where three stops speak at once (shuffled along the road a car crosses the edge of a stop's span: the stop that is level with it
    // changes, as it should, and that is not the layout's: only the car's shuffle across the lanes is judged)
    const places = [...[22.06, 23.06, 24.06, 25.06, 26.06, 26.56, 27.06, 28.06, 29.06, 30.06, 31.06, 32.06].map((x) => ({ x, z: 0.5, axis: 'x' })), ...[24.06, 26.06, 28.06, 30.06].map((x) => ({ x, z: -2.5, axis: 'x' }))]
    for (const view of READOUT_VIEWS.filter((v) => only.includes(v.name))) {
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      await pg.evaluate(() => __Q.camera((45 * Math.PI) / 180, 0.27 * Math.PI, 0.6))
      const rows = []
      for (const place of places) {
        const row = await pg.evaluate(([place, amp, per, dur]) => __Q.shuffle(place.x, place.z, place.axis, amp, per, 900, dur), [place, AMP, PER, DUR])
        rows.push({ ...place, ...row })
      }
      fs.writeFileSync(file(`shuffle-${view.name}.json`), JSON.stringify(rows))
      const worst = (field) => Math.max(0, ...rows.flatMap((r) => Object.values(r.per).map((q) => q[field])))
      const bad = rows.filter((r) => Object.values(r.per).some((q) => q.events > SHUFFLE_EVENTS || q.cross > SHUFFLE_CROSS || q.relocations > SHUFFLE_RELOCATIONS))
      const frames = rows.reduce((n, r) => n + r.frames, 0)
      note(`${view.name} ${view.viewport.width}x${view.viewport.height}: the car shuffled ${AMP} m, period ${PER} s, at ${rows.length} places for ${DUR / 1000} s each (${frames} frames): at most ${worst('events')} changes of verdict, ${worst('cross')} crossings of half revealed and ${worst('relocations')} wipes away and in by one plaque at one place`)
      if (bad.length) note(`${view.name}: more than that at ${bad.slice(0, 5).map((r) => `(${r.x}, ${r.z} ${r.axis}) ${JSON.stringify(Object.fromEntries(Object.entries(r.per).filter(([, q]) => q.events || q.cross || q.relocations)))}`).join(' | ')}`)
      assert(rows.length === places.length && frames > places.length * 100, `${view.name}: the shuffle ran at every place (${rows.length} places, ${frames} frames)`, results)
      assert(bad.length === 0, `${view.name}: with the car shuffling, no plaque changes its verdict more than ${SHUFFLE_EVENTS} times, crosses half revealed more than ${SHUFFLE_CROSS} times or is wiped away and in more than ${SHUFFLE_RELOCATIONS} time in ${DUR / 1000} s, at any of ${places.length} places (${bad.length} do${bad[0] ? `: (${bad[0].x}, ${bad[0].z} ${bad[0].axis})` : ''})`, results)
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== pinch =============================== */
/*
  The camera does not stand still: a pinch on a phone takes the room beside the car away as fast as the fingers move, and the plate has
  to get out of the way at that speed (it gave way at 6 a second and was 7% on the bumper; it is solved every frame while the camera
  moves and gives way at 20). Judged frame by frame on a ramp of the zoom while the car stands in the walk on the lane beside the plate:
  the car under at most PINCH_BUDGET of it while it shows (a little more than the static 5%: it is moving), the plate going away (and
  coming back) once and not flickering, and where the screen has the room never going at all.
*/
const PINCH = [{ view: 'phone390', to: 0.9, ms: 1200, goesAway: true }, { view: 'tablet', to: 1, ms: 1200, goesAway: false }, { view: 'desk', to: 1, ms: 1200, goesAway: false }]
const PINCH_BUDGET = 0.06
if (want('pinch')) {
  const hasPlace = await page.evaluate(() => typeof __Q.c.platePlace === 'string')
  if (!hasPlace) skip('pinch: the plate does not know where it stands before the fix')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : null
    for (const spec of PINCH.filter((p) => !only || only.includes(p.view))) {
      const view = READOUT_VIEWS.find((v) => v.name === spec.view)
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      for (const x of [24.0, 25.051]) {
        await pg.evaluate((r) => { __Q.A.driving.view.zoom.baseRatio = r }, 0.6)
        await sleep(1000)
        await goto(pg, x, -3, [0, -1], 2000)
        const rows = await pg.evaluate(([from, to, ms]) => __Q.pinch(from, to, ms), [0.6, spec.to, spec.ms])
        const back = await pg.evaluate(([from, to, ms]) => __Q.pinch(from, to, ms), [spec.to, 0.6, spec.ms])
        const judge = (list) => {
          const showing = list.filter((r) => r.pop >= 0.5)
          const changes = list.filter((r, i) => i > 0 && r.place !== list[i - 1].place).length
          return { worst: Math.max(0, ...showing.map((r) => r.car)), changes, away: list.some((r) => r.place === 'away'), end: list[list.length - 1], n: list.length }
        }
        const inn = judge(rows), out = judge(back)
        note(`${view.name} x ${x}: pinch in (zoom 0.6 to ${spec.to} in ${spec.ms} ms, ${inn.n} frames): car under at most ${(100 * inn.worst).toFixed(1)}% of the plate, ${inn.changes} change of place, ends ${inn.end.place} at ${inn.end.size.toFixed(2)}; and out: ${(100 * out.worst).toFixed(1)}%, ${out.changes} change, ends ${out.end.place} at ${out.end.size.toFixed(2)}`)
        assert(inn.n >= 20 && out.n >= 20, `${view.name} x ${x}: the pinch was sampled at ${inn.n} and ${out.n} frames`, results)
        assert(inn.worst <= PINCH_BUDGET && out.worst <= PINCH_BUDGET, `${view.name} x ${x}: through a pinch the plate is never on the car (under at most ${(100 * inn.worst).toFixed(1)}% pinching in, ${(100 * out.worst).toFixed(1)}% out; at most ${100 * PINCH_BUDGET}%)`, results)
        assert(inn.changes <= (spec.goesAway ? 1 : 0) && out.changes <= (spec.goesAway ? 1 : 0), `${view.name} x ${x}: it goes away at most once and comes back at most once, and a screen with room never loses it (${inn.changes} and ${out.changes} changes of place)`, results)
        assert(out.end.place === 'left' && out.end.pop > 0.99, `${view.name} x ${x}: back at the default camera the plate is there again (${out.end.place}, ${(100 * out.end.pop).toFixed(0)}%)`, results)
      }
      await pg.evaluate((r) => { __Q.A.driving.view.zoom.baseRatio = r }, 0.6)
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== approach =============================== */
/*
  The plate must not be on the car WHILE DRIVING either, which is not the same as at every place the car can be put: the plate has to
  get out of the car's way as the car comes (see DODGE_ENTER), it grows with the chase camera's zoom (it took the room back in jumps
  that made it breathe on a phone), and its slide trails the car by what the car travels in a tenth of a second (the frame of it went
  16 px past the edge of a phone). So W is held, from the plaza, on the lanes next to the plate, and every sample down the road is
  judged on the pixels of the frame it was taken in (see Q.platePixels): the car under at most CAR_BUDGET of the plate, the lit pixels
  on it at most as much, the plate in view, and its size never changing by a visible step.
*/
const APPROACH_VIEWS = ['desk', 'phone390', 'tablet']
const APPROACH_LANES = [24.0, 25.051]
if (want('approach')) {
  const hasPop = await page.evaluate(() => typeof __Q.c.pop === 'number')
  if (!hasPop) skip('approach: the plate does not step aside before the fix')
  else {
    const only = opt('views', '') ? opt('views', '').split(',') : null
    for (const view of READOUT_VIEWS.filter((v) => APPROACH_VIEWS.includes(v.name) && (!only || only.includes(v.name)))) {
      const ctx = view.name === 'desk' ? null : await browser.newContext({ viewport: view.viewport, deviceScaleFactor: view.dsf, hasTouch: view.mobile, isMobile: view.mobile })
      let pg = page
      let extraErrors = null
      if (ctx) {
        await legacyRoute(ctx)
        pg = await ctx.newPage()
        extraErrors = watch(pg, `${view.name} `)
        await openPlayer(pg)
        await sleep(1500)
        await pg.evaluate(install)
      }
      await calm(pg)
      for (const x of APPROACH_LANES) {
        await goto(pg, x, 14, [0, -1], 1800)
        await pg.mouse.click(5, 5).catch(() => {})
        await pg.keyboard.down('KeyW')
        const rows = []
        const t0 = Date.now()
        while (Date.now() - t0 < 2600) rows.push(await pg.evaluate(() => __Q.platePixels()))
        await pg.keyboard.up('KeyW')
        await sleep(600)
        // The plate is nothing for a moment while it hops (pop < 0.5): there is no plate to be on the car then.
        const shown = rows.filter((r) => r.pop >= 0.5)
        const bad = shown.filter((r) => r.car / Math.max(1, r.area) > CAR_BUDGET.car || r.litOnCar / Math.max(1, r.lit) > CAR_BUDGET.lit)
        const worstCar = Math.max(0, ...shown.map((r) => r.car / Math.max(1, r.area))), worstLit = Math.max(0, ...shown.map((r) => r.litOnCar / Math.max(1, r.lit)))
        const walk = shown.filter((r) => r.z < 6 && r.z > -10.4)
        const past = Math.max(0, ...walk.map((r) => Math.max(-r.box[0], r.box[2] - r.viewport[0], -r.box[1], r.box[3] - r.viewport[1])))
        let step = 0
        for (let i = 1; i < shown.length; i++) if (shown[i].pop >= 0.99 && shown[i - 1].pop >= 0.99) step = Math.max(step, Math.abs(shown[i].size / shown[i - 1].size - 1))
        const hopped = rows.some((r) => r.pop < 0.5)
        note(`${view.name} x ${x}: ${rows.length} frames sampled while driving from z ${rows[0].z.toFixed(1)} to ${rows[rows.length - 1].z.toFixed(1)}, the plate hopped ${hopped ? 'once' : 'never'}; car under at most ${(100 * worstCar).toFixed(1)}% of it, ${(100 * worstLit).toFixed(1)}% of the lit pixels on it; frame past the screen edge by ${past.toFixed(1)} px; scale ${Math.min(...shown.map((r) => r.size)).toFixed(2)}..${Math.max(...shown.map((r) => r.size)).toFixed(2)}, biggest step ${(100 * step).toFixed(1)}% between frames`)
        assert(rows.length >= 20 && rows[0].z > 8 && rows[rows.length - 1].z < 0, `${view.name} x ${x}: the drive sampled ${rows.length} frames from the plaza (z ${rows[0].z.toFixed(1)}) into the walk (z ${rows[rows.length - 1].z.toFixed(1)})`, results)
        assert(bad.length === 0, `${view.name} x ${x}: driving in from the plaza, the plate is never on the car in ${shown.length} frames (car under at most ${(100 * worstCar).toFixed(1)}% of it, ${(100 * worstLit).toFixed(1)}% of the lit pixels on it)${bad.length ? `: z ${bad.slice(0, 3).map((r) => r.z.toFixed(1)).join(', ')}` : ''}`, results)
        assert(past <= 1, `${view.name} x ${x}: the housing never leaves the screen in the walk (past the edge by at most ${past.toFixed(1)} px)`, results)
        assert(step <= 0.08, `${view.name} x ${x}: the plate's scale changes smoothly while driving (at most ${(100 * step).toFixed(1)}% from one sampled frame to the next)`, results)
      }
      if (ctx) { errors.push(...extraErrors); await ctx.close() }
    }
  }
}

/* =============================== hop =============================== */
/*
  The plate cannot cross a car on the lane beside it without a moment of overlap, so it does not cross it in view: when the car is put
  or driven where its home is in the way, the plate shrinks out of sight where it stands, is put where it is going while it is
  nothing, and grows back. Judged frame by frame (requestAnimationFrame) after the car is put 5 m from where it was: while the plate
  is visible (pop above 0.05) it moves by less than a metre of road from where it stood, and it ends at its place at full size.
*/
if (want('hop')) {
  const hasPop = await page.evaluate(() => typeof __Q.c.pop === 'number')
  if (!hasPop) skip('hop: the plate does not hop before the fix')
  else {
    await calm(page)
    await goto(page, 24.0, 14, [0, -1], 1800)
    const before = await page.evaluate(() => __Q.c.yearOffset)
    const watching = page.evaluate(() => __Q.watch(1000))
    await page.evaluate(() => __Q.place(24.0, 8.5, [0, -1]))
    const rows = await watching
    const gone = rows.findIndex((r) => r.pop <= 0.05)
    const last = rows[rows.length - 1]
    // Until it is nothing the plate stays where it was; once it is back it is where it is going: it is never seen between the two.
    const sliding = Math.max(0, ...rows.slice(0, Math.max(0, gone)).map((r) => Math.abs(r.offset - before)), ...rows.slice(gone + 1).map((r) => Math.abs(r.offset - last.offset)))
    const hidden = rows.filter((r) => r.pop <= 0.05).length
    note(`hop: ${rows.length} frames, the plate was nothing for ${hidden} (frame ${gone}); it was seen ${sliding.toFixed(2)} m from the places it was before and after; from ${before.toFixed(1)} to ${last.offset.toFixed(1)} m behind its home, scale ${last.pop.toFixed(2)} of ${last.size.toFixed(2)}`)
    assert(hidden >= 1 && last.pop > 0.99 && last.offset < before - 3, `the plate hops out of the car's way when the car is put by its home (${hidden} frames of nothing, now ${(-last.offset).toFixed(1)} m behind it at ${(100 * last.pop).toFixed(0)}% of its size)`, results)
    assert(gone >= 2 && sliding < 0.5, `and is never seen sliding across the plaza: it stays where it was for ${gone} frames while it shrinks, and is where it is going once it is back (${sliding.toFixed(2)} m out of either place while it showed)`, results)
  }
}

/* =============================== collapse =============================== */
/*
  A canvas with no size for a moment (an iframe collapsed to nothing, a hidden tab's resize) gives the camera an aspect of NaN. The plate
  reads the camera, so a NaN that was kept from one frame to the next (the damped offset, the turn, the size) would leave it gone
  for good. It must come back as soon as the canvas does.
*/
if (want('collapse')) {
  await calm(page)
  /** Every number the plate and the labels keep from one frame to the next. */
  const kept = () => page.evaluate(() => {
    const { c } = __Q, g = c.yearGroup
    const numbers = { yearOffset: c.yearOffset, lead: c.plateLead, size: c.plateSize, scale: g.scale.x, turn: g.rotation.y, z: g.position.z, ...Object.fromEntries(c.plateRect.value.toArray().map((v, i) => [`rect${i}`, v])), ...Object.fromEntries(c.lines.flatMap((l, i) => [[`shiftX${i}`, l.shiftX], [`shiftY${i}`, l.shiftY], [`fit${i}`, l.fit]])) }
    return { nan: Object.entries(numbers).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k), year: c.year, aspect: __Q.A.camera.aspect, camera: __Q.A.camera.position.toArray().every(Number.isFinite) }
  })
  await goto(page, 27.064, -2, [0, -1], 1500)
  // The runtime's own ResizeObserver reads the size of #viewport (the canvas's container) and sets the camera from it: 0 / 0.
  await page.evaluate(() => { const el = document.getElementById('viewport'); el.dataset.was = el.style.display; el.style.display = 'none' })
  await sleep(700)
  const during = await kept()
  await page.evaluate(() => { const el = document.getElementById('viewport'); el.style.display = el.dataset.was || '' })
  await sleep(1200)
  // The aspect is back, but the view's own damped state may still be NaN here (it is, until the car moves): the plate must have kept nothing from it.
  const back = await kept()
  await goto(page, 27.064, YEAR_POINTS[2026], [0, -1], 1700)
  const after = await kept()
  note(`canvas collapsed: camera aspect ${during.aspect}, NaN kept: ${during.nan.join(', ') || 'none'}; canvas back, camera ${back.camera ? 'finite' : 'still NaN'}, NaN kept: ${back.nan.join(', ') || 'none'}; car moved: ${after.nan.join(', ') || 'none'}`)
  assert(Number.isNaN(during.aspect), `the collapsed canvas really gave the camera no aspect (${during.aspect})`, results)
  assert(during.nan.length === 0 && back.nan.length === 0 && after.nan.length === 0, `nothing the plate or the labels keep from frame to frame is NaN while it is collapsed (${during.nan.join(', ') || 'none'}), once it is back (${back.nan.join(', ') || 'none'}) or after the car moves (${after.nan.join(', ') || 'none'})`, results)
  assert(after.camera && after.year === 2026, `the readout shows 2026 again at z ${YEAR_POINTS[2026]} (${after.year})`, results)
  const px = await pixelTest(page, masksOf(2026), 'after the canvas came back', 'collapse-after.png')
  assert(px.missing === 0 && px.lit >= 14 && px.litMin > 200, `and every lit bar is on the screen, bright (min L ${px.litMin.toFixed(0)}, ${px.lit} judged)`, results)
}

/* =============================== ontop =============================== */
/*
  The bars must not be hidden by the car, a raised stone or a label (a year that is half hidden is a wrong year), so they are lifted
  toward the lens by READOUT_LIFT metres along each line of sight: that changes how near they are, not where they are on the screen.
  Anything within that of the plate (the car is 0.9 m nearer the lens than the plate at the chase camera's elevation, a stone's top
  2.2 m) is behind them; a hill, a sign or a tree that is further in front hides them as it hides the housing (the close-up
  camera of a board, the chase camera dragged round behind a tree). It used to draw them with no depth test at all, which showed the
  year through all of those.
*/
if (want('ontop')) {
  await calm(page)
  await goto(page, 27.064, YEAR_POINTS[2026], [0, -1], 1700)
  const state = await page.evaluate(() => __Q.c.digits.map((d) => ({ test: d.material.depthTest, write: d.material.depthWrite, transparent: d.material.transparent, order: d.mesh.renderOrder })))
  assert(state.length === 4 && state.every((d) => d.test && !d.write && d.transparent && d.order === 10), `the four digits are depth-tested, write no depth and are sorted after the labels from the start (${JSON.stringify(state[0])})`, results)
  const bars = masksOf(2026)
  const seen = await pixelTest(page, bars, 'no wall', null)
  assert(seen.litMin > 200, `with nothing in front the lit bars are bright (min L ${seen.litMin.toFixed(0)}, ${seen.lit} judged)`, results)
  await page.evaluate(() => __Q.occlude(2))
  await sleep(300)
  const near = await pixelTest(page, bars, 'wall 2 m in front of the plate', 'ontop-wall-2m.png')
  assert(near.litMin > 200, `a wall 2 m in front of the plate (the car, a stone) does not hide the bars (min L ${near.litMin.toFixed(0)}, ${near.lit} judged)`, results)
  await page.evaluate(() => __Q.occlude(10))
  await sleep(300)
  const far = await pixelTest(page, bars, 'wall 10 m in front of the plate', 'ontop-wall-10m.png')
  assert(far.litMax < 80, `a wall 10 m in front of the plate (a hill, a sign) hides every bar, as it hides the housing (max L ${far.litMax.toFixed(0)}, ${far.lit} judged)`, results)
  await page.evaluate(() => __Q.occlude(null))
  await sleep(300)
  // The map's photograph is an orthographic camera: the lift must not move a bar there (it slides vertices along the view ray, which an orthographic camera would see).
  const shader = await page.evaluate(() => {
    const { c } = __Q
    // what the digit material hands the compiler: its vertex shader with the lift in, run through its own onBeforeCompile
    const made = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' }
    c.digits[0].material.onBeforeCompile(made, null)
    const at = made.vertexShader.indexOf('projectionMatrix[2][3] < -0.5')
    return { lift: made.vertexShader.includes('mvPosition.xyz *='), guarded: at >= 0 && made.vertexShader.indexOf('mvPosition.xyz *=') > at }
  })
  assert(shader.lift && shader.guarded, `the lift is in the digit shader and only applies under a perspective camera (an orthographic one, the map's photograph, would see the bars move): ${JSON.stringify(shader)}`, results)
}

/* =============================== draws =============================== */
if (want('draws')) {
  await calm(page)
  const count = async (x, z) => {
    await goto(page, x, z, [0, -1], 1800)
    return page.evaluate(async () => {
      const { A } = __Q
      const read = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r({ calls: A.renderer.info.render.calls, triangles: A.renderer.info.render.triangles }))))
      const a = [await read(), await read(), await read()]
      return { calls: Math.round(a.reduce((n, v) => n + v.calls, 0) / a.length), triangles: Math.round(a.reduce((n, v) => n + v.triangles, 0) / a.length), textures: A.renderer.info.memory.textures, geometries: A.renderer.info.memory.geometries }
    })
  }
  // the whole plate in view: the car at the middle of the walk, nothing speaking
  const here = await count(YEAR_X, -3.4)
  const mine = await page.evaluate(() => {
    const { c, inst } = __Q
    const roots = [inst.references.bySource.get('career'), c.group].filter(Boolean)
    const meshes = new Set()
    const shown = (o) => { for (let n = o; n; n = n.parent) if (!n.visible) return false; return true }
    for (const root of roots) root.traverse((o) => { if (o.isMesh && shown(o) && o.material?.visible !== false) meshes.add(o) })
    // the labels are transparent by design, and so are the four readout digits (opacity 1, a few hundred pixels each, drawn
    // after the labels on purpose so the year is never under a label); whatever else is, is overdraw
    const transparent = [...meshes].filter((m) => m.material.transparent && !m.material.uniforms?.reveal && !m.geometry.getAttribute('segment')).length
    const tris = [...meshes].reduce((n, m) => n + (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3, 0)
    return { meshes: meshes.size, transparent, tris: Math.round(tris) }
  })
  note(`frame with the plate in view: ${here.calls} draw calls, ${here.triangles} triangles; the area's own visible meshes: ${mine.meshes} (${mine.transparent} transparent, ${mine.tris} triangles)`)
  fs.writeFileSync(file('draws.json'), JSON.stringify({ frame: here, area: mine }, null, 1))
  assert(mine.transparent === 0, `the area draws no transparent strips (${mine.transparent} transparent meshes besides the labels and the 4 readout digits)`, results)
}

/* =============================== bump =============================== */
if (want('bump')) {
  /** Hold a speed along `local`, sampling the chassis height every physics step while it is over the plate (`window` on the driven
      axis, frame metres) and has run in for 2 m; the excursion is max - min, in frame metres. */
  const drive = (from, local, kmh, seconds, window) => page.evaluate(async ({ from, local, kmh, seconds, window }) => {
    const { A, inst } = __Q
    __Q.place(from[0], from[1], local)
    await new Promise((r) => setTimeout(r, 900))
    const body = A.driving.vehicle.chassis.physical.body
    const start = A.driving.vehicle.position.clone()
    const d = inst.physics.vector({ x: local[0], y: 0, z: local[1] }).normalize().multiplyScalar(kmh / 3.6)
    const samples = []
    const hold = () => {
      const v = body.linvel(), p = A.driving.vehicle.position, at = inst.game.vehicle.position
      body.setLinvel({ x: d.x, y: v.y, z: d.z }, true)
      const axis = local[0] !== 0 ? at.x : at.z
      // the first 2 m are the run-in (the suspension squats as the car goes from 0 to speed): not the road
      if (Math.hypot(p.x - start.x, p.z - start.z) / inst.physics.scale > 2 && axis >= window[0] && axis <= window[1]) samples.push(p.y)
    }
    A.driving.ticker.events.on('fixed', hold, 5)
    await new Promise((r) => setTimeout(r, seconds * 1000))
    A.driving.ticker.events.off('fixed', hold)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    return { n: samples.length, excursion: samples.length ? (Math.max(...samples) - Math.min(...samples)) / inst.physics.scale : NaN }
  }, { from, local, kmh, seconds, window })
  const ACROSS = [23.9, 30.8], ALONG = [-10.6, 6.6]
  const across = await drive([21.0, -3.0], [1, 0], 25, 1.5, ACROSS)
  const across2 = await drive([21.0, -5.6], [1, 0], 25, 1.5, ACROSS)
  const across3 = await drive([21.0, 2.2], [1, 0], 25, 1.5, ACROSS)
  const along = await drive([26.05, 9.0], [0, -1], 20, 2.9, ALONG)
  const alongWork = await drive([27.064 + 0.45, 9.0], [0, -1], 20, 2.9, ALONG)
  const alongEdu = await drive([25.051 - 0.45, 9.0], [0, -1], 20, 2.9, ALONG)
  // The same crossing with the real controls: W held, nothing forced. The car must get across (no lane catches a wheel) and not hop.
  const throttle = await (async () => {
    await page.evaluate(() => __Q.place(21.0, -4.4, [1, 0]))
    await sleep(900)
    await page.evaluate(() => {
      const { A, inst } = __Q
      const samples = []
      const watch = () => { const at = inst.game.vehicle.position; samples.push([at.x, A.driving.vehicle.position.y / inst.physics.scale]) }
      A.driving.ticker.events.on('fixed', watch, 5)
      __Q.stopWatch = () => { A.driving.ticker.events.off('fixed', watch); return samples }
    })
    await page.keyboard.down('KeyW')
    await sleep(2600)
    await page.keyboard.up('KeyW')
    const samples = await page.evaluate(() => __Q.stopWatch())
    const over = samples.filter(([x]) => x >= 24.6 && x <= 30.8).map(([, y]) => y)
    return { reached: Math.max(...samples.map(([x]) => x)), n: over.length, excursion: over.length ? Math.max(...over) - Math.min(...over) : NaN }
  })()
  assert(throttle.reached > 31 && throttle.n > 10, `with W held the car crosses all three lanes (reached x ${throttle.reached.toFixed(1)}, ${throttle.n} steps over the plate)`, results)
  assert(throttle.excursion < 0.025, `and its chassis height moves ${(throttle.excursion * 100).toFixed(2)} cm doing it, accelerating (limit 2.5 cm)`, results)
  for (const [label, r] of [['across the three lanes at z -3, 25 km/h', across], ['across the three lanes at z -5.6, 25 km/h', across2], ['across the three lanes at z 2.2, 25 km/h', across3], ['along the work lane (straddling it), 20 km/h', alongWork], ['along the education lane (straddling it), 20 km/h', alongEdu], ['along the plate between two lanes, 20 km/h', along]]) {
    assert(r.n > 20 && r.excursion < 0.02, `chassis height moves ${(r.excursion * 100).toFixed(2)} cm ${label} over ${r.n} steps (limit 2 cm)`, results)
  }
}

/* =============================== shots =============================== */
async function shots(pg, tag, viewportLabel, yearX = YEAR_X, zooms = ['default', 'close']) {
  const info = await pg.evaluate(() => __Q.c.lines.map((l) => ({ id: l.stop.id, track: l.track.id, x: l.stoneHome.x, head: l.stoneHome.z, span: l.span })))
  const byTrack = {}
  for (const l of info) (byTrack[l.track] ??= []).push(l)
  const side = (track) => (track === 'projects' ? -1 : 1)
  for (const zoom of zooms) {
    await pg.evaluate(() => { __Q.A.driving.view.zoom.baseRatio = 0.6 })
    await setZoom(pg, zoom)
    const t = `${tag}-${zoom}`
    // lane heads: at rest (the car a few metres up the road) and with the stone up (the car level with it)
    for (const track of ['education', 'work', 'projects']) {
      const first = byTrack[track][0]
      await goto(pg, first.x + side(track), first.head + 2.6, [0, -1], 1500)
      await pg.screenshot({ path: file(`${t}-head-${track}-rest.png`) })
      await goto(pg, first.x + side(track), first.head - 0.4, [0, -1], 2300)
      await pg.screenshot({ path: file(`${t}-head-${track}-up.png`) })
    }
    // the overlap on the work lane: Focus, Pansofia and KCL-GTA all stand there
    await goto(pg, 26.05, -1.2, [0, -1], 2500)
    await pg.screenshot({ path: file(`${t}-overlap-work.png`) })
    await goto(pg, 28.05, -1.4, [0, -1], 2500)
    await pg.screenshot({ path: file(`${t}-overlap-projects.png`) })
    // the five years, the readout beside the car
    for (const [year, z] of Object.entries(YEAR_POINTS)) {
      await goto(pg, yearX, z, [0, -1], 1700)
      await pg.screenshot({ path: file(`${t}-year-${year}.png`) })
    }
    await goto(pg, yearX, -1.26, [0, -1], 1500)
    for (const value of [8888, 2019]) {
      await pg.evaluate((v) => __Q.c.writeYear(v), value)
      await sleep(1300)
      await pg.screenshot({ path: file(`${t}-year-${value}.png`) })
    }
    // leave it as the game would
    await goto(pg, yearX, 5.82, [0, -1], 1500)
  }
  console.log(`shots: ${viewportLabel} done`)
}

if (want('shots') && !args.includes('--no-shots')) {
  await calm(page)
  await shots(page, 'desk', '1440x900')
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
  await legacyRoute(phone)
  const mobile = await phone.newPage()
  const mobileErrors = watch(mobile, 'phone ')
  await openPlayer(mobile)
  await sleep(1500)
  await mobile.evaluate(install)
  await calm(mobile)
  // the plate runs ahead of the car until it is on a portrait phone's screen, so the pictures use the same place as the desktop's
  await shots(mobile, 'phone', '390x844 touch', YEAR_X, ['default'])
  errors.push(...mobileErrors)
  await phone.close()
}

/* =============================== studio =============================== */
if (want('studio')) {
  const html = (await import(new URL('../../src/server/world-studio/studio-template.ts', import.meta.url))).STUDIO_HTML.replace('<!--CONFIG-->', '<script>window.ARCHIPELAGO_CONFIG={}</script>')
  const studio = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await legacyRoute(studio)
  const sp = await studio.newPage()
  const studioErrors = watch(sp, 'studio ')
  await sp.route(`${BASE}/archipelago/preview/studio-qa.html`, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }))
  await sp.goto(`${BASE}/archipelago/preview/studio-qa.html`, { waitUntil: 'domcontentloaded' })
  await sp.waitForFunction(() => document.body.dataset.ready === 'true', null, { timeout: 240_000 })
  await sp.locator('#edit').click()
  await sleep(1800)
  const edit = await sp.evaluate(() => {
    const A = globalThis.__archipelago, T = A.THREE
    let generated = null
    A.root.traverse((n) => { if (!generated && (n.userData.assetRuntimeKey === 'runtime:career#0' || n.name === 'runtime:career')) generated = n })
    if (!generated) return { found: false }
    const meshes = []
    generated.traverse((n) => { if (n.isMesh) meshes.push(n) })
    const big = meshes.filter((m) => m.geometry.getAttribute('color') || (m.geometry.index && m.geometry.index.count > 600)).map((m) => ({ tris: m.geometry.index.count / 3, material: m.material.type }))
    // the authored digits sit under the plate node, outside the generated group: find them by the segment attribute the controller bakes in
    const digits = []
    A.root.traverse((n) => { if (n.isMesh && n.geometry.getAttribute('segment')) digits.push({ material: n.material.type, mask: null, parent: n.parent?.userData.w2Source }) })
    // the middle of the road, wherever the world puts it
    const centre = new T.Box3().setFromObject(meshes.find((m) => m.geometry.index?.count > 600) ?? generated).getCenter(new T.Vector3())
    // a generated part keeps the transform the controller gave it: the editor restores no saved state onto it
    const parts = generated.children.filter((n) => n.isMesh && (n.geometry.getAttribute('color') || n.geometry.index?.count > 600))
    const moved = parts.filter((n) => n.position.lengthSq() > 0).length
    return { found: true, moved, derived: generated.userData.proceduralDerived === true, children: generated.children.length, big, digits, centre: centre.toArray(), basis: !!generated.userData.careerSourceBasis, delta: !!generated.userData.careerSourceDelta }
  })
  assert(edit.found && edit.children === 20, `Edit: the generated career is there with ${edit.children} parts (rim, floor, 9 stones, 9 labels)`, results)
  if (newApi) {
    assert(edit.big.length === 2 && edit.big.some((b) => b.material === 'MeshStandardMaterial') && edit.big.some((b) => b.material === 'MeshBasicMaterial'), `Edit: one merged rim and one floor (${edit.big.map((b) => `${b.tris} ${b.material}`).join(', ')})`, results)
    assert(edit.digits.length === 4 && edit.digits.every((d) => d.material === 'MeshBasicMaterial' && d.parent === 'refYear'), 'Edit: the four digits are the self-lit readout', results)
  }
  if (newApi) assert(edit.moved === 0 && edit.derived, `Edit: the rim and floor sit where the controller put them (${edit.moved} moved by stale saved states; group marked derived: ${edit.derived})`, results)
  assert(edit.basis && edit.delta, 'Edit: syncCareerPreviews has framed the generated career in its source node', results)
  await sp.evaluate((centre) => { const A = globalThis.__archipelago; A.editor.select([]); A.editor.orbit.target.set(centre[0], centre[1], centre[2]); A.camera.position.set(centre[0] + 9, centre[1] + 11, centre[2] + 11); A.editor.orbit.update() }, edit.centre)
  await sleep(1500)
  await sp.screenshot({ path: file('studio-edit.png') })
  // the asset studio's own preview of the same asset (the "Edit" button of the library)
  await sp.evaluate(() => globalThis.__archipelago.editor.openAsset('world2:career'))
  await sp.waitForSelector('#asset-studio', { timeout: 30_000 })
  await sleep(2000)
  const asset = await sp.evaluate(() => {
    const studio = globalThis.__archipelago.editor.assetStudio
    let rim = 0, floor = 0, digits = 0
    studio.root.traverse((n) => { if (!n.isMesh) return; if (n.geometry.getAttribute('segment')) digits++; else if (n.geometry.getAttribute('color')) floor++; else if (n.geometry.index?.count > 600 && n.material.map) rim++ })
    return { active: studio.active, rim, floor, digits }
  })
  assert(asset.active && (!newApi || (asset.rim === 1 && asset.floor === 1 && asset.digits === 4)), `Asset Studio: the career opens with its rim (${asset.rim}), floor (${asset.floor}) and four digits (${asset.digits})`, results)
  await sp.screenshot({ path: file('studio-asset.png') })
  await sp.evaluate(() => globalThis.__archipelago.editor.assetStudio.close())
  await sleep(800)
  await sp.locator('#drive').click()
  await sp.waitForFunction(() => globalThis.__archipelago.mode === 'drive')
  await sleep(2500)
  assert(await sp.evaluate(install), 'Drive: the Career controller is running in the studio', results)
  const driven = await sp.evaluate(async () => {
    const { c } = __Q
    __Q.place(28.05, -1.26)
    await new Promise((r) => setTimeout(r, 2200))
    return { year: c.year, masks: c.digitMasks, phantoms: __Q.phantoms(), sockets: c.sockets?.length ?? null }
  })
  assert(driven.phantoms.length === 0 || !newApi, `Drive: no phantom colliders (${driven.phantoms.length})`, results)
  assert(driven.year === 2025, `Drive: the readout shows 2025 at z -1.26 (${driven.year})`, results)
  await sp.screenshot({ path: file('studio-drive.png') })
  assert(studioErrors.length === 0, `the studio raised no errors${studioErrors.length ? `: ${studioErrors.slice(0, 2).join(' | ')}` : ''}`, results)
  await studio.close()
}

/* =============================== world2 =============================== */
if (want('world2')) {
  const response = await fetch(`${BASE}/world2`)
  assert(response.status === 200, `GET /world2 answers ${response.status}`, results)
}

assert(errors.length === 0, `no console errors or page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`, results)
await browser.close()
finish(results)
