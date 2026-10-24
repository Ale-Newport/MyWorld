/* /world Social plaza from the REAL gameplay camera.

   The camera has ONE fixed azimuth (45 deg, from the south-east: it never turns with the car), so what matters is where the car
   stands relative to the plaza. The car is placed with Driving.place() exactly like the M-map travel does (world-teleport.mjs),
   which snaps the chase camera behind it with its normal offset (View.spherical: theta 45 deg, phi 0.27 pi, radius ~21 m,
   fov 25 deg). The editor / free camera is never used.

   4 viewports (1440x900, 1920x1080, 1024x768 touch, 390x844 phone) x 9 car poses:
     front / left / right / back   9 m (back: 5 m) from the dais, facing it (named by where the car is on the SCREEN)
     mouth                         2.6 m in front of the dais, in the middle of the plaza: the arrival frame, all four stations in it
     road-south                    on East Coast Road, heading north, the way most players arrive
     spawn                         the authored respawnSocial pose (what the map's travel uses when it is valid)
     at-github / at-cv             parked on the apron in front of a pad (2.5 g from its centre, the prompt point is 1.5 g): GitHub shows its prompt, the CV never does

   Asserted
     structure   the retired platforms, Bruno's statue and the fan are neither drawn nor bodied; physicalFixed.002 has no body;
                 the pad mesh keeps the dais and four pads (286 triangles, authored 496) and its bounds are tight; the plaza has
                 exactly GitHub, LinkedIn, Email and the CV, three prompts (the CV is "On request": no prompt, no link) and AN
     facing      every board that is on screen (at least half of its face in the frame) faces the lens (cos > 0.6 against the line
                 from the board to the real camera, perspective included) in every pose; the monogram and every icon face the
                 lens (cos > 0.85) at the mouth and spawn poses
     composition at the mouth pose (not the phone) all four stations, icons and boards are inside the frame, no board face
                 overlaps an icon, the monogram or another board, boards are wide enough to read (>= 10% of the viewport width), every face is painted, the camera is at its normal distance
     behaviour   GitHub and the CV document can still be pushed and the island reset puts them back on their pads, standing where they
                 stood; a car drives under every board between its posts and not through one; pressing E at a station opens its link
                 (mailto: without a blank tab, GitHub in one new tab), marks Say hello, and the CV opens and marks nothing; the day
                 the CV is 'verified' (profile.js served with that status) it becomes a link with a prompt and the target is 4;
                 the achievement target equals the number of contacts that open something; the instance disposes cleanly;
                 no console error or exception
   arrival     travelling here from the M map (the Contact place, the GitHub +2 pin that stands for the three prompts, and each of the
               GitHub, LinkedIn and Email prompts as map targets) puts the car on the plaza's own declared arrival (source 'declared'),
               5.5 m from the dais on the line to the lens, facing the camera's way, and the first frame is the composed one: the dais and AN
               in frame, and (landscape) all four boards and icons, or (portrait phone) the two inner stations and a whole board each.
               That arrival used to be the path 7 m west of the plaza with a lamp post at the car and one board at the screen edge.
               It is the same every time: the Contact, Email and GitHub pins travelled one after the other in one session (desktop, phone)
               land 5.5 m from the dais every time, however the props have settled since the first arrival woke them (the pose used to pass
               its 0.5 m clearance from the icons by 3 mm at rest and fail after one arrival, so every later arrival was 1 m further out);
               and the car faces away from the chase camera wherever the player dragged it (135, 225 and 315 degrees) before opening the map;
               with the mailbox, or all four props, pushed onto the line to the lens the arrival is still in front of the plaza (a swing to one side).
   Screenshots: <QA_OUT>/social-<viewport>-<pose>.png (default .qa/runs). A JSON report of every measurement is written next to them.

   --studio  also signs in to the admin world studio (needs .data/qa-admin.json, `npm run admin:create`), opens Edit Source Asset on the Social
             asset and asserts what the studio holds is the arranged plaza with PAINTED boards: four boards, text on every face (the isolated
             scene clones the preview, and a clone used to keep the blank parchment), the mailbox on its pad. Shot: social-studio-source-asset.png

   QA_BASE=http://localhost:3210 QA_OUT=.qa/runs/impl/social/shots node scripts/qa/world-social-shots.mjs [--only=desktop] [--poses=mouth,front] [--studio] */
import fs from 'node:fs'
import { launch, openPlayer, out, sleep, assert, finish, watch } from './lib.mjs'

const args = process.argv.slice(2)
const option = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]?.split(',')
const ONLY = option('only'), POSES = option('poses'), STUDIO = args.includes('--studio')

const results = []
const report = { viewports: {} }
const browser = await launch()

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'fhd', width: 1920, height: 1080 },
  { name: 'tablet', width: 1024, height: 768, hasTouch: true },
  { name: 'phone', width: 390, height: 844, hasTouch: true, isMobile: true, deviceScaleFactor: 2 },
].filter((v) => !ONLY || ONLY.includes(v.name))

const S = Math.SQRT1_2
/* World directions from the dais to where the car starts. The camera looks toward world (-x,-z), so on the screen: +x+z is down
   (toward the camera), +x-z is right, -x+z is left, -x-z is up (behind the plaza, the tall monogram between lens and car). */
const POSE_LIST = [
  { id: 'front', dir: [S, S], dist: 9 },
  { id: 'left', dir: [-S, S], dist: 9 },
  { id: 'right', dir: [S, -S], dist: 9 },
  { id: 'back', dir: [-S, -S], dist: 5 },
  { id: 'mouth', dir: [S, S], dist: 2.6, margin: 0.2 },
  { id: 'road-south', offset: [-1.9, 22.9], heading: Math.PI / 2 },
  { id: 'spawn', spawn: true },
  { id: 'at-github', station: 'github', prompt: 'GitHub', margin: 0.2 },     // parked on the apron of a pad, where its prompt is: the diamond and its label must read
  { id: 'at-cv', station: 'cv', prompt: null, margin: 0.2 },                 // the CV is "On request": no prompt however close
].filter((p) => !POSES || POSES.includes(p.id))

async function inspect(page) {
  return page.evaluate(() => {
    const A = globalThis.__archipelago
    const inst = A.gameplay.instances.find((i) => i.parts.social)
    if (!inst) return { error: 'no Social instance' }
    const social = inst.parts.social
    const D = inst.physics.point(inst.references.position('refCenter'))
    return {
      D: D.toArray(), spawn: A.gameplay.catalog.spawnFor(inst.asset),
      links: social.links.map((l) => ({ id: l.id, label: l.label, href: l.href })), monogram: social.monogram.map((m) => m.name).join(''),
      prompts: inst.prompts.items.map((i) => i.label), boards: social.boards?.length ?? 0,
      target: A.gameplay.achievements.defs?.find?.((d) => d.id === 'social')?.target ?? null,
    }
  })
}

