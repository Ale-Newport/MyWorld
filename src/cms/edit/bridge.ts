import { getLenis } from '@/hooks/useLenisScroll'

/* ============================================================
   THE EDITOR'S HANDS INSIDE THE REAL PAGE

   Loaded only into the admin's preview frame (Draft Mode, a
   verified session, `?cms-edit=1`, inside the admin's window).
   It never changes the document itself: it reports what the
   administrator pointed at, dragged, resized or typed, and the
   editor in the parent window turns that into an undoable edit
   of the draft, which comes back as a new document and re-renders
   the page through its own components.

   What it does here, in the page:
     · draws hover and selection boxes, handles, labels and smart
       guides in one fixed overlay above everything;
     · picks the element under the pointer (`data-cms-id`), and
       keeps clicks, keys and drags from reaching the page while
       editing (wheel scrolling still works);
     · previews a move or resize live with inline styles, snapping
       to the edges and centres of the section and its other
       elements, then reports the final values in CSS pixels;
     · opens an in-place text field over an element for inline
       text edits;
     · accepts elements and media dragged in from the editor's
       panels, and reports where they were dropped;
     · measures selections for align and distribute.
   ============================================================ */

type Mode = 'edit' | 'preview'
interface TreeNode { id: string; kind: string; label: string; bind?: string; added: boolean; anchored: boolean; locked: boolean; parent: string | null; section: string | null; text: string; count: number }
interface Change { id: string; translateX?: string; translateY?: string; left?: string; top?: string; width?: string; height?: string; maxWidth?: string }

const SNAP = 6
const TEXT_KINDS = new Set(['text', 'heading', 'button', 'link', 'metric'])
const MSG = 'cms:'

const CSS_TEXT = `
[data-cms-overlay]{position:fixed;inset:0;pointer-events:none;z-index:2147483000;font:500 11px/1.2 ui-sans-serif,-apple-system,'Segoe UI',sans-serif}
[data-cms-overlay] .b{position:absolute;box-sizing:border-box;border:1.5px solid #2f6cd8;border-radius:2px}
[data-cms-overlay] .b.h{border:1px solid rgba(47,108,216,.7);background:rgba(47,108,216,.04)}
[data-cms-overlay] .b.s{border-color:#2f6cd8}
[data-cms-overlay] .b.g{border-style:dashed}
[data-cms-overlay] .b.l{border-color:#a8322a}
[data-cms-overlay] .t{position:absolute;left:-1.5px;bottom:100%;margin-bottom:3px;padding:2px 6px;border-radius:3px;background:#2f6cd8;color:#fff;white-space:nowrap;max-width:320px;overflow:hidden;text-overflow:ellipsis}
[data-cms-overlay] .b.h .t{background:rgba(47,108,216,.85)}
[data-cms-overlay] .d{position:absolute;right:-1.5px;top:100%;margin-top:3px;padding:2px 5px;border-radius:3px;background:#1a1712;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap}
[data-cms-overlay] .k{position:absolute;width:9px;height:9px;margin:-5px 0 0 -5px;background:#fff;border:1.5px solid #2f6cd8;border-radius:2px;pointer-events:auto;box-sizing:border-box}
[data-cms-overlay] .gl{position:absolute;background:#e5484d}
[data-cms-overlay] .drop{position:absolute;box-sizing:border-box;border:2px dashed #bf4f27;background:rgba(191,79,39,.06);border-radius:4px}
[data-cms-overlay] textarea{position:absolute;pointer-events:auto;margin:0;border:0;outline:2px solid #2f6cd8;outline-offset:2px;background:rgba(255,255,255,.92);resize:none;overflow:hidden;box-sizing:border-box;padding:0}
html[data-cms-mode=edit] *{cursor:default!important}
html[data-cms-mode=edit] [data-cms-overlay] .k{cursor:nwse-resize!important}
html[data-cms-mode=edit] [data-cms-overlay] .k[data-h=n],html[data-cms-mode=edit] [data-cms-overlay] .k[data-h=s]{cursor:ns-resize!important}
html[data-cms-mode=edit] [data-cms-overlay] .k[data-h=e],html[data-cms-mode=edit] [data-cms-overlay] .k[data-h=w]{cursor:ew-resize!important}
html[data-cms-mode=edit] [data-cms-overlay] .k[data-h=ne],html[data-cms-mode=edit] [data-cms-overlay] .k[data-h=sw]{cursor:nesw-resize!important}
html[data-cms-mode=edit] [data-cms-overlay] textarea{cursor:text!important}
html[data-cms-mode=edit] .cms-dragging,html[data-cms-mode=edit] .cms-dragging *{cursor:move!important}
[data-cms-text-editing]{visibility:hidden!important}
`

