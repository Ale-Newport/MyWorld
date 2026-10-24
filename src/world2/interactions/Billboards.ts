import * as THREE from 'three'

/* ============================================================
   BILLBOARDS — one place that turns reader-facing 3D labels to the camera.

   WHY. The /world gameplay camera is a fixed-azimuth chase camera that the
   player can drag-orbit freely (any yaw, elevation 13°–83°), and the world2
   areas sit inside frames that are rotated (−60°…+45°) and scaled (0.7…1.5).
   A label oriented once, in its frame, reads sideways, edge-on or from behind
   as soon as the camera or the frame disagrees with the Blender author's
   camera. `Object3D.lookAt(player)` is no better: it faces the CAR, not the
   camera, and the call sites hand it frame-LOCAL coordinates that lookAt reads
   as world ones.

   WHAT IT DOES. `Billboards.for(ticker)` is one system per ticker with ONE
   'tick' subscriber at order 21 — after the camera (View 7), every controller
   (8–14), the Tweens (20) — so a label always uses this frame's final camera
   and never lags a frame. Each registered object is turned, every tick the
   camera or the object moved, to face the camera that is actually rendering.

   CONTRACT
   - The object's +Z is its READING face and +Y is its up. Build flat planes
     unrotated (PlaneGeometry already faces +Z); wrap a pivot around anything
     whose geometry is authored lying flat or pointing elsewhere.
   - The billboard OWNS the object's quaternion (and its scale, when the
     `scale` option is given). Animate, offset or slide a CHILD, or the
     object's position — never its rotation or scale.
   - Parent-transform aware: the desired WORLD orientation is converted to the
     object's LOCAL quaternion through the parent's world rotation, so rotated
     and uniformly scaled frames are fine. A mirrored parent (negative scale)
     would flip the text: it is reported once with console.warn.
   - The parent's `matrixWorld` is read as it stands at order 21. A static
     frame is always right. If the object or a parent moves every tick, pass
     `moves: true` (the system then refreshes the parent chain itself); if it
     moved once, call `handle.refresh()`.
   - No allocation per tick: module scratch objects only (tests/world/
     billboards.test.mjs counts scavenges). Cost, measured in node: ~0.12 µs
     per label per tick while the camera moves (60 labels in view ≈ 7 µs) and
     ~0.15 µs for the whole pass when nothing moved.
   - Camera-agnostic: the camera is asked for every tick (`useCamera`), so the
     chase, the cinematic blend and the plane chase just work. With NO camera
     (the /world2 route, the studio's Edit previews and Simulate) update()
     returns at once and the object keeps whatever static pose it was authored
     with — pose it sensibly at creation and it is the fallback.

   API
     const handle = Billboards.for(game.ticker).add(object, {
       mode: 'spherical',        // default; 'cylindrical' | 'sprite' are NOT for text (below)
       scale: { ref: 21, min: 1, max: 1.8, compensateParent: true },
       radius: 90,               // metres from the camera beyond which the label is left alone (120)
       cull: 8,                  // frustum-test radius in the object's own units, 0 = no test (0)
       moves: false,             // the object or its parent chain moves every tick
       layer: MAP_HIDDEN_LAYER,  // keep the whole subtree out of the atlas photograph
     })
     bin.add(handle.remove)      // the handle's methods do not use `this`: this is the disposal pattern
     handle.enabled = false      // pause (e.g. while the label is concealed); handle.refresh() after a jump
     handle.cull = 4             // change the cull radius when the content grows (a re-painted label)
     Billboards.for(ticker).useCamera(() => camera)  // once per ticker; Driving does it for /world
     Billboards.for(ticker).camera                   // that camera (null when none): what a pass at AFTER_ORDER measures against

   MODES
   - 'spherical' (default): copies the camera's world rotation, so the plate is
     parallel to the screen, never mirrored, never rotated: legible, to float
     precision, in all 432 camera poses a player can reach (yaw every 5°,
     elevation 13°–83°; tests/world/billboards.test.mjs). Use it for EVERYTHING
     that carries text.
   - 'cylindrical': turns about the world-up axis only (`lean`, `pitchFollow`
     tilt it back). Its text rotates or flips on screen near the 83° top-down
     limit, so it is for non-text uses (a standing marker, a flag).
   - 'sprite': no rotation (the object is a THREE.Sprite, or faces the camera
     on its own); only the distance scale, the radius and the cull apply.

   SCALE. world scale = base × clamp(distance / ref, min, max), divided by the
   parent's scale when `compensateParent` (default). Below `ref` metres the label
   keeps `base`; beyond it, it grows so that it holds its size on screen up to
   `max`×`ref`. Choose `ref` as the distance up to which the authored size is
   right: the chase camera sits 21 m out at 16:9 and 31 m on a phone in portrait
   (up to 56 m fully zoomed out). `base` is the object's scale at the first
   update — after the asset's runtime edits — and is never read again.

   SKIPS. Hidden objects (object.visible), objects beyond `radius`, objects
   whose `cull` sphere is outside the view frustum, and every pass where
   neither the camera nor an item moved. A skipped item is re-oriented on
   re-entry, before it can be drawn.

   LAYER. `layer` is applied to the subtree at add() time. Children added
   later keep their own layers (Prompts' key glyph is covered by main.js's
   hideTransientFromMap). MAP_HIDDEN (2) is enabled on the gameplay cameras
   and not on the atlas camera, so the one-off map photograph has no labels.

   RECIPES
   Floating plate (Social, Career, plaza):
     const pivot = new THREE.Group(); pivot.add(plate)          // plate faces +Z
     const b = Billboards.for(game.ticker).add(pivot, { layer: MAP_HIDDEN_LAYER,
       scale: { ref: 21, min: 1, max: 2.2 }, cull: 4, moves: true })
     bin.add(b.remove)
   A label that grows from an edge (Career wipe): put the plate at
   `x = width / 2` inside a pivot placed at the anchored left edge.
   Physical signs (Projects boards, leaderboard, cookie counter) and the Title
   letters are NOT labels: they stay fixed and must never be registered.

   KNOWN LIMITS. A world-studio runtime edit that rotates a registered object
   is overridden every tick (position edits still apply). The camera's roll
   kick (View.kick) rolls the labels with the screen for ~0.3 s, on purpose.
   In an orthographic editor camera matrixWorld may lag one frame.
   ============================================================ */

