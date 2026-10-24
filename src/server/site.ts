import { cache } from 'react'
import { revalidatePath } from 'next/cache'
import { draftMode } from 'next/headers'
import { buildSeedDocument } from '@/cms/seed'
import { siteDocument, SCHEMA_VERSION, type SiteDocument } from '@/cms/schema'
import { migrateSiteDocument } from '@/cms/migrate'
import { validateSiteReferences } from '@/cms/references'
import { exists, head, publish, publishedRevision, readRevision, saveDraft, seed, type Head, type PublishedRevision, type RevisionMeta } from './revisions.ts'
import { SYSTEM, type Actor } from './audit.ts'
import { currentSession } from './auth/guard.ts'
import { ValidationError } from './auth/guard.ts'

/* ============================================================
   SITE CONTENT ACCESS

   Public pages call loadSite(), which returns the PUBLISHED
   document — or, for an administrator previewing in Draft Mode
   (and only after their session has been checked here, not just
   the bypass cookie), the DRAFT. Before anything has been saved
   the published document is the seed migrated from src/content,
   built in memory: a public request never writes to the store.

   One request reads the document ONCE: layout.generateMetadata,
   generateViewport, the layout and the page all call loadSite(),
   and /world adds publishedSite() — React's cache() makes the
   later calls share the first one's result (it lives exactly as
   long as the request, so a publish is never hidden by it). The
   published pointer is one query (revisions.publishedRevision),
   and on an isolate that has not parsed any document yet it
   brings the content along, so a cold start needs no second one.
   ============================================================ */

const parsed = new Map<string, SiteDocument>()

function parse(revisionId: string, content: string | null | undefined): SiteDocument {
  if (!content) throw new Error(`Site revision ${revisionId} has no content`)
  const doc = migrateSiteDocument<SiteDocument>(JSON.parse(content))
  if (parsed.size > 20) parsed.delete(parsed.keys().next().value!)
  parsed.set(revisionId, doc)
  return doc
}

async function documentOf(revisionId: string, content?: string | null): Promise<SiteDocument> {
  const hit = parsed.get(revisionId)
  if (hit) return hit
  // `content` is undefined when it was not read along with the pointer.
  return parse(revisionId, content !== undefined ? content : (await readRevision(revisionId))?.content)
}

let seedCache: SiteDocument | null = null
const seedDoc = () => (seedCache ??= buildSeedDocument())

/** The published revision, one query. An isolate that has parsed nothing yet reads the content in the same query. */
async function readPublishedSite(): Promise<{ doc: SiteDocument; revision: RevisionMeta | null }> {
  const found: PublishedRevision | null = await publishedRevision('site', { content: parsed.size === 0 })
  if (!found) return { doc: seedDoc(), revision: null }
  const { content, ...revision } = found
  return { doc: await documentOf(revision.id, content), revision }
}

export const publishedSite = cache(async (): Promise<{ doc: SiteDocument; revision: RevisionMeta | null }> => {
  try {
    return await readPublishedSite()
  } catch (error) {
    // A broken store must not take the public site down: fall back to the migrated seed.
    console.error('[site] could not read the published document; serving the seed', error)
    return { doc: seedDoc(), revision: null }
  }
})

/** The editor's starting point. Seeds the store on first use (an authenticated action). */
export async function draftSite(actor: Actor = SYSTEM): Promise<{ doc: SiteDocument; head: Head }> {
  if (!(await exists('site'))) {
    await seed('site', 'site', { content: JSON.stringify(seedDoc()), schemaVersion: SCHEMA_VERSION, message: 'Migrated the content that shipped in src/content (schema v1)', actor })
  }
  const current = await head('site')
  return { doc: await documentOf(current.draft!.id), head: current }
}

/** For public pages: published, or the draft for a signed-in administrator in Draft Mode. */
export const loadSite = cache(async (): Promise<{ doc: SiteDocument; preview: boolean }> => {
  let preview = false
  try {
    preview = (await draftMode()).isEnabled
  } catch {
    preview = false
  }
  if (preview && (await currentSession())) return { doc: (await draftSite()).doc, preview: true }
  return { doc: (await publishedSite()).doc, preview: false }
})

export function validateSite(input: unknown): SiteDocument {
  const result = siteDocument.safeParse(migrateSiteDocument(input))
  if (!result.success) {
    const issues = result.error.issues.slice(0, 50).map((i) => ({ path: i.path.join('.'), message: i.message }))
    throw new ValidationError(`The document has ${result.error.issues.length} problem(s): ${issues.slice(0, 3).map((i) => `${i.path}: ${i.message}`).join('; ')}`, issues)
  }
  const problems = validateSiteReferences(result.data)
  if (problems.length) throw new ValidationError(`The document has ${problems.length} broken reference(s): ${problems.slice(0, 3).map((p) => p.message).join('; ')}`, problems)
  return result.data
}

export async function saveSiteDraft({ base, doc, message, actor, force }: { base: string | null; doc: unknown; message?: string; actor: Actor; force?: boolean }) {
  const valid = validateSite(doc)
  await draftSite(actor)
  return saveDraft('site', { base, content: JSON.stringify(valid), schemaVersion: SCHEMA_VERSION, message, actor, force })
}

export async function publishSite({ revisionId, actor }: { revisionId?: string; actor: Actor }) {
  await draftSite(actor)
  const rev = await publish('site', {
    revisionId,
    actor,
    validate: (r) => {
      if (!r.content) throw new ValidationError('That revision has no content.')
      validateSite(JSON.parse(r.content))
    },
  })
  // Every page reads the document: regenerate them on their next visit.
  revalidatePath('/', 'layout')
  return rev
}
