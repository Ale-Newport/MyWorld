import * as THREE from 'three'
import type { RoomPlan } from '../scene/compositions'
import type { BuiltArchitecture } from '../scene/architecture'

/* ============================================================
   RELIEF OF THE BACK WALL
   Growth needs to know the surface it is creeping over. This is
   the back wall as a height field: for any point (x across, y up)
   it gives how far the outermost stone stands proud of the wall
   plane there — zero on the plaster, the pilaster's projection on
   its shaft, the swelling envelope of a base or capital, the
   cornice's overhang, the panel's frame. A stem laid along this
   envelope lies ON the architecture: it climbs over a plinth,
   follows the fillet of a base, steps up a pilaster's side.

   Niche openings are holes: nothing can be planted across them
   without support.
   ============================================================ */

export interface ReliefSample {
  z: number
  /** Unit surface normal (approximate on curved mouldings). */
  normal: THREE.Vector3
  /** False inside a niche's opening. */
  solid: boolean
}

export class WallRelief {
  private pil: Array<{ x0: number; x1: number; p: number }>
  private panels: Array<{ x0: number; x1: number; y0: number; y1: number; recess: number }>
  private niches: Array<{ x: number; r: number; sill: number; spring: number }>
  private baseEnv: Float32Array
  private capEnv: Float32Array
  private skirtEnv: Float32Array
  private entEnv: Float32Array
  readonly soffit: number
  readonly shaftTop: number
  readonly width: number

  constructor(plan: RoomPlan, arch: BuiltArchitecture) {
    const W = plan.width
    this.width = W
    this.pil = plan.pilasters.filter((p) => p.wall === 'back').map((p) => ({ x0: p.u - W / 2 - p.width / 2, x1: p.u - W / 2 + p.width / 2, p: p.projection }))
    this.panels = plan.panels.filter((p) => p.wall === 'back').map((p) => ({ x0: p.u0 - W / 2, x1: p.u1 - W / 2, y0: p.v0, y1: p.v1, recess: p.recess }))
    this.niches = plan.niches.filter((n) => n.wall === 'back').map((n) => ({ x: n.u - W / 2, r: n.width / 2, sill: n.sill, spring: n.spring }))
    const { levels, profiles } = arch
    this.soffit = levels.soffit
    this.shaftTop = levels.shaftTop
    // Envelopes sampled every 5 mm, dilated a touch so a stem rests
    // on the mouldings rather than in their hollows.
    const sample = (prof: (h: number) => number, height: number) => {
      const n = Math.ceil(height / 0.005) + 1
      const a = new Float32Array(n)
      for (let i = 0; i < n; i++) a[i] = prof(i * 0.005)
      const b = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let m = 0
        for (let k = -4; k <= 4; k++) m = Math.max(m, a[Math.min(n - 1, Math.max(0, i + k))])
        b[i] = m
      }
      return b
    }
    this.baseEnv = sample((h) => profiles.base.envelope(h), levels.baseHeight)
    this.capEnv = sample((h) => profiles.capital.envelope(h), levels.capitalHeight)
    this.skirtEnv = sample((h) => profiles.skirting.envelope(h), levels.skirting)
    this.entEnv = sample((h) => profiles.entablature.envelope(h), plan.height - levels.soffit)
    this.baseTop = levels.baseHeight
  }

  private baseTop: number

  private env(a: Float32Array, h: number) {
    const i = Math.round(h / 0.005)
    if (i < 0 || i >= a.length) return 0
    return a[i]
  }

  /** Height of the outermost surface at (x, y). */
  height(x: number, y: number): number {
    let z = 0
    if (y >= this.soffit) return this.env(this.entEnv, y - this.soffit)
    if (y < 0.3) z = Math.max(z, this.env(this.skirtEnv, y))
    for (const p of this.panels) {
      if (x > p.x0 && x < p.x1 && y > p.y0 && y < p.y1) {
        const edge = Math.min(x - p.x0, p.x1 - x, y - p.y0, p.y1 - y)
        z = Math.max(z, edge < 0.07 ? 0.016 : -p.recess)
        if (edge >= 0.07) z = -p.recess
      }
    }
    for (const p of this.pil) {
      if (y < this.baseTop) {
        const e = this.env(this.baseEnv, y)
        if (x > p.x0 - e && x < p.x1 + e) z = Math.max(z, p.p + e)
      } else if (y > this.shaftTop) {
        const e = this.env(this.capEnv, y - this.shaftTop)
        if (x > p.x0 - e && x < p.x1 + e) z = Math.max(z, p.p + e)
      } else if (x > p.x0 && x < p.x1) {
        z = Math.max(z, p.p)
      }
    }
    return z
  }

  /** True where there is no wall to cling to (inside a niche). */
  hole(x: number, y: number): boolean {
    for (const n of this.niches) {
      if (Math.abs(x - n.x) < n.r + 0.03 && y > n.sill - 0.02) {
        if (y < n.spring) return true
        if (Math.hypot(x - n.x, y - n.spring) < n.r + 0.03) return true
      }
    }
    return false
  }

  sample(x: number, y: number): ReliefSample {
    const d = 0.012
    const z = this.height(x, y)
    const zx = (this.height(x + d, y) - this.height(x - d, y)) / (2 * d)
    const zy = (this.height(x, y + d) - this.height(x, y - d)) / (2 * d)
    // Discontinuities (a pilaster's side) give huge gradients; cap
    // them so a point on an edge leans rather than turns sideways.
    const gx = Math.max(-1.5, Math.min(1.5, zx))
    const gy = Math.max(-1.5, Math.min(1.5, zy))
    return { z, normal: new THREE.Vector3(-gx, -gy, 1).normalize(), solid: !this.hole(x, y) }
  }

  /**
   * Lays a 2D path (wall coordinates) onto the relief as a 3D
   * centreline lifted by `lift`, inserting the extra points needed
   * to wrap round each step in the surface instead of cutting
   * through the stone.
   */
  lay(path: Array<{ x: number; y: number }>, lift: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = []
    let prev: { x: number; y: number; z: number } | null = null
    for (const p of path) {
      const z = this.height(p.x, p.y)
      if (prev && Math.abs(z - prev.z) > 0.008) {
        // Find the step between prev and p by bisection.
        let a = 0
        let b = 1
        for (let k = 0; k < 18; k++) {
          const m = (a + b) / 2
          const zm = this.height(prev.x + (p.x - prev.x) * m, prev.y + (p.y - prev.y) * m)
          if (Math.abs(zm - prev.z) < Math.abs(zm - z)) a = m
          else b = m
        }
        const ex = prev.x + (p.x - prev.x) * a
        const ey = prev.y + (p.y - prev.y) * a
        // Back the corner points off the step's face by `lift`, on
        // the side of the lower surface.
        const dx = p.x - prev.x
        const dy = p.y - prev.y
        const len = Math.hypot(dx, dy) || 1
        const up = z > prev.z
        const bx = ex - (dx / len) * lift * (up ? 1 : -1)
        const by = ey - (dy / len) * lift * (up ? 1 : -1)
        const zl = Math.min(z, prev.z)
        const zh = Math.max(z, prev.z)
        if (up) {
          out.push(new THREE.Vector3(bx, by, zl + lift))
          out.push(new THREE.Vector3(bx, by, zh + lift))
        } else {
          out.push(new THREE.Vector3(bx, by, zh + lift))
          out.push(new THREE.Vector3(bx, by, zl + lift))
        }
      }
      out.push(new THREE.Vector3(p.x, p.y, z + lift))
      prev = { x: p.x, y: p.y, z }
    }
    return out
  }
}
