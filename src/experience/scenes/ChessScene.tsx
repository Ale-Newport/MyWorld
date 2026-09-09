'use client'

import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { frame } from '@/state/journey'
import { readChapterProgress } from '@/hooks/useChapterProgress'
import { clamp, damp, range, easeOutCubic } from '@/lib/math'

/* ============================================================
   CHESS — the board resolves out of the data.
   The 2D computer-vision pipeline is drawn in the DOM layer
   (ChessMotion). This scene is what it resolves INTO: 64
   squares that fly in from scattered detection positions and
   settle into a clean board, then a best-move arc.
   ============================================================ */

/** Starting position, as the pipeline would reconstruct it. */
const dummy = new THREE.Object3D()
const color = new THREE.Color()
const ACCENT = new THREE.Color('#d4491f')

/* Value scale, inverted for paper. These are albedos, and the only lit
   geometry on the page: ambient 0.5 plus a key at 1.1 lands a top face
   at roughly two fifths of its albedo, so the board reads a good deal
   darker than these numbers look. The old scale ran 0.88 down to 0.10,
   i.e. a white army on a black ground — carried onto white paper that
   is a half-empty checker with one side missing. So "light" now means
   the lighter of two graphites, never the page itself, and both armies
   sit below their squares so a piece always reads as a mark on the
   board rather than a hole in it. */
const SQUARE_LIGHT = 0.45
const SQUARE_DARK = 0.10
const PIECE_PALE = 0.30
const PIECE_DARK = 0.045

const START_RANKS = ['rnbqkbnr', 'pppppppp', '........', '........', '........', '........', 'PPPPPPPP', 'RNBQKBNR']

interface Square { file: number; rank: number; scatterX: number; scatterY: number; scatterZ: number; delay: number }

