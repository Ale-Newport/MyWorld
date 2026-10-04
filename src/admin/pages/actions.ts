'use client'

import { useSiteStore } from '../store/site'
import { toast } from '../toast'
import type { ElementNode, ElementType, StyleProps } from '@/cms/schema'
import { ELEMENT_TYPES } from '@/cms/schema'
import { addPx, allGroups, cloneForClipboard, duplicateNode, effectiveStyle, findNode, flag, groupFor, insertNode, isSection, isSlot, makeGroup, makeNode, pasteNodes, removeNode, setFlag, setStyle, setText, textOf, ungroup } from './ops'
import { frame, nodeById, scopeOf, useEditor } from './state'

/* What the editor does in answer to the canvas, the panels and the
   keyboard. Each change to the document is one apply() — one undo
   step — and the selection follows what was made or moved. */

const apply = (...a: Parameters<ReturnType<typeof useSiteStore.getState>['apply']>) => useSiteStore.getState().apply(...a)
const doc = () => useSiteStore.getState().doc!
const scope = () => scopeOf(useEditor.getState().device)

/** The section an element belongs to: its node's, or what the frame reported. */
export function sectionOf(id: string): string | null {
  if (isSection(id)) return id.slice('section.'.length)
  if (isSlot(id)) return id.slice('slot.'.length)
  const found = findNode(doc(), id)
  if (found) return found.section
  const s = nodeById(id)?.section
  return s && s !== 'page' ? s : null
}

export function syncSelection() {
  const { selection } = useEditor.getState()
  const d = useSiteStore.getState().doc
  if (d) frame.post({ type: 'cms:select', ids: selection, groups: allGroups(d) })
}

/* ---- picking ----------------------------------------------------------- */
export function pick(id: string | null, additive: boolean, deep: boolean) {
  const st = useEditor.getState()
  if (!id) { if (!additive) st.set({ selection: [], enteredGroup: null }); return }
  const section = sectionOf(id)
  const group = deep ? null : groupFor(doc(), section, id)
  const inside = group && st.enteredGroup === group.id
  const ids = group && !inside ? group.members : [id]
  if (!group || !inside) st.set({ enteredGroup: null })
  if (additive) {
    const has = ids.every((x) => st.selection.includes(x))
    st.select(has ? st.selection.filter((x) => !ids.includes(x)) : [...st.selection, ...ids])
  } else st.select(ids)
  // Focus leaves any inspector field, so the keyboard acts on the canvas.
  if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur()
}

export function onDoubleClick(id: string, kind: string) {
  const st = useEditor.getState()
  const section = sectionOf(id)
  const group = groupFor(doc(), section, id)
  if (group && st.enteredGroup !== group.id) { st.set({ enteredGroup: group.id }); st.select([id]); return }
  startTextEdit(id, kind)
}

const TEXT_KINDS = new Set(['text', 'heading', 'button', 'link', 'metric'])
export function startTextEdit(id: string, kind = nodeById(id)?.kind ?? 'text') {
  const found = findNode(doc(), id)
  const type = found?.node.type
  const textual = found ? ['heading', 'text', 'button', 'card'].includes(type!) : TEXT_KINDS.has(kind)
  if (!textual) return
  if (flag(doc(), id, 'locked')) { toast('Unlock the element to edit it.'); return }
  const bind = nodeById(id)?.bind
  const { text } = textOf(doc(), id, bind)
  frame.post({ type: 'cms:edit-text', id, text, multiline: !(type === 'heading' || type === 'button' || kind === 'heading' || kind === 'button' || kind === 'link') })
}

export function commitText(id: string, text: string) {
  const bind = nodeById(id)?.bind
  const before = textOf(doc(), id, bind).text
  if (before === text) return
  apply((d) => setText(d, id, text, bind))
}

/* ---- moves from the canvas ------------------------------------------------ */
export interface Change { id: string; translateX?: string; translateY?: string; left?: string; top?: string; width?: string; height?: string; maxWidth?: string }
export function commitChanges(changes: Change[]) {
  const sc = scope()
  apply((d) => {
    for (const c of changes) {
      if (flag(d, c.id, 'locked')) continue
      const { id, ...patch } = c
      setStyle(d, id, sc, patch)
    }
  })
}

