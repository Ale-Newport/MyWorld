'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { useSite } from '@/cms/context'
import { CompletionList, Line, complete, domain, execute, zshDate, type EggId, type Shell, type Step } from './commands'
import { Matrix } from './Matrix'
import styles from './Terminal.module.css'

/* ============================================================
   A TERMINAL, IN LIQUID GLASS
   A macOS Terminal window floating beside the contact details:
   frosted, rimmed in light, with the three traffic lights and
   a zsh prompt that answers a few dozen commands about the site
   (commands.tsx says which).

   On a desktop it floats at the right of the page, clear of the
   links, and can be dragged anywhere on screen by its title bar.
   On a phone (narrower than the top bar's own breakpoint, 900 px)
   it is docked in the page under the links, full width, and
   stays put. Close and minimise fold it into a dock pill that
   brings it back — minimised keeps the session, closed starts a
   new one; zoom gives it room and gives it back.

   What it is to assistive technology: a labelled region (not a
   dialog — it traps nothing), a real <input> with a label, and an
   output that is a polite live log. The block caret is drawn
   over an invisible input whose type is 16 px, so iOS never zooms
   into it; a solid blinking caret is the focus, a hollow one is
   a terminal waiting to be clicked.
   ============================================================ */

/** Where the window floats rather than docks: the top bar's own breakpoint (SiteHeader, Hud). */
const FLOATING = '(min-width: 900px)'
/** Output kept on screen; older lines scroll off for good. */
const MAX_ENTRIES = 400
/** The window never sits closer than this to the viewport's edges. */
const EDGE = 8
const LOGIN_KEY = 'contact-terminal:last-login'
/** Forty cells: long enough that a whole-pixel width still gives the cell's width to a fortieth of a pixel. */
const PROBE = '0'.repeat(40)
const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a']

interface Entry { id: number; node: ReactNode }
interface Offset { x: number; y: number }

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const floating = () => window.matchMedia(FLOATING).matches

/** The offset that keeps `win` on screen (and under the site's top bar), nearest to the one asked for. */
function clampOffset(win: HTMLElement, current: Offset, want: Offset): Offset {
  const r = win.getBoundingClientRect()
  const left = r.left - current.x
  const top = r.top - current.y
  const bar = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0
  const minX = EDGE - left
  const maxX = Math.max(minX, window.innerWidth - EDGE - r.width - left)
  const minY = Math.max(EDGE, bar - 12) - top
  const maxY = Math.max(minY, window.innerHeight - EDGE - r.height - top)
  return { x: Math.min(maxX, Math.max(minX, want.x)), y: Math.min(maxY, Math.max(minY, want.y)) }
}

function Prompt({ user, host }: { user: string; host: string }) {
  return (
    <span className={styles.prompt} aria-hidden="true">
      <span className={styles.who}>{user}<span className={styles.at}>@{host}</span></span>{' '}
      <span className={styles.cwd}>~</span> <span className={styles.sigil}>%</span>{' '}
    </span>
  )
}

/** A line the visitor typed, as it stays in the scrollback. */
function Echo({ user, host, text }: { user: string; host: string; text: string }) {
  return <div className={styles.line}><Prompt user={user} host={host} />{text}</div>
}

const GLYPHS = {
  close: 'M3.2 3.2l5.6 5.6M8.8 3.2l-5.6 5.6',
  minimise: 'M2.6 6h6.8',
  zoom: 'M6 2.6v6.8M2.6 6h6.8',
} as const

function Light({ kind, label, onClick, pressed }: { kind: keyof typeof GLYPHS; label: string; onClick: () => void; pressed?: boolean }) {
  return (
    <button type="button" className={styles.light} data-light={kind} aria-label={label} aria-pressed={pressed} onClick={onClick} data-cursor="link">
      <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false"><path d={GLYPHS[kind]} /></svg>
    </button>
  )
}

