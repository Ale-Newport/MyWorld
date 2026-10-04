import { Fragment, type ReactNode } from 'react'
import type { RichText } from './schema'

/** Rich text is rendered as React elements only — never as HTML — so stored content cannot inject markup. */
export function richToPlain(text: RichText | undefined): string {
  if (text === undefined) return ''
  return typeof text === 'string' ? text : text.map((r) => r.t).join('')
}

function lines(text: string, key: string): ReactNode {
  const parts = text.split('\n')
  return parts.map((p, i) => <Fragment key={`${key}-${i}`}>{i > 0 && <br />}{p}</Fragment>)
}

export function renderRich(text: RichText | undefined): ReactNode {
  if (text === undefined) return null
  if (typeof text === 'string') return lines(text, 't')
  return text.map((run, i) => {
    let node: ReactNode = lines(run.t, `r${i}`)
    if (run.b) node = <strong>{node}</strong>
    if (run.i) node = <em>{node}</em>
    if (run.a) node = <a href={run.a} rel={run.a.startsWith('http') ? 'noopener noreferrer' : undefined} target={run.a.startsWith('http') ? '_blank' : undefined}>{node}</a>
    return <Fragment key={i}>{node}</Fragment>
  })
}
