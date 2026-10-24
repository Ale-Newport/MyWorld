import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import type { PromptHandle } from './Prompts'
import { BOARD_FEATURED_COUNT, type BoardProject } from '../content/projects'
import { resolveBoard } from '../content/boards'
import {
  EMBLEM_RECT, FACE_H, FACE_W, LINK_PLANE, emblemKindFor, paintAttribute, paintLinkStrip, paintNeighbour, paintProjectEmblem, paintProjectFace, paintTitlePlate, prefitSteps,
  type FaceMetrics, type PrefitSizes,
} from './screenMotion'
import {
  BOARD_BACK, EMBLEM_SIZE, Facets, SIGN_DESIGN, SWATCH, TOKENS, Sign, SignRuntime, addBox, addTube, bindLayer, bracketGeometry, charmGeometry, clearFocusPose, collectOccluders, faceFrame, hashSeed,
  mergeParts, nailGeometry, measuringContext, onSignFontsLoaded, place, planeSize, ropeGeometry, signFontsLoaded, signMaterials, swatchOf, themeForProject, recolorPalette, vineGeometry,
  type CharmKind, type FaceFrame, type FitResult, type HardwareKind, type MergePart, type Occluder, type SignLayer, type SignMaterials, type Vec3,
} from '../signs'

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

   Left alone, the board runs an attract cycle — but only while the
   car is within sight of it, and attract never counts as a visit.
   Interact and the camera takes upstream's cinematic pose (moved to the
   nearest pose that can SEE the screen when something, a pine, stands in
   its way: clearTheView), the car is parked, and the input filter swaps so
   the same keys step through projects. A small bar (focus-ui.js) is the same way out for a
   mouse, a finger and a pad: Back, previous, next, the project's page; Escape
   and Backspace still leave, and the camera and the input filters are given
   back exactly as they were. Nothing opens over the world.

   Upstream shows a KTX2 screenshot per project. This portfolio
   does not have one for most of its work, so the board carries a
   small painted picture per project instead. The whole board is
   "Island timber" (src/world2/signs): its cold violet and pink
   swatches are moved onto the island's own timber and iron, the
   faces are parchment and timber lettered in Geist, and a single
   scheduler decides what repaints so a board nobody is looking at
   costs nothing.
   ============================================================ */

export type ProjectsState = 'closed' | 'opening' | 'open' | 'closing'

/** Upstream's camera offsets from the interactive point, unchanged. */
const CAMERA_OFFSET = new THREE.Vector3(4.65, 4, 4.85)
const TARGET_OFFSET = new THREE.Vector3(-3, 1.6, -4.6)
/** From the target toward the camera: the line upstream's pose sits on, which a narrow window slides along. */
const CAMERA_DIRECTION = CAMERA_OFFSET.clone().sub(TARGET_OFFSET).normalize()
/** Seconds a project holds the screen while nobody is driving the board. */
const ATTRACT_HOLD = 7
const FLIP = 0.5
/** How close (authored units) the car has to be for the board to run its attract cycle. */
const NEAR = 26
const Y_AXIS = new THREE.Vector3(0, 1, 0)
/**
 * The wooden neighbour signs switch the project when the car's centre is within this many board units of the sign's footprint
 * (its bounding box seen from above). Measured, not guessed: steering a car at each sign from twelve sides, the closest it
 * gets is 1.1 (previous) and 1.9 (next) from that footprint, 2.5 from the sign's origin. The sign hangs 1.9 to 3.6 above
 * the ground; neither the old test (3-D distance 2.2 to the origin, 2.7 even from beneath) nor a 2-unit ring around the
 * origin is ever met by a car on the ground. scripts/qa/world-focus-exit.mjs --suite=hit repeats the drives.
 */
const HIT_REACH = 2.5
/** ...and the car's centre is within this far below the sign's underside (a car on the ground) and above its top (a hop). */
const HIT_BELOW_BOTTOM = 3
const HIT_ABOVE_TOP = 1

interface SignBox { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } }

/** Whether a car at `player` is inside the zone that knocks a neighbour sign whose bounds are `box` (authored units, both in the board's frame). */
export function inSwitchZone(player: { x: number; y: number; z: number }, box: SignBox): boolean {
  const across = Math.hypot(Math.max(box.min.x - player.x, 0, player.x - box.max.x), Math.max(box.min.z - player.z, 0, player.z - box.max.z))
  return across <= HIT_REACH && player.y >= box.min.y - HIT_BELOW_BOTTOM && player.y <= box.max.y + HIT_ABOVE_TOP
}

/**
 * What the focus bar (public/archipelago/preview/focus-ui.js) is told while the board is focused: the way out of it for a
 * mouse, a finger and a pad. The /world player passes it as `game.focus`; /world2 has its own Exit button and passes none,
 * so every use below is optional.
 */
export interface FocusSpec {
  id: string
  index: number
  total: number
  title: string
  canOpen: boolean
  onExit(): void
  onPrev(): void
  onNext(): void
  onOpen(): void
}
export interface FocusUi {
  warm?(): void
  show(spec: FocusSpec): void
  update(spec: Partial<FocusSpec>): void
  hide(): void
}
/** The few View fields the framing reads. `viewport` is private on /world2's View, so they are read through this shape. `cinematic` is the pose the View
 * took over (world coordinates, its own pull-back included); a stand-in view (a thumbnail's) has none and nothing is looked at. */
interface ViewLike {
  viewport?: { ratio: number }
  camera?: { fov?: number }
  focusPoint?: { isTracking: boolean }
  cinematic?: { position: THREE.Vector3; target: THREE.Vector3 }
}

