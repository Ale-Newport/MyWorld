import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { load } from '../setup.mjs'

/* The renderer is a .tsx file, which Node does not strip on its own: compile
   .tsx modules (and nothing else) with the TypeScript the repo already has.
   .ts imports keep going through Node's own type stripping. */
registerHooks({
  load(url, context, nextLoad) {
    if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context)
    const file = fileURLToPath(url)
    const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    })
    return { format: 'module', source: outputText, shortCircuit: true }
  },
})

const { renderMarkdown, markdownToPlain, parseMarkdown } = await load('src/cms/markdown.tsx')
const blog = await load('src/cms/blog.ts')
const server = await import('react-dom/server')
const React = await import('react')
const renderToStaticMarkup = server.renderToStaticMarkup ?? server.default.renderToStaticMarkup
const createElement = React.createElement ?? React.default.createElement
const Fragment = React.Fragment ?? React.default.Fragment

/* React reports duplicate or missing keys (and anything else it dislikes) on console.error: any of it fails the test. */
const html = (md, options) => {
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    const out = renderToStaticMarkup(createElement(Fragment, null, renderMarkdown(md, options)))
    assert.deepEqual(errors, [], 'React warned while rendering')
    return out
  } finally {
    console.error = original
  }
}

test('headings: never above the post title (# and ## are h2), up to ####, with ids for anchors', () => {
  assert.equal(html('# One\n## Two\n### Three\n#### Four\n##### Five'), '<h2 id="one">One</h2><h2 id="two">Two</h2><h3 id="three">Three</h3><h4 id="four">Four</h4><h4 id="five">Five</h4>')
  assert.equal(html('# Top\n## Next', { firstHeading: 1 }), '<h1 id="top">Top</h1><h2 id="next">Next</h2>')
  assert.equal(html('## Closed ##'), '<h2 id="closed">Closed</h2>')
  assert.equal(html('# Same\n# Same'), '<h2 id="same">Same</h2><h2 id="same-2">Same</h2>')
  // Not headings: no space after the marks, or seven of them.
  assert.equal(html('#hashtag'), '<p>#hashtag</p>')
  assert.equal(html('####### seven'), '<p>####### seven</p>')
})

test('paragraphs, and line breaks kept inside one', () => {
  assert.equal(html('First line\nsecond line\n\nNew paragraph'), '<p>First line<br/>second line</p><p>New paragraph</p>')
  assert.equal(html('Ends with a backslash\\\nnext'), '<p>Ends with a backslash<br/>next</p>')
  assert.equal(html('\n\n   \n'), '')
})

test('bold, italic, both, and inline code', () => {
  assert.equal(html('**bold** and __bold__'), '<p><strong>bold</strong> and <strong>bold</strong></p>')
  assert.equal(html('*italic* and _italic_'), '<p><em>italic</em> and <em>italic</em></p>')
  assert.equal(html('***both***'), '<p><strong><em>both</em></strong></p>')
  assert.equal(html('**bold with *italic* inside**'), '<p><strong>bold with <em>italic</em> inside</strong></p>')
  assert.equal(html('use `npm test` here'), '<p>use <code>npm test</code> here</p>')
  assert.equal(html('`` a ` b ``'), '<p><code>a ` b</code></p>')
  // Markup inside code is text.
  assert.equal(html('`<b>**not bold**</b>`'), '<p><code>&lt;b&gt;**not bold**&lt;/b&gt;</code></p>')
  // What is not emphasis stays as typed.
  assert.equal(html('snake_case_name and 2 * 3 * 4'), '<p>snake_case_name and 2 * 3 * 4</p>')
  assert.equal(html('\\*not italic\\* and an *unclosed one'), '<p>*not italic* and an *unclosed one</p>')
})

test('links: kept when safe, external ones open in a new tab without a handle on the page', () => {
  assert.equal(html('[Projects](/projects)'), '<p><a href="/projects" data-cursor="link">Projects</a></p>')
  assert.equal(html('[Site](https://example.com "Title")'), '<p><a href="https://example.com" title="Title" data-cursor="link" target="_blank" rel="noopener noreferrer">Site</a></p>')
  assert.equal(html('[Mail](mailto:a@b.co)'), '<p><a href="mailto:a@b.co" data-cursor="link">Mail</a></p>')
  assert.equal(html('[**bold** link](#top)'), '<p><a href="#top" data-cursor="link"><strong>bold</strong> link</a></p>')
  assert.equal(html('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))'), '<p><a href="https://en.wikipedia.org/wiki/Foo_(bar)" data-cursor="link" target="_blank" rel="noopener noreferrer">wiki</a></p>')
  assert.equal(html('<https://example.com/a>'), '<p><a href="https://example.com/a" data-cursor="link" target="_blank" rel="noopener noreferrer">https://example.com/a</a></p>')
  // A link never holds another link.
  assert.equal(html('[a [b](/b) c](/a)'), '<p><a href="/a" data-cursor="link">a b c</a></p>')
  assert.equal(html('[not a link] (/x)'), '<p>[not a link] (/x)</p>')
})

