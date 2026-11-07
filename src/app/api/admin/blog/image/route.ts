import { adminApi, json, problem } from '@/server/auth/guard'
import { MAX_IMAGE_BYTES, saveBlogImage } from '@/server/blog'

export const runtime = 'nodejs'

/* A picture for a post (the form field "file"): checked by what its bytes are — PNG, JPEG,
   WebP, GIF or AVIF, at most 5 MB — and put in the media library. The answer is the address
   the post uses, /blog-media/<id>/<name>, which serves it at once. */
export const POST = adminApi(async (req, { actor }) => {
  if (Number(req.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES + 64 * 1024) return problem(413, `Pictures can be at most ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`)
  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof Blob)) return problem(400, 'Send the picture as the form field "file".')
  const name = file instanceof File && file.name ? file.name : 'picture'
  const { item, url } = await saveBlogImage(new Uint8Array(await file.arrayBuffer()), name, actor)
  return json({ url, item: { id: item.id, filename: item.filename, width: item.width, height: item.height, size: item.size } }, 201)
})
