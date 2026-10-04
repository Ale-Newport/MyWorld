import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import '@/styles/globals.css'

/* The document shell every route shares. What a public page says
   about itself (title, description, Open Graph, structured data)
   comes from the site document in app/(site)/layout.tsx; the admin
   declares its own in app/admin/layout.tsx. */
export const metadata: Metadata = {
  title: { default: 'Alejandro Newport', template: '%s — Alejandro Newport' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
