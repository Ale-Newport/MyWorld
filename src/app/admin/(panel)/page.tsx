import { redirect } from 'next/navigation'

/* The admin opens on the website editor: there is no separate
   overview page — each area shows its own state where it is used. */
export default function AdminHome() {
  redirect('/admin/pages')
}
