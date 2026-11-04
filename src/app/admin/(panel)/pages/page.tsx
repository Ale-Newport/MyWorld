import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { ContentEditor } from '@/admin/website/ContentEditor'

export const metadata = { title: 'Website · Pages' }

export default function PagesPage() {
  if (!EDITOR) notFound()
  return <ContentEditor />
}
