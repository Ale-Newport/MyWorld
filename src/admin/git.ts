import type { GitResult } from '@/server/git-publish'
import { toast } from './toast'

/** Says in a toast what a publish did to the repository (the editor commits and pushes what it publishes). */
export function announceGit(subject: string, git: GitResult | undefined) {
  if (!git) return toast(`Published — ${subject}`, 'ok')
  if (git.error) return toast(`Published here, but the repository is not up to date: ${git.error}`, 'danger')
  if (!git.committed) return toast(`Published — the repository already had ${subject}`, 'ok')
  return toast(`Published and pushed (${git.commit}) — the website updates in a minute or two`, 'ok')
}
