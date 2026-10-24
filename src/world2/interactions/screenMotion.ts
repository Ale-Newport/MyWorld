import { drawBoardImage } from '../content/boards'
import type { BoardProject } from '../content/projects'
import {
  EMBLEM_SIZE, TOKENS, drawFit, fitText, paintEmblem, paintParchment, paintRibbon, paintTag, paintWood, roundRect, signFonts, themeForProject,
  type EmblemKind, type FitResult,
} from '../signs'

/* ============================================================
   WHAT THE PROJECT BOARD SHOWS — "Island timber"

   The big board used to be a glowing navy monitor bolted to a
   shed. It is now what a workshop would nail up: a sheet of
   parchment pinned inside the frame, lettered in ink in Geist,
   with a ribbon naming the field, a carved picture of the work
   in a wooden mat and, if the project has a number it can stand
   behind, a medal-stamped line saying so.

   Two halves, because they age differently:
     * the FACE is painted when the project changes and left
       alone (paintProjectFace);
     * the EMBLEM is the small animated picture inside the mat
       and the only part that ever repaints on a timer
       (paintProjectEmblem, 256 x 256).
   `paintProjectScreen` draws both into one canvas for places that
   have no scheduler, and `paintProjectBoard` adds the title plate
   and the URL chip above it: that is what the admin "Carteles"
   preview shows, so what the editor shows is what the world shows.

   Layout is in a 1024 x 576 design space scaled uniformly to
   whatever canvas it is given; nothing is stretched, text is
   fitted (wrapped, shrunk, ellipsized) and never squeezed.
   ============================================================ */

export const FACE_W = 1024
export const FACE_H = 576
/** The title plate at the board's width: the authored plane is 4 x 0.6 m, so 1024 across is 154 down. */
export const PLATE_H = 154
/** The URL strip's plane is this many metres wide (the authored plane is 4 and never needed that much). */
export const LINK_PLANE = 2.2
/** The whole board in one canvas, plate above the sheet: what the admin preview shows. */
export const BOARD_H = PLATE_H + FACE_H

/** The wooden mat that holds the emblem, in design-space pixels. */
export const EMBLEM_RECT = { x: 640, y: 66, size: 336 }

export interface FaceOptions {
  /** Called when a CMS image that was still loading becomes drawable. */
  ready?: () => void
  /** 0-based position in the run and its length, stamped under the mat. */
  index?: number
  total?: number
}

const hostOf = (link: string): string => link.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '')

/** Text the CMS can leave blank: trimmed, and nothing for whitespace. */
const trimmed = (text: string | undefined | null): string => String(text ?? '').trim()

/** The technologies with the blank entries dropped, so a stray comma never draws an empty tag. */
export const cleanTechs = (project: BoardProject): string[] => project.technologies.map(trimmed).filter(Boolean)

/** What the URL strip says. */
export const projectLinkLabel = (project: BoardProject): string => project.link ? hostOf(project.link) : 'Private source'

/** Which little picture a project carries. */
export const emblemKindFor = (project: BoardProject): EmblemKind | null => themeForProject(project).emblem

/** Paints the project's animated picture into a square canvas context. */
export function paintProjectEmblem(context: CanvasRenderingContext2D, size: number, project: BoardProject, time: number): void {
  paintEmblem(context, emblemKindFor(project) ?? 'rings', size, time, project.id)
}

/** The sheet itself: ribbon, description, metric, techs, mat, status. Static. */
export interface FaceMetrics { description: FitResult; scale: number }