test('links a visitor must not follow are shown as their words, never as links', () => {
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,hi', '//evil.example/x', 'vbscript:x', '']) {
    const out = html(`[click](${href})`)
    assert.equal(out, '<p>click</p>', href)
  }
  const auto = html('<javascript:alert(1)>')
  assert.ok(!auto.includes('<a'), auto)
  assert.equal(auto, '<p>&lt;javascript:alert(1)&gt;</p>')
})

test('images: uploaded, site or https files only; alone in a paragraph they are a figure', () => {
  assert.equal(html('Look: ![A cat](/media/abc/cat.png) here'), '<p>Look: <img src="/media/abc/cat.png" alt="A cat" loading="lazy" decoding="async"/> here</p>')
  assert.equal(html('![A cat](/media/abc/cat.png)'), '<figure><img src="/media/abc/cat.png" alt="A cat" loading="lazy" decoding="async"/></figure>')
  assert.equal(html('![A cat](https://example.com/cat.png "The cat")'), '<figure><img src="https://example.com/cat.png" alt="A cat" loading="lazy" decoding="async"/><figcaption>The cat</figcaption></figure>')
  assert.equal(html('[![badge](/b.svg)](https://example.com)'), '<p><a href="https://example.com" data-cursor="link" target="_blank" rel="noopener noreferrer"><img src="/b.svg" alt="badge" loading="lazy" decoding="async"/></a></p>')
  for (const src of ['http://insecure.example/a.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example/a.png']) {
    const out = html(`![alt text](${src})`)
    assert.ok(!out.includes('<img'), `${src}: ${out}`)
    assert.ok(out.includes('alt text'), out)
  }
})

