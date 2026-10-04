import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { config, dataPath } from './config.ts'
import { db, now } from './db.ts'
import { sha256 } from './blobs.ts'
import { audit, type Actor } from './audit.ts'
import { ValidationError } from './errors.ts'

/* ============================================================
   MEDIA LIBRARY

   Uploads are identified by what their bytes ARE, never by the
   name or type the browser claims: a file is accepted only when its
   signature matches an allowed format, and stored under a random id
   with the extension of the detected format — never the uploaded
   name — inside the media directory. SVG is the one text format;
   it is parsed and rebuilt from an allow-list of elements and
   attributes (no scripts, no event handlers, no external or
   javascript: references, no foreignObject), and served with a
   sandboxing content security policy as well.

   A file still referenced by the draft or published site cannot be
   deleted; the library shows where each file is used.
   ============================================================ */

export type MediaKind = 'image' | 'icon' | 'video' | 'model' | 'texture'
export interface MediaItem { id: string; kind: MediaKind; filename: string; mime: string; size: number; sha256: string; width: number | null; height: number | null; alt: string; title: string; createdAt: number; createdBy: string | null; url: string }

interface Format { ext: string; mime: string; kind: MediaKind; max: number }
const MB = 1024 * 1024
function detect(b: Buffer): Format | null {
  const at = (o: number, s: string) => b.subarray(o, o + s.length).toString('latin1') === s
  if (b[0] === 0x89 && at(1, 'PNG')) return { ext: 'png', mime: 'image/png', kind: 'image', max: 15 * MB }
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', mime: 'image/jpeg', kind: 'image', max: 15 * MB }
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { ext: 'webp', mime: 'image/webp', kind: 'image', max: 15 * MB }
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return { ext: 'gif', mime: 'image/gif', kind: 'image', max: 10 * MB }
  if (at(4, 'ftyp') && (at(8, 'avif') || at(8, 'avis'))) return { ext: 'avif', mime: 'image/avif', kind: 'image', max: 15 * MB }
  if (at(4, 'ftyp')) return { ext: 'mp4', mime: 'video/mp4', kind: 'video', max: config.maxMediaBytes }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { ext: 'webm', mime: 'video/webm', kind: 'video', max: config.maxMediaBytes }
  if (at(0, 'glTF')) return { ext: 'glb', mime: 'model/gltf-binary', kind: 'model', max: config.maxMediaBytes }
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return { ext: 'ico', mime: 'image/x-icon', kind: 'icon', max: 1 * MB }
  const head = b.subarray(0, 2048).toString('utf8').trimStart()
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return { ext: 'svg', mime: 'image/svg+xml', kind: 'icon', max: 2 * MB }
  return null
}

function dimensions(b: Buffer, f: Format): [number | null, number | null] {
  try {
    if (f.ext === 'png') return [b.readUInt32BE(16), b.readUInt32BE(20)]
    if (f.ext === 'gif') return [b.readUInt16LE(6), b.readUInt16LE(8)]
    if (f.ext === 'webp') {
      const chunk = b.subarray(12, 16).toString('latin1')
      if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)]
      if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)] }
      if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff]
    }
    if (f.ext === 'jpg') {
      let o = 2
      while (o < b.length) {
        if (b[o] !== 0xff) break
        const marker = b[o + 1], len = b.readUInt16BE(o + 2)
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)]
        o += 2 + len
      }
    }
    if (f.ext === 'svg') {
      const m = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(b.toString('utf8'))
      if (m) return [Math.round(Number(m[1])), Math.round(Number(m[2]))]
    }
  } catch {
    /* unreadable header: no dimensions */
  }
  return [null, null]
}

