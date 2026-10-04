import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import type { PromptHandle } from './Prompts'
import { BOARD_FEATURED_COUNT, BOARD_PROJECTS, type BoardProject } from '../content/projects'
import { paintProjectScreen } from './screenMotion'
import { orientForMesh } from './bindCanvas'

/* ============================================================
   PORTED FROM: sources/Game/World/Areas/ProjectsArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   The authored board IS the interface. `refImages` is the screen,
   `refTitle` and `refUrl` are flip-boards that turn 180° and swap
   their text at the midpoint, `refPrevious`/`refNext` are the two
   wooden signs naming the neighbours, `refPagination`'s five
   tokens count the run, and the three `refAttributes` plates
   (`role`, `at`, `with`) carry the current project's facts.

   Left alone, the board runs an attract cycle. Interact and the
   camera takes upstream's cinematic pose, the car is parked, and
   the input filter swaps so the same keys step through projects.
   Nothing opens over the world.

   Upstream shows a KTX2 screenshot per project. This portfolio
   does not have one for most of its work, so the screen draws a
   small identity per project instead — see screenMotion.ts.
   ============================================================ */

export type ProjectsState = 'closed' | 'opening' | 'open' | 'closing'

/** Upstream's camera offsets from the interactive point, unchanged. */
const CAMERA_OFFSET = new THREE.Vector3(4.65, 4, 4.85)
const TARGET_OFFSET = new THREE.Vector3(-3, 1.6, -4.6)
/** Seconds a project holds the screen while nobody is driving the board. */
const ATTRACT_HOLD = 7
const FLIP = 0.5

interface Flip {
  inner: THREE.Object3D
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  paint: (context: CanvasRenderingContext2D, project: BoardProject) => void
  progress: number
  swapped: boolean
  pending: BoardProject | null
}

