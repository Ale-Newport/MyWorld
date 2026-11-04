/* The typefaces the admin (Settings → Appearance → Typeface) can give the whole public site: Space Grotesk
   (the one it wears), four free grotesques close to the paid ones the design looked at, and Geist, the
   type it had before. Only the choice is stored in the site document; this file is the one place that knows
   what each choice means, and styles/fonts.ts is where the font files are declared. */
export const TYPEFACES = ['grotesk', 'inter-tight', 'hanken', 'instrument', 'schibsted', 'geist'] as const
export type Typeface = (typeof TYPEFACES)[number]
export const DEFAULT_TYPEFACE: Typeface = 'grotesk'

const FALLBACK = "'Helvetica Neue', Helvetica, Arial, sans-serif"
const stack = (variable: string) => `var(${variable}), ${FALLBACK}`

export const TYPEFACE_INFO: Record<Typeface, { label: string; note: string; display: string; mono: string }> = {
  grotesk: { label: 'Space Grotesk', note: 'The site’s typeface. Open licence.', display: stack('--tf-grotesk'), mono: stack('--tf-grotesk') },
  'inter-tight': { label: 'Inter Tight', note: 'A free grotesque close to Akzidenz-Grotesk: neutral, compact. Open licence.', display: stack('--tf-inter-tight'), mono: stack('--tf-inter-tight') },
  hanken: { label: 'Hanken Grotesk', note: 'A free grotesque close to Neue Montreal: warm, geometric. Open licence.', display: stack('--tf-hanken'), mono: stack('--tf-hanken') },
  instrument: { label: 'Instrument Sans', note: 'A free grotesque with a crisp, editorial feel. Open licence.', display: stack('--tf-instrument'), mono: stack('--tf-instrument') },
  schibsted: { label: 'Schibsted Grotesk', note: 'A free grotesque with a sturdier, newspaper character. Open licence.', display: stack('--tf-schibsted'), mono: stack('--tf-schibsted') },
  geist: { label: 'Geist', note: 'The type the site had before. Open licence.', display: `var(--font-geist-sans), ${FALLBACK}`, mono: "var(--font-geist-mono), ui-monospace, 'SF Mono', Menlo, monospace" },
}

export function isTypeface(v: unknown): v is Typeface {
  return typeof v === 'string' && (TYPEFACES as readonly string[]).includes(v)
}

/** A stored value as a typeface: a site saved before the setting existed, one that chose a face that has since been retired, or a
    hand-edited one has no valid value, and wears the default. */
export function resolveTypeface(v: unknown): Typeface {
  return isTypeface(v) ? v : DEFAULT_TYPEFACE
}

/** The declaration block that applies a typeface to the whole site; empty for the default, which tokens.css already holds. */
export function typefaceCss(value: unknown): string {
  const face = resolveTypeface(value)
  if (face === DEFAULT_TYPEFACE) return ''
  const t = TYPEFACE_INFO[face]
  return `:root{--font-display:${t.display};--font-mono:${t.mono}}`
}
