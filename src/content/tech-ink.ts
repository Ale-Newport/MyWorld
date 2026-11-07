import { techLogos, type TechLogo } from './tech-logos'

/* ============================================================
   A BRAND COLOUR THE WALL CAN READ
   The same rule scripts/gen-tech-logos.mjs applies to the marks
   that shipped, for a mark chosen in the editor: a brand colour
   is darkened along its own hue until it clears 3:1 on white,
   the WCAG bar for a graphical object, so a pale mark is still
   a mark. The brand's own value is kept beside it.
   ============================================================ */

const MIN_CONTRAST = 3

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = ([r, g, b]: number[]) => 0.2126 * srgb(r / 255) + 0.7152 * srgb(g / 255) + 0.0722 * srgb(b / 255)
const contrastOnWhite = (rgb: number[]) => 1.05 / (luminance(rgb) + 0.05)
const toRgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

export function legibleInk(hex: string): string {
  let rgb = toRgb(hex)
  for (let i = 0; i < 40 && contrastOnWhite(rgb) < MIN_CONTRAST; i++) rgb = rgb.map((v) => v * 0.94)
  return toHex(rgb)
}

/** A technology's mark: the one chosen in the editor, else the one that shipped for its id, else none (a house glyph). */
export function logoOf(node: { id: string; logo?: { title: string; hex: string; path: string } }): TechLogo | undefined {
  if (node.logo) return { ...node.logo, ink: legibleInk(node.logo.hex) }
  return techLogos[node.id]
}