/** After View (7), the controllers (8–14) and the Tweens (20): the camera and every label position are final. */
export const ORDER = 21
/** For a pass that reads what the billboards just did (a label that keeps itself inside the screen): the first order after them. */
export const AFTER_ORDER = ORDER + 1
/** Mirror of atlas.js MAP_HIDDEN: the atlas photograph renders layer 0 only. */
export const MAP_HIDDEN_LAYER = 2

export type BillboardMode = 'spherical' | 'cylindrical' | 'sprite'

export interface BillboardScale {
  /** Distance in metres at which the label has its base size (default 21, the chase camera's radius). */
  ref?: number
  /** Smallest distance factor (default 1: never shrink below the authored size). */
  min?: number
  /** Largest distance factor (default 1.6). */
  max?: number
  /** Divide by the parent's scale so a 0.7-scaled frame no longer shrinks the label (default true). */
  compensateParent?: boolean
}

export interface BillboardOptions {
  mode?: BillboardMode
  /** Cylindrical: radians the plate leans back from vertical. */
  lean?: number
  /** Cylindrical: 0..1 share of the camera's elevation added to `lean`. */
  pitchFollow?: number
  /** Cylindrical: clamp for lean + follow, radians (default 1.2). */
  maxPitch?: number
  /** Metres from the camera beyond which the label is left alone (default 120). */
  radius?: number
  /** Frustum-test radius in the object's own units (× its world scale); 0 disables the test (default 0). */
  cull?: number
  /** True if the object or its parent chain changes position every tick. */
  moves?: boolean
  scale?: BillboardScale
  /** Layer index to put the whole subtree on (MAP_HIDDEN_LAYER keeps it out of the atlas). */
  layer?: number
}

export interface BillboardHandle {
  readonly object: THREE.Object3D
  /** False pauses the billboard; true re-orients it on the next tick. */
  enabled: boolean
  /** The frustum-test radius, changeable while the label's content changes size. */
  cull: number
  /** Re-orient on the next tick (after moving the object or its parent once). */
  refresh(): void
  /** Unregister. Safe to pass to `bin.add` and to call twice. */
  remove(): void
}

