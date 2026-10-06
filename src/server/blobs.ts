import { createHash } from 'node:crypto'
import { deleteObjects, getObject, listObjects, putObject, statObject } from './storage.ts'

/* ============================================================
   CONTENT-ADDRESSED BLOBS

   A blob's name is the SHA-256 of its bytes. Writing the same
   bytes twice stores them once, and a name can never point at
   different content. Only hex digests are accepted as names, so
   no caller can reach any other object (see storage.ts).
   ============================================================ */

const HEX = /^[a-f0-9]{64}$/

export function sha256(bytes: Uint8Array | string) {
  return createHash('sha256').update(bytes).digest('hex')
}

function key(sha: string) {
  if (!HEX.test(sha)) throw new Error('Invalid blob name')
  return `blobs/${sha}`
}

export async function putBlob(bytes: Uint8Array, expected?: string): Promise<{ sha: string; size: number }> {
  const sha = sha256(bytes)
  if (expected && expected !== sha) throw new Error('Blob checksum mismatch: the upload was corrupted or incomplete')
  if (!(await hasBlob(sha))) await putObject(key(sha), bytes)
  return { sha, size: bytes.byteLength }
}

export async function hasBlob(sha: string) {
  return HEX.test(sha) && !!(await statObject(key(sha)))
}

export async function readBlob(sha: string): Promise<Buffer | null> {
  return getObject(key(sha))
}

/** Removes every blob whose name is not in `keep` and that is older than `graceMs`. Returns what was freed. */
export async function collectBlobs(keep: Set<string>, { graceMs = 0 }: { graceMs?: number } = {}) {
  const cutoff = Date.now() - graceMs
  const doomed = (await listObjects('blobs')).filter((o) => {
    const name = o.key.slice('blobs/'.length)
    return HEX.test(name) && !keep.has(name) && o.createdAt <= cutoff
  })
  await deleteObjects(doomed.map((o) => o.key))
  return { files: doomed.length, bytes: doomed.reduce((n, o) => n + o.size, 0) }
}

/** What the store holds. */
export async function blobStats() {
  const all = (await listObjects('blobs')).filter((o) => HEX.test(o.key.slice('blobs/'.length)))
  return { files: all.length, bytes: all.reduce((n, o) => n + o.size, 0) }
}
