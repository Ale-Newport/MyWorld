import { Fragment, type ReactNode } from 'react'
import { isSafeHref, isSafeSrc } from './safe.ts'

/* ============================================================
   MARKDOWN, AS REACT ELEMENTS — NEVER AS HTML

   A blog post's body is Markdown typed in the admin. It becomes
   React elements here, not an HTML string, so what is stored can
   never add markup to a page: a tag written in a post is shown as
   the text it is (React escapes it), a link is kept only when its
   address passes the same check as every other stored link
   (cms/safe.ts: http(s), mailto, tel or a path on this site), an
   image only when it is an uploaded file, a site path or https.
   Whatever fails is shown as its words, without the link.

   It reads the Markdown people write, not all of CommonMark:
   headings, paragraphs, **bold**, *italic*, `code`, [links](…),
   ![images](…), lists (nested), > quotes, ``` fenced code, ---
   rules. A single line break inside a paragraph is kept, as it
   is in the admin's text box; a blank line starts a new one.

   A post can be long and is typed by hand, so nothing here may
   take more than linear time on any input: brackets are paired in
   one pass, a run of * or _ looks at a bounded number of possible
   closers, and nesting has a floor.
   ============================================================ */

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string | null; text: string }
  | { type: 'quote'; blocks: MarkdownBlock[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownBlock[][] }
  | { type: 'rule' }

export interface MarkdownOptions {
  /** The highest heading the body may hold. A post's title is its page's h1, so by default `#` and `##` are
      both h2 (people write either for a section), `###` an h3 and `####` an h4. */
  firstHeading?: 1 | 2 | 3
}

/** Quotes and lists inside quotes and lists stop nesting here; deeper lines are read as text. */
const MAX_BLOCK_DEPTH = 6
/** Emphasis inside links inside emphasis… stops here; deeper text is shown as typed. */
const MAX_INLINE_DEPTH = 8
/** How many possible closers a run of * or _ looks at before it is read as literal characters. */
const MAX_CLOSERS = 32

/* ---- blocks --------------------------------------------------- */

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t](.*))?$/
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?(.*)$/
const BULLET = /^( {0,3})([-*+])(?:([ \t]+)(.*))?$/
const ORDERED = /^( {0,3})(\d{1,9})[.)](?:([ \t]+)(.*))?$/
const LANG = /^[\w+#.-]{1,24}$/

const isBlank = (line: string) => line.trim() === ''
const indentOf = (line: string) => line.length - line.trimStart().length

interface Marker { ordered: boolean; indent: number; width: number; content: string; start: number }

function matchMarker(line: string): Marker | null {
  const b = BULLET.exec(line)
  if (b) return { ordered: false, indent: b[1].length, width: b[1].length + 1 + Math.min(b[3]?.length ?? 1, 4), content: b[4] ?? '', start: 1 }
  const o = ORDERED.exec(line)
  if (o) return { ordered: true, indent: o[1].length, width: o[1].length + o[2].length + 1 + Math.min(o[3]?.length ?? 1, 4), content: o[4] ?? '', start: Number(o[2]) }
  return null
}

function matchFence(line: string) {
  const m = FENCE.exec(line)
  // ```a `b` c``` on one line is inline code, not a fence.
  if (!m || (m[2][0] === '`' && m[3].includes('`'))) return null
  const lang = m[3].trim().split(/\s+/)[0]
  return { indent: m[1].length, char: m[2][0], length: m[2].length, lang: LANG.test(lang) ? lang : null }
}

/** A heading's words, without the optional closing #s (`## Title ##`). */
function headingText(rest: string): string {
  let text = rest.trim()
  let j = text.length
  while (j > 0 && text[j - 1] === '#') j--
  if (j < text.length && (j === 0 || text[j - 1] === ' ' || text[j - 1] === '\t')) text = text.slice(0, j).trimEnd()
  return text
}

/** Lines that end a paragraph without a blank line before them. An ordered list does so only from 1, so "2026. A year" stays a sentence. */
function interrupts(line: string): boolean {
  if (matchFence(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true
  const m = matchMarker(line)
  return !!m && m.content.trim() !== '' && (!m.ordered || m.start === 1)
}

function parseList(lines: string[], from: number, first: Marker, depth: number): [MarkdownBlock, number] {
  const items: MarkdownBlock[][] = []
  const base = first.indent
  let i = from
  while (i < lines.length) {
    const m = matchMarker(lines[i])
    if (!m || m.ordered !== first.ordered || m.indent >= base + 2) break
    const content = [m.content]
    i++
    while (i < lines.length) {
      const line = lines[i]
      if (isBlank(line)) {
        // A blank line belongs to the item only when indented content follows it.
        let j = i
        while (j < lines.length && isBlank(lines[j])) j++
        if (j < lines.length && indentOf(lines[j]) >= base + 2) { for (; i < j; i++) content.push(''); continue }
        break
      }
      const indent = indentOf(line)
      if (indent >= base + 2) { content.push(line.slice(Math.min(indent, m.width))); i++; continue }
      if (matchMarker(line) || interrupts(line)) break
      // A line that simply carries on the item's sentence.
      if (!isBlank(content[content.length - 1])) { content.push(line.trim()); i++; continue }
      break
    }
    items.push(parseBlocks(content, depth + 1))
    let j = i
    while (j < lines.length && isBlank(lines[j])) j++
    const next = j < lines.length ? matchMarker(lines[j]) : null
    if (!next || next.ordered !== first.ordered || next.indent >= base + 2) break
    i = j
  }
  return [{ type: 'list', ordered: first.ordered, start: first.start, items }, i]
}

function parseBlocks(lines: string[], depth: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }

    const fence = matchFence(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i])
        if (close && close[1][0] === fence.char && close[1].length >= fence.length) break
        body.push(lines[i].slice(Math.min(fence.indent, indentOf(lines[i]))))
        i++
      }
      i++ // the closing fence; an unclosed one runs to the end of the post
      blocks.push({ type: 'code', lang: fence.lang, text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: Math.min(4, heading[1].length) as 1 | 2 | 3 | 4, text: headingText(heading[2] ?? '') })
      i++
      continue
    }

    if (RULE.test(line)) { blocks.push({ type: 'rule' }); i++; continue }

    if (depth < MAX_BLOCK_DEPTH && QUOTE.test(line)) {
      const inner: string[] = []
      while (i < lines.length) {
        const q = QUOTE.exec(lines[i])
        if (q) { inner.push(q[1]); i++; continue }
        // "Lazy" lines: the quote's paragraph goes on until a blank line or another block.
        if (!isBlank(lines[i]) && !isBlank(inner[inner.length - 1]) && !interrupts(lines[i])) { inner.push(lines[i]); i++; continue }
        break
      }
      blocks.push({ type: 'quote', blocks: parseBlocks(inner, depth + 1) })
      continue
    }

    const marker = depth < MAX_BLOCK_DEPTH ? matchMarker(line) : null
    if (marker) {
      const [list, next] = parseList(lines, i, marker, depth)
      blocks.push(list)
      i = next
      continue
    }

    const text = [line.trim()]
    i++
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines[i])) { text.push(lines[i].trim()); i++ }
    blocks.push({ type: 'paragraph', text: text.join('\n') })
  }
  return blocks
}

