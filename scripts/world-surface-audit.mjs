/**
 * SURFACE AUDIT — where the terrain fights the things built on it.
 *
 *   node scripts/world-surface-audit.mjs [baseUrl]
 *
 * Everything in this world gets its height from one pure function,
 * `Terrain.heightAt`, composed of ordered blend stages. A gameplay
 * surface is flat only if no LATER stage claims its ground back. This
 * walks every authored surface and reports where that happened, in
 * metres, with coordinates — so a fix can be aimed rather than guessed.
 *
 * It measures six things:
 *
 *   CIRCUIT     cross-track relief on the racing surface
 *   ROADS       cross-carriageway relief, and the mesh's clearance
 *   PADS        relief over each play spot's own footprint
 *   RAMPS       terrain protrusion through the ramp deck
 *   VEGETATION  grass and trees standing on surfaces that exclude them
 *   PROPS       anything floating above or buried below its ground
 *
 * Read-only. It drives nothing and changes nothing.
 */
import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'node:fs'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./_ts-loader.mjs', pathToFileURL('./scripts/'))
const CONTENT = await import('../src/content/world.ts')

const ARGS = process.argv.slice(2)
/* `--assert` turns the reporter into a gate. Off by default so the
   script stays usable for ad-hoc measurement, which is most of what it
   is for; `npm run world:gate` passes it. */
const ASSERT = ARGS.includes('--assert')
const BASE = ARGS.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000'

/* The authored tables, read from the content layer rather than from
   the running scene: `Roads` merges its thirteen carriageways into one
   mesh and keeps no list, and a ramp's base plane is computed inside
   `World.buildRamps`. Both are derived here from the same source those
   two read, so the probe cannot drift from what is built. */
const ROADS = CONTENT.roads.map((r) => ({ id: r.id, width: r.width, points: r.points }))
const RAMPS = CONTENT.ramps.map((r) => ({
  id: r.id, x: r.x, z: r.z, length: r.length, width: r.width,
  rotation: r.rotation, height: r.height,
}))

/* The tolerances. A gameplay surface is meant to be FLAT, so these are
   tight: 6 cm is the thickness of the bowling slab, and anything past
   it is visible as a bump at driving speed. */
const FLAT_TOLERANCE = 0.06
/* Roads follow the land along their length, so only relief ACROSS the
   carriageway is a defect. A 15 cm crown is intentional. */
const ROAD_TOLERANCE = 0.2
/* Every play spot that declares ground of its own. Stated here rather
   than counted from the report so the gate fails if a venue's pad
   silently stops being measured. */
const PADS_EXPECTED = 5

const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--use-gl=angle'],
})
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
await page.goto(`${BASE}/world`, { waitUntil: 'domcontentloaded', timeout: 90000 })
await page.waitForFunction(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent?.trim() === 'ENTER')
  return b && !b.disabled
}, { timeout: 120000 })
await page.getByRole('button', { name: 'ENTER', exact: true }).click()
await page.waitForFunction(() => Boolean(window.__world?.terrain), { timeout: 60000 })
await page.waitForTimeout(2500)

