import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { Ticker } from '@/world/core/Ticker'
import { Tweens, easing } from '@/world/core/Tween'
import type { Inputs } from '@/world/input/Inputs'

/* ============================================================
   PORTED FROM: sources/Game/InteractivePoints.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   The prompt is a diamond outline with a label that wipes out
   sideways and a key glyph that pops in — drawn in the world, at
   the authored `ref…InteractivePoint` empty, at a fixed 45°/−27°
   attitude. It is deliberately NOT a billboard and deliberately
   NOT an HTML card: it belongs to the place, not to the screen.

   Changes from upstream: WebGL `ShaderMaterial` instead of TSL
   node materials; the key glyph is drawn rather than loaded as
   three PNGs; and `update()` picks the NEAREST point rather than
   the last one in range. Upstream declares `let distance =
   Infinity` and never re-assigns it inside the loop, so its
   `itemDistance < distance` test is always true — harmless with
   one prompt in range, wrong on the social arc where eight sit
   close enough to overlap.
   ============================================================ */

export type PromptAlign = 'left' | 'right'
type State = 'hidden' | 'open' | 'concealed'

const RADIUS = 2.5
/** Squared metres the car must travel before the proximity test re-runs. */
const MOVE_GATE = 0.2

export interface PromptOptions {
  label: string
  position: THREE.Vector3
  align?: PromptAlign
  onInteract: () => void
  /** Hidden until something calls `show()` — used by mini-games mid-play. */
  startHidden?: boolean
}

export interface PromptHandle {
  readonly label: string
  setLabel(label: string): void
  show(): void
  hide(): void
  destroy(): void
  readonly open: boolean
}

interface Item {
  label: string
  align: PromptAlign
  at: THREE.Vector2
  group: THREE.Group
  diamond: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  labelMesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  texture: THREE.CanvasTexture
  canvas: HTMLCanvasElement
  state: State
  isIn: boolean
  requestedHidden: boolean
  onInteract: () => void
  destroyed: boolean
}

