import { adminApi, json, problem } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { tokenStatus } from '@/server/github'

export const runtime = 'nodejs'

/* How long the GitHub token has left (the deployed admin only: the editor pushes with your own git login). */
export const GET = adminApi(async (req) => {
  if (EDITOR) return problem(404, 'Not found.')
  return json(await tokenStatus({ fresh: req.nextUrl.searchParams.get('fresh') === '1' }))
})
