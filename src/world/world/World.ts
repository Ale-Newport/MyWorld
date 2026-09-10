import * as THREE from 'three'
import { palette } from '../core/palette'
import { seeded } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Quality } from '../core/Quality'
import type { Physics } from '../physics/Physics'
import type { Ticker } from '../core/Ticker'
import type { Materials } from './materials'
import { textTexture } from './materials'
import { Terrain } from './Terrain'
import { Roads } from './Roads'
import { Props, type PropKind } from './Props'
import { buildLandmark } from './Landmarks'
import { rampGeometry } from './geometry'
import { CIRCUIT, CIRCUIT_TRACK, PLAY_SPOTS, lineDistance } from '@/content/world-environment'
import {
  projectPlinths,
  devNotes,
  districtById,
  districts,
  landmarks,
  ramps,
  respawns,
  roads,
  timelinePlates,
  projectsBySlugForWorld,
  type Landmark,
} from '@/content/world'

/** How far back down a ramp's approach the run-up is kept clear. A big
 *  jump needs the whole run-up, not just the ground beside the lip. */
const RAMP_RUNUP = 52

/* ============================================================
   THE WORLD

   Reads `src/content/world.ts` and builds it. Nothing about
   Alejandro is written here: districts, landmarks, props, ramps
   and notes are all data, and this file is the machine that turns
   that data into geometry and colliders.

   That separation is the point of the whole route. Adding a
   project to `src/content/projects/personal.ts` puts it in the
   scroll journey AND in the PROJECTS archive — with no change to
   this file. The island's SHAPE comes from a step further back
   again: `src/content/world-map.ts` is a hand-drawn plan compiled
   to metres, and the two content files above read it.

   Build order is by cost: terrain first (everything measures its
   height), then landmarks, then the scatter. Districts far from
   the spawn are built too — this world is small enough that
   streaming them in would cost more in complexity than it saves.
   ============================================================ */

export interface LandmarkHandle {
  landmark: Landmark
  group: THREE.Group
  /** World-space anchor for the interact prompt. */
  anchor: THREE.Vector3
  radius: number
}

export interface DevNoteHandle {
  id: string
  text: string
  position: THREE.Vector3
  mesh: THREE.Mesh
  found: boolean
}


export class World {
  /*
    Per-instance, not module-level. A `const rand = seeded(...)` at
    module scope keeps its position across mounts, so the SECOND time
    the world was built in a tab — after a route change, a quality
    switch or a hot reload — every scattered prop landed somewhere
    else. That makes screenshot comparison meaningless and made the
    'the manifest is the source of truth' claim untrue for half the
    island.
  */
  private readonly rand = seeded(88121)

  readonly group = new THREE.Group()
  readonly terrain: Terrain
  readonly roads: Roads
  readonly props: Props

  readonly landmarks = new Map<string, LandmarkHandle>()
  readonly notes: DevNoteHandle[] = []
  /** Year plates, in order, for the TIME TRAVELLER secret. */
  readonly timeline: { year: string; position: THREE.Vector3; radius: number }[] = []

  constructor(
    private physics: Physics,
    private quality: Quality,
    private materials: Materials,
    ticker: Ticker,
    private bin: Bin,
  ) {
    this.terrain = new Terrain(physics, quality, materials, bin)
    this.group.add(this.terrain.group)

    // The dirt tracks, as geometry with their own tiling material
    // instead of a stroke on the ground canvas, where one texel is a
    // quarter of a metre and an eight-metre road is thirty-three of
    // them. Built here because it needs the terrain's own height
    // sampler, and it carries no collider: the heightfield already
    // holds the road's height.
    this.roads = new Roads(this.terrain, quality, materials, bin)
    this.group.add(this.roads.group)

    this.props = new Props(physics, ticker, materials, bin, quality.settings.shadows)
    this.group.add(this.props.group)

    this.buildSky()
    this.buildLandmarks()
    this.buildProjectPlinths()
    this.buildRamps()
    this.buildTimeline()
    this.buildNotes()
    this.buildDistrictFurniture()
    this.scatterProps()

    bin.object3D(this.group)
  }

  /* ========================================================
     SKY
     ======================================================== */