const report = await page.evaluate(({ FLAT_TOLERANCE, ROAD_TOLERANCE, ROADS, RAMPS }) => {
  const g = window.__world
  const geo = g.geography
  const H = (x, z) => g.terrain.colliderHeightAt(x, z)
  const out = { circuit: [], roads: [], pads: [], ramps: [], vegetation: [], props: [], scene: {} }

  /* ========================================================
     CIRCUIT — cross-track relief

     Walk the centreline; at every station take a transect ACROSS the
     track and report the spread. The lap is meant to be levelled to
     one height, so any spread at all is a stage that ran afterwards.
     ======================================================== */
  {
    const track = geo.CIRCUIT_TRACK
    const half = geo.CIRCUIT.width / 2
    const stations = 480
    // Resample the closed centreline to even spacing so the report's
    // station index means the same distance everywhere.
    const cum = [0]
    for (let i = 1; i <= track.length; i++) {
      const a = track[i - 1]
      const b = track[i % track.length]
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]))
    }
    const lap = cum[track.length]
    const at = (s) => {
      s = ((s % lap) + lap) % lap
      let i = 1
      while (i < cum.length && cum[i] < s) i++
      const a = track[(i - 1) % track.length]
      const b = track[i % track.length]
      const seg = cum[i] - cum[i - 1] || 1
      const t = (s - cum[i - 1]) / seg
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
    }
    for (let i = 0; i < stations; i++) {
      const s = (lap * i) / stations
      const [x, z] = at(s)
      const [nx, nz] = at(s + 0.5)
      const dx = nx - x
      const dz = nz - z
      const len = Math.hypot(dx, dz) || 1
      // Normal to the centreline, in the ground plane.
      const px = -dz / len
      const pz = dx / len
      let lo = Infinity
      let hi = -Infinity
      let loAt = null
      let hiAt = null
      for (let k = -10; k <= 10; k++) {
        const o = (k / 10) * half
        const sx = x + px * o
        const sz = z + pz * o
        const h = H(sx, sz)
        if (h < lo) { lo = h; loAt = [sx, sz] }
        if (h > hi) { hi = h; hiAt = [sx, sz] }
      }
      const relief = hi - lo
      if (relief > FLAT_TOLERANCE) {
        out.circuit.push({
          station: i,
          metresRound: Math.round(s),
          centre: [+x.toFixed(1), +z.toFixed(1)],
          relief: +relief.toFixed(3),
          low: [+loAt[0].toFixed(1), +loAt[1].toFixed(1), +lo.toFixed(2)],
          high: [+hiAt[0].toFixed(1), +hiAt[1].toFixed(1), +hi.toFixed(2)],
          // What is nearby that could be claiming this ground back?
          water: (() => {
            let best = null
            for (const lake of geo.LAKES) {
              const n = Math.hypot((x - lake.x) / lake.rx, (z - lake.z) / lake.rz)
              const approx = (n - 1) * Math.min(lake.rx, lake.rz)
              if (!best || approx < best.d) best = { id: lake.id ?? 'lake', d: +approx.toFixed(1) }
            }
            const river = geo.lineDistance(x, z, geo.RIVER.points) - geo.RIVER.width / 2
            if (!best || river < best.d) best = { id: 'river', d: +river.toFixed(1) }
            return best
          })(),
          coastInset: +geo.coastInset(x, z).toFixed(1),
        })
      }
    }
    out.scene.circuitStations = stations
    out.scene.circuitLevel = +H(geo.CIRCUIT_TRACK[0][0], geo.CIRCUIT_TRACK[0][1]).toFixed(3)
    out.scene.circuitLap = +lap.toFixed(1)
  }

  /* ========================================================
     ROADS — cross-carriageway relief, and mesh clearance
     ======================================================== */
  {
    out.scene.roadsWalked = 0
    for (const road of ROADS) {
      out.scene.roadsWalked++
      let worst = null
      const pts = road.points
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i]
        const b = pts[i + 1]
        const seg = Math.hypot(b[0] - a[0], b[1] - a[1])
        const steps = Math.max(2, Math.ceil(seg / 2))
        for (let k = 0; k <= steps; k++) {
          const t = k / steps
          const x = a[0] + (b[0] - a[0]) * t
          const z = a[1] + (b[1] - a[1]) * t
          const dx = b[0] - a[0]
          const dz = b[1] - a[1]
          const len = Math.hypot(dx, dz) || 1
          const px = -dz / len
          const pz = dx / len
          const half = road.width / 2
          let lo = Infinity
          let hi = -Infinity
          for (let j = -6; j <= 6; j++) {
            const o = (j / 6) * half
            const h = H(x + px * o, z + pz * o)
            if (h < lo) lo = h
            if (h > hi) hi = h
          }
          if (!worst || hi - lo > worst.relief) {
            worst = { relief: +(hi - lo).toFixed(3), at: [+x.toFixed(1), +z.toFixed(1)] }
          }
        }
      }
      if (worst && worst.relief > ROAD_TOLERANCE) out.roads.push({ id: road.id, ...worst })
    }
  }

  /* ========================================================
     PADS — relief over each play spot footprint
     ======================================================== */
  {
    for (const spot of geo.PLAY_SPOTS) {
      const samples = []
      if (spot.pad) {
        const p = spot.pad
        const cos = Math.cos(p.rotation)
        const sin = Math.sin(p.rotation)
        // Sample the CORE only — the outer 15% is the blend shoulder
        // and is meant to slope.
        for (let a = -0.85; a <= 0.85; a += 0.07) {
          for (let c = -0.85; c <= 0.85; c += 0.07) {
            const la = (a * p.length) / 2
            const lc = (c * p.width) / 2
            samples.push([p.x + la * cos - lc * sin, p.z + la * sin + lc * cos])
          }
        }
      } else if (spot.flat) {
        for (let r = 0; r <= 0.8; r += 0.08) {
          for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
            samples.push([spot.x + Math.cos(a) * r * spot.flat, spot.z + Math.sin(a) * r * spot.flat])
          }
        }
      } else continue
      let lo = Infinity
      let hi = -Infinity
      let loAt = null
      let hiAt = null
      for (const [x, z] of samples) {
        const h = H(x, z)
        if (h < lo) { lo = h; loAt = [x, z] }
        if (h > hi) { hi = h; hiAt = [x, z] }
      }
      const relief = hi - lo
      out.pads.push({
        id: spot.id,
        relief: +relief.toFixed(3),
        ok: relief <= FLAT_TOLERANCE,
        low: [+loAt[0].toFixed(1), +loAt[1].toFixed(1), +lo.toFixed(2)],
        high: [+hiAt[0].toFixed(1), +hiAt[1].toFixed(1), +hi.toFixed(2)],
        samples: samples.length,
      })
    }
  }

  /* ========================================================
     RAMPS — does the ground poke through the deck?
     ======================================================== */
  {
    for (const r of RAMPS) {
      // The deck as a function of distance along the ramp's axis.
      const cos = Math.cos(r.rotation)
      const sin = Math.sin(r.rotation)
      /* THE BASE PLANE, derived the way `World.buildRamps` derives it:
         the LOWER of the foot's ground and the centre's, so the low end
         cannot stand on a step. Recomputed here rather than read off
         the mesh because the mesh carries it only as a world matrix. */
      const foot = {
        x: r.x - cos * (r.length / 2 - 1),
        z: r.z + sin * (r.length / 2 - 1),
      }
      r.baseY = Math.min(H(foot.x, foot.z), H(r.x, r.z))
      let worst = null
      /*
         THE RAMP'S OWN FRAME, and it has to be the SAME frame
         `World.buildRamps` and `rampPadAt` use: forward is
         (cos, -sin) and across is (sin, cos). Written with `+la*sin`
         this walked a mirrored ramp — for `ramp-landing`, whose
         rotation is 2.89 rad, the sampled deck lay off the real one
         entirely, and the 0.242 m protrusion it reported was measured
         on open ground beside the ramp.
      */
      for (let a = -0.5; a <= 0.5; a += 0.02) {
        for (let c = -0.5; c <= 0.5; c += 0.05) {
          const la = a * r.length
          const lc = c * r.width
          const x = r.x + la * cos + lc * sin
          const z = r.z - la * sin + lc * cos
          // Deck height: linear from foot (0) to lip (height).
          const deck = r.baseY + r.height * (a + 0.5)
          const ground = H(x, z)
          const through = ground - deck
          if (!worst || through > worst.through) {
            worst = { through: +through.toFixed(3), at: [+x.toFixed(1), +z.toFixed(1)], deck: +deck.toFixed(2), ground: +ground.toFixed(2) }
          }
        }
      }
      // And the twelve metres in front of the foot, which the car
      // crosses at speed.
      let approach = null
      for (let d = 1; d <= 14; d += 0.5) {
        const x = r.x - cos * (r.length / 2 + d)
        const z = r.z + sin * (r.length / 2 + d)
        const h = H(x, z)
        if (!approach) approach = { lo: h, hi: h }
        approach.lo = Math.min(approach.lo, h)
        approach.hi = Math.max(approach.hi, h)
      }
      out.ramps.push({
        id: r.id,
        baseY: +r.baseY.toFixed(2),
        protrusion: worst,
        approachRelief: +(approach.hi - approach.lo).toFixed(3),
        footStep: +(H(r.x - cos * (r.length / 2 + 1), r.z + sin * (r.length / 2 + 1)) - r.baseY).toFixed(3),
      })
    }
  }

  /* ========================================================
     VEGETATION — anything growing on a surface that excludes it
     ======================================================== */
  {
    const offenders = []
    const test = (x, z) => {
      // On the racing surface?
      let onTrack = false
      {
        const t = geo.CIRCUIT_TRACK
        let best = Infinity
        for (let i = 0; i < t.length; i++) {
          const a = t[i]
          const b = t[(i + 1) % t.length]
          const dx = b[0] - a[0]
          const dz = b[1] - a[1]
          const l2 = dx * dx + dz * dz || 1
          let u = ((x - a[0]) * dx + (z - a[1]) * dz) / l2
          u = Math.max(0, Math.min(1, u))
          const d = Math.hypot(x - (a[0] + dx * u), z - (a[1] + dz * u))
          if (d < best) best = d
        }
        onTrack = best < geo.CIRCUIT.width / 2
      }
      let onRoad = false
      for (const road of ROADS) {
        if (geo.lineDistance(x, z, road.points) < road.width / 2) { onRoad = true; break }
      }
      const suppressed = geo.vegetationSuppressed(x, z)
      let onPad = null
      for (const spot of geo.PLAY_SPOTS) {
        if (!spot.pad) continue
        const p = spot.pad
        const cos = Math.cos(p.rotation)
        const sin = Math.sin(p.rotation)
        const dx = x - p.x
        const dz = z - p.z
        if (Math.abs(dx * cos + dz * sin) < p.length / 2 && Math.abs(-dx * sin + dz * cos) < p.width / 2) {
          onPad = spot.id
          break
        }
      }
      return { onTrack, onRoad, onPad, suppressed }
    }

    /*
       EVERY instance of EVERY instanced mesh, in WORLD space.

       Not a name filter. The first version of this check looked for
       meshes called /grass|bush|tree/ and found none, because every
       instanced mesh in this scene is unnamed — so it reported "ok"
       having examined nothing, which is the exact shape of failure the
       shore check once had. Testing everything cannot lie about
       coverage: `meshesExamined` and `instancesExamined` are reported
       alongside the offenders, and a zero there is a broken probe
       rather than a clean world.
    */
    let meshesExamined = 0
    let instancesExamined = 0
    g.renderer.scene.traverse((o) => {
      if (!o.isInstancedMesh) return
      meshesExamined++
      o.updateWorldMatrix(true, false)
      const w = o.matrixWorld.elements
      const arr = o.instanceMatrix.array
      let bad = 0
      const worst = []
      for (let i = 0; i < o.count; i++) {
        // Instance translation through the mesh's own world matrix.
        const lx = arr[i * 16 + 12]
        const ly = arr[i * 16 + 13]
        const lz = arr[i * 16 + 14]
        const x = w[0] * lx + w[4] * ly + w[8] * lz + w[12]
        const z = w[2] * lx + w[6] * ly + w[10] * lz + w[14]
        if (!isFinite(x) || !isFinite(z)) continue
        instancesExamined++
        const r = test(x, z)
        if (r.onTrack || r.onRoad || r.onPad) {
          bad++
          if (worst.length < 6) worst.push({ at: [+x.toFixed(1), +z.toFixed(1)], ...r })
        }
      }
      if (bad) {
        offenders.push({
          mesh: o.name || `(unnamed, ${o.count} instances)`,
          count: o.count,
          offenders: bad,
          samples: worst,
        })
      }
    })
    out.scene.vegetationCoverage = { meshesExamined, instancesExamined }
    out.vegetation = offenders
  }

  /* ========================================================
     PROPS — floating above their ground, or buried in it

     World space again, and PARKED instances are excluded: an instanced
     pool reserves slots it has not filled, and an unfilled slot is a
     zero matrix or a position pushed out of sight. Those are not props
     off their ground, they are empty seats — counted separately so the
     number here means what it says.
     ======================================================== */
  {
    const bad = []
    /* COUNTED UNCONDITIONALLY, sampled with a cap. Reporting
       `bad.length` as the total meant the cap WAS the total: the
       first run of this script printed "60 total" because it stopped
       collecting at 60, and the real figure was an order of magnitude
       larger. The cap may truncate what is shown; it may not truncate
       what is counted. */
    let offenders = 0
    let floating = 0
    let buried = 0
    let parked = 0
    let examined = 0
    g.renderer.scene.traverse((o) => {
      if (!o.isInstancedMesh) return
      o.updateWorldMatrix(true, false)
      const w = o.matrixWorld.elements
      const arr = o.instanceMatrix.array
      for (let i = 0; i < o.count; i++) {
        const lx = arr[i * 16 + 12]
        const ly = arr[i * 16 + 13]
        const lz = arr[i * 16 + 14]
        // A zero matrix scales the instance to nothing: it is parked.
        const scale = Math.hypot(arr[i * 16 + 0], arr[i * 16 + 1], arr[i * 16 + 2])
        if (scale < 1e-4) { parked++; continue }
        const x = w[0] * lx + w[4] * ly + w[8] * lz + w[12]
        const y = w[1] * lx + w[5] * ly + w[9] * lz + w[13]
        const z = w[2] * lx + w[6] * ly + w[10] * lz + w[14]
        if (!isFinite(x) || Math.hypot(x, z) > 260) { parked++; continue }
        examined++
        const ground = H(x, z)
        const gap = y - ground
        if (gap > 2.5 || gap < -1.2) {
          offenders++
          if (gap > 0) floating++
          else buried++
          if (bad.length < 80) {
            bad.push({
              mesh: o.name || `(unnamed, ${o.count})`,
              at: [+x.toFixed(1), +z.toFixed(1)],
              y: +y.toFixed(2), ground: +ground.toFixed(2), gap: +gap.toFixed(2),
            })
          }
        }
      }
    })
    out.props = bad
    out.scene.propCoverage = { examined, parked, offenders, floating, buried, sampled: bad.length }
  }

  /* ========================================================
     SCENE CENSUS — duplicates, draw calls, materials
     ======================================================== */
  {
    const materials = new Map()
    const geometries = new Set()
    let meshes = 0
    let instanced = 0
    let triangles = 0
    const byName = new Map()
    g.renderer.scene.traverse((o) => {
      if (o.isInstancedMesh) instanced++
      else if (o.isMesh) meshes++
      if (o.isMesh || o.isInstancedMesh) {
        byName.set(o.name || '(unnamed)', (byName.get(o.name || '(unnamed)') ?? 0) + 1)
        geometries.add(o.geometry.uuid)
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const mm of mats) {
          if (!mm) continue
          const key = `${mm.type}|${mm.color?.getHexString?.() ?? ''}|${mm.roughness ?? ''}|${mm.metalness ?? ''}|${mm.map?.uuid ?? ''}|${mm.transparent}|${mm.opacity}`
          if (!materials.has(key)) materials.set(key, { key, uuids: new Set(), names: new Set() })
          materials.get(key).uuids.add(mm.uuid)
          materials.get(key).names.add(mm.name || o.name || '')
        }
        const pos = o.geometry.attributes?.position
        if (pos) triangles += (o.geometry.index ? o.geometry.index.count : pos.count) / 3 * (o.isInstancedMesh ? o.count : 1)
      }
    })
    out.scene.meshes = meshes
    out.scene.instancedMeshes = instanced
    out.scene.uniqueGeometries = geometries.size
    out.scene.triangles = Math.round(triangles)
    out.scene.duplicateMaterials = [...materials.values()]
      .filter((v) => v.uuids.size > 1)
      .map((v) => ({ signature: v.key, copies: v.uuids.size, names: [...v.names].slice(0, 6) }))
      .sort((a, b) => b.copies - a.copies)
      .slice(0, 25)
    out.scene.repeatedNames = [...byName.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 25)
    out.scene.renderInfo = {
      calls: g.renderer.instance?.info?.render?.calls ?? null,
      triangles: g.renderer.instance?.info?.render?.triangles ?? null,
      geometries: g.renderer.instance?.info?.memory?.geometries ?? null,
      textures: g.renderer.instance?.info?.memory?.textures ?? null,
    }
  }

  return out
}, { FLAT_TOLERANCE, ROAD_TOLERANCE, ROADS, RAMPS })

