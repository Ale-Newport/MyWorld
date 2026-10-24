import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { Ticker } from '@/world/core/Ticker'
import { Tweens, easing } from '@/world/core/Tween'
import type { Inputs } from '@/world/input/Inputs'
import { AFTER_ORDER, Billboards, type BillboardHandle } from './Billboards'

/* ============================================================
   PORTED FROM: sources/Game/InteractivePoints.js
   folio-2025 — Copyright (c) 2025 Bruno Simon — MIT
   See THIRD_PARTY_NOTICES.md.

   The prompt is a diamond outline with a label that wipes out
   sideways and a key glyph that pops in — drawn in the world, at
   the authored `ref…InteractivePoint` empty. Upstream fixes it at a
   45°/−27° attitude, right only for the author's camera in an
   unrotated area. Here the area frames are rotated and scaled and the
   player drag-orbits the camera, so while a gameplay camera exists
   the prompt is a spherical billboard (./Billboards) at the same
   anchor — at the default camera it reads as upstream's does —
   and the authored attitude is only the fallback for /world2 and the
   studio's Edit previews, which have no camera. It is deliberately
   NOT an HTML card: it belongs to the place, not to the screen.

   It must also be READ, and a phone held upright is a screen only
   ~6 m wide at the chase camera: a label that hangs off one side of
   its diamond ran off the edge of the picture ("e scenes"). So the
   open prompt is fitted to the screen every frame, after the
   billboards (AFTER_ORDER). `fitPrompt` hangs the label on the side
   that has room (the authored side whenever it fits; a swap slides
   the label and the prompt across), slides the whole prompt back
   inside the picture by the least it takes, and shrinks it only when
   it is wider than the screen (never under a 12 px cap height). It
   keeps off the page's own controls too (the touch buttons and the
   speed readout, read off the page a few times a second), or a label
   slid in from the edge would end up under a button. The interact
   button (the same words, on the glass) stands at the height of the
   car on a short phone and is as wide as its text, so no side of the
   anchor is clear of it: the prompt is lifted instead, by the least
   it takes for the label to stand above the button (`liftClear`). So is a label too long to stand beside the touch column even at
   the smallest type (a 360 px phone, "Start the penguin round-up"): the column is a control no side of the anchor is clear of, and
   the label is lifted above it (and above the button, which stands over the column's top there), never left under it.
   Where the prompt fits, nothing moves: a desktop is exactly what it
   was. A prompt the screen has moved is also drawn a few metres
   nearer the lens (along the ray, so it looks the same size and
   stands in the same place): sliding it in from the edge puts it
   where the car is, and the label stands in front of the car, as a
   tag, never behind its roof. On a phone held upright every open
   prompt is drawn so: its label hangs at the height of the car's
   roof, and the car stood in front of it ("mpers", "ebox").

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

/** The label's canvas: its height, the padding where the diamond sits and the one at the far end (canvas px). */
const CANVAS_HEIGHT = 64
const PAD_NEAR = 60
const PAD_FAR = 12
/** The label plane's height (the group's units) and the cap height of its type. */
const LABEL_HEIGHT = 0.75
const CAP_HEIGHT = 0.37
/** How far the diamond reaches from the anchor (its corner, with the elastic overshoot of its reveal), in the group's units. */
const REACH = 0.75
/** How far the open prompt keeps from the picture's edge, how much better the other side must be before the label swaps, both in CSS px. */
const FIT_MARGIN_PX = 10
const FIT_SWAP_PX = 8
/** How far the fit keeps from the page's own controls (CSS px), and how often (seconds) their places are read. */
const FIT_HUD_CLEAR_PX = 8
const FIT_HUD_POLL = 0.25
/** How far (CSS px) a blocked label may stand over a control's air before the prompt is lifted clear of it: where it is slid against the control it touches it, to the pixel. */
const FIT_HUD_SLACK_PX = 4
/**
 * The page's controls a prompt keeps off sideways, by element id: the touch buttons and the speed readout. Not the interact button:
 * as wide as its text it would leave a label on a short phone no room beside it, so the prompt is lifted clear of it instead (below).
 */
