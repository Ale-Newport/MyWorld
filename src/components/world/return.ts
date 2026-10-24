/* ============================================================
   THE WAY BACK

   Where the visitor was on the homepage when they went through,
   so Back is a return rather than a reset (`history.scrollRestoration`
   is manual for the whole site: the browser restores nothing on its
   own). Written by EVERY way into the world — the scroll push, the
   "Enter my world" link, the index's link — at the moment it begins,
   because the homepage resets its own scroll state as it unmounts
   under the leaves; read once by the homepage when it comes back
   (journey/WorldPortal.tsx).
   ============================================================ */

/** sessionStorage: the journey's progress, 0..1, when the way in began. */
export const RETURN_KEY = 'journey:return'
/** localStorage: set the first time anyone goes through; the chapter index reads it. */
export const UNLOCKED_KEY = 'world2Unlocked'

export function markReturn(progress: number) {
  try {
    window.sessionStorage.setItem(RETURN_KEY, String(progress))
    window.localStorage.setItem(UNLOCKED_KEY, '1')
  } catch {
    // Private mode, or storage denied. The world simply shows its
    // own gate and the return simply starts at the top.
  }
}
