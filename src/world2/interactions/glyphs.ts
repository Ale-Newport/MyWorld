import * as THREE from 'three'
import glyphData from '../content/glyphs.json'

/* ============================================================
   REAL LETTERS, CUT FROM THE PORTFOLIO'S OWN TYPEFACE

   `scripts/gen-title-glyphs.mjs` reads Geist Bold — the typeface
   this site already ships, under the SIL Open Font License — and
   writes every contour we need to `content/glyphs.json`. This
   file turns one of those glyphs into geometry.

   It lives apart from `Title.ts` because the name on the beach is
   no longer the only place in the world that needs a real letter:
   the social plaza's centrepiece is the same monogram the car
   wears on its door, and it should be cut the same way.
   ============================================================ */

export interface Glyph { advance: number; contours: (string | number)[][][] }
interface GlyphFile { unitsPerEm: number; spaceAdvance: number; glyphs: Record<string, Glyph> }

export const FONT = glyphData as unknown as GlyphFile

/** Geist's cap height, in font units. Every size here is a multiple of it. */
export const CAP_UNITS = 710

/** TrueType contours to a Shape, with the clockwise ones cut out as counters. */
export function glyphShapes(glyph: Glyph): THREE.Shape[] {
  const paths: { path: THREE.Path; area: number }[] = []
  for (const contour of glyph.contours) {
    const path = new THREE.Path()
    let area = 0
    let previous: [number, number] | null = null
    for (const command of contour) {
      const [kind, ...numbers] = command as [string, ...number[]]
      if (kind === 'M') { path.moveTo(numbers[0], numbers[1]); previous = [numbers[0], numbers[1]] }
      else if (kind === 'L') {
        path.lineTo(numbers[0], numbers[1])
        if (previous) area += previous[0] * numbers[1] - numbers[0] * previous[1]
        previous = [numbers[0], numbers[1]]
      } else if (kind === 'Q') {
        path.quadraticCurveTo(numbers[0], numbers[1], numbers[2], numbers[3])
        if (previous) area += previous[0] * numbers[3] - numbers[2] * previous[1]
        previous = [numbers[2], numbers[3]]
      }
    }
    paths.push({ path, area })
  }
  // TrueType winds OUTER contours clockwise (negative shoelace area) and its
  // counters the other way — the opposite of PostScript, and the trap that
  // turns an O into just its hole. Sort by magnitude and take the largest as
  // the body; everything left inside it is a counter.
  if (!paths.length) return []
  const sorted = [...paths].sort((a, b) => Math.abs(b.area) - Math.abs(a.area))
  const shape = new THREE.Shape(sorted[0].path.getPoints(24))
  for (const inner of sorted.slice(1)) shape.holes.push(new THREE.Path(inner.path.getPoints(24)))
  return [shape]
}

export interface CutGlyph {
  char: string
  geometry: THREE.BufferGeometry
  /** The glyph's own box AFTER re-origining, in metres. */
  box: THREE.Box3
  /** Pen advance for this glyph, in metres, tracking excluded. */
  advance: number
  /** Left sidebearing, in metres: pen position plus this is the mesh origin. */
  bearing: number
}

/**
 * One glyph, extruded and re-origined on its own bounding box — which is what
 * upstream's baked letters are, and what a cuboid collider needs to be true.
 */
export function cutGlyph(char: string, capHeight: number, depth: number): CutGlyph | null {
  const glyph = FONT.glyphs[char]
  if (!glyph) return null
  const shapes = glyphShapes(glyph)
  if (!shapes.length) return null
  const unit = capHeight / CAP_UNITS
  const geometry = new THREE.ExtrudeGeometry(shapes, { depth: depth / unit, bevelEnabled: false, curveSegments: 6 })
  geometry.scale(unit, unit, unit)
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!.clone()
  const middle = box.getCenter(new THREE.Vector3())
  geometry.translate(-middle.x, -middle.y, -middle.z)
  return { char, geometry, box, advance: glyph.advance * unit, bearing: middle.x }
}

/** Repoints every UV at one texel, the way the level's flat-colour palette works. */
export function paintUv(geometry: THREE.BufferGeometry, uv: THREE.Vector2): void {
  const attribute = geometry.getAttribute('uv')
  if (!attribute) return
  for (let i = 0; i < attribute.count; i++) attribute.setXY(i, uv.x, uv.y)
  attribute.needsUpdate = true
}
