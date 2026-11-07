/* ============================================================
   THE TERMINAL'S PROPS DEPARTMENT
   Plain ASCII only — the terminal's face carries every glyph of
   it on every platform, and nothing here can turn into an emoji.
   Every line was drawn or written for this site; the cow is the
   shape cowsay has drawn since the nineties, re-keyed by hand.
   ============================================================ */

export const COFFEE = String.raw`
      ( (
       ) )
    ........
    |      |]
    \      /
     '----'`.slice(1)

/* Bread, lettuce, tomato, cheese, bread. */
export const SANDWICH = String.raw`
     ______________________
    /                      \
   (________________________)
    ~~~~~~~~~~~~~~~~~~~~~~~~
    oOoOoOoOoOoOoOoOoOoOoOoO
    ========================
   (________________________)`.slice(1)

const COW = String.raw`
        \   ^__^
         \  (oo)\_______
            (__)\       )\/\
                ||----w |
                ||     ||`

/** Short and original — a programmer's fortune cookie, with the odd nudge towards the inbox. */
export const FORTUNES = [
  'The bug you are looking for is in the file you have not opened yet.',
  'Today is a good day to write the test first.',
  'Your next commit message will be better than "fix".',
  'Someone, somewhere, will read your code. Be kind to them.',
  'It works on your machine. Ship the machine.',
  'A long scroll leads to a short conversation.',
  'You will meet an interesting engineer. Check your inbox.',
  'Good things come to those who type help.',
  'Fortune favours the curious. You found this, did you not?',
  'Latency is temporary. Regret is cached.',
  'The best time to send that email was yesterday. The second best is now.',
  'Every great system started as a small one that worked.',
  'Name things well and the code will explain itself.',
]

/** Lines of at most `width` characters, broken between words (a word longer than that is cut). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (let w = word; w; ) {
      const piece = w.slice(0, width)
      w = w.slice(width)
      if (!line) line = piece
      else if (line.length + 1 + piece.length <= width) line += ` ${piece}`
      else { lines.push(line); line = piece }
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** The cow, saying `text` in a bubble at most `width` characters wide (cowsay's own border rules). */
export function cowsay(text: string, width = 28): string {
  const lines = wrap(text, width)
  const w = Math.max(...lines.map((l) => l.length))
  const pad = (l: string) => l + ' '.repeat(w - l.length)
  const body = lines.length === 1
    ? [`< ${pad(lines[0])} >`]
    : lines.map((l, i) => {
        const [a, b] = i === 0 ? ['/', '\\'] : i === lines.length - 1 ? ['\\', '/'] : ['|', '|']
        return `${a} ${pad(l)} ${b}`
      })
  return [` ${'_'.repeat(w + 2)}`, ...body, ` ${'-'.repeat(w + 2)}`].join('\n') + COW
}
