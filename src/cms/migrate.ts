import { SCHEMA_VERSION } from './schema.ts'
import { ANIMATION_BY_ID, isAnimatedSection } from '../sections/catalog.ts'

/* ============================================================
   DOCUMENT MIGRATIONS

   Every stored revision records the schema version it was
   written with. Reading an older one runs it through the steps
   below, in order, up to the current version; the stored bytes
   are never rewritten, so history stays exactly as it was saved.

   When the schema changes in a way old documents do not satisfy,
   add `N: (doc) => …` here and bump SCHEMA_VERSION in schema.ts.
   ============================================================ */

type Doc = Record<string, unknown> & { schemaVersion?: number }
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/* ------------------------------------------------------------
   v1 → v2: the page builder retires

   v1 documents could carry the visual editor's geometry: per-
   element styles for three breakpoints, anchored positions,
   locks, element groups. None of that has a meaning any more —
   the site's code lays every screen size out itself — so it is
   dropped. Everything that was CONTENT is kept:

   - the text of every edited element, and whether it was hidden;
   - a link target set on a link or button (`props.href`);
   - elements added to sections, with their text, media and
     settings — only their geometry (`style`, `layout`, `locked`)
     goes. They render in flow, in a content section of their own.
   ------------------------------------------------------------ */
function stripNode(node: unknown): unknown {
  if (!isObj(node)) return node
  const { style: _style, layout: _layout, locked: _locked, children, ...rest } = node
  void _style; void _layout; void _locked
  return Array.isArray(children) ? { ...rest, children: children.map(stripNode) } : rest
}

const steps: Record<number, (doc: Doc) => Doc> = {
  2: (doc) => {
    const elements: Record<string, Obj> = {}
    if (isObj(doc.elements)) {
      for (const [key, value] of Object.entries(doc.elements)) {
        if (!isObj(value)) continue
        const kept: Obj = {}
        if (value.text !== undefined) kept.text = value.text
        if (value.hidden === true) kept.hidden = true
        const href = isObj(value.props) ? value.props.href : undefined
        if (typeof href === 'string' && href) kept.href = href
        // An override that only ever held geometry leaves nothing behind.
        if (Object.keys(kept).length) elements[key] = kept
      }
    }
    const additions: Record<string, unknown[]> = {}
    if (isObj(doc.additions)) {
      for (const [section, nodes] of Object.entries(doc.additions)) {
        if (Array.isArray(nodes) && nodes.length) additions[section] = nodes.map(stripNode)
      }
    }
    /* Elements that were added on top of one of the site's own
       chapters had no place of their own in its layout — they
       floated over it. They move into a content section right
       after that chapter, where they read in flow. */
    let journeys = doc.journeys
    if (isObj(journeys)) {
      const next: Obj = {}
      for (const [key, journey] of Object.entries(journeys)) {
        if (!isObj(journey) || !Array.isArray(journey.sections)) {
          next[key] = journey
          continue
        }
        const sections: unknown[] = []
        for (const s of journey.sections) {
          sections.push(s)
          if (!isObj(s) || s.kind !== 'chapter' || typeof s.id !== 'string' || !additions[s.id]) continue
          const id = `${s.id}-more`.slice(0, 120)
          additions[id] = [...(additions[id] ?? []), ...additions[s.id]]
          delete additions[s.id]
          sections.push({ id, kind: 'custom', hidden: false, title: `${String(s.title ?? s.id)} — more`, label: String(s.label ?? 'MORE'), group: String(s.group ?? 'More'), vh: 1.6, quickVh: 1.2 })
        }
        next[key] = { ...journey, sections }
      }
      journeys = next
    }
    const { groups: _groups, ...rest } = doc
    void _groups
    return { ...rest, journeys, elements, additions, schemaVersion: 2 }
  },
}

/** Drops an animation choice that no longer exists, so the section falls back to its default. Never mutates its input. */
function normaliseAnimations(journeys: unknown): unknown {
  if (!isObj(journeys)) return journeys
  const out: Obj = {}
  for (const [key, journey] of Object.entries(journeys)) {
    if (!isObj(journey) || !Array.isArray(journey.sections)) {
      out[key] = journey
      continue
    }
    out[key] = {
      ...journey,
      sections: journey.sections.map((s: unknown) => {
        if (!isObj(s) || !isObj(s.animation)) return s
        const id = s.animation.id
        const known = typeof id === 'string' && isAnimatedSection(String(s.id)) && ANIMATION_BY_ID[id]?.section === s.id
        if (known) return s
        const { animation: _gone, ...rest } = s
        void _gone
        return rest
      }),
    }
  }
  return out
}

export function migrateSiteDocument<T = unknown>(input: unknown): T {
  if (!input || typeof input !== 'object') throw new Error('Not a site document')
  let doc = { ...(input as Doc) }
  let version = Number(doc.schemaVersion ?? 0)
  if (version > SCHEMA_VERSION) throw new Error(`This document was written by a newer version of the site (schema ${version}); update the code before editing it.`)
  // Documents from before versioning are v1 in every other respect.
  if (version < 1) version = 1
  while (version < SCHEMA_VERSION) {
    const step = steps[version + 1]
    if (!step) throw new Error(`No migration from schema ${version} to ${version + 1}`)
    doc = step(doc)
    version += 1
  }
  doc.schemaVersion = SCHEMA_VERSION
  // Defaults for collections a hand-made or partial document might omit.
  doc.elements ??= {}
  doc.collections ??= {}
  doc.credentials ??= []
  doc.additions ??= {}
  doc.journeys = normaliseAnimations(doc.journeys)
  return doc as T
}
