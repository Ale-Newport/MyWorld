/* ============================================================
   HOW WIDE A LINE OF CAPITALS IS, BEFORE IT IS PAINTED

   The display type is set in capitals at sizes where one line too
   many breaks a composition. A browser cannot say how wide a line
   will be before it paints it, so the width is worked out from the
   face's own advances (Geist Sans 500, measured once in ems with
   the loaded face) and the stylesheet turns it into a size that
   fits: nothing is measured after paint, so nothing jumps.
   ============================================================ */

const ADVANCE: Record<string, number> = {
  A: 0.689, B: 0.688, C: 0.713, D: 0.701, E: 0.609, F: 0.595, G: 0.713, H: 0.716, I: 0.28, J: 0.607, K: 0.656, L: 0.583, M: 0.89,
  N: 0.745, O: 0.751, P: 0.657, Q: 0.745, R: 0.68, S: 0.654, T: 0.568, U: 0.694, V: 0.688, W: 0.968, X: 0.633, Y: 0.594, Z: 0.561,
  0: 0.673, 1: 0.406, 2: 0.63, 3: 0.625, 4: 0.629, 5: 0.641, 6: 0.604, 7: 0.531, 8: 0.624, 9: 0.606,
  ' ': 0.243, '-': 0.418, "'": 0.186, '’': 0.186, '.': 0.213, ',': 0.213, '&': 0.649, Ø: 0.751, Æ: 0.995, Œ: 1.099,
}
/** A capital the table does not know is treated as a wide one; full-width scripts as a full em. */
const UNKNOWN = 0.75
const FULL_WIDTH = 1

/** Width of a line set in Geist 500 capitals, in ems of its font size, with `tracking` (em) after every character. */
export function capitalsWidthEm(line: string, tracking: number): number {
  let width = 0
  for (const ch of line.toUpperCase()) {
    const advance = ADVANCE[ch] ?? ADVANCE[ch.normalize('NFD')[0]] ?? ((ch.codePointAt(0) ?? 0) >= 0x2e80 ? FULL_WIDTH : UNKNOWN)
    width += advance + tracking
  }
  return width
}

/** The widest single word of `text`, in ems: the narrowest a wrapping line can be. */
export function widestWordEm(text: string, tracking: number): number {
  return Math.max(0, ...text.split(/\s+/).filter(Boolean).map((w) => capitalsWidthEm(w, tracking)))
}
