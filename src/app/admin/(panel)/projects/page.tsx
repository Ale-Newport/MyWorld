import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { ProjectsAdmin } from '@/admin/projects/ProjectsAdmin'

export const metadata = { title: 'Projects' }

export default function ProjectsPage() {
  if (!EDITOR) notFound()
  return <ProjectsAdmin />
}
