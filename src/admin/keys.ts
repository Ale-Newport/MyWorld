/** Focus is somewhere text is typed: editor shortcuts must leave the key alone. */
export function typingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el?.closest) return false
  return !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
}