export function nudge(dx: number, dy: number) {
  const { selection } = useEditor.getState()
  const sc = scope()
  const targets = selection.filter((id) => !isSection(id) && !isSlot(id) && !flag(doc(), id, 'locked'))
  if (!targets.length) return
  apply((d) => {
    for (const id of targets) {
      const anchored = findNode(d, id)?.node.layout.mode === 'anchored'
      const eff = effectiveStyle(d, id, sc)
      const patch: Partial<Record<keyof StyleProps, string>> = {}
      if (dx) patch.translateX = addPx(eff.translateX, dx)
      if (dy) patch.translateY = addPx(eff.translateY, dy)
      if (anchored && !eff.translateX && !eff.translateY && eff.left !== undefined && eff.top !== undefined) {
        // Anchored elements placed by left/top move by them, keeping their anchor.
        delete patch.translateX; delete patch.translateY
        if (dx) patch.left = addPx(eff.left, dx)
        if (dy) patch.top = addPx(eff.top, dy)
      }
      setStyle(d, id, sc, patch)
    }
  }, { coalesce: `nudge:${targets.join()}` })
}

/* ---- structure ------------------------------------------------------------- */
export function deleteSelection() {
  const { selection } = useEditor.getState()
  if (!selection.length) return
  const added = selection.filter((id) => findNode(doc(), id))
  const builtIn = selection.filter((id) => !findNode(doc(), id) && !isSection(id) && !isSlot(id))
  apply((d) => {
    for (const id of added) removeNode(d, id)
    for (const id of builtIn) setFlag(d, id, 'hidden', true)
  })
  if (builtIn.length) toast(builtIn.length === 1 ? 'Built-in elements are hidden rather than deleted. Show it again from Layers.' : `${builtIn.length} built-in elements hidden (they cannot be deleted).`)
  useEditor.getState().select([])
}

export function duplicateSelection() {
  const { selection } = useEditor.getState()
  const made: string[] = []
  apply((d) => {
    for (const id of selection) {
      const copy = duplicateNode(d, id)
      if (copy) { made.push(copy); continue }
      // Built-in text: a copy as an added element of the same section.
      const section = sectionOf(id)
      const t = nodeById(id)
      const node = section ? cloneForClipboard(d, id, textOf(d, id, t?.bind).text ?? t?.text ?? null, t?.kind ?? '') : null
      if (node && section) { node.layout = { mode: 'anchored' }; node.style.base = { ...node.style.base, left: '8%', top: '12%' }; insertNode(d, section, node); made.push(node.id) }
    }
  })
  if (made.length) useEditor.getState().select(made)
  else toast('That element cannot be duplicated.')
}

export function copySelection(cut = false) {
  const { selection } = useEditor.getState()
  const nodes = selection.map((id) => { const t = nodeById(id); return cloneForClipboard(doc(), id, textOf(doc(), id, t?.bind).text ?? t?.text ?? null, t?.kind ?? '') }).filter((n): n is ElementNode => !!n)
  if (!nodes.length) { toast('Nothing here can be copied.'); return }
  useEditor.getState().set({ clipboard: { nodes } })
  toast(`${nodes.length} copied`)
  if (cut) deleteSelection()
}

export function paste() {
  const { clipboard, selection, viewportSection } = useEditor.getState()
  if (!clipboard?.nodes.length) return
  const target = selection[0]
  const container = target && findNode(doc(), target)?.node.type === 'container' ? target : null
  const section = (target && sectionOf(target)) ?? viewportSection
  if (!section) { toast('Scroll to a section of the page, or select something in it, then paste.'); return }
  let ids: string[] = []
  apply((d) => { ids = pasteNodes(d, section, clipboard.nodes, container) })
  useEditor.getState().select(ids)
}

export function groupSelection() {
  const { selection } = useEditor.getState()
  const ids = selection.filter((id) => !isSection(id) && !isSlot(id))
  const sections = new Set(ids.map(sectionOf))
  if (ids.length < 2) { toast('Select at least two elements to group them.'); return }
  if (sections.size !== 1 || sections.has(null)) { toast('Grouped elements must be in the same section.'); return }
  let gid = ''
  apply((d) => { gid = makeGroup(d, [...sections][0]!, ids, `Group of ${ids.length}`) })
  useEditor.getState().set({ enteredGroup: null })
  toast('Grouped. Click selects the group; ⌘-click or double-click reaches one element.')
  void gid
}

