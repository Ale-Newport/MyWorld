import { draftSite, publishedSite } from './site.ts'
import { blogState } from './blog.ts'
import type { SiteDocument } from '@/cms/schema'

/* Where each uploaded file is referenced, in words an editor recognises:
   "Project “Focus” → screenshots", "Settings → favicon", "Page element
   about.photo", "Blog post “Hello” → cover". Both the draft and the
   published site document count — a file the live site still shows cannot
   be deleted even if the draft dropped it — and so does every post of the
   blog (its own document, server/blog.ts), drafts included. */

/** A library file's address: /media/<id>/… in the site, /blog-media/<id>/… in a post. */
const MEDIA_URL = /\/(?:blog-)?media\/([a-z0-9]{20})\//g

function walk(value: unknown, path: string[], visit: (s: string, path: string[]) => void) {
  if (typeof value === 'string') visit(value, path)
  else if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, String(i)], visit))
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, [...path, k], visit)
}

function label(doc: SiteDocument, path: string[]): string {
  if (path[0] === 'projects') {
    const p = doc.projects[Number(path[1])]
    return `Project “${p?.title ?? path[1]}” → ${path.slice(2).filter((s) => !/^\d+$/.test(s)).join(' › ')}`
  }
  if (path[0] === 'settings') return `Settings → ${path.slice(1).join(' › ')}`
  if (path[0] === 'elements') return `Page element ${path[1]}`
  if (path[0] === 'additions') return `Added element in section “${path[1]}”`
  return path.join(' › ')
}

export async function mediaUsages(): Promise<Map<string, string[]>> {
  const usages = new Map<string, Set<string>>()
  const note = (text: string, where: string) => {
    for (const m of text.matchAll(MEDIA_URL)) {
      if (!usages.has(m[1])) usages.set(m[1], new Set())
      usages.get(m[1])!.add(where)
    }
  }
  const docs: [string, SiteDocument][] = [['draft', (await draftSite()).doc], ['live', (await publishedSite()).doc]]
  for (const [which, doc] of docs) walk(doc, [], (s, path) => note(s, `${label(doc, path)}${which === 'live' ? ' (live site)' : ''}`))
  for (const post of (await blogState()).posts) {
    note(post.cover ?? '', `Blog post “${post.title}” → cover`)
    note(post.body, `Blog post “${post.title}” → text`)
  }
  return new Map([...usages].map(([k, v]) => [k, [...v]]))
}