/** The post's structure, before any inline formatting is read. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = String(source ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/^\t+/, (t) => '    '.repeat(t.length)))
  return parseBlocks(lines, 0)
}

/* ---- inline ----------------------------------------------------- */

const PUNCT = /[!-/:-@[-`{-~]/
const WORD = /[\p{L}\p{N}]/u
const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)

function runOf(text: string, at: number, char: string) {
  let n = 0
  while (text[at + n] === char) n++
  return n
}

/** Every [ paired with its ], in one pass (escaped brackets do not count). */
function pairBrackets(text: string): Map<number, number> {
  const pairs = new Map<number, number>()
  const open: number[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') { i++; continue }
    if (c === '[') open.push(i)
    else if (c === ']' && open.length) pairs.set(open.pop()!, i)
  }
  return pairs
}

/** `(url "title")` right after a link's text: where it points, its title, and where it ends. */
function destination(text: string, at: number): { url: string; title?: string; end: number } | null {
  if (text[at] !== '(') return null
  let i = at + 1
  while (text[i] === ' ' || text[i] === '\t') i++
  let url = ''
  if (text[i] === '<') {
    const close = text.indexOf('>', i)
    if (close < 0 || close - i > 2000 || text.slice(i, close).includes('\n')) return null
    url = text.slice(i + 1, close)
    i = close + 1
  } else {
    let parens = 0
    const startAt = i
    while (i < text.length && i - startAt <= 2000) {
      const c = text[i]
      if (c === '\\' && PUNCT.test(text[i + 1] ?? '')) { url += text[i + 1]; i += 2; continue }
      if (/\s/.test(c)) break
      if (c === '(' && ++parens > 32) return null
      if (c === ')') { if (parens === 0) break; parens-- }
      url += c
      i++
    }
  }
  while (text[i] === ' ' || text[i] === '\t') i++
  let title: string | undefined
  const q = text[i]
  if (q === '"' || q === "'") {
    const close = text.indexOf(q, i + 1)
    if (close < 0 || close - i > 400) return null
    title = text.slice(i + 1, close)
    i = close + 1
    while (text[i] === ' ' || text[i] === '\t') i++
  }
  if (text[i] !== ')') return null
  return { url: url.trim(), title, end: i + 1 }
}

/** http(s) links leave the site: a new tab, and no handle on this one. */
const outbound = (href: string) => (/^https?:\/\//i.test(href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})

/** Where the run of `char` that opens at `at` (length `run`) closes, or -1. */
function closer(text: string, at: number, char: string, run: number): number {
  const delim = char.repeat(run)
  let from = at + run
  for (let tries = 0; tries < MAX_CLOSERS; tries++) {
    const j = text.indexOf(delim, from)
    if (j < 0) return -1
    const length = runOf(text, j, char)
    const escaped = text[j - 1] === '\\'
    const leftOk = !isSpace(text[j - 1])
    const rightOk = char !== '_' || !WORD.test(text[j + length] ?? '')
    if (length === run && !escaped && leftOk && rightOk) return j
    from = j + length
  }
  return -1
}

interface InlineContext { links: boolean; depth: number }

function inline(text: string, key: string, ctx: InlineContext): ReactNode[] {
  if (ctx.depth > MAX_INLINE_DEPTH) return [text]
  const out: ReactNode[] = []
  const pairs = pairBrackets(text)
  let buffer = ''
  let n = 0
  const k = () => `${key}.${n++}`
  const flush = () => { if (buffer) { out.push(buffer); buffer = '' } }
  const deeper = (t: string, links = ctx.links) => inline(t, k(), { links, depth: ctx.depth + 1 })

  let i = 0
  while (i < text.length) {
    const c = text[i]

    if (c === '\\') {
      const next = text[i + 1]
      if (next === '\n') { flush(); out.push(<br key={k()} />); i += 2; continue }
      if (next !== undefined && PUNCT.test(next)) { buffer += next; i += 2; continue }
      buffer += c
      i++
      continue
    }

    if (c === '\n') { flush(); out.push(<br key={k()} />); i++; continue }

    if (c === '`') {
      const run = runOf(text, i, '`')
      // Closed by a run of exactly as many backticks; unmatched, the run is literal.
      let close = text.indexOf('`'.repeat(run), i + run)
      for (let tries = 0; close >= 0 && runOf(text, close, '`') !== run; tries++) {
        close = tries < MAX_CLOSERS ? text.indexOf('`'.repeat(run), close + runOf(text, close, '`')) : -1
      }
      if (close >= 0) {
        flush()
        let code = text.slice(i + run, close).replace(/\n/g, ' ')
        if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1)
        out.push(<code key={k()}>{code}</code>)
        i = close + run
        continue
      }
      buffer += '`'.repeat(run)
      i += run
      continue
    }

    if (c === '!' && text[i + 1] === '[' && pairs.has(i + 1)) {
      const end = pairs.get(i + 1)!
      const dest = destination(text, end + 1)
      if (dest) {
        flush()
        const alt = markdownInlineToPlain(text.slice(i + 2, end))
        if (dest.url && isSafeSrc(dest.url)) out.push(<img key={k()} src={dest.url} alt={alt} title={dest.title} loading="lazy" decoding="async" />)
        else buffer += alt
        i = dest.end
        continue
      }
    }

    if (c === '[' && pairs.has(i)) {
      const end = pairs.get(i)!
      const dest = destination(text, end + 1)
      if (dest) {
        flush()
        // A link's words may be formatted, but never hold another link.
        const words = deeper(text.slice(i + 1, end), false)
        if (ctx.links && dest.url && isSafeHref(dest.url)) out.push(<a key={k()} href={dest.url} title={dest.title} data-cursor="link" {...outbound(dest.url)}>{words}</a>)
        else out.push(<Fragment key={k()}>{words}</Fragment>)
        i = dest.end
        continue
      }
    }

    if (c === '<' && ctx.links) {
      const auto = /^<((?:https?|mailto):[^\s<>]{1,2000})>/i.exec(text.slice(i, i + 2010))
      if (auto && isSafeHref(auto[1])) {
        flush()
        out.push(<a key={k()} href={auto[1]} data-cursor="link" {...outbound(auto[1])}>{auto[1].replace(/^mailto:/i, '')}</a>)
        i += auto[0].length
        continue
      }
    }

    if (c === '*' || c === '_') {
      const run = runOf(text, i, c)
      const opens = run <= 3 && !isSpace(text[i + run]) && (c === '*' || !WORD.test(text[i - 1] ?? ''))
      const end = opens ? closer(text, i, c, run) : -1
      if (end > i + run) {
        flush()
        const inner = deeper(text.slice(i + run, end))
        const key2 = k()
        out.push(run === 1 ? <em key={key2}>{inner}</em> : run === 2 ? <strong key={key2}>{inner}</strong> : <strong key={key2}><em>{inner}</em></strong>)
        i = end + run
        continue
      }
      buffer += c.repeat(run)
      i += run
      continue
    }

    buffer += c
    i++
  }
  flush()
  return out
}