const FIT_HUD_IDS = ['touch-controls', 'drive-hud']
/** The interact button, which the prompt is lifted clear of, and the top bar, under which the lifted prompt does not climb. */
const FIT_BUTTON_ID = 'interact-action'
const FIT_BAR_ID = 'player-nav'
/** The frames after a prompt opens in which the fit puts everything at once (the page's button shows a frame later) and re-reads the page every frame. */
const FIT_SNAP_FRAMES = 3
/** A screen this narrow and taller than wide is a phone held upright: its camera is far (31 m) and the label hangs at the car's roof. */
const FIT_PHONE_WIDTH = 600
/** The smallest cap height (CSS px) the fit shrinks the type to: the 12 px of the legibility checks, with a hair of margin. */
const FIT_MIN_CAP_PX = 12.5
/** How fast a swapped label slides to its new side, per second; and the most the fit slides a prompt, in clip space. */
const FIT_SWAP_RATE = 18
const FIT_MAX_SHIFT = 1.2
/** How far (metres, along the ray from the lens) a prompt that the fit moved is drawn nearer the camera: past the front of a car parked 2.5 m from the anchor AND past the trees that stand 6-9 m nearer the lens along the ray (an acceptance check found phone prompts cut mid-word by foliage with a 3 m pull; 11 m read whole in every pose, and since the label keeps its screen position and size only its depth order changes). Full when it slides or lifts this far (clip space), or swaps sides, or shrinks, and always on a phone held upright. */
const FIT_PULL = 11
const FIT_PULL_SLIDE = 0.05

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
  /** Turns `group` to the gameplay camera; removed with the prompt. */
  billboard: BillboardHandle
  /** Holds the diamond, the label and the key: the fit slides and scales it, so `group` stays at the anchor. */
  fit: THREE.Group
  /** Canvas px where the painted text starts (the padding on the anchor's side). */
  textStart: number
  /** 1: the label body hangs on the left of the anchor, 0: on the right; between, while it slides to the other side. */
  left: number
  /** The label hangs (or is sliding to hang) on the side opposite the authored one. */
  flipped: boolean
  /** 0 on the authored side, 1 on the other, between while the label slides across; its shift slides with it, so it is on the screen all the way. */
  swap: number
  /** 0..1: how much of FIT_PULL the prompt is drawn nearer the lens (it follows how much the fit moved it). */
  pull: number
  /** How far (the group's units, upward on the screen) the prompt is lifted to stand clear of the page's interact button; eased. */
  lift: number
  /** The next fits (this many) put everything at once and read the page each time: a prompt that has just opened. */
  snap: number
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

/** A rectangle of the picture in clip space (-1..1); empty (x0 >= x1) when there is nothing there. */
export interface KeepOut { x0: number; y0: number; x1: number; y1: number }

/**
 * Where the page's own controls are, as clip-space rectangles with air round them: the touch buttons and the speed readout (which
 * the prompt keeps off sideways), the interact button (which it is lifted clear of) and the bottom edge of the top bar (under which
 * it does not climb). Read off the page about four times a second, at once when the window changes size, and on the frames after a
 * prompt opens (the button shows a frame later) — never per frame. A page without them (the /world2 route's) is simply all screen.
 */
class PageControls {
  readonly rects: KeepOut[] = FIT_HUD_IDS.map(() => emptyKeepOut())
  readonly button: KeepOut = emptyKeepOut()
  /** What a prompt is lifted clear of: the interact button first, then the rectangles the sideways fit keeps off (the same objects). */
  readonly keepOuts: KeepOut[] = [this.button, ...this.rects]
  /** The lowest clip y a lifted prompt may reach the top of: under the page's top bar, or the margin where there is none. */
  ceiling = 1
  /** When (the ticker's clock) and at what window size the page was last read: the fit tests these itself, inline, every frame. */
  at = -Infinity
  seenWidth = -1
  seenHeight = -1
  private readonly bar: KeepOut = emptyKeepOut()

