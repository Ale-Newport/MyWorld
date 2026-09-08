'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from 'zustand'
import type { WorldStore } from '@/world/state/store'
import type { Game } from '@/world/Game'
import {
  districts,
  roads,
  landmarks,
  WORLD_RADIUS,
  type DistrictId,
} from '@/content/world'
import styles from './map.module.css'
import { LAKES, RIVER, BRIDGES, FOREST_POCKETS, PLAY_SPOTS, WATERFALL } from '@/content/world-environment'
import type { CircuitRace } from '@/world/minigames/CircuitRace'

/* ============================================================
   MAP

   Drawn to a canvas rather than composed from DOM nodes: it has
   a few hundred marks on it and the player arrow has to move
   smoothly, and a canvas is both cheaper and easier to keep
   visually consistent with the world's own drawing.

   It is the site's design language, not a game minimap — thin
   rules, mono labels, one accent colour, no colour-coded key.

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

    let raf = 0

    const draw = () => {
      raf = requestAnimationFrame(draw)
      ctx.clearRect(0, 0, size, size)
      ctx.fillStyle = '#d0dfd8'
      ctx.fillRect(0, 0, size, size)

      /* ---- world disc ---------------------------------- */
      ctx.beginPath()
      ctx.arc(px(0), py(0), (WORLD_RADIUS / SPAN) * size, 0, Math.PI * 2)
      ctx.fillStyle = '#c6ccac'
      ctx.fill()
      ctx.strokeStyle = ink4
      ctx.lineWidth = 1
      ctx.setLineDash([2, 4])
      ctx.stroke()
      ctx.setLineDash([])

      // Woodland masses, open district plates and shoreline use the same
      // authored geography as the playable island.
      for (const [x, z, radius] of FOREST_POCKETS) {
        ctx.beginPath(); ctx.ellipse(px(x), py(z), radius / SPAN * size, radius / SPAN * size * .85, -.3, 0, Math.PI * 2)
        ctx.fillStyle = '#9bac88'; ctx.fill()
        ctx.beginPath(); ctx.arc(px(x), py(z), radius / SPAN * size * .55, 0, Math.PI * 2); ctx.fillStyle = '#8fA37d'; ctx.fill()
      }
      for (const district of districts) {
        if (district.secret && !foundSecrets.has(district.id)) continue
        ctx.beginPath(); ctx.arc(px(district.x), py(district.z), district.radius / SPAN * size, 0, Math.PI * 2)
        ctx.fillStyle = '#e2dfcd'; ctx.fill()
      }
      for (const lake of LAKES) {
        ctx.beginPath(); ctx.ellipse(px(lake.x), py(lake.z), lake.rx / SPAN * size, lake.rz / SPAN * size, 0, 0, Math.PI * 2)
        ctx.fillStyle = '#6fa9a0'; ctx.fill(); ctx.strokeStyle = '#b9d3b0'; ctx.lineWidth = 3; ctx.stroke()
      }
      ctx.beginPath(); RIVER.points.forEach(([x,z],i) => { if (i) ctx.lineTo(px(x),py(z)); else ctx.moveTo(px(x),py(z)) })
      ctx.strokeStyle = '#7bafa4'; ctx.lineWidth = RIVER.width / SPAN * size; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke()
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
      for (const bridge of BRIDGES) {
        ctx.strokeStyle = '#f4e8c9'; ctx.lineWidth = bridge.width / SPAN * size
        ctx.beginPath(); ctx.moveTo(px(bridge.x-bridge.length/2),py(bridge.z)); ctx.lineTo(px(bridge.x+bridge.length/2),py(bridge.z)); ctx.stroke()
      }
      const circuit = game.minigames.get('circuit') as CircuitRace
      if (circuit) {
        ctx.beginPath(); circuit.curve.getSpacedPoints(120).forEach((p,i) => { if (i) ctx.lineTo(px(p.x),py(p.z)); else ctx.moveTo(px(p.x),py(p.z)) })
        ctx.strokeStyle = '#65786b'; ctx.lineWidth = 12 / SPAN * size; ctx.stroke()
      }

      /* ---- districts ----------------------------------- */
      ctx.font = '500 9px ui-monospace, SFMono-Regular, Menlo, monospace'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'

      for (const district of districts) {
        if (district.secret && !foundSecrets.has(district.id)) continue
        const seen = visited.has(district.id)
        const x = px(district.x)
        const y = py(district.z)
        const r = (district.radius / SPAN) * size

        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        if (seen) {
          ctx.fillStyle = district.id === currentDistrict
            ? 'rgba(212,73,31,0.14)'
            : 'rgba(12,12,13,0.05)'
          ctx.fill()
        }
        ctx.strokeStyle = seen ? ink3 : ink4
        ctx.lineWidth = district.id === currentDistrict ? 1.6 : 1
        if (!seen) ctx.setLineDash([2, 3])
        ctx.stroke()
        ctx.setLineDash([])

        if (seen) {
          ctx.fillStyle = district.id === currentDistrict ? accent : ink
          // Two lines if the label is long, so it never spills.
          const label = district.short
          ctx.fillText(label, x, y - 1)
        } else {
          ctx.fillStyle = ink4
          ctx.fillText('?', x, y)
        }
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
      for (const spot of PLAY_SPOTS.filter(p => p.id !== 'tnt')) {
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
