/* ============================================================
   THE ACCENT, FROM ONE COLOUR

   The site has one signal colour — links that answer, the chapter
   numbers, the closing answer, the scrub's fill — and the editor
   chooses it (Site look → Accent colour, `settings.accent`). Every
   shade the site uses is worked out here from that one value, as
   plain hex, so canvases and WebGL scenes that read the CSS
   variables get a colour they can parse (a color-mix() string is
   not one everywhere):

     accent       the colour as chosen
     soft         lighter, for fills and glows
     deep         darker, for pressed states
     ink          the accent as text on the home room's plaster,
                  darkened until it holds 5:1 on the wall in shade

   and their dark-theme versions, lightened until they read on the
   dark ground. tokens.css carries the default's values, so the
   first paint is right without this; the layout writes these only
   when the editor has chosen another colour.
   ============================================================ */

export const DEFAULT_ACCENT = '#2f6b3f'

/** The ground each shade has to read on (tokens.css). */
const PLASTER_SHADE = '#e2dccf'
const DARK_GROUND = '#131410'

type Rgb = [number, number, number]

const toRgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb
const toHex = (rgb: Rgb) => '#' + rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]

const channel = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
const luminance = (rgb: Rgb) => 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2])
const contrast = (a: Rgb, b: Rgb) => { const la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05) }

/** Steps `rgb` towards `to` until it reaches `ratio` against `ground` (or gives up at the end of the way). */
function until(rgb: Rgb, to: Rgb, ground: Rgb, ratio: number): Rgb {
  let out = rgb
  for (let t = 0; t <= 1 && contrast(out, ground) < ratio; t += 0.04) out = mix(rgb, to, t)
  return out
}

export function isHex(v: unknown): v is string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
}

export interface AccentShades { accent: string; soft: string; deep: string; ink: string }

export function accentPalette(hex: string = DEFAULT_ACCENT): { light: AccentShades; dark: AccentShades } {
  const base = toRgb(isHex(hex) ? hex : DEFAULT_ACCENT)
  const plaster = toRgb(PLASTER_SHADE)
  const ground = toRgb(DARK_GROUND)
  const darkAccent = until(base, WHITE, ground, 6)
  return {
    light: {
      accent: toHex(base),
      soft: toHex(mix(base, WHITE, 0.3)),
      deep: toHex(mix(base, BLACK, 0.3)),
      ink: toHex(until(base, BLACK, plaster, 5)),
    },
    dark: {
      accent: toHex(darkAccent),
      soft: toHex(mix(darkAccent, WHITE, 0.25)),
      deep: toHex(mix(base, WHITE, 0.1)),
      ink: toHex(darkAccent),
    },
  }
}

const block = (s: AccentShades) => `--accent:${s.accent};--accent-soft:${s.soft};--accent-deep:${s.deep};--accent-ink:${s.ink};`

/** The CSS that sets the site's accent shades, or '' for the default (tokens.css already holds it). */
export function accentCss(hex: string | undefined): string {
  if (!isHex(hex) || hex.toLowerCase() === DEFAULT_ACCENT) return ''
  const p = accentPalette(hex)
  return `:root{${block(p.light)}}:root[data-theme='dark']{${block(p.dark)}}`
}
