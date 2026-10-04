/** Human wording for audit actions (dashboard, history). */
const WORDS: Record<string, string> = {
  'document.seed': 'Imported the shipped content as revision one',
  'draft.save': 'Saved a draft',
  'draft.overwrite': 'Saved a draft over a concurrent edit',
  publish: 'Published',
  restore: 'Restored an earlier revision as the draft',
  'auth.login': 'Signed in',
  'auth.logout': 'Signed out',
  'auth.failed': 'Failed sign-in attempt',
  'user.create': 'Created an administrator',
  'user.password-reset': 'Reset a password',
  'media.upload': 'Uploaded a file',
  'media.update': 'Edited file details',
  'media.delete': 'Deleted a file',
  'error.publish': 'Publishing failed',
  maintenance: 'Cleaned up old revisions and files',
}
export function describeAction(action: string, docId?: string | null) {
  const what = docId === 'world' ? ' (world)' : docId === 'site' ? ' (site)' : ''
  return (WORDS[action] ?? action) + what
}
