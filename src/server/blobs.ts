import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { dataPath } from './config.ts'

/* ============================================================
   CONTENT-ADDRESSED BLOBS

   A blob's name is the SHA-256 of its bytes. Writing the same
   bytes twice stores them once; a name can never point at
   different content; and an upload that dies half way can never
   be mistaken for a complete one, because the file only appears
   under its name after the bytes have been hashed, written to a
   temporary file and renamed into place.

   Only hex digests are accepted as names, so no caller can make
   this module touch a path outside its own directory.
   ============================================================ */

const HEX = /^[a-f0-9]{64}$/

export function sha256(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex')
}

function file(sha: string) {
  if (!HEX.test(sha)) throw new Error('Invalid blob name')
  return dataPath('blobs', sha.slice(0, 2), sha)
}

export function putBlob(bytes: Uint8Array, expected?: string): { sha: string; size: number } {
  const sha = sha256(bytes)
  if (expected && expected !== sha) throw new Error('Blob checksum mismatch: the upload was corrupted or incomplete')
  const target = file(sha)
  if (!fs.existsSync(target)) {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`
    fs.writeFileSync(temp, bytes)
    fs.renameSync(temp, target)
  }
  return { sha, size: bytes.byteLength }
}

export function hasBlob(sha: string) {
  return HEX.test(sha) && fs.existsSync(file(sha))
}

export function readBlob(sha: string): Buffer {
  return fs.readFileSync(file(sha))
}

export function blobSize(sha: string) {
  return fs.statSync(file(sha)).size
}

/** Removes every blob whose name is not in `keep`. Returns the bytes freed. */
export function collectBlobs(keep: Set<string>) {
  const root = dataPath('blobs')
  if (!fs.existsSync(root)) return 0
  let freed = 0
  for (const dir of fs.readdirSync(root)) {
    const sub = path.join(root, dir)
    if (!fs.statSync(sub).isDirectory()) continue
    for (const name of fs.readdirSync(sub)) {
      if (!HEX.test(name) || keep.has(name)) continue
      const full = path.join(sub, name)
      freed += fs.statSync(full).size
      fs.rmSync(full)
    }
  }
  return freed
}
