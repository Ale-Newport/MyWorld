import { adminApi, json } from '@/server/auth/guard'
import { maintain, storeStats } from '@/server/maintenance'

export const runtime = 'nodejs'

/* What the store holds, and "clean up now". */
export const GET = adminApi(async () => json(storeStats()))
export const POST = adminApi(async (_req, { actor }) => json(maintain({ actor, force: true })))