/**
 * Where on the screen the focus camera must be able to see: its middle, the middle of each edge, the corners a little inside, and a ring a
 * little outside the corners (canvas fractions). The inner points are the screen itself, the outer ring is what a tree an arm's length
 * from the board's edge would hide first.
 */
const SEEN: ReadonlyArray<readonly [number, number]> = [
  [0.5, 0.5], [0.08, 0.5], [0.92, 0.5], [0.5, 0.08], [0.5, 0.92], [0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92],
  [-0.06, -0.06], [1.06, -0.06], [-0.06, 1.06], [1.06, 1.06],
]

/**
 * How wide a slice of the board's own plane (authored units) the focus camera sees at its target. A wide window frames the
 * whole board with its neighbour signs (VISIBLE_BOARD, what the model's first camera did: about 9.8 across at any ratio);
 * a narrow one cannot read the screen at that size (on a phone in portrait it ended up 150 px wide), so it frames the 4-unit
 * screen and a margin (VISIBLE_SCREEN) instead, and the neighbour signs fall out of the picture. In between it blends.
 */
const VISIBLE_SCREEN = 4.8
const VISIBLE_BOARD = 9.8
const NARROW = 0.8
const WIDE = 1.35

/**
 * The focus camera for a viewport `ratio` (width / height): how far (authored units) it stands from the target so that
 * the screen (or the board) fits across the window, and how much of the way (0..1) the target moves from the middle of the whole
 * board to the middle of the screen. Null when the whole-board framing applies unchanged (the View's own pull-back included).
 */
export function focusFraming(ratio: number, fov = 25): { distance: number; centred: number } | null {
  if (!(ratio > 0) || ratio >= WIDE) return null
  const t = Math.min(1, Math.max(0, (ratio - NARROW) / (WIDE - NARROW)))
  const blend = t * t * (3 - 2 * t)
  const width = VISIBLE_SCREEN + (VISIBLE_BOARD - VISIBLE_SCREEN) * blend
  return { distance: width / (2 * Math.tan((fov * Math.PI) / 360) * ratio), centred: 1 - blend }
}

interface Flip {
  /** What turns: the plate's own group (title, URL) or a pivot over the text plane (the neighbour signs). */
  inner: THREE.Object3D
  /** The authored orientation of `inner`, which the turn is relative to and which it returns to exactly. */
  base: THREE.Quaternion
  mode: 'turn' | 'card'
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  layer: SignLayer
  paint: (context: CanvasRenderingContext2D, project: BoardProject) => void
  /** -delay..1. Plates start one after another so their repaints land in different frames. */
  progress: number
  delay: number
  swapped: boolean
  pending: BoardProject | null
}

interface Attribute {
  node: THREE.Object3D
  canvas: HTMLCanvasElement
  texture: THREE.CanvasTexture
  layer: SignLayer
  role: 'category' | 'year' | 'stack'
}

export class Projects {
  private items: BoardProject[]
  state: ProjectsState = 'closed'
  index = 0
  readonly group = new THREE.Group()
  private screen: { mesh: THREE.Mesh; canvas: HTMLCanvasElement; texture: THREE.CanvasTexture } | null = null
  private flips: Flip[] = []
  private pagination: THREE.Mesh[] = []
  private attributes: Attribute[] = []
  private prompt: PromptHandle | null = null
  private attract = 0
  private transition = 0
  private seen = new Set<string>()
  private readonly materials: SignMaterials
  private readonly runtime: SignRuntime
  /** Owns every layer of the board; the scheduler paints them. */
  private readonly sign: Sign
  private face: SignLayer | null = null
  private emblem: SignLayer | null = null
  private emblemMesh: THREE.Mesh | null = null
  private frame: FaceFrame | null = null
  private charm: THREE.Group | null = null
  private readonly woods = new Map<HardwareKind, THREE.Mesh>()
  private readonly charms = new Map<CharmKind, THREE.Mesh>()
  private woodNow: THREE.Mesh | null = null
  private charmNow: THREE.Mesh | null = null
  private readonly readerPoint: THREE.Vector3
  /** Cached: the board is near the car. Refreshed a few times a second, not every frame. */
  private near = false
  private nearAt = -1
  private focused = false
  /** The plates are turning: the sheet behind them is held until the first one swaps. */
  private swapping = false
  /** What open() found and close() puts back: the input filters exactly as they were, so a mode that had its own survives. */
  private saved: Parameters<World2Game['inputs']['setFilters']>[0] | null = null
  /** Where and for which window shape the focus camera was framed, to frame it again when the window turns. */
  private framed: { flat: THREE.Vector3; ratio: number } | null = null
  private warmed = false
  /** The lettering of the projects the board can show next, fitted one small step a frame while it is idle (see prefit). */
  private prefitQueue: Array<(context: CanvasRenderingContext2D) => void> = []
  private prefitFor = -1
  private prefitContext: CanvasRenderingContext2D | null = null
  /** The middle of the screen in the board's frame, taken while the frame is still at the origin (as the signs' positions are). */
  private faceCentre: THREE.Vector3 | null = null
  /** The points of the screen the focus camera has to see (SEEN), in the same frame. */
  private faceSamples: THREE.Vector3[] = []
  /** What could stand between the focus camera and the screen, gathered the first time the board is focused and let go when it closes. */
  private occluders: Occluder[] | null = null
  /** The player's car, parked in front of the board while it is read: it can cover the screen too, and is gathered with the occluders. */
  private vehicle: Occluder[] | null = null

