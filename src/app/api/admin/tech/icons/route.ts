import fs from 'node:fs/promises'
import path from 'node:path'
import { editorApi, json } from '@/server/auth/guard'

export const runtime = 'nodejs'

/* ============================================================
   BRAND MARKS FOR A NEW TECHNOLOGY

   The toolbox draws each technology's mark from Simple Icons
   (CC0 geometry). The marks that shipped are pinned in
   src/content/tech-logos.ts; a technology added in the editor
   picks its mark here, and the editor stores that one mark (its
   name, colour and path) with the technology in the site
   document, so the deployed site never fetches anything.

   Editor only, and read from the package's own files on disk:
   simple-icons is a development dependency, and importing its
   three thousand marks would put all of them in the server
   bundle that ships.
   ============================================================ */

interface Entry { title: string; slug: string; hex: string; aka: string[] }

let catalogue: Entry[] | null = null
const root = () => path.join(/* turbopackIgnore: true */ process.cwd(), 'node_modules', 'simple-icons')

async function load(): Promise<Entry[]> {
  if (catalogue) return catalogue
  const raw = JSON.parse(await fs.readFile(path.join(/* turbopackIgnore: true */ root(), 'data', 'simple-icons.json'), 'utf8')) as { title: string; slug?: string; hex: string; aliases?: { aka?: string[] } }[]
  catalogue = raw.filter((i) => i.slug).map((i) => ({ title: i.title, slug: i.slug!, hex: i.hex, aka: i.aliases?.aka ?? [] }))
  return catalogue
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#]/g, '')

export const GET = editorApi(async (req) => {
  const q = norm(req.nextUrl.searchParams.get('q') ?? '')
  if (!q) return json({ icons: [] })
  let list: Entry[]
  try {
    list = await load()
  } catch {
    return json({ icons: [], error: 'The Simple Icons package is not installed (npm install).' })
  }
  // Exact names first, then names that start with the query, then any that contain it.
  const rank = (e: Entry) => {
    const names = [e.title, e.slug, ...e.aka].map(norm)
    if (names.some((n) => n === q)) return 0
    if (names.some((n) => n.startsWith(q))) return 1
    if (names.some((n) => n.includes(q))) return 2
    return 3
  }
  const hits = list.map((e) => ({ e, r: rank(e) })).filter((x) => x.r < 3).sort((a, b) => a.r - b.r || a.e.title.length - b.e.title.length).slice(0, 18)
  const icons = await Promise.all(hits.map(async ({ e }) => {
    const svg = await fs.readFile(path.join(/* turbopackIgnore: true */ root(), 'icons', `${e.slug}.svg`), 'utf8').catch(() => '')
    const d = svg.match(/<path d="([^"]+)"/)?.[1]
    return d ? { title: e.title, slug: e.slug, hex: `#${e.hex}`, path: d } : null
  }))
  return json({ icons: icons.filter(Boolean) })
})
