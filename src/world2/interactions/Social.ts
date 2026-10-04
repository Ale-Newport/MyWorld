import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import type { Prompts } from './Prompts'
import { contact } from '@/content/profile'
import { cutGlyph, paintUv } from './glyphs'

/* ============================================================
   PORTED FROM: sources/Game/World/Areas/SocialArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   Upstream lays eight interactive points on a half-circle of
   radius 6 around `refCenter`, one per entry of data/social.js,
   and leaves the nine icon meshes as knockable props.

   Three deliberate differences. First, the points sit ON the icons
   that already exist in the level — `gitHubPhysicalDynamic`,
   `linkedInPhysicalDynamic`, `mailPhysicalDynamic` — rather than
   on a synthetic ring, because the .blend already drew the right
   pictures and a visitor should be able to see which is which
   before pressing anything.

   Second, the icons with no Alejandro equivalent — X, YouTube,
   Discord, Twitch, Bluesky and OnlyFans — are GONE. They were
   kept for a while as unlabelled scenery on the argument that a
   logo with no link claims nothing. That argument is wrong in a
   plaza: a plinth with the Twitch mark on it in the middle of
   somebody's contact page reads as an account, whatever the code
   intends. Their authored pads stay; the marks do not. See
   `RETIRED` below, which the physics layer reads too, so the
   removed props leave no invisible collider behind.

   Third, the centrepiece. The .blend stands Bruno, his dog, his
   cat and an FWA trophy on the dais — his life, his award. In
   their place stands the monogram this portfolio already signs
   itself with: the same AN the HUD wears and the same AN painted
   on the car door, cut from the same typeface as the name on the
   beach, sized to the volume the authored statue occupied.

   Every URL comes from `contact` in src/content/profile.ts.
   ============================================================ */

interface Link { id: string; label: string; href: string; node: THREE.Object3D; sign: THREE.Mesh }

/** Which authored icon carries which contact entry. */
const ICONS: Record<string, string> = {
  github: 'gitHubPhysicalDynamic',
  linkedin: 'linkedInPhysicalDynamic',
  email: 'mailPhysicalDynamic',
}

/**
 * Authored props this portfolio does not stand behind: service marks for
 * accounts Alejandro has none of, and the .blend's personal statuary.
 *
 * `Interactions.reservedNames` feeds this list to the environment BEFORE it
 * builds physics, which is the only moment that works. Disabling a body after
 * the fact is not enough — the island reset re-enables every dynamic body it
 * can see — and the environment's second pass would give any leftover mesh a
 * trimesh collider of its own, so hiding alone leaves a wall you can hit.
 */
export const RETIRED = [
  'twitchPhysicalDynamic',
  'youtubePhysicalDynamic',
  'discordPhysicalDynamic',
  'blueskyPhysicalDynamic.001',
  'xPhysicalDynamic',
  'onlyfansPhysicalDynamic',
  // The dais: Bruno, his cat, his dog and its wings.
  'refStatuePhysicalDynamic',
  'boyMesh',
  'baguiraMesh.001',
  'sudoMesh.003',
  'wings',
]

/** The monogram in the middle, in reading order, top line first. */
const MONOGRAM = ['A', 'N']

/**
 * The texel a palette-shaded mesh spends most of its surface on — its colour,
 * in other words. The statue is three: a plinth, a body and a highlight; the
 * one the most vertices point at is the stone.
 */
function modalUv(mesh: THREE.Mesh | undefined): THREE.Vector2 | null {
  const attribute = mesh?.geometry.getAttribute('uv')
  if (!attribute) return null
  const tally = new Map<string, { uv: THREE.Vector2; count: number }>()
  for (let i = 0; i < attribute.count; i++) {
    const x = attribute.getX(i), y = attribute.getY(i)
    const key = `${x.toFixed(4)},${y.toFixed(4)}`
    const seen = tally.get(key)
    if (seen) seen.count++
    else tally.set(key, { uv: new THREE.Vector2(x, y), count: 1 })
  }
  let best: { uv: THREE.Vector2; count: number } | null = null
  for (const entry of tally.values()) if (!best || entry.count > best.count) best = entry
  return best?.uv ?? null
}

export class Social {
  readonly links: Link[] = []
  readonly group = new THREE.Group()
  private fans: { node: THREE.Object3D; home: THREE.Vector3 } | null = null
  /** The letters standing where the .blend put somebody else's statue. */
  readonly monogram: THREE.Mesh[] = []

