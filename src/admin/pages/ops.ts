import type { ElementNode, ElementOverride, ElementType, ResponsiveStyle, RichText, SiteDocument, StyleProps } from '@/cms/schema'
import { richToPlain } from '@/cms/rich'
import { getPath, setPath } from '../paths'

/* ============================================================
   DOCUMENT OPERATIONS FOR THE PAGE EDITOR

   An element id names one of three things:
     · an element the site's code renders (`about.summary`),
       changed through `doc.elements[id]` overrides;
     · an element added in the editor, a node somewhere in
       `doc.additions[section]` (ids start with `el-`);
     · a section (`section.<id>`) or a section's slot of added
       elements (`slot.<id>`), styled through overrides as well.
   Every function here mutates the draft it is given — callers
   run them inside the store's apply(), so each is one undo step.
   ============================================================ */

export type Scope = 'base' | 'tablet' | 'mobile'
export const SCOPES: Scope[] = ['base', 'tablet', 'mobile']

let seq = 0
export const newElementId = () => `el-${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 5)}`

export interface Found { node: ElementNode; list: ElementNode[]; index: number; section: string; parent: ElementNode | null }

export function findNode(doc: SiteDocument, id: string): Found | null {
  const walk = (list: ElementNode[], section: string, parent: ElementNode | null): Found | null => {
    for (let i = 0; i < list.length; i++) {
      const node = list[i]
      if (node.id === id) return { node, list, index: i, section, parent }
      if (node.children) { const hit = walk(node.children, section, node); if (hit) return hit }
    }
    return null
  }
  for (const [section, list] of Object.entries(doc.additions)) {
    const hit = walk(list, section, null)
    if (hit) return hit
  }
  return null
}

export const isSection = (id: string) => id.startsWith('section.')
export const isSlot = (id: string) => id.startsWith('slot.')

/** The responsive style object an element's edits live in (created on write). */
function styleHolder(doc: SiteDocument, id: string, create: boolean): ResponsiveStyle | undefined {
  const found = findNode(doc, id)
  if (found) return found.node.style
  if (!create) return doc.elements[id]?.style
  const o = (doc.elements[id] ??= {})
  return (o.style ??= {})
}

export function ownStyle(doc: SiteDocument, id: string, scope: Scope): StyleProps {
  return styleHolder(doc, id, false)?.[scope] ?? {}
}

/** What applies at a scope: base, then tablet, then mobile, as the browser cascades them. */
export function effectiveStyle(doc: SiteDocument, id: string, scope: Scope): StyleProps {
  const s = styleHolder(doc, id, false) ?? {}
  if (scope === 'base') return { ...s.base }
  if (scope === 'tablet') return { ...s.base, ...s.tablet }
  return { ...s.base, ...s.tablet, ...s.mobile }
}

/** Where an inherited value comes from, for the inspector's hints. */
export function inheritedFrom(doc: SiteDocument, id: string, scope: Scope, key: keyof StyleProps): Scope | null {
  const s = styleHolder(doc, id, false) ?? {}
  const order: Scope[] = scope === 'mobile' ? ['tablet', 'base'] : scope === 'tablet' ? ['base'] : []
  for (const sc of order) if (s[sc]?.[key] !== undefined) return sc
  return null
}

export function setStyle(doc: SiteDocument, id: string, scope: Scope, patch: Partial<Record<keyof StyleProps, unknown>>) {
  const holder = styleHolder(doc, id, true)!
  const next: Record<string, unknown> = { ...(holder[scope] ?? {}) }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === '' || v === null) delete next[k]
    else next[k] = v
  }
  if (Object.keys(next).length) holder[scope] = next as StyleProps
  else delete holder[scope]
  tidy(doc, id)
}

export function clearScope(doc: SiteDocument, id: string, scope: Scope) {
  const holder = styleHolder(doc, id, false)
  if (holder) delete holder[scope]
  tidy(doc, id)
}