test('lists: unordered, ordered (with their start), nested one level and more', () => {
  assert.equal(html('- one\n- **two**\n* three'), '<ul><li>one</li><li><strong>two</strong></li><li>three</li></ul>')
  assert.equal(html('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>')
  assert.equal(html('3. three\n4. four'), '<ol start="3"><li>three</li><li>four</li></ol>')
  assert.equal(html('- a\n  - a1\n  - a2\n- b'), '<ul><li>a<ul><li>a1</li><li>a2</li></ul></li><li>b</li></ul>')
  assert.equal(html('1. a\n   - inner\n2. b'), '<ol><li>a<ul><li>inner</li></ul></li><li>b</li></ol>')
  assert.equal(html('- a\n  carried on\n- b'), '<ul><li>a<br/>carried on</li><li>b</li></ul>')
  assert.equal(html('- a\n\n- b'), '<ul><li>a</li><li>b</li></ul>')
  assert.equal(html('- a\n\n  second paragraph\n- b'), '<ul><li><p>a</p><p>second paragraph</p></li><li>b</li></ul>')
  assert.equal(html('Text\n- item'), '<p>Text</p><ul><li>item</li></ul>')
  // An ordered list interrupts a paragraph only from 1.
  assert.equal(html('In\n2026. A year'), '<p>In<br/>2026. A year</p>')
})

test('blockquotes, fenced code, rules', () => {
  assert.equal(html('> Quoted *text*\n> second line\n\nAfter'), '<blockquote><p>Quoted <em>text</em><br/>second line</p></blockquote><p>After</p>')
  assert.equal(html('> - in a list\n>\n> > nested'), '<blockquote><ul><li>in a list</li></ul><blockquote><p>nested</p></blockquote></blockquote>')
  assert.equal(html('```js\nconst a = 1 < 2 && **b**\n\n<script>x</script>\n```'), '<pre data-lang="js"><code class="language-js">const a = 1 &lt; 2 &amp;&amp; **b**\n\n&lt;script&gt;x&lt;/script&gt;\n</code></pre>'.replace('\n</code>', '</code>'))
  assert.equal(html('~~~\nplain\n~~~'), '<pre><code>plain</code></pre>')
  assert.equal(html('```\nnever closed\n# not a heading'), '<pre><code>never closed\n# not a heading</code></pre>')
  assert.equal(html('```evil"><script>\nx\n```'), '<pre><code>x</code></pre>')
  for (const rule of ['---', '***', '___', '- - -']) assert.equal(html(`a\n\n${rule}\n\nb`), '<p>a</p><hr/><p>b</p>', rule)
})

test('raw HTML is shown as text, never rendered', () => {
  const out = html('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\nA <b>bold</b> claim and <a href="javascript:alert(1)">x</a>')
  assert.ok(!/<(script|img|b|a)[\s>]/.test(out), out)
  assert.ok(out.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), out)
  assert.ok(out.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'), out)
  assert.ok(out.includes('A &lt;b&gt;bold&lt;/b&gt; claim'), out)
})

test('the structure and the plain words agree', () => {
  const md = '# Title\n\nSome **bold** and [a link](/x) with `code`.\n\n- one\n- two\n\n> quote\n\n```\ncode block\n```\n\n---\n\n![Alt](/i.png)'
  assert.deepEqual(parseMarkdown(md).map((b) => b.type), ['heading', 'paragraph', 'list', 'quote', 'code', 'rule', 'paragraph'])
  assert.equal(markdownToPlain(md), 'Title\n\nSome bold and a link with code.\n\none\n\ntwo\n\nquote\n\ncode block\n\nAlt')
  assert.equal(markdownToPlain('snake_case stays, _emphasis_ goes, \\*escaped\\* stays'), 'snake_case stays, emphasis goes, *escaped* stays')
})

test('no input takes long: unmatched delimiters, brackets and deep nesting', () => {
  const inputs = [
    '*a '.repeat(40000),
    '**a '.repeat(30000),
    '_a '.repeat(40000),
    '`'.repeat(3) + 'a`'.repeat(30000),
    '['.repeat(60000),
    '[a]('.repeat(30000),
    '[x](/y)'.repeat(15000),
    '> '.repeat(5000) + 'deep',
    '- '.repeat(5000) + 'deep',
    '#'.repeat(3) + ' ' + ' #'.repeat(40000) + ' x',
    '```' + 'a'.repeat(100000) + '`',
    '*'.repeat(50) + 'x' + '*'.repeat(50),
  ]
  for (const md of inputs) {
    const started = performance.now()
    html(md)
    markdownToPlain(md)
    const ms = performance.now() - started
    assert.ok(ms < 1500, `${JSON.stringify(md.slice(0, 20))}… took ${Math.round(ms)} ms`)
  }
})

test('the blog helpers take a list of posts: published only (drafts too in the preview), newest first, read tolerantly', () => {
  const post = (slug, date, status = 'published', body = '') => ({ id: slug, slug, title: slug, excerpt: '', body, date, tags: [], status })
  const posts = [post('old', '2024-01-02'), post('new', '2026-11-07'), post('draft', '2026-12-01', 'draft'), post('mid', '2025-06-30')]
  assert.deepEqual(blog.listedPosts(posts).map((p) => p.slug), ['new', 'mid', 'old'])
  assert.deepEqual(blog.listedPosts(posts, { preview: true }).map((p) => p.slug), ['draft', 'new', 'mid', 'old'])
  assert.deepEqual(blog.listedPosts(undefined), [])
  assert.deepEqual(blog.listedPosts(null), [])
  assert.equal(blog.findPost(posts, 'draft'), null)
  assert.equal(blog.findPost(posts, 'draft', { preview: true }).slug, 'draft')
  assert.equal(blog.formatPostDate('2026-11-07'), '7 November 2026')
  assert.equal(blog.formatPostDate('not a date'), 'not a date')
  assert.equal(blog.readingMinutes(''), 1)
  assert.equal(blog.readingMinutes('word '.repeat(1100)), 5)
  assert.equal(blog.postSlug('  Ça marche — déjà vu!  '), 'ca-marche-deja-vu')
  assert.equal(blog.uniquePostSlug([post('hello', '2026-01-01')], 'Hello'), 'hello-2')
  const neighbours = blog.adjacentPosts(blog.listedPosts(posts), 'mid')
  assert.deepEqual([neighbours.newer?.slug, neighbours.older?.slug], ['new', 'old'])
  assert.deepEqual(blog.linkTo(neighbours.newer), { slug: 'new', title: 'new' })
  assert.equal(blog.linkTo(null), null)
  const summary = blog.summarisePost(post('long', '2026-01-01', 'published', 'word '.repeat(450)))
  assert.equal(summary.minutes, 2)
  assert.ok(!('body' in summary), 'a list never carries the bodies')
})
