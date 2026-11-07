import { Fragment, type ReactNode } from 'react'
import { TECH_GROUPS, type SiteContent } from '@/cms/derive'
import { sitePages } from '@/components/navigation/pages'
import { COFFEE, FORTUNES, SANDWICH, cowsay } from './art'
import styles from './Terminal.module.css'

/* ============================================================
   WHAT THE TERMINAL ANSWERS
   Every command reads the published site document (useSite()),
   never a copy of it: rename a project in the admin and `projects`
   says so, add a contact link and it becomes a command of its
   own. The shell itself — printing, timing, navigating, the
   window — is the Terminal's, handed in as `Shell`, so this file
   decides only what is said.

   `help` lists the commands with a summary. The rest are easter
   eggs: unlisted, never offered by Tab, counted by `.easter-eggs`
   (try `ls -a`). In the tone of hooks/useEasterEggs: small, kind,
   reversible, and none of them in the visitor's way.
   ============================================================ */

/* ---- output --------------------------------------------------- */

type Tone = 'accent' | 'signal' | 'dim' | 'error' | 'strong'

/** One line (or paragraph) of output. */
export function Line({ tone, children }: { tone?: Tone; children?: ReactNode }) {
  return <div className={styles.line} data-tone={tone}>{children ?? ' '}</div>
}

function Em({ tone = 'accent', children }: { tone?: Tone; children: ReactNode }) {
  return <span data-tone={tone}>{children}</span>
}

/** A command named in the output: what to type next. */
function K({ children }: { children: ReactNode }) {
  return <span className={styles.kbd}>{children}</span>
}

type Row = [key: ReactNode, value: ReactNode]
const row = (key: ReactNode, value: ReactNode): Row => [key, value]

/** A key and what it is, aligned; on a narrow screen each pair stacks. */
function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className={styles.rows}>
      {rows.map(([k, v], i) => (
        <Fragment key={i}>
          <span className={styles.rowKey}>{k}</span>
          <span className={styles.rowValue}>{v}</span>
        </Fragment>
      ))}
    </div>
  )
}

/** Words laid out in columns, like `ls` does. */
function Columns({ items }: { items: ReactNode[] }) {
  return <div className={styles.columns}>{items.map((it, i) => <span key={i}>{it}</span>)}</div>
}

/** Preformatted: ASCII art and anything aligned by spaces. Scrolls sideways rather than wrapping. */
function Art({ children }: { children: string }) {
  return <pre className={styles.art}>{children}</pre>
}

/* ---- the shell the Terminal provides ------------------------------ */

export interface Step {
  node: ReactNode
  /** Milliseconds after the step before it. */
  wait: number
  /** Runs as the step is printed. */
  effect?: () => void
}

export const EGGS = ['sudo', 'sandwich', 'rm', 'coffee', 'tea', 'hello', '42', 'matrix', 'editors', 'ping', 'konami', 'fortune', 'cowsay', 'xyzzy', 'hire', 'git', 'neofetch', 'manners'] as const
export type EggId = (typeof EGGS)[number]

export interface Shell {
  site: SiteContent
  /** The visitor's name in the prompt, and the machine's. */
  user: string
  host: string
  /** The page the terminal is on, e.g. `/contact`. */
  path: string
  history: readonly string[]
  reducedMotion: boolean
  eggsFound: number
  print: (...nodes: ReactNode[]) => void
  clear: () => void
  /** Prints the steps one after another; the prompt waits, and Ctrl+C cuts it short. */
  stream: (steps: Step[]) => void
  /** A page of this site, through the router. */
  go: (href: string) => void
  /** A full page load: the world builds itself from a fresh document. */
  leave: (href: string) => void
  /** A new tab, or the mail app for a mailto: link. */
  open: (href: string) => void
  minimise: () => void
  matrix: () => void
  shake: () => void
  egg: (id: EggId) => void
}

interface Command {
  name: string
  aliases?: string[]
  /** Listed by help, and offered by Tab. An easter egg has none. */
  summary?: string
  usage?: string
  group?: 'site' | 'shell'
  egg?: EggId
  /** What Tab offers after the name. */
  args?: (site: SiteContent) => string[]
  run: (args: string[], line: string, sh: Shell) => void
}

