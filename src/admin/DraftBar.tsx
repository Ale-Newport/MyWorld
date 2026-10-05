'use client'

import { useEffect, type ReactNode } from 'react'
import { useDirty, useSiteStore, useUnpublished } from './store/site'
import { typingTarget } from './keys'
import { Dialog, SaveState } from './ui/kit'
import { Icon } from './ui/icons'

/* Save · undo · redo · publish, the draft's state in words, and the
   conflict dialog. Cmd/Ctrl+S saves and Cmd/Ctrl+Z / Shift+Cmd+Z undo
   and redo — but never while focus is in a text field, where those keys
   belong to the field. */
export function DraftBar({ children, compact = false }: { children?: ReactNode; compact?: boolean }) {
  const s = useSiteStore()
  const dirty = useDirty()
  const unpublished = useUnpublished()

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

  return (
    <>
      <div className="a-publishbar" role="toolbar" aria-label="Draft">
        {children}
        <SaveState dirty={dirty} unpublished={unpublished} />
        <div className="btn-group">
          <button type="button" className="btn btn-icon" onClick={() => s.undo()} disabled={!s.past.length} title="Undo (⌘Z)" aria-label="Undo"><Icon name="undo" size={16} /></button>
          <button type="button" className="btn btn-icon" onClick={() => s.redo()} disabled={!s.future.length} title="Redo (⇧⌘Z)" aria-label="Redo"><Icon name="redo" size={16} /></button>
        </div>
        <button type="button" className="btn" onClick={() => void s.save()} disabled={!dirty || s.saving} title="Save draft (⌘S)">{s.saving ? 'Saving…' : compact ? 'Save' : 'Save draft'}</button>
        <button type="button" className="btn btn-accent" onClick={() => void s.publish()} disabled={s.publishing || (!dirty && !unpublished)}>{s.publishing ? 'Publishing…' : 'Publish'}</button>
      </div>
      <Dialog
        open={!!s.conflict}
        onClose={() => s.dismissConflict()}
        title="Someone else saved this draft"
        actions={<>
          <button type="button" className="btn" onClick={() => void s.load(true)}>Load the latest draft</button>
          <button type="button" className="btn btn-danger" onClick={() => void s.save('Overwrote a concurrent edit', { force: true })}>Keep mine and overwrite</button>
          <span className="spacer" />
          <button type="button" className="btn btn-ghost" onClick={() => s.dismissConflict()}>Cancel</button>
        </>}
      >
        <p className="a-sub">{s.conflict?.message} Latest save: {s.conflict?.head.draft ? `${new Date(s.conflict.head.draft.createdAt).toLocaleString()} by ${s.conflict.head.draft.authorName ?? 'unknown'}` : 'unknown'}.</p>
        <p className="a-sub">Load their version (your unsaved edits here are discarded), or keep yours and save it on top of theirs.</p>
      </Dialog>
    </>
  )
}
