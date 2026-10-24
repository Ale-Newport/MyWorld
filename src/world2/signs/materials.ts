import * as THREE from 'three'
import { PALETTE_HEX, SWATCH_COUNT } from './palette'

/* ============================================================
   TWO MATERIAL PROGRAMS, BOTH ALREADY IN THE WORLD

   Wood, rope, iron and leaves sample the level's own palette
   material (the instance's, so a new nail is indistinguishable
   from an authored one). Faces are a MeshStandardMaterial with
   `map`, `emissiveMap` and DoubleSide — the very material the
   Projects screen has always used — so a sign appearing for the
   first time never makes the GPU compile a new shader.

   The emissive lift is the answer to a measured fact: the sun
   meets the boards' faces at N.L ~ 0.1, so a purely lit parchment
   would read as mud. Two fifths of the painted colour are added back,
   which keeps paper bright and ink dark while the wood around it
   is still shaded by the sun.
   ============================================================ */

/** How much of a face's own colour is added on top of the lighting. */
export const FACE_EMISSIVE = 0.4

export interface FaceOptions {
  /** Overrides FACE_EMISSIVE. */
  emissive?: number
  /** For faces with rounded or cut-out edges. */
  transparent?: boolean
}

export interface SignMaterials {
  /** The palette material hardware samples through UV-addressed swatches. */
  readonly wood: THREE.Material
  /** True when the kit built (and so must dispose) the palette material itself. */
  readonly owned: boolean
  /** A lit, emissive-lifted face for `map`. Disposed with the set. */
  face(map: THREE.Texture, options?: FaceOptions): THREE.MeshStandardMaterial
  dispose(): void
}

/** The first palette-atlas material found under `root` (the level's wood). */
export function findPaletteMaterial(root: THREE.Object3D | null | undefined): THREE.Material | null {
  let found: THREE.Material | null = null
  root?.traverse(node => {
    if (found || !(node as THREE.Mesh).isMesh) return
    const material = (node as THREE.Mesh).material
    for (const m of Array.isArray(material) ? material : [material]) {
      if (m instanceof THREE.MeshStandardMaterial && m.map?.name === 'palette') { found = m; return }
    }
  })
  return found
}

/** A standalone atlas for places with no level around (tests, previews). Same layout: 32 swatches, nearest filtered. */
function standalonePalette(): THREE.MeshStandardMaterial {
  const data = new Uint8Array(SWATCH_COUNT * 4)
  PALETTE_HEX.forEach((hex, i) => {
    data[i * 4] = parseInt(hex.slice(1, 3), 16)
    data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16)
    data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16)
    data[i * 4 + 3] = 255
  })
  const map = new THREE.DataTexture(data, SWATCH_COUNT, 1, THREE.RGBAFormat)
  map.name = 'palette'
  map.colorSpace = THREE.SRGBColorSpace
  map.magFilter = THREE.NearestFilter
  map.minFilter = THREE.NearestFilter
  map.needsUpdate = true
  return new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0, side: THREE.DoubleSide })
}

/**
 * The materials a family of signs shares. Pass the level's palette material (or any object that has one
 * under it: an environment group, a prefab frame) so hardware matches it exactly; with nothing, or nothing
 * found, a standalone atlas is built and owned by the set.
 */
export function signMaterials(source?: THREE.Object3D | THREE.Material | null): SignMaterials {
  const given = source instanceof THREE.Material ? source : findPaletteMaterial(source)
  const wood = given ?? standalonePalette()
  const owned = !given
  const faces: THREE.MeshStandardMaterial[] = []
  return {
    wood,
    owned,
    face(map, options = {}) {
      const material = new THREE.MeshStandardMaterial({
        map, emissiveMap: map, emissive: new THREE.Color(0xffffff),
        emissiveIntensity: options.emissive ?? FACE_EMISSIVE,
        roughness: 0.9, metalness: 0,
        side: THREE.DoubleSide, transparent: options.transparent ?? false,
      })
      faces.push(material)
      return material
    },
    dispose() {
      for (const face of faces) face.dispose()
      faces.length = 0
      if (owned) { (wood as THREE.MeshStandardMaterial).map?.dispose(); wood.dispose() }
    },
  }
}
