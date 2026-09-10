import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { palette } from '../core/palette'
import { seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Materials } from './materials'
import { roads } from '@/content/world'
import type { Terrain } from './Terrain'

/* ============================================================
   THE DIRT ROADS, AS GEOMETRY

   Every path on this island used to be a stroke on the terrain's
   colour map, and that map is one canvas across the whole 350 m
   field. At 1536 px that is 0.23 m per texel; the driving camera
   is a 25° lens on a 21 m boom, which spans about 16.6 m of
   ground and puts roughly 116 screen pixels on a world metre. One
   ground texel is therefore 26 screen pixels wide — 39 at
   devicePixelRatio 2 — and every scrap of "surface" the road had
   was per-texel noise, so the road arrived on screen as a field
   of flat squares softened by bilinear magnification. That is the
   pixelation, exactly, and no canvas size fixes it: one texel per
   screen pixel would need a 58,000 px map.

   The fix is to stop asking one texture to cover 122,500 m². The
   roads get their own ribbon with ROAD-LOCAL UVs, so a 512² dirt
   map tiled every four metres puts 0.0078 m on a texel — thirty
   times finer than the ground map — and the tile follows the road
   instead of the world, so an albedo and a normal map together
   cost 2.8 MB with mipmaps regardless of how long the network is.
   The whole ribbon is 9,444 vertices and 17,038 triangles: 530 KB
   of buffers, and ONE draw call for all thirteen roads.

   THREE THINGS THIS RIBBON MUST NOT DO.

   It must not carry a collider. The terrain already flattens a
   corridor under every road and the car drives on the heightfield;
   a second surface a few centimetres above it is a lip to catch a
   wheel on.

   It must not follow a spline. `Terrain.heightAt` flattens around
   the RAW polyline, and these roads have three to nine points at
   fifteen to forty metres apart — a Catmull-Rom through them cuts
   every corner by metres and walks the ribbon straight off the
   flattened ground into the rough. `CircuitRace.buildTrack` gets
   away with a curve because its points are ten metres apart.

   And it must not be thirteen draw calls. All thirteen roads merge
   into one BufferGeometry with one material.
   ============================================================ */

/**
 * How far the ribbon sits above the DRAWN ground, metres, per quality.
 *
 * It rides `Terrain.surfaceHeightAt`, not `colliderHeightAt`, and the
 * difference is not academic: the visible mesh is a lattice of flat
 * triangles up to 2.73 m across at low quality, and measured along the
 * whole road network it stands as much as 0.241 m ABOVE the collider
 * surface (0.146 m at medium, 0.094 m at high). A ribbon on the
 * collider is buried for stretches of every road.
 *
 * It scales with quality because what `refine` leaves behind does.
 * `refine` splits a span that sinks ALONG the road; nothing splits one
 * that sinks ACROSS it, and on a coarse mesh a pair of columns can
 * chord over a lattice crease. With these numbers the finished ribbon
 * has 269 of 17,038 triangles dipping under the drawn ground at high,
 * 130 of 17,634 at medium and 57 of 17,834 at low, the worst by 0.09,
 * 0.21 and 0.17 m — single triangles, every one of them on the 25°
 * climbs around the east ramp and the projects road. At low quality a
 * 10 cm float is well inside the 2.73 m faceting of the ground it
 * floats over, so it costs less than it buys.
 */
const LIFT = { high: 0.035, medium: 0.07, low: 0.10 } as const

/** How far a span may sink into the drawn ground before `refine` splits
 *  it. Independent of the lift: refining is nearly free and the lift is
 *  not, so tighten this first. */
const SAG_TOLERANCE = 0.03

/** The fade skirt's outer edge, as a multiple of the road's width. The
 *  carriageway is `width * 0.5`; the skirt runs to `width * 0.72` and
 *  dissolves into the ground across the last third of it.
 *
 *  0.72 IS A CEILING, not a taste. `SceneryDetails` stands lanterns at
 *  `road.width * 0.5 + 2.2` — 6.2 m from the centreline of an 8 m road
 *  — and a skirt at 0.72 reaches 5.76 m. Widen it and the lanterns
 *  stand in the road. */
