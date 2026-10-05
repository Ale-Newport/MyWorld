/* ============================================================
   THE NAME, SET TO FIT

   The opening screen sets the name in capitals as large as the
   stage allows. The width of each line is worked out on the
   server from the display face's own advances (typography/
   capitals.ts) and the stylesheet turns it into a size
   (Prelude.module.css). Nothing is measured after paint, so
   nothing jumps.

   The first word has a line of its own and the rest follows on a
   second. A rest much longer than the first word is broken once
   more, at its most even space, rather than shrinking everything
   to the width of one long line.
   ============================================================ */

import { capitalsWidthEm } from '../../typography/capitals.ts'

/** The name's letter-spacing (Prelude.module.css), in ems. */
const TRACKING = -0.045
/** A line wider than this, in ems, is narrower than the stage only below the mega size. */
const WIDE_REST = 6.5

/** Width of a line of the name, in ems of its font size, as set: in capitals and tracked. */
export function widthEm(line: string): number {
  return capitalsWidthEm(line, TRACKING)
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
