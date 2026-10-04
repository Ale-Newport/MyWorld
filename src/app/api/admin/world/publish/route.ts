import { adminApi, json } from '@/server/auth/guard'
import { publishWorld } from '@/server/world'
import { audit } from '@/server/audit'

export const runtime = 'nodejs'
export const maxDuration = 120

/* Validate the draft world (structure, references, physics values) and make
   it the one /world and its map load. A failed validation changes nothing. */
export const POST = adminApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => ({}))) as { revision?: string }
  try {
    const revision = await publishWorld({ revisionId: body.revision, actor })
    return json({ revision })
  } catch (error) {
    audit(actor, 'error.publish', { docId: 'world', detail: (error as Error).message })
    throw error
  }
})
