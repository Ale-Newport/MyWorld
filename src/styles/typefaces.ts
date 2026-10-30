/* The typefaces the admin (Settings → Appearance → Typeface) can give the whole public site.
   `geist` is what shipped; the other three are grotesques. Only the choice is stored in the
   site document: the CSS here is the single place that knows what each choice means. */
export const TYPEFACES = ['geist', 'akzidenz', 'montreal', 'grotesk'] as const
export type Typeface = (typeof TYPEFACES)[number]
export const DEFAULT_TYPEFACE: Typeface = 'geist'

const FALLBACK = "'Helvetica Neue', Helvetica, Arial, sans-serif"

export const TYPEFACE_INFO: Record<Typeface, { label: string; note: string; stack: string }> = {
  geist: { label: 'Geist', note: 'The original type of the site.', stack: '' },
  akzidenz: {
    label: 'Akzidenz-Grotesk Pro',
    note: 'Commercial (Berthold). Needs its licensed web files in public/fonts/akzidenz-grotesk-pro — see the README there; until then Helvetica Neue shows.',
    stack: `'Akzidenz-Grotesk Pro', 'Akzidenz Grotesk', ${FALLBACK}`,
  },
  montreal: {
    label: 'Neue Montreal',
    note: 'Pangram Pangram. Needs its web files in public/fonts/neue-montreal — see the README there; until then Helvetica Neue shows.',
    stack: `'Neue Montreal', ${FALLBACK}`,
  },
  grotesk: { label: 'Space Grotesk', note: 'Open licence, bundled with the site.', stack: `'Space Grotesk Variable', ${FALLBACK}` },
}

export function isTypeface(v: unknown): v is Typeface {
  return typeof v === 'string' && (TYPEFACES as readonly string[]).includes(v)
}

/** The declaration block that applies a typeface; empty for the default, which tokens.css already holds. */
export function typefaceCss(t: Typeface): string {
  const stack = TYPEFACE_INFO[t].stack
  return stack ? `:root{--font-display:${stack};--font-mono:${stack}}` : ''
}