async function placeCar(page, x, z, heading, margin = 1.5) {
  return page.evaluate(({ x, z, heading, margin }) => {
    const A = globalThis.__archipelago, d = A.driving
    let pose = d.placement.check(x, z, heading, { dynamicMargin: margin }), nudged = false
    if (!pose.ok) { pose = d.placement.near?.(x, z, { radius: 6, step: 1, prefer: [{ heading, weight: 1 }], dynamicMargin: margin }) ?? pose; nudged = pose.ok }
    if (!pose.ok) return { ok: false, reason: pose.reason }
    d.place(pose, { reason: 'travel' })
    return { ok: true, nudged, x: pose.x, z: pose.z, heading: pose.heading }
  }, { x, z, heading, margin })
}

/** Parks the car on the apron in front of a station's pad (2.5 g from the pad's centre; its prompt is 1.5 g), facing into the plaza. */
async function standAt(page, station) {
  const at = await page.evaluate((id) => {
    const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social), layout = inst.parts.social.layout
    const seat = layout.seats[id], local = new A.THREE.Vector3(seat.x + Math.sin(layout.psi) * 2.5, 0.5, seat.z + Math.cos(layout.psi) * 2.5)
    const world = inst.physics.point(local), forward = inst.physics.vector({ x: -Math.sin(layout.psi), y: 0, z: -Math.cos(layout.psi) })
    return { x: world.x, z: world.z, heading: Math.atan2(-forward.z, forward.x) }
  }, station)
  const placed = await placeCar(page, at.x, at.z, at.heading, 0.2)
  await sleep(1200)
  placed.prompt = await page.evaluate(() => globalThis.__archipelago.gameplay.instances.find((i) => i.parts.social).prompts.activeLabel ?? null)
  console.log(`  stand(${station}): wanted ${at.x.toFixed(1)},${at.z.toFixed(1)} got ${placed.x?.toFixed(1)},${placed.z?.toFixed(1)} nudged ${placed.nudged}, prompt ${placed.prompt}`)
  return placed
}

/** Travels the way a player does: M, then a pin of the map. `dispatchEvent` because the Contact pin and the merged GitHub pin sit on one another. */
async function travelByPin(page, name) {
  await page.evaluate(() => document.querySelector('#world')?.focus?.())
  await page.keyboard.press('KeyM')
  await page.waitForFunction(() => !document.querySelector('.atlas').hidden)
  await sleep(700)
  await page.locator(`.atlas-pin[aria-label^="Travel to ${name}"]`).first().dispatchEvent('click')
  await page.waitForFunction(() => document.querySelector('.atlas').hidden, null, { timeout: 8000 })
  await sleep(1800)
}

/** How far the car is from the dais now, and whether the chase camera is behind it (1: exactly behind, 0: beside, -1: in front). */
async function carNow(page) {
  return page.evaluate(() => {
    const A = globalThis.__archipelago, d = A.driving, T = A.THREE, p = d.vehicle.position, inst = A.gameplay.instances.find((i) => i.parts.social), dais = inst.physics.point(inst.references.position('refCenter'))
    const f = d.flatHeading(), forward = new T.Vector3(Math.cos(f), 0, -Math.sin(f)), fromCamera = new T.Vector3(p.x - A.camera.position.x, 0, p.z - A.camera.position.z).normalize()
    return { x: p.x, z: p.z, fromDais: Math.hypot(p.x - dais.x, p.z - dais.z), behind: forward.dot(fromCamera), theta: d.view.spherical.theta }
  })
}

/** The camera as a player who dragged it round has left it (Driving.view is the chase camera; the azimuth is its spherical theta). */
async function orbitTo(page, theta) {
  await page.evaluate((theta) => { const v = globalThis.__archipelago.driving.view, s = v.spherical; s.targetTheta = s.theta = theta; v.snapToTarget(); v.update() }, theta)
  await sleep(500)
}

/** The largest clearance from moving bodies at which each declared pose is still valid right now: the slack the arrival has. */
async function declaredSlack(page) {
  return page.evaluate(() => {
    const P = globalThis.__archipelago.driving.placement, declared = [...P.arrivalPoints][0], heading = P.cameraHeading() ?? declared.poses[0].heading
    return declared.poses.slice(0, 2).map((p) => { let lo = -0.01, hi = 3; for (let k = 0; k < 16; k++) { const m = (lo + hi) / 2; if (P.check(p.x, p.z, heading, { margin: 0.8, dynamicMargin: m }).ok) lo = m; else hi = m } return +lo.toFixed(3) })
  })
}

