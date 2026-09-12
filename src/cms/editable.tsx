'use client'

import { createElement, type ComponentPropsWithRef, type ElementType, type ReactNode } from 'react'
import { useSite } from './context'
import { renderRich, richToPlain } from './rich'
import { isSafeHref } from './safe'

/* ============================================================
   EDITABLE ELEMENTS

   `<E cms="about.summary" as="h2">…</E>` renders exactly what it
   wraps, plus a `data-cms-id` the content editor can point at
   (src/admin/website/fields.ts names every one of them in words).

   An element with no `bind` keeps its text in the document's
   element overrides; until someone edits it, it shows what the
   code renders, which is what the site looked like before. An
   element with a `bind` shows the portfolio's data, which the
   editor edits at its source (`profile.summary`, a project's
   title…) so it changes everywhere that data appears.

   Overrides carry text, an on/off switch for optional lines and
   a link target — never a position, a size or a style. How the
   element sits on the page is the code's business at every size.
   ============================================================ */

export type CmsKind = 'text' | 'heading' | 'image' | 'button' | 'link' | 'container' | 'section' | 'animation' | 'table' | 'list' | 'card' | 'metric'

export interface CmsOptions {
  kind?: CmsKind
  label?: string
  /** Document path an inline text edit writes to, e.g. `profile.summary` or `projects[id=focus].title`. */
  bind?: string
}

export function useCms(cms: string, _options: CmsOptions = {}): Record<string, string> {
  void _options
  const hidden = useSite().doc.elements[cms]?.hidden
  return hidden ? { 'data-cms-id': cms, 'data-cms-hidden': '' } : { 'data-cms-id': cms }
}

/** The plain text an element shows: its override when there is one. For components (Reveal) that need a string. */
export function useCmsText(cms: string, fallback: string): string {
  const text = useSite().doc.elements[cms]?.text
  return text === undefined ? fallback : richToPlain(text)
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
  // Only text elements take text: a container keeps its children whatever an old document says.
  const takesText = !bind && kind !== 'container' && kind !== 'list' && kind !== 'card' && kind !== 'section'
  const content = takesText && override?.text !== undefined ? renderRich(override.text) : children
  const extra: Record<string, unknown> = {}
  if ((as === 'a' || kind === 'link' || kind === 'button') && override?.href && isSafeHref(override.href)) extra.href = override.href
  return createElement(as ?? 'span', { ...rest, ...extra, ...attrs }, content)
}