  /** Reads the page now. Called a few times a second at most, so what it is handed may be boxed. */
  measure(now: number, width: number, height: number): void {
    this.at = now
    this.seenWidth = width
    this.seenHeight = height
    const canvas = document.getElementById('world')?.getBoundingClientRect()
    const left = canvas?.left ?? 0
    const top = canvas?.top ?? 0
    const wide = canvas && canvas.width > 0 ? canvas.width : width
    const high = canvas && canvas.height > 0 ? canvas.height : height
    for (let i = 0; i < FIT_HUD_IDS.length; i++) this.read(FIT_HUD_IDS[i], this.rects[i], left, top, wide, high)
    this.read(FIT_BUTTON_ID, this.button, left, top, wide, high)
    this.read(FIT_BAR_ID, this.bar, left, top, wide, high)
    const margin = 1 - (2 * FIT_MARGIN_PX) / high
    this.ceiling = this.bar.x0 < this.bar.x1 && this.bar.y0 < margin ? this.bar.y0 : margin
  }

  /** The element `id` as a clip-space rectangle with `FIT_HUD_CLEAR_PX` round it; empty when it is not there or not shown. */
  private read(id: string, out: KeepOut, left: number, top: number, width: number, height: number): void {
    const box = document.getElementById(id)?.getBoundingClientRect()
    if (box && box.width > 0 && box.height > 0) {
      out.x0 = ((box.left - left - FIT_HUD_CLEAR_PX) / width) * 2 - 1
      out.x1 = ((box.right - left + FIT_HUD_CLEAR_PX) / width) * 2 - 1
      out.y1 = 1 - ((box.top - top - FIT_HUD_CLEAR_PX) / height) * 2
      out.y0 = 1 - ((box.bottom - top + FIT_HUD_CLEAR_PX) / height) * 2
    } else { out.x0 = 2; out.y0 = 2; out.x1 = -2; out.y1 = -2 }
  }
}

/**
 * A rectangle whose four fields are doubles from the start, whatever it is given. An object literal `{ x0: 2 }` has a small-integer
 * field and a literal `{ x0: 0.2 }` a double one: two shapes that the loops of `liftClear` then meet at every load, and a load of a
 * double field that has to serve two shapes hands back a new number each time. One shape (here, and in anything that builds one
 * to hand to `liftClear`) keeps the per-frame fit allocation-free.
 */
export function keepOut(x0: number, y0: number, x1: number, y1: number): KeepOut {
  const out = { x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5 }
  out.x0 = x0; out.y0 = y0; out.x1 = x1; out.y1 = y1
  return out
}

/** Nothing there (x0 > x1). */
function emptyKeepOut(): KeepOut {
  return keepOut(2, 2, -2, -2)
}

/**
 * What `fitPrompt` is asked and what it decides, one object reused every frame (built by `fitState`, so that there is one shape of
 * it). The question is written into its fields rather than passed as arguments: a call that is not inlined boxes every number it is
 * handed, and a function this size is inlined by one of the engine's tiers and not by another.
 */
export interface PromptFit {
  /** The question. The anchor is at `anchor` (clip space x) and a local unit of the prompt is `k` clip units wide; its label body is `body` units, authored on the left of the anchor when `ownLeft`. */
  anchor: number
  k: number
  body: number
  ownLeft: boolean
  /** The room the prompt may use (clip space): the screen less its margin and less the page's controls. */
  lo: number
  hi: number
  /** The smallest scale (a share of full size) the type may be shrunk to, and how much less sliding the other side must take before the label moves to it. */
  floor: number
  swap: number
  /** How far to slide the prompt along the screen's x, in the group's own units, with the label on the side `flipped` says. */
  shift: number
  /** The same, for the label on its authored side and on the other: each is on the screen, so a blend of the two is (see `swap`). */
  own: number
  other: number
  /** The uniform scale of the prompt about its anchor, 1 where it fits. */
  scale: number
  /** True while the label hangs on the side opposite its authored one. Read as the state so far, and written back. */
  flipped: boolean
}

