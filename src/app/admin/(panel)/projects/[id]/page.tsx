import { ProjectEditor } from '@/admin/projects/ProjectEditor'

export const metadata = { title: 'Edit project' }

export default async function ProjectEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ProjectEditor id={decodeURIComponent(id)} />
}
