import { editorApi, json } from '@/server/auth/guard'
import { publishWorldWithGit } from '@/server/publish'
import { audit } from '@/server/audit'

export const runtime = 'nodejs'
export const maxDuration = 120

/* Validate the draft world (structure, references, physics values), make it
   the one /world and its map load, and commit it to the repository as the world
   the deployed site ships. A failed validation changes nothing. */
export const POST = editorApi(async (req, { actor }) => {
  const body = (await req.json().catch(() => ({}))) as { revision?: string }
  try {
    return json(await publishWorldWithGit({ revisionId: body.revision, actor }))
  } catch (error) {
    audit(actor, 'error.publish', { docId: 'world', detail: (error as Error).message })
    throw error
  }
})
