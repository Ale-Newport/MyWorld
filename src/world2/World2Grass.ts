import * as THREE from 'three'
import type { Bin } from '@/world/core/Disposal'
import type { Ticker } from '@/world/core/Ticker'

/* ============================================================
   THE GRASS

   Blender generates every blade and the exporter keeps them:
   one merged mesh, 65,911 triangles, one material. What it does
   not carry is what makes grass read as grass — upstream's
   `World/Grass.js` shades the blade from root to tip and bends it
   in the wind, and none of that survives a glTF material.

   Both are added back here without touching the geometry's
   position data. One pass at load writes a `bladeHeight`
   attribute — within each triangle, 0 at the two base vertices
   and 1 at the tip, which is exactly what a blade is — and the
   standard material is patched through `onBeforeCompile` so it
   keeps the scene's lighting and shadows.
   ============================================================ */

const ROOT = new THREE.Color('#6f8a1f')
const TIP = new THREE.Color('#c6d64a')

export class World2Grass {
  private readonly uniforms = { uTime: { value: 0 }, uRoot: { value: ROOT }, uTip: { value: TIP } }
  private meshes: THREE.Mesh[] = []

  constructor(root: THREE.Object3D, ticker: Ticker, bin: Bin) {
    root.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      if (!materials.some(material => /grass/i.test(material.name ?? ''))) return
      this.dress(node)
    })
    if (!this.meshes.length) return

    const tick = () => { this.uniforms.uTime.value = ticker.elapsed }
    ticker.events.on('tick', tick, 15)
    bin.add(() => ticker.events.off('tick', tick))
  }

  get meshCount(): number { return this.meshes.length }

  private dress(mesh: THREE.Mesh): void {
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry
    if (geometry !== mesh.geometry) { mesh.geometry.dispose(); mesh.geometry = geometry }

    const position = geometry.getAttribute('position')
    const heights = new Float32Array(position.count)
    // Each blade is one triangle: two vertices on the ground, one at the tip.
    for (let i = 0; i < position.count; i += 3) {
      const y0 = position.getY(i), y1 = position.getY(i + 1), y2 = position.getY(i + 2)
      const low = Math.min(y0, y1, y2)
      const span = Math.max(y0, y1, y2) - low
      if (span < 1e-5) { heights[i] = heights[i + 1] = heights[i + 2] = 0; continue }
      heights[i] = (y0 - low) / span
      heights[i + 1] = (y1 - low) / span
      heights[i + 2] = (y2 - low) / span
    }
    geometry.setAttribute('bladeHeight', new THREE.BufferAttribute(heights, 1))

    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    material.onBeforeCompile = shader => {
      shader.uniforms.uTime = this.uniforms.uTime
      shader.uniforms.uRoot = this.uniforms.uRoot
      shader.uniforms.uTip = this.uniforms.uTip
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          attribute float bladeHeight;
          uniform float uTime;
          varying float vBlade;
          varying float vTint;
        `)
        .replace('#include <begin_vertex>', `
          #include <begin_vertex>
          vBlade = bladeHeight;
          vec4 grassWorld = modelMatrix * vec4(transformed, 1.0);
          // Two waves at different speeds so the field never pulses in step.
          float sway = sin(grassWorld.x * 0.6 + uTime * 1.1)
                     + sin(grassWorld.z * 0.45 - uTime * 0.7) * 0.6;
          // Bend from the root: the tip travels, the base does not.
          float bend = bladeHeight * bladeHeight * 0.11;
          transformed.x += sway * bend;
          transformed.z += sway * bend * 0.6;
          // A little per-blade colour variation, keyed off where it grows.
          vTint = fract(sin(grassWorld.x * 12.9898 + grassWorld.z * 78.233) * 43758.5453);
        `)
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          uniform vec3 uRoot;
          uniform vec3 uTip;
          varying float vBlade;
          varying float vTint;
        `)
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          vec3 blade = mix(uRoot, uTip, clamp(vBlade, 0.0, 1.0));
          blade *= 0.88 + vTint * 0.24;
          diffuseColor.rgb = blade;
        `)
    }
    material.needsUpdate = true
    // Blades are thin and one-sided in the source; lighting reads better with
    // both faces shaded, and they should take the island's shadows.
    material.side = THREE.DoubleSide
    material.roughness = 0.95
    mesh.receiveShadow = true
    mesh.castShadow = false
    this.meshes.push(mesh)
  }
}
