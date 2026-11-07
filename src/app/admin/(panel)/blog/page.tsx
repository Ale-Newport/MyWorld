import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { BlogAdmin } from '@/admin/blog/BlogAdmin'

export const metadata = { title: 'Blog' }

export default function BlogPage() {
  if (!EDITOR) notFound()
  return <BlogAdmin />
}
