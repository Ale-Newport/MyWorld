import { SettingsAdmin, SiteImagesAdmin } from '@/admin/SettingsAdmin'
import { EDITOR } from '@/server/mode'

export const metadata = { title: 'Settings' }

/* The deployed admin edits the settings (and publishes them as a commit). The editor edits only what that
   cannot: the images, which come from the media library on this machine. */
export default function SettingsPage() {
  return EDITOR ? <SiteImagesAdmin /> : <SettingsAdmin />
}