export function ungroupSelection() {
  const { selection } = useEditor.getState()
  const section = selection[0] ? sectionOf(selection[0]) : null
  const g = section ? groupFor(doc(), section, selection[0]) : null
  if (!g || !section) { toast('The selection is not a group.'); return }
  apply((d) => ungroup(d, section, g.id))
}

export function toggleLock() {
  const { selection } = useEditor.getState()
  if (!selection.length) return
  const lock = !selection.every((id) => flag(doc(), id, 'locked'))
  apply((d) => { for (const id of selection) setFlag(d, id, 'locked', lock) })
}

export function selectAllInSection() {
  const st = useEditor.getState()
  const section = (st.selection[0] && sectionOf(st.selection[0])) ?? st.viewportSection
  if (!section) return
  st.select(st.tree.filter((n) => n.section === section && n.kind !== 'section' && !n.id.startsWith('slot.')).map((n) => n.id))
}

/* ---- inserting --------------------------------------------------------------- */
export function insertElement(type: ElementType, opts: { preset?: string; src?: string; alt?: string; at?: { section: string; container: string | null; x: string; y: string } } = {}) {
  if (!ELEMENT_TYPES.includes(type)) return
  const st = useEditor.getState()
  const target = st.selection[0]
  const container = opts.at ? opts.at.container : target && findNode(doc(), target)?.node.type === 'container' ? target : null
  const section = opts.at?.section ?? (target && sectionOf(target)) ?? st.viewportSection
  if (!section) { toast(st.page.journey ? 'Scroll to the section you want it in, or select something there.' : 'Elements can be added to the home and projects pages; project pages are built from each project’s sections.'); return }
  const node = makeNode(type, { preset: opts.preset, src: opts.src, alt: opts.alt })
  if (opts.at && !container) {
    node.layout = { mode: 'anchored' }
    node.style.base = { ...node.style.base, left: opts.at.x, top: opts.at.y }
  }
  apply((d) => insertNode(d, section, node, container))
  st.select([node.id])
  requestAnimationFrame(() => frame.post({ type: 'cms:reveal', id: node.id }))
}

export function onDrop(m: { payload: string; section: string | null; container: string | null; x: string; y: string }) {
  let data: { kind?: string; type?: string; preset?: string; url?: string; mime?: string; alt?: string }
  try { data = JSON.parse(m.payload) } catch { return }
  if (!m.section) { toast('Drop it onto a section of the page.'); return }
  const at = { section: m.section, container: m.container, x: m.x, y: m.y }
  if (data.kind === 'element' && data.type) insertElement(data.type as ElementType, { preset: data.preset, at })
  if (data.kind === 'media' && data.url) insertElement(data.mime?.startsWith('video/') ? 'video' : 'image', { src: data.url, alt: data.alt, at })
}

/* ---- keyboard ------------------------------------------------------------------ */
export function onKey(k: { key: string; meta: boolean; shift: boolean; alt: boolean }, fromFrame: boolean) {
  const st = useEditor.getState()
  const key = k.key.length === 1 ? k.key.toLowerCase() : k.key
  if (k.meta) {
    if (fromFrame && key === 'z') { if (k.shift) useSiteStore.getState().redo(); else useSiteStore.getState().undo(); return true }
    if (fromFrame && key === 'y') { useSiteStore.getState().redo(); return true }
    if (fromFrame && key === 's') { void useSiteStore.getState().save(); return true }
    if (key === 'd') { duplicateSelection(); return true }
    if (key === 'c') { copySelection(); return true }
    if (key === 'x') { copySelection(true); return true }
    if (key === 'v') { paste(); return true }
    if (key === 'g') { if (k.shift) ungroupSelection(); else groupSelection(); return true }
    if (key === 'a') { selectAllInSection(); return true }
    if (key === 'l') { toggleLock(); return true }
    return false
  }
  if (key === 'Escape') { if (st.enteredGroup) st.set({ enteredGroup: null }); else st.select([]); return true }
  if (!st.selection.length) return false
  if (key === 'Delete' || key === 'Backspace') { deleteSelection(); return true }
  if (key === 'Enter') { startTextEdit(st.selection[0]); return true }
  const step = k.shift ? 10 : 1
  if (key === 'ArrowLeft') { nudge(-step, 0); return true }
  if (key === 'ArrowRight') { nudge(step, 0); return true }
  if (key === 'ArrowUp') { nudge(0, -step); return true }
  if (key === 'ArrowDown') { nudge(0, step); return true }
  return false
}