const DIAMOND_VERTEX = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`

/** Chebyshev distance carves a square; the mesh is rotated 45°, so: diamond. */
const DIAMOND_FRAGMENT = `
uniform float threshold;
uniform float lineThickness;
uniform float lineOffset;
uniform vec3 backColor;
uniform vec3 frontColor;
varying vec2 vUv;
void main() {
  float d = max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)) * 2.0;
  if (d > threshold) discard;
  float band = abs(threshold - d - lineOffset);
  float line = step(band, lineThickness * 0.5);
  gl_FragColor = vec4(mix(backColor, frontColor, line), 1.0);
}
`

const LABEL_FRAGMENT = `
uniform sampler2D map;
uniform float labelOffset;
uniform vec3 backColor;
uniform vec3 frontColor;
varying vec2 vUv;
void main() {
  vec2 p = vec2(vUv.x - labelOffset, vUv.y);
  if (p.x > 1.0 || p.x < 0.0) discard;
  float text = texture2D(map, p).r;
  gl_FragColor = vec4(mix(backColor, frontColor, text), 1.0);
}
`

const BACK = new THREE.Color('#251f2b')
const FRONT = new THREE.Color('#ffffff')

/** The key hint, drawn rather than shipped as three glyph textures. */
function keyTexture(kind: 'keyboard' | 'gamepad'): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const context = canvas.getContext('2d')!
  context.fillStyle = '#000000'
  context.fillRect(0, 0, 128, 128)
  context.strokeStyle = context.fillStyle = '#ffffff'
  context.lineWidth = 9
  context.lineJoin = context.lineCap = 'round'
  if (kind === 'gamepad') {
    context.beginPath()
    context.arc(64, 64, 38, 0, Math.PI * 2)
    context.stroke()
    context.font = '700 46px system-ui, sans-serif'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('A', 64, 68)
  } else {
    // The enter arrow: down the stem, left along the foot, arrowhead.
    context.beginPath()
    context.moveTo(94, 34)
    context.lineTo(94, 82)
    context.lineTo(38, 82)
    context.stroke()
    context.beginPath()
    context.moveTo(58, 62)
    context.lineTo(36, 82)
    context.lineTo(58, 102)
    context.closePath()
    context.fill()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = false
  return texture
}

export class Prompts {
  /** Public so the QA harness can walk every point in the world. */
  readonly items: Item[] = []
  private readonly keyIcon: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly keyTextures: Record<'keyboard' | 'gamepad', THREE.CanvasTexture>
  private readonly plane = new THREE.PlaneGeometry(2, 2)
  private readonly labelGeometry = new THREE.PlaneGeometry(1, 1).translate(0.5, 0, 0)
  private readonly last = new THREE.Vector2(Infinity, Infinity)
  private active: Item | null = null
  private needsTest = true
  /** Set while a focused activity owns the screen; every prompt stays down. */
  private suspended = false

  readonly group = new THREE.Group()

  constructor(
    private ticker: Ticker,
    private tweens: Tweens,
    private inputs: Inputs,
    private bin: Bin,
    private playerPosition: () => THREE.Vector3,
  ) {
    this.group.name = 'World2 / prompts'
    this.keyTextures = { keyboard: keyTexture('keyboard'), gamepad: keyTexture('gamepad') }
    this.keyIcon = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      uniforms: { map: { value: this.keyTextures.keyboard }, frontColor: { value: FRONT } },
      vertexShader: DIAMOND_VERTEX,
      fragmentShader: `
        uniform sampler2D map; uniform vec3 frontColor; varying vec2 vUv;
        void main() {
          float a = texture2D(map, vUv).r;
          if (a < 0.5) discard;
          gl_FragColor = vec4(frontColor, 1.0);
        }`,
    }))
    this.keyIcon.renderOrder = 8
    this.keyIcon.position.z = 0.01
    this.keyIcon.scale.setScalar(0)
    this.keyIcon.visible = false

    const tick = () => this.update()
    // Priority 9, between the zone tests and the area controllers, as upstream.
    ticker.events.on('tick', tick, 9)

    /*
      NOTE: this class deliberately does NOT subscribe to the `interact`
      action. `World2Game.interact()` is the single entry point for the key,
      the gamepad and the touch button, and it calls `interactActive()`.
      Subscribing here as well fired every callback twice, which was invisible
      on one-shots and cancelled every TOGGLE — the map, the controls panel,
      the achievements panel and the bowling bumpers all appeared dead.
    */

    bin.add(() => {
      ticker.events.off('tick', tick)
      for (const item of [...this.items]) this.remove(item)
      this.plane.dispose(); this.labelGeometry.dispose()
      this.keyIcon.material.dispose()
      this.keyTextures.keyboard.dispose(); this.keyTextures.gamepad.dispose()
    })
    bin.object3D(this.group)
  }

  /** Touch drives with a screen button; keyboard and gamepad get the glyph. */
  private refreshKeyIcon(): void {
    const mode = this.inputs.mode
    if (mode === 'touch') { this.keyIcon.visible = false; return }
    this.keyIcon.material.uniforms.map.value = this.keyTextures[mode === 'gamepad' ? 'gamepad' : 'keyboard']
  }

  private paint(item: Item): void {
    const context = item.canvas.getContext('2d')!
    const height = 64
    const paddingLeft = item.align === 'left' ? 60 : 12
    const paddingRight = item.align === 'left' ? 12 : 60
    const font = '700 44px ui-sans-serif, system-ui, sans-serif'
    context.font = font
    const width = Math.ceil(context.measureText(item.label).width) + paddingLeft + paddingRight
    item.canvas.width = width
    item.canvas.height = height
    context.font = font
    context.fillStyle = '#000000'
    context.fillRect(0, 0, width, height)
    context.fillStyle = '#ffffff'
    context.textBaseline = 'middle'
    context.fillText(item.label, paddingLeft, height / 2 + 2)
    item.texture.needsUpdate = true
    item.labelMesh.scale.x = 0.75 * width / height
    item.labelMesh.scale.y = 0.75
    item.labelMesh.position.x = item.align === 'left' ? 0 : -item.labelMesh.scale.x
  }

  create(options: PromptOptions): PromptHandle {
    const align = options.align ?? 'right'
    const group = new THREE.Group()
    group.rotation.order = 'YXZ'
    group.rotation.set(-Math.PI * 0.15, Math.PI * 0.25, 0)
    group.position.copy(options.position)
    group.scale.setScalar(0.85)
    this.group.add(group)

    const diamond = new THREE.Mesh(this.plane, new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        threshold: { value: 0 }, lineThickness: { value: 0.15 }, lineOffset: { value: 0.175 },
        backColor: { value: BACK }, frontColor: { value: FRONT },
      },
      vertexShader: DIAMOND_VERTEX,
      fragmentShader: DIAMOND_FRAGMENT,
    }))
    diamond.renderOrder = 7
    diamond.rotation.z = Math.PI * 0.25
    diamond.visible = false
    group.add(diamond)

    const canvas = document.createElement('canvas')
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const labelMesh = new THREE.Mesh(this.labelGeometry, new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { map: { value: texture }, labelOffset: { value: 1 }, backColor: { value: BACK }, frontColor: { value: FRONT } },
      vertexShader: DIAMOND_VERTEX,
      fragmentShader: LABEL_FRAGMENT,
    }))
    labelMesh.renderOrder = 6
    labelMesh.position.z = -0.01
    labelMesh.visible = false
    group.add(labelMesh)

    const item: Item = {
      label: options.label, align, at: new THREE.Vector2(options.position.x, options.position.z),
      group, diamond, labelMesh, texture, canvas,
      state: 'hidden', isIn: false, requestedHidden: options.startHidden ?? false,
      onInteract: options.onInteract, destroyed: false,
    }
    this.paint(item)
    this.items.push(item)
    this.needsTest = true

    return {
      get label() { return item.label },
      get open() { return item.state === 'open' },
      setLabel: (label: string) => { item.label = label; this.paint(item) },
      show: () => { item.requestedHidden = false; this.needsTest = true },
      hide: () => { item.requestedHidden = true; this.hide(item) },
      destroy: () => this.remove(item),
    }
  }

  /** Suspends every prompt — for a focused activity that owns the controls. */
  setSuspended(suspended: boolean): void {
    if (this.suspended === suspended) return
    this.suspended = suspended
    if (suspended) for (const item of this.items) this.hide(item)
    this.needsTest = true
  }

  private remove(item: Item): void {
    if (item.destroyed) return
    item.destroyed = true
    if (this.active === item) this.active = null
    const index = this.items.indexOf(item)
    if (index >= 0) this.items.splice(index, 1)
    this.tweens.killOf(item.diamond.material.uniforms.threshold)
    item.group.removeFromParent()
    item.diamond.material.dispose()
    item.labelMesh.material.dispose()
    item.texture.dispose()
  }

  private uniforms(item: Item) {
    return {
      threshold: item.diamond.material.uniforms.threshold,
      lineThickness: item.diamond.material.uniforms.lineThickness,
      lineOffset: item.diamond.material.uniforms.lineOffset,
      labelOffset: item.labelMesh.material.uniforms.labelOffset,
    }
  }

  private reveal(item: Item): void {
    if (item.state === 'open') return
    item.state = 'open'
    item.diamond.visible = true
    item.labelMesh.visible = true
    item.group.add(this.keyIcon)
    const u = this.uniforms(item)
    this.tweens.to(u.threshold, { value: 0.5 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true })
    this.tweens.to(u.lineThickness, { value: 0.075 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true })
    this.tweens.to(u.lineOffset, { value: 0.15 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true })
    this.tweens.to(u.labelOffset, { value: 0 }, { duration: 0.6, delay: 0.2, ease: easing.power2Out, overwrite: true })
    this.refreshKeyIcon()
    if (this.inputs.mode !== 'touch') {
      this.keyIcon.visible = true
      this.keyIcon.scale.setScalar(0)
      this.tweens.to(this.keyIcon.scale, { x: 0.25, y: 0.25, z: 0.25 }, { duration: 1.5, delay: 0.6, ease: easing.elasticOut, overwrite: true })
    }
  }

  private conceal(item: Item): void {
    if (item.state === 'concealed') return
    const wasHidden = item.state === 'hidden'
    item.state = 'concealed'
    item.diamond.visible = true
    const ease = wasHidden ? easing.power2Out : easing.power2In
    const u = this.uniforms(item)
    this.tweens.to(u.threshold, { value: 0.25 }, { duration: 0.6, delay: 0.2, ease, overwrite: true })
    this.tweens.to(u.lineThickness, { value: 0.15 }, { duration: 0.6, delay: 0.2, ease, overwrite: true })
    this.tweens.to(u.lineOffset, { value: 0.175 }, { duration: 0.6, delay: 0.2, ease, overwrite: true, onComplete: () => { item.labelMesh.visible = false } })
    this.tweens.to(u.labelOffset, { value: 1 }, { duration: 0.6, ease: easing.power2In, overwrite: true })
    if (this.active === item) this.dropKeyIcon()
  }

  private hide(item: Item): void {
    if (item.state === 'hidden') return
    item.state = 'hidden'
    item.isIn = false
    if (this.active === item) { this.active = null; this.dropKeyIcon() }
    const u = this.uniforms(item)
    this.tweens.to(u.threshold, { value: 0 }, { duration: 0.6, ease: easing.power2In, overwrite: true })
    this.tweens.to(u.lineThickness, { value: 0.15 }, { duration: 0.6, ease: easing.power2In, overwrite: true })
    this.tweens.to(u.lineOffset, { value: 0.175 }, {
      duration: 0.6, ease: easing.power2In, overwrite: true,
      onComplete: () => { item.diamond.visible = false; item.labelMesh.visible = false },
    })
    this.tweens.to(u.labelOffset, { value: 1 }, { duration: 0.6, ease: easing.power2In, overwrite: true })
  }

  private dropKeyIcon(): void {
    this.tweens.to(this.keyIcon.scale, { x: 0, y: 0, z: 0 }, {
      duration: 0.6, ease: easing.power2In, overwrite: true,
      onComplete: () => { this.keyIcon.visible = false },
    })
  }

  private interact(item: Item): void {
    const threshold = item.diamond.material.uniforms.threshold
    this.tweens.to(threshold, { value: 0.6 }, {
      duration: 0.1, ease: easing.power2Out, overwrite: true,
      onComplete: () => this.tweens.to(threshold, { value: 0.5 }, { duration: 1.5, ease: easing.elasticOut, overwrite: true }),
    })
    item.onInteract()
  }

  /** Touch has no key to press, so the HUD button routes through here. */
  interactActive(): boolean {
    if (!this.active || this.active.state !== 'open') return false
    this.interact(this.active)
    return true
  }

  /** What the HUD should offer as a touch button, or null. */
  get activeLabel(): string | null {
    return this.active && this.active.state === 'open' ? this.active.label : null
  }

  private update(): void {
    const position = this.playerPosition()
    const travelled = Math.hypot(this.last.x - position.x, this.last.y - position.z)
    if (travelled <= MOVE_GATE && !this.needsTest) return
    this.needsTest = false
    this.last.set(position.x, position.z)

    let nearest: Item | null = null
    let nearestDistance = Infinity
    for (const item of this.items) {
      if (item.requestedHidden || this.suspended) { this.hide(item); continue }
      const distance = Math.hypot(item.at.x - position.x, item.at.y - position.z)
      const isIn = distance < RADIUS
      if (isIn && distance < nearestDistance) { nearest = item; nearestDistance = distance }
      if (!isIn && item.isIn) { item.isIn = false; if (item.state !== 'hidden') this.conceal(item) }
      else if (!isIn && item.state === 'hidden') this.conceal(item)
    }

    if (nearest) {
      if (this.active && this.active !== nearest) { this.active.isIn = false; this.conceal(this.active) }
      this.active = nearest
      nearest.isIn = true
      this.reveal(nearest)
    } else if (this.active) {
      this.conceal(this.active)
      this.active = null
    }
  }
}
