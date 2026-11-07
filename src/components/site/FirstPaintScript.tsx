'use client'

import { useSyncExternalStore } from 'react'

const never = () => () => {}

/**
 * An inline script for the first paint of a document: in the server's HTML, kept through hydration, and never
 * created by a client-side render — where React would not run it anyway, and says so in the console. A route
 * entered by a client navigation (the way into /world, a `notFound()`) has its own effect for the same job.
 */
export function FirstPaintScript({ code }: { code: string }) {
  const firstDocument = useSyncExternalStore(never, () => false, () => true)
  return firstDocument ? <script dangerouslySetInnerHTML={{ __html: code }} /> : null
}
