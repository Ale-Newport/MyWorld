'use client'

import { api } from '../api'

/* ============================================================
   A PICTURE FOR A POST

   Phones take photos of many megabytes and thousands of pixels; a
   post shows them at most a column wide. So a large photo is drawn
   down to 2400 px on its long edge and re-encoded as WebP here,
   before it leaves the browser (JPEG where the browser cannot write
   WebP; PNG kept as PNG then, for its transparency). GIFs are sent
   as they are, to keep their frames. The server checks again what
   the bytes are, and the size, before it keeps them in the media
   library (server/blog.ts); they are served at once.
   ============================================================ */

export const MAX_BYTES = 5 * 1024 * 1024
const MAX_EDGE = 2400
const REENCODE_ABOVE = 1.5 * 1024 * 1024
export const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif'

const encode = (canvas: HTMLCanvasElement, type: string, quality?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))

export async function prepareImage(file: File): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp|avif)$/.test(file.type)) return file
  let bitmap: ImageBitmap
  try { bitmap = await createImageBitmap(file) } catch { return file }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  if (scale === 1 && file.size <= REENCODE_ABOVE) { bitmap.close(); return file }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  let blob = await encode(canvas, 'image/webp', 0.86)
  if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88)
  // Drawn smaller, the new file is the one to send; only re-encoded, it must also be lighter.
  return blob && (scale < 1 || blob.size < file.size) ? blob : file
}

/** Prepare, check and upload a picture. Returns its address on the site (/blog-media/<id>/<name>). */
export async function uploadImage(file: File): Promise<string> {
  const blob = await prepareImage(file)
  if (blob.size > MAX_BYTES) throw new Error(`That picture is ${(blob.size / 1024 / 1024).toFixed(1)} MB even after resizing; the limit is 5 MB.`)
  const form = new FormData()
  // The file's own name, for a readable address (the server gives it the extension of what the bytes are).
  form.append('file', blob, file.name || 'picture')
  return (await api<{ url: string }>('/api/admin/blog/image', { method: 'POST', body: form })).url
}
