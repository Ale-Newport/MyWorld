import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { dataPath } from './config.ts'

/* ============================================================
   THE OBJECT STORE

   World documents and uploaded media, by key ("blobs/<sha>",
   "media/<id>.<ext>"):

     · production: a PRIVATE Supabase Storage bucket, reached with
       the service-role (secret) key, which never leaves the server.
       Nothing in it is public; files reach visitors only through
       the site's own routes, which decide what may be read.
     · development and tests: files under CMS_DATA_DIR.

   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY select the first;
   SUPABASE_STORAGE_BUCKET names the bucket (default "cms").
   ============================================================ */

export interface StoredObject {
  key: string
  size: number
  createdAt: number
}

function supabase() {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return null
  return { url: `${url}/storage/v1`, bucket: process.env.SUPABASE_STORAGE_BUCKET || 'cms', headers: { apikey: key, authorization: `Bearer ${key}` } }
}

const KEY = /^(blobs|media)\/[a-z0-9._-]+$/

function check(key: string) {
  if (!KEY.test(key)) throw new Error('Invalid object key')
}

/** On disk a blob keeps the layout earlier stores used: blobs/<first two hex>/<sha>. */
const local = (key: string) => {
  const [folder, name] = key.split('/')
  return folder === 'blobs' ? dataPath('blobs', name.slice(0, 2), name) : dataPath(folder, name)
}

async function fail(res: Response, what: string): Promise<never> {
  throw new Error(`Storage ${what} failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}`)
}

export async function putObject(key: string, bytes: Uint8Array, contentType = 'application/octet-stream') {
  check(key)
  const s = supabase()
  if (s) {
    const res = await fetch(`${s.url}/object/${s.bucket}/${key}`, { method: 'POST', headers: { ...s.headers, 'content-type': contentType, 'x-upsert': 'true' }, body: bytes as BodyInit })
    if (!res.ok) await fail(res, 'upload')
    return
  }
  const target = local(key)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`
  fs.writeFileSync(temp, bytes)
  fs.renameSync(temp, target)
}

export async function getObject(key: string): Promise<Buffer | null> {
  check(key)
  const s = supabase()
  if (s) {
    const res = await fetch(`${s.url}/object/authenticated/${s.bucket}/${key}`, { headers: s.headers })
    if (res.status === 404 || res.status === 400) return null
    if (!res.ok) await fail(res, 'download')
    return Buffer.from(await res.arrayBuffer())
  }
  const file = local(key)
  return fs.existsSync(file) ? fs.readFileSync(file) : null
}

/** Objects under a folder ("blobs", "media"), with their sizes. */
export async function listObjects(folder: 'blobs' | 'media', search = ''): Promise<StoredObject[]> {
  const s = supabase()
  if (s) {
    const out: StoredObject[] = []
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${s.url}/object/list/${s.bucket}`, {
        method: 'POST',
        headers: { ...s.headers, 'content-type': 'application/json' },
        body: JSON.stringify({ prefix: folder, search, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      })
      if (!res.ok) await fail(res, 'list')
      const page = (await res.json()) as { name: string; created_at?: string; metadata?: { size?: number } | null }[]
      for (const o of page) if (o.metadata) out.push({ key: `${folder}/${o.name}`, size: Number(o.metadata.size ?? 0), createdAt: o.created_at ? Date.parse(o.created_at) : 0 })
      if (page.length < 1000) return out
    }
  }
  const root = dataPath(folder)
  if (!fs.existsSync(root)) return []
  const dirs = folder === 'blobs' ? fs.readdirSync(root).map((d) => path.join(root, d)).filter((d) => fs.statSync(d).isDirectory()) : [root]
  const out: StoredObject[] = []
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      if (!name.startsWith(search) || name.endsWith('.tmp') || !fs.statSync(full).isFile()) continue
      const stat = fs.statSync(full)
      out.push({ key: `${folder}/${name}`, size: stat.size, createdAt: stat.mtimeMs })
    }
  }
  return out
}

export async function statObject(key: string): Promise<StoredObject | null> {
  check(key)
  const [folder, name] = key.split('/') as ['blobs' | 'media', string]
  if (supabase()) return (await listObjects(folder, name)).find((o) => o.key === key) ?? null
  const file = local(key)
  if (!fs.existsSync(file)) return null
  const stat = fs.statSync(file)
  return { key, size: stat.size, createdAt: stat.mtimeMs }
}

export async function deleteObjects(keys: string[]) {
  if (!keys.length) return
  keys.forEach(check)
  const s = supabase()
  if (s) {
    for (let i = 0; i < keys.length; i += 500) {
      const res = await fetch(`${s.url}/object/${s.bucket}`, { method: 'DELETE', headers: { ...s.headers, 'content-type': 'application/json' }, body: JSON.stringify({ prefixes: keys.slice(i, i + 500) }) })
      if (!res.ok) await fail(res, 'delete')
    }
    return
  }
  for (const key of keys) fs.rmSync(local(key), { force: true })
}