/* ---- rendering ---------------------------------------------------- */

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

interface RenderContext { first: number; ids: Map<string, number> }

/** A paragraph that is one image and nothing else is a figure, its title the caption. */
const LONE_IMAGE = /^!\[[^\]\n]*\]\([^\n]*\)$/

function renderBlocks(blocks: MarkdownBlock[], key: string, ctx: RenderContext): ReactNode[] {
  return blocks.map((b, i) => renderBlock(b, `${key}.${i}`, ctx))
}

function renderBlock(block: MarkdownBlock, key: string, ctx: RenderContext): ReactNode {
  switch (block.type) {
    case 'heading': {
      if (!block.text) return null
      const Tag = `h${Math.max(ctx.first, block.level)}` as 'h2'
      const base = slug(markdownInlineToPlain(block.text)) || 'section'
      const seen = ctx.ids.get(base) ?? 0
      ctx.ids.set(base, seen + 1)
      return <Tag key={key} id={seen ? `${base}-${seen + 1}` : base}>{inline(block.text, key, { links: true, depth: 0 })}</Tag>
    }
    case 'paragraph': {
      if (LONE_IMAGE.test(block.text)) {
        const end = block.text.indexOf('](')
        const dest = destination(block.text, end + 1)
        if (dest && dest.end === block.text.length && dest.url && isSafeSrc(dest.url)) {
          return (
            <figure key={key}>
              <img src={dest.url} alt={markdownInlineToPlain(block.text.slice(2, end))} loading="lazy" decoding="async" />
              {dest.title && <figcaption>{dest.title}</figcaption>}
            </figure>
          )
        }
      }
      return <p key={key}>{inline(block.text, key, { links: true, depth: 0 })}</p>
    }
    case 'code':
      return <pre key={key} data-lang={block.lang ?? undefined}><code className={block.lang ? `language-${block.lang}` : undefined}>{block.text}</code></pre>
    case 'quote':
      return <blockquote key={key}>{renderBlocks(block.blocks, key, ctx)}</blockquote>
    case 'list': {
      const items = block.items.map((item, i) => {
        // A one-paragraph item (and one followed only by a nested list) is set inline, as a tight list.
        const tight = item[0]?.type === 'paragraph' && item.slice(1).every((b) => b.type !== 'paragraph')
        const k = `${key}.${i}`
        return (
          <li key={k}>
            {tight ? <>{inline((item[0] as { text: string }).text, k, { links: true, depth: 0 })}{renderBlocks(item.slice(1), k, ctx)}</> : renderBlocks(item, k, ctx)}
          </li>
        )
      })
      return block.ordered ? <ol key={key} start={block.start !== 1 ? block.start : undefined}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'rule':
      return <hr key={key} />
  }
}

/** The post's body as React elements: safe to put anywhere, styled by whoever places it. */
export function renderMarkdown(source: string, options: MarkdownOptions = {}): ReactNode {
  const ctx: RenderContext = { first: options.firstHeading ?? 2, ids: new Map() }
  return renderBlocks(parseMarkdown(source), 'md', ctx)
}

/* ---- plain text ----------------------------------------------------- */

/** One line of Markdown without its marks: the words a reader sees. Linear, like the renderer. */
export function markdownInlineToPlain(text: string): string {
  let out = ''
  let unclosed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\\' && PUNCT.test(text[i + 1] ?? '')) { out += text[++i]; continue }
    if (c === '*' || c === '`') continue
    if (c === '_' && !(WORD.test(text[i - 1] ?? '') && WORD.test(text[i + 1] ?? ''))) continue
    if (c === '!' && text[i + 1] === '[') continue
    if (c === '[') continue
    if (c === ']') {
      if (text[i + 1] === '(' && !unclosed) {
        const close = text.indexOf(')', i)
        if (close > 0) { i = close; continue }
        unclosed = true
      }
      continue
    }
    out += c
  }
  return out
}

function plainBlocks(blocks: MarkdownBlock[]): string[] {
  return blocks.flatMap((b) => {
    switch (b.type) {
      case 'heading':
      case 'paragraph': return [markdownInlineToPlain(b.text)]
      case 'code': return [b.text]
      case 'quote': return plainBlocks(b.blocks)
      case 'list': return b.items.flatMap(plainBlocks)
      case 'rule': return []
    }
  })
}

/** The words of a post, paragraphs separated by a blank line: for reading time and descriptions. */
export function markdownToPlain(source: string): string {
  return plainBlocks(parseMarkdown(source)).filter((s) => s.trim()).join('\n\n')
}