const SKIRT = 0.72

/** Metres of road per repeat of the dirt maps. Four is close enough to
 *  a car's width that the ruts and the grain read at the right size,
 *  and small enough that 512 texels across it is finer than the screen
 *  at any camera distance the game uses. */
const TILE = 4

/** Cap on how far a mitred corner may push its outer edge out, as a
 *  multiple of the half-width. Without it a hairpin in the polyline
 *  throws a spike hundreds of metres long; 2.5 is a 132° turn, and
 *  nothing in `PATHS` is anywhere near that. */
const MITRE_LIMIT = 2.5

/** One vertex ring across the ribbon. `mitre` scales the offset at a
 *  polyline vertex so the outer edge closes the corner; it is 1 at every
 *  station in the middle of a segment. */
interface Station {
  x: number
  z: number
  /** Unit normal, left of the direction of travel. */
  nx: number
  nz: number
  mitre: number
  /** Metres from the start of the road, for the along-UV. */
  along: number
}

const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
]

const blend = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

/**
 * Seamless value noise on a `freq × freq` lattice that WRAPS.
 *
 * The tile has to be seamless or the four-metre repeat shows as a grid
 * of hard lines, which is a worse artefact than the one this file
 * exists to remove. Wrapping the lattice index is the whole trick:
 * every frequency used below divides the canvas size, so the pattern
 * closes on itself in both axes at every octave.
 */
function tileNoise(freq: number, seed: number): (u: number, v: number) => number {
  const random = seeded(seed)
  const lattice = new Float32Array(freq * freq)
  for (let i = 0; i < lattice.length; i++) lattice[i] = random()
  const at = (a: number, b: number) =>
    lattice[(((b % freq) + freq) % freq) * freq + (((a % freq) + freq) % freq)]
  return (u, v) => {
    const x = u * freq
    const y = v * freq
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = x - xi
    const fy = y - yi
    const sx = fx * fx * (3 - 2 * fx)
    const sy = fy * fy * (3 - 2 * fy)
    return (at(xi, yi) * (1 - sx) + at(xi + 1, yi) * sx) * (1 - sy)
      + (at(xi, yi + 1) * (1 - sx) + at(xi + 1, yi + 1) * sx) * sy
  }
}

export class Roads {
  readonly group = new THREE.Group()
  /** Null on the (impossible in practice) day `roads` is empty, so the
   *  caller can tell "no roads" from "not built yet". */
  readonly mesh: THREE.Mesh | null

  constructor(terrain: Terrain, quality: Quality, materials: Materials, bin: Bin) {
    const geometry = this.build(terrain, quality)
    if (!geometry) {
      this.mesh = null
      bin.object3D(this.group)
      return
    }

    const mesh = new THREE.Mesh(geometry, this.material(quality, materials, bin))
    // No `castShadow`: the ribbon lies on the ground, so all it could
    // ever cast is a shadow onto itself through the depth bias.
    mesh.receiveShadow = quality.settings.shadows
    mesh.matrixAutoUpdate = false
    mesh.updateMatrix()
    this.mesh = mesh
    this.group.add(mesh)
    bin.add(() => geometry.dispose())
    bin.object3D(this.group)
  }

  /* ========================================================
     GEOMETRY
     ======================================================== */

