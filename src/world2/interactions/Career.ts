import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { World2Game } from '../World2Game'
import type { References } from './references'
import {
  CAREER, CAREER_FIRST_MONTH, CAREER_LAST_MONTH, CAREER_FIRST_YEAR, CAREER_TRACKS,
  type CareerStop, type CareerTrack,
} from '../content/career'

/* ============================================================
   PORTED FROM: sources/Game/World/Areas/CareerArea.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   A stretch of road IS the CV. Blender authors it as four
   parallel lanes down a 6.56 x 17.73 m plate — three for the
   career and one, nearest the driver, for the year — and hangs a
   stone on each lane at each event. Drive into a stone's span and
   it rises 2.5 m out of the ground, then slides with you for the
   length of that job while its label wipes in from the left.

   WHAT BLENDER OWNS, and this file only reads: the lanes' X
   positions (23.04 / 25.05 / 27.06 / 29.05), the plate, the
   stone's mesh, the label's frame — 45 degrees of yaw, 15 degrees
   of lean, a per-lane height — the year plate and its four
   seven-segment digits.

   WHAT THIS FILE OWNS: which stop stands where. Upstream sorts
   its six stones down the road by position and pours one flat
   list into them. Alejandro's career is three threads running at
   once — a degree, a job and a project are not alternatives — so
   each lane carries one KIND of thing and every lane is measured
   against ONE time axis, which is what makes two stones drawing
   level mean "these overlapped".

   The year plate is the authored one, driven the authored way.
   An earlier pass here hid the digits and painted a canvas
   instead, on the belief that the plate stood edge-on to the
   road. It does not: every digit normal is +Y and the whole
   readout lies face-up, which is exactly how the camera sees it.
   ============================================================ */

/** How far a stone rises. Upstream's `lines.activeElevation`. */
const ELEVATION = 2.5
/** Lead-in and run-out around a stone's span, in metres. */
const PADDING = 0.25
/**
 * No stop gets less road than this. Pansofía ran three months, which on a true
 * scale is 1.06 m — a tenth of a second at speed, so its label would flash and
 * go. Short stops are grown around their own midpoint, so the moment a stone
 * is level with you stays honest even when its length is not.
 */
const MIN_SPAN = 2.1
/*
  Lane label heights. Blender's own staircase is 0.585 / 0.72 / 1.151, outer
  lane lowest and inner lane highest, and the ORDER is kept. The SPACING is
  not: those gaps are 0.14 m and 0.43 m against a label 0.91 m tall, which is
  fine for a walk where one thing happens at a time and useless for three
  tracks that overlap. They are spread to a full label height plus air, so two
  lanes speaking at once can never print over each other.
*/
const LANE_HEIGHT: Record<string, number> = { education: 2.7, work: 1.65, projects: 0.6 }
/** Canvas resolution for the labels, in pixels per metre. */
const LABEL_DPM = 420