/** Drops empty override records so the document stays small and readable. */
export function tidy(doc: SiteDocument, id: string) {
  const o = doc.elements[id]
  if (!o) return
  if (o.style && !o.style.base && !o.style.tablet && !o.style.mobile) delete o.style
  if (o.props && !Object.keys(o.props).length) delete o.props
  if (!o.hidden) delete o.hidden
  if (!o.locked) delete o.locked
  if (!Object.keys(o).length) delete doc.elements[id]
}

export function flag(doc: SiteDocument, id: string, key: 'hidden' | 'locked'): boolean {
  const found = findNode(doc, id)
  return !!(found ? found.node[key] : doc.elements[id]?.[key])
}

export function setFlag(doc: SiteDocument, id: string, key: 'hidden' | 'locked', value: boolean) {
  const found = findNode(doc, id)
  if (found) { if (value) found.node[key] = true; else delete found.node[key]; return }
  const o: ElementOverride = (doc.elements[id] ??= {})
  if (value) o[key] = true; else delete o[key]
  tidy(doc, id)
}

/** The text an inline edit starts from; null when the code's own text applies (the frame reads it). */
export function textOf(doc: SiteDocument, id: string, bind?: string): { text: string | null; rich: boolean } {
  if (bind) {
    const v = getPath(doc, bind) as RichText | undefined
    return { text: v === undefined ? null : richToPlain(v), rich: Array.isArray(v) }
  }
  const found = findNode(doc, id)
  const v = found ? found.node.text : doc.elements[id]?.text
  return { text: v === undefined ? null : richToPlain(v), rich: Array.isArray(v) }
}

export function setText(doc: SiteDocument, id: string, text: string, bind?: string) {
  if (bind) { setPath(doc, bind, text); return }
  const found = findNode(doc, id)
  if (found) { found.node.text = text; return }
  ;(doc.elements[id] ??= {}).text = text
}

export function resetText(doc: SiteDocument, id: string) {
  const o = doc.elements[id]
  if (o) { delete o.text; tidy(doc, id) }
}

export function setProp(doc: SiteDocument, id: string, key: string, value: unknown) {
  const found = findNode(doc, id)
  const props = found ? found.node.props : ((doc.elements[id] ??= {}).props ??= {})
  if (value === undefined || value === '') delete props[key]
  else props[key] = value
  if (!found) tidy(doc, id)
}

export function propOf(doc: SiteDocument, id: string, key: string): unknown {
  const found = findNode(doc, id)
  return found ? found.node.props[key] : doc.elements[id]?.props?.[key]
}

/* ---- added elements ---------------------------------------------- */
const DEFAULTS: Record<ElementType, (o: { text?: string; src?: string; alt?: string }) => Partial<ElementNode>> = {
  heading: (o) => ({ name: 'Heading', text: o.text ?? 'A new heading', props: { level: 2 } }),
  text: (o) => ({ name: 'Paragraph', text: o.text ?? 'Write something worth reading here.' }),
  button: (o) => ({ name: 'Button', text: o.text ?? 'Get in touch', props: { href: '/projects', variant: 'solid' } }),
  image: (o) => ({ name: 'Image', props: { src: o.src ?? '', alt: o.alt ?? '' }, style: { base: { width: '28rem' } } }),
  video: (o) => ({ name: 'Video', props: { src: o.src ?? '', controls: true }, style: { base: { width: '32rem' } } }),
  table: () => ({ name: 'Table', props: { table: { caption: 'Table', header: true, columns: [{ id: 'c1', label: 'Item', align: 'left' }, { id: 'c2', label: 'Detail', align: 'left' }], rows: [{ id: 'r1', cells: { c1: 'First', c2: '—' } }, { id: 'r2', cells: { c1: 'Second', c2: '—' } }] } }, style: { base: { width: '36rem' } } }),
  card: () => ({ name: 'Card', text: 'A short description.', props: { title: 'Card title', eyebrow: 'Label' }, style: { base: { width: '20rem' } } }),
  container: () => ({ name: 'Container', props: {}, children: [], style: { base: { display: 'flex', flexDirection: 'row', gap: '1rem', flexWrap: 'wrap' } } }),
  animation: () => ({ name: 'Animation', props: { effect: 'type.reveal', params: { text: 'Building intelligent systems.' } }, style: { base: { width: '36rem', height: '14rem' } } }),
  divider: () => ({ name: 'Divider', props: {}, style: { base: { width: '100%' } } }),
  spacer: () => ({ name: 'Spacer', props: {}, style: { base: { height: '4rem' } } }),
}

