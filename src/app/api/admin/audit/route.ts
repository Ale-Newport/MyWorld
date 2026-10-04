import { adminApi, json } from '@/server/auth/guard'
import { recentAudit } from '@/server/audit'

export const runtime = 'nodejs'

export const GET = adminApi(async (req) => {
  const before = Number(req.nextUrl.searchParams.get('before')) || undefined
  return json({ entries: recentAudit({ limit: 100, before }) })
})
