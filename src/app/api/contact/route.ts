import type { NextRequest } from 'next/server'
import { json, problem } from '@/server/auth/guard'
import { buildContactEmail, delivery, mailtoFor, overLimit, validateContact } from '@/server/contact'
import { publishedSite } from '@/server/site'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/* The contact form (components/contact/ContactForm.tsx). See server/contact.ts.
   GET says how a message will travel; POST sends one, or says it cannot and how to write instead. */

async function target() {
  const site = (await publishedSite()).doc
  const mail = site.contact.find((c) => c.href.startsWith('mailto:'))
  const address = mail ? decodeURIComponent(mail.href.slice('mailto:'.length).split('?')[0]) : null
  return { site, address }
}

export async function GET() {
  const { site, address } = await target()
  const route = address ? await delivery(site.settings.siteUrl, address) : null
  return json({ delivery: route ? 'email' : 'mailto', address })
}

/** A public form: the request must come from a page of this site, said explicitly by the browser. */
function fromThisSite(req: NextRequest) {
  const origin = req.headers.get('origin')
  const fetchSite = req.headers.get('sec-fetch-site')
  if (!origin || (fetchSite && fetchSite !== 'same-origin')) return false
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host')
  try { return new URL(origin).host === host } catch { return false }
}

export async function POST(req: NextRequest) {
  if (!fromThisSite(req)) return problem(403, 'Messages can only be sent from the contact page.')
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return problem(415, 'Send the form as JSON.')
  const raw = await req.text().catch(() => '')
  if (raw.length > 16_000) return problem(413, 'That message is too long to send here.')
  let body: Record<string, unknown>
  try { body = JSON.parse(raw) } catch { return problem(400, 'The form could not be read.') }

  // The hidden field only a bot fills in. Refused openly: nothing pretends to have been sent.
  if (typeof body.website === 'string' && body.website.trim()) return problem(400, 'The form could not be sent.')

  const checked = validateContact(body)
  if (!checked.ok) return problem(400, 'Please check the highlighted fields.', { fields: checked.errors })
  const message = checked.value

  const { site, address } = await target()
  if (!address) return problem(503, 'There is no address to send this to.')
  const fallback = { fallback: 'mailto', mailto: mailtoFor(address, message), address }
  const route = await delivery(site.settings.siteUrl, address)
  if (!route) return problem(503, 'This site cannot send email yet.', fallback)

  const ip = (req.headers.get('cf-connecting-ip') ?? 'local').trim().slice(0, 64)
  let limit: { over: boolean; retryAfter: number }
  try {
    limit = await overLimit(ip)
  } catch (error) {
    console.error('[contact] the limit store is unavailable:', (error as Error).message)
    return problem(503, 'The form is unavailable right now.', fallback)
  }
  if (limit.over) return problem(429, 'Too many messages for now.', { ...fallback, retryAfter: limit.retryAfter })

  let host = 'this site'
  try { host = new URL(site.settings.siteUrl).host } catch { /* keep the default */ }
  try {
    await route.send(buildContactEmail(message, { from: route.from, to: route.to, site: host }))
  } catch (error) {
    console.error('[contact] sending failed:', (error as Error).message)
    return problem(502, 'The message could not be sent.', fallback)
  }
  return json({ sent: true })
}