  constructor(private game: World2Game, private references: References, bin: Bin) {
    this.items = resolveBoard(game.worldBoards, 'projects')
    this.group.name = 'World2 / projects'
    this.group.userData.signDesign = SIGN_DESIGN
    this.readerPoint = references.position('refInteractivePoint') ?? new THREE.Vector3()
    this.materials = signMaterials(references.environment.group)
    this.runtime = new SignRuntime({ ticker: game.ticker as never, camera: () => (game.view as { camera?: THREE.Camera } | undefined)?.camera }, bin)
    this.sign = new Sign({ id: 'projects', variant: 'custom', width: 4, height: 2.25, materials: this.materials, runtime: this.runtime })
    this.recolour()
    this.buildScreen()
    this.buildFlips()
    this.buildSigns()
    this.buildPagination()
    this.buildAttributes()
    this.hideDecals()
    this.hideForeignBadges()
    this.buildHardware()
    this.select(0, true)
    this.reveal()

    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 11)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      // Disposed while focused (the drive ended, the route went): the bar must not outlive the board.
      this.focusUi?.hide()
      this.runtime.focus(null)
      this.sign.dispose()
      for (const mesh of [...this.woods.values(), ...this.charms.values()]) { mesh.geometry.dispose(); mesh.removeFromParent() }
      this.materials.dispose()
    })
    bin.object3D(this.group)
  }

  get current(): BoardProject { return this.items[this.index] }
  get previous(): BoardProject { return this.items[(this.index - 1 + this.items.length) % this.items.length] }
  get next(): BoardProject { return this.items[(this.index + 1) % this.items.length] }

  attachPrompt(prompt: PromptHandle): void { this.prompt = prompt }

  /** The focus bar, when the page has one (the /world player does; /world2 and the studio's thumbnails do not). */
  private get focusUi(): FocusUi | undefined { return (this.game as unknown as { focus?: FocusUi }).focus }

  private focusSpec(): FocusSpec {
    return {
      id: 'projects',
      index: this.index,
      total: this.items.length,
      title: this.current.title,
      canOpen: !!this.current.link,
      onExit: () => this.close(),
      onPrev: () => this.step(-1),
      onNext: () => this.step(1),
      onOpen: () => this.openLink(),
    }
  }

  /** Where the player stands to read this board. Drives the UV orientation. */
  private get reader(): THREE.Vector3 { return this.readerPoint }

  /**
   * The island's own timber and iron where the model shipped cold violet and pink. Authored palette meshes sample one
   * swatch per vertex, so recolouring is moving their u coordinates; the geometry is private to this instance. These
   * nodes are looked up WITHOUT marking them as gameplay-owned, so scenery batching still merges the frame.
   */
  private recolour(): void {
    const nodes = this.references.environment.nodes
    const recolor = (name: string, map: Record<number, number>) => { const node = nodes.get(name); if (node instanceof THREE.Mesh) recolorPalette(node, map) }
    // The frame's back panel (its one copper quad) is what the camera sees orbited behind the board: the kit's board back, like every other board.
    recolor('Cube.065', { [SWATCH.grey]: SWATCH.woodDark, [SWATCH.pink]: SWATCH.woodDark, [SWATCH.copper]: BOARD_BACK })
    // The title plate's block: its edges and back read as shaded timber, so a mid tone keeps them from turning black from behind.
    recolor('Cube.080', { [SWATCH.copper]: SWATCH.tan })
    recolor('panel', { [SWATCH.purple]: SWATCH.woodDark })
    for (const name of ['Cube.077', 'cube.023']) recolor(name, { [SWATCH.grey]: SWATCH.woodDark, [SWATCH.purple]: SWATCH.gold })
    for (const name of ['refArrowNextProject', 'refArrowPreviousProject']) recolor(name, { [SWATCH.paleRose]: SWATCH.ink })
    recolor('medal', { [SWATCH.purple]: SWATCH.orange, [SWATCH.pink]: SWATCH.crimson })
  }

  /** A square-ish canvas for an authored plane, sized to its own aspect so glyphs are never stretched. */
  private layerFor(mesh: THREE.Mesh, name: string, longSide: number, paint: (context: CanvasRenderingContext2D, width: number, height: number) => void, priority = 0, base?: string): SignLayer {
    const { width, height } = planeSize(mesh)
    return this.sign.addLayer({ name, width: longSide, height: Math.max(8, Math.round(longSide * (height / width))), paint, priority, base })
  }

  private buildScreen(): void {
    const node = this.references.node('refImages')
    if (!(node instanceof THREE.Mesh)) return
    const layer = this.layerFor(node, 'face', FACE_W, (context, width, height) => {
      this.metrics.face = paintProjectFace(context, width, height, this.current, { ready: () => layer.invalidate(), index: this.index, total: this.items.length })
    }, 10, TOKENS.paper)
    bindLayer(layer, node, this.materials, this.reader)
    this.face = layer
    this.screen = { mesh: node, canvas: layer.canvas, texture: layer.texture }
    const frame = this.frame = faceFrame(node, layer.texture)
    // The picture's mat is part of the face; the emblem is its own small canvas laid over it.
    const unit = frame.width / FACE_W
    const side = EMBLEM_RECT.size * unit
    const emblem = this.sign.addLayer({
      name: 'emblem', width: EMBLEM_SIZE, height: EMBLEM_SIZE, live: true, base: TOKENS.woodDark,
      paint: (context, width, _height, time) => paintProjectEmblem(context, width, this.current, time),
    })
    this.emblem = emblem
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(side, side), this.materials.face(emblem.texture))
    quad.name = 'sign:projects:emblem'
    // Same flags as the sheet it lies on, so it shares the sheet's shader program instead of compiling a variant of its own.
    quad.receiveShadow = true
    quad.position.set((EMBLEM_RECT.x + EMBLEM_RECT.size / 2 - FACE_W / 2) * unit, (FACE_H / 2 - (EMBLEM_RECT.y + EMBLEM_RECT.size / 2)) * unit, 0.012)
    frame.root.add(quad)
    this.emblemMesh = quad
    this.sign.setBounds(node, new THREE.Vector3().setFromMatrixPosition(frame.matrix), 4.6)
    node.updateWorldMatrix(true, false)
    this.faceCentre = new THREE.Vector3().setFromMatrixPosition(frame.matrix).applyMatrix4(node.matrixWorld)
    this.faceSamples = SEEN.map(([a, b]) => frame.toFace(a, b).applyMatrix4(frame.matrix).applyMatrix4(node.matrixWorld))
  }

  /**
   * The title and URL boards turn a full half-circle and swap at the midpoint, relative to the pose the model gave
   * them. The URL chip is scaled to its text, so a short address is not a wide empty strip.
   */
  private buildFlips(): void {
    type Paint = (context: CanvasRenderingContext2D, width: number, height: number, chip: THREE.Object3D | null, project: BoardProject) => void
    const make = (holder: string, delay: number, paint: Paint, narrow = 1, longSide = 1024) => {
      const group = this.references.node(holder)
      const inner = group?.children[0]
      if (!inner) return
      const text = inner.children.find(child => String(child.userData.w2Source ?? child.name).startsWith('text'))
      if (!(text instanceof THREE.Mesh)) return
      const chip = inner.children.find(child => child !== text && child instanceof THREE.Mesh) ?? null
      text.scale.x *= narrow
      const layer = this.layerFor(text, holder, longSide, (context, width, height) => paint(context, width, height, chip, this.current))
      bindLayer(layer, text, this.materials, this.reader, { transparent: true })
      this.flips.push({
        inner, base: inner.quaternion.clone(), mode: 'turn', canvas: layer.canvas, texture: layer.texture, layer,
        paint: (context, project) => { context.clearRect(0, 0, layer.canvas.width, layer.canvas.height); paint(context, layer.canvas.width, layer.canvas.height, chip, project) },
        progress: 1, delay, swapped: true, pending: null,
      })
    }
    make('refTitle', 0, (context, width, height, _chip, project) => { this.metrics.title = paintTitlePlate(context, width, height, project) })
    // The URL plane is authored 4 wide for a strip that was never that wide; LINK_PLANE (2.2 m) holds a repository link at a size
    // worth reading, and the canvas is made longer so its letters keep the resolution they had at 1.6 m.
    make('refUrl', 0.07, (context, width, height, chip, project) => {
      const textWidth = paintLinkStrip(context, width, height, project)
      // The timber chip behind the lettering is authored 1 wide; fit it to the text on the plane.
      if (chip) chip.scale.x = Math.max(0.35, (textWidth / width) * LINK_PLANE + 0.2)
    }, LINK_PLANE / 4, Math.round(1024 * LINK_PLANE / 1.6))
  }

  /** The two wooden signs name the neighbours, and pick them when you hit them. */
  private buildSigns(): void {
    for (const [name, which] of [['refPrevious', 'previous'], ['refNext', 'next']] as const) {
      const group = this.references.node(name)
      const inner = group?.children[0]
      const text = inner?.children.find(child => String(child.userData.w2Source ?? child.name).startsWith('text'))
      if (!inner || !(text instanceof THREE.Mesh)) continue
      const layer = this.layerFor(text, name, 512, (context, width, height) => paintNeighbour(context, width, height, which, which === 'previous' ? this.previous : this.next))
      bindLayer(layer, text, this.materials, this.reader, { transparent: true })
      // The text plane carries its own odd authored rotation; turning IT about its Y spun the label in its own plane.
      // Turn a pivot instead, whose Y is the board's vertical.
      const pivot = new THREE.Group()
      pivot.name = `${text.name}:pivot`
      pivot.position.copy(text.position)
      text.position.set(0, 0, 0)
      inner.add(pivot)
      pivot.add(text)
      this.flips.push({
        inner: pivot, base: pivot.quaternion.clone(), mode: 'card', canvas: layer.canvas, texture: layer.texture, layer,
        paint: (context, _project) => {
          context.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
          paintNeighbour(context, layer.canvas.width, layer.canvas.height, which, which === 'previous' ? this.previous : this.next)
        },
        progress: 1, delay: which === 'previous' ? 0.14 : 0.21, swapped: true, pending: null,
      })
      // The sign is also a physical switch: knock it and the board follows.
      const position = group?.getWorldPosition(new THREE.Vector3())
      if (group && position) {
        group.updateWorldMatrix(true, true)
        this.signs.push({ which, position, box: new THREE.Box3().setFromObject(group), hit: false })
      }
    }
  }

  /** What the last paint of the face and the title plate had to do (font size, lines, whether text was cut). Read by QA. */
  readonly metrics: { face?: FaceMetrics; title?: FitResult } = {}

  private readonly signs: { which: 'previous' | 'next'; position: THREE.Vector3; box: THREE.Box3; hit: boolean }[] = []

  private buildPagination(): void {
    const group = this.references.node('refPagination')?.children[0]
    if (!group) return
    this.pagination = group.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
  }

  /** The three authored plates: upstream's role / at / with, our facts. */
  private buildAttributes(): void {
    const holder = this.references.node('refAttributes')
    if (!holder) return
    const roles = ['category', 'year', 'stack'] as const
    holder.children.forEach((child, index) => {
      const text = child.children.find(node => String(node.userData.w2Source ?? node.name).startsWith('text'))
      if (!(text instanceof THREE.Mesh)) return
      const role = roles[Math.min(index, 2)]
      const layer = this.layerFor(text, `attribute:${role}`, 512, (context, width, height) => paintAttribute(context, width, height, role, this.current))
      bindLayer(layer, text, this.materials, this.reader, { transparent: true })
      this.attributes.push({ node: text, canvas: layer.canvas, texture: layer.texture, layer, role })
    })
  }

  /**
   * The model prints "ROLE", "AT" and "WITH" on the attribute plaques and "DISTINCTIONS" over an empty shelf: other
   * vocabularies for facts this board words its own way. Hidden for good, so the validation panel cannot bring them back.
   */
  private hideDecals(): void {
    for (const name of ['refel', 'refel.001', 'refel.002', 'refel.003']) this.references.suppress(name)
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

  /**
   * Hand-made hardware, in face space (units of the authored board: 4 across, 2.25 up, +Z toward the reader). Each project's
   * theme asks for its own: nails and braces on every board, plus the theme's ivy, rope loops or chain, and the charm that
   * hangs from the bottom rail and swings while the board is in sight. Every kind is ONE merged mesh sampling the level's
   * palette material (a few hundred triangles) and is built hidden, ahead of the project that needs it while the board is idle
   * (see prefit) or, failing that, the first time it is shown; only the current theme's is shown, so the board is still two draw calls.
   */
  private buildHardware(): void {
    const frame = this.frame
    if (!frame) return
    // The charm's pivot is the board's: one rope-and-trinket per kind hangs from it, one visible at a time.
    const pivot = new THREE.Group()
    pivot.name = 'sign:projects:charm'
    pivot.position.set(1.5, -1.34, 0.13)
    frame.root.add(pivot)
    this.charm = pivot
    this.sign.animate = time => { pivot.rotation.z = Math.sin(time * 1.35) * 0.09 }
  }

  private woodFor(kind: HardwareKind): THREE.Mesh | null {
    const frame = this.frame
    if (!frame) return null
    const known = this.woods.get(kind)
    if (known) return known
    const parts: MergePart[] = []
    const nail = nailGeometry({ radius: 0.034, height: 0.03 })
    for (let i = 0; i < 7; i++) parts.push(place(nail, [-1.8 + i * 0.6, 2.04, 0.036]))
    for (const x of [-1.62, -1.2, 1.2, 1.62]) parts.push(place(nail, [x, 1.22, 0.036]))
    for (const s of [-1, 1]) for (const y of [-0.9, -0.3, 0.3, 0.9]) parts.push(place(nail, [s * 2.14, y, 0.082]))
    const brace = bracketGeometry({ arm: 0.3, thickness: 0.055, depth: 0.04 })
    parts.push(place(brace, [-1.96, -1.1, 0.13], [0, 0, 0]), place(brace, [1.96, -1.1, 0.13], [0, 0, Math.PI / 2]))
    if (kind === 'vine') {
      const path: Vec3[] = []
      for (let i = 0; i <= 12; i++) path.push([-2.43 + Math.sin(i * 1.1) * 0.05, -1.7 + (i / 12) * 3.55, 0.04 + Math.cos(i * 0.8) * 0.03])
      parts.push(place(vineGeometry(path, { radius: 0.02, leaves: 12, leafSize: 0.2, seed: hashSeed('projects') })))
    } else if (kind === 'rope' || kind === 'chain') {
      const chain = kind === 'chain'
      const peg = new Facets()
      addBox(peg, [0, 0, 0.04], [0.04, 0.04, 0.05], SWATCH.woodDark, 0.01)
      parts.push(place(peg.geometry(), [2.14, 1.0, 0.1]))
      const loops = new Facets()
      for (let i = 0; i < (chain ? 5 : 3); i++) {
        const ring: Vec3[] = []
        const radius = chain ? 0.085 : 0.15
        for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2; ring.push([Math.cos(a) * radius * (chain && i % 2 ? 0.45 : 1), Math.sin(a) * radius - (chain ? i * 0.15 : i * 0.05) - radius, chain ? 0 : i * 0.035]) }
        addTube(loops, ring, chain ? 0.022 : 0.026, chain ? SWATCH.silver : SWATCH.khaki, 4, true)
      }
      parts.push(place(loops.geometry(), [2.14, 1.0, 0.16]))
    }
    const mesh = new THREE.Mesh(mergeParts(parts), this.materials.wood)
    mesh.name = `sign:projects:wood:${kind}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = false
    frame.root.add(mesh)
    this.woods.set(kind, mesh)
    return mesh
  }

  private charmFor(kind: CharmKind): THREE.Mesh | null {
    if (!this.charm) return null
    const known = this.charms.get(kind)
    if (known) return known
    const hung = mergeParts([ropeGeometry([0, 0, 0], [0, -0.16, 0], { sag: 0, sides: 4, segments: 2 }), place(charmGeometry(kind, 0.34), [0, -0.16, 0])])
    const mesh = new THREE.Mesh(hung, this.materials.wood)
    mesh.name = `sign:projects:charm:${kind}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.visible = false
    this.charm.add(mesh)
    this.charms.set(kind, mesh)
    return mesh
  }

  /** Dresses the board for the current project: its theme's ivy, rope or chain, and its charm. Runs when the sheet swaps. */
  private skin(): void {
    if (!this.frame) return
    const theme = themeForProject(this.current)
    const wood = this.woodFor(theme.hardware)
    const charm = theme.charm === 'none' ? null : this.charmFor(theme.charm)
    if (this.woodNow !== wood) { if (this.woodNow) this.woodNow.visible = false; if (wood) wood.visible = true; this.woodNow = wood }
    if (this.charmNow !== charm) { if (this.charmNow) this.charmNow.visible = false; if (charm) charm.visible = true; this.charmNow = charm }
  }

  select(index: number, silent = false): void {
    const count = this.items.length
    this.index = ((index % count) + count) % count
    this.attract = 0
    for (const flip of this.flips) { flip.progress = -flip.delay; flip.swapped = false; flip.pending = this.current; flip.layer.hold = true }
    // The sheet and the facts change when the plates turn over, not a quarter second before them.
    this.swapping = this.flips.length > 0
    this.paintPagination()
    if (this.swapping) {
      if (this.face) this.face.hold = true
      for (const attribute of this.attributes) attribute.layer.hold = true
      if (this.emblem) this.emblem.hold = true
    } else this.swapContent()
    this.seen.add(this.current.id)
    if (this.state === 'opening' || this.state === 'open') this.focusUi?.update(this.focusSpec())
    // Attract and construction pass silent: a board nobody visited has not been visited.
    if (!silent) {
      this.game.interactions?.achievements.mark('projects', this.current.id)
      this.game.audio.play('blip', 1.3)
    }
    this.game.publishGameplay()
  }

  step(direction: 1 | -1): void { this.select(this.index + direction) }

  /** The first frame is already in place: no flip on load. */
  private reveal(): void {
    for (const flip of this.flips) {
      flip.progress = 1; flip.swapped = true; flip.pending = null; flip.layer.hold = false; flip.layer.invalidate()
      flip.inner.quaternion.copy(flip.base)
    }
    this.swapContent()
  }

  /** Lets the sheet, the fact plaques and the picture show the current project: they repaint on the scheduler's next frames. */
  private swapContent(): void {
    this.swapping = false
    if (this.face) { this.face.hold = false; this.face.invalidate() }
    for (const attribute of this.attributes) { attribute.layer.hold = false; attribute.layer.invalidate() }
    this.refreshEmblem()
    this.skin()
  }

  /** A CMS photo is a still: the picture layer stops its timer and its quad steps aside. */
  private refreshEmblem(): void {
    if (!this.emblem) return
    const still = !!this.current.image || !emblemKindFor(this.current)
    this.emblem.live = !still
    this.emblem.hold = still
    if (this.emblemMesh) this.emblemMesh.visible = !still
    if (!still) this.emblem.invalidate()
  }

  /**
   * For previews that paint once and are never ticked (studio thumbnails, the map atlas): lets go of the scheduler so no ticker
   * or document listener keeps the preview's canvases alive. The one repaint a late-loading web font would have asked for is
   * made once, here, and its subscription ends with it.
   */
  settle(): void {
    this.runtime.dispose()
    if (signFontsLoaded()) return
    const off = onSignFontsLoaded(() => { off(); this.paintNow() })
  }

  paintAttributes(): void { for (const attribute of this.attributes) attribute.layer.invalidate() }

  paintPagination(): void {
    this.pagination.forEach((token, i) => {
      const total = Math.min(this.pagination.length, this.items.length)
      const window = Math.floor(this.index / total) * total
      const active = this.index - window === i
      token.visible = i < total
      token.scale.setScalar(active ? 1 : 0.45)
      const uv = token.geometry.getAttribute('uv')
      const from = uv ? swatchOf(uv.getX(0)) : -1
      const to = active ? SWATCH.gold : SWATCH.khaki
      if (uv && from !== to) recolorPalette(token, { [from]: to })
    })
  }

  /** Paints every layer now, with every flip settled. For studio thumbnails and tests, which never run the ticker. */
  paintNow(): void {
    this.reveal()
    this.refreshEmblem()
    this.sign.paintNow()
  }

  open(): void {
    if (this.state === 'open' || this.state === 'opening') return
    const point = this.references.position('refInteractivePoint')
    if (!point) return
    this.state = 'opening'
    this.transition = 1.5
    const flat = point.clone(); flat.y = 0
    this.frameCamera(flat)
    this.game.player.setState('locked')
    // Keep the filters as they are now, whatever they are, to give back exactly: close() does not guess 'driving' and 'camera'.
    this.saved ??= [...this.game.inputs.filters]
    this.game.inputs.setFilters(['minigame'])
    this.game.interactions.prompts.setSuspended(true)
    this.focusUi?.show(this.focusSpec())
    this.game.audio.play('interact')
    this.game.publishGameplay()
  }

  close(): void {
    if (this.state === 'closed' || this.state === 'closing') return
    this.state = 'closing'
    this.transition = 1
    this.framed = null
    this.occluders = null
    this.vehicle = null
    this.game.view.endCinematic()
    // The camera follows the car again, wherever the player had panned it to before the board.
    const focusPoint = (this.game.view as unknown as ViewLike).focusPoint
    if (focusPoint) focusPoint.isTracking = true
    this.game.player.setState('default')
    this.game.inputs.setFilters(this.saved ?? ['driving', 'camera'])
    this.saved = null
    this.game.interactions.prompts.setSuspended(false)
    this.prompt?.show()
    this.focusUi?.hide()
    this.game.publishGameplay()
  }

  /**
   * Upstream's camera pose, slid along its own line so the screen is readable in this window: a wide one keeps the whole
   * board in frame (unchanged, the View's own pull-back included), a narrow or portrait one comes close enough that the
   * screen fills it. `pullBack: false` says the distance is already right for this window.
   */
  private frameCamera(flat: THREE.Vector3): void {
    const view = this.game.view as unknown as ViewLike
    const target = flat.clone().add(TARGET_OFFSET)
    const position = flat.clone().add(CAMERA_OFFSET)
    const ratio = view.viewport?.ratio ?? 0
    this.framed = { flat: flat.clone(), ratio }
    const framing = ratio > 0 ? focusFraming(ratio, view.camera?.fov) : null
    if (!framing) { this.game.view.startCinematic(position, target); this.clearTheView(); return }
    // Aim at the middle of the screen, not of the whole board (which the signs beside it pull to one side): slide the pose
    // across and up the picture by that offset, never toward or away from it.
    if (this.faceCentre && framing.centred > 0) {
      const slide = this.faceCentre.clone().sub(target)
      slide.addScaledVector(CAMERA_DIRECTION, -slide.dot(CAMERA_DIRECTION)).multiplyScalar(framing.centred)
      target.add(slide)
    }
    position.copy(target).addScaledVector(CAMERA_DIRECTION, framing.distance)
    this.game.view.startCinematic(position, target, { pullBack: false })
    this.clearTheView()
  }

  /**
   * The pose the View has just taken, looked at from the world's side: can the whole screen be seen from there? On a phone in portrait the
   * pose stands 18 m out on a line that, beside the Ice Rink, ends inside a pine (a green screen and no board), and a published world is free
   * to put anything on that line. If something stands in the way (or at the lens), the camera is moved to the nearest pose on the same
   * sphere round the screen that sees it all: a little higher, a little to one side, a little closer (see clearFocusPose). Nothing is hidden
   * and nothing is moved, and a pose that is already clear is left exactly as it was.
   */
  private clearTheView(): void {
    const view = this.game.view as unknown as ViewLike
    const cinematic = view.cinematic
    // Only the /world player, where the board is a prefab frame in the island's scene: /world2 draws it among its own scenery, whose board
    // nodes cannot be told from the trees, and keeps the pose it always had.
    const frame = this.group.parent
    if (!cinematic || !frame?.parent || !this.faceSamples.length) return
    this.group.updateWorldMatrix(true, false)
    const world = this.group.matrixWorld
    const target = cinematic.target.clone()
    const position = cinematic.position.clone()
    if (!this.occluders) {
      let root: THREE.Object3D = this.group
      while (root.parent) root = root.parent
      const car = (this.game as unknown as { visual?: { group?: THREE.Object3D } }).visual?.group
      const reach = position.distanceTo(target) * 1.25 + 8
      this.occluders = collectOccluders(root, target, reach, [frame, car])
      // The car is parked in front of the board while it is read, and from a low camera it can cover the screen: the camera sees over or past it.
      this.vehicle = car ? collectOccluders(car, target, reach) : []
    }
    const result = clearFocusPose({
      target, position, occluders: this.occluders, vehicle: this.vehicle ?? [],
      samples: this.faceSamples.map(point => point.clone().applyMatrix4(world)),
      fov: view.camera?.fov ?? 25, ratio: view.viewport?.ratio ?? 1,
    })
    if (!result.moved) return
    // Back to the board's own frame, which is what startCinematic takes; the distance is already right for this window.
    const inverse = world.clone().invert()
    this.game.view.startCinematic(result.position.applyMatrix4(inverse), target.applyMatrix4(inverse), { pullBack: false })
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
      if (this.transition <= 0) {
        const opened = this.state === 'opening'
        this.state = opened ? 'open' : 'closed'
        // Sitting at the board is a visit; the attract cycle and the first paint at load are not.
        if (opened) this.game.interactions?.achievements.mark('projects', this.current.id)
      }
    }

    // The scheduler paints the focused board at its focus rate; the rest of the time it is only painted in sight.
    const focused = this.state !== 'closed'
    if (focused !== this.focused) { this.focused = focused; this.runtime.focus(focused ? this.sign : null) }

    for (const flip of this.flips) {
      if (flip.progress >= 1) continue
      flip.progress = Math.min(1, flip.progress + delta / (FLIP * 2))
      const p = Math.max(0, flip.progress)
      if (flip.mode === 'turn') flip.inner.quaternion.copy(flip.base).multiply(TURN.setFromAxisAngle(Y_AXIS, p * Math.PI * 2))
      else {
        // A card edge-on at the midpoint: out to 90°, swap, back in from -90°. Never shows its back.
        const angle = p < 0.5 ? p * Math.PI : -Math.PI / 2 + (p - 0.5) * Math.PI
        flip.inner.quaternion.copy(flip.base).multiply(TURN.setFromAxisAngle(Y_AXIS, angle))
      }
      if (!flip.swapped && flip.progress >= 0.5) {
        flip.swapped = true
        flip.layer.hold = false
        flip.layer.invalidate()
        if (this.swapping && flip === this.flips[0]) this.swapContent()
      }
      if (flip.progress >= 1) flip.inner.quaternion.copy(flip.base)
    }

    if (time - this.nearAt > 0.25) { this.nearAt = time; this.near = this.nearby() }
    // First time somebody is at the board: fetch the focus bar's stylesheet now, so it is on screen in the frame it opens.
    if (this.near && !this.warmed) { this.warmed = true; this.focusUi?.warm?.() }
    // The window turned (a phone on its side) while the board is focused: frame it again for the new shape.
    if (this.framed && (this.state === 'opening' || this.state === 'open')) {
      const ratio = (this.game.view as unknown as ViewLike).viewport?.ratio ?? 0
      if (ratio > 0 && Math.abs(ratio - this.framed.ratio) > 0.02) this.frameCamera(this.framed.flat)
    }

    if ((this.near || this.state !== 'closed') && !this.swapping) this.prefit()

    // Attract: with nobody at the board, it cycles the run on its own — but only while somebody is around to see it.
    if (this.state === 'closed' && this.near) {
      this.attract += delta
      if (this.attract > ATTRACT_HOLD) {
        // Unattended, the board stays on the work worth stopping for; the
        // archive is reachable by stepping through it by hand.
        const featured = Math.max(1, BOARD_FEATURED_COUNT)
        this.select(this.index < featured ? (this.index + 1) % featured : 0, true)
      }
    }

    // Driving into a wooden sign selects its project — the physical switch. The signs hang above the road on the board's posts, so
    // the test is the car's distance across the ground to the sign's footprint, in the height band of a car beneath it.
    if (this.state === 'closed' && this.near) {
      const player = this.game.player.position
      for (const sign of this.signs) {
        if (!inSwitchZone(player, sign.box)) { sign.hit = false; continue }
        if (sign.hit) continue
        sign.hit = true
        this.step(sign.which === 'next' ? 1 : -1)
      }
    }
  }

  /**
   * Fitting the lettering of a project (wrapping and sizing every line to its plate) is the one costly part of painting it:
   * texts the browser has not measured at those sizes yet take milliseconds each on a phone. So while the board is idle and
   * somebody is near, the projects it can show next (the attract cycle's, and a step either way) are fitted ahead on a context
   * that draws nothing, one layer's worth a frame; when the board changes, its layers find every fit made and only draw.
   * The same goes for what their themes hang on the board (the ivy, rope or chain, and the charm): built hidden ahead, so the
   * frame that swaps the sheet only turns them on instead of building them and uploading them in that same frame.
   */
  private prefit(): void {
    if (this.prefitFor !== this.index) { this.prefitFor = this.index; this.prefitQueue = this.prefitPlan() }
    if (!this.prefitQueue.length) return
    // Not in a frame that is already painting something, or while the plates are turning.
    for (const layer of this.sign.layers) if (layer.dirty && !layer.hold) return
    for (const flip of this.flips) if (flip.progress < 1) return
    this.prefitContext ??= measuringContext(document.createElement('canvas').getContext('2d')!)
    this.prefitQueue.shift()!(this.prefitContext)
  }

  private prefitPlan(): Array<(context: CanvasRenderingContext2D) => void> {
    const count = this.items.length
    const featured = Math.max(1, BOARD_FEATURED_COUNT)
    const size = (name: string): [number, number] | undefined => {
      const layer = this.flips.find(flip => flip.layer.name === name)?.layer ?? this.attributes.find(attribute => attribute.layer.name === name)?.layer
      return layer ? [layer.canvas.width, layer.canvas.height] : undefined
    }
    const sizes: PrefitSizes = {
      title: size('refTitle'), link: size('refUrl'), previous: size('refPrevious'), next: size('refNext'),
      category: size('attribute:category'), year: size('attribute:year'), stack: size('attribute:stack'),
    }
    // Where the attract cycle goes next, then a step forward and back, which is what the keys and the signs do.
    const next = [this.index < featured ? (this.index + 1) % featured : 0, (this.index + 1) % count, (this.index - 1 + count) % count]
      .filter((at, i, all) => at !== this.index && all.indexOf(at) === i)
    // Their hardware first: one cheap step each, and the first thing a quick run of changes would otherwise build at the swap.
    const queued = new Set<string>()
    const steps: Array<(context: CanvasRenderingContext2D) => void> = next.flatMap(at => this.hardwareSteps(this.items[at], queued))
    for (const at of next) steps.push(...prefitSteps(this.items[at], this.items[(at - 1 + count) % count], this.items[(at + 1) % count], sizes))
    return steps
  }

  /** One step per mesh the project's theme asks for that is neither built nor already queued: its hardware, then its charm. */
  private hardwareSteps(project: BoardProject, queued: Set<string>): Array<() => void> {
    const { hardware, charm } = themeForProject(project)
    const steps: Array<() => void> = []
    if (!this.woods.has(hardware) && !queued.has(`wood:${hardware}`)) { queued.add(`wood:${hardware}`); steps.push(() => { this.woodFor(hardware) }) }
    if (charm !== 'none' && !this.charms.has(charm) && !queued.has(`charm:${charm}`)) { queued.add(`charm:${charm}`); steps.push(() => { this.charmFor(charm) }) }
    return steps
  }

  private nearby(): boolean {
    return this.game.player.position.distanceTo(this.readerPoint) < NEAR
  }

  hud(): { activity: string | null; headline: string | null; lines: string[] } {
    if (this.state === 'closed') return { activity: null, headline: null, lines: [] }
    return {
      activity: 'projects',
      headline: null,
      lines: [`${this.index + 1} / ${this.items.length}`, this.current.title, this.current.link ? 'Open to visit' : 'Private source'],
    }
  }
}

const TURN = new THREE.Quaternion()
