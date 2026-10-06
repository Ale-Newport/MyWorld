import { draftSite, publishedSite } from './site.ts'
import type { SiteDocument } from '@/cms/schema'

/* Where each uploaded file is referenced, in words an editor recognises:
   "Project “Focus” → screenshots", "Settings → favicon", "Page element
   about.photo". Both the draft and the published document count: a file
   the live site still shows cannot be deleted even if the draft dropped it. */

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
  const docs: [string, SiteDocument][] = [['draft', (await draftSite()).doc], ['live', (await publishedSite()).doc]]
  for (const [which, doc] of docs) {
    walk(doc, [], (s, path) => {
      for (const m of s.matchAll(/\/media\/([a-z0-9]{20})\//g)) {
        if (!usages.has(m[1])) usages.set(m[1], new Set())
        usages.get(m[1])!.add(`${label(doc, path)}${which === 'live' ? ' (live site)' : ''}`)
      }
    })
  }
  return new Map([...usages].map(([k, v]) => [k, [...v]]))
}