  private build(terrain: Terrain, quality: Quality): THREE.BufferGeometry | null {
    // One collider cell, at EVERY quality. Finer buys nothing — the
    // ground it is following has no more detail than that — and coarser
    // chords across the corridor and sinks the ribbon into it at every
    // crest. Doubling it at low quality was tried and reverted: it took
    // the worst chord sag from 0.110 m to 0.141 m to save 90 KB of
    // buffer, and 90 KB is not what a low-end machine is short of.
    const spacing = terrain.step
    const lift = LIFT[quality.level]
    const pieces: THREE.BufferGeometry[] = []

    for (const road of roads) {
      const half = road.width * 0.5
      const outer = road.width * SKIRT

      /*
        THE COLUMNS ACROSS THE RIBBON, about 1.5 m apart, and NOT four.

        Four — the two carriageway edges and the two skirt edges — is
        what a road corridor's own geometry says you need, because
        `Terrain.heightAt` flattens the corridor dead level out to
        `half`. Measured at every triangle centroid on the network, it
        sinks up to 0.63 m into the ground, and the worst offender is a
        single triangle spanning the full nine metres of
        `landing-projects` at (63.5, -29.2), where the ground rises from
        2.86 m to 4.65 m across it. The corridor is only flat where it
        is the ONLY thing claiming that ground: there `landing-ramp`
        crosses it and drags the surface up its own climb to the east
        ramp's pad, and the same happens wherever a road meets a plate,
        a pad or another road.

        So: the carriageway in spans of about a metre and a half, and
        the skirt — which sits on the corridor's run-out and is steeper
        again — in three either side.
      */
      const lanes = Math.max(2, Math.round(road.width / 1.6))
      const offsets: number[] = []
      for (let k = 3; k >= 1; k--) offsets.push(-(half + ((outer - half) * k) / 3))
      for (let k = 0; k <= lanes; k++) offsets.push(-half + (road.width * k) / lanes)
      for (let k = 1; k <= 3; k++) offsets.push(half + ((outer - half) * k) / 3)
      // `aAcross` is the same offset normalised to the skirt's outer
      // edge, so the shader finds the crown and the verge without
      // knowing how wide this particular road is.
      const columns = offsets.map((offset) => [offset, offset / outer] as [number, number])

      const stations = this.refine(this.walk(road.points, spacing), terrain, offsets)
      if (stations.length < 2) continue

      const position: number[] = []
      const uv: number[] = []
      const across: number[] = []
      const index: number[] = []

      stations.forEach((station, i) => {
        for (const [offset, a] of columns) {
          const x = station.x + station.nx * offset * station.mitre
          const z = station.z + station.nz * offset * station.mitre
          position.push(x, terrain.surfaceHeightAt(x, z) + lift, z)
          // WORLD METRES, both axes, and the material divides by TILE
          // through the texture's own repeat. The across-UV is the
          // NOMINAL offset rather than the mitred one, so a corner
          // stretches its texture slightly instead of shearing it.
          uv.push(offset, station.along)
          across.push(a)
        }
        if (i === stations.length - 1) return
        const b = i * columns.length
        const next = columns.length
        for (let k = 0; k < columns.length - 1; k++) {
          index.push(
            b + k, b + k + 1, b + k + next,
            b + k + 1, b + k + next + 1, b + k + next,
          )
        }
      })

      const piece = new THREE.BufferGeometry()
      piece.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
      piece.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      piece.setAttribute('aAcross', new THREE.Float32BufferAttribute(across, 1))
      piece.setIndex(index)
      // Per road, BEFORE the merge: `computeVertexNormals` averages
      // across shared vertices, and two roads that cross should not
      // average their normals into each other's.
      piece.computeVertexNormals()
      pieces.push(piece)
    }

    if (!pieces.length) return null
    const merged = mergeGeometries(pieces)
    pieces.forEach((piece) => piece.dispose())
    return merged
  }

