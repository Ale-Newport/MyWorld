import type { Metadata, Viewport } from 'next'
import { fontVariables } from '@/styles/fonts'
import '@/styles/globals.css'

/* The document shell every route shares. What a public page says
   about itself (title, description, Open Graph, structured data)
   comes from the site document in app/(site)/layout.tsx; the admin
   declares its own in app/admin/layout.tsx. */
export const metadata: Metadata = {
  // No template here: (site) and admin each set their own, and a parent
  // template would be applied to the site's own default title too.
  title: 'Alejandro Newport',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
