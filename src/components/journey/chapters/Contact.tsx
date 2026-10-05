'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
import { widestWordEm } from '@/components/typography/capitals'
import { TagRow } from '@/components/journey/parts'
import { WorldPortal, portal } from '@/components/journey/WorldPortal'
import { useSite } from '@/cms/context'
import { E, useCms, useCmsText } from '@/cms/editable'
import { useChapterFrame } from '@/hooks/useChapterProgress'
import { useJourney } from '@/state/journey'
import { clamp, easeOutCubic, range } from '@/lib/math'
import { SectionAnimation } from '@/sections/SectionAnimation'
import type { Rect } from '@/sections/types'
import shared from './chapters.module.css'
import styles from './Contact.module.css'

/* ============================================================
   HOME · 86 – 100%  WHAT'S NEXT?
   The closing words in the middle of the stage, the section's
   animation all around them. The animation fills the stage but
   is handed the rectangles the words occupy — measured whenever
   the layout changes, with room for the words' own movement —
   and never draws inside them.

   The leaf transition into /world is NOT this animation: it is
   the garden cover (home/botanical, home/room/canopy), driven by
   <WorldPortal/> below, and works the same whichever animation
   the section shows.
   ============================================================ */

/**
 * The box of an element's glyphs (or of the element, when it has none)
 * in `stage`'s layout space. The stage's own transform (the portal's
 * drag) is offset back out. With `settled`, so are the element's own
 * transform and its reveal's: the words are measured where they come
 * to rest, and the margins added to the box are their travel.
 */
function layoutRect(el: HTMLElement, stage: HTMLElement, range: Range, settled: boolean): DOMRect | null {
  const held = el.style.transform
  if (settled) el.style.transform = 'none'
  try {
    const s = stage.getBoundingClientRect()
    const own = el.getBoundingClientRect()
    if (own.width < 1 || own.height < 1) return null
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let node = walk.nextNode(); node; node = walk.nextNode()) {
      const host = node instanceof Element ? node : node.parentElement
      // A screen reader's copy of the words (Reveal's) is laid out on one
      // unclipped line beside them but never seen: it is not their box.
      if (host?.closest('.sr-only')) continue
      if (settled && node instanceof Element) continue
      // A revealed glyph travels inside its unit's wrapper, which clips
      // it: the wrapper is where it shows, wherever the reveal has it.
      const wrap = settled ? host?.closest('[data-unit]')?.parentElement : null
      if (!(node instanceof Element) && !wrap) range.selectNodeContents(node)
      const rects = wrap ? [wrap.getBoundingClientRect()] : Array.from(node instanceof Element ? node.getClientRects() : range.getClientRects())
      for (const r of rects) {
        if (r.width < 1 || r.height < 1) continue
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
      }
    }
    if (!Number.isFinite(x0)) { x0 = own.left; y0 = own.top; x1 = own.right; y1 = own.bottom }
    return new DOMRect(x0 - s.left, y0 - s.top, x1 - x0, y1 - y0)
  } finally {
    if (settled) el.style.transform = held
  }
}