  /**
   * Split any span whose chord sinks into the drawn ground by more than
   * the lift, and keep splitting until none does.
   *
   * Even spacing is not enough, and this is measured. The visible mesh
   * is a lattice of flat triangles with a crease at every lattice line
   * and cell diagonal, and a station grid that straddles a crease chords
   * across it: at 0.91 m stations the worst span sinks 0.067 m into the
   * ground at high quality and 0.110 m at low, against a 3.5 cm lift.
   * That is 0.38% of spans at high and 2.94% at low — a handful of short
   * stretches, all of them at the creases the ramp pads and the plate
   * shoulders put under a road, and every one of them a place where a
   * dirt track visibly vanishes into a hill.
   *
   * Bisecting where it matters is far cheaper than halving the spacing
   * everywhere: 715 evenly spaced stations become 783 at high quality
   * and 820 at low, a tenth more rather than twice as many.
   */
  private refine(input: Station[], terrain: Terrain, offsets: number[]): Station[] {
    let stations = input
    // Three passes takes a 0.11 m sag under 0.014 m. Bounded rather
    // than `while`, because a genuine vertical step in the ground would
    // never satisfy the tolerance and this runs at boot.
    for (let pass = 0; pass < 3; pass++) {
      const out: Station[] = [stations[0]]
      let split = 0
      for (let i = 1; i < stations.length; i++) {
        const a = stations[i - 1]
        const b = stations[i]
        const dx = b.x - a.x
        const dz = b.z - a.z
        const length = Math.hypot(dx, dz)
        if (length > 1e-3) {
          // Probe every column, not just the middle: the ribbon is up
          // to 13 m wide and a crease rarely runs down its centre.
          let sag = 0
          for (const offset of offsets) {
            const ax = a.x + a.nx * offset * a.mitre
            const az = a.z + a.nz * offset * a.mitre
            const bx = b.x + b.nx * offset * b.mitre
            const bz = b.z + b.nz * offset * b.mitre
            sag = Math.max(sag, terrain.surfaceHeightAt((ax + bx) / 2, (az + bz) / 2)
              - (terrain.surfaceHeightAt(ax, az) + terrain.surfaceHeightAt(bx, bz)) / 2)
          }
          if (sag > SAG_TOLERANCE) {
            // The inserted station is always mid-SEGMENT, never at a
            // corner, so it takes the chord's own normal and no mitre.
            out.push({
              x: (a.x + b.x) / 2, z: (a.z + b.z) / 2,
              nx: -dz / length, nz: dx / length, mitre: 1,
              along: (a.along + b.along) / 2,
            })
            split++
          }
        }
        out.push(b)
      }
      stations = out
      if (!split) break
    }
    return stations
  }

  /**
   * Walk a raw polyline, emitting a station about every `spacing`
   * metres plus one at every vertex.
   *
   * The vertices get a MITRED normal — the average of the two adjacent
   * edge normals, scaled by 1/cos of half the turn — and the stations
   * between them get their segment's own normal. That is what a mitre
   * join is: the edge runs straight down each segment and kinks at the
   * joint. The alternative, interpolating the normal along the segment,
   * bows a forty-metre straight.
   *
   * Same construction as `Terrain.paintGround`'s `shorePath`, which
   * offsets the coastline along averaged edge normals for the same
   * reason: a radial push is only correct on a convex shape.
   */
  private walk(points: [number, number][], spacing: number): Station[] {
    const segments = points.slice(0, -1)
      .map(([ax, az], i) => {
        const [bx, bz] = points[i + 1]
        const length = Math.hypot(bx - ax, bz - az)
        return { ax, az, dx: (bx - ax) / (length || 1), dz: (bz - az) / (length || 1), length }
      })
      // A repeated point in a polyline has no direction, so it has no
      // normal either, and a zero normal collapses four vertices onto
      // the centreline and puts a pinch in the ribbon.
      .filter((segment) => segment.length > 1e-3)
    if (!segments.length) return []

    const stations: Station[] = []
    let along = 0

    segments.forEach((segment, i) => {
      const nx = -segment.dz
      const nz = segment.dx
      const previous = segments[i - 1]

      if (!previous) {
        stations.push({ x: segment.ax, z: segment.az, nx, nz, mitre: 1, along })
      } else {
        let mx = -previous.dz + nx
        let mz = previous.dx + nz
        const length = Math.hypot(mx, mz)
        if (length < 1e-4) {
          // A 180° reversal. Nothing to mitre; take the new segment's
          // normal and let the two runs overlap.
          stations.push({ x: segment.ax, z: segment.az, nx, nz, mitre: 1, along })
        } else {
          mx /= length
          mz /= length
          const cos = mx * nx + mz * nz
          stations.push({
            x: segment.ax, z: segment.az, nx: mx, nz: mz,
            mitre: Math.min(MITRE_LIMIT, 1 / Math.max(0.2, cos)), along,
          })
        }
      }

      const count = Math.max(1, Math.round(segment.length / spacing))
      for (let k = 1; k < count; k++) {
        const t = (segment.length * k) / count
        stations.push({
          x: segment.ax + segment.dx * t, z: segment.az + segment.dz * t,
          nx, nz, mitre: 1, along: along + t,
        })
      }
      along += segment.length
    })

    const last = segments[segments.length - 1]
    stations.push({
      x: last.ax + last.dx * last.length, z: last.az + last.dz * last.length,
      nx: -last.dz, nz: last.dx, mitre: 1, along,
    })
    return stations
  }

