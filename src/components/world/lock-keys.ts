/** The keys that do something to a page by themselves: move the focus, press what has it, scroll. */
const PAGE_KEYS = new Set(['Tab', 'Enter', ' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End'])

/**
 * Does this key act on the page behind the leaves by default, so that it must be held until the page is inert?
 * Never one with a modifier: those are the browser's own (reload, find, history, zoom, tab switching) and the
 * visitor keeps them under a closed door.
 */
export function heldKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return !e.ctrlKey && !e.metaKey && !e.altKey && PAGE_KEYS.has(e.key)
}
