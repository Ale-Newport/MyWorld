import { editorApi, json } from '@/server/auth/guard'
import { maintain, storeStats } from '@/server/maintenance'

export const runtime = 'nodejs'

/* What the store holds, and "clean up now". */
export const GET = editorApi(async () => json(await storeStats()))
export const POST = editorApi(async (_req, { actor }) => json(await maintain({ actor, force: true })))
