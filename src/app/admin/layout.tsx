import type { Metadata, Viewport } from 'next'
import '@/admin/admin.css'

/* The administration panel. Never indexed, never framed by another site
   (src/proxy.ts), and every page under it checks the session on the server. */
export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s — Admin' },
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = { themeColor: '#f4f2ee' }

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <div className="admin-root">{children}</div>
}
