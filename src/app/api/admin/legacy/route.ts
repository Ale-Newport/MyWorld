import { adminApi, json, problem } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { clearLegacy, legacyStats } from '@/server/legacy'

export const runtime = 'nodejs'
export const maxDuration = 120

/* What is left of the old content store, and (on an explicit confirmation) removing it.
   The deployed admin only: the editor's own store is its drafts. */
export const GET = adminApi(async () => {
  if (EDITOR) return problem(404, 'Not found.')
  return json(await legacyStats())
})

export const POST = adminApi(async (req, { actor }) => {
  if (EDITOR) return problem(404, 'Not found.')
  const body = (await req.json().catch(() => ({}))) as { confirm?: string }
  if (body.confirm !== 'delete-old-content') return problem(400, 'Send { confirm: "delete-old-content" }.')
  return json({ removed: await clearLegacy(actor) })
})