/* ---- SVG sanitising: rebuild from an allow-list ---------------- */
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'title', 'desc', 'symbol', 'use', 'filter', 'fegaussianblur', 'feoffset', 'feblend', 'fecolormatrix', 'femerge', 'femergenode', 'feflood', 'fecomposite'])
const SVG_ATTRS = /^(xmlns(:xlink)?|version|id|class|viewbox|width|height|x|y|x1|y1|x2|y2|cx|cy|r|rx|ry|d|points|fill|fill-opacity|fill-rule|stroke|stroke-width|stroke-linecap|stroke-linejoin|stroke-dasharray|stroke-dashoffset|stroke-opacity|stroke-miterlimit|opacity|transform|offset|stop-color|stop-opacity|gradientunits|gradienttransform|spreadmethod|clip-path|clip-rule|mask|font-family|font-size|font-weight|text-anchor|dominant-baseline|letter-spacing|preserveaspectratio|href|xlink:href|stddeviation|dx|dy|in|in2|mode|result|values|type|flood-color|flood-opacity|operator|k1|k2|k3|k4|patternunits|patterncontentunits|maskunits|maskcontentunits|clippathunits|filterunits|style|role|aria-label|aria-hidden|focusable|vector-effect|paint-order|visibility|display)$/i

/** Elements dropped but whose drawing is kept: a link around shapes loses the link, not the shapes. */
const SVG_UNWRAP = new Set(['a', 'switch'])

