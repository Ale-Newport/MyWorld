import * as THREE from 'three'

/* ============================================================
   A SURFACE IN THE WORLD, NOT A PANEL OVER IT

   Every screen, board and sign in World2 is a canvas painted at
   a real resolution and hung on a plane at the transform Blender
   authored. Upstream does the same thing with `TextCanvas`; the
   only additions here are anisotropy (these are read at a glancing
   angle from a car) and a restrained emissive term, so a board
   stays legible in daylight without glowing like a lamp.
   ============================================================ */

export interface ScreenOptions {
  /** Canvas pixels. Pick for legibility at the distance it is read from. */
  width: number
  height: number
  /** Metres across in the world. Height follows from the canvas aspect. */
  worldWidth: number
  /** 0 keeps it fully lit by the scene; ~0.6 reads as a lit panel. */
  emissive?: number
  transparent?: boolean
  /**
   * Set false when this material is bound onto a mesh that came out of the
   * glTF. Blender-authored UVs put v = 0 at the top, which is the opposite of
   * three.js's default for a canvas — leave it true and the board renders
   * upside down.
   */
  flipY?: boolean
  /**
   * The material is for a mesh the model already has (a CRT's glass, a leaderboard's face), so the plane this screen would
   * otherwise hang in the world is never built. `mesh` still works for a caller that asks: it builds the plane then.
   */
  authored?: boolean
}

export class Screen {
  readonly group = new THREE.Group()
  readonly material: THREE.MeshStandardMaterial
  readonly canvas: HTMLCanvasElement
  readonly context: CanvasRenderingContext2D
  readonly texture: THREE.CanvasTexture
  readonly width: number
  readonly height: number
  private plane: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> | null = null
  private readonly worldWidth: number
  private readonly worldHeight: number

  constructor(options: ScreenOptions) {
    this.width = options.width
    this.height = options.height
    this.canvas = document.createElement('canvas')
    this.canvas.width = options.width
    this.canvas.height = options.height
    const context = this.canvas.getContext('2d')
    if (!context) throw new Error('World2: 2D canvas is unavailable, so in-world screens cannot be painted.')
    this.context = context

    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.flipY = options.flipY ?? true
    this.texture.colorSpace = THREE.SRGBColorSpace
    this.texture.anisotropy = 8
    this.texture.minFilter = THREE.LinearMipmapLinearFilter
    this.texture.magFilter = THREE.LinearFilter

    this.worldWidth = options.worldWidth
    this.worldHeight = options.worldWidth * (options.height / options.width)
    this.material = new THREE.MeshStandardMaterial({
      map: this.texture,
      emissiveMap: this.texture,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: options.emissive ?? 0.55,
      roughness: 0.85,
      metalness: 0,
      transparent: options.transparent ?? false,
      side: THREE.DoubleSide,
      toneMapped: true,
    })
    if (!options.authored) void this.mesh
  }

  /** The plane this screen hangs in the world. An `authored` screen has none until somebody asks for one. */
  get mesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
    if (!this.plane) {
      this.plane = new THREE.Mesh(new THREE.PlaneGeometry(this.worldWidth, this.worldHeight), this.material)
      this.group.add(this.plane)
    }
    return this.plane
  }

  draw(paint: (context: CanvasRenderingContext2D) => void): void {
    this.context.save()
    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, this.width, this.height)
    paint(this.context)
    this.context.restore()
    this.texture.needsUpdate = true
  }

  /** Wraps `text` to `maxWidth` canvas pixels and returns the lines. */
  wrap(text: string, maxWidth: number): string[] {
    const words = text.split(/\s+/)
    const lines: string[] = []
    let line = ''
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word
      if (this.context.measureText(candidate).width > maxWidth && line) { lines.push(line); line = word }
      else line = candidate
    }
    if (line) lines.push(line)
    return lines
  }

  destroy(): void {
    this.plane?.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
    this.group.removeFromParent()
  }
}
