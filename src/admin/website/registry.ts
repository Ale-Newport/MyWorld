import type { AnimatedSection } from '@/sections/catalog'

/* ============================================================
   WHAT EACH SECTION LETS YOU EDIT — in words

   The content editor is a form per section, and this is the list
   of its fields: what to call each one, a line of help where it
   is useful, and where its value lives in the site document.

     element  text that belongs to the page (a chapter's title, a
              corner note): stored as an override in
              `doc.elements[id]`, falling back to what the code
              renders (`fallback`) until someone edits it;
     data     text that belongs to the portfolio itself (your
              summary, a contact link): edited at its source, so it
              changes everywhere it appears;
     list     an ordered list of strings or of small records.

   Nothing here describes a position, a size or a style: the site's
   code lays every section out for every screen. `recommended` is a
   soft length that keeps the designed composition; the field says
   when it is exceeded but never blocks the edit.
   ============================================================ */

export interface ElementField {
  kind: 'element'
  id: string
  label: string
  help?: string
  fallback: string
  multiline?: boolean
  recommended?: number
  /** May be switched off entirely (corner notes, hints). */
  optional?: boolean
}
export interface DataField {
  kind: 'data'
  path: string
  label: string
  help?: string
  multiline?: boolean
  recommended?: number
  /** Validates a link target (http(s), mailto:, tel: or a site path). */
  link?: boolean
}
export interface ItemField {
  key: string
  label: string
  /** Validates a link target. */
  link?: boolean
  multiline?: boolean
  /** A nested list of small records inside each item (a university's modules). */
  list?: { key: string; label: string }[]
}
export interface ListField {
  kind: 'list'
  path: string
  label: string
  help?: string
  /** A list of plain strings when absent; otherwise each item is a record with these text fields. */
  item?: ItemField[]
  max: number
  /** Empty: the list's items can be edited but not added, removed or reordered (they carry data the form does not show). */
  addLabel: string
  recommended?: number
}
export type FieldDef = ElementField | DataField | ListField

export interface SectionDef {
  id: string
  journey: 'home' | 'projects'
  /** One line under the section's name in the list. */
  summary: string
  fields: FieldDef[]
  animation?: AnimatedSection
  toolbox?: true
  /** Content edited elsewhere, linked from the form. */
  elsewhere?: { label: string; href: string; note: string }[]
}

const tag = (id: string, fallback: string): ElementField => ({ kind: 'element', id: `${id}.tag`, label: 'Chapter tag', help: 'The small label beside the chapter number.', fallback, recommended: 32 })
const title = (id: string, fallback: string, recommended = 40): ElementField => ({ kind: 'element', id: `${id}.title`, label: 'Title', help: 'A line break starts a new line of the title.', fallback, multiline: true, recommended })

const PROJECTS_NOTE = { label: 'Projects', href: '/admin/projects', note: 'The project this chapter tells — its text, facts and figures — is edited with the project.' }

