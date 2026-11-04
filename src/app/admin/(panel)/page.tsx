import { redirect } from 'next/navigation'
import { EDITOR } from '@/server/mode'

/* The admin opens on the website editor (on your machine) or on the settings
   (deployed): there is no separate overview page. */
export default function AdminHome() {
  redirect(EDITOR ? '/admin/pages' : '/admin/settings')
}