/* ---- helpers ---------------------------------------------------------- */

type ContactLink = SiteContent['contact'][number]

const pendingCv = (c: ContactLink) => c.id === 'cv' && c.dataStatus === 'placeholder'
const commandName = (id: string) => id.toLowerCase().replace(/[^a-z0-9-]/g, '')
const firstName = (site: SiteContent) => site.profile.name.split(/\s+/)[0] ?? site.profile.name
const mailLink = (site: SiteContent) => site.contact.find((c) => c.href.startsWith('mailto:') && !pendingCv(c))

/** "type email", or nothing when there is no address to type. */
function askByMail(site: SiteContent, before = 'type'): ReactNode {
  const mail = mailLink(site)
  return mail ? <>{before} <K>{commandName(mail.id)}</K></> : null
}

/** `~/projects/`, `./projects`, `/projects` and `PROJECTS` all mean the same directory. */
function normalise(arg: string) {
  return arg.trim().toLowerCase().replace(/^~\/?/, '').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
}

function tokenize(line: string): string[] {
  return Array.from(line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g), (m) => m[1] ?? m[2] ?? m[3])
}

function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = row[j]
      row[j] = next
    }
  }
  return row[b.length]
}

/** The nearest of `options` to a typo, if it is near enough to be what was meant. */
function closest(word: string, options: string[]) {
  let best: string | undefined
  let score = Infinity
  for (const o of options) {
    const d = distance(word.toLowerCase(), o)
    if (d < score) { score = d; best = o }
  }
  return score <= Math.max(1, Math.min(2, Math.floor(word.length / 3))) ? best : undefined
}

/** A seven-character hash for a fake commit, stable for a given string. */
function shortHash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0').slice(0, 7)
}

const two = (n: number) => String(n).padStart(2, '0')

/** The date the way `date` prints it: `Sat Nov  7 14:03:12 GMT 2026`. */
export function zshDate(d: Date, { zone = true }: { zone?: boolean } = {}) {
  const day = d.toLocaleDateString('en-US', { weekday: 'short' })
  const month = d.toLocaleDateString('en-US', { month: 'short' })
  const time = `${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`
  const tz = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value
  const base = `${day} ${month} ${String(d.getDate()).padStart(2, ' ')} ${time}`
  return zone ? `${base} ${tz ?? ''} ${d.getFullYear()}`.replace(/\s+(?=\d{4}$)/, ' ') : base
}

/* ---- what the commands share ------------------------------------------ */

function openContact(c: ContactLink, sh: Shell) {
  if (pendingCv(c)) {
    const ask = askByMail(sh.site)
    sh.print(<Line>{c.label}: <Em>on request</Em>.{ask && <> To ask for it, {ask}.</>}</Line>)
    return
  }
  if (c.href.startsWith('mailto:')) {
    sh.print(<Line>Opening your mail app — <Em>{c.value}</Em></Line>, <Line tone="dim">Nothing happened? Copy the address above; it reaches me all the same.</Line>)
  } else {
    sh.print(<Line>Opening <Em>{c.value}</Em> in a new tab…</Line>)
  }
  sh.open(c.href)
}

function openProject(slug: string, sh: Shell) {
  const p = sh.site.projectBySlug[slug]
  if (!p) return false
  sh.print(<Line tone="dim">Opening {p.title}…</Line>)
  sh.go(`${sh.site.journeys.projects.path}/${p.slug}`)
  return true
}

function about(sh: Shell) {
  const { profile, projects, techNodes } = sh.site
  sh.print(
    <Line tone="strong">{profile.name}</Line>,
    <Line tone="accent">{profile.roles.join(' · ')}</Line>,
    <Line>{profile.summary}</Line>,
    <Rows rows={[
      row('based in', profile.location),
      row('from', profile.origin),
      row('work', <>{projects.length} projects — <K>projects</K></>),
      row('stack', <>{techNodes.length} technologies — <K>skills</K></>),
      row('reach me', <K>contact</K>),
    ]} />,
  )
}

