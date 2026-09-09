'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import {
  archiveIslands,
  clientTowers,
  districts,
  landmarks,
  ramps,
  roads,
  WORLD_RADIUS,
  type DistrictId,
} from '@/content/world'
import styles from './map.module.css'
import { BRIDGES, CIRCUIT, CIRCUIT_TRACK, FOREST_POCKETS, PLAY_SPOTS, WATERFALL, coastRadius } from '@/content/world-environment'

/* ============================================================
   MAP

   Drawn to a canvas rather than composed from DOM nodes: it has
   a few hundred marks on it and the player arrow has to move
   smoothly, and a canvas is both cheaper and easier to keep
   visually consistent with the world's own drawing.

   It is the site's design language, not a game minimap — thin
   rules, mono labels, one accent colour, no colour-coded key.

   The ground under those marks is painted from the SAME R/G/B/A mask
   the world's own materials read: R paving, G grass, B water depth,
   A height. So the coastline, the water and the paving on the map are
   the coastline, water and paving you drive on — not a second drawing
   of them that can quietly disagree. Baked once into an offscreen
   canvas and blitted, because sampling it per frame would cost more
   than the rest of the map put together.

   Discovery matters. Districts you have not entered are drawn as
   outlines with no name; secrets do not appear at all until
   found. The map is a record of where you have been, so exploring
   is worth something.
   ============================================================ */

interface Props {
  store: WorldStore
  getGame: () => Game | null
}

/** World metres → map pixels. The map is square and world-centred. */
const SPAN = WORLD_RADIUS * 2.05