await browser.close()

mkdirSync('.qa', { recursive: true })
writeFileSync('.qa/surface-audit.json', JSON.stringify(report, null, 2))

/* ---- the readable version ---------------------------------- */
const f = (n) => (typeof n === 'number' ? n.toFixed(2) : String(n))
console.log(`\nSURFACE AUDIT — ${BASE}\n`)

console.log(`CIRCUIT  (level ${f(report.scene.circuitLevel)} m, lap ${f(report.scene.circuitLap)} m)`)
if (!report.circuit.length) console.log('  ok    the racing surface is flat across its whole width\n')
else {
  const worst = [...report.circuit].sort((a, b) => b.relief - a.relief)
  console.log(`  FAIL  ${report.circuit.length}/480 stations carry relief across the track`)
  console.log(`        worst ${f(worst[0].relief)} m at (${worst[0].centre}) — nearest water ${worst[0].water.id} ${worst[0].water.d} m, coast inset ${worst[0].coastInset} m`)
  for (const s of worst.slice(0, 12)) {
    console.log(`        ${String(s.relief).padStart(6)} m  centre (${String(s.centre[0]).padStart(7)}, ${String(s.centre[1]).padStart(7)})  low ${s.low[2]}  high ${s.high[2]}  water ${s.water.id}@${s.water.d}m`)
  }
  console.log()
}