/* ---- the commands -------------------------------------------------------- */

function buildCommands(site: SiteContent): Command[] {
  const contactCommands: Command[] = site.contact.map((c) => ({
    name: commandName(c.id),
    summary: pendingCv(c) ? `${c.label} (on request)` : `${c.label} — ${c.value}`,
    group: 'site',
    run: (_a, _l, sh) => openContact(c, sh),
  }))

  const listed: Command[] = [
    {
      name: 'help', group: 'shell', summary: 'This list',
      run: (_a, _l, sh) => {
        const all = commands(sh.site).filter((c) => c.summary)
        const section = (group: Command['group']) => <Rows rows={all.filter((c) => c.group === group).map((c) => row(<K>{c.usage ?? c.name}</K>, c.summary))} />
        sh.print(
          <Line tone="dim">The site, from the keyboard:</Line>,
          section('site'),
          <Line />,
          <Line tone="dim">And the shell:</Line>,
          section('shell'),
          <Line />,
          <Line tone="dim">Tab completes · Up and Down recall · Ctrl+L clears · Ctrl+C cancels.</Line>,
          <Line tone="dim">Not everything is on this list.</Line>,
        )
      },
    },
    { name: 'about', aliases: ['whoami'], group: 'site', summary: 'Who I am (or: whoami)', run: (_a, line, sh) => {
      if (/^whoami/i.test(line)) sh.print(<Line>{sh.user}</Line>, <Line tone="dim">That is you. This is me:</Line>, <Line />)
      about(sh)
    } },
    {
      name: 'contact', group: 'site', summary: 'Every way to reach me',
      run: (_a, _l, sh) => {
        sh.print(
          <Rows rows={sh.site.contact.map((c) => row(
            <K>{commandName(c.id)}</K>,
            pendingCv(c)
              ? <Em tone="dim">On request</Em>
              : <a href={c.href} target={c.href.startsWith('http') ? '_blank' : undefined} rel={c.href.startsWith('http') ? 'noreferrer noopener' : undefined} data-cursor="link" data-cursor-text={c.label.toUpperCase()}>{c.value}</a>,
          ))} />,
          <Line tone="dim">Type a name on the left to open it.</Line>,
        )
      },
    },
    ...contactCommands,
    {
      name: 'projects', group: 'site', summary: 'Everything I have built, listed',
      run: (_a, _l, sh) => {
        const { projects } = sh.site
        sh.print(
          <Line tone="dim">{projects.length} projects, in the order the site tells them:</Line>,
          <Rows rows={projects.map((p) => row(<Em tone="signal">{p.slug}</Em>, <>{p.title} <Em tone="dim">· {p.year}</Em></>))} />,
          <Line tone="dim"><K>open &lt;project&gt;</K> to read one. Tab completes the name.</Line>,
        )
      },
    },
    {
      name: 'open', group: 'site', usage: 'open <project>', summary: 'Go to a project’s page',
      args: (s) => [...s.projects.map((p) => p.slug), ...s.contact.map((c) => commandName(c.id))],
      run: (args, _l, sh) => {
        const raw = args[0]
        if (!raw) { sh.print(<Line>usage: open &lt;project&gt;</Line>, <Line tone="dim">Type <K>projects</K> for the names, or press Tab after <K>open </K>.</Line>); return }
        const t = normalise(raw).replace(/^projects\//, '')
        if (openProject(t, sh)) return
        const link = sh.site.contact.find((c) => commandName(c.id) === t)
        if (link) { openContact(link, sh); return }
        if (sitePages(sh.site).some((p) => p.id === t)) { cd([t], sh); return }
        const guess = closest(t, sh.site.projects.map((p) => p.slug))
        sh.print(
          <Line tone="error">open: no such project: {raw}</Line>,
          <Line tone="dim">{guess ? <>Did you mean <K>open {guess}</K>?</> : <>Type <K>projects</K> for the list.</>}</Line>,
        )
      },
    },
    {
      name: 'ls', group: 'site', summary: 'The pages of this site',
      run: (args, _l, sh) => {
        const all = args.some((a) => /^-\w*a/.test(a))
        const target = args.find((a) => !a.startsWith('-'))
        const pages = sitePages(sh.site).filter((p) => p.id !== 'home')
        if (target) {
          const t = normalise(target)
          if (t === 'projects') { sh.print(<Columns items={sh.site.projects.map((p) => <Em key={p.slug} tone="signal">{p.slug}</Em>)} />); return }
          if (pages.some((p) => p.id === t)) { sh.print(<Line tone="dim">A page, not a folder of files: <K>cd {t}</K> to go there.</Line>); return }
          if (t === '' || t === '.') { ls([], sh); return }
          sh.print(<Line tone="error">ls: {target}: No such file or directory</Line>)
          return
        }
        const rows = pages.map((p) => row(<Em tone="signal">{p.id}/</Em>, p.note))
        if (all) rows.unshift(row(<Em tone="dim">.easter-eggs</Em>, <Em tone="dim">cat it</Em>))
        sh.print(<Rows rows={rows} />, <Line tone="dim"><K>cd &lt;page&gt;</K> to go to one.</Line>)
      },
    },
    {
      name: 'cd', group: 'site', usage: 'cd <page>', summary: 'Go to a page: ~, projects, world…',
      args: (s) => ['~', ...sitePages(s).filter((p) => p.id !== 'home').map((p) => p.id)],
      run: (args, _l, sh) => cd(args, sh),
    },
    {
      name: 'skills', aliases: ['stack'], group: 'site', summary: 'The tools I use, by kind (or: stack)',
      run: (_a, _l, sh) => {
        const { techNodes } = sh.site
        const rows = TECH_GROUPS
          .map((g) => [g.label, techNodes.filter((t) => t.group === g.id).map((t) => t.name)] as const)
          .filter(([, names]) => names.length)
          .map(([label, names]) => row(<Em>{label}</Em>, names.join(', ')))
        sh.print(<Rows rows={rows} />, <Line tone="dim">{techNodes.length} technologies. The home page’s Tech Toolbox shows where each one was used.</Line>)
      },
    },
    { name: 'clear', group: 'shell', summary: 'Clear the screen (Ctrl+L)', run: (_a, _l, sh) => sh.clear() },
    {
      name: 'history', group: 'shell', summary: 'What you have typed',
      run: (_a, _l, sh) => sh.print(<Art>{sh.history.map((c, i) => `${String(i + 1).padStart(5)}  ${c}`).join('\n')}</Art>),
    },
    { name: 'date', group: 'shell', summary: 'Today, to the second', run: (_a, _l, sh) => sh.print(<Line>{zshDate(new Date())}</Line>) },
    {
      name: 'echo', group: 'shell', usage: 'echo <text>', summary: 'Say it back',
      run: (_a, line, sh) => {
        const env: Record<string, string> = { USER: sh.user, HOME: '~', SHELL: '/bin/zsh', PWD: sh.path, TERM: 'xterm-256color', HOST: sh.host, LANG: 'en_GB.UTF-8' }
        const text = line.replace(/^echo\s?/i, '').replace(/\$\{(\w+)\}|\$(\w+)/g, (_m, a: string | undefined, b: string | undefined) => env[a ?? b ?? ''] ?? '')
        sh.print(<Line>{text.replace(/^(["'])(.*)\1$/, '$2')}</Line>)
      },
    },
    { name: 'pwd', group: 'shell', summary: 'Where you are', run: (_a, _l, sh) => sh.print(<Line>{domain(sh.site)}{sh.path}</Line>) },
    { name: 'exit', aliases: ['logout', 'quit'], group: 'shell', summary: 'Minimise the terminal', run: (_a, _l, sh) => sh.minimise() },
  ]

  /* ---- easter eggs: unlisted, untabbable ---- */
  const eggs: Command[] = [
    {
      name: 'matrix', egg: 'matrix',
      run: (_a, _l, sh) => {
        if (sh.reducedMotion) {
          sh.print(<Line tone="signal">The rain stays in the clouds: this device asks for less motion.</Line>, <Line tone="dim">You are still the one, though.</Line>)
          return
        }
        sh.matrix()
      },
    },
    { name: 'vim', aliases: ['vi', 'nvim'], egg: 'editors', run: (_a, _l, sh) => sh.print(<Line>Opening vim would be cruel: nobody has ever found the way out.</Line>, <Line tone="dim">(It is :q! — you are welcome.)</Line>) },
    { name: 'emacs', egg: 'editors', run: (_a, _l, sh) => sh.print(<Line>emacs: a fine operating system. It only lacks a text editor.</Line>, <Line tone="dim">Try <K>nano</K>, or don’t.</Line>) },
    { name: 'nano', egg: 'editors', run: (_a, _l, sh) => sh.print(<Line>nano: the sensible choice. Sadly this portfolio is read-only.</Line>) },
    {
      name: 'ping', egg: 'ping',
      run: (args, _l, sh) => {
        const target = args.find((a) => !a.startsWith('-')) ?? firstName(sh.site).toLowerCase()
        const ip = '127.0.0.1'
        const times = [0, 1, 2, 3].map(() => (0.03 + Math.random() * 0.07).toFixed(3))
        sh.print(<Line>PING {target} ({ip}): 56 data bytes</Line>)
        sh.stream([
          ...times.map((t, i): Step => ({ node: <Line>64 bytes from {ip}: icmp_seq={i} ttl=64 time={t} ms</Line>, wait: i ? 650 : 350 })),
          { node: <><Line /><Line>--- {target} ping statistics ---</Line><Line>4 packets transmitted, 4 packets received, 0.0% packet loss</Line></>, wait: 450 },
          { node: <Line tone="dim">Everything here resolves to localhost. For a reply from a person, {askByMail(sh.site) ?? <K>contact</K>}.</Line>, wait: 250 },
        ])
      },
    },
    {
      name: 'konami', egg: 'konami',
      run: (_a, _l, sh) => sh.print(<Line>Up, Up, Down, Down, Left, Right, Left, Right, B, A.</Line>, <Line tone="dim">The keys, not the words — anywhere on this page. Even in here.</Line>),
    },
    {
      name: 'fortune', egg: 'fortune',
      run: (_a, _l, sh) => sh.print(<Line>{FORTUNES[Math.floor(Math.random() * FORTUNES.length)]}</Line>),
    },
    {
      name: 'cowsay', egg: 'cowsay',
      run: (_a, line, sh) => sh.print(<Art>{cowsay(line.replace(/^cowsay\s*/i, '') || 'Moo. Type help.')}</Art>),
    },
    { name: 'xyzzy', egg: 'xyzzy', run: (_a, _l, sh) => sh.print(<Line>Nothing happens.</Line>) },
    {
      name: 'git', egg: 'git',
      run: (args, _l, sh) => {
        const sub = args[0]?.toLowerCase()
        if (sub === 'status') {
          sh.print(<Line>On branch main</Line>, <Line>Your branch is up to date with &apos;origin/main&apos;.</Line>, <Line />, <Line>nothing to commit, working tree clean</Line>)
        } else if (sub === 'log') {
          sh.print(<Art>{sh.site.projects.slice(0, 6).map((p) => `${shortHash(p.slug)}  feat: ${p.title} (${p.year})`).join('\n')}</Art>, <Line tone="dim">…and {Math.max(0, sh.site.projects.length - 6)} more. <K>projects</K> has the rest.</Line>)
        } else if (sub === 'blame') {
          sh.print(<Line>Every line: {sh.site.profile.name}. Every bug, too.</Line>)
        } else if (sub === 'push' && args.some((a) => a === '-f' || a === '--force')) {
          sh.print(<Line tone="error">! [rejected] main -&gt; main (force-pushing someone else’s portfolio is bold)</Line>)
        } else {
          sh.print(<Line>usage: git status | log | blame</Line>)
        }
      },
    },
    {
      name: 'neofetch', aliases: ['fastfetch'], egg: 'neofetch',
      run: (_a, _l, sh) => {
        const { profile, projects, techNodes } = sh.site
        const ini = profile.initials.slice(0, 4)
        const inner = 8
        const left = Math.floor((inner - ini.length) / 2)
        const logo = [
          `.${'-'.repeat(inner)}.`,
          `|${' '.repeat(inner)}|`,
          `|${' '.repeat(left)}${ini}${' '.repeat(inner - left - ini.length)}|`,
          `|${' '.repeat(inner)}|`,
          `'${'-'.repeat(inner)}'`,
        ].join('\n')
        const uptime = Math.max(1, Math.round(performance.now() / 60000))
        sh.print(
          <div className={styles.fetch}>
            <Art>{logo}</Art>
            <div>
              <Line><Em tone="signal">{sh.user}@{sh.host}</Em></Line>
              <Rows rows={[
                row('OS', `Portfolio ${profile.year}`),
                row('Host', domain(sh.site)),
                row('Shell', 'zsh (a small one)'),
                row('Owner', profile.name),
                row('Location', profile.location),
                row('Roles', profile.roles.slice(0, 3).join(', ')),
                row('Projects', String(projects.length)),
                row('Stack', `${techNodes.length} technologies`),
                row('Uptime', `${uptime} min (this visit)`),
              ]} />
            </div>
          </div>,
        )
      },
    },
    {
      name: 'cat',
      run: (args, _l, sh) => {
        const f = args[0]
        if (!f) { sh.print(<Line>usage: cat &lt;file&gt;</Line>); return }
        const t = normalise(f)
        if (t === '.easter-eggs') {
          const all = sh.eggsFound >= EGGS.length
          sh.print(<Line>You have found <Em>{sh.eggsFound}</Em> of {EGGS.length} easter eggs.</Line>, <Line tone="dim">{all ? 'All of them. Respect.' : 'No spoilers. Try things a terminal would know.'}</Line>)
        } else if (sitePages(sh.site).some((p) => p.id === t)) {
          sh.print(<Line tone="error">cat: {f}: Is a directory</Line>)
        } else {
          sh.print(<Line tone="error">cat: {f}: No such file or directory</Line>)
        }
      },
    },
    {
      name: 'rm',
      run: (args, _l, sh) => sh.print(<Line tone="error">rm: {args.filter((a) => !a.startsWith('-')).join(' ') || '-'}: Read-only file system</Line>),
    },
    {
      name: 'brew',
      run: (_a, _l, sh) => sh.print(<Line>brew: the only formula on tap here is <K>coffee</K>.</Line>),
    },
  ]

  return [...listed, ...eggs]
}

/** The site's own address, without the scheme: `alejandronewport.com`. */
export function domain(site: SiteContent) {
  try { return new URL(site.settings.siteUrl).host.replace(/^www\./, '') } catch { return 'localhost' }
}

function ls(args: string[], sh: Shell) {
  commands(sh.site).find((c) => c.name === 'ls')?.run(args, 'ls', sh)
}

function cd(args: string[], sh: Shell) {
  const raw = args[0] ?? '~'
  const t = normalise(raw)
  if (t === '' || t === 'home' || t === '..') {
    if (sh.path === '/') sh.print(<Line tone="dim">You are already home.</Line>)
    else { sh.print(<Line tone="dim">Going home…</Line>); sh.go('/') }
    return
  }
  if (t === '-') { sh.print(<Line tone="dim">Going back…</Line>); window.history.back(); return }
  const page = sitePages(sh.site).find((p) => p.id === t)
  if (page) {
    if (page.href === sh.path) sh.print(<Line>You are already here. Hello!</Line>)
    else if (page.id === 'world') { sh.print(<Line tone="dim">Entering the world — WASD to drive, M for the map…</Line>); sh.leave(page.href) }
    else { sh.print(<Line tone="dim">Opening {page.label}…</Line>); sh.go(page.href) }
    return
  }
  if (t.startsWith('projects/') && openProject(t.slice('projects/'.length), sh)) return
  const guess = closest(t, sitePages(sh.site).map((p) => p.id))
  sh.print(
    <Line tone="error">cd: no such file or directory: {raw}</Line>,
    <Line tone="dim">{guess ? <>Did you mean <K>cd {guess}</K>?</> : <>Type <K>ls</K> for the pages.</>}</Line>,
  )
}

/* ---- whole-line eggs: matched before the first word is looked up ---- */

interface LineEgg { id: EggId; test: RegExp; run: (line: string, sh: Shell) => void }

const LINE_EGGS: LineEgg[] = [
  {
    id: 'sandwich', test: /^sudo make me a sandwich\b/,
    run: (_l, sh) => sh.print(<Line>Okay.</Line>, <Art>{SANDWICH}</Art>),
  },
  {
    id: 'sandwich', test: /^make me a sandwich\b/,
    run: (_l, sh) => sh.print(<Line>What? Make it yourself.</Line>),
  },
  {
    id: 'rm', test: /^(sudo )?rm( -{1,2}[a-z-]+)* (\/|\/\*|~|~\/|\*)$/,
    run: (line, sh) => {
      if (!/ -{1,2}[a-z-]*r/.test(line.toLowerCase())) { sh.print(<Line tone="error">rm: {line.split(' ').pop()}: is a directory</Line>); return }
      const { site } = sh
      const pages = sitePages(site).filter((p) => p.id !== 'home')
      sh.stream([
        ...pages.map((p, i): Step => ({ node: <Line tone="dim">removed &apos;~/{p.id}&apos;</Line>, wait: i ? 200 : 120 })),
        { node: <Line tone="dim">removed {site.projects.length} projects, {site.techNodes.length} technologies and a headline</Line>, wait: 260 },
        { node: <Line tone="error">zsh: segmentation fault — the portfolio is gone.</Line>, wait: 420, effect: sh.shake },
        { node: <Line tone="dim">…</Line>, wait: 1000 },
        { node: <Line>Just kidding. Nothing was deleted: all of it lives in git.</Line>, wait: 1000 },
        { node: <Line tone="dim">Restored {site.projects.length} projects. The headline survived unharmed.</Line>, wait: 450 },
      ])
    },
  },
  {
    id: 'coffee', test: /^((brew|make)( install)? )?coffee$/,
    run: (_l, sh) => sh.stream([
      { node: <Line><Em tone="signal">==&gt;</Em> Fetching coffee</Line>, wait: 80 },
      { node: <Line><Em tone="signal">==&gt;</Em> Grinding the beans</Line>, wait: 450 },
      { node: <Line><Em tone="signal">==&gt;</Em> Pouring</Line>, wait: 550 },
      { node: <Art>{COFFEE}</Art>, wait: 500 },
      { node: <Line tone="dim">One coffee for the visitor. Coffee chats are welcome{mailLink(sh.site) ? <> — {askByMail(sh.site)}</> : null}.</Line>, wait: 150 },
    ]),
  },
  {
    id: 'tea', test: /^((brew|make)( install)? )?tea$/,
    run: (_l, sh) => sh.print(<Line tone="error">HTTP 418: I’m a teapot.</Line>, <Line tone="dim">Short and stout. Try <K>coffee</K>.</Line>),
  },
  {
    id: 'hello', test: /^(hello|hi|hey|hiya|howdy|hola|yo)( there| world)?[!. ]*$/,
    run: (line, sh) => {
      const { profile } = sh.site
      const hola = /^hola/i.test(line)
      sh.print(
        <Line>{hola ? <>¡Hola! Spanish works too — I am from {profile.origin}.</> : <>Hello, {sh.user}! I am {firstName(sh.site)} — well, a small terminal version of him.</>}</Line>,
        <Line tone="dim">To reach the real one: <K>contact</K>.</Line>,
      )
    },
  },
  {
    id: '42', test: /^42$/,
    run: (_l, sh) => {
      const { question, answer } = sh.site.profile.closing
      sh.print(<Line>42 is the answer. The question is still the same one:</Line>, <Line tone="accent">{question} {answer}</Line>)
    },
  },
  {
    id: 'editors', test: /^:(q|q!|wq|wq!|x)$/,
    run: (_l, sh) => sh.print(<Line>You are not in vim. But that reflex is impressive.</Line>),
  },
  {
    id: 'hire', test: /^hire( me| him| alejandro)?[!. ]*$/,
    run: (_l, sh) => {
      const mail = mailLink(sh.site)
      const linkedin = sh.site.contact.find((c) => c.id === 'linkedin')
      sh.print(
        <Line tone="signal">Excellent decision.</Line>,
        <Line>The quickest way is {mail ? <K>{commandName(mail.id)}</K> : <K>contact</K>}{linkedin ? <> — or <K>{commandName(linkedin.id)}</K></> : null}.</Line>,
      )
    },
  },
  {
    id: 'manners', test: /^(thanks|thank you|thx|ty|cheers|please)[!. ]*$/,
    run: (line, sh) => sh.print(<Line>{/^please/i.test(line) ? <>Since you asked nicely: <K>help</K>.</> : 'You are welcome. Thanks for reading all the way to the end.'}</Line>),
  },
  {
    id: 'cowsay', test: /^fortune ?\| ?cowsay$/,
    run: (_l, sh) => sh.print(<Art>{cowsay(FORTUNES[Math.floor(Math.random() * FORTUNES.length)])}</Art>),
  },
  {
    id: 'sudo', test: /^sudo( |$)/,
    run: (_l, sh) => sh.print(<Line tone="error">{sh.user} is not in the sudoers file. This incident will be reported.</Line>, <Line tone="dim">(To nobody. Nice try, though.)</Line>),
  },
]

/* ---- the registry ------------------------------------------------------- */

const cache = new WeakMap<SiteContent, Command[]>()

function commands(site: SiteContent): Command[] {
  let list = cache.get(site)
  if (!list) { list = buildCommands(site); cache.set(site, list) }
  return list
}

function lookup(site: SiteContent, name: string) {
  return commands(site).find((c) => c.name === name || c.aliases?.includes(name))
}

/** Runs one line the visitor typed. */
export function execute(line: string, sh: Shell) {
  const text = line.trim()
  if (!text) return
  const lower = text.toLowerCase().replace(/\s+/g, ' ')
  for (const egg of LINE_EGGS) {
    if (!egg.test.test(lower)) continue
    sh.egg(egg.id)
    egg.run(text, sh)
    return
  }
  const [first, ...args] = tokenize(text)
  const cmd = lookup(sh.site, first.toLowerCase())
  if (cmd) {
    if (cmd.egg) sh.egg(cmd.egg)
    cmd.run(args, text, sh)
    return
  }
  const guess = closest(first, commands(sh.site).filter((c) => c.summary).map((c) => c.name))
  sh.print(
    <Line tone="error">zsh: command not found: {first}</Line>,
    <Line tone="dim">{guess ? <>Did you mean <K>{guess}</K>? </> : null}Type <K>help</K> to see what I can do.</Line>,
  )
}

/* ---- Tab ------------------------------------------------------------------ */

function commonPrefix(words: string[]) {
  let p = words[0] ?? ''
  for (const w of words) while (!w.startsWith(p)) p = p.slice(0, -1)
  return p
}

/** What Tab does to `value`: a completed line, or the options to choose between (none: nothing to offer). */
export function complete(value: string, site: SiteContent): { value?: string; options?: string[] } {
  const settle = (typed: string, hits: string[], build: (s: string) => string, suffix = ' ') => {
    if (!hits.length) return {}
    if (hits.length === 1) return { value: build(hits[0]) + suffix }
    const common = commonPrefix(hits)
    return common.length > typed.length ? { value: build(common) } : { options: hits }
  }
  const name = /^(\s*)(\S*)$/.exec(value)
  if (name) {
    const typed = name[2].toLowerCase()
    const hits = commands(site).filter((c) => c.summary && c.name.startsWith(typed)).map((c) => c.name)
    return settle(typed, hits, (h) => name[1] + h)
  }
  const arg = /^(\s*)(\S+)(\s+)(\S*)$/.exec(value)
  if (arg) {
    const cmd = lookup(site, arg[2].toLowerCase())
    if (!cmd?.args) return {}
    const typed = arg[4].toLowerCase()
    const hits = cmd.args(site).filter((a) => a.startsWith(typed))
    return settle(typed, hits, (h) => `${arg[1]}${arg[2]}${arg[3]}${h}`, '')
  }
  return {}
}

export { Columns as CompletionList }
