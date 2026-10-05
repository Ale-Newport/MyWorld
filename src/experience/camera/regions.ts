import type { ChapterId } from '@/content/types'

/* ============================================================
   SCENE REGIONS

   The WebGL layer is one fixed, full-screen canvas behind the
   whole journey, so a 3D subject has no box of its own: left to
   itself it is drawn wherever the camera happens to put it,
   which on most screens was straight through the copy.

   A chapter that brings a subject therefore says where on its
   stage the subject belongs, the same way it places everything
   else: by laying out an empty box in its own grid
   (<SceneRegion>, `data-scene-region="<chapter>"`). The box is
   measured here — on resize, never per frame — relative to the
   chapter's pinned stage, along with the section it scrolls in.
   JourneyCamera reads it every frame and shifts and scales its
   projection so the subject's design frame lands inside that
   box, following the stage as it scrolls in and out.

   This module is shared by the page and the canvas chunk, so it
   holds plain numbers and nothing else.
   ============================================================ */

export interface SceneRegion {
  chapter: ChapterId
  /** The box in CSS px, relative to the chapter's pinned stage (as laid out, before any travel). */
  x: number
  y: number
  w: number
  h: number
  /** The chapter's section in document px, and its pinned stage's height. */
  sectionTop: number
  sectionHeight: number
  stageHeight: number
}

const regions = new Map<ChapterId, SceneRegion>()
let version = 0

/* A stage whose words are taller than the screen moves them through
   it as the chapter scrolls (components/journey/stageFit.ts), and a
   region laid out among them moves with them: the shift is published
   here every frame it changes. */
const shifts = new Map<ChapterId, number>()

export function writeStageShift(id: ChapterId, y: number) {
  if ((shifts.get(id) ?? 0) === y) return
  if (y) shifts.set(id, y)
  else shifts.delete(id)
  version++
}

export function readStageShift(id: ChapterId) {
  return shifts.get(id) ?? 0
}

export function writeSceneRegion(id: ChapterId, region: SceneRegion | null) {
  if (region) regions.set(id, region)
  else regions.delete(id)
  version++
}

/** Bumped on every write, so a canvas drawing on demand knows to draw again. */
export function sceneRegionsVersion() {
  return version
}

export function readSceneRegion(id: ChapterId): SceneRegion | undefined {
  return regions.get(id)
}

/** Whether the mounted journey lays out any region at all. */
export function hasSceneRegions() {
  return regions.size > 0
}

/**
 * Where the region is on screen right now, for a document scrolled
 * to `scrollY`: the stage is sticky, so it rides in from below,
 * holds at the top for the length of its chapter, and rides out.
 */
export function regionOnScreen(r: SceneRegion, scrollY: number, out: { x: number; y: number; w: number; h: number }) {
  const pinStart = r.sectionTop
  const pinEnd = r.sectionTop + r.sectionHeight - r.stageHeight
  const stageTop = scrollY < pinStart ? pinStart - scrollY : scrollY > pinEnd ? pinEnd - scrollY : 0
  out.x = r.x
  out.y = r.y + stageTop + readStageShift(r.chapter)
  out.w = r.w
  out.h = r.h
  return out
}

/**
 * What the camera last did to its projection, for the scenes that
 * need to know: `scale` is how much the subject's design frame was
 * shrunk to fit its region (1 = the full screen), which is what a
 * shader drawing fixed-size points has to scale them by; `chapter`
 * is the chapter whose region the projection currently serves.
 */
export const lens = {
  scale: 1,
  chapter: null as ChapterId | null,
  /** 0 while the projection is still travelling to a new chapter's region, 1 once it has arrived. */
  settled: 1,
}
