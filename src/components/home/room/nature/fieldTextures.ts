import * as THREE from 'three'
import { computeSurfaceFields, type FieldMap, type SurfaceFieldData } from './fields'
import type { RoomPlan } from '../scene/compositions'

/* ============================================================
   SURFACE FIELDS → TEXTURES, AND WHERE THEY ARE COMPUTED

   `FieldBaker` computes a hall's fields in a worker when the
   browser can run one (the arithmetic is ~0.3 s on a fast laptop
   and several times that on a phone — none of it needs to be on
   the thread that hydrates the page and draws the frames), and on
   the main thread, in short slices, when it cannot.
   ============================================================ */

export interface SurfaceFields {
  wall: THREE.DataTexture
  floor: THREE.DataTexture
  weather: THREE.DataTexture
  /** x0, y0, width, height of the wall map, metres. */
  wallRect: THREE.Vector4
  /** x0, z0, width, depth of the floor map, metres. */
  floorRect: THREE.Vector4
}

const texture = ({ data, w, h }: FieldMap) => {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType)
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.wrapS = THREE.ClampToEdgeWrapping
  t.wrapT = THREE.ClampToEdgeWrapping
  t.colorSpace = THREE.NoColorSpace
  t.anisotropy = 8
  t.needsUpdate = true
  return t
}

export function fieldsToTextures(f: SurfaceFieldData): SurfaceFields {
  return {
    wall: texture(f.wall),
    floor: texture(f.floor),
    weather: texture(f.weather),
    wallRect: new THREE.Vector4(...f.wallRect),
    floorRect: new THREE.Vector4(...f.floorRect),
  }
}

export class FieldBaker {
  private worker: Worker | null = null
  private unavailable = false
  private next = 1
  private pending = new Map<number, { resolve: (f: SurfaceFieldData) => void; reject: (e: unknown) => void }>()

  constructor(private pause: () => Promise<void>) {}

  /* The worker exists only while it has work: made for a bake, let go
     once the last answer is in (a hall is baked once per layout class,
     so there is nothing to keep it for). */
  private ensure(): Worker | null {
    if (this.worker || this.unavailable || typeof Worker === 'undefined') return this.worker
    try {
      const w = new Worker(new URL('./fields.worker.ts', import.meta.url), { type: 'module', name: 'room-fields' })
      w.onmessage = (e: MessageEvent<{ id: number; fields?: SurfaceFieldData; error?: string }>) => {
        const job = this.pending.get(e.data.id)
        if (!job) return
        this.pending.delete(e.data.id)
        if (e.data.fields) job.resolve(e.data.fields)
        else job.reject(new Error(e.data.error ?? 'fields worker failed'))
        if (!this.pending.size) this.release()
      }
      w.onerror = () => {
        this.unavailable = true
        this.fail()
      }
      this.worker = w
    } catch {
      this.unavailable = true
    }
    return this.worker
  }

  private release() {
    this.worker?.terminate()
    this.worker = null
  }

  /** A worker that cannot start (blocked, or an engine without module workers) hands its jobs back to the main thread. */
  private fail() {
    this.release()
    for (const job of this.pending.values()) job.reject(new Error('fields worker unavailable'))
    this.pending.clear()
  }

  async bake(plan: RoomPlan, soffit: number, floorDepth: number, seed: number): Promise<SurfaceFieldData> {
    const worker = this.ensure()
    if (worker) {
      const id = this.next++
      try {
        return await new Promise<SurfaceFieldData>((resolve, reject) => {
          // A worker that never answers (a stalled load) is not waited on forever.
          const timer = setTimeout(() => {
            this.pending.delete(id)
            if (!this.pending.size) this.release()
            reject(new Error('fields worker timed out'))
          }, 6000)
          this.pending.set(id, { resolve: (f) => { clearTimeout(timer); resolve(f) }, reject: (e) => { clearTimeout(timer); reject(e) } })
          worker.postMessage({ id, plan, soffit, floorDepth, seed })
        })
      } catch {
        // Fall through to the main thread.
      }
    }
    return computeSurfaceFields(plan, soffit, floorDepth, seed, this.pause)
  }

  dispose() {
    this.fail()
  }
}
