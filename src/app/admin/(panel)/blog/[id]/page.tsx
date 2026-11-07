import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { PostEditor } from '@/admin/blog/PostEditor'

export const metadata = { title: 'Edit post' }

export default async function PostEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!EDITOR) notFound()
  const { id } = await params
  return <PostEditor id={decodeURIComponent(id)} />
}
