import type { Metadata } from 'next'
import { loadSite } from '@/server/site'
import { publicSiteUrl } from '@/lib/site-url'
import { ContactPage } from '@/components/contact/ContactPage'

/* ============================================================
   /contact
   The home page's closing words and its links, given a page of
   their own: no scrub, no room, no portal — a calm sheet of cream
   that answers "how do I reach him?" on the first screen. And a
   small terminal floating beside them, for visitors who would
   rather type than click (components/contact/Terminal).

   Everything it prints is the published site document's, read
   in the layout; this file only says what the page is called.
   ============================================================ */

export async function generateMetadata(): Promise<Metadata> {
  const { doc } = await loadSite()
  const { name, year } = doc.profile
  const channels = doc.contact.map((c) => c.label)
  const listed = channels.length > 1 ? `${channels.slice(0, -1).join(', ')} and ${channels[channels.length - 1]}` : channels[0] ?? 'email'
  const description = `Get in touch with ${name} — ${listed} — or explore the site from a small terminal (type help).`
  const image = doc.settings.ogImage ?? '/og-image.png'
  return {
    title: 'Contact',
    description,
    alternates: { canonical: '/contact' },
    openGraph: {
      type: 'website',
      locale: 'en_GB',
      url: `${publicSiteUrl(doc.settings.siteUrl)}/contact`,
      title: `Contact — ${name}`,
      description,
      siteName: `${name} — Portfolio ${year}`,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: `Contact — ${name}`, description, images: [image] },
    robots: { index: true, follow: true },
  }
}

export default function ContactRoute() {
  return <ContactPage />
}