export function paintProjectFace(context: CanvasRenderingContext2D, width: number, height: number, project: BoardProject, options: FaceOptions = {}): FaceMetrics {
  const fonts = signFonts()
  const theme = themeForProject(project)
  const scale = Math.min(width / FACE_W, height / FACE_H)
  context.save()
  context.fillStyle = TOKENS.paperDeep
  context.fillRect(0, 0, width, height)
  context.translate((width - FACE_W * scale) / 2, (height - FACE_H * scale) / 2)
  context.scale(scale, scale)
  paintParchment(context, { x: 0, y: 0, w: FACE_W, h: FACE_H }, { seed: 'face', radius: 14 })

  const left = 64, right = 600, columnWidth = right - left
  // Ribbon: the field and year, on the project's colour. Blank fields leave no ribbon rather than a bare dot.
  const kicker = [project.category, project.year].map(trimmed).filter(Boolean).join(' · ').toUpperCase()
  if (kicker) {
    const kickerFit = fitText(context, kicker, { maxWidth: columnWidth - 80, minPx: 20, maxPx: 26, weight: 600, family: fonts.mono, lineHeight: 1 })
    const ribbonWidth = Math.min(columnWidth, context.measureText(kickerFit.lines[0] ?? '').width + 76)
    paintRibbon(context, { x: left - 14, y: 50, w: ribbonWidth, h: 50 }, theme.ribbon, theme.ribbonDeep)
    context.fillStyle = theme.ribbonInk
    drawFit(context, kickerFit, left - 14 + ribbonWidth / 2, 50 + 25 - kickerFit.px / 2, 'center')
  }

  // The figure the project stands behind comes first, under the ribbon: it is the line a visitor most wants to see, and it stays
  // clear of the bottom of the sheet, which the car and the lectern cover in the reading pose.
  const metric = trimmed(project.metric)
  const metricTop = 116, metricHeight = 70
  const tagsTop = 490
  const descTop = metric ? metricTop + metricHeight + 18 : 124
  if (metric) paintMedalLine(context, metric, left, metricTop, columnWidth, metricHeight, fonts.sans, theme.accent)
  // Short copy is set larger instead of leaving the sheet half empty; long copy shrinks to fit as before.
  const description = fitText(context, project.description, {
    maxWidth: columnWidth, maxLines: 10, maxHeight: tagsTop - 18 - descTop, minPx: 22, maxPx: 48, weight: 500, family: fonts.sans, lineHeight: 1.28,
  })
  context.fillStyle = TOKENS.ink2
  drawFit(context, description, left, descTop, 'left')

  // Technology tags, as many as fit on one row; the rest are counted.
  let x = left
  const techs = cleanTechs(project)
  for (let i = 0; i < techs.length; i++) {
    const room = right - x
    context.font = `600 20px ${fonts.mono}`
    const tagWidth = context.measureText(techs[i]).width + 36
    const more = techs.length - i
    if (tagWidth > room) {
      if (i > 0) paintTag(context, `+${more}`, x, tagsTop, 40, fonts, { fill: TOKENS.copper, ink: TOKENS.ink, px: 20 })
      else paintTag(context, techs[i].slice(0, 14) + '…', x, tagsTop, 40, fonts, { px: 20 })
      break
    }
    x += paintTag(context, techs[i], x, tagsTop, 40, fonts, { px: 20 }) + 10
  }

  // The mat: a wooden picture frame the emblem sits in, or the CMS image on paper.
  const m = EMBLEM_RECT
  paintWood(context, { x: m.x - 16, y: m.y - 16, w: m.size + 32, h: m.size + 32 }, { seed: 'mat', base: TOKENS.woodDark, grain: 0.35, knots: 0 })
  context.fillStyle = TOKENS.paper
  context.fillRect(m.x, m.y, m.size, m.size)
  if (project.image) {
    context.fillStyle = TOKENS.paperHi
    context.fillRect(m.x, m.y, m.size, m.size)
    drawBoardImage(context, project.image, m.x + 10, m.y + 10, m.size - 20, m.size - 20, options.ready)
  }
  context.strokeStyle = 'rgba(26,23,18,0.55)'; context.lineWidth = 3
  context.strokeRect(m.x, m.y, m.size, m.size)

  // Under the mat: whether there is something to open, and where in the run this is.
  const statusY = m.y + m.size + 40
  paintTag(context, project.link ? 'OPEN TO VISIT  ↗' : 'PRIVATE SOURCE', m.x - 16, statusY, 42, fonts, { fill: project.link ? theme.ribbon : TOKENS.woodDeep, ink: theme.ribbonInk, px: 20 })
  if (options.index !== undefined && options.total) {
    const label = `${String(options.index + 1).padStart(2, '0')}`
    context.textBaseline = 'alphabetic'
    context.textAlign = 'right'
    context.fillStyle = TOKENS.ink
    context.font = `700 54px ${fonts.sans}`
    const total = ` / ${String(options.total).padStart(2, '0')}`
    context.font = `500 26px ${fonts.mono}`
    const totalWidth = context.measureText(total).width
    context.fillStyle = TOKENS.ink3
    context.fillText(total, m.x + m.size + 16, statusY + 86)
    context.font = `700 54px ${fonts.sans}`
    context.fillStyle = TOKENS.ink
    context.fillText(label, m.x + m.size + 16 - totalWidth, statusY + 86)
  }
  context.restore()
  return { description, scale }
}