export function sanitizeSvg(source: string): string {
  const out: string[] = []
  const stack: string[] = []
  const tokens = source.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').split(/(<[^>]*>)/)
  let skipDepth = 0
  for (const token of tokens) {
    if (!token.startsWith('<')) { if (!skipDepth && stack.length) out.push(token.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!)); continue }
    const close = /^<\/\s*([\w:-]+)/.exec(token)
    if (close) {
      const name = close[1].toLowerCase()
      if (skipDepth) { if (stack[stack.length - 1] === `!${name}`) { stack.pop(); skipDepth-- } continue }
      if (stack[stack.length - 1] === `~${name}`) { stack.pop(); continue }
      if (stack[stack.length - 1] === name) { stack.pop(); out.push(`</${name}>`) }
      continue
    }
    const open = /^<\s*([\w:-]+)([\s\S]*?)(\/?)>$/.exec(token)
    if (!open) continue
    const name = open[1].toLowerCase(), selfClosing = open[3] === '/'
    if (!skipDepth && SVG_UNWRAP.has(name)) { if (!selfClosing) stack.push(`~${name}`); continue }
    if (skipDepth || !SVG_TAGS.has(name)) { if (!selfClosing) { stack.push(`!${name}`); skipDepth++ } continue }
    const attrs: string[] = []
    for (const m of open[2].matchAll(/([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g)) {
      const key = m[1], value = m[2].slice(1, -1)
      if (!SVG_ATTRS.test(key) || /^on/i.test(key)) continue
      if ((key.toLowerCase() === 'href' || key.toLowerCase() === 'xlink:href') && !value.startsWith('#')) continue
      if (/javascript:|data:|url\(\s*['"]?\s*(?!#)/i.test(value) || /expression\(|@import/i.test(value)) continue
      attrs.push(`${key}="${value.replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`)
    }
    out.push(`<${name}${attrs.length ? ' ' + attrs.join(' ') : ''}${selfClosing ? '/>' : '>'}`)
    if (!selfClosing) stack.push(name)
  }
  while (stack.length) { const n = stack.pop()!; if (!n.startsWith('!') && !n.startsWith('~')) out.push(`</${n}>`) }
  const svg = out.join('')
  if (!/^<svg[\s>]/.test(svg)) throw new ValidationError('The SVG has no <svg> root after removing unsafe content.')
  return svg
}

type Row = Record<string, unknown>
const toItem = (r: Row): MediaItem => ({
  id: r.id as string, kind: r.kind as MediaKind, filename: r.filename as string, mime: r.mime as string, size: Number(r.size), sha256: r.sha256 as string,
  width: r.width == null ? null : Number(r.width), height: r.height == null ? null : Number(r.height), alt: r.alt as string, title: r.title as string,
  createdAt: Number(r.created_at), createdBy: (r.created_by as string) ?? null, url: `/media/${r.id}/${encodeURIComponent(r.filename as string)}`,
})

const ID = /^[a-z0-9]{20}$/
export function mediaFile(id: string, ext: string) {
  if (!ID.test(id) || !/^[a-z0-9]{2,5}$/.test(ext)) throw new Error('Invalid media id')
  return dataPath('media', `${id}.${ext}`)
}

export function saveUpload(bytes: Buffer, originalName: string, actor: Actor, { kind: wanted }: { kind?: MediaKind } = {}): MediaItem {
  let f = detect(bytes)
  if (!f) throw new ValidationError('That file type is not accepted. Use PNG, JPEG, WebP, AVIF, GIF, SVG, ICO, MP4, WebM or GLB.')
  if (bytes.byteLength > f.max) throw new ValidationError(`That file is ${(bytes.byteLength / MB).toFixed(1)} MB; the limit for ${f.ext.toUpperCase()} is ${(f.max / MB).toFixed(0)} MB.`)
  let stored = bytes
  if (f.ext === 'svg') stored = Buffer.from(sanitizeSvg(bytes.toString('utf8')), 'utf8')
  if (wanted === 'texture' && f.kind === 'image') f = { ...f, kind: 'texture' }
  if (wanted === 'icon' && f.kind === 'image') f = { ...f, kind: 'icon' }
  const id = randomBytes(15).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').padEnd(20, '0').slice(0, 20)
  const base = (originalName.split(/[\\/]/).pop() ?? 'file').replace(/\.[^.]*$/, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'file'
  const filename = `${base}.${f.ext}`
  fs.mkdirSync(dataPath('media'), { recursive: true })
  const target = mediaFile(id, f.ext)
  fs.writeFileSync(`${target}.tmp`, stored)
  fs.renameSync(`${target}.tmp`, target)
  const [width, height] = dimensions(stored, f)
  db().prepare('insert into media (id, kind, filename, mime, size, sha256, width, height, alt, title, created_at, created_by) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, f.kind, filename, f.mime, stored.byteLength, sha256(stored), width, height, '', base.replace(/[-_]+/g, ' '), now(), actor.name)
  audit(actor, 'media.upload', { detail: filename })
  return getMedia(id)!
}

export function getMedia(id: string): MediaItem | null {
  if (!ID.test(id)) return null
  const row = db().prepare('select * from media where id = ?').get(id) as Row | undefined
  return row ? toItem(row) : null
}

export function listMedia(): MediaItem[] {
  return (db().prepare('select * from media order by created_at desc').all() as Row[]).map(toItem)
}

export function updateMedia(id: string, patch: { alt?: string; title?: string }, actor: Actor) {
  const item = getMedia(id)
  if (!item) throw new ValidationError('Unknown file.')
  db().prepare('update media set alt = ?, title = ? where id = ?').run((patch.alt ?? item.alt).slice(0, 400), (patch.title ?? item.title).slice(0, 200), id)
  audit(actor, 'media.update', { detail: item.filename })
  return getMedia(id)!
}

export function deleteMedia(id: string, usages: string[], actor: Actor) {
  const item = getMedia(id)
  if (!item) throw new ValidationError('Unknown file.')
  if (usages.length) throw new ValidationError(`“${item.filename}” is still used by: ${usages.slice(0, 5).join(', ')}. Remove those references first.`)
  db().prepare('delete from media where id = ?').run(id)
  const file = mediaFile(id, path.extname(item.filename).slice(1))
  if (fs.existsSync(file)) fs.rmSync(file)
  audit(actor, 'media.delete', { detail: item.filename })
}

export function mediaStats() {
  try {
    const row = db().prepare('select count(*) n, coalesce(sum(size), 0) b from media').get() as Row
    return { count: Number(row.n), bytes: Number(row.b) }
  } catch {
    return { count: 0, bytes: 0 }
  }
}
