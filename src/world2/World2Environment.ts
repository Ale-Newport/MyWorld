import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { Bin, disposeObject } from '@/world/core/Disposal'
import type { Physics, Physical, ColliderDescription } from '@/world/physics/Physics'
import type { Ticker } from '@/world/core/Ticker'
import type { Classification, World2Manifest } from './types'

export const WORLD2_SCALE = 1

function closeBitmaps(root: THREE.Object3D): void {
  const bitmaps = new Set<ImageBitmap>()
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && typeof ImageBitmap !== 'undefined' && value.source.data instanceof ImageBitmap) bitmaps.add(value.source.data)
      }
    }
  })
  for (const bitmap of bitmaps) bitmap.close()
}

/** Fetches belong to the mount, including cancellation during Strict Mode. */
export async function fetchAsset(url: string, signal: AbortSignal, progress: (ratio: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}. Run npm run world2:export.`)
  const size = Number(response.headers.get('content-length'))
  if (!response.body) return response.arrayBuffer()
  const reader = response.body.getReader()
  const parts: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
    received += value.byteLength
    progress(size ? received / size : .5)
  }
  const data = new Uint8Array(received)
  let offset = 0
  for (const part of parts) { data.set(part, offset); offset += part.length }
  return data.buffer
}

/*
  A FLOOR HAS TO WEIGH SOMETHING.

  Rapier derives a fixed body's mass from its colliders, and the raycast
  vehicle resolves a wheel's BRAKE impulse against that body's INVERSE mass —
  so a floor that weighs nothing cannot slow the car down. A trimesh fitted to
  a flat authored surface encloses no volume, which is exactly nothing: on
  this island `refRoad` (the visible circuit ribbon), `carpet`, the career
  lane strips and thirty-odd other flat pieces all come out at mass 0 and an
  inverse mass of 5704, where the terrain — which has relief — comes out at
  2701 and the authored road slabs at 1282.

  The circuit is where it shows, because the level authors that road TWICE and
  coplanar: the visible ribbon on top of thirteen cuboid slabs. A wheel swaps
  between them about twenty-eight times a second, and on the ribbon the brake
  impulse it delivers is 0.0001 against the slabs' 0.1633 — the same figure,
  measured, that `idleBrake` asks for. Half the time, on the one road built
  for speed, lifting off did nothing.

  Throttle is unaffected: engine force is applied directly. Only braking and
  the lift-off drag go through the mass, which is why this reads from the
  driver's seat as a car that keeps its momentum and a brake pedal that cuts
  out for a few thousandths at a time.

  So every fixed body this level builds is given a mass in the same range as
  the terrain. A fixed body never moves, so the only thing this changes is how
  immovable the solver considers it — which is the answer that was wanted.
*/
const FLOOR_MASS = 5000

function anchor(physical: Physical): void {
  if (physical.body.mass() >= FLOOR_MASS) return
  physical.body.setAdditionalMass(FLOOR_MASS, true)
}

export class World2Environment {
  readonly group = new THREE.Group()
  readonly nodes = new Map<string, THREE.Object3D>()
  /** Level meshes the interaction layer replaced. See `suppress`. */
  private readonly suppressed = new Set<THREE.Object3D>()
  readonly meshes: THREE.Mesh[] = []
  readonly dynamic: { node: THREE.Object3D; physical: Physical }[] = []
  /** Body per authored root, so gameplay can push, reset and query them. */
  readonly physicals = new Map<THREE.Object3D, Physical>()
  /**
   * Authored names whose physics the interaction layer builds itself.
   * The title letters are the case that matters: their bodies belong to
   * generated glyphs, not to the "BRUNO SIMON" meshes in the export.
   */
  readonly reserved = new Set<string>()
  readonly areas: { name: string; position: THREE.Vector3; inverse: THREE.Matrix4 | null }[] = []
  private physics?: Physics
  private readonly terrainCells = new Map<string, number[][]>()
  private terrain!: THREE.Mesh
  private water?: THREE.Mesh
  private debugLines?: THREE.LineSegments
  private materialBackup = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  private readonly hidden = new Set<Classification>()

  constructor(readonly manifest: World2Manifest, private bin: Bin) {
    if (manifest.scale !== WORLD2_SCALE) throw new Error('World2 source scale changed; recalibrate the manifest and runtime together.')
    this.group.name = 'World2 / folio-2025.blend'
    bin.object3D(this.group)
    this.bin.add(() => closeBitmaps(this.group))
  }

  async load(url: string, signal: AbortSignal, progress: (ratio: number) => void): Promise<void> {
    const data = await fetchAsset(url, signal, progress)
    if (signal.aborted) return
    const gltf = await new GLTFLoader().parseAsync(data, '/world2/models/')
    if (signal.aborted) { closeBitmaps(gltf.scene); disposeObject(gltf.scene); return }
    this.group.add(gltf.scene)
    this.group.updateMatrixWorld(true)
    gltf.scene.traverse(node => {
      this.nodes.set(node.userData.w2Source ?? node.name, node)
      // Original exact names remain useful even when multiple instances share a source.
      this.nodes.set(node.name, node)
      if (node.userData.w2Role === 'collider') node.visible = false
      if (!(node instanceof THREE.Mesh)) return
      if (node.userData.w2Role === 'collider') return
      node.castShadow = node.userData.w2Category !== 'terrain' && node.name !== 'Plane003'
      node.receiveShadow = true
      this.meshes.push(node)
      if (node.userData.w2Source === 'terrain') { this.terrain = node; this.indexTerrain(node) }
      for (const m of Array.isArray(node.material) ? node.material : [node.material]) {
        // Authored thin surfaces (foliage, flags, signs, ribbons) are two-sided.
        m.side = THREE.DoubleSide
        if (m instanceof THREE.MeshStandardMaterial && m.map?.name === 'palette') {
          m.map.magFilter = THREE.NearestFilter
          m.map.minFilter = THREE.NearestFilter
        }
      }
    })
  }

  /** Build physics only after source geometry is visible; all transforms are matrixWorld. */
  addPhysics(physics: Physics, ticker: Ticker): void {
    this.physics = physics
    this.group.updateMatrixWorld(true)
    const roots: THREE.Object3D[] = []
    this.group.traverse(node => { if (node.userData.w2Role === 'physical') roots.push(node) })
    const covered = new Set<THREE.Object3D>()
    for (const root of roots) {
      // Reserved means "the interaction layer builds this body itself", not
      // "hide this". Hiding here is what made the bowling ball, its score
      // screen and the gutter bumpers invisible.
      if (this.reserved.has(String(root.userData.w2Source ?? root.name))) continue
      const colliders: ColliderDescription[] = []
      const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
      root.matrixWorld.decompose(position, quaternion, scale)
      const inverse = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1)).invert()
      root.traverse(node => {
        if (node.userData.w2Role !== 'collider') return
        // Object3D.traverse does not prune children when its callback returns.
        // Nested physical objects own their own helpers (for example the phone).
        let owner = node.parent
        while (owner && owner.userData.w2Role !== 'physical') owner = owner.parent
        if (owner !== root) return
        const collider = this.colliderFrom(node, inverse)
        if (collider) { colliders.push(collider); covered.add(node) }
      })
      if (!colliders.length) continue
      const dynamic = root.userData.w2Body === 'dynamic'
      const physical: Physical = physics.add({
        type: dynamic ? 'dynamic' : 'fixed', position, rotation: quaternion,
        colliders, category: dynamic ? 'object' : 'floor',
        friction: root.userData.friction ?? .7, restitution: root.userData.restitution ?? .02,
        ...(dynamic ? { mass: root.userData.mass ?? 1, sleeping: true } : {}),
        owner: root.userData.w2Source ?? root.name,
      })
      if (!dynamic) anchor(physical)
      root.traverse(node => covered.add(node))
      this.physicals.set(root, physical)
      if (dynamic) {
        this.group.attach(root)
        this.dynamic.push({ node: root, physical })
      }
    }
    // Accurate static terrain/road/ramp/bridge faces override no topology.
    // Unnamed scenery without authored physics gets its actual mesh, not an AABB.
    for (const mesh of this.meshes) {
      const cls = mesh.userData.w2Category
      const name = String(mesh.userData.w2Source ?? mesh.name)
      const mustMatchSurface = name === 'terrain' || name === 'refRoad' || name === 'jump'
      if ((covered.has(mesh) && !mustMatchSurface) || cls === 'vegetation' || cls === 'water') continue
      if (this.reservedAncestor(mesh)) continue
      if (/ref(?:Images|Arrow|Carpet|Label|Cross|Disc|Banner|Heat|Liquid|Candle|Bonfire|Charcoal|Screen|Leaderboard)|text|label/i.test(name)) continue
      const bounds = new THREE.Box3().setFromObject(mesh)
      const size = bounds.getSize(new THREE.Vector3())
      if (!mustMatchSurface && Math.max(size.x, size.y, size.z) < .6) continue
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      anchor(physics.add({ type: 'fixed', category: 'floor', friction: .7, restitution: .02,
        colliders: [{ shape: 'trimesh', parameters: [Float32Array.from(geometry.getAttribute('position').array), this.indices(geometry)] }], owner: name }))
      geometry.dispose()
    }
    const update = () => {
      for (const { node, physical } of this.dynamic) {
        node.position.lerpVectors(physical.previous.position, physical.current.position, ticker.alpha)
        node.quaternion.slerpQuaternions(physical.previous.quaternion, physical.current.quaternion, ticker.alpha)
      }
    }
    ticker.events.on('tick', update, 8)
    this.bin.add(() => ticker.events.off('tick', update))
    physics.waterElevation = -Infinity
    physics.waterAt = (x, z) => this.terrainHeightAt(x, z) < this.manifest.waterLevel ? this.manifest.waterLevel : null
    this.addWater()
    for (const area of this.manifest.areas) {
      const node = this.nodes.get(area.anchor), zone = area.zone ? this.nodes.get(area.zone) : null
      if (!node) continue
      this.areas.push({ name: area.name, position: node.getWorldPosition(new THREE.Vector3()), inverse: zone?.matrixWorld.clone().invert() ?? null })
    }
  }

  /** True when this mesh sits under a root the interaction layer owns. */
  private reservedAncestor(node: THREE.Object3D): boolean {
    for (let o: THREE.Object3D | null = node; o; o = o.parent)
      if (this.reserved.has(String(o.userData.w2Source ?? o.name))) return true
    return false
  }

  /** Gives a fixed body the mass the solver needs. See `FLOOR_MASS`. */
  anchor(physical: Physical): void { anchor(physical) }

  /** Every node authored into a Blender collection, in export order. */
  collection(name: string): THREE.Object3D[] {
    const found: THREE.Object3D[] = []
    this.group.traverse(node => {
      const collections = node.userData.w2Collections
      if (Array.isArray(collections) && collections.includes(name)) found.push(node)
    })
    return found
  }

  private indices(geometry: THREE.BufferGeometry): Uint32Array {
    return geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i)
  }

  /**
   * The authored collider set for one `*Physical*` root, in its own local
   * space. Gameplay needs this for the bodies it builds itself — the
   * kinematic obstacles and bumpers the level exports as static, because
   * "KinematicPositionBased" contains no "dynamic" for the name test to find.
   */
  collidersFor(root: THREE.Object3D): { position: THREE.Vector3; quaternion: THREE.Quaternion; colliders: ColliderDescription[] } {
    root.updateWorldMatrix(true, true)
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
    root.matrixWorld.decompose(position, quaternion, scale)
    const inverse = new THREE.Matrix4().compose(position, quaternion, new THREE.Vector3(1, 1, 1)).invert()
    const colliders: ColliderDescription[] = []
    root.traverse(node => {
      if (node.userData.w2Role !== 'collider') return
      let owner = node.parent
      while (owner && owner.userData.w2Role !== 'physical') owner = owner.parent
      if (owner !== root) return
      const collider = this.colliderFrom(node, inverse)
      if (collider) colliders.push(collider)
    })
    return { position, quaternion, colliders }
  }

  private colliderFrom(node: THREE.Object3D, inverse: THREE.Matrix4): ColliderDescription | null {
    const matrix = inverse.clone().multiply(node.matrixWorld)
    const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3()
    matrix.decompose(position, quaternion, scale)
    if (node instanceof THREE.Mesh) {
      const geometry = node.geometry.clone().applyMatrix4(matrix)
      const vertices = Float32Array.from(geometry.getAttribute('position').array)
      const shape = node.userData.w2Shape === 'trimesh' ? 'trimesh' : 'hull'
      const result: ColliderDescription = { shape, parameters: shape === 'trimesh' ? [vertices, this.indices(geometry)] : [vertices] }
      geometry.dispose()
      return result
    }
    // Empty display_size is the authored half-size, not Object.dimensions (zero).
    scale.multiplyScalar(node.userData.w2DisplaySize ?? .5)
    const x = Math.abs(scale.x), y = Math.abs(scale.y), z = Math.abs(scale.z)
    const shape = node.userData.w2Shape
    if (shape === 'cuboid') return { shape, parameters: [x, y, z], position, quaternion }
    if (shape === 'tube') return { shape: 'cylinder', parameters: [y, Math.max(x, z)], position, quaternion }
    if (shape === 'ball') return { shape: 'ball', parameters: [Math.max(x, y, z)], position }
    return null
  }

  addVegetationPhysics(): void {
    if (!this.physics) return
    // Source trunk geometry at each source reference. Leaves/bushes never obstruct roads.
    for (const mesh of this.meshes) {
      if (!mesh.userData.w2Trunk) continue
      const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      // A trunk is scenery you hit, not a floor you brake on, but the same
      // rule applies: a body the solver thinks weighs nothing gives way.
      anchor(this.physics.add({ type: 'fixed', category: 'floor', friction: .7, restitution: .02,
        colliders: [{ shape: 'trimesh', parameters: [Float32Array.from(geometry.getAttribute('position').array), this.indices(geometry)] }], owner: mesh.name }))
      geometry.dispose()
    }
    // Repeated tree parts share source mesh data in GLB and become true GPU
    // instances. Keep source nodes addressable; never regenerate placements.
    const instances = new Map<string, THREE.Mesh[]>()
    for (const mesh of this.meshes) {
      if (!mesh.userData.w2Tree || Array.isArray(mesh.material)) continue
      const p = mesh.getWorldPosition(new THREE.Vector3())
      const key = `${mesh.geometry.uuid}:${mesh.material.uuid}:${Math.floor(p.x / 32)}:${Math.floor(p.z / 32)}`
      const list = instances.get(key) ?? []; list.push(mesh); instances.set(key, list)
    }
    for (const list of instances.values()) {
      if (list.length < 2) continue
      const batch = new THREE.InstancedMesh(list[0].geometry, list[0].material, list.length)
      this.bin.add(() => batch.dispose())
      list.forEach((mesh, i) => { batch.setMatrixAt(i, mesh.matrixWorld); mesh.visible = false; mesh.userData.w2Batched = true })
      batch.userData.w2Category = 'vegetation'; batch.castShadow = true; batch.receiveShadow = true
      batch.computeBoundingSphere(); this.group.add(batch); this.meshes.push(batch)
    }
    // Other authored static vegetation is merged in spatial cells, preserving
    // every vertex. No random scattering and no per-object draw calls.
    const batches = new Map<string, THREE.Mesh[]>()
    for (const mesh of this.meshes) {
      if (mesh.userData.w2Category !== 'vegetation' || mesh.userData.w2Batched || mesh instanceof THREE.InstancedMesh || Array.isArray(mesh.material)) continue
      const p = mesh.getWorldPosition(new THREE.Vector3())
      const key = `${mesh.material.uuid}:${Math.floor(p.x / 24)}:${Math.floor(p.z / 24)}`
      const list = batches.get(key) ?? []; list.push(mesh); batches.set(key, list)
    }
    for (const list of batches.values()) {
      if (list.length < 2) continue
      const geometries = list.map(mesh => {
        const g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
        if (!g.index) return g
        const result = g.toNonIndexed(); g.dispose(); return result
      })
      const geometry = mergeGeometries(geometries, false)
      geometries.forEach(g => g.dispose())
      if (!geometry) continue
      const mesh = new THREE.Mesh(geometry, list[0].material)
      mesh.userData.w2Category = 'vegetation'; mesh.castShadow = true; mesh.receiveShadow = true
      this.group.add(mesh)
      this.meshes.push(mesh)
      for (const original of list) { original.visible = false; original.userData.w2Batched = true }
    }
  }

  /**
   * Merges the level's static scenery into one mesh per material per spatial
   * cell. The export ships it as 371 separate objects averaging 212 triangles
   * each — hundreds of draw calls for a fraction of the geometry, which is
   * the single biggest cost in the frame and the reason the world felt heavy.
   *
   * This is the same treatment `addVegetationPhysics` already gives the trees,
   * with one extra rule: anything the interaction layer has looked up is left
   * alone. If gameplay asked for a node, something is going to move it, hide
   * it or repaint it, and a merged copy would not follow.
   *
   * Physics is untouched — every collider was built from the originals before
   * this runs, and the originals stay in the graph, just not drawn.
   */
  batchScenery(protectedNodes: ReadonlySet<THREE.Object3D>): { before: number; after: number } {
    this.group.updateMatrixWorld(true)
    const owned = new Set<THREE.Object3D>()
    for (const node of protectedNodes) node.traverse(child => owned.add(child))
    // A body that can move must keep its own mesh.
    for (const { node } of this.dynamic) node.traverse(child => owned.add(child))
    this.group.traverse(node => {
      const name = String(node.userData.w2Source ?? node.name)
      if (node.userData.w2Body === 'dynamic' || /KinematicPositionBased/.test(name)) node.traverse(child => owned.add(child))
    })

    const candidates: THREE.Mesh<THREE.BufferGeometry, THREE.Material>[] = []
    for (const mesh of this.meshes) {
      if (owned.has(mesh) || mesh.userData.w2Batched || mesh instanceof THREE.InstancedMesh) continue
      if (mesh.userData.w2Category !== 'scenery' && mesh.userData.w2Category !== 'roads') continue
      if (!mesh.visible || Array.isArray(mesh.material)) continue
      // Anything with an ancestor gameplay owns rides with that ancestor.
      let owner: THREE.Object3D | null = mesh.parent
      let claimed = false
      while (owner && !claimed) { if (owned.has(owner)) claimed = true; owner = owner.parent }
      if (claimed) continue
      candidates.push(mesh as THREE.Mesh<THREE.BufferGeometry, THREE.Material>)
    }

    const cells = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>()
    const at = new THREE.Vector3()
    for (const mesh of candidates) {
      mesh.getWorldPosition(at)
      // Geometries only merge when they carry the same attributes — some of
      // these quads have a second UV set for their own shader and most do not.
      const attributes = Object.keys(mesh.geometry.attributes).sort().join(',')
      const key = `${mesh.material.uuid}:${attributes}:${Math.floor(at.x / 26)}:${Math.floor(at.z / 26)}`
      const list = cells.get(key) ?? []
      list.push(mesh)
      cells.set(key, list)
    }

    let merged = 0
    for (const list of cells.values()) {
      if (list.length < 3) continue
      const geometries = list.map(mesh => {
        const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
        if (!geometry.index) return geometry
        const flat = geometry.toNonIndexed()
        geometry.dispose()
        return flat
      })
      const combined = mergeGeometries(geometries, false)
      geometries.forEach(geometry => geometry.dispose())
      // A mismatch three.js reports rather than throws: leave the cell alone.
      if (!combined) continue
      const batch = new THREE.Mesh(combined, list[0].material)
      batch.userData.w2Category = list[0].userData.w2Category
      batch.castShadow = list.some(mesh => mesh.castShadow)
      batch.receiveShadow = true
      combined.computeBoundingSphere()
      this.group.add(batch)
      this.meshes.push(batch)
      for (const mesh of list) { mesh.visible = false; mesh.userData.w2Batched = true }
      merged += list.length
      this.bin.add(() => combined.dispose())
    }
    return { before: candidates.length, after: candidates.length - merged + cells.size }
  }

  private indexTerrain(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    const p = geometry.getAttribute('position'), indices = this.indices(geometry)
    for (let i = 0; i < indices.length; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, indices[i])
      const b = new THREE.Vector3().fromBufferAttribute(p, indices[i + 1])
      const c = new THREE.Vector3().fromBufferAttribute(p, indices[i + 2])
      const tri = [...a.toArray(), ...b.toArray(), ...c.toArray()]
      for (let x = Math.floor(Math.min(a.x, b.x, c.x) / 4); x <= Math.floor(Math.max(a.x, b.x, c.x) / 4); x++) {
        for (let z = Math.floor(Math.min(a.z, b.z, c.z) / 4); z <= Math.floor(Math.max(a.z, b.z, c.z) / 4); z++) {
          const key = `${x}:${z}`, list = this.terrainCells.get(key) ?? []
          list.push(tri); this.terrainCells.set(key, list)
        }
      }
    }
    geometry.dispose()
  }

  terrainHeightAt(x: number, z: number): number {
    const triangles = this.terrainCells.get(`${Math.floor(x / 4)}:${Math.floor(z / 4)}`) ?? []
    let height = -Infinity
    for (const [ax, ay, az, bx, by, bz, cx, cy, cz] of triangles) {
      const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz)
      if (Math.abs(det) < 1e-10) continue
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / det
      const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / det
      if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) height = Math.max(height, u * ay + v * by + (1 - u - v) * cy)
    }
    return height
  }

  private addWater(): void {
    // The Blender terrainWater mask displaces this mesh. Clip each original
    // triangle to the companion scene's waterline, retaining exact boundaries.
    const source = this.terrain.geometry.index ? this.terrain.geometry.toNonIndexed() : this.terrain.geometry.clone()
    source.applyMatrix4(this.terrain.matrixWorld)
    const a = source.getAttribute('position'), vertices: number[] = [], level = this.manifest.waterLevel
    for (let i = 0; i < a.count; i += 3) {
      let polygon = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(a, i + j))
      const clipped: THREE.Vector3[] = []
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j], q = polygon[(j + 1) % polygon.length]
        if (p.y < level) clipped.push(p.clone())
        if ((p.y < level) !== (q.y < level)) clipped.push(p.clone().lerp(q, (level - p.y) / (q.y - p.y)))
      }
      polygon = clipped
      for (let j = 1; j + 1 < polygon.length; j++) for (const p of [polygon[0], polygon[j], polygon[j + 1]]) vertices.push(p.x, level, p.z)
    }
    source.dispose()
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); geometry.computeVertexNormals()
    this.water = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#61b9b3', transparent: true, opacity: .66, roughness: .3, metalness: .12, side: THREE.DoubleSide, depthWrite: false }))
    this.water.userData.w2Category = 'water'; this.group.add(this.water); this.meshes.push(this.water)
  }

  currentArea(position: THREE.Vector3): string {
    for (const area of this.areas) {
      if (!area.inverse) continue
      const local = position.clone().applyMatrix4(area.inverse)
      if (Math.abs(local.x) <= .5 && Math.abs(local.z) <= .5) return area.name
    }
    return 'open road'
  }

  /**
   * "The interaction layer authored something else in this one's place."
   *
   * A node marked here stays hidden for the life of the level: the template
   * a mini-game clones, the letters that spell somebody else's name, the two
   * control-label variants for pads nobody is holding, the marks of accounts
   * this portfolio does not have. It is separate from `reserved` — that one is
   * about PHYSICS, and a reserved node is usually still drawn.
   *
   * It exists because `setVisible` below re-derives visibility for every mesh
   * in the level from its category alone, so toggling the validation panel's
   * scenery checkbox off and on used to resurrect every one of them.
   */
  suppress(node: THREE.Object3D): void {
    node.traverse(child => { this.suppressed.add(child); child.visible = false })
  }

  /** The other half of `suppress`, for a node that swaps in and out. */
  unsuppress(node: THREE.Object3D): void {
    node.traverse(child => {
      this.suppressed.delete(child)
      child.visible = !child.userData.w2Batched && !this.hidden.has(child.userData.w2Category)
    })
  }

  setVisible(category: Classification, visible: boolean): void {
    if (visible) this.hidden.delete(category); else this.hidden.add(category)
    for (const mesh of this.meshes) {
      mesh.visible = !mesh.userData.w2Batched && !this.hidden.has(mesh.userData.w2Category) && !this.suppressed.has(mesh)
    }
  }

  setClassificationColors(enabled: boolean): void {
    const colors: Record<string, string> = { terrain: '#b3ce4d', roads: '#ffc256', scenery: '#8d91ab', vegetation: '#36a654', water: '#43bbdf' }
    for (const mesh of this.meshes) {
      if (enabled && !this.materialBackup.has(mesh)) {
        this.materialBackup.set(mesh, mesh.material)
        mesh.material = new THREE.MeshBasicMaterial({ color: colors[mesh.userData.w2Category] ?? '#ff00ff', side: THREE.DoubleSide })
      } else if (!enabled && this.materialBackup.has(mesh)) {
        (mesh.material as THREE.Material).dispose(); mesh.material = this.materialBackup.get(mesh)!; this.materialBackup.delete(mesh)
      }
    }
  }

  showColliders(enabled: boolean): void {
    if (this.debugLines) { disposeObject(this.debugLines); this.debugLines = undefined }
    if (!enabled || !this.physics) return
    const { vertices, colors } = this.physics.world.debugRender()
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(vertices, 3)).setAttribute('color', new THREE.BufferAttribute(colors, 4))
    this.debugLines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: .8 }))
    this.debugLines.renderOrder = 1000; this.group.add(this.debugLines)
  }

  restoreMaterials(): void { this.setClassificationColors(false) }
}