/** What a registered label looks like to the QA harness (`Billboards.for(ticker).items`). */
export interface BillboardItem {
  readonly object: THREE.Object3D
  readonly mode: BillboardMode
  lean: number
  pitchFollow: number
  maxPitch: number
  radius2: number
  cull: number
  moves: boolean
  scale: { ref: number; min: number; max: number; compensate: boolean; base: number } | null
  stale: boolean
  enabled: boolean
  removed: boolean
  warned: boolean
}

/** The part of Driving's / Ticker's shape this needs: `ticker.events.on/off`. */
export interface BillboardTicker {
  events: {
    on(name: string, callback: () => void, order?: number): unknown
    off(name: string, callback: () => void): unknown
  }
}

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)
const _m = new THREE.Matrix4()
const _pv = new THREE.Matrix4()
const _frustum = new THREE.Frustum()
const _sphere = new THREE.Sphere()
const _qCam = new THREE.Quaternion()
const _qWorld = new THREE.Quaternion()
const _qLean = new THREE.Quaternion()
const _qParentInverse = new THREE.Quaternion()
const _pos = new THREE.Vector3()

const systems = new WeakMap<object, Billboards>()

/** Determinant of the upper 3×3 of a column-major matrix: negative = mirrored. */
function handedness(e: ArrayLike<number>): number {
  return e[0] * (e[5] * e[10] - e[9] * e[6]) - e[4] * (e[1] * e[10] - e[9] * e[2]) + e[8] * (e[1] * e[6] - e[5] * e[2])
}

export class Billboards {
  /** The shared system of a ticker: ONE per ticker, ONE 'tick' subscriber. */
  static for(ticker: BillboardTicker): Billboards {
    let system = systems.get(ticker)
    if (!system) { system = new Billboards(ticker); systems.set(ticker, system) }
    return system
  }

  /** Every registered label (read-only use: QA, diagnostics). */
  readonly items: BillboardItem[] = []
  private getCamera: (() => THREE.Camera | null | undefined) | null = null
  private subscribed = false
  /** Last camera pose and projection (x y z, quaternion, proj[0], proj[5]), to skip a pass when nothing moved. Float64: a Float32 cache never compares equal. */
  private readonly seen = new Float64Array(9)
  private seenValid = false
  private readonly tick = (): void => this.update()

  private constructor(private readonly ticker: BillboardTicker) {}

  /** The camera the labels are turned to (null where there is none: /world2, the studio's Edit and Simulate). */
  get camera(): THREE.Camera | null {
    return this.getCamera?.() ?? null
  }

  /** Where the camera that is rendered comes from: Driving does `() => camera`; an editor can pass its own. */
  useCamera(getCamera: () => THREE.Camera | null | undefined): this {
    this.getCamera = getCamera
    this.seenValid = false
    return this
  }

  add(object: THREE.Object3D, options: BillboardOptions = {}): BillboardHandle {
    const o = options
    const item: BillboardItem = {
      object,
      mode: o.mode ?? 'spherical',
      lean: o.lean ?? 0,
      pitchFollow: o.pitchFollow ?? 0,
      maxPitch: o.maxPitch ?? 1.2,
      radius2: (o.radius ?? 120) ** 2,
      cull: o.cull ?? 0,
      moves: !!o.moves,
      scale: o.scale
        ? { ref: o.scale.ref ?? 21, min: o.scale.min ?? 1, max: o.scale.max ?? 1.6, compensate: o.scale.compensateParent !== false, base: 0 }
        : null,
      stale: true,
      enabled: true,
      removed: false,
      warned: false,
    }
    if (o.layer !== undefined) object.traverse((node) => { node.layers.set(o.layer as number) })
    this.items.push(item)
    this.subscribe()
    return {
      object,
      get enabled() { return item.enabled },
      set enabled(value: boolean) { item.enabled = !!value; item.stale = true },
      get cull() { return item.cull },
      set cull(value: number) { item.cull = value; item.stale = true },
      refresh() { item.stale = true },
      remove: () => this.drop(item),
    }
  }

  private drop(item: BillboardItem): void {
    if (item.removed) return
    item.removed = true
    const at = this.items.indexOf(item)
    if (at >= 0) this.items.splice(at, 1)
    if (!this.items.length) this.unsubscribe()
  }

  private subscribe(): void {
    if (this.subscribed) return
    this.ticker.events.on('tick', this.tick, ORDER)
    this.subscribed = true
  }

