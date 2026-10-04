'use client'

import { createElement, type ComponentPropsWithRef, type ElementType, type ReactNode } from 'react'
import { useEditing, useSite } from './context'
import { renderRich, richToPlain } from './rich'
import { safeHref, safeSrc } from './schema'

/* ============================================================
   EDITABLE ELEMENTS

   `<E cms="about.summary" as="h2">…</E>` renders exactly what it
   wraps, plus a `data-cms-id` the stylesheet compiled from the
   document can target. In the admin's live preview it also says
   what kind of element it is, what to call it in the layers
   panel and — for text that belongs to the portfolio's data
   rather than to the page — which field of the document an
   inline edit should write to (`bind="profile.summary"`).

   An element with no `bind` keeps its text in the document's
   element overrides; until someone edits it, it shows what the
   code renders, which is what the site looked like before.
   ============================================================ */

export type CmsKind = 'text' | 'heading' | 'image' | 'button' | 'link' | 'container' | 'section' | 'animation' | 'table' | 'list' | 'card' | 'metric'

export interface CmsOptions {
  kind?: CmsKind
  label?: string
  /** Document path an inline text edit writes to, e.g. `profile.summary` or `projects[id=focus].title`. */
  bind?: string
}

export function useCms(cms: string, { kind = 'text', label, bind }: CmsOptions = {}): Record<string, string> {
  const editing = useEditing()
  if (!editing) return { 'data-cms-id': cms }
  const attrs: Record<string, string> = { 'data-cms-id': cms, 'data-cms-kind': kind }
  if (label) attrs['data-cms-label'] = label
  if (bind) attrs['data-cms-bind'] = bind
  return attrs
}

/** The plain text an element shows: its override when there is one. For components (Reveal) that need a string. */
export function useCmsText(cms: string, fallback: string): string {
  const text = useSite().doc.elements[cms]?.text
  return text === undefined ? fallback : richToPlain(text)
}

/** Prop overrides an editor may set, each checked again here before it reaches the DOM. */
export function useCmsProps(cms: string): { href?: string; src?: string; alt?: string; label?: string } {
  const props = useSite().doc.elements[cms]?.props ?? {}
  const out: { href?: string; src?: string; alt?: string; label?: string } = {}
  if (typeof props.href === 'string' && safeHref.safeParse(props.href).success) out.href = props.href
  if (typeof props.src === 'string' && safeSrc.safeParse(props.src).success) out.src = props.src
  if (typeof props.alt === 'string') out.alt = props.alt.slice(0, 400)
  if (typeof props.label === 'string') out.label = props.label.slice(0, 200)
  return out
}

type EProps<T extends ElementType> = {
  cms: string
  as?: T
  kind?: CmsKind
  label?: string
  bind?: string
  children?: ReactNode
} & Omit<ComponentPropsWithRef<T>, 'children'>

export function E<T extends ElementType = 'span'>({ cms, as, kind, label, bind, children, ...rest }: EProps<T>) {
  const { doc } = useSite()
  const attrs = useCms(cms, { kind, label, bind })
  const override = doc.elements[cms]
  const content = !bind && override?.text !== undefined ? renderRich(override.text) : children
  const extra: Record<string, unknown> = {}
  if (as === 'a' || kind === 'link' || kind === 'button') {
    const p = override?.props
    if (typeof p?.href === 'string' && safeHref.safeParse(p.href).success) extra.href = p.href
  }
  return createElement(as ?? 'span', { ...rest, ...extra, ...attrs }, content)
}