/** A medal and a line of text: the one figure the project's own data stands behind. */
function paintMedalLine(c: CanvasRenderingContext2D, text: string, x: number, y: number, width: number, height: number, family: string, accent: string): void {
  c.save()
  c.translate(x + width / 2, y + height / 2)
  c.rotate(-0.018)
  c.translate(-width / 2, -height / 2)
  c.fillStyle = 'rgba(248,236,208,0.65)'; roundRect(c, 0, 0, width, height, 10); c.fill()
  c.strokeStyle = accent; c.lineWidth = 3; roundRect(c, 1.5, 1.5, width - 3, height - 3, 10); c.stroke()
  c.lineWidth = 1.2; roundRect(c, 7, 7, width - 14, height - 14, 6); c.stroke()
  const r = 22, cx = 44, cy = height / 2
  c.fillStyle = TOKENS.gold
  c.beginPath()
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.82 : r; c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr) }
  c.closePath(); c.fill()
  c.strokeStyle = '#a9790a'; c.lineWidth = 2; c.beginPath(); c.arc(cx, cy, r * 0.55, 0, Math.PI * 2); c.stroke()
  c.fillStyle = '#a9790a'; c.font = `700 16px ${family}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText('★', cx, cy + 6)
  const fit = fitText(c, text, { maxWidth: width - 104, maxLines: 2, maxHeight: height - 16, minPx: 20, maxPx: 34, weight: 700, family, lineHeight: 1.12 })
  c.fillStyle = TOKENS.ink
  drawFit(c, fit, 84, (height - fit.height) / 2, 'left')
  c.restore()
}

/**
 * The sheet and a frame of the emblem in one canvas, for places with no scheduler. `time` animates the emblem. Keeps the
 * signature the CMS called; `paintProjectBoard` puts the title plate above it.
 */
export function paintProjectScreen(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: BoardProject,
  time: number,
  ready?: () => void,
  position?: { index: number; total: number },
): void {
  paintProjectFace(context, width, height, project, { ready, index: position?.index, total: position?.total })
  if (project.image) return
  const scale = Math.min(width / FACE_W, height / FACE_H)
  context.save()
  context.translate((width - FACE_W * scale) / 2 + EMBLEM_RECT.x * scale, (height - FACE_H * scale) / 2 + EMBLEM_RECT.y * scale)
  context.beginPath(); context.rect(0, 0, EMBLEM_RECT.size * scale, EMBLEM_RECT.size * scale); context.clip()
  paintProjectEmblem(context, EMBLEM_RECT.size * scale, project, time)
  context.restore()
}

/* ------------------------------------------------------------------ the small plates -- */

/** The copper title plate: the project's name, carved in cream on dark timber. Canvas matches the 4 x 0.6 plane. */
export function paintTitlePlate(context: CanvasRenderingContext2D, width: number, height: number, project: BoardProject): FitResult {
  const fonts = signFonts()
  paintWood(context, { x: 0, y: 0, w: width, h: height }, { seed: 'title-plate', base: TOKENS.woodDark, grain: 0.7, nails: true })
  // The nails sit 1.7% in from the corners; the lettering may come within 4% of the edge. A wider line is the only way a long
  // name gets bigger on a plate of this height, and the plate's height belongs to the model.
  const padX = width * 0.04
  const fit = fitText(context, trimmed(project.title), {
    maxWidth: width - padX * 2, maxLines: 2, maxHeight: height * 0.96, minPx: height * 0.2, maxPx: height * 0.94, weight: 700, family: fonts.sans, lineHeight: 1.02,
  })
  const top = (height - fit.height) / 2
  // Lettering never leaves the timber: a fallback face for a script or an emoji can be taller than Geist's line box.
  context.save()
  context.beginPath(); context.rect(0, 0, width, height); context.clip()
  context.fillStyle = 'rgba(0,0,0,0.35)'
  drawFit(context, fit, width / 2 + height * 0.012, top + height * 0.014, 'center')
  context.fillStyle = TOKENS.cream
  drawFit(context, fit, width / 2, top, 'center')
  context.restore()
  return fit
}

/** The URL, shortened the way a person would when it does not fit: host/…/last-segment keeps the name of the thing. */
const compactLink = (label: string): string => {
  const parts = label.split('/').filter(Boolean)
  return parts.length > 2 ? `${parts[0]}/…/${parts[parts.length - 1]}` : label
}

/** Fits the URL into a strip of `width` x `height`. Returns the lines and the width of the text, so a chip can be sized to it. */
export function fitLinkStrip(context: CanvasRenderingContext2D, width: number, height: number, project: BoardProject): { fit: FitResult; textWidth: number } {
  const fonts = signFonts()
  const label = projectLinkLabel(project)
  const options = { maxWidth: width * 0.9, minPx: height * 0.3, maxPx: height * 0.62, weight: 600, family: fonts.mono, lineHeight: 1 }
  let fit = fitText(context, label, options)
  // Cut at the end, a long address loses the name of the repository, which is what tells links apart; shortened in the middle it
  // keeps it, and if even that is too long the cut falls inside the name, not before it.
  if (fit.truncated) {
    const compact = compactLink(label)
    if (compact !== label) fit = fitText(context, compact, options)
  }
  context.font = fit.font
  return { fit, textWidth: context.measureText(fit.lines[0] ?? '').width }
}

/**
 * The URL strip's lettering (transparent: it sits on a timber chip the caller sizes). Returns the text's width in
 * canvas pixels so the chip can be scaled to it. A caller that has already fitted the strip (the chip, which needs the width
 * first) passes the result so it is not worked out again.
 */
export function paintLinkStrip(context: CanvasRenderingContext2D, width: number, height: number, project: BoardProject, fitted?: { fit: FitResult; textWidth: number }): number {
  const { fit, textWidth } = fitted ?? fitLinkStrip(context, width, height, project)
  context.fillStyle = project.link ? TOKENS.cream : TOKENS.chalk
  drawFit(context, fit, width / 2, (height - fit.height) / 2, 'center')
  return textWidth
}

/** The URL chip as the world hangs it: on the plate's lower edge, as wide as its text. Board-space pixels (1024 across = 4 m). */
function paintLinkChip(context: CanvasRenderingContext2D, centreX: number, plateBottom: number, project: BoardProject): void {
  const metre = FACE_W / 4
  const stripW = LINK_PLANE * metre, stripH = 0.2 * metre
  const fitted = fitLinkStrip(context, stripW, stripH, project)
  const { textWidth } = fitted
  const chipW = Math.max(0.35, (textWidth / stripW) * LINK_PLANE + 0.2) * metre, chipH = 0.24 * metre
  const x = centreX - chipW / 2, y = plateBottom - chipH * 0.55
  context.save()
  context.shadowColor = 'rgba(0,0,0,0.35)'; context.shadowBlur = 8; context.shadowOffsetY = 3
  paintWood(context, { x, y, w: chipW, h: chipH }, { seed: 'url-chip', base: TOKENS.woodDark, grain: 0.5, knots: 0 })
  context.restore()
  context.save()
  context.translate(x + (chipW - stripW) / 2, y + (chipH - stripH) / 2)
  paintLinkStrip(context, stripW, stripH, project, fitted)
  context.restore()
}

/**
 * The whole board as the world shows it, in one canvas: the title plate with the URL chip on its lower edge, then the sheet
 * with its picture. Used by the admin "Carteles" preview, so editing a title shows. Laid out in a 1024 x BOARD_H design space.
 */
export function paintProjectBoard(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: BoardProject,
  time: number,
  ready?: () => void,
  position?: { index: number; total: number },
): void {
  const scale = Math.min(width / FACE_W, height / BOARD_H)
  const ox = (width - FACE_W * scale) / 2, oy = (height - BOARD_H * scale) / 2
  context.save()
  context.fillStyle = TOKENS.paperDeep
  context.fillRect(0, 0, width, height)
  context.save()
  context.translate(ox, oy + PLATE_H * scale)
  paintProjectScreen(context, FACE_W * scale, FACE_H * scale, project, time, ready, position)
  context.restore()
  context.save()
  context.translate(ox, oy)
  context.scale(scale, scale)
  paintTitlePlate(context, FACE_W, PLATE_H, project)
  paintLinkChip(context, FACE_W / 2, PLATE_H, project)
  context.restore()
  context.restore()
}

function tag(context: CanvasRenderingContext2D, width: number, height: number): void {
  context.save()
  context.shadowColor = 'rgba(0,0,0,0.3)'; context.shadowBlur = height * 0.04; context.shadowOffsetY = height * 0.02
  paintParchment(context, { x: height * 0.03, y: height * 0.03, w: width - height * 0.06, h: height - height * 0.06 }, { seed: 'tag', radius: height * 0.09, rule: false, burn: 0.35 })
  context.restore()
}

/** The wooden neighbour signs: a parchment tag naming the previous / next project. */
export function paintNeighbour(context: CanvasRenderingContext2D, width: number, height: number, which: 'previous' | 'next', project: BoardProject): void {
  const fonts = signFonts()
  tag(context, width, height)
  const pad = width * 0.09
  const kicker = which === 'previous' ? '◀ PREVIOUS' : 'NEXT ▶'
  const kickerFit = fitText(context, kicker, { maxWidth: width - pad * 2, minPx: height * 0.09, maxPx: height * 0.13, weight: 600, family: fonts.mono, lineHeight: 1 })
  context.fillStyle = TOKENS.ink2
  drawFit(context, kickerFit, width / 2, height * 0.12, 'center')
  const nameTop = height * 0.12 + kickerFit.height + height * 0.05
  const fit = fitText(context, project.short, { maxWidth: width - pad * 2, maxLines: 3, maxHeight: height * 0.9 - nameTop, minPx: height * 0.11, maxPx: height * 0.27, weight: 700, family: fonts.sans, lineHeight: 1.08 })
  context.fillStyle = TOKENS.ink
  drawFit(context, fit, width / 2, nameTop + (height * 0.9 - nameTop - fit.height) / 2, 'center')
}

/** One of the three fact plaques: CATEGORY, YEAR or STACK, in ink on a parchment tag. */
export function paintAttribute(context: CanvasRenderingContext2D, width: number, height: number, role: 'category' | 'year' | 'stack', project: BoardProject): void {
  const fonts = signFonts()
  tag(context, width, height)
  const pad = width * 0.07
  const label = role === 'category' ? 'CATEGORY' : role === 'year' ? 'YEAR' : 'STACK'
  const labelFit = fitText(context, label, { maxWidth: width - pad * 2, minPx: height * 0.13, maxPx: height * 0.2, weight: 600, family: fonts.mono, lineHeight: 1 })
  context.fillStyle = TOKENS.ink2
  drawFit(context, labelFit, pad, height * 0.13, 'left')
  const value = trimmed(role === 'category' ? project.category : role === 'year' ? project.year : cleanTechs(project).slice(0, 3).join(' · ')) || '—'
  const top = height * 0.13 + labelFit.height + height * 0.04
  const fit = fitText(context, value, { maxWidth: width - pad * 2, maxLines: role === 'stack' ? 2 : 1, maxHeight: height * 0.88 - top, minPx: height * 0.14, maxPx: height * 0.4, weight: 700, family: fonts.sans, lineHeight: 1.1 })
  context.fillStyle = TOKENS.ink
  drawFit(context, fit, pad, top + (height * 0.88 - top - fit.height) / 2, 'left')
}

/** The canvas sizes (width, height) of the layers that carry the board's lettering, which is what its fits depend on. A missing one is skipped. */
export interface PrefitSizes {
  title?: readonly [number, number]
  link?: readonly [number, number]
  previous?: readonly [number, number]
  next?: readonly [number, number]
  category?: readonly [number, number]
  year?: readonly [number, number]
  stack?: readonly [number, number]
}

/**
 * Small steps that get `project`'s lettering ready: each runs one painter on a `measuringContext` (which measures and draws
 * nothing), so the fits that painter makes are worked out and remembered. When the layer is painted for real, the fits are
 * made and only the drawing is left. A fit of a long text at a size never used before costs milliseconds on a phone, which
 * is a frame lost if it all happens in the frame the project changes; the board runs these one a frame while it is idle.
 * `previous` and `next` are the neighbours the board shows with `project` in the middle.
 */
export function prefitSteps(project: BoardProject, previous: BoardProject, next: BoardProject, sizes: PrefitSizes): Array<(context: CanvasRenderingContext2D) => void> {
  type Step = (context: CanvasRenderingContext2D) => void
  const steps: Step[] = [context => { paintProjectFace(context, FACE_W, FACE_H, project) }]
  const { title, link } = sizes
  if (title) steps.push(context => { paintTitlePlate(context, title[0], title[1], project) })
  if (link) steps.push(context => { paintLinkStrip(context, link[0], link[1], project) })
  if (sizes.previous) steps.push(context => paintNeighbour(context, sizes.previous![0], sizes.previous![1], 'previous', previous))
  if (sizes.next) steps.push(context => paintNeighbour(context, sizes.next![0], sizes.next![1], 'next', next))
  for (const role of ['category', 'year', 'stack'] as const) {
    const size = sizes[role]
    if (size) steps.push(context => paintAttribute(context, size[0], size[1], role, project))
  }
  return steps
}

export { EMBLEM_SIZE }
