import { createHash, randomBytes } from 'node:crypto'
import { db, now } from './db.ts'
import { env } from './env.ts'

/* ============================================================
   THE CONTACT FORM'S SERVER SIDE

   A message is sent as a real email through Cloudflare Email
   Routing's `send_email` binding (CONTACT_EMAIL on the Worker,
   see docs/CONTACT.md), and only that counts as "sent". Without
   the binding (local development, or before Email Routing is set
   up) the route says so, and the page opens the visitor's own
   mail app with the message written out instead. Nothing is ever
   reported as sent that was not handed to the mail service.

   Abuse: same-origin requests only, a hidden field bots fill in,
   strict lengths, no line breaks in anything that becomes a mail
   header, and two limits counted in the database (per address
   per hour, and for the whole site per day), so the limits hold
   across Worker isolates.
   ============================================================ */

export const LIMITS = { name: 100, email: 200, message: 5000, minMessage: 10 } as const
const PER_ADDRESS = { window: 60 * 60 * 1000, max: 3 }
const PER_SITE = { window: 24 * 60 * 60 * 1000, max: 40 }

export interface ContactInput { name: string; email: string; message: string }
export type FieldErrors = Partial<Record<keyof ContactInput, string>>

// Deliberately simple: one @, no spaces or angle brackets, a dot in the domain. The mail service has the last word.
const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]{2,}$/
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/
const LINE_BREAK = /[\r\n\u2028\u2029]/

/** Checks and tidies what the form sent. Returns the clean message, or why each field was refused. */
export function validateContact(raw: unknown): { ok: true; value: ContactInput } | { ok: false; errors: FieldErrors } {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = (v: unknown) => (typeof v === 'string' ? v.normalize('NFC') : '')
  const name = text(body.name).trim()
  const email = text(body.email).trim()
  const message = text(body.message).replace(/\r\n?/g, '\n').trim()
  const errors: FieldErrors = {}
  if (!name) errors.name = 'Please tell me your name.'
  else if (name.length > LIMITS.name) errors.name = `Keep your name under ${LIMITS.name} characters.`
  else if (LINE_BREAK.test(name) || CONTROL.test(name)) errors.name = 'Your name cannot contain line breaks.'
  if (!email) errors.email = 'I need an address to reply to.'
  else if (email.length > LIMITS.email || !EMAIL.test(email)) errors.email = 'That does not look like an email address.'
  if (message.length < LIMITS.minMessage) errors.message = `Write at least ${LIMITS.minMessage} characters.`
  else if (message.length > LIMITS.message) errors.message = `Keep it under ${LIMITS.message} characters (or send it by email).`
  else if (CONTROL.test(message)) errors.message = 'The message contains characters that cannot be sent.'
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: { name, email, message } }
}

/** RFC 2047: a header value as UTF-8 base64 when it is not plain ASCII. */
const encodeHeader = (v: string) => (/^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`)
const wrap76 = (s: string) => s.replace(/.{1,76}/g, '$&\r\n')

/** The email as raw MIME text: plain text, UTF-8, the visitor in Reply-To so "Reply" answers them. */
export function buildContactEmail(input: ContactInput, { from, to, site, date = new Date(), id = randomBytes(12).toString('hex') }: { from: string; to: string; site: string; date?: Date; id?: string }): string {
  for (const v of [input.name, input.email, from, to, site]) if (LINE_BREAK.test(v) || CONTROL.test(v)) throw new Error('A header value contains a line break.')
  const domain = from.split('@')[1] ?? 'localhost'
  const body = `${input.message}\n\n--\n${input.name} <${input.email}>\nSent from the contact form on ${site}\n`
  const headers = [
    `From: ${encodeHeader('Portfolio contact form')} <${from}>`,
    `To: <${to}>`,
    `Reply-To: ${encodeHeader(input.name.replace(/["\\]/g, ''))} <${input.email}>`,
    `Subject: ${encodeHeader(`Message from ${input.name} via ${site}`)}`,
    `Date: ${date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: base64',
  ]
  return `${headers.join('\r\n')}\r\n\r\n${wrap76(Buffer.from(body, 'utf8').toString('base64'))}`
}

/** A `mailto:` link that carries the message, for when the server cannot send it. */
export function mailtoFor(to: string, input?: Partial<ContactInput>): string {
  if (!input?.message) return `mailto:${to}`
  const q = new URLSearchParams({ subject: `Hello from ${input.name || 'your portfolio'}`, body: input.message })
  return `mailto:${to}?${q.toString().replace(/\+/g, '%20')}`
}

/* ---- delivery ---------------------------------------------------------- */

interface SendEmail { send(message: unknown): Promise<unknown> }

/** The Worker's `send_email` binding, when this deployment has one. */
async function binding(): Promise<SendEmail | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const b = (getCloudflareContext().env as unknown as Record<string, unknown>).CONTACT_EMAIL as SendEmail | undefined
    return b && typeof b.send === 'function' ? b : null
  } catch {
    return null
  }
}

export interface Delivery { from: string; to: string; send: (raw: string) => Promise<void> }

/** How a message would be delivered right now, or null when this deployment cannot send email. */
export async function delivery(siteUrl: string, fallbackTo: string): Promise<Delivery | null> {
  const mail = await binding()
  if (!mail) return null
  let host = 'localhost'
  try { host = new URL(siteUrl).host.replace(/^www\./, '') } catch { /* keep localhost */ }
  const from = env('CONTACT_FROM') ?? `contact@${host}`
  const to = env('CONTACT_TO') ?? fallbackTo
  return {
    from, to,
    send: async (raw) => {
      // Provided by workerd at run time; a variable keeps the bundlers from trying to resolve it at build time.
      const specifier = 'cloudflare:email'
      const { EmailMessage } = await import(/* turbopackIgnore: true */ /* webpackIgnore: true */ specifier)
      await mail.send(new EmailMessage(from, to, raw))
    },
  }
}

/* ---- limits -------------------------------------------------------------- */

const hashKey = (v: string) => createHash('sha256').update(`contact|${env('CMS_SECRET') ?? ''}|${v}`).digest('hex').slice(0, 32)

/** Counts one use of `key` in its window and says whether it is over the limit. Stored in login_attempts, under a contact: prefix. */
async function count(key: string, { window, max }: { window: number; max: number }): Promise<{ over: boolean; retryAfter: number }> {
  const at = now()
  const d = await db()
  const row = await d.get<{ failures: number; first_at: number }>(
    `insert into login_attempts (key, failures, first_at, locked_until) values (?, 1, cast(? as bigint), null)
     on conflict(key) do update set
       failures = case when cast(? as bigint) - login_attempts.first_at > cast(? as bigint) then 1 else login_attempts.failures + 1 end,
       first_at = case when cast(? as bigint) - login_attempts.first_at > cast(? as bigint) then excluded.first_at else login_attempts.first_at end
     returning failures, first_at`,
    [key, at, at, window, at, window],
  )
  const failures = Number(row?.failures ?? 1)
  const first = Number(row?.first_at ?? at)
  return { over: failures > max, retryAfter: Math.max(1, Math.ceil((first + window - at) / 1000)) }
}

/** Both limits; the per-address one first, so one sender cannot use up the site's allowance. */
export async function overLimit(ip: string): Promise<{ over: boolean; retryAfter: number }> {
  const mine = await count(`contact:ip:${hashKey(ip)}`, PER_ADDRESS)
  if (mine.over) return mine
  return count('contact:site', PER_SITE)
}
