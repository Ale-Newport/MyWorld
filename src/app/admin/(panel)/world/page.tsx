import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { WorldAdmin } from '@/admin/WorldAdmin'

export const metadata = { title: 'World editor' }

export default function WorldEditorPage() {
  if (!EDITOR) notFound()
  return <WorldAdmin />
}
