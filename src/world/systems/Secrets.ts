import * as THREE from 'three'
import { palette } from '../core/palette'
import { clamp } from '../core/maths'
import type { Bin } from '../core/Disposal'
import type { Game } from '../Game'
import { districtById, landmarkById, timelinePlates } from '@/content/world'
import { profile, contact } from '@/content/profile'
import { projects } from '@/content/projects'

/* ============================================================
   SECRETS

   Structure from sources/Game/Easter.js and KonamiCode.js
   (folio-2025, MIT — Copyright (c) 2025 Bruno Simon). See
   THIRD_PARTY_NOTICES.md. The secrets themselves are ours.

   One rule, from the brief: secrets are playful, never essential.
   Nothing here gates content, nothing here is required to
   understand the portfolio, and none of it can be failed. The
   worst outcome of never finding any of it is that you saw the
   whole CV and had a nice drive.

   Most are hints the world already gives — a duck in the debug
   yard, a ticker on the exchange, a room under the sign. The ones
   implemented here are the ones that need to WATCH for something:
   a key sequence, an order of arrival, a jump that clears
   something, a count that reaches its target.
   ============================================================ */

const KONAMI = [
  'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight',
  'KeyB', 'KeyA',
]

/** How long the Konami vehicle lasts. */
const KONAMI_DURATION = 25

export class Secrets {
  private buffer: string[] = []
  private konamiUntil = 0

  /** Years driven so far, in the order they were driven. */
  private timelineOrder: string[] = []
  private timelineDone = false

  private phoneHopArmed = false
  private phoneHopPeak = 0

  constructor(private game: Game, bin: Bin) {
    this.bindKonami(bin)
    this.bindTimeline()
    this.bindCones()
    this.bindPhoneHop(bin)
    this.bindHiddenIsland()
    this.printConsoleNote()

    const tick = () => this.update()
    this.game.ticker.events.on('tick', tick, 15)
    bin.add(() => this.game.ticker.events.off('tick', tick))
  }

  /* ========================================================
     KONAMI — a temporary special vehicle
     ======================================================== */

  private bindKonami(bin: Bin): void {
    const onKey = (event: KeyboardEvent) => {
      this.buffer.push(event.code)
      if (this.buffer.length > KONAMI.length) this.buffer.shift()
      if (this.buffer.length !== KONAMI.length) return
      if (!this.buffer.every((code, i) => code === KONAMI[i])) return

      this.buffer.length = 0
      this.startKonami()
    }
    window.addEventListener('keydown', onKey)
    bin.add(() => window.removeEventListener('keydown', onKey))
  }

  private startKonami(): void {
    this.konamiUntil = this.game.ticker.elapsed + KONAMI_DURATION

    // A different car for half a minute: lighter, faster, and
    // vermilion all over. Restored by `endKonami`, and the values
    // are read back from the vehicle rather than hard-coded, so
    // triggering it twice cannot compound.
    const vehicle = this.game.vehicle
    if (!this.konamiSaved) {
      this.konamiSaved = {
        engineForce: vehicle.engineForceAmplitude,
        topSpeed: vehicle.topSpeed,
        topSpeedBoost: vehicle.topSpeedBoost,
        flipForce: vehicle.flipState.force,
      }
    }
    vehicle.engineForceAmplitude = this.konamiSaved.engineForce * 1.8
    vehicle.topSpeed = this.konamiSaved.topSpeed * 1.7
    vehicle.topSpeedBoost = this.konamiSaved.topSpeedBoost * 1.35
    vehicle.flipState.force = this.konamiSaved.flipForce * 1.6

    this.game.visualVehicle.setShell('konami')
    this.game.achievements.set('konami', 1)
    this.game.audio?.play('achievement')
    this.game.store.getState().notify({
      kind: 'info',
      title: 'CHEAT ENGAGED',
      body: `Lighter, faster, and the wrong colour. ${KONAMI_DURATION} seconds.`,
      duration: 5,
    })
  }

  private konamiSaved: {
    engineForce: number
    topSpeed: number
    topSpeedBoost: number
    flipForce: number
  } | null = null

  private endKonami(): void {
    if (!this.konamiSaved) return
    const vehicle = this.game.vehicle
    vehicle.engineForceAmplitude = this.konamiSaved.engineForce
    vehicle.topSpeed = this.konamiSaved.topSpeed
    vehicle.topSpeedBoost = this.konamiSaved.topSpeedBoost
    vehicle.flipState.force = this.konamiSaved.flipForce
    this.konamiSaved = null
    this.game.visualVehicle.setShell('default')
  }

  /* ========================================================
     TIME TRAVELLER — the years, in order
     ======================================================== */

  private bindTimeline(): void {
    for (const plate of timelinePlates) {
      const marker = this.game.world.timeline.find((t) => t.year === plate.year)
      if (!marker) continue

      const zone = this.game.zones.create(
        `year-${plate.year}`,
        'cylinder',
        marker.position,
        marker.radius,
        plate.year,
      )

      zone.events.on('enter', () => {
        if (this.timelineDone) return
        const expected = timelinePlates[this.timelineOrder.length]?.year

        if (plate.year === expected) {
          this.timelineOrder.push(plate.year)
          this.game.audio?.blip(1 + this.timelineOrder.length * 0.12)

          if (this.timelineOrder.length === timelinePlates.length) {
            this.timelineDone = true
            this.game.achievements.set('timeTraveller', 1)
            this.game.store.getState().notify({
              kind: 'info',
              title: 'TIME TRAVELLER',
              body: '2023 to 2026, in order. That is the whole degree.',
              duration: 5,
            })
          }
        } else if (plate.year !== this.timelineOrder[this.timelineOrder.length - 1]) {
          // Out of order starts again — but silently. Being told off
          // for driving over a number would be worse than the secret.
          this.timelineOrder = plate.year === timelinePlates[0].year ? [plate.year] : []
        }
      })
    }
  }

