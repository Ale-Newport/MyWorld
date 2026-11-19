'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import styles from './ContactForm.module.css'

/* ============================================================
   WRITE TO ME — the contact page's form

   Opened from the "Message" row under the links (or the
   terminal's `message` command). It asks the server how a
   message travels (/api/contact): as an email the site sends,
   or, when this deployment cannot send email, through the
   visitor's own mail app with everything already written. The
   page only ever says "sent" when the server says it sent it.
   ============================================================ */

const LIMITS = { name: 100, email: 200, message: 5000, minMessage: 10 }
const EMAIL = /^[^\s@<>()"',;:\\]+@[^\s@<>()"',;:\\]+\.[^\s@<>()"',;:\\]{2,}$/

type Field = 'name' | 'email' | 'message'
type Errors = Partial<Record<Field, string>>
type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  | { kind: 'mailto'; href: string; reason?: string }
  | { kind: 'error'; message: string; href?: string }

function check(v: Record<Field, string>): Errors {
  const e: Errors = {}
  if (!v.name.trim()) e.name = 'Please tell me your name.'
  else if (v.name.trim().length > LIMITS.name) e.name = `Keep your name under ${LIMITS.name} characters.`
  if (!v.email.trim()) e.email = 'I need an address to reply to.'
  else if (!EMAIL.test(v.email.trim())) e.email = 'That does not look like an email address.'
  if (v.message.trim().length < LIMITS.minMessage) e.message = `Write at least ${LIMITS.minMessage} characters.`
  else if (v.message.trim().length > LIMITS.message) e.message = `Keep it under ${LIMITS.message} characters.`
  return e
}

function mailto(address: string, v: Record<Field, string>) {
  const q = new URLSearchParams({ subject: `Hello from ${v.name.trim() || 'your portfolio'}`, body: v.message.trim() })
  return `mailto:${address}?${q.toString().replace(/\+/g, '%20')}`
}

export function ContactForm({ address, open, onClose }: { address: string; open: boolean; onClose: () => void }) {
  const id = useId()
  const [values, setValues] = useState<Record<Field, string>>({ name: '', email: '', message: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [route, setRoute] = useState<'email' | 'mailto' | 'unknown'>('unknown')
  const honeypot = useRef<HTMLInputElement>(null)
  const first = useRef<HTMLInputElement>(null)
  const panel = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (!open) return
    first.current?.focus({ preventScroll: true })
    panel.current?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    if (route !== 'unknown') return
    const ask = new AbortController()
    fetch('/api/contact', { signal: ask.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { delivery?: string } | null) => setRoute(d?.delivery === 'email' ? 'email' : 'mailto'))
      .catch(() => { if (!ask.signal.aborted) setRoute('mailto') })
    return () => ask.abort()
  }, [open, route])

  if (!open) return null

  const set = (f: Field) => (e: { target: { value: string } }) => {
    setValues((v) => ({ ...v, [f]: e.target.value }))
    if (errors[f]) setErrors((x) => ({ ...x, [f]: undefined }))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found = check(values)
    setErrors(found)
    const firstBad = (['name', 'email', 'message'] as Field[]).find((f) => found[f])
    if (firstBad) { document.getElementById(`${id}-${firstBad}`)?.focus(); return }

    const handOff = (reason?: string) => {
      const href = mailto(address, values)
      setStatus({ kind: 'mailto', href, reason })
      window.location.href = href
    }
    if (route === 'mailto') { handOff(); return }

    setStatus({ kind: 'sending' })
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...values, website: honeypot.current?.value ?? '' }),
      })
      const data = (await res.json().catch(() => ({}))) as { sent?: boolean; error?: string; fields?: Errors; fallback?: string }
      if (res.ok && data.sent) { setStatus({ kind: 'sent' }); setValues({ name: '', email: '', message: '' }); return }
      if (res.status === 400 && data.fields) { setErrors(data.fields); setStatus({ kind: 'idle' }); return }
      if (data.fallback === 'mailto') {
        if (res.status === 503) setRoute('mailto')
        handOff(res.status === 429 ? 'You have sent several messages in a short time, so this one goes through your mail app.' : 'The site could not send it, so it goes through your mail app instead.')
        return
      }
      setStatus({ kind: 'error', message: data.error ?? 'The message could not be sent.', href: mailto(address, values) })
    } catch {
      setStatus({ kind: 'error', message: 'You seem to be offline, so the message was not sent.', href: mailto(address, values) })
    }
  }

  const field = (f: Field) => ({
    id: `${id}-${f}`,
    name: f,
    value: values[f],
    onChange: set(f),
    'aria-invalid': errors[f] ? true : undefined,
    'aria-describedby': errors[f] ? `${id}-${f}-error` : undefined,
  })
  const busy = status.kind === 'sending'

  return (
    <form ref={panel} className={styles.form} onSubmit={submit} noValidate aria-labelledby={`${id}-title`}>
      <div className={styles.head}>
        <h2 id={`${id}-title`} className={styles.title}>Write to me</h2>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close the message form">Close</button>
      </div>

      <div className={styles.row}>
        <label className={styles.field}>
          <span className={styles.label}>Name</span>
          <input ref={first} {...field('name')} autoComplete="name" maxLength={LIMITS.name} required />
          {errors.name && <span id={`${id}-name-error`} className={styles.error}>{errors.name}</span>}
        </label>
        <label className={styles.field}>
          <span className={styles.label}>Your email</span>
          <input {...field('email')} type="email" autoComplete="email" inputMode="email" maxLength={LIMITS.email} required />
          {errors.email && <span id={`${id}-email-error`} className={styles.error}>{errors.email}</span>}
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>Message</span>
        <textarea {...field('message')} rows={5} maxLength={LIMITS.message} required />
        {errors.message && <span id={`${id}-message-error`} className={styles.error}>{errors.message}</span>}
      </label>

      {/* Hidden from people and from assistive technology; a bot that fills every field fills this one too. */}
      <div className={styles.trap} aria-hidden="true">
        <label>Website<input ref={honeypot} name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>

      <div className={styles.foot}>
        <button type="submit" className={styles.send} disabled={busy} data-cursor="link">
          {busy ? 'Sending…' : route === 'mailto' ? 'Open in my mail app' : 'Send message'}
        </button>
        <p className={styles.note}>
          {route === 'mailto'
            ? <>Your mail app opens with this message ready to send to <a href={`mailto:${address}`}>{address}</a>.</>
            : <>Sent to <a href={`mailto:${address}`}>{address}</a>. I reply from there.</>}
        </p>
      </div>

      <div className={styles.status} role="status" aria-live="polite">
        {status.kind === 'sent' && <p data-tone="ok">Thank you — your message was sent. I will reply to the address you gave.</p>}
        {status.kind === 'mailto' && (
          <p>
            {status.reason ? `${status.reason} ` : ''}Your mail app should now be open with the message; press send there.
            {' '}Nothing opened? <a href={status.href}>Try again</a> or write to <a href={`mailto:${address}`}>{address}</a>.
          </p>
        )}
        {status.kind === 'error' && (
          <p data-tone="error">
            {status.message} {status.href && <><a href={status.href}>Send it from your mail app</a> instead.</>}
          </p>
        )}
      </div>
    </form>
  )
}
