import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { ProjectEditor } from '@/admin/projects/ProjectEditor'

export const metadata = { title: 'Edit project' }

export default async function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  if (!EDITOR) notFound()
  const { id } = await params
  return <ProjectEditor id={decodeURIComponent(id)} />
}