/** A `PromptFit` with doubles in its number fields from the start (see `keepOut`): as authored, nothing asked. */
export function fitState(): PromptFit {
  const job = {
    anchor: 0.5, k: 0.5, body: 0.5, ownLeft: false, lo: 0.5, hi: 0.5, floor: 0.5, swap: 0.5, shift: 0.5, own: 0.5, other: 0.5, scale: 0.5, flipped: false,
  }
  job.anchor = 0; job.k = 0; job.body = 0; job.lo = -1; job.hi = 1; job.floor = 1; job.swap = 0; job.shift = 0; job.own = 0; job.other = 0; job.scale = 1
  return job
}

/**
 * How far (clip space) a prompt must slide along x to stand inside `lo`..`hi`, when its label body is `body` wide on one side of
 * the anchor (`left`: on the left) and the diamond reaches `reach` past it on the other. The body is what is read: where the two
 * cannot both fit, the diamond's tip is the part given up.
 */
function overflow(anchor: number, body: number, reach: number, left: boolean, lo: number, hi: number): number {
  const a = anchor - (left ? body : reach)
  const b = anchor + (left ? reach : body)
  if (left) return a < lo ? lo - a : b > hi ? hi - b : 0
  return b > hi ? hi - b : a < lo ? lo - a : 0
}

/**
 * Fits an open prompt to the picture, as `job` asks. The anchor is at `job.anchor` (clip space x) and a local unit of the prompt is
 * `job.k` clip units wide; its label body is `job.body` units, authored on the left of the anchor when `job.ownLeft`. `job.lo`..`job.hi`
 * is the room the prompt may use (the screen less its margin and less the page's controls), `job.floor` the smallest scale (a share of
 * full size) the type may be shrunk to, `job.swap` how much less sliding the other side must take before the label moves to it (so
 * that it never flickers between two equal sides).
 *
 * The prompt is first shrunk, if it is wider than the room, to the width of the room (never under `floor`); then it stays on
 * its authored side (and returns to it the moment it fits there) unless the other side asks clearly less of a slide; then it
 * slides the least that brings it inside. Where it
 * already fits: shift 0, scale 1, the authored side. Pure: no allocation, nothing read but its arguments.
 */
export function fitPrompt(out: PromptFit): PromptFit {
  const anchor = out.anchor
  const k = out.k
  const ownLeft = out.ownLeft
  const lo = out.lo
  const hi = out.hi
  const floor = out.floor
  const swap = out.swap
  const w = out.body * k
  const d = REACH * k
  let scale = (hi - lo) / (w + d)
  if (scale > 1) scale = 1
  const least = floor < 1 ? floor : 1
  if (scale < least) scale = least
  const own = overflow(anchor, scale * w, scale * d, ownLeft, lo, hi)
  const other = overflow(anchor, scale * w, scale * d, !ownLeft, lo, hi)
  const ownCost = own < 0 ? -own : own
  const otherCost = other < 0 ? -other : other
  // The authored side wins whenever it fits; the other is taken only when it asks clearly less, and kept until the authored one asks clearly less.
  if (ownCost < 1e-9) out.flipped = false
  else if (out.flipped ? ownCost + swap < otherCost : otherCost + swap < ownCost) out.flipped = !out.flipped
  out.own = (own > FIT_MAX_SHIFT ? FIT_MAX_SHIFT : own < -FIT_MAX_SHIFT ? -FIT_MAX_SHIFT : own) / k
  out.other = (other > FIT_MAX_SHIFT ? FIT_MAX_SHIFT : other < -FIT_MAX_SHIFT ? -FIT_MAX_SHIFT : other) / k
  out.shift = out.flipped ? out.other : out.own
  out.scale = scale
  return out
}

