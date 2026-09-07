import * as THREE from 'three'

/* ============================================================
   DISPOSAL

   Upstream never tears down — folio-2025 is a single-page app
   that owns the tab for its whole life. This route does not have
   that luxury: leaving /world must return every byte, or a
   visitor who opens the world, goes back to the portfolio and
   opens it again pays twice.

   Everything that allocates registers here. `Bin.dispose()` runs
   in reverse order of registration, so children go before their
   parents.
   ============================================================ */

export type Disposer = () => void

export class Bin {
  private disposers: Disposer[] = []
  private disposed = false

  /** Registers a teardown callback. Returns it for convenience. */
  add(disposer: Disposer): Disposer {
    if (this.disposed) {
      disposer()
      return disposer
    }
    this.disposers.push(disposer)
    return disposer
  }

  /** Adds a DOM listener and its removal in one call. */
  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (event: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void
  listen(
    target: EventTarget,
    type: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler, options)
    this.add(() => target.removeEventListener(type, handler, options))
  }

  /** `setTimeout` that is cancelled on disposal. */
  timeout(callback: () => void, ms: number): number {
    const id = window.setTimeout(callback, ms)
    this.add(() => window.clearTimeout(id))
    return id
  }

  /** `setInterval` that is cancelled on disposal. */
  interval(callback: () => void, ms: number): number {
    const id = window.setInterval(callback, ms)
    this.add(() => window.clearInterval(id))
    return id
  }

  /** Registers a three.js object graph for full geometry/material/texture disposal. */
  object3D(object: THREE.Object3D): void {
    this.add(() => disposeObject(object))
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (let i = this.disposers.length - 1; i >= 0; i--) {
      try {
        this.disposers[i]()
      } catch (error) {
        if (process.env.NODE_ENV === 'development') console.warn('[world] disposer threw', error)
      }
    }
    this.disposers.length = 0
  }

  get size(): number {
    return this.disposers.length
  }
}

const disposedMaterials = new WeakSet<THREE.Material>()
const disposedGeometries = new WeakSet<THREE.BufferGeometry>()
const disposedTextures = new WeakSet<THREE.Texture>()

function disposeMaterial(material: THREE.Material): void {
  if (disposedMaterials.has(material)) return
  disposedMaterials.add(material)

  // Textures hang off arbitrarily named slots; walk the instance.
  for (const value of Object.values(material as unknown as Record<string, unknown>)) {
    if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
      disposedTextures.add(value)
      value.dispose()
    }
  }

  const uniforms = (material as THREE.ShaderMaterial).uniforms
  if (uniforms) {
    for (const uniform of Object.values(uniforms)) {
      const value = uniform?.value
      if (value instanceof THREE.Texture && !disposedTextures.has(value)) {
        disposedTextures.add(value)
        value.dispose()
      }
    }
  }

  material.dispose()
}

/** Recursively frees geometries, materials and textures under `root`. */
export function disposeObject(root: THREE.Object3D): void {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry && !disposedGeometries.has(mesh.geometry)) {
      disposedGeometries.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const material = (mesh as unknown as { material?: THREE.Material | THREE.Material[] }).material
    if (Array.isArray(material)) material.forEach(disposeMaterial)
    else if (material) disposeMaterial(material)
  })
  root.removeFromParent()
  root.clear()
}
