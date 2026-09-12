import { getLenis } from '@/hooks/useLenisScroll'

/* ============================================================
   THE PREVIEW'S LINK TO THE EDITOR — read only

   Loaded only into the admin's preview frame (Draft Mode with a
   verified session, inside the admin's window). The frame is the
   public renderer itself; this adds two small courtesies and
   nothing that can change a layout:

     · the editor can ask for a section to be brought into view
       (`cms:scroll-to-section`), at the point of its scroll where
       its animation is in full swing;
     · clicking inside a section tells the editor which one it was
       (`cms:section`), so its settings can be opened. The click
       itself still reaches the page.

   It also reports which section is on screen as the visitor-
   equivalent scrolls, so the editor can follow along.
   ============================================================ */

const MSG = 'cms:'

export function startPreviewLink(): () => void {
  const parentWindow = window.parent
  const post = (message: Record<string, unknown>) => parentWindow.postMessage(message, location.origin)

  const sectionAt = (el: Element | null): string | null => el?.closest<HTMLElement>('[data-chapter]')?.dataset.chapter ?? null

  const scrollTo = (section: string, at: number) => {
    const s = document.querySelector<HTMLElement>(`[data-chapter="${CSS.escape(section)}"]`)
    if (!s) return
    // A pinned chapter's stage holds still while its section scrolls
    // past; `at` is how far through that scroll to stop.
    const top = s.getBoundingClientRect().top + scrollY
    const travel = Math.max(0, s.offsetHeight - innerHeight)
    const y = top + travel * Math.min(1, Math.max(0, at))
    const lenis = getLenis()
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true })
    else window.scrollTo({ top: y })
  }

  const onMessage = (e: MessageEvent) => {
    if (e.origin !== location.origin || e.source !== parentWindow) return
    const m = e.data as Record<string, unknown>
    if (typeof m?.type !== 'string' || !m.type.startsWith(MSG)) return
    if (m.type === 'cms:scroll-to-section') scrollTo(String(m.section), typeof m.at === 'number' ? m.at : 0.5)
  }

  const onPointerDown = (e: PointerEvent) => {
    const section = sectionAt(e.target as Element | null)
    if (section) post({ type: `${MSG}section`, section })
  }

  let current: string | null = null
  let raf = 0
  const onScroll = () => {
    if (raf) return
    raf = requestAnimationFrame(() => {
      raf = 0
      const section = sectionAt(document.elementFromPoint(innerWidth / 2, innerHeight / 2))
      if (section && section !== current) {
        current = section
        post({ type: `${MSG}viewport`, section })
      }
    })
  }

  window.addEventListener('message', onMessage)
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  post({ type: `${MSG}link-ready`, path: location.pathname })
  onScroll()

  return () => {
    cancelAnimationFrame(raf)
    window.removeEventListener('message', onMessage)
    window.removeEventListener('pointerdown', onPointerDown, { capture: true })
    window.removeEventListener('scroll', onScroll)
  }
}
