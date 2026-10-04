import * as THREE from 'three'
import type { Composition } from '../scene/compositions'

/* ============================================================
   THE LENS
   A fixed camera, square to the back wall, with a vertical lens
   shift instead of a tilt — the way an architectural photographer
   keeps verticals vertical. It is fitted from the composition:

   · the architrave's soffit is pinned just under the HUD's row
     (measured), so the HUD reads off the plain architrave;
   · the framing pilasters' inner edges are pinned just inside the
     screen's edges, in the copy's gutter;
   · the wall's foot then falls where it falls, within a band —
     taller screens of a class see more floor, wider ones less.
   ============================================================ */

export interface Lens {
  /** tan(half vertical field of view). */
  ty: number
  /** tan(half horizontal field of view). */
  tx: number
  /** Vertical shift in NDC units. */
  shift: number
  position: THREE.Vector3
}

/** How far a pilaster's plinth stands out beside its shaft. */
export const PLINTH = 0.08

/** Rows of text (fractions, y down) the wall's foot must keep out
    of: every line set low on any chapter's stage, measured. */
export interface Band {
  rows: Array<[number, number]>
  /** One CSS pixel as a fraction of the height. */
  px: number
}

/** Height of the skirting, metres (its top must clear the band too). */
const SKIRTING = 0.24

export function fitLens(
  comp: Composition, soffit: number, aspect: number,
  soffitOverride?: number, insetOverride?: number, avoid?: Band,
  /** Replaces the composition's band for the wall's foot. */
  floorBand?: readonly [number, number],
): Lens {
  const { distance: Z, eye } = comp.camera
  const [floorMin, floorMax] = floorBand ?? [comp.camera.floorMin, comp.camera.floorMax]
  const soffitY = soffitOverride ?? comp.camera.soffitY
  const inset = insetOverride ?? comp.camera.inset
  // tan(half fov) × distance that pins the pilasters' inner edges —
  // the plinths', which stand furthest in — at `inset` from each side
  // of the screen…
  const inner = comp.plan.bay - comp.plan.half - PLINTH
  let tz = inner / ((1 - 2 * inset) * aspect)
  // …unless that would put the wall's foot outside its band, in which
  // case the band wins and the pilasters drift a little.
  let floorY = soffitY + soffit / (2 * tz)
  // Keep the skirting and the crease at the wall's foot off every
  // low line of copy: of the positions in the band whose skirting
  // falls in a gap between rows, take the one nearest the natural.
  if (avoid && avoid.rows.length) {
    const m = 6 * avoid.px
    // Prefer a gap the whole skirting fits in; failing that, one that
    // at least keeps the dark crease at the wall's foot between rows
    // (the skirting's own face is plain, lit stone).
    const clearAll = (fy: number) => {
      const skirt = SKIRTING / (2 * (soffit / (2 * (fy - soffitY))))
      return avoid.rows.every(([a, b]) => fy + m < a || fy - skirt - m > b)
    }
    const clearCrease = (fy: number) => avoid.rows.every(([a, b]) => fy + m < a || fy - m > b)
    const any = (test: (fy: number) => boolean) => {
      for (let fy = floorY; fy <= floorMax; fy += avoid.px) if (test(fy)) return true
      return false
    }
    const clear = any(clearAll) ? clearAll : clearCrease
    if (!clear(floorY)) {
      // Only downwards: raising the floor would widen the lens and walk
      // the pilasters in from the gutter, onto the very labels the
      // inset keeps them clear of. Lowering it narrows the lens and
      // pushes them further out, which is always safe.
      let best = floorY
      let bestD = Infinity
      for (let fy = floorY; fy <= floorMax; fy += avoid.px) {
        const d = Math.abs(fy - floorY)
        if (d < bestD && clear(fy)) {
          best = fy
          bestD = d
        }
      }
      if (bestD < Infinity) {
        floorY = best
        tz = soffit / (2 * (floorY - soffitY))
      }
    }
  }
  if (floorY > floorMax) tz = soffit / (2 * (floorMax - soffitY))
  else if (floorY < floorMin) tz = soffit / (2 * (floorMin - soffitY))
  const fy = soffitY + soffit / (2 * tz)
  const ty = tz / Z
  const shift = -eye / Z / ty - 1 + 2 * fy
  return { ty, tx: ty * aspect, shift, position: new THREE.Vector3(0, eye, Z) }
}

export function applyLens(camera: THREE.PerspectiveCamera, lens: Lens, aspect: number) {
  const near = 0.1
  const far = 60
  camera.position.copy(lens.position)
  camera.quaternion.identity()
  camera.near = near
  camera.far = far
  camera.aspect = aspect
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(lens.ty))
  const top = near * lens.ty * (1 + lens.shift)
  const bottom = near * lens.ty * (lens.shift - 1)
  const right = near * lens.tx
  camera.projectionMatrix.makePerspective(-right, right, top, bottom, near, far)
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
  camera.updateMatrixWorld(true)
}

/** Screen position (0..1, y down) of a world point. */
export function project(camera: THREE.Camera, p: THREE.Vector3, out = new THREE.Vector2()) {
  const v = p.clone().project(camera)
  return out.set(v.x * 0.5 + 0.5, 0.5 - v.y * 0.5)
}
