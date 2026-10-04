/* Extract real glyph outlines from a TrueType file.
 *
 * The physical title is cut from a typeface, not assembled from boxes, so the
 * runtime needs actual contours: `glyf` outlines with their quadratic curves
 * intact, in font units, plus the advance width that spaces them. Everything
 * downstream (cap height, extrusion depth, kerning) is derived at runtime from
 * the authored Blender letters, so nothing here is portfolio-specific.
 *
 * Run: node scripts/gen-title-glyphs.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = 'node_modules/geist/dist/fonts/geist-sans/Geist-Bold.ttf'
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.&-'

class Reader {
  constructor(view, offset = 0) { this.v = view; this.o = offset }
  u8() { return this.v.getUint8(this.o++) }
  i8() { return this.v.getInt8(this.o++) }
  u16() { const n = this.v.getUint16(this.o); this.o += 2; return n }
  i16() { const n = this.v.getInt16(this.o); this.o += 2; return n }
  u32() { const n = this.v.getUint32(this.o); this.o += 4; return n }
  tag() { return String.fromCharCode(this.u8(), this.u8(), this.u8(), this.u8()) }
}

function tables(view) {
  const r = new Reader(view)
  const version = r.u32()
  if (version === 0x74746366) throw new Error('TrueType collections are not supported')
  const count = r.u16()
  r.o += 6
  const map = {}
  for (let i = 0; i < count; i++) { const tag = r.tag(); r.u32(); map[tag] = { offset: r.u32(), length: r.u32() } }
  return map
}

/** cmap format 4 and 12 cover every codepoint this title can contain. */
function readCmap(view, offset) {
  const r = new Reader(view, offset)
  r.u16()
  const count = r.u16()
  let best = null
  for (let i = 0; i < count; i++) {
    const platform = r.u16(), encoding = r.u16(), sub = r.u32()
    const score = platform === 3 && encoding === 10 ? 4 : platform === 3 && encoding === 1 ? 3 : platform === 0 ? 2 : 1
    if (!best || score > best.score) best = { score, offset: offset + sub }
  }
  if (!best) throw new Error('No usable cmap subtable')
  const s = new Reader(view, best.offset)
  const format = s.u16()
  const map = new Map()
  if (format === 4) {
    s.u16(); s.u16()
    const segX2 = s.u16()
    const segments = segX2 / 2
    s.o += 6
    const end = [], start = [], delta = [], rangeOffsetAt = [], rangeOffset = []
    for (let i = 0; i < segments; i++) end.push(s.u16())
    s.u16()
    for (let i = 0; i < segments; i++) start.push(s.u16())
    for (let i = 0; i < segments; i++) delta.push(s.i16())
    for (let i = 0; i < segments; i++) { rangeOffsetAt.push(s.o); rangeOffset.push(s.u16()) }
    for (let i = 0; i < segments; i++) {
      for (let code = start[i]; code <= end[i] && code !== 0xffff; code++) {
        let glyph
        if (rangeOffset[i] === 0) glyph = (code + delta[i]) & 0xffff
        else {
          const at = rangeOffsetAt[i] + rangeOffset[i] + (code - start[i]) * 2
          glyph = view.getUint16(at)
          if (glyph !== 0) glyph = (glyph + delta[i]) & 0xffff
        }
        if (glyph) map.set(code, glyph)
      }
    }
  } else if (format === 12) {
    s.u16(); s.u32(); s.u32()
    const groups = s.u32()
    for (let i = 0; i < groups; i++) {
      const first = s.u32(), last = s.u32(), glyph = s.u32()
      for (let code = first; code <= last; code++) map.set(code, glyph + (code - first))
    }
  } else throw new Error(`Unsupported cmap format ${format}`)
  return map
}