export function WorldMap({ store, getGame }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState(560)
  const currentDistrict = useStore(store, (s) => s.district)

  useEffect(() => {
    const canvas = canvasRef.current
    const game = getGame()
    if (!canvas || !game) return

    const measure = () => {
      const rect = canvas.parentElement?.getBoundingClientRect()
      if (rect) setSize(Math.max(240, Math.min(rect.width, rect.height)))
    }
    measure()

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = size * dpr
    canvas.height = size * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const visited = new Set(game.save.data.progress.districts)
    const foundSecrets = new Set(game.save.data.progress.secrets)

    /* World → map pixel. */
    const px = (x: number) => ((x + SPAN / 2) / SPAN) * size
    const py = (z: number) => ((z + SPAN / 2) / SPAN) * size

    const css = getComputedStyle(document.documentElement)
    const ink = css.getPropertyValue('--ink').trim() || '#0c0c0d'
    const ink3 = css.getPropertyValue('--ink-3').trim() || '#75757c'
    const ink4 = css.getPropertyValue('--ink-4').trim() || '#a6a6ad'
    const accent = css.getPropertyValue('--accent').trim() || '#d4491f'
    const paper2 = css.getPropertyValue('--paper-2').trim() || '#eceae5'

    /* ---- the ground, painted from the world's own mask ----
       One pass, cached. `terrain.mask` is the texture the grass and
       the materials sample; reading it here is what keeps the map and
       the island the same shape. */
    const groundLayer = document.createElement('canvas')
    const GROUND = 320
    groundLayer.width = GROUND
    groundLayer.height = GROUND
    {
      const gctx = groundLayer.getContext('2d')
      const mask = game.world.terrain.mask
      const data = mask.image.data as Uint8Array
      const maskSize = mask.image.width
      const extent = game.world.terrain.maskExtent
      if (gctx) {
        const out = gctx.createImageData(GROUND, GROUND)
        for (let j = 0; j < GROUND; j++) {
          for (let i = 0; i < GROUND; i++) {
            // Map pixel → world metres → mask texel.
            const wx = ((i + 0.5) / GROUND) * SPAN - SPAN / 2
            const wz = ((j + 0.5) / GROUND) * SPAN - SPAN / 2
            const u = Math.round(((wx + extent) / (extent * 2)) * maskSize)
            const v = Math.round(((wz + extent) / (extent * 2)) * maskSize)
            const o = (j * GROUND + i) * 4
            if (u < 0 || v < 0 || u >= maskSize || v >= maskSize) {
              out.data[o] = 0x3f; out.data[o + 1] = 0x77; out.data[o + 2] = 0x8b; out.data[o + 3] = 255
              continue
            }
            const m = (v * maskSize + u) * 4
            const paved = data[m] / 255
            const grass = data[m + 1] / 255
            const depth = data[m + 2] / 255
            const height = (data[m + 3] / 255) * game.world.terrain.maskHeightScale
              + game.world.terrain.maskHeightBias

            const radius = Math.hypot(wx, wz)
            const coast = coastRadius(wx, wz, WORLD_RADIUS)
            let r: number, g: number, b: number
            if (radius > coast) {
              // Open sea, shelving away from the shore. The shallows
              // ring the island the way they do in the world.
              const off = Math.min(1, (radius - coast) / 40)
              r = 104 - off * 62; g = 178 - off * 96; b = 190 - off * 74
            } else if (depth > 0.03) {
              // Inland water: the lakes and the river, deepening.
              const d = Math.min(1, depth * 1.4)
              r = 118 - d * 60; g = 190 - d * 78; b = 184 - d * 58
            } else {
              // Land. Green that lightens with elevation, sand at the
              // shore, warm pale where the ground is paved.
              const lift = Math.max(0, Math.min(1, (height + 2) / 15))
              const shore = Math.max(0, 1 - Math.min(1, (coast - radius) / 18))
              r = 128 + lift * 52; g = 156 + lift * 40; b = 92 + lift * 44
              r = r * (1 - shore) + 226 * shore
              g = g * (1 - shore) + 210 * shore
              b = b * (1 - shore) + 168 * shore
              r = r * (1 - paved) + 234 * paved
              g = g * (1 - paved) + 231 * paved
              b = b * (1 - paved) + 216 * paved
              // Grass reads a touch cooler and darker than bare ground.
              r -= grass * 14; g -= grass * 4; b -= grass * 8
            }
            out.data[o] = Math.max(0, Math.min(255, r))
            out.data[o + 1] = Math.max(0, Math.min(255, g))
            out.data[o + 2] = Math.max(0, Math.min(255, b))
            out.data[o + 3] = 255
          }
        }
        gctx.putImageData(out, 0, 0)
      }
    }

    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, size, size)
      // The island, its water and its paving, straight off the mask the
      // world itself reads.
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(groundLayer, 0, 0, size, size)

      // Woodland masses sit on top: they are placement data, not ground.
      for (const [x, z, radius] of FOREST_POCKETS) {
        ctx.beginPath(); ctx.ellipse(px(x), py(z), radius / SPAN * size, radius / SPAN * size * .85, -.3, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(84,112,68,0.30)'; ctx.fill()
        ctx.beginPath(); ctx.arc(px(x), py(z), radius / SPAN * size * .5, 0, Math.PI * 2)
        ctx.fillStyle = 'rgba(70,96,58,0.28)'; ctx.fill()
      }
      ctx.fillStyle = '#e9f3da'; ctx.fillRect(px(WATERFALL.x)-3,py(WATERFALL.z)-2,6,4)

      /* ---- roads --------------------------------------- */
      ctx.strokeStyle = ink4
      ctx.lineWidth = 1.5
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (const road of roads) {
        ctx.lineWidth = Math.max(1.5, road.width / SPAN * size)
        ctx.beginPath()
        road.points.forEach(([x, z], i) => {
          if (i === 0) ctx.moveTo(px(x), py(z))
          else ctx.lineTo(px(x), py(z))
        })
        ctx.stroke()
      }
      // Along the deck's own bearing, like the deck itself. Drawn
      // due east regardless of rotation, these used to cross their
      // own rivers at right angles to the crossing.
      for (const bridge of BRIDGES) {
        const dx = Math.cos(bridge.rotation) * bridge.length / 2
        const dz = Math.sin(bridge.rotation) * bridge.length / 2
        ctx.strokeStyle = '#f4e8c9'; ctx.lineWidth = bridge.width / SPAN * size
        ctx.beginPath()
        ctx.moveTo(px(bridge.x - dx), py(bridge.z - dz))
        ctx.lineTo(px(bridge.x + dx), py(bridge.z + dz))
        ctx.stroke()
      }

      // The circuit comes from the SAME spline the terrain flattens
      // and the ecology keeps off, not from the running mini-game —
      // so the track is on the map whether or not the race has been
      // registered yet, and the two can never disagree.
      ctx.beginPath()
      CIRCUIT_TRACK.forEach(([x, z], i) => {
        if (i) ctx.lineTo(px(x), py(z))
        else ctx.moveTo(px(x), py(z))
      })
      ctx.strokeStyle = '#4c4b4f'
      ctx.lineWidth = Math.max(2, CIRCUIT.width / SPAN * size)
      ctx.stroke()

      /* ---- districts ----------------------------------- */
      ctx.font = '500 9px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      // A district is a MARKER, not a disc. The ground layer already
      // shows the paving of the ones that have any, and most of them
      // are clearings with no footprint at all — drawing a ring for
      // every district was drawing something that is not there, which
      // is exactly the "circles on a lawn" reading the world itself no
      // longer has.
      for (const district of districts) {
        if (district.secret && !foundSecrets.has(district.id)) continue
        const seen = visited.has(district.id)
        const x = px(district.x)
        const y = py(district.z)
        const here = district.id === currentDistrict
        const pin = here ? 5.2 : 4

        // A diamond, like the reference's, so a place reads as a place
        // at any zoom rather than as a circle competing with the ground.
        ctx.beginPath()
        ctx.moveTo(x, y - pin); ctx.lineTo(x + pin, y)
        ctx.lineTo(x, y + pin); ctx.lineTo(x - pin, y)
        ctx.closePath()
        ctx.fillStyle = seen ? (here ? accent : paper2) : 'rgba(255,255,255,0.35)'
        ctx.fill()
        ctx.strokeStyle = seen ? (here ? accent : ink) : ink4
        ctx.lineWidth = here ? 1.6 : 1
        ctx.stroke()

        if (seen) {
          const label = district.short
          const width = ctx.measureText(label).width
          ctx.fillStyle = 'rgba(250,249,245,0.82)'
          ctx.fillRect(x - width / 2 - 3, y + pin + 2, width + 6, 11)
          ctx.fillStyle = here ? accent : ink
          ctx.fillText(label, x, y + pin + 8)
        } else {
          ctx.fillStyle = ink4
          ctx.fillText('?', x, y + pin + 8)
        }
      }

      /* ---- ramps ---------------------------------------
         A chevron pointing the way the ramp launches. The map used
         to draw none of them, so the one feature that changes where
         you can GET to was invisible on it. */
      ctx.strokeStyle = '#b8703a'
      ctx.lineWidth = 1.2
      for (const ramp of ramps) {
        // The stunt ramp is how the hidden island is reached; it stays
        // off the map until that island has been found.
        if (ramp.id === 'ramp-stunt' && !foundSecrets.has('hiddenIsland')) continue
        const x = px(ramp.x)
        const y = py(ramp.z)
        const a = ramp.rotation
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(a)
        ctx.beginPath()
        ctx.moveTo(-3.4, 2.4); ctx.lineTo(0, -2.4); ctx.lineTo(3.4, 2.4)
        ctx.stroke()
        ctx.restore()
      }

      /* ---- generated buildings and islands --------------
         Fifteen client towers and seven archive islands are placed by
         generator rather than authored, and none of them was drawn.
         They are most of what fills those two districts. */
      ctx.fillStyle = 'rgba(120,110,96,0.85)'
      for (const tower of clientTowers()) {
        const w = tower.height > 13 ? 3.2 : 2.4
        ctx.fillRect(px(tower.x) - w / 2, py(tower.z) - w / 2, w, w)
      }
      ctx.fillStyle = 'rgba(110,120,104,0.8)'
      for (const island of archiveIslands()) {
        ctx.beginPath()
        ctx.arc(px(island.x), py(island.z), 2.4, 0, Math.PI * 2)
        ctx.fill()
      }

      /* ---- landmarks the visitor has opened ------------ */
      const openedLandmarks = new Set(game.save.data.progress.landmarks)
      ctx.fillStyle = ink3
      for (const landmark of landmarks) {
        if (!openedLandmarks.has(landmark.id)) continue
        ctx.beginPath()
        ctx.arc(px(landmark.x), py(landmark.z), 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
      for (const spot of PLAY_SPOTS) {
        const complete = game.save.data.progress.completedGames.includes(spot.id)
        const discovered = game.save.data.progress.landmarks.includes(`play-${spot.id}`)
        ctx.beginPath(); ctx.arc(px(spot.x),py(spot.z),4,0,Math.PI*2)
        ctx.fillStyle = complete ? '#325c46' : discovered ? '#d58b4d' : '#ebe6d2'; ctx.fill()
        ctx.strokeStyle = '#42624e'; ctx.lineWidth = 1; ctx.stroke()
        if (discovered) { ctx.font='600 7px monospace'; ctx.fillStyle='#334f3f'; ctx.fillText(spot.label,px(spot.x),py(spot.z)+10) }
      }
      // Safe return points are diamonds; activities are circles.
      for (const point of game.respawns.items.values()) {
        if (!visited.has(point.district ?? '')) continue
        ctx.save(); ctx.translate(px(point.position.x),py(point.position.z)); ctx.rotate(Math.PI/4); ctx.fillStyle=paper2;ctx.fillRect(-2,-2,4,4);ctx.strokeStyle=ink3;ctx.strokeRect(-2,-2,4,4);ctx.restore()
      }

      /* ---- player -------------------------------------- */
      const p = game.player?.position
      if (p) {
        const x = px(p.x)
        const y = py(p.z)
        const heading = game.player.rotationY

        ctx.save()
        ctx.translate(x, y)
        // World +X is map right and world +Z is map down, so a
        // heading of atan2(forward.z, forward.x) points the arrow
        // correctly with no extra offset.
        ctx.rotate(heading)
        ctx.beginPath()
        ctx.moveTo(7, 0)
        ctx.lineTo(-4, 4.5)
        ctx.lineTo(-2, 0)
        ctx.lineTo(-4, -4.5)
        ctx.closePath()
        ctx.fillStyle = accent
        ctx.fill()
        ctx.restore()

        // A ring so the arrow is findable on a busy map.
        ctx.beginPath()
        ctx.arc(x, y, 11, 0, Math.PI * 2)
        ctx.strokeStyle = accent
        ctx.globalAlpha = 0.35
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.globalAlpha = 1
      }
    }

    raf = requestAnimationFrame(draw)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  }, [getGame, size, currentDistrict])

  const game = getGame()
  const visited = new Set(game?.save.data.progress.districts ?? [])
  const signposted = districts.filter((d) => d.signposted)

  const travelTo = (id: DistrictId) => {
    const game = getGame()
    if (!game) return
    // Respawn points are named after their district where one exists.
    const point = game.respawns.getByName(id)
    if (!point) return
    game.player.respawn(id)
    store.getState().setOverlay(null)
  }

  return (
    <div className={styles.map}>
      <p className="label">Map</p>
      <h2 className={styles.title}>Alejandro&rsquo;s world</h2>

      <div className={styles.canvasWrap}>
        <canvas
          ref={canvasRef}
          style={{ width: size, height: size }}
          role="img"
          aria-label="Map of the world showing the districts you have discovered and your current position"
        />
      </div>

      <p className={styles.hint}>
        Green: woodland · Teal: water · ○ activity · ◆ safe return · Orange: you.<br />
        {visited.size} of {districts.length} districts discovered. Travel moves the car to a
        district&rsquo;s entrance.
      </p>

      <ul className={styles.legend}>
        {signposted.map((district) => {
          const seen = visited.has(district.id)
          return (
            <li key={district.id} data-seen={seen}>
              <button type="button" onClick={() => travelTo(district.id)} disabled={!seen}>
                <span className={styles.legendName}>{seen ? district.label : '· · ·'}</span>
                <span className={styles.legendShort}>{seen ? district.short : '?'}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
