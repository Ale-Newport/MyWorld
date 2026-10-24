import { contact, type ContactLink } from '@/content/profile'

/* ============================================================
   WHICH CONTACTS THE PLAZA STANDS BEHIND

   The Social plaza has one station per way to get in touch, and
   the rule for which of them is a LINK is the website's own: the
   CV is a placeholder until its PDF exists, and the homepage
   prints "On request" in place of a link (Contact.tsx,
   IndexOverlay.tsx: `id === 'cv' && dataStatus === 'placeholder'`).
   The world follows the same rule from the same data, so the day
   `dataStatus` of the CV becomes 'verified' its plaque turns into
   a prompt and its achievement mark — and the Say-hello target —
   follow without anyone touching the world.

   Nothing here knows about geometry. It is shared by the Social
   controller and by the achievement table.
   ============================================================ */

/** Station order on the plaza, left to right on screen. A contact with no station here gets no 3D. */
export const STATIONS = ['github', 'linkedin', 'email', 'cv'] as const
export type StationId = (typeof STATIONS)[number]

/** Which authored icon stands on which station. The CV has none: the plaza builds a document for it. */
export const STATION_ICONS: Partial<Record<StationId, string>> = {
  github: 'gitHubPhysicalDynamic',
  linkedin: 'linkedInPhysicalDynamic',
  email: 'mailPhysicalDynamic',
}

/** True while the entry has no real destination yet: shown as "On request", not as a link. */
export const isPending = (entry: Pick<ContactLink, 'id' | 'dataStatus'>): boolean => entry.id === 'cv' && entry.dataStatus === 'placeholder'

export const hasStation = (entry: Pick<ContactLink, 'id'>): boolean => (STATIONS as readonly string[]).includes(entry.id)

/** The entries that open something: the ones the Say-hello achievement counts. */
export const interactiveContacts = (list: readonly ContactLink[] = contact): ContactLink[] => list.filter(entry => hasStation(entry) && !isPending(entry))

/** What a board prints under the name: the handle, without the host the logo already says. */
export function shortValue(entry: Pick<ContactLink, 'id' | 'value' | 'dataStatus'>): string {
  if (isPending(entry)) return 'On request'
  return entry.value.replace(/^(?:https?:\/\/)?(?:www\.)?(?:github\.com|linkedin\.com)\//i, '')
}