/**
 * What `liftClear` is asked and what it decides, one object reused every frame (built by `liftJob`, so that there is one shape of it).
 * The question is written into its fields rather than passed as arguments: a call that is not inlined boxes every number it is
 * handed, and whether the engine inlines a function of this size into the per-frame fit depends on what else the fit has asked it to inline.
 */
export interface PromptLift {
  /** Where the label stands (clip space): `x0`..`x1` across, `centre` ± `half` up. The whole prompt (the diamond is the tallest part) reaches `head` either side of `centre`. */
  x0: number
  x1: number
  centre: number
  half: number
  head: number
  /** The lowest clip y the top of the prompt may be lifted to: the bottom edge of the top bar. */
  ceiling: number
  /** How many of the keep-outs count (the first `count`), and how far into the air of all but the first a label may reach before it is over them (clip space). */
  count: number
  slack: number
  /** The answer: how far (clip space) to lift the prompt up the screen; 0 where it is clear. */
  rise: number
}

/** A `PromptLift` with doubles in its number fields from the start (see `keepOut`) and nothing asked. */
export function liftJob(): PromptLift {
  const job = { x0: 0.5, x1: 0.5, centre: 0.5, half: 0.5, head: 0.5, ceiling: 0.5, count: 0, slack: 0.5, rise: 0.5 }
  job.x0 = 0; job.x1 = 0; job.centre = 0; job.half = 0; job.head = 0; job.ceiling = 1; job.slack = 0; job.rise = 0
  return job
}

/**
 * How far (clip space, up) the prompt `job` describes must be lifted to stand clear of the first `job.count` of `keepOuts`,
 * rectangles with their air: the interact button first (`keepOuts[0]`), then the touch buttons and the speed readout, which a label
 * that no side of the anchor is clear of is lifted over too. A label that touches a rectangle is lifted until its bottom edge stands
 * on the rectangle's top — up, never down: below the button are the touch buttons, which the sideways fit has already kept it off —
 * and no further than `job.ceiling` (the top bar) allows, so a prompt that cannot clear them is as clear as the screen leaves it.
 * Two passes, so that clearing one rectangle never leaves the label standing on another. A label slid against a rectangle touches
 * it to the pixel: the entries after the first count as overlapped only by more than `job.slack`, the button's air being all the
 * margin the button has. A rectangle that is not there (empty: x0 > x1), or a label clear of all of them: 0. Pure: no allocation,
 * nothing read but its arguments.
 */
