/* ============================================================
   COMPOSITIONS
   The room is not one picture cropped to every screen. Each
   layout class gets its own hall and its own lens, chosen so the
   calm stretch of plaster between two pilasters lands where that
   layout sets its copy, and the dense
   things (the pilasters, the floor's perspective, the cornice and
   the corners where growth gathers) land in the margins it leaves.

   Every class is the same kind of hall: a central bay framed by a
   pair of fluted pilasters, with side bays running on past them to
   distant corners. The side walls stay far enough out that they
   never box the light in (a narrow room lit from above is a well,
   and looks like one).

   The camera is fitted, not placed. A composition names where the
   wall's foot and the entablature's soffit should sit on screen,
   how far back the lens stands, and how much of the wall must stay
   in view either side; the field of view and the vertical lens
   shift follow from those. Verticals stay vertical (the lens
   shifts instead of tilting), as in an architectural photograph.
   Within a class nothing is rebuilt on resize — only the lens
   refits — so the plants never move.
   ============================================================ */

export type WallId = 'left' | 'back' | 'right'

export interface PilasterPlan {
  wall: WallId
  /** Centre along the wall, metres from its left end (seen from inside). */
  u: number
  width: number
  projection: number
  flutes: number
}

export interface NichePlan {
  wall: WallId
  u: number
  width: number
  /** Sill height above the floor. */
  sill: number
  /** Springing height of the arch. */
  spring: number
  depth: number
}

export interface PanelPlan {
  wall: WallId
  u0: number
  u1: number
  v0: number
  v1: number
  recess: number
}

export interface RoomPlan {
  width: number
  depth: number
  height: number
  pilasters: PilasterPlan[]
  niches: NichePlan[]
  panels: PanelPlan[]
  /** Floor slab module (square), metres. */
  slab: number
  /** Half the distance between the two framing pilasters' centres. */
  bay: number
  /** Half the pilasters' width. */
  half: number
  /** Leaf and stem scale for this frame: a phone frames the same ivy
      closer, so its leaves are drawn finer to sit in the margins. */
  foliage: number
}

export interface CameraPlan {
  /** Distance from the back wall, metres. */
  distance: number
  /** Eye height, metres. */
  eye: number
  /** Default screen position (0 top … 1 bottom) of the architrave's
      soffit; replaced at run time by one measured from the HUD. */
  soffitY: number
  /** The wall's foot may land anywhere in this band. */
  floorMin: number
  floorMax: number
  /** Where the framing pilasters' inner edges sit, as a fraction of
      the width in from each side. Small enough to stay in the copy's
      gutter on every screen: the pilasters frame the page like a
      proscenium and never put a shadowed face behind a label. */
  inset: number
}

export type CompositionId = 'wide' | 'desktop' | 'tablet' | 'portrait' | 'short'

export interface Composition {
  id: CompositionId
  plan: RoomPlan
  camera: CameraPlan
}

interface HallOptions {
  foliage?: number
  bay: number
  pilaster: number
  flutes: number
  side: number
  niches: boolean
  slab: number
}

/** A symmetric hall: side bay | pilaster | central bay | pilaster | side bay. */
function hall(o: HallOptions): RoomPlan {
  const W = 2 * (o.bay + o.pilaster / 2 + o.side)
  const c = W / 2
  const pil = (x: number): PilasterPlan => ({ wall: 'back', u: c + x, width: o.pilaster, projection: 0.12, flutes: o.flutes })
  // A framed panel would be the obvious ornament for the central bay,
  // but its mouldings are long lines straight across the wall, and on
  // a page whose copy moves round the whole screen chapter by chapter
  // there is no place for them that never runs through a line of
  // text. The central bay is left as one calm, evenly lit expanse of
  // lime plaster. (The builder still makes panels, for a bay the copy
  // never reaches.)
  const panels: PanelPlan[] = []
  const niches: NichePlan[] = []
  if (o.niches) {
    const sx = o.bay + o.pilaster / 2 + o.side / 2
    for (const s of [-1, 1]) niches.push({ wall: 'back', u: c + s * sx, width: Math.min(1.25, o.side * 0.58), sill: 0.92, spring: 2.85, depth: 0.42 })
  }
  return {
    width: W,
    depth: 14,
    height: 5.4,
    slab: o.slab,
    bay: o.bay,
    half: o.pilaster / 2,
    foliage: o.foliage ?? 1,
    pilasters: [pil(-o.bay), pil(o.bay)],
    niches,
    panels,
  }
}

/* Bays are sized so that, at each class's typical shape, the
   pilasters' inner edges land at `inset` with the wall's foot near the
   middle of its band; the lens then holds that framing across the
   class (see camera.ts). */

/** Wide desktop, 16:9 and wider. */
const wide: Composition = {
  id: 'wide',
  plan: hall({ bay: 5.54, pilaster: 0.56, flutes: 7, side: 2.8, niches: true, slab: 0.8 }),
  camera: { distance: 10.8, eye: 1.62, soffitY: 0.07, floorMin: 0.76, floorMax: 0.9, inset: 0.03 },
}

/** Standard desktop and laptop, roughly 6:5 to 16:10. */
const desktop: Composition = {
  id: 'desktop',
  plan: hall({ bay: 5.06, pilaster: 0.56, flutes: 7, side: 2.6, niches: true, slab: 0.8 }),
  camera: { distance: 10.2, eye: 1.62, soffitY: 0.07, floorMin: 0.7, floorMax: 0.9, inset: 0.03 },
}

/** Tablets, either way up. */
const tablet: Composition = {
  id: 'tablet',
  plan: hall({ foliage: 0.8, bay: 2.44, pilaster: 0.5, flutes: 7, side: 2.4, niches: true, slab: 0.7 }),
  camera: { distance: 9.2, eye: 1.6, soffitY: 0.07, floorMin: 0.76, floorMax: 0.9, inset: 0.03 },
}

/** Phone portrait. */
const portrait: Composition = {
  id: 'portrait',
  plan: hall({ foliage: 0.62, bay: 1.51, pilaster: 0.4, flutes: 5, side: 2.0, niches: true, slab: 0.62 }),
  // The band reaches down to 0.975: on the narrowest phones the copy's
  // low rows run unbroken to the HUD, and the wall's foot is better
  // dropped below them than drawn through them.
  camera: { distance: 7.6, eye: 1.55, soffitY: 0.07, floorMin: 0.8, floorMax: 0.975, inset: 0.03 },
}

/** Short landscape (a phone on its side). */
const short: Composition = {
  id: 'short',
  plan: hall({ foliage: 0.78, bay: 6.27, pilaster: 0.56, flutes: 7, side: 2.8, niches: true, slab: 0.8 }),
  camera: { distance: 10.8, eye: 1.62, soffitY: 0.09, floorMin: 0.82, floorMax: 0.94, inset: 0.025 },
}

export const COMPOSITIONS: Record<CompositionId, Composition> = { wide, desktop, tablet, portrait, short }

/** The layout class for a viewport, by shape first and size second. */
export function compositionFor(width: number, height: number): Composition {
  const aspect = width / Math.max(1, height)
  if (height < 520 && aspect > 1.3) return short
  if (aspect >= 1.72) return wide
  if (aspect >= 1.2) return desktop
  if (aspect >= 0.66) return tablet
  return portrait
}