export function makeNode(type: ElementType, opts: { text?: string; src?: string; alt?: string; preset?: string } = {}): ElementNode {
  const d = DEFAULTS[type](opts)
  const node: ElementNode = { id: newElementId(), type, name: d.name ?? type, props: d.props ?? {}, style: d.style ?? {}, layout: { mode: 'flow' } }
  if (d.text !== undefined) node.text = d.text
  if (d.children) node.children = d.children
  if (type === 'container' && opts.preset === 'column') node.style = { base: { display: 'flex', flexDirection: 'column', gap: '1rem' } }
  if (type === 'container' && opts.preset === 'grid') node.style = { base: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1.25rem', width: '100%' }, mobile: { gridTemplateColumns: '1fr' } }
  if (type === 'container' && opts.preset) node.name = opts.preset === 'grid' ? 'Grid' : opts.preset === 'column' ? 'Column' : 'Row'
  return node
}

/** Adds a node to a section's slot, or inside an added container. */
export function insertNode(doc: SiteDocument, section: string, node: ElementNode, container?: string | null, index?: number) {
  if (container) {
    const c = findNode(doc, container)
    if (c && (c.node.type === 'container' || c.node.type === 'card')) {
      const list = (c.node.children ??= [])
      list.splice(index ?? list.length, 0, node)
      return
    }
  }
  const list = (doc.additions[section] ??= [])
  list.splice(index ?? list.length, 0, node)
}

export function removeNode(doc: SiteDocument, id: string): boolean {
  const found = findNode(doc, id)
  if (!found) return false
  found.list.splice(found.index, 1)
  if (!doc.additions[found.section]?.length) delete doc.additions[found.section]
  // Groups that lose members below two dissolve.
  const groups = doc.groups[found.section]
  if (groups) {
    for (const g of groups) g.members = g.members.filter((m) => m !== id)
    doc.groups[found.section] = groups.filter((g) => g.members.length >= 2)
    if (!doc.groups[found.section].length) delete doc.groups[found.section]
  }
  return true
}

function reId(node: ElementNode): ElementNode {
  const copy: ElementNode = { ...structuredClone(node), id: newElementId() }
  if (copy.children) copy.children = copy.children.map(reId)
  return copy
}

/** A copy next to the original, nudged so it is visibly a second one. */
export function duplicateNode(doc: SiteDocument, id: string): string | null {
  const found = findNode(doc, id)
  if (!found) return null
  const copy = reId(found.node)
  copy.name = `${found.node.name} copy`
  if (copy.layout.mode === 'anchored') {
    const base = (copy.style.base ??= {})
    base.translateX = `calc(${base.translateX ?? '0px'} + 16px)`
    base.translateY = `calc(${base.translateY ?? '0px'} + 16px)`
  }
  found.list.splice(found.index + 1, 0, copy)
  return copy.id
}

/** Clipboard entries are self-contained nodes; pasting gives them fresh ids. */
export function cloneForClipboard(doc: SiteDocument, id: string, fallbackText: string | null, kind: string): ElementNode | null {
  const found = findNode(doc, id)
  if (found) return structuredClone(found.node)
  // A built-in element is copied as an added one with its text and styles.
  const type: ElementType | null = kind === 'heading' ? 'heading' : kind === 'button' || kind === 'link' ? 'button' : kind === 'text' || kind === 'metric' ? 'text' : null
  if (!type) return null
  const node = makeNode(type, { text: fallbackText ?? undefined })
  const o = doc.elements[id]
  if (o?.style) node.style = structuredClone(o.style)
  if (typeof o?.props?.href === 'string') node.props.href = o.props.href
  node.name = `${node.name} (copy)`
  return node
}

export function pasteNodes(doc: SiteDocument, section: string, nodes: ElementNode[], container?: string | null): string[] {
  return nodes.map((n) => { const copy = reId(n); insertNode(doc, section, copy, container); return copy.id })
}

export function moveInList(doc: SiteDocument, id: string, delta: number) {
  const found = findNode(doc, id)
  if (!found) return
  const to = Math.max(0, Math.min(found.list.length - 1, found.index + delta))
  if (to === found.index) return
  const [n] = found.list.splice(found.index, 1)
  found.list.splice(to, 0, n)
}

/** Moves an added node before another added node, or into a container. */
export function moveNodeTo(doc: SiteDocument, id: string, target: string, where: 'before' | 'inside') {
  if (id === target) return
  const moving = findNode(doc, id)
  if (!moving) return
  // Never into its own subtree.
  if (findIn(moving.node, target)) return
  moving.list.splice(moving.index, 1)
  const t = findNode(doc, target)
  if (!t) { moving.list.splice(moving.index, 0, moving.node); return }
  if (where === 'inside' && (t.node.type === 'container' || t.node.type === 'card')) (t.node.children ??= []).push(moving.node)
  else t.list.splice(t.index, 0, moving.node)
}
const findIn = (node: ElementNode, id: string): boolean => !!node.children?.some((c) => c.id === id || findIn(c, id))

/* ---- groups --------------------------------------------------------- */
export function groupFor(doc: SiteDocument, section: string | null, id: string) {
  if (!section) return null
  return doc.groups[section]?.find((g) => g.members.includes(id)) ?? null
}
export function allGroups(doc: SiteDocument): string[][] {
  return Object.values(doc.groups).flat().map((g) => g.members)
}

export function makeGroup(doc: SiteDocument, section: string, ids: string[], name = 'Group'): string {
  const list = (doc.groups[section] ??= [])
  // An element belongs to one group at a time.
  for (const g of list) g.members = g.members.filter((m) => !ids.includes(m))
  const id = `group-${newElementId().slice(3)}`
  list.push({ id, name, members: [...ids] })
  doc.groups[section] = list.filter((g) => g.members.length >= 2)
  return id
}

export function ungroup(doc: SiteDocument, section: string, groupId: string) {
  const list = doc.groups[section]
  if (!list) return
  doc.groups[section] = list.filter((g) => g.id !== groupId)
  if (!doc.groups[section].length) delete doc.groups[section]
}

/* ---- sections --------------------------------------------------------- */
export function newSectionId(doc: SiteDocument) {
  const taken = new Set([...doc.journeys.home.sections, ...doc.journeys.projects.sections].map((s) => s.id))
  for (let i = 1; ; i++) if (!taken.has(`custom-${i}`)) return `custom-${i}`
}

/** Removes a section the editor added, with its elements and groups. Chapters the code renders can only be hidden. */
export function deleteCustomSection(doc: SiteDocument, journey: 'home' | 'projects', id: string) {
  const j = doc.journeys[journey]
  const s = j.sections.find((x) => x.id === id)
  if (!s || s.kind !== 'custom') return false
  j.sections = j.sections.filter((x) => x.id !== id)
  delete doc.additions[id]
  delete doc.groups[id]
  for (const key of Object.keys(doc.elements)) if (key === `section.${id}` || key === `slot.${id}`) delete doc.elements[key]
  return true
}

/** Adds `delta` CSS pixels to a length, keeping its unit when it is px and composing with calc() otherwise. */
export function addPx(value: string | undefined, delta: number): string {
  if (!value || value === '0' || value === 'auto') return `${round(delta)}px`
  const m = /^(-?\d*\.?\d+)px$/.exec(value)
  if (m) return `${round(parseFloat(m[1]) + delta)}px`
  return `calc(${value} ${delta < 0 ? '-' : '+'} ${round(Math.abs(delta))}px)`
}
const round = (n: number) => Math.round(n * 10) / 10
