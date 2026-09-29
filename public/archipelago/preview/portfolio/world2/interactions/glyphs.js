import * as THREE from 'three';
import glyphData from '../content/glyphs.js';
export const FONT = glyphData;
/** Geist's cap height, in font units. Every size here is a multiple of it. */
export const CAP_UNITS = 710;
/** TrueType contours to a Shape, with the clockwise ones cut out as counters. */
export function glyphShapes(glyph) {
    const paths = [];
    for (const contour of glyph.contours) {
        const path = new THREE.Path();
        let area = 0;
        let previous = null;
        for (const command of contour) {
            const [kind, ...numbers] = command;
            if (kind === 'M') {
                path.moveTo(numbers[0], numbers[1]);
                previous = [numbers[0], numbers[1]];
            }
            else if (kind === 'L') {
                path.lineTo(numbers[0], numbers[1]);
                if (previous)
                    area += previous[0] * numbers[1] - numbers[0] * previous[1];
                previous = [numbers[0], numbers[1]];
            }
            else if (kind === 'Q') {
                path.quadraticCurveTo(numbers[0], numbers[1], numbers[2], numbers[3]);
                if (previous)
                    area += previous[0] * numbers[3] - numbers[2] * previous[1];
                previous = [numbers[2], numbers[3]];
            }
        }
        paths.push({ path, area });
    }
    // TrueType winds OUTER contours clockwise (negative shoelace area) and its
    // counters the other way — the opposite of PostScript, and the trap that
    // turns an O into just its hole. Sort by magnitude and take the largest as
    // the body; everything left inside it is a counter.
    if (!paths.length)
        return [];
    const sorted = [...paths].sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const shape = new THREE.Shape(sorted[0].path.getPoints(24));
    for (const inner of sorted.slice(1))
        shape.holes.push(new THREE.Path(inner.path.getPoints(24)));
    return [shape];
}
/**
 * One glyph, extruded and re-origined on its own bounding box — which is what
 * upstream's baked letters are, and what a cuboid collider needs to be true.
 */
export function cutGlyph(char, capHeight, depth) {
    const glyph = FONT.glyphs[char];
    if (!glyph)
        return null;
    const shapes = glyphShapes(glyph);
    if (!shapes.length)
        return null;
    const unit = capHeight / CAP_UNITS;
    const geometry = new THREE.ExtrudeGeometry(shapes, { depth: depth / unit, bevelEnabled: false, curveSegments: 6 });
    geometry.scale(unit, unit, unit);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox.clone();
    const middle = box.getCenter(new THREE.Vector3());
    geometry.translate(-middle.x, -middle.y, -middle.z);
    return { char, geometry, box, advance: glyph.advance * unit, bearing: middle.x };
}
/** Repoints every UV at one texel, the way the level's flat-colour palette works. */
export function paintUv(geometry, uv) {
    const attribute = geometry.getAttribute('uv');
    if (!attribute)
        return;
    for (let i = 0; i < attribute.count; i++)
        attribute.setXY(i, uv.x, uv.y);
    attribute.needsUpdate = true;
}
