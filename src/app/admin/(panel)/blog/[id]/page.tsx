import { redirect } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { PostEditor } from '@/admin/blog/PostEditor'

export const metadata = { title: 'Edit post' }

export default async function PostEditorPage({ params }: { params: Promise<{ id: string }> }) {
  // The editor on your machine does not write posts: its blog page says where they are written.
  if (EDITOR) redirect('/admin/blog')
  const { id } = await params
  return <PostEditor id={decodeURIComponent(id)} />
}
