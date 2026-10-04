'use client'

/* ============================================================
   ADMIN API CLIENT
   Every state-changing request carries the session's CSRF token
   (handed to the panel by its server layout) and is same-origin.
   Errors come back as AdminError with the server's message and,
   for a 409, the current head of the document.
   ============================================================ */

let csrf = ''
export function setCsrf(token: string) {
  csrf = token
}

export class AdminError extends Error {
  status: number
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

export async function api<T = unknown>(url: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init
  const method = (rest.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase()
  const res = await fetch(url, {
    ...rest,
    method,
    credentials: 'same-origin',
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(method !== 'GET' && method !== 'HEAD' ? { 'x-csrf-token': csrf } : {}),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const type = res.headers.get('content-type') ?? ''
  const data = type.includes('json') ? await res.json().catch(() => ({})) : await res.text()
  if (!res.ok) {
    const body = (typeof data === 'object' ? data : { error: data }) as Record<string, unknown>
    // The session expired: a full load to the login page, so nothing of it lingers in client caches.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    if (res.status === 401 && typeof window !== 'undefined') window.location.assign(`/admin/login?next=${encodeURIComponent(location.pathname)}`)
    throw new AdminError(res.status, String(body.error ?? res.statusText), body)
  }
  return data as T
}