console.log('ROADS')
if (!report.roads.length) console.log('  ok    every carriageway is level across its width\n')
else {
  for (const r of report.roads.sort((a, b) => b.relief - a.relief)) {
    console.log(`  FAIL  ${r.id.padEnd(28)} ${f(r.relief)} m across at (${r.at})`)
  }
  console.log()
}

console.log('PLAY-SPOT PADS')
for (const p of report.pads.sort((a, b) => b.relief - a.relief)) {
  console.log(`  ${p.ok ? 'ok  ' : 'FAIL'}  ${p.id.padEnd(22)} relief ${f(p.relief)} m   low ${p.low[2]} at (${p.low[0]}, ${p.low[1]})  high ${p.high[2]}`)
}
console.log()

console.log('RAMPS')
for (const r of report.ramps) {
  const through = r.protrusion?.through ?? 0
  const flag = through > 0.05 || Math.abs(r.footStep) > 0.25 || r.approachRelief > 0.5 ? 'FAIL' : 'ok  '
  console.log(`  ${flag}  ${r.id.padEnd(22)} ground through deck ${f(through)} m at (${r.protrusion?.at})  foot step ${f(r.footStep)} m  approach relief ${f(r.approachRelief)} m`)
}
console.log()

console.log('VEGETATION / SCATTER ON GAMEPLAY SURFACES')
console.log(`  (examined ${report.scene.vegetationCoverage.instancesExamined} instances across ${report.scene.vegetationCoverage.meshesExamined} instanced meshes)`)
if (!report.scene.vegetationCoverage.instancesExamined) console.log('  BROKEN  the probe examined nothing — this is not a pass\n')
else if (!report.vegetation.length) console.log('  ok    nothing is growing where it should not\n')
else {
  for (const v of report.vegetation) {
    console.log(`  FAIL  ${v.mesh.padEnd(24)} ${v.offenders}/${v.count} instances`)
    for (const s of v.samples.slice(0, 4)) {
      const why = [s.onTrack && 'track', s.onRoad && 'road', s.onPad && `pad:${s.onPad}`].filter(Boolean).join(' ')
      console.log(`        (${s.at}) on ${why}${s.suppressed ? '' : '  — and vegetationSuppressed() says NO'}`)
    }
  }
  console.log()
}