const escape = (id: string) => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'))
const all = (id: string) => [...document.querySelectorAll<HTMLElement>(`[data-cms-id="${escape(id)}"]`)]
const first = (id: string) => document.querySelector<HTMLElement>(`[data-cms-id="${escape(id)}"]`)
const px = (n: number) => `${Math.round(n * 10) / 10}px`
const visible = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth

function parseTranslate(el: HTMLElement): [number, number] {
  const t = getComputedStyle(el).translate
  if (!t || t === 'none') return [0, 0]
  const [x = '0', y = '0'] = t.split(' ')
  return [parseFloat(x) || 0, parseFloat(y) || 0]
}

/** The element's section: its chapter on the journeys, the page's main otherwise. */
function sectionOf(el: Element): HTMLElement | null {
  return el.closest<HTMLElement>('[data-chapter]') ?? el.closest<HTMLElement>('main')
}
/** The box elements are laid out and snapped against: a chapter's pinned stage, or the section itself. */
function stageOf(el: Element): HTMLElement | null {
  const section = sectionOf(el)
  if (!section) return null
  if (section.dataset.chapter) return section.querySelector<HTMLElement>('[data-cms-slot]')?.parentElement ?? section
  return section
}

function cmsTarget(from: EventTarget | null): HTMLElement | null {
  let el = (from as Element | null)?.closest?.<HTMLElement>('[data-cms-id]') ?? null
  // Locked elements cannot be picked on the canvas: the click goes to what contains them.
  while (el && el.dataset.cmsLocked === 'true') el = el.parentElement?.closest<HTMLElement>('[data-cms-id]') ?? null
  return el
}