/** Raw TrueType points for one glyph index; composites are flattened. */
function glyphPoints(view, glyf, loca, index, depth = 0) {
  if (depth > 4) throw new Error('Composite glyph nested too deeply')
  const from = loca[index], to = loca[index + 1]
  if (from === to) return []
  const r = new Reader(view, glyf + from)
  const contourCount = r.i16()
  r.o += 8
  if (contourCount < 0) {
    // Composite: accumulate each component under its own 2x2 transform.
    const contours = []
    for (;;) {
      const flags = r.u16(), glyphIndex = r.u16()
      let dx, dy
      if (flags & 1) { dx = r.i16(); dy = r.i16() } else { dx = r.i8(); dy = r.i8() }
      let a = 1, b = 0, c = 0, d = 1
      const f2 = () => r.i16() / 16384
      if (flags & 8) { a = d = f2() }
      else if (flags & 0x40) { a = f2(); d = f2() }
      else if (flags & 0x80) { a = f2(); b = f2(); c = f2(); d = f2() }
      for (const contour of glyphPoints(view, glyf, loca, glyphIndex, depth + 1)) {
        contours.push(contour.map(p => ({ x: a * p.x + c * p.y + dx, y: b * p.x + d * p.y + dy, on: p.on })))
      }
      if (!(flags & 0x20)) break
    }
    return contours
  }
  const ends = []
  for (let i = 0; i < contourCount; i++) ends.push(r.u16())
  // `r.o += r.u16()` would read r.o before the reader advanced it.
  const instructions = r.u16()
  r.o += instructions
  const total = ends[ends.length - 1] + 1
  const flags = []
  while (flags.length < total) {
    const flag = r.u8()
    flags.push(flag)
    if (flag & 8) { let repeat = r.u8(); while (repeat-- > 0) flags.push(flag) }
  }
  const xs = [], ys = []
  let value = 0
  for (const flag of flags) {
    if (flag & 2) { const d = r.u8(); value += (flag & 16) ? d : -d }
    else if (!(flag & 16)) value += r.i16()
    xs.push(value)
  }
  value = 0
  for (const flag of flags) {
    if (flag & 4) { const d = r.u8(); value += (flag & 32) ? d : -d }
    else if (!(flag & 32)) value += r.i16()
    ys.push(value)
  }
  const contours = []
  let start = 0
  for (const end of ends) {
    const points = []
    for (let i = start; i <= end; i++) points.push({ x: xs[i], y: ys[i], on: !!(flags[i] & 1) })
    if (points.length) contours.push(points)
    start = end + 1
  }
  return contours
}

/** TrueType points to path commands, inserting the implied on-curve midpoints. */
function commands(contours) {
  const paths = []
  for (const points of contours) {
    if (points.length < 2) continue
    let ordered = points
    if (!points[0].on) {
      const last = points[points.length - 1]
      if (last.on) ordered = [last, ...points.slice(0, -1)]
      else ordered = [{ x: (points[0].x + last.x) / 2, y: (points[0].y + last.y) / 2, on: true }, ...points]
    }
    const path = [['M', ordered[0].x, ordered[0].y]]
    let control = null
    for (let i = 1; i <= ordered.length; i++) {
      const p = ordered[i % ordered.length]
      if (p.on) {
        if (control) { path.push(['Q', control.x, control.y, p.x, p.y]); control = null }
        else path.push(['L', p.x, p.y])
      } else if (control) {
        const mid = { x: (control.x + p.x) / 2, y: (control.y + p.y) / 2 }
        path.push(['Q', control.x, control.y, mid.x, mid.y])
        control = p
      } else control = p
    }
    if (control) path.push(['Q', control.x, control.y, ordered[0].x, ordered[0].y])
    path.push(['Z'])
    paths.push(path)
  }
  return paths
}

const file = readFileSync(join(ROOT, SOURCE))
const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
const map = tables(view)
for (const required of ['head', 'maxp', 'loca', 'glyf', 'cmap', 'hhea', 'hmtx'])
  if (!map[required]) throw new Error(`${SOURCE} has no ${required} table`)

const head = new Reader(view, map.head.offset)
head.o += 18
const unitsPerEm = head.u16()
head.o = map.head.offset + 50
const longLoca = head.i16() === 1

const maxp = new Reader(view, map.maxp.offset + 4)
const glyphCount = maxp.u16()

const loca = []
for (let i = 0; i <= glyphCount; i++)
  loca.push(longLoca ? view.getUint32(map.loca.offset + i * 4) : view.getUint16(map.loca.offset + i * 2) * 2)

const hhea = new Reader(view, map.hhea.offset + 34)
const hmtxCount = hhea.u16()
const advanceOf = index => view.getUint16(map.hmtx.offset + Math.min(index, hmtxCount - 1) * 4)

const cmap = readCmap(view, map.cmap.offset)
const glyphs = {}
for (const char of CHARS) {
  const index = cmap.get(char.codePointAt(0))
  if (!index) throw new Error(`${SOURCE} has no glyph for ${char}`)
  const contours = commands(glyphPoints(view, map.glyf.offset, loca, index))
  if (!contours.length) throw new Error(`${SOURCE} glyph for ${char} is empty`)
  glyphs[char] = { advance: advanceOf(index), contours }
}
const space = cmap.get(32)
const payload = {
  source: SOURCE,
  family: 'Geist Bold',
  licence: 'SIL Open Font License 1.1',
  unitsPerEm,
  spaceAdvance: space ? advanceOf(space) : Math.round(unitsPerEm * 0.28),
  glyphs,
}
const out = join(ROOT, 'src/world2/content/glyphs.json')
writeFileSync(out, JSON.stringify(payload))
const points = Object.values(glyphs).reduce((n, g) => n + g.contours.reduce((m, c) => m + c.length, 0), 0)
console.log(`${out}: ${Object.keys(glyphs).length} glyphs, ${points} commands, unitsPerEm ${unitsPerEm}, ${(JSON.stringify(payload).length / 1024).toFixed(1)} kB`)