  private unsubscribe(): void {
    if (!this.subscribed) return
    this.ticker.events.off('tick', this.tick)
    this.subscribed = false
    this.seenValid = false
  }

  /** One pass over every item. Public so the QA harness can time it; the ticker calls it at order 21. */
  update(): void {
    const camera = this.getCamera?.()
    if (!camera) return
    const items = this.items
    if (!items.length) return
    const ce = camera.matrixWorld.elements
    const pe = camera.projectionMatrix.elements
    // The camera's orientation, without allocating.
    _m.extractRotation(camera.matrixWorld)
    _qCam.setFromRotationMatrix(_m)
    const s = this.seen
    const moved = !this.seenValid
      || s[0] !== ce[12] || s[1] !== ce[13] || s[2] !== ce[14]
      || s[3] !== _qCam.x || s[4] !== _qCam.y || s[5] !== _qCam.z || s[6] !== _qCam.w
      || s[7] !== pe[0] || s[8] !== pe[5]
    if (moved) {
      s[0] = ce[12]; s[1] = ce[13]; s[2] = ce[14]
      s[3] = _qCam.x; s[4] = _qCam.y; s[5] = _qCam.z; s[6] = _qCam.w
      s[7] = pe[0]; s[8] = pe[5]
      this.seenValid = true
      _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      _frustum.setFromProjectionMatrix(_pv)
    }
    const cx = ce[12], cy = ce[13], cz = ce[14]
    // Items of one controller usually share a parent: its rotation and scale are derived once.
    let lastParent: THREE.Object3D | null = null
    let parentScale = 1
    for (let i = 0; i < items.length; i++) {
      const b = items[i]
      const o = b.object
      if (!b.enabled || !o.visible) { b.stale = true; continue }
      if (!moved && !b.stale && !b.moves) continue
      const p = o.parent
      _pos.copy(o.position)
      if (p) {
        if (b.moves) { p.updateWorldMatrix(true, false); lastParent = null }
        _pos.applyMatrix4(p.matrixWorld)
      }
      const dx = cx - _pos.x, dy = cy - _pos.y, dz = cz - _pos.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 > b.radius2) { b.stale = true; continue }
      if (p && p !== lastParent) {
        const pm = p.matrixWorld
        _m.extractRotation(pm)
        _qParentInverse.setFromRotationMatrix(_m).invert()
        // Math.sqrt is inlined by the JIT; Math.hypot is not and boxes its result on every call.
        const sx = pm.elements[0], sy = pm.elements[1], sz = pm.elements[2]
        parentScale = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1
        lastParent = p
        if (b.stale && !b.warned && handedness(pm.elements) < 0) {
          b.warned = true
          console.warn(`[billboards] "${o.name || o.type}" sits under a mirrored (negative-scale) parent: its text will read mirrored. Un-mirror the frame.`)
        }
      }
      const frame = p ? parentScale : 1
      // The scale the object gets this tick (and the world scale that makes), before the frustum test needs it.
      const sc = b.scale
      let local = o.scale.x
      if (sc) {
        if (sc.base === 0) sc.base = o.scale.x
        if (sc.base > 0) {
          let k = Math.sqrt(d2) / sc.ref
          if (k < sc.min) k = sc.min; else if (k > sc.max) k = sc.max
          local = sc.base * k / (sc.compensate ? frame : 1)
        }
      }
      if (b.cull > 0) {
        _sphere.center.copy(_pos)
        _sphere.radius = b.cull * local * frame
        if (!_frustum.intersectsSphere(_sphere)) { b.stale = true; continue }
      }
      b.stale = false
      if (b.mode !== 'sprite') {
        if (b.mode === 'spherical') {
          _qWorld.copy(_qCam)
        } else {
          _qWorld.setFromAxisAngle(Y_AXIS, Math.atan2(dx, dz))
          let pitch = b.lean
          if (b.pitchFollow > 0) pitch += b.pitchFollow * Math.atan2(dy, Math.sqrt(dx * dx + dz * dz))
          if (pitch > b.maxPitch) pitch = b.maxPitch
          if (pitch !== 0) _qWorld.multiply(_qLean.setFromAxisAngle(X_AXIS, -pitch))
        }
        if (p) o.quaternion.copy(_qParentInverse).multiply(_qWorld)
        else o.quaternion.copy(_qWorld)
      }
      if (sc && sc.base > 0) o.scale.setScalar(local)
    }
  }
}