  /* ========================================================
     MATERIAL
     ======================================================== */

  private material(quality: Quality, materials: Materials, bin: Bin): THREE.Material {
    const size = quality.level === 'low' ? 256 : 512
    const { albedo, normal } = this.dirtMaps(size)
    bin.add(() => albedo.dispose())
    bin.add(() => normal.dispose())

    const material = materials.own(new THREE.MeshStandardMaterial({
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.97,
      metalness: 0,
      /*
        ALPHA TEST, NOT BLENDING. The verge dissolves into the grass,
        and a blended ribbon would have to sort against the grass rings,
        which are DoubleSide and write depth — the road would flicker
        under every tuft. A cutout sorts with the opaque pass and cannot.
      */
      alphaTest: 0.5,
      /*
        DOUBLE-SIDED, and that is a fold repair rather than a style.
        A mitred ribbon crosses itself on the INSIDE of a corner
        wherever the turn is sharp enough that the inner edges of the
        two segments meet before the next station does. Measured over
        all thirteen roads: 120 of 17,038 triangles are inverted in
        plan, 18.1 m2 in total and the worst 0.95 m2, against 7,276 m2
        of carriageway. The sharpest turn on the island is 50 degrees,
        on `timemachine-maze` at (76, 42). Culled, each one is a notch
        bitten out of the
        inside of a bend; drawn, it is the same dirt painted twice on
        the same ground and nobody can see it. The ribbon lies flat, so
        there is no underside to expose.
      */
      side: THREE.DoubleSide,
      /*
        And polygon offset ALONGSIDE the 3.5 cm lift, not instead of it.
        The lift alone loses at grazing angles, where the depth buffer's
        precision is worst and where most of a road is seen from a boom
        camera; the offset alone loses wherever the ground under the
        ribbon is steep enough that a 0.91 m station chords across it.
      */
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }))

    material.onBeforeCompile = (shader) => {
      shader.vertexShader = `attribute float aAcross;\nvarying float vAcross;\n${shader.vertexShader}`
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vAcross = aAcross;',
      )

      shader.fragmentShader = `
        varying float vAcross;
        float rdHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        float rdNoise(vec2 p){
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rdHash(i), rdHash(i + vec2(1.0, 0.0)), f.x),
                     mix(rdHash(i + vec2(0.0, 1.0)), rdHash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float rdRut = 0.0;
      ` + shader.fragmentShader

      // `vMapUv` is the world-metre UV divided by TILE by the texture's
      // own repeat, so multiplying by TILE gets metres back.
      const metres = `(vMapUv * ${TILE.toFixed(1)})`
      // The carriageway edge, in the -1..1 skirt space `aAcross` uses.
      const kerb = (0.5 / SKIRT).toFixed(4)

      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
        /*
          TWO SAMPLES OF ONE MAP. A 4 m tile repeated down a 130 m road
          reads as a grid of identical patches from the air, which is
          the second thing people mean by "pixelated". The second
          sample is rotated 37 degrees and scaled to about a 17 m
          period, so its own repeat never lines up with the first: the
          classic de-tiling trick, and it costs one texture fetch
          rather than a second texture.
        */
        vec4 rdNear = texture2D(map, vMapUv);
        vec2 rdFarUv = mat2(0.80, 0.60, -0.60, 0.80) * vMapUv * 0.23 + vec2(0.37, 0.11);
        vec4 rdFar = texture2D(map, rdFarUv);
        diffuseColor *= mix(rdNear, rdFar, 0.42);

        float rdEdge = abs(vAcross);

        // WHEEL RUTS, in METRES rather than in the normalised across:
        // the roads are 6 to 9 m wide and the car is not, so a rut at a
        // fixed FRACTION of the carriageway would sit half a metre
        // further out on the wide ones. PhysicsVehicle puts the wheel
        // connection points at z = +/-0.75, so that is where the earth is
        // packed; 0.3 m of spread either side of it is a track that
        // wanders, which is what an unsurfaced road has.
        float rdMetres = abs(vMapUv.x * ${TILE.toFixed(1)});
        rdRut = exp(-pow((rdMetres - 0.75) / 0.30, 2.0));
        // A CROWN. Real earth roads are highest and driest down the
        // middle, and it is the crown against the ruts that stops a
        // flat brown strip reading as a decal.
        float rdCrown = 1.0 - smoothstep(0.0, ${kerb}, rdEdge);
        diffuseColor.rgb *= 1.0 - rdRut * 0.20 + rdCrown * 0.055;

        // THE VERGE. Scuffed darker, then dissolved into the ground by
        // a world-locked noise rather than a clean line, so the road
        // ends in scattered earth the way a track does. World-locked
        // and not screen-locked on purpose: a hash of gl_FragCoord
        // crawls whenever the camera moves.
        float rdScuff = smoothstep(${kerb} * 0.92, 1.0, rdEdge);
        diffuseColor.rgb *= 1.0 - rdScuff * 0.16;
        float rdRagged = rdNoise(${metres} * 1.4) + rdNoise(${metres} * 5.1) * 0.35;
        diffuseColor.a = (1.0 - rdScuff) * 1.6 + (rdRagged / 1.35 - 0.5) * 0.85;
      `)

      // Packed earth in the ruts is smoother than the loose stuff
      // either side of it. Cheap, and it is what makes the ruts survive
      // being looked at from directly above, where the normal map does
      // nothing.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\n  roughnessFactor = clamp(roughnessFactor - rdRut * 0.13, 0.0, 1.0);',
      )
    }

    return material
  }

  /* ========================================================
     THE DIRT MAPS

     Generated to a canvas, like every other texture on this route.
     There are no image files in this project and there is not going to
     be one for a road.
     ======================================================== */

  private dirtMaps(size: number): { albedo: THREE.CanvasTexture; normal: THREE.CanvasTexture } {
    const canvas = (): [HTMLCanvasElement, CanvasRenderingContext2D] => {
      const element = document.createElement('canvas')
      element.width = element.height = size
      const ctx = element.getContext('2d')
      if (!ctx) throw new Error('[world] 2D canvas unavailable')
      return [element, ctx]
    }

    // Four octaves, every frequency a divisor of the canvas so each one
    // wraps. The coarse two are the patches of damp and dust the road
    // varies in; the fine two are the grit.
    const octaves = [
      { noise: tileNoise(4, 30411), weight: 0.50 },
      { noise: tileNoise(8, 30412), weight: 0.26 },
      { noise: tileNoise(16, 30413), weight: 0.15 },
      { noise: tileNoise(64, 30414), weight: 0.09 },
    ]
    const field = new Float32Array(size * size)
    let low = Infinity
    let high = -Infinity
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size
        const v = (y + 0.5) / size
        let sum = 0
        for (const octave of octaves) sum += octave.noise(u, v) * octave.weight
        field[y * size + x] = sum
        if (sum < low) low = sum
        if (sum > high) high = sum
      }
    }
    // Stretched to the full 0..1. The raw field runs 0.023 to 0.867 at
    // this seed, so this is not rescuing a flat map — it is pinning the
    // ends, so the three tones below always land where the split at 0.46
    // says they do and `relief` always means the same slope, whatever
    // the octave weights or the seed are changed to.
    const spread = high - low || 1
    for (let i = 0; i < field.length; i++) field[i] = (field[i] - low) / spread

    /* ---- albedo ------------------------------------------
       Three tones, not one. `palette.roadDirt` alone is the flat fill
       this whole file replaces; the dark is the same dirt damp, and the
       pale is the dust that collects where nothing drives. */
    const dark = rgb(palette.roadDirtEdge)
    const base = rgb(palette.roadDirt)
    // The island's own dry-sand tone, so the dust on a track and the
    // dust on the beach are the same dust.
    const dust = rgb('#ded4ae')
    const [albedoCanvas, albedoCtx] = canvas()
    const albedoImage = albedoCtx.createImageData(size, size)
    // Stones: a sparse scatter of single darker or lighter texels. At
    // 512 texels over 4 m one texel is 7.8 mm, so a two-texel stone is
    // 16 mm of gravel — and unlike the grit pattern this replaces, it
    // is 7.8 mm on the ground rather than 244.
    const stones = seeded(30415)
    for (let i = 0; i < size * size; i++) {
      const n = field[i]
      const tone = n < 0.46
        ? blend(dark, base, n / 0.46)
        : blend(base, dust, (n - 0.46) / 0.54)
      const speck = stones() < 0.035 ? (stones() < 0.5 ? -26 : 22) : 0
      const o = i * 4
      albedoImage.data[o] = Math.max(0, Math.min(255, tone[0] + speck))
      albedoImage.data[o + 1] = Math.max(0, Math.min(255, tone[1] + speck))
      albedoImage.data[o + 2] = Math.max(0, Math.min(255, tone[2] + speck))
      albedoImage.data[o + 3] = 255
    }
    albedoCtx.putImageData(albedoImage, 0, 0)

    /* ---- normal ------------------------------------------
       Sobel on the same field, wrapped, so the bumps and the colour
       describe the same stones. Without a normal map every scrap of
       information on the surface is albedo, and albedo is the one
       channel that magnification destroys — the road went flat under
       the sun no matter what was painted on it. */
    const [normalCanvas, normalCtx] = canvas()
    const normalImage = normalCtx.createImageData(size, size)
    const wrap = (v: number) => ((v % size) + size) % size
    // Metres per texel, so the slope is a real gradient and not a
    // number that changes meaning when `size` does.
    const perTexel = TILE / size
    const relief = 0.028
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (field[y * size + wrap(x + 1)] - field[y * size + wrap(x - 1)]) * relief / (2 * perTexel)
        const dy = (field[wrap(y + 1) * size + x] - field[wrap(y - 1) * size + x]) * relief / (2 * perTexel)
        const length = Math.hypot(dx, dy, 1)
        const o = (y * size + x) * 4
        normalImage.data[o] = Math.round((-dx / length * 0.5 + 0.5) * 255)
        normalImage.data[o + 1] = Math.round((-dy / length * 0.5 + 0.5) * 255)
        normalImage.data[o + 2] = Math.round((1 / length * 0.5 + 0.5) * 255)
        normalImage.data[o + 3] = 255
      }
    }
    normalCtx.putImageData(normalImage, 0, 0)

    const albedo = new THREE.CanvasTexture(albedoCanvas)
    albedo.colorSpace = THREE.SRGBColorSpace
    const normal = new THREE.CanvasTexture(normalCanvas)
    // A normal map is data, not colour: decoding it through sRGB turns
    // a flat surface into a dented one.
    normal.colorSpace = THREE.NoColorSpace

    for (const texture of [albedo, normal]) {
      texture.wrapS = THREE.RepeatWrapping
      texture.wrapT = THREE.RepeatWrapping
      // The UVs are written in world metres, so the repeat IS the tile
      // size. Nothing else in this file has to know about it.
      texture.repeat.set(1 / TILE, 1 / TILE)
      texture.anisotropy = 8
      texture.needsUpdate = true
    }

    return { albedo, normal }
  }
}
