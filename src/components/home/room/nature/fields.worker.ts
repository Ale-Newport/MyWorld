/* The surface fields, off the main thread: the room asks for a hall's
   fields when it knows its layout, and keeps building the hall and
   gathering its light while this works. The arrays come back
   transferred, not copied. */
import { computeSurfaceFields } from './fields'
import type { RoomPlan } from '../scene/compositions'

interface Job { id: number; plan: RoomPlan; soffit: number; floorDepth: number; seed: number }

self.onmessage = async (event: MessageEvent<Job>) => {
  const { id, plan, soffit, floorDepth, seed } = event.data
  try {
    const f = await computeSurfaceFields(plan, soffit, floorDepth, seed)
    const transfer = [f.wall.data.buffer, f.floor.data.buffer, f.weather.data.buffer] as ArrayBuffer[]
    ;(self as unknown as Worker).postMessage({ id, fields: f }, transfer)
  } catch (error) {
    ;(self as unknown as Worker).postMessage({ id, error: String(error) })
  }
}