export function Terminal() {
  const site = useSite()
  const router = useRouter()
  const pathname = usePathname()
  const inputId = useId()
  const hintId = useId()

  const user = 'visitor'
  const host = domain(site).split('.')[0] || 'localhost'
  const owner = (site.profile.name.split(/\s+/)[0] ?? 'zsh').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

  const [mode, setMode] = useState<'open' | 'minimised'>('open')
  const [reopened, setReopened] = useState(false)
  const [zoomed, setZoomed] = useState(false)
  const [entries, setEntries] = useState<Entry[]>([])
  const [value, setValue] = useState('')
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [busy, setBusy] = useState(false)
  const [raining, setRaining] = useState(false)
  const [grid, setGrid] = useState({ cols: 80, rows: 24 })
  /** Closed rather than minimised: opening again starts a new session. */
  const [ended, setEnded] = useState(false)

  const windowRef = useRef<HTMLElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const screenRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const measureRef = useRef<HTMLSpanElement>(null)
  const dockRef = useRef<HTMLButtonElement>(null)
  const nextId = useRef(0)
  const history = useRef<string[]>([])
  const recall = useRef<{ index: number; draft: string } | null>(null)
  const timers = useRef<number[]>([])
  const eggs = useRef(new Set<EggId>())
  const offset = useRef<Offset>({ x: 0, y: 0 })
  const unzoomed = useRef<Offset>({ x: 0, y: 0 })
  const drag = useRef<{ id: number; x: number; y: number; from: Offset; moved: boolean } | null>(null)
  const focusNext = useRef<'input' | 'dock' | null>(null)

  /* ---- output ---- */

  const print = useCallback((...nodes: ReactNode[]) => {
    const added = nodes.map((node) => ({ id: ++nextId.current, node }))
    setEntries((list) => [...list, ...added].slice(-MAX_ENTRIES))
  }, [])

  /** "Last login" is the visitor's own previous visit, kept in this browser; the tty counts their sessions. */
  const banner = useCallback(() => {
    let last: Date | null = null
    let count = 1
    try {
      const saved = JSON.parse(localStorage.getItem(LOGIN_KEY) ?? 'null') as { at?: string; count?: number } | null
      if (saved?.at) last = new Date(saved.at)
      if (saved?.count) count = saved.count + 1
      localStorage.setItem(LOGIN_KEY, JSON.stringify({ at: new Date().toISOString(), count }))
    } catch { /* private mode, blocked storage: a first visit, every time */ }
    const when = last && !Number.isNaN(last.getTime()) ? last : new Date()
    print(
      <Line tone="dim">Last login: {zshDate(when, { zone: false })} on ttys{String(count % 1000).padStart(3, '0')}</Line>,
      <Line>Type <span className={styles.kbd}>help</span> to see what I can do.</Line>,
    )
  }, [print])

  // The first session opens with the page (a frame later: the date is the browser's, never the server's).
  useEffect(() => {
    const raf = requestAnimationFrame(banner)
    return () => cancelAnimationFrame(raf)
  }, [banner])

  const cancelJob = useCallback(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setBusy(false)
  }, [])

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  /** Steps printed one after another while the prompt waits. */
  const stream = useCallback((steps: Step[]) => {
    setBusy(true)
    let at = 0
    for (const s of steps) {
      at += s.wait
      timers.current.push(window.setTimeout(() => { print(s.node); s.effect?.() }, at))
    }
    timers.current.push(window.setTimeout(() => { timers.current = []; setBusy(false) }, at + 30))
  }, [print])

  /** Leaves the page a beat after saying so; Ctrl+C in that beat stays. */
  const later = useCallback((go: () => void) => {
    setBusy(true)
    timers.current.push(window.setTimeout(() => { timers.current = []; setBusy(false); go() }, 320))
  }, [])

  /* ---- the window ---- */

  /** Moves the window — and the light behind it, which goes wherever the glass goes. */
  const applyOffset = useCallback((o: Offset) => {
    offset.current = o
    const translate = o.x || o.y ? `${o.x}px ${o.y}px` : ''
    if (windowRef.current) windowRef.current.style.translate = translate
    if (glowRef.current) glowRef.current.style.translate = translate
  }, [])

  // A window that comes back (or a screen that changes size) is put where it was, if that is still on screen.
  useLayoutEffect(() => {
    const settle = () => {
      const win = windowRef.current
      if (!win) return
      if (!floating()) { applyOffset({ x: 0, y: 0 }); return }
      applyOffset(offset.current)
      applyOffset(clampOffset(win, offset.current, offset.current))
    }
    settle()
    window.addEventListener('resize', settle)
    return () => window.removeEventListener('resize', settle)
  }, [mode, zoomed, applyOffset])

  const focusInput = useCallback(() => inputRef.current?.focus({ preventScroll: true }), [])

  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    if (next === 'dock') dockRef.current?.focus({ preventScroll: true })
    if (next === 'input') focusInput()
  }, [mode, focusInput])

  const collapse = useCallback((how: 'minimise' | 'close') => {
    const win = windowRef.current
    const hadFocus = !!win?.contains(document.activeElement)
    const done = () => {
      if (how === 'close') { setEnded(true); cancelJob(); setRaining(false) }
      focusNext.current = hadFocus ? 'dock' : null
      setMode('minimised')
    }
    if (!win || reducedMotion()) { done(); return }
    // Towards the dock, where the pill will be: the corner on a desktop, the same place on a phone.
    const r = win.getBoundingClientRect()
    const far = floating()
    const dx = far ? window.innerWidth - 96 - (r.left + r.width / 2) : 0
    const dy = far ? window.innerHeight - 44 - (r.top + r.height / 2) : 0
    win.animate(
      [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px, ${dy}px) scale(${far ? 0.14 : 0.94})`, opacity: 0 }],
      { duration: far ? 380 : 220, easing: 'cubic-bezier(0.65, 0, 0.35, 1)', fill: 'forwards' },
    ).finished.then(done, done)
  }, [cancelJob])

  const reopen = useCallback(() => {
    if (ended) {
      setEnded(false)
      setEntries([])
      banner()
    }
    focusNext.current = 'input'
    setReopened(true)
    setMode('open')
  }, [ended, banner])

  const toggleZoom = useCallback(() => {
    const win = windowRef.current
    if (!win) return
    const before = win.getBoundingClientRect()
    const next = !zoomed
    if (next) { unzoomed.current = offset.current; applyOffset({ x: 0, y: 0 }) }
    else applyOffset(unzoomed.current)
    flushSync(() => setZoomed(next))
    if (!next) applyOffset(clampOffset(win, offset.current, offset.current))
    const after = win.getBoundingClientRect()
    if (!floating()) win.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
    if (reducedMotion() || !after.width || !after.height) return
    const from = `translate(${before.left - after.left}px, ${before.top - after.top}px) scale(${before.width / after.width}, ${before.height / after.height})`
    win.animate(
      [{ transformOrigin: '0 0', transform: from }, { transformOrigin: '0 0', transform: 'none' }],
      { duration: 340, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    )
  }, [zoomed, applyOffset])

  const shake = useCallback(() => {
    if (reducedMotion()) return
    windowRef.current?.animate(
      [{ transform: 'none' }, { transform: 'translateX(-7px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(2px)' }, { transform: 'none' }],
      { duration: 420, easing: 'ease-out' },
    )
  }, [])

  /* Dragging by the title bar, with the pointer (any pointer: a tablet's finger too). */
  const onTitleDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !floating() || (e.target as Element).closest('button')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, from: offset.current, moved: false }
  }
  const onTitleMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    const win = windowRef.current
    if (!d || d.id !== e.pointerId || !win) return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 3) return
    if (!d.moved) { d.moved = true; win.setAttribute('data-dragging', '') }
    applyOffset(clampOffset(win, offset.current, { x: d.from.x + dx, y: d.from.y + dy }))
  }
  const onTitleUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    drag.current = null
    windowRef.current?.removeAttribute('data-dragging')
    // A click on the bar (not a drag) brings the window to attention, as on a Mac.
    if (!d.moved && e.type === 'pointerup') focusInput()
  }

  /* ---- the prompt ---- */

  const setLine = useCallback((text: string) => {
    setValue(text)
    setCaret(text.length)
    requestAnimationFrame(() => inputRef.current?.setSelectionRange(text.length, text.length))
  }, [])

  const echo = (text: string) => <Echo user={user} host={host} text={text} />

  const shell = (): Shell => ({
    site,
    user,
    host,
    path: pathname,
    history: history.current,
    reducedMotion: reducedMotion(),
    eggsFound: eggs.current.size,
    print,
    clear: () => setEntries([]),
    stream,
    go: (href) => later(() => router.push(href)),
    leave: (href) => later(() => window.location.assign(href)),
    open: (href) => {
      if (href.startsWith('mailto:')) window.location.href = href
      else window.open(href, '_blank', 'noopener,noreferrer')
    },
    minimise: () => collapse('minimise'),
    matrix: () => { setBusy(true); setRaining(true) },
    shake,
    egg: (id) => { eggs.current.add(id) },
  })

  const submit = () => {
    if (busy) return
    const line = value
    print(echo(line))
    setLine('')
    recall.current = null
    if (line.trim() && history.current[history.current.length - 1] !== line) history.current = [...history.current, line].slice(-200)
    execute(line, shell())
  }

  const interrupt = () => {
    if (busy || raining) { cancelJob(); setRaining(false); print(<Line>^C</Line>); return }
    print(echo(`${value}^C`))
    setLine('')
    recall.current = null
  }

  const tab = () => {
    const r = complete(value, site)
    if (r.value !== undefined) setLine(r.value)
    else if (r.options) print(echo(value), <CompletionList items={r.options} />)
  }

  const recallHistory = (dir: -1 | 1) => {
    const h = history.current
    const r = recall.current ?? (dir < 0 && h.length ? { index: h.length, draft: value } : null)
    if (!r) return
    const index = Math.min(h.length, Math.max(0, r.index + dir))
    recall.current = index === h.length ? null : { index, draft: r.draft }
    setLine(index === h.length ? r.draft : h[index])
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const key = e.key.toLowerCase()
    if (e.ctrlKey && !e.metaKey && !e.altKey) {
      if (key === 'l') { e.preventDefault(); setEntries([]); return }
      if (key === 'u') { e.preventDefault(); setLine(''); return }
      // Ctrl+C with text selected is a copy (on Windows and Linux); with none it is an interrupt.
      if (key === 'c' && e.currentTarget.selectionStart === e.currentTarget.selectionEnd) { e.preventDefault(); interrupt(); return }
    }
    if (e.metaKey && !e.ctrlKey && key === 'k') { e.preventDefault(); setEntries([]); return }
    if (e.key === 'Enter') { e.preventDefault(); submit(); return }
    // Tab completes what has been typed; on an empty line it moves on, so the keyboard is never trapped here.
    if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && value.trim()) { e.preventDefault(); tab(); return }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); recallHistory(e.key === 'ArrowUp' ? -1 : 1) }
  }

  const syncCaret = () => {
    const input = inputRef.current
    if (input) setCaret(input.selectionDirection === 'backward' ? input.selectionStart ?? 0 : input.selectionEnd ?? input.value.length)
  }

  /** A click anywhere on the screen is a click into the prompt — unless it selected some text, or was a link. */
  const onScreenClick = (e: MouseEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('a, button')) return
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && windowRef.current?.contains(selection.anchorNode)) return
    focusInput()
  }

  /* ---- the screen's size in characters, for the title ---- */
  useEffect(() => {
    const screen = screenRef.current
    const probe = measureRef.current
    if (!screen || !probe) return
    const measure = () => {
      const cs = getComputedStyle(screen)
      const width = screen.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      const height = screen.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      // Layout sizes, not the painted rect: a zoom's animation scales the window while it is being measured.
      const ch = probe.offsetWidth / PROBE.length
      const lh = parseFloat(cs.lineHeight)
      if (!ch || !lh) return
      const next = { cols: Math.max(1, Math.floor(width / ch)), rows: Math.max(1, Math.floor(height / lh)) }
      setGrid((g) => (g.cols === next.cols && g.rows === next.rows ? g : next))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(screen)
    document.fonts?.ready.then(measure, () => {})
    return () => ro.disconnect()
  }, [mode])

  // New output scrolls the screen to the prompt, as a terminal does.
  useLayoutEffect(() => {
    const screen = screenRef.current
    if (screen) screen.scrollTop = screen.scrollHeight
  }, [entries, busy, mode])

  /* The Konami code works on this page too (the journeys' hook is not mounted here), and the terminal notices. */
  useEffect(() => {
    let keys: string[] = []
    let timer = 0
    const onKey = (e: globalThis.KeyboardEvent) => {
      keys = [...keys, e.key.toLowerCase()].slice(-KONAMI.length)
      if (keys.join() !== KONAMI.join()) return
      keys = []
      eggs.current.add('konami')
      document.documentElement.setAttribute('data-konami', 'true')
      window.clearTimeout(timer)
      timer = window.setTimeout(() => document.documentElement.removeAttribute('data-konami'), 7000)
      print(<Line tone="signal">Konami code accepted. The colours flip for a few seconds.</Line>)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
      document.documentElement.removeAttribute('data-konami')
    }
  }, [print])

  const before = value.slice(0, caret)
  const under = value.slice(caret, caret + 1)
  const after = value.slice(caret + 1)

  return (
    <div className={styles.slot}>
      <div ref={glowRef} className={styles.glow} aria-hidden="true" data-off={mode !== 'open' || zoomed || undefined} />
      {mode === 'open' ? (
        <section
          ref={windowRef}
          className={styles.window}
          aria-label="Terminal"
          data-zoomed={zoomed || undefined}
          data-focused={focused || undefined}
          data-reopened={reopened || undefined}
        >
          <div
            className={styles.titlebar}
            onPointerDown={onTitleDown}
            onPointerMove={onTitleMove}
            onPointerUp={onTitleUp}
            onPointerCancel={onTitleUp}
            onDoubleClick={(e) => { if (!(e.target as Element).closest('button')) toggleZoom() }}
            data-cursor="drag"
          >
            <div className={styles.lights}>
              <Light kind="close" label="Close the terminal" onClick={() => collapse('close')} />
              <Light kind="minimise" label="Minimise the terminal" onClick={() => collapse('minimise')} />
              <Light kind="zoom" label={zoomed ? 'Restore the terminal’s size' : 'Zoom the terminal'} pressed={zoomed} onClick={toggleZoom} />
            </div>
            <p className={styles.title} aria-hidden="true">{owner} — zsh — {grid.cols}×{grid.rows}</p>
          </div>

          <div className={styles.body}>
            <div ref={screenRef} className={styles.screen} onClick={onScreenClick}>
              <div className={styles.log} role="log" aria-live="polite" aria-label="Terminal output">
                {entries.map((e) => <div key={e.id} className={styles.entry}>{e.node}</div>)}
              </div>
              <div className={styles.promptRow} data-busy={busy || undefined}>
                <Prompt user={user} host={host} />
                <span className={styles.mirror} aria-hidden="true">
                  {before}
                  <span key={`${value.length}:${caret}`} className={styles.caret}>{under || ' '}</span>
                  {after}
                </span>
                <label htmlFor={inputId} className="sr-only">Terminal command</label>
                <input
                  ref={inputRef}
                  id={inputId}
                  className={styles.input}
                  type="text"
                  value={value}
                  onChange={(e) => { setValue(e.target.value); setCaret(e.target.selectionEnd ?? e.target.value.length) }}
                  onKeyDown={onKeyDown}
                  onSelect={syncCaret}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="send"
                  aria-describedby={hintId}
                />
              </div>
              <p id={hintId} className="sr-only">Type help and press Enter for the list of commands. Tab completes a command; the up and down arrows recall earlier ones.</p>
              <span ref={measureRef} className={styles.measure} aria-hidden="true">{PROBE}</span>
            </div>
            {raining && (
              <Matrix onDone={() => { setRaining(false); setBusy(false); print(<Line tone="signal">You took the red pill. Welcome back.</Line>); focusInput() }} />
            )}
          </div>
        </section>
      ) : (
        <button ref={dockRef} type="button" className={styles.dock} onClick={reopen} aria-label="Open the terminal" data-cursor="link" data-cursor-text="OPEN">
          <span className={styles.dockIcon} aria-hidden="true">&gt;_</span>
          <span aria-hidden="true">Terminal</span>
          {!ended && <span className={styles.dockDot} aria-hidden="true" />}
        </button>
      )}
    </div>
  )
}
