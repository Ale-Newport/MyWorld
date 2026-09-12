/* ============================================================
   WHAT A PUBLIC PAGE MAY LINK TO OR LOAD — without zod

   The site document is validated with zod on the server and in
   the admin (schema.ts). The public pages only need these two
   checks, applied again where stored values reach the DOM, so
   they live here as plain functions: the validation library stays
   out of every visitor's download. schema.ts builds its rules on
   the same functions, so the two can never disagree.
   ============================================================ */

/** A URL a visitor may follow: http(s), mailto, tel, or a site-relative path. Never javascript: or data:. */
export function isSafeHref(v: string): boolean {
  if (v.length > 2000) return false
  if (v === '' || v.startsWith('/') || v.startsWith('#')) return !v.startsWith('//')
  try {
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(new URL(v).protocol)
  } catch {
    return false
  }
}

/** Media the site may load: site-relative, or https. */
export function isSafeSrc(v: string): boolean {
  return v.length <= 2000 && (v === '' || (v.startsWith('/') && !v.startsWith('//')) || v.startsWith('https://'))
}
