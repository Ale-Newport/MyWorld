/* Ad-hoc ground probe under NEWPORT LANES.
 *
 * One question: how much relief the rectangular `pad` in PLAY_SPOTS leaves
 * under the venue. `Bowling.build` sets the deck above the HIGHEST ground in
 * the footprint, so whatever this reports as (max - min) is the height of the
 * plinth on the low side — the number `world-environment.ts` calls "about
 * 0.7 m" — and the apron has to ramp down over it.
 *
 * The five boxes this replaces were world-space literals: x 70.2..81.9,
 * z 29..68, from a build where the lane ran north-south beside the hub. The
 * venue is south-west of there now and its lane runs east to west, so all
 * five of those boxes sampled open grass on the other side of the island and
 * reported a beautifully flat nothing.
 *
 * Nothing below is typed. The footprint comes off the venue's own colliders,
 * the bands off its pin spots and its mark, and the pad off PLAY_SPOTS.
 */
import { chromium } from 'playwright'
const base = process.argv[2] ?? 'http://localhost:52570'
const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader', '--use-gl=angle'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('PAGEERROR', String(e).slice(0, 300)))
await page.goto(`${base}/world`, { waitUntil: 'domcontentloaded' })
await page.getByRole('button', { name: 'ENTER', exact: true }).click({ timeout: 120000 })
await page.waitForFunction(() => window.__world?.player?.state === 'default')
const out = await page.evaluate(() => {
  const g = window.__world
  const spot = g.geography.PLAY_SPOTS.find((s) => s.id === 'bowling')
  const yaw = spot.rotation ?? 0
  const cos = Math.cos(yaw), sin = Math.sin(yaw)
  // The venue's own frame: +Z behind the bowler, -Z down-lane, as Bowling.ts
  // authors it. These four are the same four functions that file uses.
  const wx = (dx, dz) => spot.x + dx * cos + dz * sin
  const wz = (dx, dz) => spot.z - dx * sin + dz * cos
  const lx = (x, z) => (x - spot.x) * cos - (z - spot.z) * sin
  const lz = (x, z) => (x - spot.x) * sin + (z - spot.z) * cos

  // The venue shell is ONE fixed body at the spot carrying every cuboid of
  // lane, gutter, deck, pit, kickback and masking unit, so its colliders are
  // the footprint. Reading them means a re-cut lane moves this probe with it.
  const shell = g.physics.physicals
    .filter((p) => p.static && Math.hypot(p.initialState.position.x - spot.x, p.initialState.position.z - spot.z) < 1)
    .sort((a, b) => b.colliders.length - a.colliders.length)[0]
  const box = { dx: 0, back: Infinity, front: -Infinity }
  for (const c of shell?.colliders ?? []) {
    const h = c.halfExtents?.()
    if (!h) continue
    const t = c.translation()
    box.dx = Math.max(box.dx, Math.abs(lx(t.x, t.z)) + h.x)
    box.back = Math.min(box.back, lz(t.x, t.z) - h.z)
    box.front = Math.max(box.front, lz(t.x, t.z) + h.z)
  }

  // Bail rather than sample from -Infinity to Infinity: if the shell stops
  // being one body at the spot, everything below is measuring nothing.
  if (!Number.isFinite(box.back) || !Number.isFinite(box.front)) {
    return { error: 'no venue shell found at PLAY_SPOTS.bowling', spot: { x: spot.x, z: spot.z } }
  }

  const lanes = g.minigames.get('bowling')
  const pinDz = Math.max(...lanes.pins.map((p) => lz(p.spot.x, p.spot.z)))
  const markDz = lz(lanes.startPosition.x, lanes.startPosition.z)
  const floorY = lanes.floorY ?? lanes.startPosition.y - 1.5

  // Bands along the lane, named for what stands on them. The apron runs on
  // past the venue's own edge at the bowler's end — it is the drive-up, and
  // it is the piece that used to hang off the end of a circular flattening.
  const bands = [
    ['pit and deck', box.dx, box.back, pinDz + 2],
    ['lane bed', box.dx, pinDz + 2, markDz],
    ['approach and mark', box.dx, markDz, box.front],
    ['apron', box.dx, box.front, box.front + 12],
    ['whole venue', box.dx, box.back, box.front],
  ]
  const sample = (halfW, from, to) => {
    let min = Infinity, max = -Infinity, maxAt = null, minAt = null
    for (let dz = from; dz <= to; dz += 0.5) for (let dx = -halfW; dx <= halfW; dx += 0.5) {
      const x = wx(dx, dz), z = wz(dx, dz)
      const h = g.terrain.colliderHeightAt(x, z)
      if (h < min) { min = h; minAt = [+x.toFixed(1), +z.toFixed(1)] }
      if (h > max) { max = h; maxAt = [+x.toFixed(1), +z.toFixed(1)] }
    }
    return { min: +min.toFixed(2), max: +max.toFixed(2), relief: +(max - min).toFixed(2), minAt, maxAt }
  }

  const rows = bands.map(([name, halfW, from, to]) => ({
    name, local: [+from.toFixed(1), +to.toFixed(1)], ...sample(halfW, from, to),
  }))
  // The pad's own rectangle, in the pad's frame rather than the venue's, so a
  // pad that has drifted off the venue shows as a different relief here. The
  // pad carries a rotation of its own — zero today — so it is walked the same
  // way `world-environment.ts`'s `rectangle` helper builds it, not as a
  // world-aligned box that would quietly start sampling the wrong ground.
  const pad = spot.pad
  const pc = Math.cos(pad.rotation ?? 0), ps = Math.sin(pad.rotation ?? 0)
  const padX = (dx, dz) => pad.x + dx * pc - dz * ps
  const padZ = (dx, dz) => pad.z + dx * ps + dz * pc
  let padMin = Infinity, padMax = -Infinity
  for (let dz = -pad.width / 2; dz <= pad.width / 2; dz += 0.5)
    for (let dx = -pad.length / 2; dx <= pad.length / 2; dx += 0.5) {
      const h = g.terrain.colliderHeightAt(padX(dx, dz), padZ(dx, dz))
      if (h < padMin) padMin = h
      if (h > padMax) padMax = h
    }
  rows.push({ name: 'pad', local: null, min: +padMin.toFixed(2), max: +padMax.toFixed(2), relief: +(padMax - padMin).toFixed(2), minAt: null, maxAt: null })

  return {
    spot: { x: spot.x, z: spot.z, yaw: +yaw.toFixed(3) },
    footprint: { halfWidth: +box.dx.toFixed(2), back: +box.back.toFixed(1), front: +box.front.toFixed(1) },
    pinDz: +pinDz.toFixed(1), markDz: +markDz.toFixed(1), floorY: +floorY.toFixed(2),
    // Positive is the plinth the venue stands on; negative is ground poking
    // through the deck, which is the failure this probe exists to catch.
    clearance: +(floorY - rows.find((r) => r.name === 'whole venue').max).toFixed(2),
    // Does the pad still cover the venue, apron included? Four venue corners
    // taken back into the pad's frame; false means part of the drive-up is
    // standing on ground nothing levelled, which is the defect the rectangular
    // pad replaced a disc to fix.
    padCoversVenue: (() => {
      const corners = [[-box.dx, box.back], [box.dx, box.back], [-box.dx, box.front + 12], [box.dx, box.front + 12]]
      return corners.every(([dx, dz]) => {
        const ox = wx(dx, dz) - pad.x, oz = wz(dx, dz) - pad.z
        return Math.abs(ox * pc + oz * ps) <= pad.length / 2 && Math.abs(-ox * ps + oz * pc) <= pad.width / 2
      })
    })(),
    rows,
  }
})
console.log(JSON.stringify(out, null, 1))
await browser.close()
