/* ============================================================
   THE NAME, SET TO FIT

   The opening screen sets the name in capitals as large as the
   stage allows. A browser cannot say how wide a line will be
   before it paints it, so the width is worked out here — on the
   server, from the display face's own advances — and the
   stylesheet turns it into a size (Prelude.module.css). Nothing
   is measured after paint, so nothing jumps.

   The first word has a line of its own and the rest follows on a
   second. A rest much longer than the first word is broken once
   more, at its most even space, rather than shrinking everything
   to the width of one long line.
   ============================================================ */

/** Geist Sans 500 capitals, in ems (measured with the loaded face). */
const ADVANCE: Record<string, number> = {
  A: 0.689, B: 0.688, C: 0.713, D: 0.701, E: 0.609, F: 0.595, G: 0.713, H: 0.716, I: 0.28, J: 0.607, K: 0.656, L: 0.583, M: 0.89,
  N: 0.745, O: 0.751, P: 0.657, Q: 0.745, R: 0.68, S: 0.654, T: 0.568, U: 0.694, V: 0.688, W: 0.968, X: 0.633, Y: 0.594, Z: 0.561,
  0: 0.673, 1: 0.406, 2: 0.63, 3: 0.625, 4: 0.629, 5: 0.641, 6: 0.604, 7: 0.531, 8: 0.624, 9: 0.606,
  ' ': 0.243, '-': 0.418, "'": 0.186, '’': 0.186, '.': 0.213, ',': 0.213, '&': 0.649, Ø: 0.751, Æ: 0.995, Œ: 1.099,
}
/** The name's letter-spacing (Prelude.module.css), in ems. */
const TRACKING = -0.045
/** A capital the table does not know is treated as a wide one; full-width scripts as a full em. */
const UNKNOWN = 0.75
const FULL_WIDTH = 1
/** A line wider than this, in ems, is narrower than the stage only below the mega size. */
const WIDE_REST = 6.5

/** Width of a line of the name, in ems of its font size, as set: in capitals and tracked. */
export function widthEm(line: string): number {
  let width = 0
  for (const ch of line.toUpperCase()) {
    const advance = ADVANCE[ch] ?? ADVANCE[ch.normalize('NFD')[0]] ?? ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? FULL_WIDTH : UNKNOWN)
    width += advance + TRACKING
  }
  return width
}

export interface NameFit {
  lines: string[]
  /** The widest line, in ems, with room for the last line's optical indent. */
  em: number
}

export function fitName(name: string): NameFit {
  const [first = '', ...rest] = name.trim().split(/\s+/)
  const widest = (lines: string[]) => Math.max(...lines.map(widthEm)) + 0.1
  if (rest.length === 0) return { lines: [first], em: widest([first]) }
  const two = { lines: [first, rest.join(' ')], em: widest([first, rest.join(' ')]) }
  let three: NameFit | null = null
  for (let i = 1; i < rest.length; i++) {
    const lines = [first, rest.slice(0, i).join(' '), rest.slice(i).join(' ')]
    const em = widest(lines)
    if (!three || em < three.em) three = { lines, em }
  }
  // A third line costs height, so it has to buy a clearly larger size —
  // and only a rest too wide for the mega size (about 6.5em, on a
  // laptop as on a phone) has a size to gain at all.
  return three && two.em > WIDE_REST && three.em < two.em * 0.8 ? three : two
}
