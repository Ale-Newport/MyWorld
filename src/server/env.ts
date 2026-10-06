import { getCloudflareContext } from '@opennextjs/cloudflare'

/** A server setting: from process.env, or straight from the Worker's bindings (secrets) on Cloudflare. */
export function env(name: string): string | undefined {
  const value = process.env[name]
  if (value) return value
  try {
    const bound = (getCloudflareContext().env as unknown as Record<string, unknown>)[name]
    return typeof bound === 'string' && bound ? bound : undefined
  } catch {
    return undefined
  }
}

/** Which settings this process can see, by name only (never values): for the admin's error page. */
export function envReport(names: string[]): string {
  let bound: Record<string, unknown> = {}
  let context = 'no Cloudflare context'
  try {
    bound = getCloudflareContext().env as unknown as Record<string, unknown>
    context = `bindings: ${Object.keys(bound).filter((k) => !k.startsWith('NEXT_')).sort().join(', ') || 'none'}`
  } catch { /* not on Workers */ }
  return `${names.map((n) => `${n}: ${process.env[n] ? 'env' : bound[n] ? 'binding' : 'missing'}`).join(' · ')} — ${context}`
}