  /* ========================================================
     CONES — a clean sweep
     ======================================================== */

  private bindCones(): void {
    const target = 20
    this.game.world.props.onDisturb = (instance) => {
      if (instance.tag !== 'cones') return
      const knocked = this.game.world.props.disturbedCount('cones')
      this.game.achievements.set('cones', Math.min(knocked, target))
    }
  }

  /* ========================================================
     OVER THE PHONE — clear the Focus device in one jump
     ======================================================== */

  private bindPhoneHop(bin: Bin): void {
    const device = landmarkById['focus-device']
    if (!device) return

    const zone = this.game.zones.create(
      'phone-hop',
      'cylinder',
      new THREE.Vector3(
        device.x,
        this.game.world.terrain.colliderHeightAt(device.x, device.z),
        device.z,
      ),
      22,
      'phoneHop',
    )

    zone.events.on('enter', () => {
      this.phoneHopArmed = true
      this.phoneHopPeak = 0
    })
    zone.events.on('leave', () => {
      // Cleared it only if the car was properly airborne over the
      // device and is now out the other side.
      if (this.phoneHopArmed && this.phoneHopPeak > 6) {
        this.game.achievements.set('phoneHop', 1)
      }
      this.phoneHopArmed = false
    })

    bin.add(() => {
      this.phoneHopArmed = false
    })
  }

  /* ========================================================
     THE VOID — a hidden island, reachable only by a long jump
     ======================================================== */

  private bindHiddenIsland(): void {
    const district = districtById.void
    const zone = this.game.zones.create(
      'void-arrival',
      'cylinder',
      new THREE.Vector3(
        district.x,
        this.game.world.terrain.colliderHeightAt(district.x, district.z),
        district.z,
      ),
      district.radius,
      'void',
    )

    zone.events.on('enter', () => {
      this.game.achievements.set('hiddenIsland', 1)
      this.game.store.getState().notify({
        kind: 'info',
        title: '404',
        body: 'Nothing is supposed to be rendered here. And yet.',
        duration: 6,
      })
    })
  }

  /* ========================================================
     THE CONSOLE
     ======================================================== */

  private printConsoleNote(): void {
    const github = contact.find((c) => c.id === 'github')?.href ?? ''
    const heroes = projects.filter((p) => p.importance === 'hero').length

    console.log(
      `%c${profile.name} — the world%c\n\n` +
      `You opened the console. Have an achievement.\n\n` +
      `${projects.length} projects · ${heroes} hero case studies\n` +
      `Physics: Rapier. Engine: a port of Bruno Simon's folio-2025 (MIT).\n` +
      `Every model, sound and texture here is generated in the browser —\n` +
      `there is not one asset file in this route.\n\n` +
      `window.__world is live in development. Try:\n` +
      `  __world.lighting.setPhase(0.05)   // night\n` +
      `  __world.minigames.start('circuit')\n` +
      `  __world.world.props.reset()\n\n` +
      `Source: ${github}`,
      'font: 600 20px/1.3 system-ui; letter-spacing:-0.02em',
      'font: 12px/1.6 ui-monospace, monospace; color:#888',
    )

    // Firing this immediately would give it to everyone whose
    // devtools happen to be docked. It waits for the console to be
    // opened *while* the world is running, which is close enough.
    const probe = new Image()
    let opened = false
    Object.defineProperty(probe, 'id', {
      get: () => {
        if (!opened) {
          opened = true
          this.game.achievements.set('console', 1)
        }
        return 'devtools'
      },
    })
    console.debug('%c', probe)
  }

  /* ========================================================
     TICK
     ======================================================== */

  private update(): void {
    // Konami expiry.
    if (this.konamiSaved && this.game.ticker.elapsed > this.konamiUntil) {
      this.endKonami()
    }

    // Airborne height over the Focus device, for the phone hop.
    if (this.phoneHopArmed) {
      const position = this.game.player.position
      const ground = this.game.world.terrain.colliderHeightAt(position.x, position.z)
      this.phoneHopPeak = Math.max(this.phoneHopPeak, position.y - ground)
    }

    // A tiny thing: the dev-room terminal only appears at night, so
    // there is a reason to still be driving when the lights go out.
    const devRoom = this.game.world.landmarks.get('secret-devroom')
    if (devRoom) {
      const visible = this.game.lighting.nightFactor > 0.45
      if (devRoom.group.visible !== visible) devRoom.group.visible = visible
      this.game.interactions.setEnabled('secret-devroom', visible)
    }
  }

  /** True while the Konami vehicle is active. Read by VisualVehicle. */
  get konamiActive(): boolean {
    return this.konamiSaved !== null
  }

  /** 0..1 of the Konami timer remaining. */
  get konamiRemaining(): number {
    if (!this.konamiSaved) return 0
    return clamp((this.konamiUntil - this.game.ticker.elapsed) / KONAMI_DURATION, 0, 1)
  }

  /** Colour the HUD can use while the cheat is live. */
  static readonly KONAMI_COLOUR = palette.accent
}