console.log('PROPS OFF THEIR GROUND')
console.log(`  (examined ${report.scene.propCoverage.examined} placed instances; ${report.scene.propCoverage.parked} parked slots skipped)`)
if (!report.props.length) console.log('  ok    nothing floating, nothing buried\n')
else {
  for (const p of report.props.slice(0, 20)) {
    console.log(`  ${p.gap > 0 ? 'FLOAT' : 'BURY '} ${p.mesh.padEnd(22)} gap ${f(p.gap)} m at (${p.at})`)
  }
  const pc = report.scene.propCoverage
  console.log(`  ${pc.offenders} off their ground of ${pc.examined} examined — ${pc.floating} floating, ${pc.buried} buried (${pc.sampled} listed)\n`)
}

console.log('SCENE')
console.log(`  meshes ${report.scene.meshes}, instanced ${report.scene.instancedMeshes}, unique geometries ${report.scene.uniqueGeometries}`)
console.log(`  draw calls ${report.scene.renderInfo.calls}, triangles ${report.scene.renderInfo.triangles}, textures ${report.scene.renderInfo.textures}`)
if (report.scene.duplicateMaterials.length) {
  console.log(`  duplicate material signatures: ${report.scene.duplicateMaterials.length}`)
  for (const d of report.scene.duplicateMaterials.slice(0, 10)) {
    console.log(`    ${d.copies}x  ${d.signature.slice(0, 70)}  ${[...d.names].slice(0, 3).join(', ')}`)
  }
}
console.log('\nwritten → .qa/surface-audit.json\n')