export const SECTIONS: SectionDef[] = [
  {
    id: 'prelude', journey: 'home', summary: 'Your name, the rotating roles and the opening line.',
    fields: [
      { kind: 'data', path: 'profile.name', label: 'Name', help: 'Set across the opening screen in two lines: the first word, then the rest.', recommended: 28 },
      { kind: 'list', path: 'profile.roles', label: 'Rotating roles', help: 'Shown one after another under your name.', max: 12, addLabel: 'Add a role', recommended: 24 },
      { kind: 'data', path: 'profile.thesis', label: 'Opening line', help: 'The sentence the opening screen settles on.', recommended: 40 },
      { kind: 'element', id: 'prelude.tag', label: 'Corner label', fallback: 'PORTFOLIO', recommended: 16 },
      { kind: 'element', id: 'prelude.location', label: 'Location note', fallback: 'London, UK\n51.5072° N', multiline: true, recommended: 32 },
    ],
  },
  {
    id: 'about', journey: 'home', summary: 'The summary, your through-lines and the section animation.', animation: 'about',
    fields: [
      tag('about', 'A LITTLE ABOUT ME'),
      { kind: 'data', path: 'profile.summary', label: 'Summary', help: 'A sentence or two. Longer text is set smaller so it still fits beside the animation.', multiline: true, recommended: 150 },
      { kind: 'list', path: 'profile.markers', label: 'Through-lines', help: 'Pairs such as Spain → London. The animations draw them; screen readers read them as a list.', item: [{ key: 'from', label: 'From' }, { key: 'to', label: 'To' }], max: 12, addLabel: 'Add a through-line', recommended: 14 },
      { kind: 'element', id: 'about.corner', label: 'Corner note', fallback: 'THE PATH BELOW\nIS THE TIMELINE', multiline: true, optional: true, recommended: 36 },
    ],
  },
  {
    id: 'toolbox', journey: 'home', summary: 'The wall of technologies and what it says about each one.', toolbox: true,
    fields: [
      tag('toolbox', 'EVIDENCE, NOT KEYWORDS'),
      title('toolbox', 'Tech\ntoolbox', 24),
      { kind: 'element', id: 'toolbox.note', label: 'Instruction', help: 'One line telling visitors what a technology does when they point at it.', fallback: 'Hover or tap a technology to light up every project that actually used it.', multiline: true, recommended: 90 },
      { kind: 'element', id: 'toolbox.group.language', label: 'Group heading — languages', fallback: 'Languages', recommended: 16 },
      { kind: 'element', id: 'toolbox.group.framework', label: 'Group heading — frameworks', fallback: 'Frameworks', recommended: 16 },
      { kind: 'element', id: 'toolbox.group.ai', label: 'Group heading — AI / ML', fallback: 'AI / ML', recommended: 16 },
      { kind: 'element', id: 'toolbox.group.data', label: 'Group heading — data', fallback: 'Data', recommended: 16 },
      { kind: 'element', id: 'toolbox.group.cloud', label: 'Group heading — cloud', fallback: 'Cloud & Infra', recommended: 16 },
      { kind: 'element', id: 'toolbox.group.tooling', label: 'Group heading — tooling', fallback: 'Tooling', recommended: 16 },
      { kind: 'element', id: 'toolbox.group.design', label: 'Group heading — design', fallback: 'Design & Web', recommended: 16 },
    ],
    elsewhere: [{ label: 'Projects', href: '/admin/projects', note: 'Which projects prove each technology is set on each project, under Stack.' }],
  },
  {
    id: 'universe', journey: 'home', summary: 'Every project, the filters and the section animation.', animation: 'universe',
    fields: [
      tag('universe', 'PROJECT UNIVERSE'),
      title('universe', 'Everything\nI have built', 32),
      { kind: 'element', id: 'universe.hint', label: 'Hint', help: 'Shown at the foot of the section until a project is pointed at.', fallback: 'Point at a project to read it · select one to open it', optional: true, recommended: 60 },
    ],
    elsewhere: [{ label: 'Projects', href: '/admin/projects', note: 'The projects themselves — which are listed, their order and text — are edited under Projects.' }],
  },
  {
    id: 'education', journey: 'home', summary: 'Your two universities and what you studied.',
    fields: [
      tag('education', 'EDUCATION'),
      title('education', 'Two universities,\none direction.', 40),
      { kind: 'list', path: 'education', label: 'Universities', help: 'Each one is a card on the wall.', item: [{ key: 'institution', label: 'Institution' }, { key: 'shortName', label: 'Short name' }, { key: 'degree', label: 'Degree' }, { key: 'dates', label: 'Dates' }, { key: 'result', label: 'Result' }, { key: 'location', label: 'Location' }, { key: 'modules', label: 'Modules', list: [{ key: 'name', label: 'Module' }, { key: 'blurb', label: 'Note' }] }], max: 4, addLabel: '', recommended: 64 },
      { kind: 'element', id: 'education.foot.label', label: 'Credentials label', fallback: 'Also', recommended: 12 },
    ],
  },
  {
    id: 'contact', journey: 'home', summary: 'The closing words, your links and the section animation.', animation: 'contact',
    fields: [
      tag('contact', 'END OF JOURNEY'),
      { kind: 'data', path: 'profile.closing.question', label: 'Closing question', recommended: 16 },
      { kind: 'data', path: 'profile.closing.answer', label: 'Closing answer', help: 'Set very large, in the accent colour.', recommended: 18 },
      { kind: 'list', path: 'contact', label: 'Contact links', item: [{ key: 'label', label: 'Label' }, { key: 'value', label: 'Shown as' }, { key: 'href', label: 'Link', link: true }], max: 8, addLabel: '', recommended: 48 },
      { kind: 'element', id: 'contact.colophon.built', label: 'Colophon', fallback: 'Built with Next.js, React Three Fiber and a lot of scroll maths.', optional: true, recommended: 80 },
    ],
  },
  { id: 'pansofia', journey: 'projects', summary: 'Client work for Pansofia / Grupo Newport.', fields: [tag('pansofia', 'FROM PROJECTS TO PRODUCTS'), title('pansofia', 'Pansofia /\nGrupo Newport')], elsewhere: [PROJECTS_NOTE] },
  { id: 'teaching', journey: 'projects', summary: 'Teaching at King’s College London.', fields: [tag('teaching', 'LEARNING BY TEACHING'), title('teaching', 'First I learned how systems work.\nThen I learned how to explain them.', 80)] },
  { id: 'focus', journey: 'projects', summary: 'Focus, the AI learning-video product.', fields: [tag('focus', 'BUILDING A PRODUCT'), title('focus', 'Focus', 24)], elsewhere: [PROJECTS_NOTE] },
  { id: 'gym', journey: 'projects', summary: 'The rigged exercise system.', fields: [tag('gym', 'ONE MODEL, MANY MOVEMENTS'), title('gym', 'Gym App', 24)], elsewhere: [PROJECTS_NOTE] },
  { id: 'metaview', journey: 'projects', summary: 'AI and data at Metaview.', fields: [tag('metaview', '[ AI / DATA ]'), title('metaview', 'Metaview', 24)] },
  { id: 'chess', journey: 'projects', summary: 'The chess board reader.', fields: [tag('chess', 'SEEING THE BOARD'), title('chess', 'Chess\nAssistant', 24)], elsewhere: [PROJECTS_NOTE] },
  { id: 'stock', journey: 'projects', summary: 'The order-book simulator.', fields: [tag('stock', 'CONCURRENCY'), title('stock', 'Order book', 24)], elsewhere: [PROJECTS_NOTE] },
]

export const SECTION_BY_ID: Record<string, SectionDef> = Object.fromEntries(SECTIONS.map((s) => [s.id, s]))

export const PAGES = [
  { id: 'home' as const, label: 'Home', path: '/' },
  { id: 'projects' as const, label: 'Projects page', path: '/projects' },
]