  constructor(private game: World2Game, private references: References, prompts: Prompts, bin: Bin) {
    this.group.name = 'World2 / social'
    const centre = references.position('refCenter')
    /*
      The CV has no icon in the .blend, so it takes a seat on the arc the
      authored icons describe. It used to take the NEXT one past the last owned
      icon, which put it 1.7 m from Bluesky's plinth — inside the 2.5 m a
      prompt answers from, so the "Curriculum Vitae" plate read as Bluesky's
      label. With Bluesky and the rest retired there is a better seat going:
      the plinth Twitch vacated, which puts the four real links in one
      unbroken run round the arc.
    */
    const spare = references.position('twitchPhysicalDynamic') ?? this.nextOnArc(centre)

    for (const entry of contact) {
      const iconName = ICONS[entry.id]
      const node = iconName ? references.node(iconName) : null
      const anchor = node?.getWorldPosition(new THREE.Vector3()) ?? spare
      if (!anchor) continue
      const href = entry.href.startsWith('/') ? new URL(entry.href, window.location.origin).toString() : entry.href

      const sign = this.buildSign(entry.label, entry.value)
      sign.position.copy(anchor).add(new THREE.Vector3(0, 1.35, 0))
      this.group.add(sign)

      prompts.create({
        label: entry.label, position: anchor.clone().setY(Math.max(1, anchor.y)), align: 'right',
        onInteract: () => this.open(entry.id, href),
      })
      this.links.push({ id: entry.id, label: entry.label, href, node: node ?? sign, sign })
    }

    this.retire()
    this.buildMonogram(centre)
    this.buildFans(prompts)

    // The plates turn to whoever is reading them. An icon you can drive
    // round should not have a back you cannot read.
    const reach = 34
    const tick = () => {
      const player = this.game.player.position
      for (const link of this.links) {
        const sign = link.sign
        const near = Math.hypot(player.x - sign.position.x, player.z - sign.position.z) <= reach
        sign.visible = near
        if (near) sign.lookAt(player.x, sign.position.y, player.z)
      }
    }
    this.game.ticker.events.on('tick', tick, 12)
    bin.add(() => this.game.ticker.events.off('tick', tick))

    bin.add(() => {
      for (const link of this.links) {
        link.sign.geometry.dispose()
        const material = link.sign.material as THREE.MeshBasicMaterial
        material.map?.dispose()
        material.dispose()
      }
    })
    bin.object3D(this.group)
  }

  /**
   * Takes the retired props out of the picture. Their bodies were never built
   * — `reservedNames` saw to that — so all that is left is to stop drawing
   * them, which also keeps them out of the scenery merge: that pass runs after
   * this one and skips anything already invisible.
   */
  private retire(): void {
    for (const name of RETIRED) this.references.suppress(name)
  }

