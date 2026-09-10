import * as THREE from 'three'
import type { Game } from '../Game'
import type { Bin } from '../core/Disposal'
import { MAP_DEPTH, MAP_WIDTH } from '@/content/world-map'

/* ============================================================
   MAP CALIBRATION — DEVELOPMENT ONLY

   The island is traced from a hand-drawn map. Judging whether
   the trace is faithful from the driving camera is impossible:
   it looks down at 50° from twenty metres, and at that angle a
   feature thirty metres out of place looks like a feature.

   SHIFT+M gives the top-down view the drawing was made in, with
   the drawing itself laid over the world at 40% and the exact
   extents of `MAP_WIDTH` × `MAP_DEPTH`, so the two can be
   compared feature by feature. [ and ] fade the overlay; \\ hides
   it entirely, which is how you check the world alone.

   It is not "near-orthographic" by accident. A true orthographic
   camera would mean a second camera through the whole render
   path — the composite pass, the raycasts, the grass ring, the
   touch unprojection all read `view.camera` — so this parks the
   normal camera at four hundred metres with a 25° lens instead.
   Over a 380 m island that is under two degrees of convergence
   at the edges, which is less than the drawn coastline's own
   wobble.

   NONE OF THIS SHIPS. The class is constructed only under
   `process.env.NODE_ENV === 'development'` (see Game), and the
   drawing it loads lives in `public/dev/`, requested lazily on
   the first toggle — so a production visitor never fetches it.
   ============================================================ */

/** The rectified photograph of the plan. Fetched on first toggle. */
const PLAN_IMAGE = '/dev/map-plan.webp'

export class MapCalibration {
  private overlay: THREE.Mesh | null = null
  private grid: THREE.LineSegments | null = null
  private active = false
  private opacity = 0.4
  /** Where the camera was when calibration was switched on. */
  private saved: { position: THREE.Vector3; quaternion: THREE.Quaternion } | null = null

  constructor(private game: Game, bin: Bin) {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (event.metaKey || event.ctrlKey) return
      if (event.code === 'KeyM' && event.shiftKey) { this.toggle(); return }
      if (!this.active) return
      if (event.code === 'BracketLeft') this.setOpacity(this.opacity - 0.1)
      if (event.code === 'BracketRight') this.setOpacity(this.opacity + 0.1)
      if (event.code === 'Backslash') this.setOpacity(this.opacity > 0 ? 0 : 0.4)
    }
    window.addEventListener('keydown', onKey)

    // Order 8: after `View.update` (order 7) has moved the camera and
    // before the renderer (998) uses it. Overriding it here rather
    // than inside View keeps the follow camera's own logic untouched,
    // which is the point — the driving camera is not what is being
    // debugged.
    const tick = () => { if (this.active) this.park() }
    game.ticker.events.on('tick', tick, 8)

    bin.add(() => {
      window.removeEventListener('keydown', onKey)
      game.ticker.events.off('tick', tick)
      this.dispose()
    })
  }

  toggle(): boolean {
    this.active = !this.active
    if (this.active) {
      const camera = this.game.view.camera
      this.saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone() }
      if (!this.overlay) void this.build()
      this.park()
      this.report()
    } else {
      if (this.saved) {
        this.game.view.camera.position.copy(this.saved.position)
        this.game.view.camera.quaternion.copy(this.saved.quaternion)
      }
      this.game.view.snapToTarget()
    }
    if (this.overlay) this.overlay.visible = this.active
    if (this.grid) this.grid.visible = this.active
    return this.active
  }

  private setOpacity(value: number): void {
    this.opacity = Math.max(0, Math.min(1, Math.round(value * 10) / 10))
    if (this.overlay) (this.overlay.material as THREE.MeshBasicMaterial).opacity = this.opacity
  }

  /** Straight down, high enough that the whole plan is in frame. */
  private park(): void {
    const camera = this.game.view.camera
    // The 25° lens sees `2 * tan(12.5°) * height` across the short
    // axis. The plan is MAP_DEPTH (199.5 m) deep, so 462 m fills it
    // with a wide margin; the far plane is 800, which caps this.
    camera.position.set(0, 462, 0.01)
    camera.up.set(0, 0, -1)
    camera.lookAt(0, 0, 0)
    camera.updateMatrixWorld()
  }

  private report(): void {
    console.log(
      '%c[MapCalibration]%c SHIFT+M exit · [ ] fade the plan · \\\\ hide it\n'
      + `  world extents  ${MAP_WIDTH} × ${MAP_DEPTH} m  (x ${-MAP_WIDTH / 2}…${MAP_WIDTH / 2}, z ${-MAP_DEPTH / 2}…${MAP_DEPTH / 2})\n`
      + `  overlay        ${PLAN_IMAGE} at ${Math.round(this.opacity * 100)}%`,
      'font: 600 13px ui-monospace, monospace; color:#d4491f',
      'font: 11px/1.6 ui-monospace, monospace; color:#888',
    )
  }

  private async build(): Promise<void> {
    /*
      The plan is laid at y = 84: above every landform (the highest
      bump is 9 m) and above the tallest thing built on the island, so
      it is a tracing sheet over the world rather than a decal
      competing with it. `depthTest: false` finishes the job — the
      overlay must never be occluded by the terrain it is being
      compared against.
    */
    const geometry = new THREE.PlaneGeometry(MAP_WIDTH, MAP_DEPTH)
    geometry.rotateX(-Math.PI / 2)

    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: this.opacity,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    })
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.y = 84
    mesh.renderOrder = 1000
    mesh.visible = this.active
    this.overlay = mesh
    this.game.renderer.scene.add(mesh)

    // The plan's tenth-lines, so a feature can be read off the world
    // in the same normalized coordinates the plan is authored in.
    const points: number[] = []
    for (let i = 0; i <= 10; i++) {
      const x = -MAP_WIDTH / 2 + (i / 10) * MAP_WIDTH
      const z = -MAP_DEPTH / 2 + (i / 10) * MAP_DEPTH
      points.push(x, 85, -MAP_DEPTH / 2, x, 85, MAP_DEPTH / 2)
      points.push(-MAP_WIDTH / 2, 85, z, MAP_WIDTH / 2, 85, z)
    }
    const gridGeometry = new THREE.BufferGeometry()
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3))
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: '#d4491f', transparent: true, opacity: 0.35, depthTest: false }),
    )
    grid.renderOrder = 1001
    grid.visible = this.active
    this.grid = grid
    this.game.renderer.scene.add(grid)

    const texture = await new THREE.TextureLoader().loadAsync(PLAN_IMAGE).catch(() => null)
    if (!texture) {
      console.warn(`[MapCalibration] ${PLAN_IMAGE} not found — showing the grid only`)
      return
    }
    texture.colorSpace = THREE.SRGBColorSpace
    material.map = texture
    material.needsUpdate = true
  }

  private dispose(): void {
    for (const object of [this.overlay, this.grid]) {
      if (!object) continue
      object.removeFromParent()
      object.geometry.dispose()
      const material = object.material as THREE.Material & { map?: THREE.Texture | null }
      material.map?.dispose()
      material.dispose()
    }
    this.overlay = null
    this.grid = null
  }
}
