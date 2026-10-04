import { draftMode } from 'next/headers'
import { adminApi, json } from '@/server/auth/guard'

export const runtime = 'nodejs'

/* Draft Mode for this browser only. The public pages still check the admin
   session before serving a draft (server/site.ts), so the bypass cookie on
   its own shows nothing that is not published. */
export const POST = adminApi(async () => {
  ;(await draftMode()).enable()
  return json({ preview: true })
})

export const DELETE = adminApi(async () => {
  ;(await draftMode()).disable()
  return json({ preview: false })
})
