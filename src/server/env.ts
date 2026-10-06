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