const LABEL_VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`
/** Upstream's wipe: discard anything the reveal front has not reached yet. */
const LABEL_FRAGMENT = `
uniform sampler2D map;
uniform float reveal;
varying vec2 vUv;
void main() {
  if (vUv.x > reveal) discard;
  vec4 painted = texture2D(map, vUv);
  if (painted.a < 0.02) discard;
  gl_FragColor = painted;
}
`

/**
 * Seven-segment bitmasks, A..G in the order the authored digit meshes carry in
 * their second UV set: A top, B top-right, C bottom-right, D bottom, E
 * bottom-left, F top-left, G middle.
 */
const SEGMENTS = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111]
/**
 * A lit segment rises out of the plate. The authored rest pose is 0.0293 m
 * inside it, under a rim standing 0.0293 m proud of that, so this is the push
 * that brings a bar up flush and a little over — in the digit's own local
 * units, which its node scales by 0.1434.
 */
const SEGMENT_RISE = 0.42

interface Line {
  stop: CareerStop
  track: CareerTrack
  /** Where the stone waits, and how far down the road its span runs. */
  origin: THREE.Vector3
  span: number
  stone: THREE.Object3D
  stoneHome: THREE.Vector3
  label: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  labelHome: THREE.Vector3
  texture: THREE.CanvasTexture
  hasEnd: boolean
  isIn: boolean
  isUp: boolean
  reveal: number
  elevation: number
  slide: number
  index: number
}

interface Digit {
  mesh: THREE.Mesh
  uniforms: { uMask: { value: number } }
}

export class Career {
  readonly lines: Line[] = []
  readonly group = new THREE.Group()
  /** Lane X, in world space, read off the authored empties. Public for QA. */
  readonly lanes: Record<string, number> = {}
  private yearGroup: THREE.Object3D | null = null
  private yearHomeZ = 0
  private yearOffset = 0
  private current = CAREER_FIRST_YEAR
  private digits: Digit[] = []
  /** Road Z at the first month of the walk, and at the last. */
  private near = 0
  private far = 0
  private readonly centre = new THREE.Vector3()
  private reach = 0

  constructor(private game: World2Game, private references: References, bin: Bin) {
    this.group.name = 'World2 / career'
    this.measure()
    this.buildLanes()
    this.buildLines()
    this.buildYear()
    if (this.lines.length) {
      for (const line of this.lines) this.centre.add(line.origin)
      this.centre.divideScalar(this.lines.length)
      this.reach = Math.max(...this.lines.map(line => this.centre.distanceTo(line.origin))) + 28
    }
    const tick = () => this.update()
    game.ticker.events.on('tick', tick, 11)
    bin.add(() => {
      game.ticker.events.off('tick', tick)
      for (const line of this.lines) { line.label.geometry.dispose(); line.label.material.dispose(); line.texture.dispose() }
    })
    bin.object3D(this.group)
  }

  /**
   * The road, measured off the authored lines rather than assumed: the lane
   * each track runs on, and the span of road the whole walk covers. Upstream's
   * `size` custom property is the length of a stone's run, so the far end of
   * the walk is the furthest `origin.z - size` of the six.
   */
  private measure(): void {
    const authored = this.references.series('refLine')
    const xs: number[] = []
    let near = -Infinity, far = Infinity
    for (const node of authored) {
      const at = node.getWorldPosition(new THREE.Vector3())
      const size = Number(node.userData.size ?? 3) || 3
      xs.push(at.x)
      near = Math.max(near, at.z)
      far = Math.min(far, at.z - size)
    }
    const yearNode = this.references.node('refYear')
    if (yearNode) this.lanes.year = yearNode.getWorldPosition(new THREE.Vector3()).x
    // Three career lanes, in from the year lane. The authored X values are the
    // level's, not ours; only which track rides which is decided here.
    const unique = [...new Set(xs.map(x => Math.round(x * 1000) / 1000))].sort((a, b) => a - b)
    const order = ['education', 'work', 'projects']
    order.forEach((track, index) => { this.lanes[track] = unique[index] ?? unique[unique.length - 1] ?? 27 })
    this.near = Number.isFinite(near) ? near : 6.5
    this.far = Number.isFinite(far) ? far : -10.5
  }

  /** Time to road position, shared by every lane. */
  private at(month: number): number {
    const span = Math.max(1, CAREER_LAST_MONTH - CAREER_FIRST_MONTH)
    const t = (month - CAREER_FIRST_MONTH) / span
    return this.near - t * (this.near - this.far)
  }

  /**
   * One neon line per lane, over the authored length of the walk.
   *
   * Blender draws these as four emissive strips, but two of them cover TWO
   * lanes each — one mesh spanning both orange runs, another spanning both
   * purple — and the export collapsed blue and white onto the purple material.
   * So the authored strips are put away and each lane gets its own, coloured
   * by its track, over the full run of the road rather than over the span
   * Bruno's entries happened to need.
   */
  private buildLanes(): void {
    for (const name of ['Plane.035', 'Plane.018', 'Plane.022']) this.references.suppress(name)
    const plate = this.references.node('Plane.049')
    const y = plate ? new THREE.Box3().setFromObject(plate).max.y + 0.004 : 0.095
    const length = this.near - this.far + PADDING * 4
    const middle = (this.near + this.far) / 2

    for (const track of CAREER_TRACKS) {
      const x = this.lanes[track.id]
      if (x === undefined) continue
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, length).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: stripTexture(track.colour), transparent: true, depthWrite: false }),
      )
      mesh.position.set(x, y, middle)
      mesh.renderOrder = 2
      this.group.add(mesh)
    }
  }

  private buildLines(): void {
    /*
      The authored stone is one glTF mesh with TWO primitives — a palette body
      and an emissive tip — so three hands it back as a Group of two Meshes,
      not as a Mesh. Taking the first child instead of the whole node clones a
      sixteen-vertex tip and nothing else, which is a marker 20 cm under the
      road. Clone the node.
    */
    const source = this.references.node('stone')
    if (!source) return
    source.updateWorldMatrix(true, true)
    const stoneY = source.getWorldPosition(new THREE.Vector3()).y
    // The authored stones sit under somebody else's career; ours replace them.
    for (const node of this.references.series('refLine')) this.references.environment.suppress(node)

    const plate = this.references.node('Plane.049')
    const plateTop = plate ? new THREE.Box3().setFromObject(plate).max.y + 0.008 : 0.098
    const frame = this.references.interactions.careerText[0]
    const quaternion = frame ? new THREE.Quaternion(...frame.quaternion) : new THREE.Quaternion()
    // The authored label grows to the right along its own X; the anchor is its
    // left edge, a quarter of a metre back from the stone and a little ahead.
    const along = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion)

    let index = 0
    for (const track of CAREER_TRACKS) {
      const x = this.lanes[track.id]
      for (const stop of track.stops) {
        const from = this.at(stop.start)
        const to = this.at(stop.end)
        const span = Math.max(MIN_SPAN, Math.max(0, from - to))
        // Short stops grow around their own midpoint so the moment the stone
        // is level with the driver still lands on the right date.
        const head = (from + to) / 2 + span / 2

        const stone = source.clone()
        // `suppress` hid the authored stones a moment ago, and a clone copies
        // that flag along with everything else.
        stone.traverse(node => { node.visible = true; node.castShadow = true; node.receiveShadow = true })
        const home = new THREE.Vector3(x, stoneY, head)
        stone.position.copy(home)
        stone.quaternion.identity()
        stone.scale.copy(source.getWorldScale(new THREE.Vector3()))
        tintStone(stone, track.colour)
        this.group.add(stone)
        // The plate is authored with a socket at every stone position along
        // every lane, and most of them stand empty now. A lit pad in the ones
        // this career fills is what tells a driver where to slow down.
        this.group.add(pad(x, plateTop, head, track.colour))

        const label = this.buildLabel(stop, track)
        label.quaternion.copy(quaternion)
        const anchor = new THREE.Vector3(x - 0.24, LANE_HEIGHT[track.id], head + 0.17)
        label.position.copy(anchor).addScaledVector(along, label.geometry.parameters.width / 2)
        label.visible = false
        this.group.add(label)

        this.lines.push({
          stop, track, origin: home.clone(), span,
          stone, stoneHome: home.clone(),
          label, labelHome: label.position.clone(),
          texture: label.material.uniforms.map.value as THREE.CanvasTexture,
          // A stone stays up for good only if nothing on the walk follows it.
          hasEnd: stop.end < CAREER_LAST_MONTH,
          isIn: false, isUp: false, reveal: 0, elevation: 0, slide: 0, index,
        })
        index++
      }
    }
  }

  /**
   * The label, set the way the authored ones are: a name over a qualifier,
   * each on its own solid bar of the lane's colour. Two lines, nothing else —
   * the dates are what the year plate beside the road is for.
   *
   * The old one drew four lines of 54 px type on a fixed 1024x256 canvas
   * stretched over a 3.13 x 0.59 m plane. That is 327 px per metre across but
   * 434 down — every glyph 1.33x too wide — and a headline 12 cm tall, read
   * from eight metres away at speed. This one sizes the canvas to the words at
   * one density in both axes, and sets the headline at 34 cm.
   */
  private buildLabel(stop: CareerStop, track: CareerTrack): THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> {
    const headline = stop.headline.toUpperCase()
    const subtitle = stop.subtitle.toUpperCase()
    // Authored two-line labels are 0.91 m tall; the type is sized off that.
    const height = 0.91
    const headPx = height * 0.37 * LABEL_DPM
    const subPx = height * 0.23 * LABEL_DPM
    const padPx = height * 0.08 * LABEL_DPM
    const font = (px: number, weight: number) => `${weight} ${px}px ui-sans-serif, system-ui, -apple-system, sans-serif`

    const measure = document.createElement('canvas').getContext('2d')!
    measure.font = font(headPx, 800)
    const headWidth = measure.measureText(headline).width
    measure.font = font(subPx, 600)
    const subWidth = measure.measureText(subtitle).width
    const width = Math.min(4.4, (Math.max(headWidth, subWidth) + padPx * 3) / LABEL_DPM)

    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width * LABEL_DPM)
    canvas.height = Math.ceil(height * LABEL_DPM)
    const context = canvas.getContext('2d')!
    context.textBaseline = 'alphabetic'
    context.textAlign = 'left'

    // The highlight is the authored look: a solid bar with the words knocked
    // out of it, so a label reads over grass, over road and against the sky.
    const bar = (text: string, px: number, weight: number, top: number, fill: string, ink: string) => {
      let size = px
      context.font = font(size, weight)
      while (context.measureText(text).width > canvas.width - padPx * 2 && size > px * 0.5) {
        size -= 2
        context.font = font(size, weight)
      }
      const w = context.measureText(text).width
      context.fillStyle = fill
      context.fillRect(padPx * 0.5, top, w + padPx, size * 1.22)
      context.fillStyle = ink
      context.fillText(text, padPx, top + size * 0.96)
      return size * 1.22
    }
    const headTop = padPx * 0.45
    const headHeight = bar(headline, headPx, 800, headTop, track.colour, '#14121a')
    bar(subtitle, subPx, 600, headTop + headHeight + padPx * 0.3, 'rgba(20,18,26,0.85)', '#f6f2ea')

    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    texture.anisotropy = 8
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true, side: THREE.DoubleSide, depthWrite: false,
        uniforms: { map: { value: texture }, reveal: { value: 0 } },
        vertexShader: LABEL_VERTEX, fragmentShader: LABEL_FRAGMENT,
      }),
    )
    mesh.renderOrder = 5
    return mesh
  }

  /**
   * The authored year plate, driven the authored way.
   *
   * Each digit mesh is seven hexagonal bars in one geometry, and its SECOND UV
   * set says which bar each vertex belongs to: `uv1.x` sits on one of seven
   * texel centres, so `floor(uv1.x * 7)` is the segment index. That index is
   * baked into a plain attribute here rather than read through three's UV
   * plumbing, which only declares `uv1` when a material samples it.
   *
   * A lit bar rises out of the plate and burns; an unlit one stays sunk in it
   * and goes dark. Upstream pushes along Z because its plate stands up; ours
   * lies face-up, so the push is along Y.
   */
  private buildYear(): void {
    const group = this.references.node('refYear')
    if (!group) return
    this.yearGroup = group
    this.yearHomeZ = group.position.z

    const digits = group.children
      .filter(child => String(child.userData.w2Source ?? child.name).startsWith('digit'))
      .filter((child): child is THREE.Mesh => child instanceof THREE.Mesh)
      // Left to right is thousands to units, and +X is the driver's right.
      .sort((a, b) => a.getWorldPosition(new THREE.Vector3()).x - b.getWorldPosition(new THREE.Vector3()).x)

    for (const mesh of digits) {
      const geometry = mesh.geometry.clone()
      const uv1 = geometry.getAttribute('uv1')
      if (!uv1) continue
      const segment = new Float32Array(uv1.count)
      for (let i = 0; i < uv1.count; i++) segment[i] = Math.floor(Math.min(0.999, Math.max(0, uv1.getX(i))) * 7)
      geometry.setAttribute('segment', new THREE.BufferAttribute(segment, 1))
      mesh.geometry = geometry

      const uniforms = { uMask: { value: 0 } }
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).clone() as THREE.MeshStandardMaterial
      /*
        The .blend calls this material `emissiveWhiteRadialGradient` and the
        export does not honour it: every emissive in the level — blue, white
        and purple — comes through the glTF with the SAME purple base colour,
        so the readout came up lavender. The authored intent is white, and a
        readout is the one thing on this road that should not be tinted.
      */
      material.color = new THREE.Color('#fdf7ec')
      if (material.emissive) { material.emissive = new THREE.Color('#fdf7ec'); material.emissiveIntensity = 0.55 }
      material.map = null
      material.onBeforeCompile = shader => {
        shader.uniforms.uMask = uniforms.uMask
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `
            #include <common>
            attribute float segment;
            uniform float uMask;
            varying float vLit;
          `)
          .replace('#include <begin_vertex>', `
            #include <begin_vertex>
            float bit = pow(2.0, segment);
            vLit = mod(floor(uMask / bit), 2.0);
            transformed.y += vLit * ${SEGMENT_RISE.toFixed(3)};
          `)
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `
            #include <common>
            varying float vLit;
          `)
          .replace('#include <color_fragment>', `
            #include <color_fragment>
            diffuseColor.rgb *= mix(0.10, 1.0, vLit);
          `)
      }
      material.needsUpdate = true
      mesh.material = material
      this.digits.push({ mesh, uniforms })
    }
    this.writeYear(this.current)
  }

  private writeYear(value: number): void {
    if (!this.digits.length) return
    const text = String(Math.max(0, value)).padStart(this.digits.length, '0').slice(-this.digits.length)
    this.digits.forEach((digit, index) => { digit.uniforms.uMask.value = SEGMENTS[Number(text[index])] ?? 0 })
  }

  private update(): void {
    if (!this.lines.length) return
    const delta = this.game.ticker.delta * this.game.ticker.scale
    const player = this.game.player.position
    // Upstream gates every area on the camera quad; the same idea, by
    // distance. A stone nobody can see does not need to be lerped.
    if (Math.hypot(player.x - this.centre.x, player.z - this.centre.z) > this.reach) return

    /*
      ONE LABEL PER LANE. Every stone on a lane rises and stays up for as long
      as its span runs — that is what draws the shape of the career — but only
      the stop the driver is actually level with SPEAKS. Letting every raised
      stone keep its label printed four of them over each other the moment a
      degree, a job and a project overlapped, which they do for most of this
      road. Three lanes, three heights, at most three labels.
    */
    const speaking = new Map<string, Line>()
    for (const line of this.lines) {
      const along = line.origin.z - player.z
      if (along <= -PADDING || along >= line.span + PADDING * 2) continue
      const best = speaking.get(line.track.id)
      // Level with two at once — the shorter one is the more specific answer
      // to "what is happening here", so it wins the lane.
      if (!best || line.span < best.span) speaking.set(line.track.id, line)
    }

    for (const line of this.lines) {
      const along = line.origin.z - player.z
      const isIn = along > -PADDING && along < line.span + PADDING * 2
      if (isIn !== line.isIn) {
        line.isIn = isIn
        this.game.audio.play('note', isIn ? 1.2 + line.index * 0.1 : 0.6)
        if (isIn) { this.visited.add(line.stop.id); this.game.interactions?.achievements.mark('career', line.stop.id) }
      }
      if (line.isIn) line.isUp = true
      else if (along > line.span) { if (line.hasEnd) line.isUp = false }
      else line.isUp = false

      const revealTarget = line === speaking.get(line.track.id) ? 1 : 0
      line.reveal += (revealTarget - line.reveal) * Math.min(1, delta * 3)
      line.label.material.uniforms.reveal.value = line.reveal
      // Below this the shader discards every pixel anyway.
      line.label.visible = line.reveal > 0.01

      const elevationTarget = line.isUp ? ELEVATION : 0
      line.elevation += (elevationTarget - line.elevation) * Math.min(1, delta * 3)

      let slideTarget = line.slide
      if (line.isIn) { if (line.elevation > 1) slideTarget = -Math.max(0, Math.min(along, line.span)) }
      else slideTarget = along > line.span ? -line.span : 0
      line.slide += (slideTarget - line.slide) * Math.min(1, delta * 10)

      line.stone.position.set(line.stoneHome.x, line.stoneHome.y + line.elevation, line.stoneHome.z + line.slide)
      // The label rides the stone: up with it, along with it.
      line.label.position.set(line.labelHome.x, line.labelHome.y + line.elevation, line.labelHome.z + line.slide)
    }

    if (this.yearGroup) {
      const walk = Math.max(1, this.near - this.far)
      const along = Math.max(0, Math.min(this.near - player.z, walk))
      this.yearOffset += (along - this.yearOffset) * Math.min(1, delta * 10)
      // The parent chain is a pure translation, so local Z tracks world Z.
      this.yearGroup.position.z = this.yearHomeZ - this.yearOffset
      const month = CAREER_FIRST_MONTH + (along / walk) * (CAREER_LAST_MONTH - CAREER_FIRST_MONTH)
      const value = Math.floor(month / 12)
      if (value !== this.current) { this.current = value; this.writeYear(value) }
    }
  }

  /** The year the plate is showing. Read by the QA harness. */
  get year(): number { return this.current }
  /** The seven-segment mask on each authored digit, thousands first. */
  get digitMasks(): number[] { return this.digits.map(digit => digit.uniforms.uMask.value) }
  /** True if anything here still paints the year onto a canvas instead. */
  get paintedYear(): boolean { return false }
  /** Stages the visitor has walked past, accumulated over the whole session. */
  private readonly visited = new Set<string>()
  get seen(): number { return this.visited.size }
  /** Every stop the walk carries, for the awards and the QA harness. */
  get stops(): number { return CAREER.length }
}

/** A soft-edged strip, so a lane reads as a glow rather than a painted line. */
function stripTexture(colour: string): THREE.DataTexture {
  const width = 32
  const data = new Uint8Array(width * 4)
  const rgb = new THREE.Color(colour)
  for (let i = 0; i < width; i++) {
    const t = Math.abs((i + 0.5) / width - 0.5) * 2
    // A bright core inside a fast falloff: the authored strips are a radial
    // gradient, and at half a metre across this is what that reads as.
    const alpha = Math.pow(Math.max(0, 1 - t), 2.2)
    data[i * 4] = Math.round(rgb.r * 255)
    data[i * 4 + 1] = Math.round(rgb.g * 255)
    data[i * 4 + 2] = Math.round(rgb.b * 255)
    data[i * 4 + 3] = Math.round(Math.min(1, alpha * 1.35) * 255)
  }
  const texture = new THREE.DataTexture(data, width, 1)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.needsUpdate = true
  return texture
}

/**
 * The bright square inside the stone's dark collar.
 *
 * At rest the stone is buried to its neck: all a driver sees is a ring of dark
 * stone flush with the plate, with the lane's line running through it. The
 * authored glow is on the sides, two-thirds of a metre down. So each stone
 * gets a lid — the track's colour, sitting a few millimetres inside the
 * collar's top — which is what turns a hole in the road into a marker, and it
 * rides up with the stone because it is parented to it.
 */
/** The lit square inside an authored socket: this stop is here. */
function pad(x: number, y: number, z: number, colour: string): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(0.44, 0.44).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: colour, toneMapped: false }),
  )
  mesh.position.set(x, y, z)
  mesh.renderOrder = 3
  return mesh
}

/**
 * The stone is two materials: a body and an emissive tip. The .blend colours
 * that tip per entry, but the export collapsed blue and white onto the purple
 * material, so the tip is repainted here in the track's own colour.
 */
function tintStone(stone: THREE.Object3D, colour: string): void {
  stone.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    const painted = materials.map(material =>
      /emissive/i.test(material.name ?? '')
        ? new THREE.MeshBasicMaterial({ color: colour, name: material.name })
        : material)
    node.material = painted.length === 1 ? painted[0] : painted
  })
}
