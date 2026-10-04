'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { useDirty, useSiteStore, useUnpublished } from './store/site'
import { typingTarget } from './keys'

/* Save · undo · redo · publish, the draft's state in words, and the
   conflict dialog. Cmd/Ctrl+S saves and Cmd/Ctrl+Z / Shift+Cmd+Z undo
   and redo — but never while focus is in a text field, where those keys
   belong to the field. */
export function DraftBar({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  const s = useSiteStore()
  const dirty = useDirty()
  const unpublished = useUnpublished()
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (s.conflict) dialog.current?.showModal()
    else dialog.current?.close()
  }, [s.conflict])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (e.key.toLowerCase() === 's') { e.preventDefault(); void useSiteStore.getState().save(); return }
      if (typingTarget(e.target)) return
      if (e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) useSiteStore.getState().redo(); else useSiteStore.getState().undo() }
      if (e.key.toLowerCase() === 'y') { e.preventDefault(); useSiteStore.getState().redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (useSiteStore.getState().version !== useSiteStore.getState().savedVersion) e.preventDefault() }
    window.addEventListener('beforeunload', onLeave)
    return () => window.removeEventListener('beforeunload', onLeave)
  }, [])

  const state = dirty ? { tone: 'warn', text: 'Unsaved changes' } : unpublished ? { tone: 'accent', text: 'Draft differs from the live site' } : { tone: 'ok', text: 'Live site is up to date' }
  return (
    <>
      <div className="row" role="toolbar" aria-label="Draft">
        {children}
        <span className="badge" data-tone={state.tone} role="status">{state.text}</span>
        <div className="btn-group">
          <button type="button" className="btn btn-icon" onClick={() => s.undo()} disabled={!s.past.length} title="Undo (⌘Z)" aria-label="Undo">↶</button>
          <button type="button" className="btn btn-icon" onClick={() => s.redo()} disabled={!s.future.length} title="Redo (⇧⌘Z)" aria-label="Redo">↷</button>
        </div>
        <button type="button" className="btn" onClick={() => void s.save()} disabled={!dirty || s.saving} title="Save draft (⌘S)">{s.saving ? 'Saving…' : compact ? 'Save' : 'Save draft'}</button>
        <button type="button" className="btn btn-accent" onClick={() => void s.publish()} disabled={s.publishing || (!dirty && !unpublished)}>{s.publishing ? 'Publishing…' : 'Publish'}</button>
      </div>
      <dialog ref={dialog} className="a-dialog" onClose={() => s.dismissConflict()} aria-labelledby="conflict-title">
        <div className="stack">
          <h2 id="conflict-title" style={{ fontSize: 17, fontWeight: 600 }}>Someone else saved this draft</h2>
          <p className="a-sub">{s.conflict?.message} Latest save: {s.conflict?.head.draft ? `${new Date(s.conflict.head.draft.createdAt).toLocaleString()} by ${s.conflict.head.draft.authorName ?? 'unknown'}` : 'unknown'}.</p>
          <p className="a-sub">Load their version (your unsaved edits here are discarded), or keep yours and save it on top of theirs.</p>
          <div className="row">
            <button type="button" className="btn" onClick={() => void s.load(true)}>Load the latest draft</button>
            <button type="button" className="btn btn-danger" onClick={() => void s.save('Overwrote a concurrent edit', { force: true })}>Keep mine and overwrite</button>
            <span className="spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => s.dismissConflict()}>Cancel</button>
          </div>
        </div>
      </dialog>
    </>
  )
}