/** A length the chapter writes on its own elements (`data-room-travel`): rem, em or px. */
function lengthPx(value: string | undefined, el: HTMLElement, rem: number) {
  const m = /^(-?\d*\.?\d+)(rem|em|px)?$/.exec((value ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  return m[2] === 'rem' ? n * rem : m[2] === 'em' ? n * (parseFloat(getComputedStyle(el).fontSize) || rem) : n
}

export function Contact() {
  const { profile, contact, chapterById, projects, techNodes } = useSite()
  const answerCms = useCms('contact.answer', { kind: 'heading', label: 'Closing answer', bind: 'profile.closing.answer' })
  const tag = useCmsText('contact.tag', 'END OF JOURNEY')
  const reducedMotion = useJourney((s) => s.reducedMotion)
  const stageRef = useRef<HTMLDivElement>(null)
  const safe = useRef<Rect[]>([])
  const [safeVersion, setSafeVersion] = useState(0)

  /* The text-safe rectangles, re-measured when the stage resizes,
     the fonts arrive or the copy changes — never per frame. */
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const range = document.createRange()
    let timer = 0
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const out: Rect[] = []
      for (const el of Array.from(stage.querySelectorAll<HTMLElement>('[data-safe]'))) {
        const big = el.dataset.safe === 'headline'
        const r = layoutRect(el, stage, range, big)
        if (!r) continue
        // The headline rises and sinks as it reveals and as the portal
        // lifts the stage. Measured where it settles, its margin is that
        // travel — up, then down, as it declares it for the room — and
        // a hair; without a declaration, a generous 4.4rem either way.
        const [up, down] = (el.dataset.roomTravel ?? '').split(/\s+/)
        const hair = 0.3 * rem
        const mx = (big ? 2.2 : 1.1) * rem
        const mt = big ? (lengthPx(up, el, rem) ?? 4.4 * rem - hair) + hair : 1.1 * rem
        const mb = big ? (lengthPx(down, el, rem) ?? 4.4 * rem - hair) + hair : 1.1 * rem
        out.push({ x: r.x - mx, y: r.y - mt, w: r.width + mx * 2, h: r.height + mt + mb })
      }
      safe.current = out
      setSafeVersion((v) => v + 1)
    }
    const later = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(measure, 120)
    }
    measure()
    void document.fonts?.ready.then(later)
    const ro = new ResizeObserver(later)
    ro.observe(stage)
    return () => {
      window.clearTimeout(timer)
      ro.disconnect()
    }
  }, [profile.closing.question, profile.closing.answer, contact, tag])
  const extra = useMemo(() => ({ safe, safeVersion }), [safeVersion])
  const questionRef = useRef<HTMLParagraphElement>(null)
  const answerRef = useRef<HTMLParagraphElement>(null)
  const linksRef = useRef<HTMLUListElement>(null)

  useChapterFrame('contact', (t) => {
    if (reducedMotion) return

    /* Everything the visitor has been reading retreats ahead of the
       portal's veil, so the last chapter clears the stage itself
       rather than being painted over mid-sentence. */
    const rise = easeOutCubic(portal.pull)
    const dim = 1 - rise * 0.82
    const lift = rise * 3.2

    /* And the whole stage is held back by whatever the portal is
       currently refusing to hand over. The page is already at its
       foot, so this is the only place the resistance can be seen:
       scroll spent against the portal moves the last chapter a
       fraction of what it asked for, and lets it spring back the
       moment the pushing stops. One number, two chapters' worth of
       loops — the portal computes it, this one spends it. */
    const stage = stageRef.current
    if (stage) {
      stage.style.setProperty('--portal-dim', String(rise))
      // Tenths of a pixel. Anything finer is a longer string for a
      // difference no screen has.
      stage.style.setProperty('--portal-drag', (Math.round(portal.drag * 10) / 10).toFixed(1))
    }

    const q = questionRef.current
    if (q) {
      const a = clamp(range(t, 0.12, 0.3)) * (1 - clamp(range(t, 0.42, 0.55)))
      q.style.opacity = String(a * dim)
      q.style.transform = `translate3d(0, ${(1 - a) * 2.4 - lift}rem, 0) scale(${0.96 + a * 0.04})`
    }

    const ans = answerRef.current
    if (ans) {
      const a = clamp(range(t, 0.5, 0.66))
      ans.style.opacity = String(a * dim)
      ans.style.transform = `translate3d(0, ${(1 - a) * 2.4 - lift}rem, 0)`
    }

    const links = linksRef.current
    if (links) {
      for (let i = 0; i < links.children.length; i++) {
        const el = links.children[i] as HTMLElement
        const from = 0.66 + i * 0.045
        const a = clamp(range(t, from, from + 0.1))
        el.style.opacity = String(a * dim)
        el.style.transform = `translate3d(0, ${(1 - a) * 1.4 - lift}rem, 0)`
      }
    }
  })

  return (
    <Chapter id="contact" labelledBy="contact-title">
      <div className={`${shared.stage} ${styles.stage}`} ref={stageRef}>
        <SectionAnimation section="contact" className={styles.visual} extra={extra} />

        <E cms="contact.tag" as="div" kind="container" label="Chapter tag" className={`${shared.corner} ${shared.cornerTL} ${styles.chrome}`} data-safe="">
          <TagRow items={[chapterById['contact'].number, tag]} />
        </E>
        <E cms="contact.stats" as="div" label="Totals" className={`${shared.corner} ${shared.cornerTR} ${styles.chrome}`} data-safe="">
          {projects.length} PROJECTS
          <br />
          {techNodes.length} TECHNOLOGIES
        </E>

        {/* The closing words are set as large as their longest word allows
            (capitals.ts), so a long answer wraps between words, never inside one. */}
        <div className={styles.center} style={{ '--word-em': (Math.max(widestWordEm(profile.closing.question, -0.052), widestWordEm(profile.closing.answer, -0.052)) + 0.1).toFixed(3) } as CSSProperties}>
          <E cms="contact.question" as="p" kind="heading" label="Closing question" bind="profile.closing.question" className={`${styles.question} ${shared.driven}`} ref={questionRef} aria-hidden="true" data-safe="headline" data-room-travel="3.2rem 2.4rem">
            {profile.closing.question}
          </E>
          <p className={`${styles.answer} ${shared.driven}`} ref={answerRef} data-safe="headline" data-room-travel="3.2rem 2.4rem">
            <Reveal as="span" mode="chars" className={styles.answerText} id="contact-title" attrs={answerCms}>
              {profile.closing.answer}
            </Reveal>
          </p>
        </div>

        <E cms="contact.links" as="ul" kind="list" label="Contact links" className={styles.links} ref={linksRef} data-safe="" data-room-travel="3.2rem 1.4rem" data-room-reserve="0">
          {contact.map((c, i) => {
            const pending = c.id === 'cv' && c.dataStatus === 'placeholder'
            const external = c.href.startsWith('http')
            return (
              <li key={c.id} className={shared.driven}>
                {pending ? (
                  <span className={styles.link} data-pending="true">
                    <span className={styles.linkLabel}>{c.label}</span>
                    <span className={styles.linkValue}>On request</span>
                  </span>
                ) : (
                  <a
                    href={c.href}
                    className={styles.link}
                    target={external ? '_blank' : undefined}
                    rel={external ? 'noreferrer noopener' : undefined}
                    data-cursor="link"
                    data-cursor-text={c.label.toUpperCase()}
                  >
                    <E cms={`contact.link.${c.id}.label`} label={`${c.label} — label`} bind={`contact.${i}.label`} className={styles.linkLabel}>{c.label}</E>
                    <E cms={`contact.link.${c.id}.value`} label={`${c.label} — value`} bind={`contact.${i}.value`} className={styles.linkValue}>{c.value}</E>
                    <span className={styles.linkArrow} aria-hidden="true">↗</span>
                  </a>
                )}
              </li>
            )
          })}
        </E>

        <E cms="contact.colophon" as="footer" kind="container" label="Colophon" className={`${styles.colophon} ${styles.chrome}`} data-safe="">
          <E cms="contact.colophon.name" label="Colophon — name">{profile.name} · Portfolio {profile.year}</E>
          <E cms="contact.colophon.built" label="Colophon — credits">Built with Next.js, React Three Fiber and a lot of scroll maths.</E>
        </E>

        {/* The world is an optional second way through the same
            material, so it waits at the foot of the page: one more
            scroll past the end and it takes over. */}
        <WorldPortal />
      </div>
    </Chapter>
  )
}
