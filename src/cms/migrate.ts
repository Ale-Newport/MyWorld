import { SCHEMA_VERSION } from './schema'

/* ============================================================
   DOCUMENT MIGRATIONS

   Every stored revision records the schema version it was
   written with. Reading an older one runs it through the steps
   below, in order, up to the current version; the stored bytes
   are never rewritten, so history stays exactly as it was saved.

   v1 is the first version. When the schema changes in a way old
   documents do not satisfy, add `2: (doc) => …` here and bump
   SCHEMA_VERSION in schema.ts.
   ============================================================ */

type Doc = Record<string, unknown> & { schemaVersion?: number }

const steps: Record<number, (doc: Doc) => Doc> = {
  // 2: (doc) => ({ ...doc, schemaVersion: 2, … }),
}

export function migrateSiteDocument<T = unknown>(input: unknown): T {
  if (!input || typeof input !== 'object') throw new Error('Not a site document')
  let doc = { ...(input as Doc) }
  let version = Number(doc.schemaVersion ?? 0)
  if (version > SCHEMA_VERSION) throw new Error(`This document was written by a newer version of the site (schema ${version}); update the code before editing it.`)
  while (version < SCHEMA_VERSION) {
    const step = steps[version + 1]
    if (!step) throw new Error(`No migration from schema ${version} to ${version + 1}`)
    doc = step(doc)
    version += 1
  }
  // Defaults for collections a hand-made or partial document might omit.
  doc.elements ??= {}
  doc.collections ??= {}
  doc.credentials ??= []
  doc.additions ??= {}
  doc.groups ??= {}
  return doc as T
}
