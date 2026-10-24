/* The player's module graph as <link rel="modulepreload"> hints in public/archipelago/preview/index.html.
   The runtime is plain ES modules (no bundler): without hints the browser finds a module only when its importer has
   downloaded and parsed, a waterfall of seven round trips for 128 files. With the list in the HTML head every module is
   requested at once. A later stage may replace the graph with a bundle; until then this keeps the list true.

     node scripts/world/build-modulepreload.mjs           rewrite the list in index.html
     node scripts/world/build-modulepreload.mjs --check   exit 1 when the list is not the graph's (tests/world/loading-modulepreload.test.mjs)

   The graph is every static import (and `export ... from`) reachable from the page's <script type="module"> tags, with bare
   specifiers resolved through the page's import map. Dynamic import() is left out: those modules are loaded on demand
   (the studio's board editor). The studio page does not preload anything. */
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
// WORLD_PREVIEW_DIR points the generator at another copy of the preview folder (an A/B tree for measuring).
export const PREVIEW = process.env.WORLD_PREVIEW_DIR ? path.resolve(process.env.WORLD_PREVIEW_DIR) : path.join(root, 'public/archipelago/preview')
export const START = '<!--modulepreload:start-->'
export const END = '<!--modulepreload:end-->'
const IMPORT = /(?:^|[;}\s])(?:import|export)\s*(?:[^'"`;()]*?\bfrom\s*)?(['"])([^'"\n]+)\1/g

/** Specifiers a module imports statically (not import()). */
export function importsOf(source) {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')
  const out = []
  for (const m of stripped.matchAll(IMPORT)) out.push(m[2])
  return out
}

export function resolveSpecifier(specifier, importer, importMap) {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return path.resolve(specifier.startsWith('/') ? path.join(root, 'public') : path.dirname(importer), specifier)
  const imports = importMap.imports ?? {}
  if (imports[specifier]) return path.resolve(PREVIEW, imports[specifier])
  for (const [prefix, target] of Object.entries(imports)) if (prefix.endsWith('/') && specifier.startsWith(prefix)) return path.resolve(PREVIEW, target + specifier.slice(prefix.length))
  throw new Error(`cannot resolve ${specifier} from ${path.relative(root, importer)}`)
}

/** Every module of the page's graph, in breadth-first order from its script tags (entry modules first). */
export function moduleGraph(html = fs.readFileSync(path.join(PREVIEW, 'index.html'), 'utf8')) {
  const importMap = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1])
  const entries = [...html.matchAll(/<script type="module" src="([^"]+)"/g)].map((m) => path.resolve(PREVIEW, m[1]))
  const seen = new Set(entries), queue = [...entries]
  for (let i = 0; i < queue.length; i++) {
    const file = queue[i]
    for (const specifier of importsOf(fs.readFileSync(file, 'utf8'))) {
      const target = resolveSpecifier(specifier, file, importMap)
      if (!seen.has(target)) { seen.add(target); queue.push(target) }
    }
  }
  return queue
}

export function preloadBlock(files) {
  const href = (file) => './' + path.relative(PREVIEW, file).split(path.sep).join('/')
  return START + files.map((f) => `<link rel="modulepreload" href="${href(f)}">`).join('') + END
}

export function currentBlock(html) {
  const a = html.indexOf(START), b = html.indexOf(END)
  return a >= 0 && b > a ? html.slice(a, b + END.length) : null
}

export function updatePreload({ check = false } = {}) {
  const file = path.join(PREVIEW, 'index.html'), html = fs.readFileSync(file, 'utf8'), block = preloadBlock(moduleGraph(html)), old = currentBlock(html)
  if (old === block) return { changed: false, modules: moduleGraph(html).length }
  if (!check) {
    if (old === null) throw new Error('index.html has no modulepreload markers')
    fs.writeFileSync(file, html.replace(old, () => block))
  }
  return { changed: true, modules: moduleGraph(html).length }
}

if (process.argv[1] === import.meta.filename) {
  const check = process.argv.includes('--check'), result = updatePreload({ check })
  if (check && result.changed) { console.error('index.html modulepreload list is stale: run node scripts/world/build-modulepreload.mjs'); process.exit(1) }
  console.log(`${result.modules} modules; index.html ${result.changed ? (check ? 'is stale' : 'updated') : 'is current'}`)
}
