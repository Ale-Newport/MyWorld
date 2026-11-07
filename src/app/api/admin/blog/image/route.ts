import { adminApi, json, problem } from '@/server/auth/guard'
import { EDITOR } from '@/server/mode'
import { contentTarget, NOT_CONFIGURED } from '@/server/github'
import { commitImage, MAX_IMAGE_BYTES, mimeOf, readBytes, UPLOAD_DIR, UPLOAD_NAME } from '@/server/blog-publish'
import { ValidationError } from '@/server/errors'

export const runtime = 'nodejs'

/* ============================================================
   A POST'S IMAGES, FROM THE DEPLOYED ADMIN

   POST: an image (the form field "file") is checked by what its
   bytes are — PNG, JPEG, WebP, GIF or AVIF, at most 5 MB — and
   committed as public/uploads/blog/<content hash>.<ext>; the answer
   is the address a post uses (/uploads/blog/…).

   GET ?name=…: that image read back from GitHub, for the admin's
   preview until the site has rebuilt with it. Only stored names are
   accepted, so nothing else in the repository can be read here.
   ============================================================ */

export const POST = adminApi(async (req, { actor }) => {
  if (EDITOR) return problem(404, 'Not found.')
  const t = contentTarget()
  if (!t) throw new ValidationError(NOT_CONFIGURED)
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob)) return problem(400, 'Send the image as the form field "file".')
  if (file.size > MAX_IMAGE_BYTES) throw new ValidationError(`Images can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
  return json(await commitImage(t, new Uint8Array(await file.arrayBuffer()), actor.name || 'the admin'), 201)
})

export const GET = adminApi(async (req) => {
  if (EDITOR) return problem(404, 'Not found.')
  const name = req.nextUrl.searchParams.get('name') ?? ''
  const t = contentTarget()
  if (!UPLOAD_NAME.test(name) || !t) return problem(404, 'Not found.')
  const bytes = await readBytes(t, `${UPLOAD_DIR}/${name}`)
  if (!bytes) return problem(404, 'Not found.')
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': mimeOf(name),
      // Named by content: the same name is always the same picture.
      'cache-control': 'private, max-age=86400, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    },
  })
})