  /**
   * The monogram on the dais. Two letters stacked, cut from Geist Bold the
   * same way the name on the beach is, sized so the pair fills the volume the
   * authored statue stood in: 1.74 m wide, 1.78 m deep, 4.52 m tall.
   *
   * It is a FIXED body rather than a dynamic one. The name on the beach is
   * meant to be knocked over — that is its whole joke — but a monument you can
   * shove off its plinth is just litter, and the plaza is where the contact
   * details live.
   */
  private buildMonogram(centre: THREE.Vector3 | null): void {
    const statue = this.references.node('refStatuePhysicalDynamic')
    if (!centre || !statue) return
    statue.updateWorldMatrix(true, true)
    const volume = new THREE.Box3().setFromObject(statue)
    const size = volume.getSize(new THREE.Vector3())
    const base = volume.min.y

    // Two lines of one letter: the cap height is whatever divides the authored
    // height between them, leading included.
    const leading = 1.18
    const capHeight = size.y / (MONOGRAM.length * leading)
    const cut = MONOGRAM.map(char => cutGlyph(char, capHeight, Math.min(size.z, capHeight * 0.42)))
      .filter((glyph): glyph is NonNullable<typeof glyph> => !!glyph)
    if (cut.length !== MONOGRAM.length) return

    // The palette texture gives the level's props their flat colour through a
    // single texel, so the monogram is cut from the same stone the statue was:
    // its material, and the texel that statue used for most of its surface.
    const source = statue instanceof THREE.Mesh ? statue : statue.children.find(child => child instanceof THREE.Mesh) as THREE.Mesh | undefined
    const material = source
      ? (Array.isArray(source.material) ? source.material[0] : source.material)
      : new THREE.MeshStandardMaterial({ color: '#fff2e8' })
    const uv = modalUv(source) ?? new THREE.Vector2(0.73563, 0.5)

    // The plaza opens to the south — every authored icon sits on the far side
    // of the centre — so the monogram reads to a visitor driving in.
    const facing = Math.PI
    cut.forEach((glyph, index) => {
      paintUv(glyph.geometry, uv)
      const mesh = new THREE.Mesh(glyph.geometry, material)
      mesh.name = glyph.char
      mesh.castShadow = true
      mesh.receiveShadow = true
      const row = MONOGRAM.length - 1 - index
      const height = glyph.box.max.y - glyph.box.min.y
      mesh.position.set(
        centre.x,
        base + row * capHeight * leading + height / 2 + capHeight * 0.09,
        centre.z,
      )
      mesh.rotation.y = facing
      this.group.add(mesh)
      this.monogram.push(mesh)

      // One cuboid per letter, on the letter's own box. A capital A is mostly
      // air, but a car that clips its serif and carries on looks broken.
      const half = new THREE.Vector3(
        (glyph.box.max.x - glyph.box.min.x) / 2,
        height / 2,
        (glyph.box.max.z - glyph.box.min.z) / 2,
      )
      const physical = this.game.physics.add({
        type: 'fixed', position: mesh.position.clone(),
        rotation: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, facing, 0)),
        colliders: [{ shape: 'cuboid', parameters: [half.x, half.y, half.z], category: 'object' }],
        friction: 0.6, restitution: 0.1, owner: `monogram-${glyph.char}`,
      })
      // Immovable means immovable to the solver too. See World2Environment.
      this.references.environment.anchor(physical)
    })
  }

  /** The next free seat on the arc the authored icons already describe. */
  private nextOnArc(centre: THREE.Vector3 | null): THREE.Vector3 | null {
    if (!centre) return null
    const seats = Object.values(ICONS)
      .map(name => this.references.node(name)?.getWorldPosition(new THREE.Vector3()))
      .filter((p): p is THREE.Vector3 => !!p)
      .map(p => ({ angle: Math.atan2(p.z - centre.z, p.x - centre.x), radius: Math.hypot(p.x - centre.x, p.z - centre.z), y: p.y }))
      .sort((a, b) => a.angle - b.angle)
    if (!seats.length) return centre.clone().add(new THREE.Vector3(0, 1.6, 0))
    const radius = seats.reduce((sum, seat) => sum + seat.radius, 0) / seats.length
    const y = seats.reduce((sum, seat) => sum + seat.y, 0) / seats.length
    const gap = seats.length > 1 ? (seats[seats.length - 1].angle - seats[0].angle) / (seats.length - 1) : 0.5
    const angle = seats[seats.length - 1].angle + gap
    return new THREE.Vector3(centre.x + Math.cos(angle) * radius, y, centre.z + Math.sin(angle) * radius)
  }

  /** A small world-space plate so the icon says what it is without a modal. */
  private buildSign(label: string, value: string): THREE.Mesh {
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 160
    const context = canvas.getContext('2d')!
    context.fillStyle = 'rgba(35,31,43,0.92)'
    context.beginPath()
    context.roundRect(6, 26, 500, 104, 26)
    context.fill()
    context.textAlign = 'center'
    context.fillStyle = '#f4f1e8'
    context.font = '700 44px ui-sans-serif, system-ui, sans-serif'
    context.fillText(label.toUpperCase(), 256, 76)
    context.fillStyle = '#9b94a8'
    context.font = '500 28px ui-monospace, SFMono-Regular, monospace'
    let text = value
    while (context.measureText(text).width > 460 && text.length > 8) text = `${text.slice(0, -4)}…`
    context.fillText(text, 256, 114)
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.59),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.renderOrder = 4
    return mesh
  }

  private open(id: string, href: string): void {
    this.game.audio.play('interact')
    this.game.interactions?.achievements.mark('social', id)
    window.open(href, '_blank', 'noopener,noreferrer')
  }

  /**
   * The authored fan pad. Upstream pops a pooled rigid body out of it; the
   * joke was a pun on an account name, so what is kept here is the physical
   * toy — a prop that leaps when you press it — and not the caption.
   */
  private buildFans(prompts: Prompts): void {
    const pad = this.references.node('refFan')
    if (!pad) return
    const home = pad.getWorldPosition(new THREE.Vector3())
    // Upstream anchors this prompt on `refOnlyFans`, the empty beside the
    // logo, because the logo was the joke. With the logo gone the prompt would
    // float over bare grass, so it stands on the fan it actually works.
    this.fans = { node: pad, home }
    prompts.create({
      label: 'Give it a spin', position: home.clone().setY(Math.max(1, home.y)), align: 'left',
      onInteract: () => {
        // Everything loose on the pad gets a hop. Upstream popped a pooled
        // prop out of a spawn box; this uses the props the level already has.
        this.game.audio.play('blip', 0.8)
        const centre = this.fans!.home
        for (const { physical } of this.references.environment.dynamic) {
          const at = physical.body.translation()
          if (Math.hypot(at.x - centre.x, at.z - centre.z) > 5) continue
          physical.body.wakeUp()
          physical.body.applyImpulse({ x: (Math.random() - 0.5) * physical.body.mass(), y: 3.2 * physical.body.mass(), z: (Math.random() - 0.5) * physical.body.mass() }, true)
        }
      },
    })
  }

  get found(): number { return this.links.length }
}