/* ============================================================
   THE GATE

   A reporter that prints 207 failures and exits 0 is a reporter
   nothing can depend on. Two kinds of assertion, and the second
   matters more than the first: a COVERAGE FLOOR fails when the probe
   examined less than it was supposed to, so a filter that quietly
   stops matching can never again be mistaken for a clean world. This
   script's own vegetation check shipped with exactly that bug.
   ============================================================ */
if (ASSERT) {
  const problems = []
  const floor = (what, actual, expected) => {
    if (actual < expected) problems.push(`COVERAGE: ${what} — examined ${actual}, expected at least ${expected}`)
  }

  floor('circuit stations', report.scene.circuitStations ?? 0, 480)
  floor('roads walked', report.scene.roadsWalked ?? 0, ROADS.length)
  floor('pads measured', report.pads.length, PADS_EXPECTED)
  floor('ramps measured', report.ramps.length, RAMPS.length)
  floor('instanced meshes', report.scene.vegetationCoverage.meshesExamined, 1)
  floor('scatter instances', report.scene.vegetationCoverage.instancesExamined, 1)
  floor('placed prop instances', report.scene.propCoverage.examined, 1)

  if (report.circuit.length) problems.push(`CIRCUIT: ${report.circuit.length} stations carry cross-track relief above ${FLAT_TOLERANCE} m`)
  if (report.roads.length) problems.push(`ROADS: ${report.roads.length} carriageways exceed ${ROAD_TOLERANCE} m across`)
  for (const p of report.pads) if (!p.ok) problems.push(`PAD ${p.id}: ${p.relief.toFixed(3)} m of relief over its own core`)
  for (const r of report.ramps) {
    const through = r.protrusion?.through ?? 0
    if (through > 0.05) problems.push(`RAMP ${r.id}: ground stands ${through.toFixed(3)} m through the deck`)
    if (Math.abs(r.footStep) > 0.25) problems.push(`RAMP ${r.id}: ${r.footStep.toFixed(3)} m step at the foot`)
  }
  for (const v of report.vegetation) problems.push(`SCATTER: ${v.offenders}/${v.count} instances of ${v.mesh} stand on a gameplay surface`)

  if (problems.length) {
    console.log('FAILED')
    for (const p of problems) console.log(`  ${p}`)
    console.log()
    process.exit(1)
  }
  console.log('ALL SURFACE CHECKS PASSED\n')
}
