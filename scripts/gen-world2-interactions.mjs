/* Recover the Blender references the level export deliberately leaves out.
 *
 * `scripts/export-world2-blender.py` drops query-only and render-hidden
 * objects from the GLB: race gates carry no geometry, the projects board's
 * hit targets are invisible planes, and the career text planes are hidden
 * because their material is generated at runtime. Gameplay still needs their
 * transforms, and the .blend remains the only source for them.
 *
 * This reads the audit JSON that the Blender pass already writes from the
 * .blend, so it needs no Blender install and stays reproducible.
 *
 * Run: node scripts/gen-world2-interactions.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const AUDIT = join(ROOT, 'world2-blender-audit.json')
const OUT = join(ROOT, 'public/world2/interactions.json')

/** Blender Z-up to glTF Y-up, matching the exporter's own basis change. */
const B = [[1, 0, 0, 0], [0, 0, 1, 0], [0, -1, 0, 0], [0, 0, 0, 1]]
const BI = [[1, 0, 0, 0], [0, 0, -1, 0], [0, 1, 0, 0], [0, 0, 0, 1]]

const multiply = (a, b) => a.map(row => b[0].map((_, c) => row.reduce((sum, v, k) => sum + v * b[k][c], 0)))

/** Position, quaternion and scale of a converted 4x4, in glTF space. */
function decompose(m) {
  const position = [m[0][3], m[1][3], m[2][3]]
  const columns = [0, 1, 2].map(c => [m[0][c], m[1][c], m[2][c]])
  const scale = columns.map(v => Math.hypot(...v))
  // A negative determinant means one axis is mirrored; fold it into X so the
  // remaining basis is a pure rotation and the quaternion stays valid.
  const determinant =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  if (determinant < 0) scale[0] = -scale[0]
  const r = columns.map((v, i) => (scale[i] ? v.map(n => n / scale[i]) : [0, 0, 0]))
  const [m00, m10, m20] = r[0], [m01, m11, m21] = r[1], [m02, m12, m22] = r[2]
  const trace = m00 + m11 + m22
  let q
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]
  }
  const round = n => Number(n.toFixed(6))
  return { position: position.map(round), quaternion: q.map(round), scale: scale.map(round) }
}

const audit = JSON.parse(readFileSync(AUDIT, 'utf8'))
const byName = new Map(audit.objects.map(o => [o.name, o]))
const excluded = audit.export.excluded ?? {}

function transform(name) {
  const object = byName.get(name)
  if (!object) throw new Error(`${name} is not in the Blender audit`)
  return {
    name,
    ...decompose(multiply(multiply(B, object.matrix_world), BI)),
    // Blender reports dimensions XYZ in its own Z-up axes; reorder to match.
    dimensions: [object.dimensions[0], object.dimensions[2], object.dimensions[1]].map(n => Number(n.toFixed(4))),
    inGlb: !(name in excluded),
    properties: Object.fromEntries(Object.entries(object.custom_properties ?? {}).filter(([k]) => k !== 'cycles')),
  }
}

const named = prefix => audit.objects.map(o => o.name).filter(n => n.startsWith(prefix)).sort()

/** Ordered race gates. The numeric suffix IS the lap order upstream drives. */
const checkpoints = named('refCheckpoints.').map(transform)
if (checkpoints.length !== 8) throw new Error(`Expected 8 race gates, found ${checkpoints.length}`)

/** Career text planes: hidden in Blender because the runtime paints them. */
const careerText = ['careerText', ...named('careerText.')].map(transform)

/** Board hit targets: invisible planes upstream raycasts against. */
const intersects = named('refIntersect').map(transform)

const payload = {
  version: 1,
  source: 'folio-2025.blend',
  sourceSha256: audit.export.sourceSha256,
  generator: 'scripts/gen-world2-interactions.mjs',
  note: 'Transforms for Blender references the GLB export omits. glTF Y-up, metres.',
  checkpoints,
  careerText,
  intersects,
  signReference: transform('signReference'),
}

writeFileSync(OUT, JSON.stringify(payload, null, 1))
const count = checkpoints.length + careerText.length + intersects.length + 1
console.log(`${OUT}: ${count} references (${checkpoints.length} gates, ${careerText.length} career planes, ${intersects.length} hit targets)`)