/* Facts measured from the live camera: where every piece lands on screen, whether it faces the lens, how big it is. */
async function measure(page) {
  return page.evaluate(() => {
    const A = globalThis.__archipelago, T = A.THREE, cam = A.camera
    const inst = A.gameplay.instances.find((i) => i.parts.social), social = inst.parts.social
    const w = innerWidth, h = innerHeight
    cam.updateMatrixWorld(true)
    const project = (v) => { const p = v.clone().project(cam); return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h } }
    const car = A.driving.vehicle.position
    const result = { camDistance: cam.position.distanceTo(car), viewport: [w, h], items: [] }
    /** Screen rectangle of everything drawn under `object` (collider helpers skipped), from its meshes' own boxes. */
    const rectOf = (object) => {
      object.updateWorldMatrix(true, true)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      const corner = new T.Vector3()
      object.traverse((m) => {
        if (!m.isMesh || m.userData.w2Role === 'collider') return
        for (let a = m; a; a = a.parent) if (!a.visible) return
        const bb = m.geometry.boundingBox ?? (m.geometry.computeBoundingBox(), m.geometry.boundingBox)
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
          const p = project(corner.set(x, y, z).applyMatrix4(m.matrixWorld))
          x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y)
        }
      })
      return x1 < x0 ? null : { x0, y0, x1, y1 }
    }
    const visibleFraction = (r) => (r ? Math.max(0, Math.min(r.x1, w) - Math.max(r.x0, 0)) * Math.max(0, Math.min(r.y1, h) - Math.max(r.y0, 0)) / ((r.x1 - r.x0) * (r.y1 - r.y0)) : 0)
    const inFrame = (r, margin = 0.01) => !!r && r.x0 > margin * w && r.x1 < (1 - margin) * w && r.y0 > margin * h && r.y1 < (1 - margin) * h
    const front = (object) => new T.Vector3(0, 0, 1).applyQuaternion(object.getWorldQuaternion(new T.Quaternion()))
    const cosToCamera = (object, at) => front(object).setY(0).normalize().dot(cam.position.clone().sub(at).setY(0).normalize())
    for (const [i, link] of social.links.entries()) {
      const board = social.boards?.[i]
      const sign = link.sign
      const centre = new T.Box3().setFromObject(sign).getCenter(new T.Vector3())
      // The reading normal is the sign's +z; the lens must be in front of it (full 3-D, the camera is above the board).
      const toCam = cam.position.clone().sub(centre).normalize()
      const faceRect = board?.face ? rectOf(board.face) : rectOf(sign)
      const iconRect = link.node && link.node !== sign ? rectOf(link.node) : null
      const wide = board?.face ? Math.abs(faceRect.x1 - faceRect.x0) : null
      result.items.push({
        id: link.id, facing: +front(sign).dot(toCam).toFixed(3), x: Math.round(project(centre).x), y: Math.round(project(centre).y),
        faceRect, iconRect, facePx: wide && Math.round(wide), faceVisible: +visibleFraction(faceRect).toFixed(2), boardInFrame: inFrame(rectOf(sign)), iconInFrame: link.node === sign ? true : inFrame(iconRect),
        iconFacing: link.node && link.node !== sign ? +cosToCamera(link.node, link.node.getWorldPosition(new T.Vector3())).toFixed(3) : null,
        href: link.href,
      })
    }
    const letters = social.monogram
    if (letters.length) {
      const group = new T.Group()
      result.monogramFacing = +Math.min(...letters.map((m) => cosToCamera(m, m.getWorldPosition(new T.Vector3())))).toFixed(3)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const m of letters) { const r = rectOf(m); if (!r) continue; x0 = Math.min(x0, r.x0); y0 = Math.min(y0, r.y0); x1 = Math.max(x1, r.x1); y1 = Math.max(y1, r.y1) }
      result.monogramRect = { x0, y0, x1, y1 }
      void group
    }
    // Overlaps between what must stay readable (a board's face) and everything else drawn in the plaza, in px^2.
    const area = (r) => (r.x1 - r.x0) * (r.y1 - r.y0)
    const overlap = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))
    result.overlaps = []
    for (const a of result.items) {
      if (!a.faceRect) continue
      for (const b of result.items) {
        if (b !== a && b.faceRect) result.overlaps.push({ what: `${a.id} face x ${b.id} face`, frac: +(overlap(a.faceRect, b.faceRect) / area(a.faceRect)).toFixed(3) })
        if (b.iconRect) result.overlaps.push({ what: `${a.id} face x ${b.id} icon`, frac: +(overlap(a.faceRect, b.iconRect) / area(a.faceRect)).toFixed(3) })
      }
      if (result.monogramRect) result.overlaps.push({ what: `${a.id} face x monogram`, frac: +(overlap(a.faceRect, result.monogramRect) / area(a.faceRect)).toFixed(3) })
    }
    return result
  })
}

