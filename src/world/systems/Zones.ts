import * as THREE from 'three'
import { Events } from '../core/Events'
import type { Ticker } from '../core/Ticker'
import type { Bin } from '../core/Disposal'

/* ============================================================
   ZONES
   Ported from sources/Game/Zones.js (folio-2025, MIT —
   Copyright (c) 2025 Bruno Simon). See THIRD_PARTY_NOTICES.md.

   Proximity triggers, checked against the player position once
   per fixed step. Deliberately not physics sensors: a zone that
   fires on "the car's centre is within R metres" is predictable,
   whereas a sensor collider fires on a bumper corner and makes
   district-entered toasts flicker at boundaries.

   Changes: `cylinder` zones ignore Y (a district is entered
   whether you drive in or land in it); zones carry arbitrary
   `data`; hysteresis stops a zone edge from chattering.
   ============================================================ */

export type ZoneShape = 'sphere' | 'cylinder'

export interface Zone<T = unknown> {
  id: string
  shape: ZoneShape
  position: THREE.Vector3
  radius: number
  isIn: boolean
  enabled: boolean
  data: T
  events: Events<'enter' | 'leave'>
}

/** Leaving takes 8% more distance than entering, so edges do not chatter. */
const HYSTERESIS = 1.08

export class Zones {
  readonly items: Zone<unknown>[] = []
  private target: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }

  constructor(ticker: Ticker, bin: Bin) {
    const update = () => this.update()
    // Order 8: after the player's post-physics position is final.
    ticker.events.on('fixed', update, 8)
    bin.add(() => {
      ticker.events.off('fixed', update)
      for (const zone of this.items) zone.events.clear()
      this.items.length = 0
    })
  }

  /** The point tested against every zone. Written by the Game each step. */
  setTarget(position: { x: number; y: number; z: number }): void {
    this.target = position
  }

  create<T = unknown>(
    id: string,
    shape: ZoneShape,
    position: THREE.Vector3,
    radius: number,
    data: T = undefined as T,
  ): Zone<T> {
    const zone: Zone<T> = {
      id,
      shape,
      position: position.clone(),
      radius,
      isIn: false,
      enabled: true,
      data,
      events: new Events(),
    }
    this.items.push(zone as Zone<unknown>)
    return zone
  }

  remove(zone: Zone<unknown>): void {
    const index = this.items.indexOf(zone)
    if (index !== -1) this.items.splice(index, 1)
    zone.events.clear()
  }

  private update(): void {
    const p = this.target
    for (const zone of this.items) {
      if (!zone.enabled) {
        if (zone.isIn) {
          zone.isIn = false
          zone.events.trigger('leave', [zone])
        }
        continue
      }

      const dx = p.x - zone.position.x
      const dz = p.z - zone.position.z
      const distance =
        zone.shape === 'cylinder'
          ? Math.hypot(dx, dz)
          : Math.hypot(dx, p.y - zone.position.y, dz)

      const threshold = zone.isIn ? zone.radius * HYSTERESIS : zone.radius

      if (distance < threshold) {
        if (!zone.isIn) {
          zone.isIn = true
          zone.events.trigger('enter', [zone])
        }
      } else if (zone.isIn) {
        zone.isIn = false
        zone.events.trigger('leave', [zone])
      }
    }
  }
}
