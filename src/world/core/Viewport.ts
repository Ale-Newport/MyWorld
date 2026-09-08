import { Events } from './Events'

/* ============================================================
   VIEWPORT
   Adapted from sources/Game/Viewport.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.

   Observes the canvas host rather than `window`, because the
   /world canvas lives inside a route that can be narrower than
   the window (and because ResizeObserver fires on device
   rotation and on the mobile URL bar collapsing, which resize
   events do not reliably do).
   ============================================================ */

export class Viewport {
  readonly events = new Events<'change' | 'throttleChange'>()

  width = 1
  height = 1
  ratio = 1
  /** Capped device pixel ratio. Owned by Quality. */
  pixelRatio = 1

  private observer: ResizeObserver | null = null
  private throttleTimer: number | null = null
  private element: HTMLElement

  constructor(element: HTMLElement, pixelRatio = 1) {
    this.element = element
    this.pixelRatio = pixelRatio
    this.measure()

    this.observer = new ResizeObserver(() => this.onResize())
    this.observer.observe(element)
    window.addEventListener('orientationchange', this.onResize)
  }

  private onResize = () => {
    const changed = this.measure()
    if (!changed) return
    this.events.trigger('change')

    // A throttled channel for work too expensive to redo on every
    // pixel of a drag-resize (camera frustum sampling, map layout).
    if (this.throttleTimer !== null) window.clearTimeout(this.throttleTimer)
    this.throttleTimer = window.setTimeout(() => {
      this.throttleTimer = null
      this.events.trigger('throttleChange')
    }, 220)
  }

  private measure(): boolean {
    const rect = this.element.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const height = Math.max(1, Math.round(rect.height))
    if (width === this.width && height === this.height) return false
    this.width = width
    this.height = height
    this.ratio = width / height
    return true
  }

  /** Forces a re-measure and a `change`. Used after quality changes. */
  refresh(): void {
    this.measure()
    this.events.trigger('change')
    this.events.trigger('throttleChange')
  }

  get isPortrait(): boolean {
    return this.ratio < 1
  }

  get isSmall(): boolean {
    return Math.min(this.width, this.height) < 620
  }

  destroy(): void {
    this.observer?.disconnect()
    this.observer = null
    window.removeEventListener('orientationchange', this.onResize)
    if (this.throttleTimer !== null) window.clearTimeout(this.throttleTimer)
    this.events.clear()
  }
}
