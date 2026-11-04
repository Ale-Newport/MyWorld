import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { MediaAdmin } from '@/admin/MediaAdmin'

export const metadata = { title: 'Media' }

export default function MediaPage() {
  if (!EDITOR) notFound()
  return <MediaAdmin />
}
