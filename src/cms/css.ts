import type { ElementNode, ResponsiveStyle, SiteDocument, StyleProps } from './schema'

/* ============================================================
   ELEMENT STYLES → ONE STYLESHEET

   Visual edits are stored per element and per breakpoint and
   compiled here into a single stylesheet the page ships in its
   HTML, so an edited page paints edited on the first frame.

   Selectors are `:root [data-cms-id="…"][data-cms-id]` — one
   pseudo-class and two attributes — which outranks the site's
   CSS-module rules (one or two classes) without !important.
   Inline styles still win, which is exactly right: the chapters
   animate opacity and transform inline every frame, and an edit
   must never freeze an animation. Moving an element therefore
   writes CSS `translate`, an independent property that adds to
   the animated `transform` instead of replacing it.

   Every value has passed the schema's patterns before it gets
   here; ids are escaped again regardless.
   ============================================================ */

export const BREAKPOINTS = {
  tablet: '(max-width: 1024px)',
  mobile: '(max-width: 640px)',
} as const

const FONTS: Record<string, string> = {
  display: 'var(--font-display)',
  mono: 'var(--font-mono)',
  serif: "'Iowan Old Style', Georgia, 'Times New Roman', serif",
  inherit: 'inherit',
}

const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
export const cssString = (s: string) => s.replace(/["\\\n\r]/g, (c) => `\\${c === '\n' ? 'a ' : c === '\r' ? 'd ' : c}`)
export const selectorFor = (id: string) => `:root [data-cms-id="${cssString(id)}"][data-cms-id]`

export function declarations(style: StyleProps | undefined): string[] {
  if (!style) return []
  const out: string[] = []
  const { translateX, translateY, rotate, fontFamily, ...rest } = style
  if (translateX !== undefined || translateY !== undefined) out.push(`translate:${translateX ?? '0'} ${translateY ?? '0'}`)
  if (rotate !== undefined) out.push(`rotate:${rotate}deg`)
  if (fontFamily) out.push(`font-family:${FONTS[fontFamily]}`)
  for (const [key, value] of Object.entries(rest)) {
    if (value === undefined || value === null || value === '') continue
    out.push(`${kebab(key)}:${value}`)
  }
  return out
}

function rules(id: string, style: ResponsiveStyle | undefined, hidden?: boolean): { base: string[]; tablet: string[]; mobile: string[] } {
  const sel = selectorFor(id)
  const base = declarations(style?.base)
  if (hidden) base.push('display:none')
  const wrap = (d: string[]) => (d.length ? [`${sel}{${d.join(';')}}`] : [])
  return { base: wrap(base), tablet: wrap(declarations(style?.tablet)), mobile: wrap(declarations(style?.mobile)) }
}

function collect(nodes: ElementNode[], into: { base: string[]; tablet: string[]; mobile: string[] }, editing: boolean) {
  for (const n of nodes) {
    const r = rules(n.id, n.style, n.hidden && !editing)
    if (n.hidden && editing) into.base.push(`${selectorFor(n.id)}{opacity:.28;outline:1px dashed currentColor}`)
    into.base.push(...r.base)
    into.tablet.push(...r.tablet)
    into.mobile.push(...r.mobile)
    if (n.children) collect(n.children, into, editing)
  }
}

/** In the editor's preview hidden elements stay selectable: faint and outlined instead of gone. */
export function compileStyles(doc: Pick<SiteDocument, 'elements' | 'additions'>, { editing = false } = {}): string {
  const all = { base: [] as string[], tablet: [] as string[], mobile: [] as string[] }
  for (const [id, override] of Object.entries(doc.elements)) {
    const r = rules(id, override.style, override.hidden && !editing)
    all.base.push(...r.base)
    all.tablet.push(...r.tablet)
    all.mobile.push(...r.mobile)
    if (override.hidden && editing) all.base.push(`${selectorFor(id)}{opacity:.28;outline:1px dashed currentColor}`)
  }
  for (const nodes of Object.values(doc.additions)) collect(nodes, all, editing)
  return [
    ...all.base,
    all.tablet.length ? `@media ${BREAKPOINTS.tablet}{${all.tablet.join('')}}` : '',
    all.mobile.length ? `@media ${BREAKPOINTS.mobile}{${all.mobile.join('')}}` : '',
  ].join('')
}
