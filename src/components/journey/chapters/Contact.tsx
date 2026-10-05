'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Chapter } from '@/components/journey/Chapter'
import { Reveal } from '@/components/typography/Reveal'
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

/** The box of an element's glyphs (or of the element, when it has none) in `stage`'s layout space, ignoring transforms. */
function layoutRect(el: HTMLElement, stage: HTMLElement, range: Range): DOMRect | null {
  const s = stage.getBoundingClientRect()
  const own = el.getBoundingClientRect()
  if (own.width < 1 || own.height < 1) return null
  // Transforms move the measured box; offset the stage's own (the
  // portal's drag) back out. The words' own reveal offsets are what
  // the margins below are for.
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let node = walk.nextNode(); node; node = walk.nextNode()) {
    // A screen reader's copy of the words (Reveal's) is laid out on one
    // unclipped line beside them but never seen: it is not their box.
    if ((node instanceof Element ? node : node.parentElement)?.closest('.sr-only')) continue
    if (!(node instanceof Element)) range.selectNodeContents(node)
    for (const r of Array.from(node instanceof Element ? node.getClientRects() : range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue
      x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom)
    }
  }
  if (!Number.isFinite(x0)) { x0 = own.left; y0 = own.top; x1 = own.right; y1 = own.bottom }
  return new DOMRect(x0 - s.left, y0 - s.top, x1 - x0, y1 - y0)
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
        const r = layoutRect(el, stage, range)
        if (!r) continue
        // The headline rises and sinks a few rem as it reveals and as
        // the portal lifts the stage: its margin covers that travel.
        const big = el.dataset.safe === 'headline'
        const mx = (big ? 2.2 : 1.1) * rem
        const my = (big ? 4.4 : 1.1) * rem
        out.push({ x: r.x - mx, y: r.y - my, w: r.width + mx * 2, h: r.height + my * 2 })
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

        <div className={styles.center}>
          <E cms="contact.question" as="p" kind="heading" label="Closing question" bind="profile.closing.question" className={`${styles.question} ${shared.driven}`} ref={questionRef} aria-hidden="true" data-safe="headline">
            {profile.closing.question}
          </E>
          <p className={`${styles.answer} ${shared.driven}`} ref={answerRef} data-safe="headline">
            <Reveal as="span" mode="chars" className={styles.answerText} id="contact-title" attrs={answerCms}>
              {profile.closing.answer}
            </Reveal>
          </p>
        </div>

        <E cms="contact.links" as="ul" kind="list" label="Contact links" className={styles.links} ref={linksRef} data-safe="">
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