async function structural(page) {
  return page.evaluate(() => {
    const A = globalThis.__archipelago
    const inst = A.gameplay.instances.find((i) => i.parts.social), env = inst.environment, refs = inst.references
    const retired = ['twitchPhysicalDynamic', 'youtubePhysicalDynamic', 'discordPhysicalDynamic', 'blueskyPhysicalDynamic.001', 'xPhysicalDynamic', 'onlyfansPhysicalDynamic', 'refStatuePhysicalDynamic', 'boyMesh', 'baguiraMesh.001', 'sudoMesh.003', 'wings', 'refFan', 'physicalFixed.002']
    const visibleMesh = (node) => { let drawn = false; node.traverse((o) => { if (o.isMesh && o.userData.w2Role !== 'collider') { let on = true; for (let p = o; p; p = p.parent) if (!p.visible) on = false; if (on) drawn = true } }); return drawn }
    const visible = retired.filter((n) => { const node = refs.node(n); return node && visibleMesh(node) })
    const bodied = retired.filter((n) => inst.physics.physicals.some((p) => p.owner === n))
    const pads = env.nodes.get('Cube.133')
    pads.geometry.computeBoundingBox()
    pads.geometry.computeBoundingSphere()
    const box = pads.geometry.boundingBox, size = box.getSize(new A.THREE.Vector3())
    // Where each prop's lowest colliders stand, against its pad: in the plaza's own axes (right on the screen, toward the lens), g from the seat.
    const T = A.THREE, layout = inst.parts.social.layout
    env.group.updateWorldMatrix(true, true)
    const inv = env.group.matrixWorld.clone().invert()
    const right = [Math.cos(layout.psi), -Math.sin(layout.psi)], lens = [Math.sin(layout.psi), Math.cos(layout.psi)]
    const feet = {}
    for (const [id, name] of [['github', 'gitHubPhysicalDynamic'], ['linkedin', 'linkedInPhysicalDynamic'], ['email', 'mailPhysicalDynamic'], ['cv', 'cvPhysicalDynamic']]) {
      const root = refs.node(name), seat = layout.seats[id], boxes = []
      if (!root) continue
      root.traverse((c) => {
        if (c.userData.w2Role !== 'collider' || c.isMesh) return
        const box = { r: [1e9, -1e9], l: [1e9, -1e9], bottom: 1e9 }
        for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
          const p = new T.Vector3(sx, sy, sz).applyMatrix4(c.matrixWorld).applyMatrix4(inv), dx = p.x - seat.x, dz = p.z - seat.z
          const r = dx * right[0] + dz * right[1], l = dx * lens[0] + dz * lens[1]
          box.r = [Math.min(box.r[0], r), Math.max(box.r[1], r)]; box.l = [Math.min(box.l[0], l), Math.max(box.l[1], l)]; box.bottom = Math.min(box.bottom, p.y)
        }
        boxes.push(box)
      })
      const low = Math.min(...boxes.map((b) => b.bottom)), stand = boxes.filter((b) => b.bottom < low + 0.05)
      feet[id] = { right: [Math.min(...stand.map((b) => b.r[0])), Math.max(...stand.map((b) => b.r[1]))], lens: [Math.min(...stand.map((b) => b.l[0])), Math.max(...stand.map((b) => b.l[1]))], bottom: +low.toFixed(3), padTop: layout.padTop, colliders: boxes.length }
    }
    return {
      feet, visible, bodied, padTriangles: pads.geometry.index.count / 3, padVertices: pads.geometry.attributes.position.count,
      padSize: size.toArray().map((v) => +v.toFixed(2)), padRadius: +pads.geometry.boundingSphere.radius.toFixed(2),
      dynamic: env.dynamic.map((d) => d.node.userData.w2Source ?? d.node.name),
      fixedBodies: inst.physics.physicals.filter((p) => String(p.owner).startsWith('social-board') || String(p.owner).startsWith('monogram')).map((p) => p.owner),
    }
  })
}

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.hasTouch, isMobile: !!vp.isMobile, deviceScaleFactor: vp.deviceScaleFactor ?? 1 })
  const page = await context.newPage()
  const errors = watch(page, `${vp.name} `)
  await openPlayer(page)
  await sleep(1500)
  const info = await inspect(page)
  if (info.error) { assert(false, `${vp.name}: ${info.error}`, results); await context.close(); continue }
  const rows = (report.viewports[vp.name] = { poses: {} })

  const structure = await structural(page)
  rows.structure = structure
  assert(structure.visible.length === 0 && structure.bodied.length === 0, `${vp.name}: no retired platform, statue, fan or replaced collider set is drawn or has a body (drawn [${structure.visible}] bodied [${structure.bodied}])`, results)
  assert(structure.padTriangles === 286, `${vp.name}: the pad mesh keeps only the dais and the four stations (${structure.padTriangles} triangles, authored 496)`, results)
  assert(structure.padRadius < 10 && structure.padVertices <= structure.padTriangles * 3, `${vp.name}: the pad mesh's bounds are tight, not the authored 23 g arc (bounding radius ${structure.padRadius} g, ${structure.padVertices} vertices)`, results)
  assert(info.links.map((l) => l.id).join() === 'github,linkedin,email,cv' && info.monogram === 'AN', `${vp.name}: the plaza has GitHub, LinkedIn, Email, the CV and AN (${info.links.map((l) => l.id)} / ${info.monogram})`, results)
  assert(info.links.find((l) => l.id === 'cv').href === null && !info.prompts.includes('Curriculum Vitae') && info.prompts.length === 3, `${vp.name}: the CV is "On request" (no link, no prompt); prompts: ${info.prompts}`, results)
  {
    // What an icon stands on is its pad: every prop's lowest colliders lie over the pad's outer square (the authored pad is 1.687 g across, grown 1.3x),
    // and rest on the tile. The authored mailbox's post stands at the rear edge of its pad, which the first arrangement missed by half a pad: the post stood in the air.
    const half = 0.8436 * (await page.evaluate(async () => (await import('/archipelago/preview/portfolio/world2/interactions/socialLayout.js')).PLAZA.padScale))
    const off = Object.entries(structure.feet).filter(([, f]) => f.right[0] < -half - 0.02 || f.right[1] > half + 0.02 || f.lens[0] < -half - 0.02 || f.lens[1] > half + 0.02 || Math.abs(f.bottom - f.padTop) > 0.06)
    assert(off.length === 0 && Object.keys(structure.feet).length === 4, `${vp.name}: every icon (and the CV's document) stands on its pad, none in the air or over the rim (${Object.entries(structure.feet).map(([id, f]) => `${id} right ${f.right.map((v) => v.toFixed(2))} lens ${f.lens.map((v) => v.toFixed(2))} base ${f.bottom}`).join('; ')}; pad half ${half.toFixed(2)})`, results)
  }
  assert(info.boards === 4, `${vp.name}: one wooden board per station (${info.boards})`, results)
  if (vp.name === 'desktop') {
    // The face is 2.5 g off the ground between two posts: a car drives under it like a gate, and cannot drive through a post or the face.
    const gates = await page.evaluate(() => {
      // the slice of the car that crosses the board's plane (its pads and icons are in front of it): 0.24 m long, 1.9 m wide, 0.9 m tall
      const A = globalThis.__archipelago, T = A.THREE, inst = A.gameplay.instances.find((i) => i.parts.social), social = inst.parts.social, layout = social.layout
      const forward = inst.physics.vector({ x: -Math.sin(layout.psi), y: 0, z: -Math.cos(layout.psi) }), heading = Math.atan2(-forward.z, forward.x)
      const rot = new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), heading), body = A.driving.vehicle.chassis.physical.body
      // Only the board's own bodies count: the Email board's gate also has the mailbox's rear overhang in it, which is the icon's.
      const hits = (p, handle) => { let mine = false; A.physics.world.intersectionsWithShape({ x: p.x, y: p.y + 0.6, z: p.z }, { x: rot.x, y: rot.y, z: rot.z, w: rot.w }, new A.physics.rapier.Cuboid(0.12, 0.45, 0.95), (c) => { if (c.parent()?.handle === handle) mine = true; return true }, A.physics.rapier.QueryFilterFlags.EXCLUDE_SENSORS, undefined, undefined, body); return mine }
      return social.boards.map((board) => {
        const id = board.id.replace('social-', ''), own = inst.physics.physicals.find((p) => p.owner === `social-board-${id}`)?.body.handle
        const base = board.group.position, right = new T.Vector3(1, 0, 0).applyQuaternion(new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), layout.psi))
        const face = new T.Box3().setFromObject(board.face), ground = inst.physics.point(new T.Vector3(base.x, 0, base.z)).y
        return { id, blocked: hits(inst.physics.point(base), own), postBlocks: hits(inst.physics.point(base.clone().addScaledVector(right, 1.82)), own), clearance: +(face.min.y - ground).toFixed(2) }
      })
    })
    assert(gates.every((g) => !g.blocked && g.postBlocks && g.clearance > 1.5), `${vp.name}: a car drives under every board between its posts and not through a post (${gates.map((g) => `${g.id}: free ${!g.blocked} / post solid ${g.postBlocks} / ${g.clearance} m clear`).join(', ')})`, results)
  }

  for (const pose of POSE_LIST) {
    let x, z, heading
    if (pose.spawn) {
      if (!info.spawn) { console.log(`SKIP ${vp.name}/spawn: the level has no respawnSocial`); continue }
      ;[x, , z] = info.spawn.position
      heading = info.spawn.rotation
    } else if (pose.station) {
      const at = await page.evaluate((id) => {
        const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social), layout = inst.parts.social.layout
        const seat = layout.seats[id], local = new A.THREE.Vector3(seat.x + Math.sin(layout.psi) * 2.5, 0.5, seat.z + Math.cos(layout.psi) * 2.5)
        const world = inst.physics.point(local), forward = inst.physics.vector({ x: -Math.sin(layout.psi), y: 0, z: -Math.cos(layout.psi) })
        return { x: world.x, z: world.z, heading: Math.atan2(-forward.z, forward.x) }
      }, pose.station)
      ;({ x, z, heading } = at)
    } else if (pose.offset) {
      x = info.D[0] + pose.offset[0]; z = info.D[2] + pose.offset[1]; heading = pose.heading
    } else {
      x = info.D[0] + pose.dir[0] * pose.dist; z = info.D[2] + pose.dir[1] * pose.dist
      // face the dais: a world direction d is the heading atan2(-d.z, d.x) (runtime/placement.js)
      heading = Math.atan2(pose.dir[1], -pose.dir[0])
    }
    const placed = await placeCar(page, x, z, heading, pose.margin)
    const label = `${vp.name}/${pose.id}`
    if (!placed.ok) { assert(false, `${label}: the car could not be placed (${placed.reason})`, results); continue }
    await sleep(1800) // suspension settles; place() already snapped the chase camera behind the car; the boards' first paint
    const m = await measure(page)
    rows.poses[pose.id] = { placed, wanted: { x, z }, ...m }
    if (pose.id === 'mouth') {
      const unpainted = await page.evaluate(() => globalThis.__archipelago.gameplay.instances.find((i) => i.parts.social).parts.social.boards.flatMap((b) => b.layers.filter((l) => l.unpainted).map(() => b.id)))
      assert(unpainted.length === 0, `${label}: every board face is painted when the plaza comes into view (${unpainted.length} unpainted)`, results)
    }
    assert(m.camDistance > 15 && m.camDistance < 58, `${label}: chase camera at its normal distance (${m.camDistance.toFixed(1)} m)`, results)
    // A board is judged where it can be seen. The cosine is against the line from the board to the camera, so it carries the
    // perspective of a 25 degree lens too: a board 13 m to the side of the car is read 40 degrees off, whatever way it faces.
    const seen = m.items.filter((i) => i.faceVisible >= 0.5)
    for (const item of m.items) {
      if (item.faceVisible >= 0.5) assert(item.facing > 0.6, `${label}: ${item.id} board faces the lens (cos ${item.facing})`, results)
      else console.log(`  (${label}: ${item.id} board is ${Math.round(item.faceVisible * 100)}% in frame, not judged)`)
    }
    rows.poses[pose.id].judged = seen.length
    if (pose.id === 'front') assert(seen.length >= (vp.name === 'phone' ? 1 : 2), `${label}: coming in from the camera side the plaza is in view (${seen.length} boards)`, results)
    if (pose.station) {
      const active = await page.evaluate(() => globalThis.__archipelago.gameplay.instances.find((i) => i.parts.social).prompts.activeLabel ?? null)
      rows.poses[pose.id].prompt = active
      assert((active || null) === pose.prompt, `${label}: the active prompt is ${JSON.stringify(pose.prompt)} (got ${JSON.stringify(active)})`, results)
    }
    if (pose.id === 'mouth' || pose.id === 'spawn') {
      assert(m.monogramFacing > 0.85, `${label}: the monogram faces the lens (cos ${m.monogramFacing})`, results)
      assert(m.items.every((i) => i.iconFacing === null || i.iconFacing > 0.85), `${label}: the icons face the lens (${m.items.map((i) => `${i.id} ${i.iconFacing}`).join(', ')})`, results)
    }
    if (pose.id === 'mouth' && vp.name !== 'phone') {
      assert(m.items.every((i) => i.boardInFrame && i.iconInFrame), `${label}: all four stations (board and icon) are inside the frame (${m.items.map((i) => `${i.id}@${i.x},${i.y}`).join(' ')})`, results)
      const smallest = Math.min(...m.items.map((i) => i.facePx))
      assert(smallest >= Math.min(vp.width, 1440) * 0.1, `${label}: boards are wide enough to read (${m.items.map((i) => i.facePx).join('/')} px, need >= ${Math.round(Math.min(vp.width, 1440) * 0.1)})`, results)
      const worst = m.overlaps.reduce((a, b) => (b.frac > a.frac ? b : a), { what: 'none', frac: 0 })
      assert(worst.frac <= 0.03, `${label}: no board face is covered by an icon, the monogram or another board (worst: ${worst.what} ${(worst.frac * 100).toFixed(1)}%)`, results)
    }
    if (pose.id === 'mouth' && vp.name === 'phone') {
      // 6.4 m of ground is all a portrait phone shows: the two inner stations and the monogram are the plaza there.
      const icons = m.items.filter((i) => i.iconInFrame && i.id !== 'cv').length, read = m.items.filter((i) => i.faceVisible >= 0.9).length
      assert(icons >= 2 && read >= 1, `${label}: on a phone two icons and a whole board are in frame (${icons} icons, ${read} boards)`, results)
    }
    await page.screenshot({ path: out(`social-${vp.name}-${pose.id}.png`) })
  }

  /* Travelling here from the M map: the plaza's own arrival, not the nearest ground to its marker. */
  {
    const arrival = await page.evaluate(() => {
      const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social), layout = inst.parts.social.layout
      const markers = A.atlas.getMarkers(), dais = inst.physics.point(inst.references.position('refCenter'))
      const lens = inst.physics.vector({ x: Math.sin(layout.psi), y: 0, z: Math.cos(layout.psi) }).setY(0).normalize()
      const targets = ['Contact', 'GitHub', 'LinkedIn', 'Email'].map((name) => {
        const m = markers.find((x) => x.name === name), a = A.driving.arrival({ group: m.group ?? null, x: m.x, z: m.z, name: m.name })
        const to = { x: a.x - dais.x, z: a.z - dais.z }, along = to.x * lens.x + to.z * lens.z, across = Math.abs(to.x * lens.z - to.z * lens.x)
        return { name, ok: a.ok, source: a.source, along: +along.toFixed(2), across: +across.toFixed(2), heading: a.heading, camera: A.driving.placement.cameraHeading(), x: a.x, z: a.z }
      })
      return { targets, declared: A.driving.placement.arrivalPoints?.size ?? null, lens: lens.toArray() }
    })
    rows.arrival = arrival
    assert(arrival.declared === 1, `${vp.name}: the plaza declares one arrival to the map's Placement (${arrival.declared})`, results)
    const wrong = arrival.targets.filter((t) => !t.ok || t.source !== 'declared' || Math.abs(t.along - 5.5) > 0.2 || t.across > 0.2 || Math.abs(Math.atan2(Math.sin(t.heading - t.camera), Math.cos(t.heading - t.camera))) > 0.2)
    assert(wrong.length === 0, `${vp.name}: the Contact place and the GitHub, LinkedIn and Email prompts all arrive on the plaza's declared pose: 5.5 m from the dais on the lens axis, facing the camera's way (${arrival.targets.map((t) => `${t.name} ${t.source} ${t.along}/${t.across}`).join(', ')})`, results)
    for (const pin of ['Contact', 'GitHub']) {
      await placeCar(page, info.D[0] - 1.9, info.D[2] + 22.9, Math.PI / 2, 0.2)       // East Coast Road, well away from the plaza
      await travelByPin(page, pin)
      const m = await measure(page)
      const car = await carNow(page)
      rows[`arrive-${pin}`] = { car, ...m }
      assert(Math.abs(car.fromDais - 5.5) < 0.2, `${vp.name}/${pin} pin: the car is put down 5.5 m from the dais (${car.fromDais.toFixed(2)} m; the old arrival was 10-12 m west of it, on the path)`, results)
      assert(car.behind > 0.95, `${vp.name}/${pin} pin: the chase camera is behind the car (${car.behind.toFixed(3)})`, results)
      assert(m.camDistance > 15 && m.camDistance < 58, `${vp.name}/${pin} pin: chase camera at its normal distance (${m.camDistance.toFixed(1)} m)`, results)
      const mono = m.monogramRect, inFrame = (r) => !!r && r.x0 > 0 && r.x1 < vp.width && r.y1 > 0 && r.y0 > -0.05 * vp.height
      assert(m.items.every((i) => i.faceRect) && inFrame(mono) && m.monogramFacing > 0.85, `${vp.name}/${pin} pin: the monogram is in the first frame and faces the lens (rect ${mono && [mono.x0, mono.y0, mono.x1, mono.y1].map(Math.round)}, cos ${m.monogramFacing})`, results)
      if (vp.name === 'phone') {
        const icons = m.items.filter((i) => i.iconInFrame && i.id !== 'cv').length, read = m.items.filter((i) => i.faceVisible >= 0.9).length
        assert(icons >= 2 && read >= 2, `${vp.name}/${pin} pin: two icons and two whole boards (LinkedIn, Email) are in the first frame (${icons} icons, ${read} boards)`, results)
      } else {
        assert(m.items.every((i) => i.boardInFrame && i.iconInFrame), `${vp.name}/${pin} pin: all four stations (board and icon) are in the first frame (${m.items.map((i) => `${i.id}@${i.x},${i.y}`).join(' ')})`, results)
        const worst = m.overlaps.reduce((a, b) => (b.frac > a.frac ? b : a), { what: 'none', frac: 0 })
        assert(worst.frac <= 0.03, `${vp.name}/${pin} pin: no board face is covered by an icon, the monogram or another board (worst: ${worst.what} ${(worst.frac * 100).toFixed(1)}%)`, results)
      }
      await page.screenshot({ path: out(`social-${vp.name}-arrive-${pin}.png`) })
    }

    if (vp.name === 'desktop' || vp.name === 'phone') {
      const away = () => placeCar(page, info.D[0] - 1.9, info.D[2] + 22.9, Math.PI / 2, 0.2)
      const { ARRIVAL } = await page.evaluate(async () => ({ ARRIVAL: { ...(await import('/archipelago/preview/portfolio/world2/interactions/socialLayout.js')).ARRIVAL } }))
      /* Again and again, with no island reset in between: the first arrival wakes the props and they settle a few centimetres. */
      const sequence = ['Contact', 'Email', 'GitHub', 'Contact', 'Email', 'GitHub'], landed = [], slack = [await declaredSlack(page)]
      for (const pin of sequence) {
        await away()
        await travelByPin(page, pin)
        landed.push({ pin, ...(await carNow(page)) })
        slack.push(await declaredSlack(page))
      }
      rows.repeated = { landed, slack }
      assert(landed.every((l) => Math.abs(l.fromDais - 5.5) < 0.2), `${vp.name}: ${sequence.length} arrivals in a row (${sequence.join(', ')}) all land 5.5 m from the dais (${landed.map((l) => l.fromDais.toFixed(2)).join(', ')} m)`, results)
      assert(landed.every((l) => l.behind > 0.95), `${vp.name}: and the chase camera is behind the car every time (${landed.map((l) => l.behind.toFixed(2)).join(', ')})`, results)
      const least = Math.min(...slack.flat())
      assert(least >= ARRIVAL.dynamicMargin + 0.1, `${vp.name}: the first two poses keep 10 cm or more of slack on the ${ARRIVAL.dynamicMargin} m clearance at rest and after every arrival (least ${least} m; a pose that passes by 3 mm flips when an icon settles)`, results)
      await page.screenshot({ path: out(`social-${vp.name}-arrive-repeated.png`) })

      /* A player who dragged the camera round before opening the map: the car is put down with that camera behind it. */
      const orbit = []
      for (const degrees of [135, 225, 315]) {
        await orbitTo(page, (degrees * Math.PI) / 180)
        await away()
        await travelByPin(page, 'Contact')
        const now = await carNow(page)
        orbit.push({ degrees, ...now })
        await page.screenshot({ path: out(`social-${vp.name}-arrive-camera-${degrees}.png`) })
      }
      await orbitTo(page, Math.PI / 4)
      rows.orbit = orbit
      // A camera dragged to 135 or 315 degrees turns the car sideways to the lens axis, and then its flanks are 0.8 m from the inner pads at 5.5 m: the 7 m pose serves.
      assert(orbit.every((o) => o.fromDais >= 5.3 && o.fromDais <= 7.2 && o.behind > 0.95), `${vp.name}: camera dragged to 135, 225 and 315 degrees: the car still lands in front of the plaza (5.5 m, 7 m when it is turned sideways to the line) with the camera behind it (${orbit.map((o) => `${o.degrees}: ${o.fromDais.toFixed(2)} m, ${o.behind.toFixed(2)}`).join('; ')})`, results)

      /* Something pushed onto the line from the dais to the lens (the mailbox is the prop that gets there) takes the poses on it, and the
         arrival must not drop to the generic search, which was the path 11.9 m west of the plaza: a swing to one side of the line serves.
         The second case is the worst a player can make: all four props lined up on the axis. */
      if (vp.name === 'desktop') {
        const cases = [{ name: 'the mailbox at 6.5 m', props: [['mailPhysicalDynamic', 6.5]] }, { name: 'all four props on the line (5.5, 6.25, 7 and 8 m)', props: [['mailPhysicalDynamic', 5.5], ['linkedInPhysicalDynamic', 6.25], ['gitHubPhysicalDynamic', 7], ['cvPhysicalDynamic', 8]] }]
        const blocked = []
        for (const c of cases) {
          const r = await page.evaluate(async (props) => {
            const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social), layout = inst.parts.social.layout
            const dais = inst.physics.point(inst.references.position('refCenter')), lens = inst.physics.vector({ x: Math.sin(layout.psi), y: 0, z: Math.cos(layout.psi) }).setY(0).normalize()
            for (const [name, metres] of props) {
              const body = inst.environment.dynamic.find((d) => d.node.userData.w2Source === name).physical.body, at = body.translation()
              const to = inst.physics.local(new A.THREE.Vector3(dais.x + lens.x * metres, 1.2, dais.z + lens.z * metres))
              body.setTranslation({ x: to.x, y: at.y + 0.3, z: to.z }, true)
              body.setLinvel({ x: 0, y: 0, z: 0 }, true); body.setAngvel({ x: 0, y: 0, z: 0 }, true)
            }
            await new Promise((resolve) => setTimeout(resolve, 2000))
            const m = A.atlas.getMarkers().find((x) => x.name === 'Contact'), a = A.driving.arrival({ group: m.group ?? null, x: m.x, z: m.z, name: m.name })
            const out = { ok: a.ok, source: a.source, fromDais: Math.hypot(a.x - dais.x, a.z - dais.z), along: (a.x - dais.x) * lens.x + (a.z - dais.z) * lens.z }
            inst.reset()
            await new Promise((resolve) => setTimeout(resolve, 2000))
            return out
          }, c.props)
          blocked.push({ case: c.name, ...r })
        }
        rows.blocked = blocked
        assert(blocked.every((b) => b.ok && b.source === 'declared' && b.fromDais <= 10.1 && b.along > 4), `${vp.name}: with props pushed onto the axis the arrival is still the plaza's own, in front of it (${blocked.map((b) => `${b.case}: ${b.source} ${b.fromDais.toFixed(1)} m, ${b.along.toFixed(1)} m toward the lens`).join('; ')}; the generic search was 11.9 m west)`, results)
      }
    }
  }

  /* Pushable stays pushable, and the island reset puts it back on its pad. */
  if (vp.name === 'desktop' || vp.name === 'phone') {
    await placeCar(page, info.D[0] + S * 4, info.D[2] + S * 4, Math.atan2(S, -S))
    await sleep(600)
    for (const name of ['gitHubPhysicalDynamic', 'linkedInPhysicalDynamic', 'mailPhysicalDynamic', 'cvPhysicalDynamic']) {
      // Woken with no impulse at all (what a bump, or the island reset waking every prop, does): a prop that is balanced on a knife edge
      // tips off its pad here. The authored mailbox did (0.3 sideways, 0.5 down, 25 degrees over), as its post stood in the air.
      const wake = await page.evaluate(async (name) => {
        const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social)
        const body = inst.environment.dynamic.find((d) => d.node.userData.w2Source === name).physical.body
        inst.reset(); await new Promise((r) => setTimeout(r, 600))
        const a = body.translation(), q = body.rotation(), before = { x: a.x, y: a.y, z: a.z }
        body.wakeUp(); await new Promise((r) => setTimeout(r, 1800))
        const b = body.translation(), r = body.rotation()
        return { slid: Math.hypot(b.x - before.x, b.z - before.z), dropped: before.y - b.y, tilt: 2 * Math.acos(Math.min(1, Math.abs(q.x * r.x + q.y * r.y + q.z * r.z + q.w * r.w))) * 180 / Math.PI, asleep: body.isSleeping() }
      }, name)
      rows[`wake-${name}`] = wake
      assert(wake.slid < 0.1 && Math.abs(wake.dropped) < 0.1 && wake.tilt < 5, `${vp.name}: ${name} woken with no push stays on its pad (slid ${wake.slid.toFixed(3)}, dropped ${wake.dropped.toFixed(3)}, turned ${wake.tilt.toFixed(1)} deg, asleep ${wake.asleep})`, results)
      const push = await page.evaluate(async (name) => {
        const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social)
        const entry = inst.environment.dynamic.find((d) => d.node.userData.w2Source === name)
        if (!entry) return { error: `${name} is not a dynamic prop` }
        const body = entry.physical.body
        const at = (v) => ({ x: v.x, y: v.y, z: v.z })
        const before = at(body.translation())
        body.wakeUp()
        body.applyImpulse({ x: 2.5 * body.mass(), y: 1.5 * body.mass(), z: 0 }, true)
        await new Promise((r) => setTimeout(r, 1200))
        const moved = at(body.translation())
        const travelled = Math.hypot(moved.x - before.x, moved.z - before.z)
        inst.reset()
        await new Promise((r) => setTimeout(r, 700))
        const back = at(body.translation())
        return { travelled, homeError: Math.hypot(back.x - before.x, back.z - before.z), dropped: before.y - back.y }
      }, name)
      rows[`push-${name}`] = push
      assert(!push.error && push.travelled > 0.3, `${vp.name}: ${name} can still be pushed (${push.error ?? push.travelled.toFixed(2)} local units)`, results)
      assert(!push.error && push.homeError < 0.15 && Math.abs(push.dropped) < 0.12, `${vp.name}: the island reset returns ${name} to its pad, standing where it stood (${push.homeError?.toFixed?.(3)} g off, ${push.dropped?.toFixed?.(3)} g lower; the authored colliders used to let an icon drop 0.3-0.6 g)`, results)
    }
  }
  if (vp.name === 'desktop') {
    // Twenty rapid pushes and resets of all four props, the way a player mashing the reset prompt does: nothing drifts off its pad.
    const churn = await page.evaluate(async () => {
      const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social)
      const ents = inst.environment.dynamic.filter((d) => /gitHub|linkedIn|mail|cv/i.test(d.node.userData.w2Source ?? d.node.name))
      inst.reset(); await new Promise((r) => setTimeout(r, 700))
      const start = ents.map((e) => ({ n: e.node.userData.w2Source, ...e.physical.body.translation() }))
      for (let i = 0; i < 20; i++) {
        for (const e of ents) { const m = e.physical.body.mass(); e.physical.body.wakeUp(); e.physical.body.applyImpulse({ x: (Math.random() - 0.5) * 6 * m, y: 2 * m, z: (Math.random() - 0.5) * 6 * m }, true) }
        await new Promise((r) => setTimeout(r, 120))
        inst.reset()
      }
      await new Promise((r) => setTimeout(r, 1500))
      return ents.map((e, i) => { const t = e.physical.body.translation(); return { n: start[i].n, moved: +Math.hypot(t.x - start[i].x, t.z - start[i].z).toFixed(3), dy: +(t.y - start[i].y).toFixed(3) } })
    })
    rows.churn = churn
    assert(churn.length === 4 && churn.every((c) => c.moved < 0.1 && Math.abs(c.dy) < 0.1), `twenty rapid pushes and resets leave every prop on its pad (${churn.map((c) => `${c.n.replace('PhysicalDynamic', '')} ${c.moved}/${c.dy}`).join(', ')})`, results)
    const target = await page.evaluate(async () => {
      const m = await import('/archipelago/preview/portfolio/world2/content/achievements.js')
      const s = await import('/archipelago/preview/portfolio/world2/content/social.js')
      return { achievement: m.WORLD2_ACHIEVEMENT_BY_ID.social.target, interactive: s.interactiveContacts().length }
    })
    assert(target.achievement === 3 && target.achievement === target.interactive, `Say hello needs ${target.achievement} marks = the contacts that open something (${target.interactive})`, results)
  }
  assert(errors.length === 0, `${vp.name}: no console errors or exceptions (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}

/* ---- behaviour, on a desktop page of its own --------------------------------------------------------------------- */
if (!ONLY || ONLY.includes('desktop')) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const popups = []
  const main = []
  const reached = []
  context.on('page', (p) => (main.length ? popups.push(p) : main.push(p)))
  await context.route(/^https?:\/\/(?!localhost)/, (route) => { reached.push(route.request().url()); route.abort() })      // the outside world is never reached
  const page = await context.newPage()
  const errors = watch(page, 'behaviour ')
  await openPlayer(page)
  await sleep(1500)
  const stand = (station) => standAt(page, station)
  const progress = () => page.evaluate(() => globalThis.__archipelago.gameplay.achievements.view().find((a) => a.id === 'social'))
  const before = await progress()
  assert(before.progress === 0 && before.target === 3, `Say hello starts at 0 of 3 (${before.progress} of ${before.target})`, results)
  const startUrl = page.url()

  await stand('email'); await page.keyboard.press('KeyE'); await sleep(800)
  assert(popups.length === 0 && page.url() === startUrl, `Email hands the mailto: link to the mail app: no blank tab, the world stays where it is (${popups.length} new pages)`, results)
  await stand('github'); await page.keyboard.press('KeyE'); await sleep(1000)
  assert(popups.length === 1 && reached.some((u) => /^https:\/\/github\.com\/Ale-Newport/.test(u)), `GitHub opens in one new tab, at the right address (${popups.length} tab, requested ${reached})`, results)
  await stand('linkedin'); await page.keyboard.press('KeyE'); await sleep(800)
  const done = await progress()
  assert(done.progress === 3 && done.unlocked, `three links found = Say hello unlocked (${done.progress} of ${done.target})`, results)
  await stand('cv'); await page.keyboard.press('KeyE'); await sleep(800)
  assert(popups.length === 2 && (await progress()).progress === 3, `the CV, "On request", opens nothing and marks nothing (${popups.length} new pages)`, results)
  assert(errors.length === 0, `behaviour: no console errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()

  /* The day the CV file exists (dataStatus 'verified'), the plaza needs no change: the plaque becomes a link. */
  const verified = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await verified.route('**/portfolio/content/profile.js*', async (route) => {
    const res = await route.fetch()
    await route.fulfill({ response: res, body: (await res.text()).replace(/(id: 'cv',[\s\S]*?dataStatus: )'placeholder'/, "$1'verified'") })
  })
  const vpage = await verified.newPage()
  const verrors = watch(vpage, 'verified ')
  await openPlayer(vpage)
  await sleep(1500)
  const v = await inspect(vpage)
  const target = await vpage.evaluate(() => globalThis.__archipelago.gameplay.achievements.view().find((a) => a.id === 'social').target)
  assert(v.links.find((l) => l.id === 'cv')?.href?.endsWith('/assets/alejandro-newport-cv.pdf') && v.prompts.includes('Curriculum Vitae') && target === 4, `with a verified CV the plaque is a link with a prompt and Say hello needs 4 (prompts ${v.prompts}, target ${target})`, results)
  const parked = await standAt(vpage, 'cv')
  assert(parked.prompt === 'Curriculum Vitae', `with a verified CV, standing at its pad shows the Curriculum Vitae prompt (got ${JSON.stringify(parked.prompt)})`, results)
  await vpage.screenshot({ path: out('social-verified-cv.png') })
  assert(verrors.length === 0, `verified CV: no console errors (${verrors.slice(0, 2).join(' | ')})`, results)
  await verified.close()

  /* Leaving the world returns everything: the instance disposes without a throw and the boards go with it. */
  const leaving = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const lpage = await leaving.newPage()
  const lerrors = watch(lpage, 'dispose ')
  await openPlayer(lpage)
  await sleep(1200)
  const gone = await lpage.evaluate(() => {
    const A = globalThis.__archipelago, inst = A.gameplay.instances.find((i) => i.parts.social)
    const group = inst.parts.social.group, declared = A.driving.placement.arrivalPoints.size
    let meshes = 0; group.traverse((o) => { if (o.isMesh) meshes++ })
    inst.dispose()
    return { meshes, attached: !!inst.frame.parent, declared, left: A.driving.placement.arrivalPoints.size }
  })
  await sleep(300)
  assert(gone.meshes >= 10 && !gone.attached && lerrors.length === 0, `the Social instance disposes cleanly (${gone.meshes} meshes freed, ${lerrors.length} errors)`, results)
  assert(gone.declared === 1 && gone.left === 0, `leaving the world withdraws the plaza's arrival from the Placement (${gone.declared} declared, ${gone.left} left)`, results)
  await leaving.close()
}
/* ---- the admin studio's Edit Source Asset: the isolated scene is a CLONE of the preview ------------------------------------ */
if (STUDIO) {
  const { signIn } = await import('./admin-session.mjs')
  const { BASE } = await import('./lib.mjs')
  const { context, page } = await signIn(browser, { viewport: { width: 1440, height: 900 } })
  const errors = watch(page, 'studio ')
  await page.goto(`${BASE}/admin/world`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelector('iframe[title="World studio"]')?.contentDocument?.body?.dataset.ready === 'true', null, { timeout: 240000 })
  await sleep(1500)
  const frame = page.frameLocator('iframe[title="World studio"]')
  await frame.locator('#edit').click()
  await sleep(2000)
  const selected = await page.evaluate(() => {
    const A = document.querySelector('iframe[title="World studio"]').contentWindow.__archipelago
    let social = null
    A.editor.root.traverse((o) => { if (!social && o.userData.world2Asset === 'social') social = o })
    if (social) A.editor.select([social])
    return !!social
  })
  assert(selected, 'studio: the world has a Social instance to edit', results)
  await frame.getByText('Edit Source Asset').click()
  await sleep(3500)
  const source = await page.evaluate(() => {
    const A = document.querySelector('iframe[title="World studio"]').contentWindow.__archipelago, studio = A.editor.assetStudio
    const faces = [], mailbox = []
    studio.root.traverse((o) => {
      if (/^sign:social-.*:face$/.test(o.name)) {
        const image = o.material?.map?.image
        let ink = 0
        if (image?.getContext) { const d = image.getContext('2d').getImageData(0, 0, image.width, image.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i + 1] < 90 && d[i + 2] < 90 && d[i + 3] > 200) ink++ }
        faces.push({ name: o.name, ink })
      }
      if (o.userData.w2Source === 'mailPhysicalDynamic') mailbox.push(o.children.filter((c) => c.userData.w2Role === 'collider').map((c) => c.name))
    })
    return { active: studio.active, faces, mailbox }
  })
  assert(source.active && source.faces.length === 4 && source.faces.every((f) => f.ink > 3000), `studio: Edit Source Asset shows four boards with text on every face (${source.faces.map((f) => `${f.name.replace(/^sign:social-|:face$/g, '')} ${f.ink}`).join(', ')})`, results)
  assert(source.mailbox.length === 1 && source.mailbox[0].includes('cuboid.foot'), `studio: the mailbox has its foot in the source asset (${source.mailbox.map((m) => m.join('+'))})`, results)
  await page.screenshot({ path: out('social-studio-source-asset.png') })
  assert(errors.length === 0, `studio: no console errors (${errors.slice(0, 2).join(' | ')})`, results)
  await context.close()
}
await browser.close()
fs.writeFileSync(out('social-report.json'), JSON.stringify(report, null, 1))
finish(results)