export function liftClear(job: PromptLift, keepOuts: readonly KeepOut[]): PromptLift {
  const x0 = job.x0
  const x1 = job.x1
  const half = job.half
  const slack = job.slack
  const count = job.count
  let rise = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < count; i++) {
      const o = keepOuts[i]
      const near = i === 0 ? 0 : slack
      const c = job.centre + rise
      if (x1 - near > o.x0 && x0 + near < o.x1 && c + half > o.y0 && c - half < o.y1) rise += o.y1 - (c - half)
    }
  }
  const room = job.ceiling - (job.centre + job.head)
  job.rise = rise < room ? rise : room > 0 ? room : 0
  return job
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
uniform float labelShift;
uniform vec3 backColor;
uniform vec3 frontColor;
varying vec2 vUv;
void main() {
  float x = vUv.x - labelOffset;
  if (x > 1.0 || x < 0.0) discard;
  // labelShift slides the type along the plate (the padding for the diamond moves to the other end); the canvas edge is plain background.
  float text = texture2D(map, vec2(x - labelShift, vUv.y)).r;
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
  /** How far (metres) nearer the lens a prompt the fit moved is drawn; QA sets 0 to see the car hide it. */
  fitPull = FIT_PULL
  private fitOn = true
  private readonly billboards: Billboards
  private readonly controls: PageControls
  private readonly decision: PromptFit = fitState()
  private readonly rising: PromptLift = liftJob()

  readonly group = new THREE.Group()

  constructor(
    private ticker: Ticker,
    private tweens: Tweens,
    private inputs: Inputs,
    private bin: Bin,
    private playerPosition: () => THREE.Vector3,
  ) {
    this.group.name = 'World2 / prompts'
    this.billboards = Billboards.for(ticker)
    this.controls = new PageControls()
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
    // After the billboards: this frame's camera, turn and scale of the label are what it is fitted to.
    const fit = () => this.fit()
    ticker.events.on('tick', fit, AFTER_ORDER)

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
      ticker.events.off('tick', fit)
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
    const height = CANVAS_HEIGHT
    const paddingLeft = item.align === 'left' ? PAD_NEAR : PAD_FAR
    const paddingRight = item.align === 'left' ? PAD_FAR : PAD_NEAR
    item.textStart = paddingLeft
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
    item.labelMesh.scale.x = LABEL_HEIGHT * width / height
    item.labelMesh.scale.y = LABEL_HEIGHT
    this.lay(item)
    // The frustum test must cover the whole label (it hangs off one side of the anchor) and the diamond (corners at √2).
    item.billboard.cull = Math.max(1.5, item.labelMesh.scale.x) + 0.5
  }

  /** The fit of the open prompts to the screen (see `fitPrompt`). Off, every prompt is as authored: QA turns it off to see what the screen would cut. */
  get fitting(): boolean {
    return this.fitOn
  }

  set fitting(on: boolean) {
    this.fitOn = on
    if (on) return
    for (const item of this.items) {
      item.fit.position.set(0, 0, 0)
      item.fit.scale.setScalar(1)
      item.left = item.align === 'right' ? 1 : 0
      item.flipped = false
      item.swap = 0
      item.pull = 0
      item.lift = 0
      item.snap = FIT_SNAP_FRAMES
      this.lay(item)
    }
  }

  /** Hangs the label on the side `item.left` says (1: left of the anchor, 0: right) and moves the type with it: the diamond's padding goes to the anchor's end. */
  private lay(item: Item): void {
    const mesh = item.labelMesh
    mesh.position.x = -mesh.scale.x * item.left
    // Written only when it changed: a uniform's `value` is a tagged field (it also holds textures and colours), so storing a fraction boxes a number.
    const uniform = mesh.material.uniforms.labelShift
    const shift = (PAD_NEAR - (PAD_NEAR - PAD_FAR) * item.left - item.textStart) / item.canvas.width
    if (uniform.value !== shift) uniform.value = shift
  }

  /**
   * Keeps the open prompt inside the picture and clear of the page's controls: which side the label hangs on, how far the prompt
   * slides, how much it shrinks (see `fitPrompt`), how far it is lifted over the interact button (see `liftClear`). Runs every frame
   * for the one open prompt and nothing else; no allocation, no DOM read but two sizes. The prompt's own turn and scale are the
   * billboard's, so it works on `item.fit`, the pivot under it, and `group` stays at the anchor.
   */
  private fit(): void {
    const item = this.active
    if (!this.fitOn || !item || item.state !== 'open') return
    const camera = this.billboards.camera
    if (!camera) return
    const group = item.group
    const at = group.position
    const pm = this.group.matrixWorld.elements
    const x = pm[0] * at.x + pm[4] * at.y + pm[8] * at.z + pm[12]
    const y = pm[1] * at.x + pm[5] * at.y + pm[9] * at.z + pm[13]
    const z = pm[2] * at.x + pm[6] * at.y + pm[10] * at.z + pm[14]
    const me = camera.matrixWorldInverse.elements
    const pe = camera.projectionMatrix.elements
    const depth = -(me[2] * x + me[6] * y + me[10] * z + me[14])
    if (!(depth > 0.5)) return
    const worldScale = group.scale.x * Math.sqrt(pm[0] * pm[0] + pm[1] * pm[1] + pm[2] * pm[2])
    const width = typeof innerWidth === 'number' && innerWidth > 0 ? innerWidth : 1280
    const height = typeof innerHeight === 'number' && innerHeight > 0 ? innerHeight : 800
    const sideways = me[0] * x + me[4] * y + me[8] * z + me[12]
    const upwards = me[1] * x + me[5] * y + me[9] * z + me[13]
    const k = (pe[0] * worldScale) / depth
    const ky = (pe[5] * worldScale) / depth
    const anchor = (pe[0] * sideways) / depth
    // The room: the screen less its margin, less what the page's controls take at the height of this prompt (a strip as tall as its diamond).
    const strip = REACH * ky
    const centre = (pe[5] * upwards) / depth
    const safe = 1 - (2 * FIT_MARGIN_PX) / width
    let lo = -safe
    let hi = safe
    // A prompt that has just opened puts everything at once and reads the page every frame: the interact button shows a frame after it.
    const snap = item.snap > 0
    if (snap) item.snap--
    // The page is read when a prompt has just opened, about four times a second, and when the window changes size; the test is
    // written out here, in the one function that runs every frame, so that no number is boxed on a frame that reads nothing.
    const controls = this.controls
    const clock = this.ticker.elapsed
    if (typeof document !== 'undefined' && (snap || !(clock - controls.at < FIT_HUD_POLL) || width !== controls.seenWidth || height !== controls.seenHeight)) controls.measure(clock, width, height)
    const rects = controls.rects
    for (let i = 0; i < rects.length; i++) {
      const o = rects[i]
      if (o.x0 >= o.x1 || o.y0 > centre + strip || o.y1 < centre - strip) continue
      if (o.x0 + o.x1 > 0) { if (o.x0 < hi) hi = o.x0 } else if (o.x1 > lo) lo = o.x1
    }
    const capPx = (CAP_HEIGHT * worldScale * 0.5 * height * pe[5]) / depth
    const floor = FIT_MIN_CAP_PX / capPx
    // Where the room they leave cannot hold the label even at its smallest, no side of the anchor is clear of the controls: the label
    // takes the whole screen and is lifted clear of them instead (below), as it is of the interact button.
    const blocked = hi - lo < (item.labelMesh.scale.x + REACH) * k * (floor < 1 ? floor : 1)
    if (blocked) { lo = -safe; hi = safe }
    const decision = this.decision
    decision.anchor = anchor
    decision.k = k
    decision.body = item.labelMesh.scale.x
    decision.ownLeft = item.align === 'right'
    decision.lo = lo
    decision.hi = hi
    decision.floor = floor
    decision.swap = (2 * FIT_SWAP_PX) / width
    decision.flipped = item.flipped
    fitPrompt(decision)
    item.flipped = decision.flipped
    const ease = 1 - Math.exp(-FIT_SWAP_RATE * (this.ticker.delta || 1 / 60))
    // A swap of sides slides the label across the diamond and the prompt with it: both candidates are on the screen, so every blend is.
    const swapTo = item.flipped ? 1 : 0
    if (snap) item.swap = swapTo
    else {
      item.swap += (swapTo - item.swap) * ease
      if (Math.abs(swapTo - item.swap) < 0.002) item.swap = swapTo
    }
    const ownLeft = item.align === 'right' ? 1 : 0
    item.left = ownLeft + (1 - 2 * ownLeft) * item.swap
    const shift = decision.own + (decision.other - decision.own) * item.swap
    // Clear of what the label as it stands is still over: the interact button; and, where no side of the anchor was clear of the touch
    // buttons or the speed readout (`blocked`), those too. Lifted by the least that puts the label above them (see `liftClear`).
    const scale = decision.scale
    const body = scale * k * item.labelMesh.scale.x
    const bx = anchor + shift * k
    const keepOuts = controls.keepOuts
    const rising = this.rising
    rising.x0 = bx - body * item.left
    rising.x1 = bx + body * (1 - item.left)
    rising.centre = centre
    rising.half = scale * ky * (LABEL_HEIGHT / 2)
    rising.head = scale * ky * REACH
    rising.ceiling = controls.ceiling
    rising.count = blocked ? keepOuts.length : 1
    rising.slack = (2 * FIT_HUD_SLACK_PX) / width
    liftClear(rising, keepOuts)
    const liftTo = rising.rise / ky
    if (snap) item.lift = liftTo
    else {
      item.lift += (liftTo - item.lift) * ease
      if (Math.abs(liftTo - item.lift) < 0.002) item.lift = liftTo
    }
    // How much the fit moved the prompt: a slide, a lift, a swap or a shrink; on a phone held upright, every open prompt (the car stood
    // in front of the labels it left alone). Where it moved nothing on any other screen the prompt is untouched, as authored.
    let moved = Math.abs(shift * k)
    const raised = Math.abs(item.lift * ky)
    if (raised > moved) moved = raised
    let pull = item.swap > 0 || scale < 1 || (width < FIT_PHONE_WIDTH && height > width) ? 1 : moved / FIT_PULL_SLIDE
    if (pull > 1) pull = 1
    if (snap) item.pull = pull
    else item.pull += (pull - item.pull) * ease
    // Nearer the lens by fraction f along the ray to the anchor, and 1 - f the size: the same picture, in front of what was in front of it.
    const f = (item.pull * this.fitPull) / Math.sqrt(sideways * sideways + upwards * upwards + depth * depth)
    // Written field by field, not through `set(x, y, z)`: a call that is not inlined boxes each number it is handed.
    const pivot = item.fit
    pivot.position.x = ((1 - f) * shift) - (f * sideways) / worldScale
    pivot.position.y = ((1 - f) * item.lift) - (f * upwards) / worldScale
    pivot.position.z = (f * depth) / worldScale
    pivot.scale.x = pivot.scale.y = pivot.scale.z = (1 - f) * scale
    this.lay(item)
  }

  create(options: PromptOptions): PromptHandle {
    const align = options.align ?? 'right'
    const group = new THREE.Group()
    // The authored attitude: what /world2 and the Edit previews (no camera) keep, and what a gameplay camera overrides.
    group.rotation.order = 'YXZ'
    group.rotation.set(-Math.PI * 0.15, Math.PI * 0.25, 0)
    group.position.copy(options.position)
    group.scale.setScalar(0.85)
    this.group.add(group)
    // The authored size at every camera a phone or a desktop has by default (21 m at 16:9, 26 m on a tablet, 31 m on a
    // phone in portrait), it only grows past that — to 1.8x at the phone's 56 m full zoom-out, where the text would
    // otherwise fall under 12 px — and it cancels the frame's own scale (0.7 in Social, 1.1 at the cookies).
    const billboard = Billboards.for(this.ticker).add(group, {
      mode: 'spherical', radius: 250, cull: 10,
      scale: { ref: 31, min: 1, max: 1.8, compensateParent: true },
    })

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
    // Everything the reader sees hangs from this pivot (the fit slides and scales it); `group` stays the billboard and the anchor.
    const fit = new THREE.Group()
    fit.name = 'prompt fit'
    group.add(fit)
    fit.add(diamond)

    const canvas = document.createElement('canvas')
    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = texture.magFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    const labelMesh = new THREE.Mesh(this.labelGeometry, new THREE.ShaderMaterial({
      transparent: true,
      uniforms: { map: { value: texture }, labelOffset: { value: 1 }, labelShift: { value: 0 }, backColor: { value: BACK }, frontColor: { value: FRONT } },
      vertexShader: DIAMOND_VERTEX,
      fragmentShader: LABEL_FRAGMENT,
    }))
    labelMesh.renderOrder = 6
    labelMesh.position.z = -0.01
    labelMesh.visible = false
    fit.add(labelMesh)

    const item: Item = {
      label: options.label, align, at: new THREE.Vector2(options.position.x, options.position.z),
      group, billboard, fit, textStart: PAD_FAR, left: align === 'right' ? 1 : 0, flipped: false, swap: 0, pull: 0, lift: 0, snap: FIT_SNAP_FRAMES,
      diamond, labelMesh, texture, canvas,
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
    item.billboard.remove()
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
    item.snap = FIT_SNAP_FRAMES
    item.diamond.visible = true
    item.labelMesh.visible = true
    item.fit.add(this.keyIcon)
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
