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
import { Props, type PropKind } from './Props'
import { buildLandmark } from './Landmarks'
import { rampGeometry } from './geometry'
import {
  archiveIslands,
  clientTowers,
  devNotes,
  districts,
  landmarks,
  ramps,
  timelinePlates,
  projectsBySlugForWorld,
  type Landmark,
} from '@/content/world'

/* ============================================================
   THE WORLD

   Reads `src/content/world.ts` and builds it. Nothing about
   Alejandro is written here: districts, landmarks, props, ramps
   and notes are all data, and this file is the machine that turns
   that data into geometry and colliders.

   That separation is the point of the whole route. Adding a
   project to `src/content/projects/personal.ts` puts it in the
   scroll journey AND, if it is unplaced, on an island in the
   archive — with no change to this file.

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

const rand = seeded(88121)

export class World {
  readonly group = new THREE.Group()
  readonly terrain: Terrain
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

    this.props = new Props(physics, ticker, materials, bin, quality.settings.shadows)
    this.group.add(this.props.group)

    this.buildSky()
    this.buildLandmarks()
    this.buildClientCity()
    this.buildArchive()
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
     CLIENT CITY
     Fourteen browser towers, one per live client site, laid out
     from the project inventory rather than by hand.
     ======================================================== */

  private buildClientCity(): void {
    const context = {
      materials: this.materials, physics: this.physics,
      quality: this.quality, bin: this.bin, groundY: 0,
    }

    for (const tower of clientTowers) {
      const project = projectsBySlugForWorld[tower.project]
      if (!project) continue
      const y = this.terrain.colliderHeightAt(tower.x, tower.z)
      const at = new THREE.Vector3(tower.x, y, tower.z)

      const landmark: Landmark = {
        id: tower.id,
        district: 'client',
        label: project.shortTitle ?? project.title,
        sublabel: project.subcategory,
        x: tower.x,
        z: tower.z,
        rotation: tower.rotation,
        visual: 'browserTower',
        interaction: 'project',
        radius: 10,
        scale: tower.height / 14,
        ref: { kind: 'project', id: project.slug },
      }

      const built = buildLandmark({ ...context, groundY: y }, landmark, at)
      this.group.add(built.group)
      this.landmarks.set(landmark.id, {
        landmark,
        group: built.group,
        anchor: built.anchor.clone().add(at),
        radius: 10,
      })
    }
  }

  /* ========================================================
     ARCHIVE ISLANDS
     Everything not otherwise placed, generated from the same
     inventory the Project Universe uses.
     ======================================================== */

  private buildArchive(): void {
    const context = {
      materials: this.materials, physics: this.physics,
      quality: this.quality, bin: this.bin, groundY: 0,
    }

    for (const island of archiveIslands) {
      const project = projectsBySlugForWorld[island.project]
      if (!project) continue
      const y = this.terrain.colliderHeightAt(island.x, island.z)
      const at = new THREE.Vector3(island.x, y, island.z)

      const landmark: Landmark = {
        id: island.id,
        district: 'archive',
        label: project.shortTitle ?? project.title,
        sublabel: project.year,
        x: island.x,
        z: island.z,
        rotation: island.rotation,
        visual: 'monument',
        interaction: 'project',
        radius: 8,
        scale: island.scale,
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
      const y = this.terrain.colliderHeightAt(ramp.x, ramp.z)
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
      if (district.id === 'void') continue
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
      const y = this.terrain.colliderHeightAt(x, z)
      this.props.add(kind, x, y + 0.6, z, options)
    }

    /* ---- hub: a cone field to play in -------------------- */
    for (let i = 0; i < 34; i++) {
      const angle = rand() * Math.PI * 2
      const radius = 14 + rand() * 26
      place('cone', Math.cos(angle) * radius + 18, Math.sin(angle) * radius + 18, { tag: 'cones' })
    }
    for (let i = 0; i < 8; i++) place('crate', -34 + i * 2.6, 30 + (i % 2) * 2.4)
    for (let i = 0; i < 5; i++) place('ball', -12 + i * 5, -34)
    place('bench', 24, -8)
    place('bench', -24, -8)

    /* ---- a domino run near the hub ----------------------- */
    for (let i = 0; i < 26; i++) {
      const t = i / 25
      const x = -60 + t * 46
      const z = -52 + Math.sin(t * 3.2) * 9
      place('domino', x, z, { rotation: Math.atan2(Math.cos(t * 3.2) * 3.2, 46 / 25), tag: 'dominoes' })
    }

    /* ---- per-district scatter --------------------------- */
    const scatter: Partial<Record<string, { kind: PropKind; count: number; tag?: string }[]>> = {
      kcl: [{ kind: 'crate', count: 12 }, { kind: 'cone', count: 14, tag: 'cones' }, { kind: 'bench', count: 5 }],
      teaching: [{ kind: 'block', count: 14, tag: 'bugs' }, { kind: 'drum', count: 6 }],
      algorithms: [{ kind: 'block', count: 12 }, { kind: 'ball', count: 8 }, { kind: 'panel', count: 6 }],
      ucl: [{ kind: 'panel', count: 8 }, { kind: 'crate', count: 8 }],
      lab: [{ kind: 'drum', count: 12 }, { kind: 'block', count: 10 }],
      chess: [{ kind: 'crate', count: 8 }],
      stock: [{ kind: 'crate', count: 14 }, { kind: 'drum', count: 8 }],
      focus: [{ kind: 'crate', count: 12 }, { kind: 'panel', count: 6 }, { kind: 'ball', count: 6 }],
      gym: [{ kind: 'drum', count: 12 }, { kind: 'plank', count: 8 }, { kind: 'ball', count: 6 }],
      client: [{ kind: 'barrier', count: 16 }, { kind: 'cone', count: 20, tag: 'cones' }],
      circuit: [{ kind: 'barrier', count: 30 }, { kind: 'cone', count: 26, tag: 'cones' }],
      labyrinth: [{ kind: 'crate', count: 6 }],
      voxel: [{ kind: 'block', count: 14 }],
      network: [{ kind: 'drum', count: 6 }],
      studio: [{ kind: 'plank', count: 10 }, { kind: 'crate', count: 6 }],
      orbit: [{ kind: 'ball', count: 10 }],
      archive: [{ kind: 'cone', count: 16, tag: 'cones' }, { kind: 'crate', count: 10 }],
    }

    for (const district of districts) {
      const list = scatter[district.id]
      if (!list) continue
      for (const entry of list) {
        const count = q.count(entry.count, Math.ceil(entry.count * 0.35))
        for (let i = 0; i < count; i++) {
          const angle = rand() * Math.PI * 2
          // Kept off the exact centre, where the landmark stands.
          const radius = district.radius * (0.35 + rand() * 0.55)
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
