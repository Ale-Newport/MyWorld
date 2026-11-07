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

/* ---- at night ------------------------------------------------
   On the dark theme's plate the same rule runs the other way: the
   brand colour is LIFTED along its own hue — OKLab lightness up,
   its chroma kept as far as sRGB allows — until it clears 3:1 on
   the plate, so a deep navy stays a blue rather than greying out.
   A mark with no hue of its own (the black of Next.js, Three.js,
   Express…) takes the page's own ink instead, as those marks do on
   any dark page. Measured against the lightest plate a tile shows
   at night (--bg-tertiary: hovered, pinned), so every state holds.
   ------------------------------------------------------------- */

const NIGHT_PLATE = [35, 36, 29]
const linear = (c: number) => srgb(c / 255)
const encode = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)
const contrast = (a: number[], b: number[]) => {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

function toOklab(rgb: number[]): [number, number, number] {
  const [r, g, b] = rgb.map(linear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}

/** OKLab back to 0–255 sRGB, giving up chroma (never lightness) until the colour is inside the gamut. */
function fromOklab(L: number, a: number, b: number): number[] {
  for (let i = 0; ; i++) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    if (i >= 40 || lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) return lin.map((v) => encode(Math.min(1, Math.max(0, v))))
    a *= 0.95
    b *= 0.95
  }
}

const night = new Map<string, string>()

/** A brand colour as it is set on the night plate: an sRGB hex, or the page's ink for a mark with no hue. */
export function nightInk(hex: string): string {
  const known = night.get(hex)
  if (known) return known
  let rgb = toRgb(hex)
  const [L, a, b] = toOklab(rgb)
  let out = 'var(--text-primary)'
  if (Math.hypot(a, b) >= 0.03) {
    for (let k = L; k < 1 && contrast(rgb, NIGHT_PLATE) < MIN_CONTRAST; ) {
      k += 0.01
      rgb = fromOklab(k, a, b)
    }
    out = toHex(rgb)
  }
  night.set(hex, out)
  return out
}

/** A technology's mark: the one chosen in the editor, else the one that shipped for its id, else none (a house glyph). */
export function logoOf(node: { id: string; logo?: { title: string; hex: string; path: string } }): TechLogo | undefined {
  if (node.logo) return { ...node.logo, ink: legibleInk(node.logo.hex) }
  return techLogos[node.id]
}