export function startBridge(): () => void {
  const parentWindow = window.parent
  const post = (msg: Record<string, unknown>) => parentWindow.postMessage(msg, location.origin)
  const root = document.documentElement
  let mode: Mode = 'edit'
  let selection: string[] = []
  let groups: string[][] = []
  let hoverId: string | null = null
  let panelHover: string | null = null
  let dropBox: DOMRect | null = null
  let editing: { id: string; el: HTMLElement; area: HTMLTextAreaElement } | null = null
  let guides: { x: number[]; y: number[] } = { x: [], y: [] }
  const pendingInline = new Set<HTMLElement>()

  const style = document.createElement('style')
  style.dataset.cmsBridge = ''
  style.textContent = CSS_TEXT
  document.head.append(style)
  const overlay = document.createElement('div')
  overlay.dataset.cmsOverlay = ''
  overlay.setAttribute('aria-hidden', 'true')
  document.body.append(overlay)
  root.dataset.cmsMode = mode
  root.removeAttribute('data-cursor')

  /* ---- the tree ---------------------------------------------------- */
  let treeTimer = 0
  const sendTree = () => {
    window.clearTimeout(treeTimer)
    treeTimer = window.setTimeout(() => {
      const seen = new Map<string, TreeNode>()
      for (const el of document.querySelectorAll<HTMLElement>('[data-cms-id]')) {
        if (overlay.contains(el)) continue
        const id = el.dataset.cmsId!
        const hit = seen.get(id)
        if (hit) { hit.count++; continue }
        const parentEl = el.parentElement?.closest<HTMLElement>('[data-cms-id]')
        const section = sectionOf(el)
        seen.set(id, {
          id,
          kind: el.dataset.cmsKind ?? 'text',
          label: el.dataset.cmsLabel ?? id,
          bind: el.dataset.cmsBind,
          added: el.dataset.cmsAdded === 'true',
          anchored: el.dataset.cmsAnchored === 'true',
          locked: el.dataset.cmsLocked === 'true',
          parent: parentEl?.dataset.cmsId ?? null,
          section: section?.dataset.chapter ?? (section ? 'page' : null),
          text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
          count: 1,
        })
      }
      post({ type: `${MSG}tree`, path: location.pathname, nodes: [...seen.values()] })
    }, 120)
  }
  const mo = new MutationObserver((records) => {
    if (records.every((r) => overlay.contains(r.target))) return
    sendTree()
  })
  mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-cms-id', 'data-cms-label', 'data-cms-locked'] })
  sendTree()

  /* ---- drawing ----------------------------------------------------- */
  const pool: HTMLElement[] = []
  let used = 0
  const box = (cls: string) => {
    let el = pool[used]
    if (!el) { el = document.createElement('div'); overlay.append(el); pool.push(el) }
    used++
    el.className = cls
    el.replaceChildren()
    el.style.cssText = ''
    el.hidden = false
    return el
  }
  const groupOf = (id: string) => groups.find((g) => g.includes(id))
  const labelFor = (el: HTMLElement) => el.dataset.cmsLabel ?? el.dataset.cmsId ?? ''

  let raf = 0
  const draw = () => {
    raf = requestAnimationFrame(draw)
    used = 0
    if (mode === 'edit') {
      const hovered = panelHover ?? hoverId
      if (hovered && !selection.includes(hovered)) {
        for (const el of all(hovered).slice(0, 12)) {
          const r = el.getBoundingClientRect()
          if (!visible(r)) continue
          const b = box('b h')
          Object.assign(b.style, { left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height) })
          const t = document.createElement('span'); t.className = 't'; t.textContent = labelFor(el); b.append(t)
        }
      }
      const single = selection.length === 1
      for (const id of selection) {
        const els = all(id)
        els.slice(0, 24).forEach((el, i) => {
          const r = el.getBoundingClientRect()
          if (!r.width && !r.height) return
          const locked = el.dataset.cmsLocked === 'true'
          const b = box(`b s${groupOf(id) ? ' g' : ''}${locked ? ' l' : ''}`)
          Object.assign(b.style, { left: px(r.left), top: px(r.top), width: px(r.width), height: px(r.height) })
          if (i === 0) {
            const t = document.createElement('span'); t.className = 't'; t.textContent = `${labelFor(el)}${els.length > 1 ? ` · ${els.length} instances` : ''}${locked ? ' · locked' : ''}`; b.append(t)
            if (single) { const d = document.createElement('span'); d.className = 'd'; d.textContent = `${Math.round(el.offsetWidth || r.width)} × ${Math.round(el.offsetHeight || r.height)}`; b.append(d) }
            if (single && !locked && !editing && el.dataset.cmsKind !== 'section') {
              for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const) {
                const k = document.createElement('span')
                k.className = 'k'
                k.dataset.h = h
                k.dataset.id = id
                k.style.left = h.includes('w') ? '0' : h.includes('e') ? '100%' : '50%'
                k.style.top = h.includes('n') ? '0' : h.includes('s') ? '100%' : '50%'
                b.append(k)
              }
            }
          }
        })
      }
      for (const x of guides.x) { const g = box('gl'); Object.assign(g.style, { left: px(x), top: '0', width: '1px', height: '100%' }) }
      for (const y of guides.y) { const g = box('gl'); Object.assign(g.style, { top: px(y), left: '0', height: '1px', width: '100%' }) }
      if (dropBox) { const d = box('drop'); Object.assign(d.style, { left: px(dropBox.left), top: px(dropBox.top), width: px(dropBox.width), height: px(dropBox.height) }) }
      if (editing) {
        const r = editing.el.getBoundingClientRect()
        Object.assign(editing.area.style, { left: px(r.left), top: px(r.top), width: px(Math.max(r.width, 40)), minHeight: px(r.height) })
      }
    }
    for (let i = used; i < pool.length; i++) pool[i].hidden = true
  }
  raf = requestAnimationFrame(draw)

  /* ---- picking ------------------------------------------------------ */
  type Drag =
    | { kind: 'pending'; x: number; y: number; id: string; pointer: number }
    | { kind: 'move'; x: number; y: number; items: { el: HTMLElement; id: string; tx: number; ty: number; anchored: boolean; left: number; top: number; pw: number; ph: number }[]; start: DOMRect; lines: { x: number[]; y: number[] } }
    | { kind: 'resize'; x: number; y: number; h: string; el: HTMLElement; id: string; w: number; hgt: number; tx: number; ty: number; ratio: number; text: boolean; anchored: boolean; left: number; top: number; pw: number; ph: number }
  let drag: Drag | null = null

  const editable = () => mode === 'edit'
  const inOverlay = (t: EventTarget | null) => t instanceof Node && overlay.contains(t)

  const snapLines = (exclude: HTMLElement[], section: HTMLElement | null) => {
    const xs: number[] = [], ys: number[] = []
    const stage = section ? stageOf(section) : null
    const s = (stage ?? document.body).getBoundingClientRect()
    const vr = { left: Math.max(0, s.left), right: Math.min(innerWidth, s.right), top: Math.max(0, s.top), bottom: Math.min(innerHeight, s.bottom) }
    xs.push(vr.left, (vr.left + vr.right) / 2, vr.right)
    ys.push(vr.top, (vr.top + vr.bottom) / 2, vr.bottom)
    const scope = section ?? document.body
    for (const el of scope.querySelectorAll<HTMLElement>('[data-cms-id]')) {
      if (exclude.some((x) => x === el || x.contains(el) || el.contains(x))) continue
      if (el.dataset.cmsKind === 'section') continue
      const r = el.getBoundingClientRect()
      if (!visible(r) || r.width > innerWidth * 0.98) continue
      xs.push(r.left, r.left + r.width / 2, r.right)
      ys.push(r.top, r.top + r.height / 2, r.bottom)
    }
    return { x: xs, y: ys }
  }
  const snap = (edges: number[], lines: number[]): { delta: number; at: number[] } => {
    let best = SNAP + 1, delta = 0
    for (const e of edges) for (const l of lines) { const d = l - e; if (Math.abs(d) < Math.abs(best)) { best = d; delta = d } }
    if (Math.abs(best) > SNAP) return { delta: 0, at: [] }
    const at = new Set<number>()
    for (const e of edges) for (const l of lines) if (Math.abs(l - (e + delta)) < 0.5) at.add(l)
    return { delta, at: [...at] }
  }

  const onPointerDown = (e: PointerEvent) => {
    if (!editable() || e.button !== 0) return
    if (editing && e.target === editing.area) return
    if (editing) commitText()
    const handle = (e.target as HTMLElement).closest?.<HTMLElement>('[data-cms-overlay] .k')
    if (handle) {
      e.preventDefault(); e.stopPropagation()
      const id = handle.dataset.id!
      const el = first(id)
      if (!el) return
      const r = el.getBoundingClientRect()
      const [tx, ty] = parseTranslate(el)
      const parent = el.offsetParent as HTMLElement | null
      drag = { kind: 'resize', x: e.clientX, y: e.clientY, h: handle.dataset.h!, el, id, w: el.offsetWidth || r.width, hgt: el.offsetHeight || r.height, tx, ty, ratio: (el.offsetWidth || r.width) / (r.width || 1), text: TEXT_KINDS.has(el.dataset.cmsKind ?? ''), anchored: el.dataset.cmsAnchored === 'true', left: el.offsetLeft, top: el.offsetTop, pw: parent?.clientWidth || innerWidth, ph: parent?.clientHeight || innerHeight }
      try { root.setPointerCapture?.(e.pointerId) } catch { /* not capturable */ }
      return
    }
    if (inOverlay(e.target)) return
    let el = cmsTarget(e.target)
    e.preventDefault()
    e.stopPropagation()
    // Alt-click reaches what is underneath: each click picks the next element stacked under the pointer.
    if (e.altKey) {
      const stack: HTMLElement[] = []
      for (const n of document.elementsFromPoint(e.clientX, e.clientY)) {
        if (overlay.contains(n)) continue
        const hit = cmsTarget(n)
        if (hit && !stack.includes(hit) && hit.dataset.cmsKind !== 'section') stack.push(hit)
      }
      if (stack.length) {
        const at = stack.findIndex((x) => selection.includes(x.dataset.cmsId!))
        el = stack[(at + 1) % stack.length]
      }
    }
    post({ type: `${MSG}pick`, id: el?.dataset.cmsId ?? null, additive: e.shiftKey, deep: e.metaKey || e.ctrlKey || e.altKey })
    if (el && el.dataset.cmsKind !== 'section') drag = { kind: 'pending', x: e.clientX, y: e.clientY, id: el.dataset.cmsId!, pointer: e.pointerId }
  }

  const beginMove = (d: { x: number; y: number; id: string; pointer: number }) => {
    const ids = selection.includes(d.id) ? selection : [d.id]
    const items = ids.flatMap((id) => all(id).slice(0, 1)).filter((el) => el.dataset.cmsLocked !== 'true' && el.dataset.cmsKind !== 'section').map((el) => {
      const [tx, ty] = parseTranslate(el)
      const parent = el.offsetParent as HTMLElement | null
      return { el, id: el.dataset.cmsId!, tx, ty, anchored: el.dataset.cmsAnchored === 'true', left: el.offsetLeft, top: el.offsetTop, pw: parent?.clientWidth || innerWidth, ph: parent?.clientHeight || innerHeight }
    })
    if (!items.length) return null
    const rects = items.map((i) => i.el.getBoundingClientRect())
    const start = new DOMRect(Math.min(...rects.map((r) => r.left)), Math.min(...rects.map((r) => r.top)), 0, 0)
    start.width = Math.max(...rects.map((r) => r.right)) - start.left
    start.height = Math.max(...rects.map((r) => r.bottom)) - start.top
    root.classList.add('cms-dragging')
    // Keep receiving the pointer if it leaves the frame mid-drag.
    try { root.setPointerCapture(d.pointer) } catch { /* not capturable */ }
    return { kind: 'move' as const, x: d.x, y: d.y, items, start, lines: snapLines(items.map((i) => i.el), sectionOf(items[0].el)) }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (!editable()) return
    if (!drag) {
      if (inOverlay(e.target)) return
      const el = cmsTarget(e.target)
      const id = el?.dataset.cmsId ?? null
      if (id !== hoverId) { hoverId = id; post({ type: `${MSG}hovered`, id }) }
      return
    }
    e.preventDefault()
    if (drag.kind === 'pending') {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 3) return
      drag = beginMove(drag)
      if (!drag) return
    }
    let dx = e.clientX - drag.x, dy = e.clientY - drag.y
    if (drag.kind === 'move') {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0 }
      guides = { x: [], y: [] }
      if (!e.altKey) {
        const s = drag.start
        const sx = snap([s.left + dx, s.left + s.width / 2 + dx, s.right + dx], drag.lines.x)
        const sy = snap([s.top + dy, s.top + s.height / 2 + dy, s.bottom + dy], drag.lines.y)
        dx += sx.delta; dy += sy.delta
        guides = { x: sx.at, y: sy.at }
      }
      for (const it of drag.items) {
        if (it.anchored) { it.el.style.left = px(it.left + dx); it.el.style.top = px(it.top + dy) }
        else it.el.style.translate = `${px(it.tx + dx)} ${px(it.ty + dy)}`
        pendingInline.add(it.el)
      }
      return
    }
    /* resize */
    const d = drag
    const k = d.ratio
    let w = d.w, h = d.hgt, ox = 0, oy = 0
    if (d.h.includes('e')) w = d.w + dx * k
    if (d.h.includes('w')) { w = d.w - dx * k; ox = dx }
    if (d.h.includes('s')) h = d.hgt + dy * k
    if (d.h.includes('n')) { h = d.hgt - dy * k; oy = dy }
    if (e.shiftKey && !d.text && d.h.length === 2) { const r = d.w / d.hgt; if (Math.abs(w - d.w) > Math.abs(h - d.hgt) * r) h = w / r; else w = h * r; if (d.h.includes('w')) ox = (d.w - w) / k; if (d.h.includes('n')) oy = (d.hgt - h) / k }
    w = Math.max(8, w); h = Math.max(8, h)
    d.el.style.width = px(w)
    d.el.style.maxWidth = 'none'
    if (!d.text) d.el.style.height = px(h)
    if (ox || oy) {
      if (d.anchored) { d.el.style.left = px(d.left + ox); d.el.style.top = px(d.top + oy) }
      else d.el.style.translate = `${px(d.tx + ox)} ${px(d.ty + oy)}`
    }
    pendingInline.add(d.el)
  }

  const pct = (v: number, of: number) => `${Math.round((v / (of || 1)) * 1000) / 10}%`
  const onPointerUp = (e: PointerEvent) => {
    if (!drag) return
    const d = drag
    drag = null
    guides = { x: [], y: [] }
    root.classList.remove('cms-dragging')
    if (d.kind === 'pending') return
    e.preventDefault()
    e.stopPropagation()
    if (d.kind === 'move') {
      const changes: Change[] = d.items.map((it) => {
        if (it.anchored) return { id: it.id, left: pct(parseFloat(it.el.style.left), it.pw), top: pct(parseFloat(it.el.style.top), it.ph) }
        const [x, y] = (it.el.style.translate || '0px 0px').split(' ')
        return { id: it.id, translateX: px(parseFloat(x) || 0), translateY: px(parseFloat(y ?? '0') || 0) }
      })
      post({ type: `${MSG}move`, changes })
      return
    }
    const change: Change = { id: d.id, width: d.el.style.width, maxWidth: 'none' }
    if (!d.text) change.height = d.el.style.height
    if (d.anchored && d.el.style.left) { change.left = pct(parseFloat(d.el.style.left), d.pw); change.top = pct(parseFloat(d.el.style.top), d.ph) }
    else if (d.el.style.translate) { const [x, y] = d.el.style.translate.split(' '); change.translateX = px(parseFloat(x) || 0); change.translateY = px(parseFloat(y ?? '0') || 0) }
    post({ type: `${MSG}resize`, change })
  }

  const swallow = (e: Event) => {
    if (!editable() || inOverlay(e.target)) return
    e.preventDefault()
    e.stopPropagation()
  }
  const onDblClick = (e: MouseEvent) => {
    if (!editable() || inOverlay(e.target)) return
    e.preventDefault(); e.stopPropagation()
    const el = cmsTarget(e.target)
    if (el) post({ type: `${MSG}dblclick`, id: el.dataset.cmsId, kind: el.dataset.cmsKind ?? 'text' })
  }

  /* ---- keys ---------------------------------------------------------- */
  const onKey = (e: KeyboardEvent) => {
    if (!editable() || editing) return
    const meta = e.metaKey || e.ctrlKey
    const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', 'Escape', 'Enter'].includes(e.key) || (meta && /^[zysdcvgaxl]$/i.test(e.key))
    e.stopPropagation()
    if (handled) {
      e.preventDefault()
      post({ type: `${MSG}key`, key: e.key, meta, shift: e.shiftKey, alt: e.altKey })
    }
  }

  /* ---- inline text ----------------------------------------------------- */
  const commitText = (cancel = false) => {
    if (!editing) return
    const { id, el, area } = editing
    editing = null
    el.removeAttribute('data-cms-text-editing')
    area.remove()
    if (!cancel) post({ type: `${MSG}text`, id, text: area.value })
  }
  const startText = (id: string, text: string, multiline: boolean) => {
    const el = first(id)
    if (!el) return
    if (editing) commitText()
    const cs = getComputedStyle(el)
    const area = document.createElement('textarea')
    area.value = text
    area.spellcheck = true
    area.setAttribute('aria-label', `Edit ${el.dataset.cmsLabel ?? 'text'}`)
    Object.assign(area.style, { font: cs.font, letterSpacing: cs.letterSpacing, lineHeight: cs.lineHeight, textAlign: cs.textAlign, color: cs.color === 'rgba(0, 0, 0, 0)' ? '#1a1712' : cs.color, textTransform: cs.textTransform })
    const fit = () => { area.style.height = 'auto'; area.style.height = `${area.scrollHeight}px` }
    area.addEventListener('input', fit)
    area.addEventListener('keydown', (e) => {
      e.stopPropagation()
      // Escape leaves the field keeping what was typed (undo takes it back); Enter starts a new line in paragraphs.
      if (e.key === 'Escape') { e.preventDefault(); commitText() }
      else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); commitText() }
    })
    area.addEventListener('blur', () => commitText())
    overlay.append(area)
    el.setAttribute('data-cms-text-editing', '')
    editing = { id, el, area }
    const r = el.getBoundingClientRect()
    Object.assign(area.style, { left: px(r.left), top: px(r.top), width: px(Math.max(r.width, 40)) })
    fit()
    area.focus()
    area.select()
  }

  /* ---- dropping from the panels ---------------------------------------- */
  const PAYLOAD = 'application/x-cms'
  const dropTarget = (x: number, y: number) => {
    const under = document.elementsFromPoint(x, y).filter((n) => !overlay.contains(n))
    const container = under.map((n) => n.closest<HTMLElement>('[data-cms-added][data-cms-kind=container]')).find(Boolean) ?? null
    const section = under.map((n) => n.closest<HTMLElement>('[data-chapter]')).find(Boolean) ?? null
    return { container, section }
  }
  const onDragOver = (e: DragEvent) => {
    if (!editable() || !e.dataTransfer?.types.includes(PAYLOAD)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const { container, section } = dropTarget(e.clientX, e.clientY)
    const target = container ?? (section ? stageOf(section) : null)
    dropBox = target ? target.getBoundingClientRect() : null
  }
  const onDragLeave = (e: DragEvent) => { if (!e.relatedTarget) dropBox = null }
  const onDrop = (e: DragEvent) => {
    if (!editable() || !e.dataTransfer?.types.includes(PAYLOAD)) return
    e.preventDefault()
    dropBox = null
    const { container, section } = dropTarget(e.clientX, e.clientY)
    const stage = section ? stageOf(section) : null
    const r = (container ?? stage)?.getBoundingClientRect()
    post({
      type: `${MSG}drop`,
      payload: e.dataTransfer.getData(PAYLOAD),
      section: section?.dataset.chapter ?? null,
      container: container?.dataset.cmsId ?? null,
      x: r ? pct(e.clientX - r.left, r.width) : '10%',
      y: r ? pct(e.clientY - r.top, r.height) : '10%',
    })
  }

  /* ---- where the visitor is -------------------------------------------- */
  let lastSection: string | null = null
  let scrollTimer = 0
  const onScroll = () => {
    if (scrollTimer) return
    scrollTimer = window.setTimeout(() => {
      scrollTimer = 0
      const mid = innerHeight / 2
      let current: string | null = null
      for (const s of document.querySelectorAll<HTMLElement>('[data-chapter]')) {
        const r = s.getBoundingClientRect()
        if (r.top <= mid && r.bottom >= mid) { current = s.dataset.chapter ?? null; break }
      }
      if (current !== lastSection) { lastSection = current; post({ type: `${MSG}viewport`, section: current }) }
    }, 150)
  }

  /* ---- align & distribute -------------------------------------------------- */
  const align = (ids: string[], how: string) => {
    const items = ids.map((id) => first(id)).filter((el): el is HTMLElement => !!el && el.dataset.cmsLocked !== 'true')
    if (!items.length) return
    const rects = items.map((el) => el.getBoundingClientRect())
    let bounds: { left: number; right: number; top: number; bottom: number }
    if (items.length === 1) {
      const s = (stageOf(items[0]) ?? document.body).getBoundingClientRect()
      bounds = { left: Math.max(0, s.left), right: Math.min(innerWidth, s.right), top: Math.max(0, s.top), bottom: Math.min(innerHeight, s.bottom) }
    } else bounds = { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) }
    const deltas = rects.map(() => ({ dx: 0, dy: 0 }))
    rects.forEach((r, i) => {
      if (how === 'left') deltas[i].dx = bounds.left - r.left
      if (how === 'hcenter') deltas[i].dx = (bounds.left + bounds.right) / 2 - (r.left + r.width / 2)
      if (how === 'right') deltas[i].dx = bounds.right - r.right
      if (how === 'top') deltas[i].dy = bounds.top - r.top
      if (how === 'vcenter') deltas[i].dy = (bounds.top + bounds.bottom) / 2 - (r.top + r.height / 2)
      if (how === 'bottom') deltas[i].dy = bounds.bottom - r.bottom
    })
    if ((how === 'hdistribute' || how === 'vdistribute') && items.length > 2) {
      const horizontal = how === 'hdistribute'
      const order = rects.map((r, i) => ({ r, i })).sort((a, b) => (horizontal ? a.r.left - b.r.left : a.r.top - b.r.top))
      const span = horizontal ? order[order.length - 1].r.right - order[0].r.left : order[order.length - 1].r.bottom - order[0].r.top
      const sizes = order.reduce((s, o) => s + (horizontal ? o.r.width : o.r.height), 0)
      const gap = (span - sizes) / (order.length - 1)
      let cursor = horizontal ? order[0].r.left : order[0].r.top
      for (const o of order) {
        const at = horizontal ? o.r.left : o.r.top
        if (horizontal) deltas[o.i].dx = cursor - at; else deltas[o.i].dy = cursor - at
        cursor += (horizontal ? o.r.width : o.r.height) + gap
      }
    }
    const changes: Change[] = items.map((el, i) => {
      const { dx, dy } = deltas[i]
      if (el.dataset.cmsAnchored === 'true') {
        const parent = el.offsetParent as HTMLElement | null
        return { id: el.dataset.cmsId!, left: pct(el.offsetLeft + dx, parent?.clientWidth || innerWidth), top: pct(el.offsetTop + dy, parent?.clientHeight || innerHeight) }
      }
      const [tx, ty] = parseTranslate(el)
      return { id: el.dataset.cmsId!, translateX: px(tx + dx), translateY: px(ty + dy) }
    }).filter((c, i) => Math.abs(deltas[i].dx) > 0.05 || Math.abs(deltas[i].dy) > 0.05)
    if (changes.length) post({ type: `${MSG}move`, changes })
  }

  /* ---- what the inspector shows as current values ----------------------------- */
  const COMPUTED = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textTransform', 'textAlign', 'color', 'backgroundColor', 'width', 'height', 'maxWidth', 'minHeight', 'padding', 'margin', 'gap', 'borderRadius', 'opacity', 'display', 'flexDirection', 'flexWrap', 'justifyContent', 'alignItems', 'gridTemplateColumns', 'translate', 'rotate', 'zIndex', 'top', 'left', 'right', 'bottom'] as const
  const sendComputed = () => {
    if (selection.length !== 1) return
    const el = first(selection[0])
    if (!el) return
    const cs = getComputedStyle(el)
    const style: Record<string, string> = {}
    for (const k of COMPUTED) style[k] = cs[k]
    post({ type: `${MSG}computed`, id: selection[0], style })
  }

  /* ---- messages from the editor -------------------------------------------- */
  const clearInline = () => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const el of pendingInline) { el.style.translate = ''; el.style.left = ''; el.style.top = ''; el.style.width = ''; el.style.height = ''; el.style.maxWidth = '' }
      pendingInline.clear()
    }))
  }
  const onMessage = (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== parentWindow) return
    const m = e.data as Record<string, unknown>
    if (typeof m?.type !== 'string' || !m.type.startsWith(MSG)) return
    switch (m.type) {
      case 'cms:document': if (!drag) clearInline(); sendTree(); requestAnimationFrame(() => requestAnimationFrame(sendComputed)); break
      case 'cms:select': selection = (m.ids as string[]) ?? []; groups = (m.groups as string[][]) ?? groups; sendComputed(); break
      case 'cms:hover': panelHover = (m.id as string | null) ?? null; break
      case 'cms:mode':
        mode = m.mode === 'preview' ? 'preview' : 'edit'
        root.dataset.cmsMode = mode
        if (mode === 'preview') { commitText(true); hoverId = null; overlay.hidden = true } else overlay.hidden = false
        break
      case 'cms:edit-text': {
        // No text from the document means the code's own words are on screen: start from those.
        const fallback = (first(String(m.id))?.textContent ?? '').replace(/\s+/g, ' ').trim()
        startText(String(m.id), typeof m.text === 'string' ? m.text : fallback, !!m.multiline)
        break
      }
      case 'cms:align': align((m.ids as string[]) ?? [], String(m.how)); break
      case 'cms:reveal': {
        const el = first(String(m.id))
        if (!el) break
        const chapter = el.closest<HTMLElement>('[data-chapter]')
        const r = el.getBoundingClientRect()
        if (visible(r)) break
        const top = chapter ? chapter.getBoundingClientRect().top + scrollY : r.top + scrollY - innerHeight / 3
        const lenis = getLenis()
        if (lenis) lenis.scrollTo(top, { immediate: true })
        else window.scrollTo({ top })
        break
      }
      case 'cms:scroll-to-section': {
        const s = document.querySelector<HTMLElement>(`[data-chapter="${escape(String(m.section))}"]`)
        if (!s) break
        const top = s.getBoundingClientRect().top + scrollY
        const lenis = getLenis()
        if (lenis) lenis.scrollTo(top, { immediate: true })
        else window.scrollTo({ top })
        break
      }
    }
  }

  const opts = { capture: true, passive: false } as const
  window.addEventListener('pointerdown', onPointerDown, opts)
  window.addEventListener('pointermove', onPointerMove, opts)
  window.addEventListener('pointerup', onPointerUp, opts)
  window.addEventListener('click', swallow, opts)
  window.addEventListener('auxclick', swallow, opts)
  window.addEventListener('mousedown', swallow, opts)
  window.addEventListener('mouseup', swallow, opts)
  window.addEventListener('touchstart', swallow, opts)
  window.addEventListener('dblclick', onDblClick, opts)
  window.addEventListener('keydown', onKey, opts)
  window.addEventListener('dragover', onDragOver, opts)
  window.addEventListener('dragleave', onDragLeave, opts)
  window.addEventListener('drop', onDrop, opts)
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('message', onMessage)
  const pointerLeave = () => { if (hoverId) { hoverId = null; post({ type: `${MSG}hovered`, id: null }) } }
  document.addEventListener('pointerleave', pointerLeave)
  post({ type: `${MSG}bridge-ready`, path: location.pathname })
  onScroll()

  return () => {
    cancelAnimationFrame(raf)
    window.clearTimeout(treeTimer)
    mo.disconnect()
    window.removeEventListener('pointerdown', onPointerDown, opts)
    window.removeEventListener('pointermove', onPointerMove, opts)
    window.removeEventListener('pointerup', onPointerUp, opts)
    window.removeEventListener('click', swallow, opts)
    window.removeEventListener('auxclick', swallow, opts)
    window.removeEventListener('mousedown', swallow, opts)
    window.removeEventListener('mouseup', swallow, opts)
    window.removeEventListener('touchstart', swallow, opts)
    window.removeEventListener('dblclick', onDblClick, opts)
    window.removeEventListener('keydown', onKey, opts)
    window.removeEventListener('dragover', onDragOver, opts)
    window.removeEventListener('dragleave', onDragLeave, opts)
    window.removeEventListener('drop', onDrop, opts)
    window.removeEventListener('scroll', onScroll)
    window.removeEventListener('message', onMessage)
    document.removeEventListener('pointerleave', pointerLeave)
    overlay.remove()
    style.remove()
    delete root.dataset.cmsMode
  }
}
