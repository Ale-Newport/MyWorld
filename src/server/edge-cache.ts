import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { EdgeStore } from './blob-response.ts'

/* Cloudflare's own cache for this data centre (the Workers Cache API). It exists
   only on Workers: everywhere else (Node, `next dev`, tests) these return
   nothing and the code that uses them behaves exactly as it always did. */

/** `caches.default` on Cloudflare; null elsewhere. */
export function edgeStore(): EdgeStore | null {
  const storage = (globalThis as { caches?: { default?: EdgeStore } }).caches
  return storage?.default ?? null
}

/** Lets work finish after the response has been sent (on Workers); otherwise it simply runs on. */
export function waitUntil(promise: Promise<unknown>): void {
  try {
    getCloudflareContext().ctx.waitUntil(promise)
  } catch {
    promise.catch(() => {})
  }
}
