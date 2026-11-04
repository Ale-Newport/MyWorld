import { notFound } from 'next/navigation'
import { EDITOR } from '@/server/mode'
import { HistoryView } from '@/admin/HistoryView'

export const metadata = { title: 'History' }

export default function HistoryPage() {
  if (!EDITOR) notFound()
  return <HistoryView />
}