export function ChessScene() {
  const group = useRef<THREE.Group>(null!)
  const squares = useRef<THREE.InstancedMesh>(null!)
  const pieces = useRef<THREE.InstancedMesh>(null!)
  const opacity = useRef(0)

  const layout = useMemo<Square[]>(() => {
    const out: Square[] = []
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const i = r * 8 + f
        // Deterministic scatter — the "detected crops" origin.
        const a = (i * 2.399963) % (Math.PI * 2)
        // Tight scatter: the squares gather from just outside the
        // board, not from off-screen. A wide scatter reads as debris.
        const rad = 2.6 + ((i * 7) % 11) * 0.16
        out.push({
          file: f, rank: r,
          scatterX: Math.cos(a) * rad,
          scatterY: 0.9 + ((i * 13) % 9) * 0.22,
          scatterZ: Math.sin(a) * rad,
          delay: ((i * 17) % 64) / 64,
        })
      }
    }
    return out
  }, [])

  const piecePositions = useMemo(() => {
    const out: { file: number; rank: number; white: boolean; tall: number }[] = []
    START_RANKS.forEach((row, r) => {
      row.split('').forEach((ch, f) => {
        if (ch === '.') return
        const white = ch === ch.toUpperCase()
        const tall = 'kq'.includes(ch.toLowerCase()) ? 0.52 : 'rbn'.includes(ch.toLowerCase()) ? 0.38 : 0.26
        out.push({ file: f, rank: r, white, tall })
      })
    })
    return out
  }, [])

  const arcLine = useMemo(() => {
    // e2 → e4: the first move any engine plays.
    const from = new THREE.Vector3((4 - 3.5) * 0.62, 0.3, (6 - 3.5) * 0.62)
    const to = new THREE.Vector3((4 - 3.5) * 0.62, 0.3, (4 - 3.5) * 0.62)
    const mid = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, 1.1, 0))
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to)
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48))
    const m = new THREE.LineBasicMaterial({ color: '#d4491f', transparent: true, opacity: 0 })
    return new THREE.Line(g, m)
  }, [])

  useFrame((_, dt) => {
    const d = Math.min(0.05, dt)
    const t = readChapterProgress('chess')

    const vis = Math.min(range(t, 0.52, 0.60), 1 - range(t, 0.96, 1))
    opacity.current = damp(opacity.current, clamp(vis), 4, d)
    group.current.visible = opacity.current > 0.005
    if (!group.current.visible) return

    // Assembly: squares fly in from their scatter positions.
    const assemble = range(t, 0.54, 0.78)

    for (let i = 0; i < 64; i++) {
      const s = layout[i]
      const local = clamp((assemble - s.delay * 0.35) / 0.65)
      const e = easeOutCubic(local)
      const tx = (s.file - 3.5) * 0.62
      const tz = (s.rank - 3.5) * 0.62
      dummy.position.set(
        THREE.MathUtils.lerp(s.scatterX, tx, e),
        THREE.MathUtils.lerp(s.scatterY, 0, e),
        THREE.MathUtils.lerp(s.scatterZ, tz, e),
      )
      dummy.rotation.set((1 - e) * 2.4, (1 - e) * 1.8, 0)
      dummy.scale.set(0.58, 0.05 + e * 0.02, 0.58)
      dummy.updateMatrix()
      squares.current.setMatrixAt(i, dummy.matrix)

      const light = (s.file + s.rank) % 2 === 0
      color.setScalar(light ? SQUARE_LIGHT : SQUARE_DARK)
      // Squares still "in flight" carry the detection accent.
      color.lerp(ACCENT, (1 - e) * 0.35)
      squares.current.setColorAt(i, color)
    }
    squares.current.instanceMatrix.needsUpdate = true
    if (squares.current.instanceColor) squares.current.instanceColor.needsUpdate = true

    // Pieces rise once the board is solid.
    const rise = range(t, 0.74, 0.88)
    for (let i = 0; i < piecePositions.length; i++) {
      const p = piecePositions[i]
      const local = clamp((rise - (i / piecePositions.length) * 0.4) / 0.6)
      const e = easeOutCubic(local)
      dummy.position.set((p.file - 3.5) * 0.62, p.tall * 0.5 * e, (p.rank - 3.5) * 0.62)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(0.2, Math.max(0.001, p.tall * e), 0.2)
      dummy.updateMatrix()
      pieces.current.setMatrixAt(i, dummy.matrix)
      color.setScalar(p.white ? PIECE_PALE : PIECE_DARK)
      pieces.current.setColorAt(i, color)
    }
    pieces.current.instanceMatrix.needsUpdate = true
    if (pieces.current.instanceColor) pieces.current.instanceColor.needsUpdate = true

    ;(squares.current.material as THREE.MeshStandardMaterial).opacity = opacity.current
    ;(pieces.current.material as THREE.MeshStandardMaterial).opacity = opacity.current

    // Best move arc draws last.
    const arcT = range(t, 0.88, 0.97)
    arcLine.visible = arcT > 0.01
    arcLine.geometry.setDrawRange(0, Math.round(arcT * 49))
    ;(arcLine.material as THREE.LineBasicMaterial).opacity = opacity.current * 0.95

    group.current.rotation.y = damp(group.current.rotation.y, frame.pointerX * 0.32 - 0.22, 2.4, d)
    group.current.position.set(0.4, -0.35, 0)
    group.current.scale.setScalar(0.78)
  })

  return (
    <group ref={group}>
      <instancedMesh ref={squares} args={[undefined, undefined, 64]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial transparent opacity={0} roughness={0.62} metalness={0.08} toneMapped={false} />
      </instancedMesh>

      <instancedMesh ref={pieces} args={[undefined, undefined, 32]} frustumCulled={false}>
        <cylinderGeometry args={[1, 1.25, 1, 12]} />
        <meshStandardMaterial transparent opacity={0} roughness={0.45} metalness={0.12} toneMapped={false} />
      </instancedMesh>

      <primitive object={arcLine} />
    </group>
  )
}