  private buildSky(): void {
    // A very shallow gradient dome. The clear colour already carries
    // the sky's hue; this adds just enough vertical falloff that the
    // horizon reads as a horizon rather than as the edge of the
    // ground plane.
    const geometry = new THREE.SphereGeometry(760, 24, 12)
    const material = this.materials.own(
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          uHorizon: { value: new THREE.Color(palette.paper) },
          uZenith: { value: new THREE.Color(palette.skyDay) },
        },
        vertexShader: /* glsl */ `
          varying float vHeight;
          void main() {
            vHeight = normalize(position).y;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vHeight;
          uniform vec3 uHorizon;
          uniform vec3 uZenith;
          void main() {
            float t = smoothstep(-0.05, 0.55, vHeight);
            gl_FragColor = vec4(mix(uHorizon, uZenith, t), 1.0);
            #include <colorspace_fragment>
          }
        `,
      }),
    )
    const mesh = new THREE.Mesh(geometry, material)
    mesh.renderOrder = -1
    mesh.frustumCulled = false
    this.group.add(mesh)
    this.bin.add(() => geometry.dispose())
    this.sky = material
  }

  /** Written by Lighting so the dome follows the day cycle. */
  sky: THREE.ShaderMaterial | null = null

  setSkyColors(horizon: THREE.Color, zenith: THREE.Color): void {
    if (!this.sky) return
    ;(this.sky.uniforms.uHorizon.value as THREE.Color).copy(horizon)
    ;(this.sky.uniforms.uZenith.value as THREE.Color).copy(zenith)
  }

  /* ========================================================
     LANDMARKS
     ======================================================== */

  private buildLandmarks(): void {
    const context = {
      materials: this.materials,
      physics: this.physics,
      quality: this.quality,
      bin: this.bin,
      groundY: 0,
    }

    for (const landmark of landmarks) {
      const y = this.terrain.colliderHeightAt(landmark.x, landmark.z)
      const at = new THREE.Vector3(landmark.x, y, landmark.z)
      const built = buildLandmark({ ...context, groundY: y }, landmark, at)
      this.group.add(built.group)

      this.landmarks.set(landmark.id, {
        landmark,
        group: built.group,
        anchor: built.anchor.clone().add(at),
        radius: landmark.radius ?? built.radius,
      })
    }
  }

  /* ========================================================
     THE PROJECTS ARCHIVE

     Eight plinths around one terminal, generated from the same
     inventory the Project Universe uses. The other thirty-five
     projects are not absent — they are inside the terminal, which
     is the whole reason the island stopped needing a district per
     project.
     ======================================================== */

  private buildProjectPlinths(): void {
    const context = {
      materials: this.materials, physics: this.physics,
      quality: this.quality, bin: this.bin, groundY: 0,
    }

    for (const plinth of projectPlinths()) {
      const project = projectsBySlugForWorld[plinth.project]
      if (!project) continue
      const y = this.terrain.colliderHeightAt(plinth.x, plinth.z)
      const at = new THREE.Vector3(plinth.x, y, plinth.z)

      const landmark: Landmark = {
        id: plinth.id,
        district: 'projects',
        label: project.shortTitle ?? project.title,
        sublabel: project.year,
        x: plinth.x,
        z: plinth.z,
        rotation: plinth.rotation,
        visual: 'island',
        interaction: 'project',
        radius: 8,
        scale: plinth.scale,
        ref: { kind: 'project', id: project.slug },
      }

      const built = buildLandmark({ ...context, groundY: y }, landmark, at)
      this.group.add(built.group)
      this.landmarks.set(landmark.id, {
        landmark,
        group: built.group,
        anchor: built.anchor.clone().add(at),
        radius: 8,
      })
    }
  }

  /* ========================================================
     RAMPS
     ======================================================== */

  private buildRamps(): void {
    for (const ramp of ramps) {
      /*
        THE FOOT, NOT THE CENTRE.

        The terrain flattens a pad under every ramp, and this used to
        take the pad's height from the ramp's middle on the assumption
        that the pad held the whole footprint level. It does not always:
        a road flattened AFTER the pad drags it down wherever it passes,
        and `landing-projects` runs seven metres off the east ramp's
        foot. Measured there, the pad held 4.70 m under the deck and
        3.69 m at the low end — a metre of step exactly where the car
        arrives. `world-qa` recorded 2.7 m of air off a 5.6 m ramp and
        the tour wedged the car against the lip for a whole leg.

        Building from the FOOT cannot produce that step: the low end is
        on the ground by construction, and the rest of the wedge is
        above it by definition, which is what a ramp is. It costs a
        little height at the lip when the pad is not level, and a lip
        in the air is not a defect.
      */
      const foot = {
        x: ramp.x - Math.cos(ramp.rotation) * (ramp.length / 2 - 1),
        z: ramp.z + Math.sin(ramp.rotation) * (ramp.length / 2 - 1),
      }
      const y = Math.min(
        this.terrain.colliderHeightAt(foot.x, foot.z),
        this.terrain.colliderHeightAt(ramp.x, ramp.z),
      )
      const { geometry, hull } = rampGeometry(ramp.length, ramp.width, ramp.height)

      const mesh = new THREE.Mesh(geometry, this.materials.get('concrete'))
      mesh.position.set(ramp.x, y, ramp.z)
      mesh.rotation.y = ramp.rotation
      mesh.castShadow = this.quality.settings.shadows
      mesh.receiveShadow = this.quality.settings.shadows
      this.group.add(mesh)
      this.bin.add(() => geometry.dispose())

      // The collider is the same convex hull as the mesh, so the lip
      // the car launches off is exactly the lip it can see.
      this.physics.add({
        type: 'fixed',
        category: 'floor',
        position: { x: ramp.x, y, z: ramp.z },
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ramp.rotation, 0)),
        friction: 0.9,
        restitution: 0.02,
        colliders: [{ shape: 'hull', parameters: [hull] }],
      })

      // A vermilion nose so a ramp reads as a ramp from a distance.
      const lip = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.12, ramp.width * 0.9),
        this.materials.get('emissiveAccent'),
      )
      lip.position.set(
        ramp.x + Math.cos(ramp.rotation) * (ramp.length / 2 - 0.4),
        y + ramp.height + 0.06,
        ramp.z - Math.sin(ramp.rotation) * (ramp.length / 2 - 0.4),
      )
      lip.rotation.y = ramp.rotation
      this.group.add(lip)
      this.bin.add(() => lip.geometry.dispose())
    }
  }

  /* ========================================================
     TIMELINE PLATES
     ======================================================== */

  private buildTimeline(): void {
    for (const plate of timelinePlates) {
      const y = this.terrain.colliderHeightAt(plate.x, plate.z)
      const { texture, aspect } = textTexture({
        text: plate.year,
        color: palette.ink,
        letterSpacing: 0.08,
        size: 128,
        weight: 600,
      })
      const size = 6
      const geometry = new THREE.PlaneGeometry(size, size / aspect)
      geometry.rotateX(-Math.PI / 2)
      const material = this.materials.own(
        new THREE.MeshBasicMaterial({
          map: texture, transparent: true, depthWrite: false, toneMapped: false,
        }),
      )
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(plate.x, y + 0.05, plate.z)
      mesh.renderOrder = 2
      this.group.add(mesh)
      this.bin.add(() => {
        geometry.dispose()
        texture.dispose()
      })

      this.timeline.push({
        year: plate.year,
        position: new THREE.Vector3(plate.x, y, plate.z),
        radius: 4.5,
      })
    }
  }

  /* ========================================================
     DEV NOTES
     Small markers with a line of writing on them. The local
     replacement for upstream's server-backed visitor whispers.
     ======================================================== */

  private buildNotes(): void {
    const geometry = new THREE.OctahedronGeometry(0.55, 0)
    this.bin.add(() => geometry.dispose())
    const material = this.materials.own(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(palette.accent),
        transparent: true,
        opacity: 0.85,
        toneMapped: false,
      }),
    )

    for (const note of devNotes) {
      const y = this.terrain.colliderHeightAt(note.x, note.z)
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.set(note.x, y + 1.6, note.z)
      this.group.add(mesh)

      this.notes.push({
        id: note.id,
        text: note.text,
        position: new THREE.Vector3(note.x, y, note.z),
        mesh,
        found: false,
      })
    }
  }

  /* ========================================================
     DISTRICT FURNITURE
     Plates and edges that make each district read as a place
     rather than a patch of differently-coloured ground.
     ======================================================== */

  private buildDistrictFurniture(): void {
    for (const district of districts) {
      const y = this.terrain.colliderHeightAt(district.x, district.z)

      // A ring on the ground marking the district boundary.
      const geometry = new THREE.RingGeometry(district.radius - 0.5, district.radius, 96)
      geometry.rotateX(-Math.PI / 2)
      const material = this.materials.own(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(district.theme === 'dark' ? palette.chalk3 : palette.ink4),
          transparent: true,
          opacity: 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
          toneMapped: false,
        }),
      )
      const ring = new THREE.Mesh(geometry, material)
      ring.position.set(district.x, y + 0.04, district.z)
      ring.renderOrder = 1
      this.group.add(ring)
      this.bin.add(() => geometry.dispose())

      // The district's name, laid flat on the ground at its edge, so
      // it is readable while driving in.
      const { texture, aspect } = textTexture({
        text: district.short,
        color: district.theme === 'dark' ? palette.chalk3 : palette.ink3,
        letterSpacing: 0.36,
        size: 96,
        weight: 500,
      })
      const labelWidth = Math.min(22, district.radius * 0.55)
      const labelGeometry = new THREE.PlaneGeometry(labelWidth, labelWidth / aspect)
      labelGeometry.rotateX(-Math.PI / 2)
      const labelMaterial = this.materials.own(
        new THREE.MeshBasicMaterial({
          map: texture, transparent: true, opacity: 0.2, depthWrite: false, toneMapped: false,
        }),
      )
      const label = new THREE.Mesh(labelGeometry, labelMaterial)
      label.position.set(district.x, y + 0.05, district.z + district.radius * 0.66)
      label.renderOrder = 2
      this.group.add(label)
      this.bin.add(() => {
        labelGeometry.dispose()
        texture.dispose()
      })
    }
  }

  /* ========================================================
     PROPS
     The playground layer: several hundred things to hit.
     ======================================================== */

  private scatterProps(): void {
    const q = this.quality

    this.props.reserve('cone', q.count(160, 60))
    this.props.reserve('barrier', q.count(70, 26))
    this.props.reserve('crate', q.count(90, 34))
    this.props.reserve('ball', q.count(40, 16))
    this.props.reserve('bench', q.count(30, 12))
    this.props.reserve('block', q.count(60, 24))
    this.props.reserve('plank', q.count(30, 12))
    this.props.reserve('domino', q.count(60, 30))
    this.props.reserve('drum', q.count(44, 18))
    this.props.reserve('panel', q.count(30, 12))

    const place = (kind: PropKind, x: number, z: number, options?: { tag?: string; rotation?: number }) => {
      /*
        NOT IN THE CARRIAGEWAY.

        This was the third and last copy of "may something be placed
        here?" — it knew about play spots, respawns and ramps, and
        nothing about roads. So the scatter dropped drums and crates
        down the middle of the ring, and the automated tour spent
        sixty-five seconds shunting a cluster of them along ring-east's
        first leg.

        The verge is still fair game, and so is a forecourt: only the
        lane itself is kept clear, which is why this is a road test and
        not a call to `isFree`.
      */
      if (roads.some(road => lineDistance(x, z, road.points) < road.width * 0.5 + 1)) return
      if (lineDistance(x, z, CIRCUIT_TRACK) < CIRCUIT.width * 0.5 + 1) return
      if (PLAY_SPOTS.some(p => Math.hypot(x - p.x, z - p.z) < p.radius)) return
      // Never ON a respawn — R is the key people press when they are
      // stuck, and it should not drop them inside a stack of crates.
      // Kept tight: a wide exclusion clears a visible bare circle around
      // the one spot every visitor is guaranteed to look at.
      if (respawns.some(p => Math.hypot(x - p.x, z - p.z) < 6)) return
      // Never on or in front of a ramp. A barrier lying across a
      // run-up is the difference between a jump that works and one
      // the player is convinced is broken — and the car is lighter
      // than most props, so it beaches rather than shoves.
      for (const ramp of ramps) {
        // A ramp rises along its local +X, so its approach runs back
        // along -X and its landing carries on past the lip. Keep those
        // clear, and the ramp's own footprint — but nothing else.
        //
        // This used to be a 30 m disc around every ramp, which in a
        // world this size is enormous: three small ramps near the hub
        // between them sterilised the whole landing area, and the
        // opening frame ended up as bare paving.
        const cos = Math.cos(ramp.rotation)
        const sin = -Math.sin(ramp.rotation)
        const along = (x - ramp.x) * cos + (z - ramp.z) * sin
        const across = Math.abs(-(x - ramp.x) * sin + (z - ramp.z) * cos)
        const half = ramp.length * 0.5
        // The deck itself, plus a margin.
        if (Math.abs(along) < half + 5 && across < ramp.width * 0.5 + 4) return
        // The run-up behind it.
        if (along < -half && along > -RAMP_RUNUP && across < ramp.width * 0.9) return
        // And where the car comes down: further for a bigger ramp.
        const landing = half + 6 + ramp.height * 7
        if (along > half && along < landing && across < ramp.width * 0.85) return
      }
      const y = this.terrain.colliderHeightAt(x, z)
      this.props.add(kind, x, y + 0.6, z, options)
    }

    /* ---- the landing area -------------------------------
       Everything here is placed RELATIVE TO THE LANDING, because
       the landing moves. Written as absolute coordinates, this
       whole arrangement stayed behind the last time the island was
       rebuilt and the spawn ended up on bare paving.

       The arrangement itself follows the reference's landing area:
       the name to drive at, something to knock over immediately,
       and enough clutter that the opening frame is full. */
    const landing = districtById.landing
    const at = (dx: number, dz: number) => [landing.x + dx, landing.z + dz] as const

    // A cone field, offset south so it sits between the spawn and the
    // name rather than on top of either.
    for (let i = 0; i < 44; i++) {
      const angle = this.rand() * Math.PI * 2
      const radius = 11 + this.rand() * 20
      const [x, z] = at(Math.cos(angle) * radius, Math.sin(angle) * radius + 16)
      place('cone', x, z, { tag: 'cones' })
    }
    // Crates stacked either side of the approach, to be scattered.
    for (let i = 0; i < 12; i++) {
      const [x, z] = at(-20 + (i % 4) * 2.7, 12 + Math.floor(i / 4) * 2.7)
      place('crate', x, z)
    }
    for (let i = 0; i < 8; i++) {
      const [x, z] = at(22 + (i % 4) * 2.8, 14 + Math.floor(i / 4) * 2.8)
      place('crate', x, z)
    }
    for (let i = 0; i < 6; i++) { const [x, z] = at(-14 + i * 5, -26); place('ball', x, z) }
    for (const [dx, dz] of [[26, 4], [-26, 4], [0, 30]]) { const [x, z] = at(dx, dz); place('bench', x, z) }
    for (let i = 0; i < 10; i++) {
      const [x, z] = at(-30 + i * 6.6, 30 + (i % 2) * 3)
      place('barrier', x, z, { rotation: 0.1 })
    }
    for (let i = 0; i < 8; i++) { const [x, z] = at(30 + (i % 2) * 3, -18 + Math.floor(i / 2) * 4); place('drum', x, z) }

    /* ---- a domino run out of the hub --------------------- */
    for (let i = 0; i < 26; i++) {
      const t = i / 25
      const [x, z] = at(-42 + t * 40, 40 + Math.sin(t * 3.2) * 8)
      place('domino', x, z, { rotation: Math.atan2(Math.cos(t * 3.2) * 3.2, 40 / 25), tag: 'dominoes' })
    }

    /* ---- per-district scatter --------------------------- */
    const scatter: Partial<Record<string, { kind: PropKind; count: number; tag?: string }[]>> = {
      social: [{ kind: 'crate', count: 8 }, { kind: 'bench', count: 4 }, { kind: 'panel', count: 5 }],
      bowling: [{ kind: 'barrier', count: 10 }, { kind: 'cone', count: 14, tag: 'cones' }, { kind: 'crate', count: 8 }],
      projects: [{ kind: 'crate', count: 10 }, { kind: 'panel', count: 8 }, { kind: 'cone', count: 12, tag: 'cones' }],
      achievements: [{ kind: 'cone', count: 10, tag: 'cones' }, { kind: 'ball', count: 8 }],
      /* NOTHING. `place()` tests roads, play spots, respawns and ramps
         and knows nothing about the labyrinth's walls, so these six
         crates and eight blocks were dropped at 10.5-27 m from the
         maze centre — inside a 46 m square that is 127 solid grid
         squares out of 225 — and ejected by the solver from wherever
         they landed. The labyrinth owns the grid, so the labyrinth
         places its own corridor clutter. */
      maze: [],
      timeMachine: [{ kind: 'drum', count: 6 }, { kind: 'ball', count: 6 }],
      // Circuit scenery is placed by the race, clear of the racing line.
      circuit: [],
      // The TNT stack is the scatter here, and it is built by Playground.
      tnt: [],
      blackhole: [{ kind: 'block', count: 8 }],
    }

    for (const district of districts) {
      const list = scatter[district.id]
      if (!list) continue
      for (const entry of list) {
        const count = q.count(entry.count, Math.ceil(entry.count * 0.35))
        for (let i = 0; i < count; i++) {
          const angle = this.rand() * Math.PI * 2
          // Kept off the exact centre, where the landmark stands.
          const radius = district.radius * (0.35 + this.rand() * 0.55)
          place(
            entry.kind,
            district.x + Math.cos(angle) * radius,
            district.z + Math.sin(angle) * radius,
            { tag: entry.tag },
          )
        }
      }
    }
  }

  /** Everything back where it started. Bound to the options menu. */
  resetObjects(): void {
    this.props.reset()
  }
}
