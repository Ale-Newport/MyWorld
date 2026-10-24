/* A production-like static server for the /world runtime, so startup can be measured without a Next dev
   server's compile noise and compared between two trees with the same server code:

     node scripts/qa/world-static-server.mjs --root <dir containing archipelago/> --port 3262

   - serves <root>/archipelago/** the way Workers Static Assets does: Cache-Control public, max-age=0,
     must-revalidate + ETag (304 on revalidation); text types compressed (br, else gzip) like the edge,
     .gz / .png / .glb / .woff2 left as they are (model/gltf-binary is not on Cloudflare's compressible list)
   - /api/world/release answers with the seed files, which is what the release route does before anything is
     published (the 17 MB document is then a plain static .gz)
   - everything it compresses is cached in memory, so repeated loads cost no CPU in the server
   Importable: startWorldStaticServer({root,port}) -> {url,close}. */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.gz': 'application/gzip',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
}
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.json', '.css', '.svg', '.wasm', '.md', '.txt', '.ttf'])

export function startWorldStaticServer({ root, port = 0, host = '127.0.0.1', release } = {}) {
  const cache = new Map()
  const seedRelease = release ?? {
    revision: null, publishedAt: null,
    world: { url: '/archipelago/seed/editor-world.json.gz', sha: 'seed', size: fs.statSync(path.join(root, 'archipelago/seed/editor-world.json.gz')).size },
    assets: { url: '/archipelago/seed/asset-definitions.json', sha: 'seed', size: fs.statSync(path.join(root, 'archipelago/seed/asset-definitions.json')).size },
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x')
    if (url.pathname === '/api/world/release') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' })
      return res.end(JSON.stringify(seedRelease))
    }
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    const file = path.resolve(root, rel)
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      return res.end('not found')
    }
    const stat = fs.statSync(file), ext = path.extname(file).toLowerCase()
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`
    const base = { 'content-type': TYPES[ext] ?? 'application/octet-stream', 'cache-control': 'public, max-age=0, must-revalidate', etag, vary: 'accept-encoding' }
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, base); return res.end() }
    const accept = String(req.headers['accept-encoding'] ?? '')
    const encoding = COMPRESSIBLE.has(ext) ? (/\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null) : null
    const key = `${file}|${etag}|${encoding}`
    let body = cache.get(key)
    if (!body) {
      body = fs.readFileSync(file)
      if (encoding === 'br') body = zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })
      else if (encoding === 'gzip') body = zlib.gzipSync(body, { level: 6 })
      cache.set(key, body)
    }
    res.writeHead(200, { ...base, ...(encoding ? { 'content-encoding': encoding } : {}), 'content-length': body.length })
    res.end(req.method === 'HEAD' ? undefined : body)
  })
  return new Promise((resolve) => server.listen(port, host, () => {
    const address = server.address()
    resolve({ url: `http://${host}:${address.port}`, port: address.port, close: () => new Promise((r) => server.close(r)), server })
  }))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : fallback }
  const root = path.resolve(arg('root', 'public'))
  const server = await startWorldStaticServer({ root, port: Number(arg('port', 3262)) })
  console.log(`world static server: ${root} -> ${server.url}`)
}
