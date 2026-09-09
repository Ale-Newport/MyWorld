import * as THREE from 'three'
import { Events } from '../core/Events'
import { dist2 } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Ticker } from '../core/Ticker'
import type { Inputs } from '../input/Inputs'
import type { View } from '../view/View'
import type { WorldStore } from '../state/store'

/* ============================================================
   INTERACTIVE POINTS

   Architecture from sources/Game/InteractivePoints.js (folio-2025,
   MIT — Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.

   The rule the brief sets is that interaction is CONTEXTUAL and
   never mouse-only: you drive near a thing, a prompt appears, you
   press one key. That is also the only model that works
   identically on a keyboard, a gamepad and a touchscreen, so it
   is the only model here.

   Only ONE point is ever active. Two overlapping prompts is a
   choice the player did not ask to make, so the nearest wins and
   the other stays quiet. Nearness is measured in the XZ plane
   only — a point on a roof and a point under a bridge should not
   fight over you when they are twelve metres apart vertically,
   but a landmark you have driven under still counts.
   ============================================================ */

export interface InteractivePointOptions {
  id: string
  position: THREE.Vector3
  radius: number
  /** What it is called. The popup's headline. */
  label: string
  /** One line: what kind of thing it is. */
  sublabel?: string
  /** The verb shown beside the key. Defaults to EXPLORE. */
  action?: string
  /** Anchor for the on-screen prompt; defaults to `position` plus 3 m. */
  anchor?: THREE.Vector3
  onInteract: () => void
  /** Points can be switched off (a completed mini-game, a locked door). */
  enabled?: boolean
  /** Fires once, the first time the player comes within range. */
  onApproach?: () => void
}

interface Point extends InteractivePointOptions {
  enabled: boolean
  anchor: THREE.Vector3
  approached: boolean
}

/** The last thing pushed to React, so identical frames are skipped. */
interface Published {
  id: string
  qx: number
  qy: number
  label: string
  sublabel?: string
  action?: string
}

export class InteractivePoints {
  readonly events = new Events<'interact' | 'approach'>()
  private points = new Map<string, Point>()
  private active: Point | null = null
  private published: Published | null = null

  private readonly screen = new THREE.Vector2()
  /** Where the player is. Written by the Game each step. */
  private target = new THREE.Vector3()

  constructor(
    private ticker: Ticker,
    private inputs: Inputs,
    private view: View,
    private store: WorldStore,
    bin: Bin,
  ) {
    const update = () => this.update()
    // Order 9: after the view has placed the camera, so the prompt
    // is projected with this frame's matrix rather than last frame's.
    this.ticker.events.on('tick', update, 9)

    const onInteract = (action: { active: boolean }) => {
      if (!action.active) return
      const point = this.active
      if (!point || !point.enabled) return
      point.onInteract()
      this.events.trigger('interact', [point.id])
    }
    this.inputs.events.on('interact', onInteract as never)

    bin.add(() => {
      this.ticker.events.off('tick', update)
      this.inputs.events.off('interact', onInteract as never)
      this.points.clear()
      this.events.clear()
    })
  }

  setTarget(position: THREE.Vector3): void {
    this.target = position
  }

  add(options: InteractivePointOptions): void {
    this.points.set(options.id, {
      ...options,
      enabled: options.enabled ?? true,
      anchor: options.anchor ?? options.position.clone().setY(options.position.y + 3),
      approached: false,
    })
  }

  remove(id: string): void {
    if (this.active?.id === id) {
      this.active = null
      this.store.getState().setPrompt(null)
    }
    this.points.delete(id)
  }

  setEnabled(id: string, enabled: boolean): void {
    const point = this.points.get(id)
    if (!point) return
    point.enabled = enabled
    if (!enabled && this.active === point) {
      this.active = null
      this.store.getState().setPrompt(null)
    }
  }

  setLabel(id: string, label: string, sublabel?: string, action?: string): void {
    const point = this.points.get(id)
    if (!point) return
    point.label = label
    point.sublabel = sublabel
    if (action !== undefined) point.action = action
    if (this.active === point) this.publish(point)
  }

  /** The point currently in range, if any. */
  get current(): string | null {
    return this.active?.id ?? null
  }

  private update(): void {
    // A prompt on top of an open panel is noise.
    if (this.store.getState().overlay !== null) {
      if (this.active) {
        this.active = null
        this.published = null
        this.store.getState().setPrompt(null)
      }
      return
    }

    /*
      SELECTION. Nearest wins, but two things stop it flickering when
      several points overlap — which at the hub, where the welcome,
      the about card, a timeline plate and a ramp all sit within a few
      metres, it did constantly.

      A point is scored by how far INSIDE its radius the car is, as a
      fraction, rather than by raw distance: a small precise trigger
      beats a large vague one you happen to be nearer the centre of.
      And the point already showing gets a 15% handicap in its own
      favour, so a tie does not swap back and forth every frame.
    */
    let nearest: Point | null = null
    let best = -Infinity

    for (const point of this.points.values()) {
      if (!point.enabled) continue
      const distance = dist2(this.target.x, this.target.z, point.position.x, point.position.z)
      if (distance > point.radius * point.radius) continue
      // A point 20 m below is not the same place, whatever the plan
      // view says.
      if (Math.abs(this.target.y - point.position.y) > 18) continue
      let score = 1 - Math.sqrt(distance) / point.radius
      if (point === this.active) score += 0.15
      if (score > best) {
        best = score
        nearest = point
      }
    }

    if (nearest && !nearest.approached) {
      nearest.approached = true
      nearest.onApproach?.()
      this.events.trigger('approach', [nearest.id])
    }

    if (nearest === this.active) {
      if (nearest) this.publish(nearest)
      return
    }

    this.active = nearest
    if (!nearest) {
      this.published = null
      this.store.getState().setPrompt(null)
      return
    }
    this.publish(nearest)
  }

  private publish(point: Point): void {
    const visible = this.view.project(point.anchor, this.screen)
    if (!visible) {
      if (this.published !== null) {
        this.published = null
        this.store.getState().setPrompt(null)
      }
      return
    }
    // Kept inside the frame so a prompt never sits half off-screen
    // when the landmark is at the edge of the view.
    const x = Math.min(0.93, Math.max(0.07, this.screen.x))
    const y = Math.min(0.9, Math.max(0.12, this.screen.y))

    /*
      Only when something has actually changed. This used to build a
      fresh object and push it into the React store on EVERY FRAME
      that a prompt was on screen — sixty state updates a second, each
      re-rendering the whole HUD, for a card that moves a pixel. The
      position is quantised to a thousandth of the viewport, which is
      about one pixel at 1080p and below what anyone can see move.
    */
    const qx = Math.round(x * 1000)
    const qy = Math.round(y * 1000)
    const last = this.published
    if (
      last && last.id === point.id && last.qx === qx && last.qy === qy &&
      last.label === point.label && last.sublabel === point.sublabel &&
      last.action === point.action
    ) return

    this.published = { id: point.id, qx, qy, label: point.label, sublabel: point.sublabel, action: point.action }
    this.store.getState().setPrompt({
      label: point.label,
      sublabel: point.sublabel,
      action: point.action,
      x, y,
    })
  }
}
