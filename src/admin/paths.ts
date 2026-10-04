/* Paths into the site document, as written in data-cms-bind attributes:
   `profile.summary`, `contact.2.label`, `projects[id=focus].metrics.0.value`.
   A `[key=value]` step selects the array element whose `key` equals `value`. */

type Step = string | number | { key: string; value: string }

export function parsePath(path: string): Step[] {
  const steps: Step[] = []
  for (const part of path.split('.')) {
    const m = /^([\w-]+)\[(\w+)=([^\]]+)\]$/.exec(part)
    if (m) { steps.push(m[1]); steps.push({ key: m[2], value: m[3] }); continue }
    steps.push(/^\d+$/.test(part) ? Number(part) : part)
  }
  return steps
}

function step(target: unknown, s: Step): unknown {
  if (target == null) return undefined
  if (typeof s === 'object') return Array.isArray(target) ? target.find((x) => String((x as Record<string, unknown>)?.[s.key]) === s.value) : undefined
  return (target as Record<string | number, unknown>)[s]
}

export function getPath(root: unknown, path: string): unknown {
  return parsePath(path).reduce(step, root)
}

/** Sets a value in place (call on a draft copy). Returns false if the path does not exist. */
export function setPath(root: unknown, path: string, value: unknown): boolean {
  const steps = parsePath(path)
  const last = steps.pop()
  const parent = steps.reduce(step, root) as Record<string | number, unknown> | undefined
  if (parent == null || last === undefined || typeof last === 'object') return false
  if (!(last in parent) && typeof last === 'number') return false
  parent[last] = value
  return true
}
