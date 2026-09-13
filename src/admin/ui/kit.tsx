'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon, type IconName } from './icons'

/* ============================================================
   THE ADMIN'S SHARED PARTS

   Every section of the admin — the website editor, projects,
   media, history, audience, settings and the world editor — is
   built from these, styled by admin.css, so the whole panel reads
   as one application: the same header, the same tabs, the same
   switches, buttons, dialogs and states, the same words for the
   same things.
   ============================================================ */

export interface Tab { href: string; label: string; icon?: IconName; match?: RegExp }

/** Secondary navigation inside one area (Website: Pages · Projects · Media · History). */
export function Tabs({ tabs, label }: { tabs: Tab[]; label: string }) {
  const pathname = usePathname()
  return (
    <nav className="a-tabs" aria-label={label}>
      {tabs.map((t) => {
        const on = t.match ? t.match.test(pathname) : pathname === t.href
        return (
          <Link key={t.href} href={t.href} className="a-tab" aria-current={on ? 'page' : undefined}>
            {t.icon && <Icon name={t.icon} size={16} />}
            <span>{t.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export const WEBSITE_TABS: Tab[] = [
  { href: '/admin/pages', label: 'Pages', icon: 'pages' },
  { href: '/admin/projects', label: 'Projects', icon: 'projects', match: /^\/admin\/projects/ },
  { href: '/admin/media', label: 'Media', icon: 'media' },
  { href: '/admin/history', label: 'History', icon: 'history' },
]

/** The head of every admin page: where you are, what it is for, its actions, its tabs. */
export function PageHeader({ eyebrow, title, description, actions, tabs, compact = false }: { eyebrow?: string; title: ReactNode; description?: ReactNode; actions?: ReactNode; tabs?: ReactNode; compact?: boolean }) {
  return (
    <header className="a-pagehead" data-compact={compact || undefined}>
      <div className="a-pagehead-row">
        <div className="a-pagehead-text">
          {eyebrow && <p className="a-label">{eyebrow}</p>}
          <h1 className="a-title">{title}</h1>
          {description && <div className="a-sub">{description}</div>}
        </div>
        {actions && <div className="a-pagehead-actions">{actions}</div>}
      </div>
      {tabs}
    </header>
  )
}

/** An on/off setting. A real checkbox underneath (keyboard, forms, screen readers), drawn as a switch. */
export function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="a-switch-row">
      <label className="a-switch" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} aria-describedby={hint ? `${id}-hint` : undefined} onChange={(e) => onChange(e.target.checked)} />
        <span className="a-switch-track" aria-hidden="true"><span className="a-switch-thumb" /></span>
        <span className="a-switch-label">{label}</span>
      </label>
      {hint && <small id={`${id}-hint`} className="a-hint">{hint}</small>}
    </div>
  )
}

/** Arrow keys move the choice within a radio group, as the ARIA pattern has it; only the chosen option is in the tab order. */
export function radioKeys<T>(values: T[], value: T, onChange: (v: T) => void) {
  return (e: React.KeyboardEvent<HTMLElement>) => {
    const i = values.indexOf(value)
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = values[(i + step + values.length) % values.length]
    onChange(next)
    const group = e.currentTarget
    requestAnimationFrame(() => group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
  }
}

/** A small set of exclusive choices (device sizes, inherit/show/hide). */
export function Segmented<T extends string>({ value, options, onChange, label, size = 'md' }: { value: T; options: { value: T; label: ReactNode; title?: string; icon?: IconName }[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  return (
    <div className="a-seg" role="radiogroup" aria-label={label} data-size={size} onKeyDown={radioKeys(options.map((o) => o.value), value, onChange)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} tabIndex={value === o.value ? 0 : -1} title={o.title} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** A titled group of settings in a form. */
export function Panel({ title, description, actions, children, id }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="a-panel" id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className="a-panel-head">
        <div>
          <h2 id={id ? `${id}-title` : undefined}>{title}</h2>
          {description && <div className="a-sub">{description}</div>}
        </div>
        {actions}
      </header>
      <div className="a-panel-body">{children}</div>
    </section>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return <div className="notice" data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>{children}</div>
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="a-loading" role="status">
      <span className="a-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
      {action}
    </div>
  )
}

/** A modal dialog with the admin's frame: title, body, actions. Opens while `open` is true; Escape and the backdrop close it. */
export function Dialog({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} className="a-dialog" aria-labelledby={`${id}-title`} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose() }}>
      <div className="a-dialog-body">
        <h2 id={`${id}-title`} className="a-dialog-title">{title}</h2>
        {children}
        {actions && <div className="a-dialog-actions">{actions}</div>}
      </div>
    </dialog>
  )
}

/** Where a document stands: unsaved here, saved as a draft, or live. One wording everywhere. */
export function SaveState({ dirty, unpublished, busy }: { dirty: boolean; unpublished: boolean; busy?: string | null }) {
  const state = busy
    ? { tone: 'default', text: busy }
    : dirty
      ? { tone: 'warn', text: 'Unsaved changes' }
      : unpublished
        ? { tone: 'accent', text: 'Draft differs from the live site' }
        : { tone: 'ok', text: 'Live site is up to date' }
  return <span className="badge" data-tone={state.tone} role="status" aria-live="polite">{state.text}</span>
}