export class Projects {
  state: ProjectsState = 'closed'
  index = 0
  readonly group = new THREE.Group()
  private screen: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } | null = null
  private flips: Flip[] = []
  private pagination: THREE.Object3D[] = []
  private attributes: { node: THREE.Object3D; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture; role: 'category' | 'year' | 'stack' }[] = []
  private prompt: PromptHandle | null = null
  private attract = 0
  private transition = 0
  private seen = new Set<string>()
  /** Real seconds of the last screen repaint. The canvas upload is not free. */
  private paintedAt = -1

  constructor(private game: World2Game, private references: References, bin: Bin) {
    this.group.name = 'World2 / projects'
    this.buildScreen()
    this.buildFlips()
    this.buildSigns()
    this.buildPagination()
    this.buildAttributes()
    this.hideForeignBadges()
    this.select(0, true)

    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 11)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      this.screen?.texture.dispose()
      for (const flip of this.flips) flip.texture.dispose()
      for (const attribute of this.attributes) attribute.texture.dispose()
    })
    bin.object3D(this.group)
  }

  get current(): BoardProject { return BOARD_PROJECTS[this.index] }
  get previous(): BoardProject { return BOARD_PROJECTS[(this.index - 1 + BOARD_PROJECTS.length) % BOARD_PROJECTS.length] }
  get next(): BoardProject { return BOARD_PROJECTS[(this.index + 1) % BOARD_PROJECTS.length] }

  attachPrompt(prompt: PromptHandle): void { this.prompt = prompt }

  /** Where the player stands to read this board. Drives the UV orientation. */
  private get reader(): THREE.Vector3 {
    return this.references.position('refInteractivePoint') ?? new THREE.Vector3()
  }

  /**
   * A canvas for a mesh that came out of the glTF. `orientForMesh` settles
   * the two convention clashes — see bindCanvas.ts — per mesh, because these
   * boards are not all wound the same way.
   */
  private canvasFor(mesh: THREE.Mesh, width: number, height: number): { canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    orientForMesh(texture, mesh, this.reader)
    return { canvas, texture }
  }

  private buildScreen(): void {
    const node = this.references.node('refImages')
    if (!(node instanceof THREE.Mesh)) return
    const { canvas, texture } = this.canvasFor(node, 960, 540)
    node.material = new THREE.MeshStandardMaterial({
      map: texture, emissiveMap: texture, emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 0.5, roughness: 0.9, metalness: 0, side: THREE.DoubleSide,
    })
    node.visible = true
    this.screen = { mesh: node, canvas, texture }
  }

  /** The title and URL boards turn a full half-circle and swap at the midpoint. */
  private buildFlips(): void {
    const make = (holder: string, height: number, paint: Flip['paint']) => {
      const group = this.references.node(holder)
      const inner = group?.children[0]
      if (!inner) return
      const text = inner.children.find(child => String(child.userData.w2Source ?? child.name).startsWith('text'))
      if (!(text instanceof THREE.Mesh)) return
      const { canvas, texture } = this.canvasFor(text, 1024, height)
      text.material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
      this.flips.push({ inner, canvas, texture, paint, progress: 1, swapped: true, pending: null })
    }
    make('refTitle', 256, (context, project) => {
      const { width, height } = context.canvas
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#f4f1e8'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      let size = 120
      do { context.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`; size -= 6 }
      while (context.measureText(project.title).width > width - 60 && size > 40)
      context.fillText(project.title, width / 2, height / 2)
    })
    make('refUrl', 128, (context, project) => {
      const { width, height } = context.canvas
      context.clearRect(0, 0, width, height)
      context.fillStyle = project.link ? '#32ffc1' : '#8f8aa0'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.font = '600 58px ui-monospace, SFMono-Regular, monospace'
      const label = project.link ? project.link.replace(/^https?:\/\//, '').replace(/\/$/, '') : 'Private source'
      let text = label
      while (context.measureText(text).width > width - 60 && text.length > 6) text = `${text.slice(0, -4)}…`
      context.fillText(text, width / 2, height / 2)
    })
  }

  /** The two wooden signs name the neighbours, and pick them when you hit them. */
  private buildSigns(): void {
    for (const [name, which] of [['refPrevious', 'previous'], ['refNext', 'next']] as const) {
      const group = this.references.node(name)
      const inner = group?.children[0]
      const text = inner?.children.find(child => String(child.userData.w2Source ?? child.name).startsWith('text'))
      if (!(text instanceof THREE.Mesh)) continue
      const { canvas, texture } = this.canvasFor(text, 512, 320)
      text.material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
      this.flips.push({
        inner: text, canvas, texture, progress: 1, swapped: true, pending: null,
        paint: (context, _project) => {
          const project = which === 'previous' ? this.previous : this.next
          const { width, height } = context.canvas
          context.clearRect(0, 0, width, height)
          context.textAlign = 'center'
          context.fillStyle = '#8f8aa0'
          context.font = '700 40px ui-sans-serif, system-ui, sans-serif'
          context.fillText(which === 'previous' ? '◀ PREVIOUS' : 'NEXT ▶', width / 2, 76)
          context.fillStyle = '#f4f1e8'
          let size = 62
          do { context.font = `700 ${size}px ui-sans-serif, system-ui, sans-serif`; size -= 4 }
          while (context.measureText(project.short).width > width - 40 && size > 24)
          for (const [i, line] of this.wrap(context, project.short, width - 40).entries())
            context.fillText(line, width / 2, 168 + i * (size + 14))
        },
      })
      // The sign is also a physical switch: knock it and the board follows.
      const position = group?.getWorldPosition(new THREE.Vector3())
      if (position) {
        this.signs.push({ which, position, hit: false })
      }
    }
  }

  private readonly signs: { which: 'previous' | 'next'; position: THREE.Vector3; hit: boolean }[] = []

  private wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
    const words = text.split(' ')
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (context.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word }
      else line = candidate
    }
    if (line) lines.push(line)
    return lines.slice(0, 2)
  }

  private buildPagination(): void {
    const group = this.references.node('refPagination')?.children[0]
    if (!group) return
    this.pagination = group.children.filter(child => child instanceof THREE.Mesh)
  }

  /** The three authored plates: upstream's role / at / with, our facts. */
  private buildAttributes(): void {
    const holder = this.references.node('refAttributes')
    if (!holder) return
    const roles = ['category', 'year', 'stack'] as const
    holder.children.forEach((child, index) => {
      const text = child.children.find(node => String(node.userData.w2Source ?? node.name).startsWith('text'))
      if (!(text instanceof THREE.Mesh)) return
      const { canvas, texture } = this.canvasFor(text, 512, 160)
      text.material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide })
      this.attributes.push({ node: text, canvas, texture, role: roles[Math.min(index, 2)] })
    })
  }

  /**
   * The `distinctions` shelf carries three award logos that belong to someone
   * else's career. They are hidden rather than relabelled: a badge is a claim.
   */
  private hideForeignBadges(): void {
    for (const name of ['awwwards', 'fwa', 'cssda']) {
      const node = this.references.node(name)
      if (node) node.visible = false
    }
  }

  select(index: number, silent = false): void {
    const count = BOARD_PROJECTS.length
    this.index = ((index % count) + count) % count
    this.attract = 0
    for (const flip of this.flips) { flip.progress = 0; flip.swapped = false; flip.pending = this.current }
    this.paintAttributes()
    this.paintPagination()
    this.seen.add(this.current.id)
    this.game.interactions?.achievements.mark('projects', this.current.id)
    if (!silent) this.game.audio.play('blip', 1.3)
    this.game.publishGameplay()
  }

  step(direction: 1 | -1): void { this.select(this.index + direction) }

  private paintAttributes(): void {
    for (const attribute of this.attributes) {
      const context = attribute.canvas.getContext('2d')
      if (!context) continue
      const { width, height } = attribute.canvas
      context.clearRect(0, 0, width, height)
      context.textAlign = 'left'
      context.fillStyle = '#8f8aa0'
      context.font = '700 30px ui-sans-serif, system-ui, sans-serif'
      const label = attribute.role === 'category' ? 'CATEGORY' : attribute.role === 'year' ? 'YEAR' : 'STACK'
      context.fillText(label, 18, 44)
      context.fillStyle = '#f4f1e8'
      const value = attribute.role === 'category' ? this.current.category
        : attribute.role === 'year' ? this.current.year
          : this.current.technologies.slice(0, 3).join(' · ')
      let size = 52
      do { context.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`; size -= 3 }
      while (context.measureText(value).width > width - 36 && size > 20)
      context.fillText(value, 18, 112)
      attribute.texture.needsUpdate = true
    }
  }

  private paintPagination(): void {
    this.pagination.forEach((token, i) => {
      const total = Math.min(this.pagination.length, BOARD_PROJECTS.length)
      const window = Math.floor(this.index / total) * total
      const active = this.index - window === i
      token.visible = i < total
      token.scale.setScalar(active ? 1 : 0.45)
    })
  }

  open(): void {
    if (this.state === 'open' || this.state === 'opening') return
    const point = this.references.position('refInteractivePoint')
    if (!point) return
    this.state = 'opening'
    this.transition = 1.5
    const flat = point.clone(); flat.y = 0
    this.game.view.startCinematic(flat.clone().add(CAMERA_OFFSET), flat.clone().add(TARGET_OFFSET))
    this.game.player.setState('locked')
    this.game.inputs.setFilters(['minigame'])
    this.game.interactions.prompts.setSuspended(true)
    this.game.audio.play('interact')
    this.game.publishGameplay()
  }

  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return
    this.state = 'closing'
    this.transition = 1
    this.game.view.endCinematic()
    this.game.player.setState('default')
    this.game.inputs.setFilters(['driving', 'camera'])
    this.game.interactions.prompts.setSuspended(false)
    this.prompt?.show()
    this.game.publishGameplay()
  }

  /** Opens the project's own page, when it has one. */
  openLink(): void {
    const link = this.current.link
    if (!link) return
    window.open(link, '_blank', 'noopener,noreferrer')
  }

  private update(): void {
    const delta = this.game.ticker.delta * this.game.ticker.scale
    const time = this.game.ticker.elapsed

    if (this.transition > 0) {
      this.transition -= delta
      if (this.transition <= 0) this.state = this.state === 'opening' ? 'open' : 'closed'
    }

    // The screen only redraws when it can be seen, and never faster than
    // 12 Hz. Re-uploading a canvas as a texture is the one genuinely
    // expensive thing this layer does; the drawn animations do not need
    // more, and a board nobody is near needs none at all.
    if (this.screen && time - this.paintedAt > 0.083 && (this.state !== 'closed' || this.nearby())) {
      this.paintedAt = time
      const context = this.screen.canvas.getContext('2d')
      if (context) {
        paintProjectScreen(context, this.screen.canvas.width, this.screen.canvas.height, this.current, time)
        this.screen.texture.needsUpdate = true
      }
    }

    for (const flip of this.flips) {
      if (flip.progress >= 1) continue
      flip.progress = Math.min(1, flip.progress + delta / (FLIP * 2))
      flip.inner.rotation.y = flip.progress * Math.PI * 2
      if (!flip.swapped && flip.progress >= 0.5) {
        flip.swapped = true
        const context = flip.canvas.getContext('2d')
        if (context) { flip.paint(context, this.current); flip.texture.needsUpdate = true }
      }
    }

    // Attract: with nobody at the board, it cycles the run on its own.
    if (this.state === 'closed') {
      this.attract += delta
      if (this.attract > ATTRACT_HOLD) {
        // Unattended, the board stays on the work worth stopping for; the
        // archive is reachable by stepping through it by hand.
        const featured = Math.max(1, BOARD_FEATURED_COUNT)
        this.select(this.index < featured ? (this.index + 1) % featured : 0, true)
      }
    }

    // Driving into a wooden sign selects its project — the physical switch.
    if (this.state === 'closed') {
      const player = this.game.player.position
      for (const sign of this.signs) {
        if (player.distanceTo(sign.position) > 2.2) { sign.hit = false; continue }
        if (sign.hit) continue
        sign.hit = true
        this.step(sign.which === 'next' ? 1 : -1)
      }
    }
  }

  private nearby(): boolean {
    const point = this.references.position('refInteractivePoint')
    return !point || this.game.player.position.distanceTo(point) < 26
  }

  hud(): { activity: string | null; headline: string | null; lines: string[] } {
    if (this.state === 'closed') return { activity: null, headline: null, lines: [] }
    return {
      activity: 'projects',
      headline: null,
      lines: [`${this.index + 1} / ${BOARD_PROJECTS.length}`, this.current.title, this.current.link ? 'Open to visit' : 'Private source'],
    }
  }
}
