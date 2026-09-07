'use client'

/* ============================================================
   VpnMotion — Encrypted Proxy VPN
   Three nodes (remote device · home relay · open web) joined by
   one wire. Between device and relay the wire splays into three
   thread lanes wrapped in a sealed tunnel: payloads collapse
   from readable HTTP into a Fernet token as they cross the
   membrane, ride the tunnel unreadable, and decrypt at the
   relay before continuing in the clear.
   Toggle the tunnel and the collapse never happens — the same
   text stays legible the whole way across.
   ============================================================ */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useCanvas2D, type CanvasContext } from '@/hooks/useCanvas2D'
import { clamp, damp, easeInOutCubic, easeOutCubic, range, seeded } from '@/lib/math'
import { readPalette, type ProjectVisualProps, type VisualPalette } from './types'
import styles from './visual.module.css'

/* ---- timeline ------------------------------------------- */
const BEATS = 12 // whole timeline length in beats
const RATE = 0.55 // beats per second when self-running (~22s loop)
const STATIC_CLOCK = 8.2 // the frame drawn for reduced motion
const FLOW_START = 2.3
const SPEED = 0.255 // path fractions per beat

/* ---- geometry along the wire (0 = device, 1 = web) ------- */
const U_A = 0.075 // tunnel mouth, device side
const U_B = 0.425 // tunnel mouth, relay side
const RAMP = 0.1 // distance over which text collapses / resolves
const LANES = 3
const STEPS = 8 // precomputed morph frames
const PKT_FS = 7.6 // payload type size — box widths are derived from it

/* ---- payloads ------------------------------------------- */
const REQUESTS = ['GET /', 'POST /auth', 'GET /index', 'HEAD /ping', 'GET /a.css']
const RESPONSES = ['200 OK', '64 KB', '304']
/** urlsafe-base64 alphabet — a Fernet token is base64url text. */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

const NO_DASH: number[] = []
const DASH_SEAL: number[] = [2.5, 4]
const DASH_LEAD: number[] = [1.5, 3]

interface Packet {
  dir: number // 1 = request (device → web), -1 = response
  lane: number
  offset: number
  /** ciphered prefix per morph step */
  cip: string[]
  /** readable suffix per morph step */
  pln: string[]
  /** char count of the ciphered prefix per step */
  cipLen: number[]
  /** total char count per step */
  lens: number[]
  /** the full Fernet token shown in the inspect card */
  token: string
  u: number
  x: number
  y: number
  hw: number
  hh: number
  vis: number
}

interface Layout {
  w: number
  h: number
  s: number
  yc: number
  x0: number
  x1: number
  laneGap: number
  capHalf: number
  dup: number
  fMicro: string
  fSmall: string
  fBody: string
  fCard: string
}

interface Bounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

const frac = (x: number) => x - Math.floor(x)
const uToX = (u: number, x0: number, x1: number) => x0 + (x1 - x0) * u
/** 0 outside the tunnel, 1 deep inside — the collapse envelope. */
const encAt = (u: number) => clamp(Math.min((u - U_A) / RAMP, (U_B - u) / RAMP))
/** how far the three thread lanes are splayed at u. */
const fanAt = (u: number) =>
  easeInOutCubic(clamp(Math.min((u - (U_A - 0.02)) / 0.055, (U_B + 0.02 - u) / 0.055)))

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** Monospace text with manual tracking — uppercase technical labels. */
function tracked(
  ctx: CanvasRenderingContext2D,
  str: string,
  x: number,
  y: number,
  size: number,
  tracking: number,
  center = false,
) {
  const adv = size * 0.62 + tracking
  const total = str.length * adv - tracking
  let cx = center ? x - total / 2 : x
  for (let i = 0; i < str.length; i++) {
    ctx.fillText(str[i], cx, y)
    cx += adv
  }
}

function drawLock(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  s: number,
  closed: number,
) {
  const bw = 9 * s
  const bh = 7 * s
  const r = 3.1 * s
  const lift = (1 - closed) * 2.4 * s
  ctx.save()
  ctx.translate(cx, cy - bh / 2)
  ctx.rotate((1 - closed) * -0.55)
  ctx.translate(0, -lift)
  ctx.beginPath()
  ctx.moveTo(-r, 0)
  ctx.lineTo(-r, -1.2 * s)
  ctx.arc(0, -1.2 * s, r, Math.PI, 0)
  ctx.lineTo(r, 0)
  ctx.stroke()
  ctx.restore()
  roundRectPath(ctx, cx - bw / 2, cy - bh / 2, bw, bh, 1.4 * s)
  ctx.stroke()
}

export function VpnMotion({
  project,
  progress,
  reducedMotion,
  className,
  interactive,
}: ProjectVisualProps) {
  const [tunnelOn, setTunnelOn] = useState(true)

  /* -- payload pool: built once, deterministic -------------- */
  const pool = useMemo<Packet[]>(() => {
    const rnd = seeded(0x5f3a91)
    const out: Packet[] = []
    const add = (plain: string, dir: number, idx: number, n: number, lane: number) => {
      /* what a box can show of a token: an excerpt of its base64url body */
      let body = ''
      for (let i = 0; i < plain.length + 2; i++) body += B64[Math.floor(rnd() * 64)]
      /* every Fernet token starts 0x80 + timestamp → 'gAAAAAB…' */
      const token = `gAAAAAB${body.slice(0, 7)}…`
      const cip: string[] = []
      const pln: string[] = []
      const cipLen: number[] = []
      const lens: number[] = []
      for (let k = 0; k <= STEPS; k++) {
        const f = k / STEPS
        const nc = Math.round(f * body.length)
        const pk = Math.round(f * plain.length)
        const a = body.slice(0, nc)
        const b = plain.slice(pk)
        cip.push(a)
        pln.push(b)
        cipLen.push(a.length)
        lens.push(a.length + b.length)
      }
      out.push({
        dir,
        lane,
        offset: idx / n,
        cip,
        pln,
        cipLen,
        lens,
        token,
        u: -1,
        x: 0,
        y: 0,
        hw: 0,
        hh: 0,
        vis: 0,
      })
    }
    for (let i = 0; i < REQUESTS.length; i++) add(REQUESTS[i], 1, i, REQUESTS.length, i % LANES)
    /* responses ride the opposite lane so the two directions never collide */
    for (let i = 0; i < RESPONSES.length; i++) add(RESPONSES[i], -1, i, RESPONSES.length, (i + 1) % LANES)
    return out
  }, [])

  /* -- real numbers from the project entry ------------------ */
  const ports = useMemo(() => {
    const find = (needle: string) => {
      const m = project?.metrics.find((x) => x.label.toLowerCase().includes(needle))
      if (!m) return ''
      const digits = m.value.replace(/[^0-9]/g, '')
      return digits ? `:${digits}` : ''
    }
    return { relay: find('relay'), proxy: find('proxy') }
  }, [project])

  const readout = useMemo(() => {
    const m = project?.metrics ?? []
    return m.slice(0, 2).map((x) => `${x.label} ${x.value}`.toUpperCase())
  }, [project])

  /* -- mutable draw state ----------------------------------- */
  const layoutRef = useRef<Layout>({
    w: -1,
    h: -1,
    s: 1,
    yc: 0,
    x0: 0,
    x1: 0,
    laneGap: 23,
    capHalf: 36,
    dup: 5.5,
    fMicro: '7px ui-monospace, monospace',
    fSmall: '8px ui-monospace, monospace',
    fBody: '8px ui-monospace, monospace',
    fCard: '9px ui-monospace, monospace',
  })
  const capRef = useRef<Bounds>({ x0: 0, y0: 0, x1: 0, y1: 0 })
  const palRef = useRef<VisualPalette | null>(null)
  const palAge = useRef(0)
  const tunRef = useRef(1)
  const selRef = useRef(-1)
  const autoRef = useRef(-1)

  const ref = useCanvas2D<HTMLCanvasElement>({
    setup: ({ ctx, w, h }) => {
      palRef.current = readPalette(ref.current)
      palAge.current = 0
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      layout(layoutRef.current, w, h)
    },
    draw: ({ ctx, w, h, t, dt }: CanvasContext) => {
      const L = layoutRef.current
      if (L.w !== w || L.h !== h) layout(L, w, h)

      palAge.current += dt
      if (!palRef.current || palAge.current > 0.5) {
        palRef.current = readPalette(ref.current)
        palAge.current = 0
      }
      const pal = palRef.current
      const s = L.s
      const yc = L.yc
      const { x0, x1 } = L

      const clock = reducedMotion
        ? STATIC_CLOCK
        : typeof progress === 'number'
          ? clamp(progress) * BEATS
          : t * RATE

      const target = tunnelOn ? 1 : 0
      tunRef.current = reducedMotion ? target : damp(tunRef.current, target, 7, dt)
      const tun = tunRef.current

      const n0 = easeOutCubic(range(clock, 0, 0.55))
      const n1 = easeOutCubic(range(clock, 0.25, 0.9))
      const n2 = easeOutCubic(range(clock, 0.5, 1.15))
      const wireT = easeInOutCubic(range(clock, 0.55, 1.5))
      const sealT = easeInOutCubic(range(clock, 1.45, 2.4))
      const flowIn = range(clock, 2.35, 3.0)
      const cardT = easeOutCubic(range(clock, 5.4, 6.3))

      const capXA = uToX(U_A, x0, x1)
      const capXB = uToX(U_B, x0, x1)
      const capTop = yc - L.capHalf
      const capBot = yc + L.capHalf
      const cap = capRef.current
      cap.x0 = capXA
      cap.y0 = capTop
      cap.x1 = capXB
      cap.y1 = capBot

      ctx.clearRect(0, 0, w, h)
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'left'
      ctx.lineWidth = 0.75

      /* ---- the wire ---------------------------------------- */
      ctx.globalAlpha = 0.55
      ctx.strokeStyle = pal.inkFaint
      ctx.beginPath()
      ctx.moveTo(x0, yc)
      ctx.lineTo(x0 + (x1 - x0) * wireT, yc)
      ctx.stroke()

      /* ---- three thread lanes, splayed inside the tunnel ---- */
      if (sealT > 0.01) {
        ctx.globalAlpha = 0.4 * sealT
        for (let lane = 0; lane < LANES; lane++) {
          if (lane === 1) continue
          const off = (lane - 1) * L.laneGap
          ctx.beginPath()
          for (let i = 0; i <= 48; i++) {
            const u = i / 48
            const yy = yc + off * fanAt(u) * sealT
            if (i === 0) ctx.moveTo(uToX(u, x0, x1), yy)
            else ctx.lineTo(uToX(u, x0, x1), yy)
          }
          ctx.stroke()
        }
      }

      /* ---- the conduit: two rails between the two membranes -- */
      if (sealT > 0.01) {
        ctx.save()
        ctx.beginPath()
        ctx.rect(capXA - 4 * s, capTop - 6 * s, (capXB - capXA + 8 * s) * sealT, L.capHalf * 2 + 12 * s)
        ctx.clip()
        ctx.globalAlpha = 0.3 + 0.3 * tun
        ctx.strokeStyle = pal.inkSoft
        ctx.setLineDash(tun > 0.5 ? NO_DASH : DASH_SEAL)
        ctx.beginPath()
        ctx.moveTo(capXA, capTop)
        ctx.lineTo(capXB, capTop)
        ctx.moveTo(capXA, capBot)
        ctx.lineTo(capXB, capBot)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)

        /* crypto membranes — where plaintext stops and starts */
        ctx.globalAlpha = (0.15 + 0.35 * tun) * sealT
        ctx.strokeStyle = tun > 0.5 ? pal.accent : pal.inkFaint
        ctx.beginPath()
        ctx.moveTo(capXA, capTop)
        ctx.lineTo(capXA, capBot)
        ctx.moveTo(capXB, capTop)
        ctx.lineTo(capXB, capBot)
        ctx.stroke()
        ctx.restore()

        /* the seam head while the tunnel is still sealing */
        if (sealT < 0.995) {
          const seamX = capXA - 4 * s + (capXB - capXA + 8 * s) * sealT
          ctx.globalAlpha = 0.5 * (1 - sealT) + 0.15
          ctx.strokeStyle = pal.accent
          ctx.beginPath()
          ctx.moveTo(seamX, capTop)
          ctx.lineTo(seamX, capBot)
          ctx.stroke()
        }

        ctx.globalAlpha = 0.45 * sealT
        ctx.fillStyle = pal.inkFaint
        ctx.font = L.fMicro
        tracked(ctx, '1 THREAD / CONN', capXA, capTop - 11 * s, 7.2 * s, 0.9)
      }

      /* ---- nodes ------------------------------------------- */
      drawDevice(ctx, x0, yc, s, n0, pal)
      drawRelay(ctx, uToX(0.5, x0, x1), yc, s, n1, sealT, pal)
      drawWeb(ctx, x1, yc, s, n2, pal)

      ctx.font = L.fSmall
      const labY = capBot + 15 * s
      ctx.globalAlpha = 0.85 * n0
      ctx.fillStyle = pal.inkSoft
      tracked(ctx, 'DEVICE', x0, labY, 8 * s, 1.1, true)
      ctx.globalAlpha = 0.85 * n1
      tracked(ctx, 'HOME RELAY', uToX(0.5, x0, x1), labY, 8 * s, 1.1, true)
      ctx.globalAlpha = 0.85 * n2
      tracked(ctx, 'WEB', x1, labY, 8 * s, 1.1, true)

      ctx.font = L.fMicro
      ctx.fillStyle = pal.inkFaint
      if (ports.proxy) {
        ctx.globalAlpha = 0.7 * n0
        tracked(ctx, ports.proxy, x0, labY + 11 * s, 7.2 * s, 0.9, true)
      }
      if (ports.relay) {
        ctx.globalAlpha = 0.7 * n1
        tracked(ctx, ports.relay, uToX(0.5, x0, x1), labY + 11 * s, 7.2 * s, 0.9, true)
      }

      /* ---- padlock ----------------------------------------- */
      if (sealT > 0.01) {
        const lockY = capTop - 22 * s
        const lockX = uToX((U_A + U_B) / 2, x0, x1)
        ctx.globalAlpha = 0.55 + 0.45 * tun
        ctx.strokeStyle = tun > 0.5 ? pal.accent : pal.inkSoft
        ctx.lineWidth = 1.1
        drawLock(ctx, lockX, lockY, s, sealT * tun)
        ctx.lineWidth = 0.75
        ctx.font = L.fMicro
        ctx.globalAlpha = 0.9 * sealT
        ctx.fillStyle = tun > 0.5 ? pal.accent : pal.inkSoft
        tracked(
          ctx,
          tun > 0.5 ? 'FERNET' : 'NO ENCRYPTION',
          lockX,
          lockY - 13 * s,
          7.2 * s,
          1.4,
          true,
        )
      }

      /* ---- packets ----------------------------------------- */
      const flow = Math.max(0, clock - FLOW_START) * SPEED
      const fs = PKT_FS * s
      const cw = fs * 0.62
      const bh = 10 * s
      const span = x1 - x0
      ctx.font = L.fBody
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]
        const raw = p.dir > 0 ? frac(flow + p.offset) : frac(flow * 0.92 + p.offset + 0.13)
        const u = p.dir > 0 ? raw : 1 - raw
        p.u = u
        const e = encAt(u) * tun * sealT
        const k = Math.round(e * STEPS)
        const len = p.lens[k]
        const bw = len * cw + 7 * s
        const fanv = fanAt(u) * sealT
        const x = uToX(u, x0, x1)
        const y = yc + (p.lane - 1) * L.laneGap * fanv - p.dir * L.dup
        /* absorbed by each node: emitted by the device, terminated and
           re-issued by the relay, delivered to the web. Gated on the
           box edges so a wide packet never lands on a node. */
        const halfU = (bw / 2 + 8 * s) / span
        const vis =
          clamp((u - halfU - 0.012) / 0.018) *
          clamp((0.988 - u - halfU) / 0.018) *
          clamp((Math.abs(u - 0.5) - halfU - 0.028) / 0.02) *
          flowIn
        const sc = 0.34 + 0.66 * vis
        const bws = bw * sc
        const bhs = bh * sc
        p.x = x
        p.y = y
        p.hw = bws / 2
        p.hh = bhs / 2
        p.vis = vis
        if (vis < 0.03) continue

        ctx.globalAlpha = vis * vis * 0.92
        ctx.fillStyle = pal.bg
        roundRectPath(ctx, x - bws / 2, y - bhs / 2, bws, bhs, 2 * s)
        ctx.fill()
        ctx.globalAlpha = vis * vis * 0.42
        ctx.strokeStyle = pal.inkFaint
        ctx.stroke()

        /* leading chevron — upstream in ink, downstream in signal */
        const lead = x + p.dir * (bws / 2 + 4.5 * s)
        ctx.globalAlpha = vis * 0.55
        ctx.strokeStyle = p.dir > 0 ? pal.inkFaint : pal.signal
        ctx.beginPath()
        ctx.moveTo(lead - p.dir * 2.4 * s, y - 2.4 * s)
        ctx.lineTo(lead, y)
        ctx.lineTo(lead - p.dir * 2.4 * s, y + 2.4 * s)
        ctx.stroke()

        /* the payload itself only while the packet is at full size */
        const textA = range(vis, 0.72, 0.95)
        if (textA > 0.01) {
          const tx = x - bws / 2 + 4 * s
          const nc = p.cipLen[k]
          if (nc > 0) {
            ctx.globalAlpha = textA * 0.82
            ctx.fillStyle = pal.accent
            ctx.fillText(p.cip[k], tx, y + 0.5)
          }
          if (p.pln[k].length > 0) {
            ctx.globalAlpha = textA * 0.92
            ctx.fillStyle = pal.ink
            ctx.fillText(p.pln[k], tx + nc * cw, y + 0.5)
          }
        }

        /* readable while in transit — the whole point, inverted */
        const exposure = (1 - tun) * sealT * clamp(Math.min((u - U_A) / 0.02, (U_B - u) / 0.02))
        if (exposure > 0.02) {
          ctx.globalAlpha = vis * exposure * 0.75
          ctx.strokeStyle = pal.accent
          ctx.beginPath()
          ctx.moveTo(x - bws / 2, y + bhs / 2 + 2 * s)
          ctx.lineTo(x + bws / 2, y + bhs / 2 + 2 * s)
          ctx.stroke()
        }
      }

      /* ---- inspected packet -------------------------------- */
      if (selRef.current < 0) {
        const cur = autoRef.current
        const cp = cur >= 0 ? pool[cur] : null
        if (!cp || cp.dir < 0 || cp.u < U_A || cp.u > U_B) {
          let best = -1
          let bd = 9
          for (let i = 0; i < pool.length; i++) {
            const p = pool[i]
            if (p.dir < 0 || p.u < U_A || p.u > U_B) continue
            const d = Math.abs(p.u - 0.25)
            if (d < bd) {
              bd = d
              best = i
            }
          }
          if (best >= 0) autoRef.current = best
        }
      }
      const selIdx = selRef.current >= 0 ? selRef.current : autoRef.current
      const showCard = h > 235 && w > 330 && selIdx >= 0 && cardT > 0.01

      if (showCard) {
        const p = pool[selIdx]
        const ruleY = capBot + 42 * s
        /* with the tunnel open the wire carries a token; with it shut
           the wire carries exactly what the device typed */
        const sealed = tun > 0.5
        const wireTag = sealed ? 'FERNET' : 'ON WIRE'
        const wireVal = sealed ? p.token : p.pln[0]
        const longest = Math.max(wireVal.length, p.lens[0])
        const cardW = 62 * s + longest * 9.2 * s * 0.62
        const cardX = Math.max(10 * s, Math.min(capXA, w - 12 * s - cardW))

        /* leader from the packet down to the card */
        ctx.globalAlpha = 0.4 * cardT * p.vis
        ctx.strokeStyle = pal.inkFaint
        ctx.setLineDash(DASH_LEAD)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y + p.hh + 2 * s)
        ctx.lineTo(p.x, ruleY)
        ctx.stroke()
        ctx.setLineDash(NO_DASH)

        ctx.globalAlpha = 0.35 * cardT
        ctx.beginPath()
        ctx.moveTo(cardX, ruleY)
        ctx.lineTo(cardX + cardW * easeOutCubic(cardT), ruleY)
        ctx.stroke()

        /* bracket the inspected packet */
        ctx.globalAlpha = 0.65 * cardT * p.vis
        ctx.strokeStyle = pal.ink
        ctx.beginPath()
        ctx.moveTo(p.x - p.hw - 3 * s, p.y - p.hh - 1 * s)
        ctx.lineTo(p.x - p.hw - 3 * s, p.y + p.hh + 1 * s)
        ctx.moveTo(p.x + p.hw + 3 * s, p.y - p.hh - 1 * s)
        ctx.lineTo(p.x + p.hw + 3 * s, p.y + p.hh + 1 * s)
        ctx.stroke()

        const tagX = cardX
        const valX = cardX + 62 * s
        ctx.font = L.fMicro
        ctx.globalAlpha = 0.6 * cardT
        ctx.fillStyle = pal.inkFaint
        tracked(ctx, 'PLAINTEXT', tagX, ruleY + 12 * s, 7.2 * s, 1)
        tracked(ctx, wireTag, tagX, ruleY + 25 * s, 7.2 * s, 1)

        ctx.font = L.fCard
        ctx.globalAlpha = 0.95 * cardT
        ctx.fillStyle = pal.ink
        ctx.fillText(p.pln[0], valX, ruleY + 12 * s)
        ctx.globalAlpha = 0.85 * cardT
        ctx.fillStyle = pal.accent
        ctx.fillText(wireVal, valX, ruleY + 25 * s)
      }

      ctx.globalAlpha = 1
    },
  })

  /* -- pointer: toggle the tunnel, inspect a packet --------- */
  useEffect(() => {
    if (interactive === false) return
    const c = ref.current
    if (!c) return

    const hitPacket = (x: number, y: number) => {
      for (let i = 0; i < pool.length; i++) {
        const p = pool[i]
        if (p.vis < 0.15) continue
        if (Math.abs(x - p.x) <= p.hw + 6 && Math.abs(y - p.y) <= p.hh + 6) return i
      }
      return -1
    }
    const inCapsule = (x: number, y: number) => {
      const b = capRef.current
      return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
    }

    const onDown = (ev: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = ev.clientX - r.left
      const y = ev.clientY - r.top
      const hit = hitPacket(x, y)
      if (hit >= 0) {
        selRef.current = selRef.current === hit ? -1 : hit
        return
      }
      if (inCapsule(x, y)) {
        setTunnelOn((v) => !v)
        return
      }
      selRef.current = -1
    }

    const onMove = (ev: PointerEvent) => {
      const el = ref.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const x = ev.clientX - r.left
      const y = ev.clientY - r.top
      el.style.cursor = hitPacket(x, y) >= 0 || inCapsule(x, y) ? 'pointer' : 'default'
    }

    const onLeave = () => {
      const el = ref.current
      if (el) el.style.cursor = 'default'
    }

    c.addEventListener('pointerdown', onDown)
    c.addEventListener('pointermove', onMove)
    c.addEventListener('pointerleave', onLeave)
    return () => {
      c.removeEventListener('pointerdown', onDown)
      c.removeEventListener('pointermove', onMove)
      c.removeEventListener('pointerleave', onLeave)
    }
  }, [interactive, pool, ref])

  return (
    <div className={className ? `${styles.wrap} ${className}` : styles.wrap}>
      <canvas ref={ref} className={styles.canvas} />
      {interactive !== false && (
        <>
          <div className={styles.readout}>
            {readout.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
          <div className={styles.hud}>
            <button
              type="button"
              className={styles.chip}
              data-on={tunnelOn}
              onClick={() => setTunnelOn((v) => !v)}
            >
              {tunnelOn ? 'Tunnel on' : 'Tunnel off'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/* ============================================================
   helpers kept out of the draw loop
   ============================================================ */

function layout(L: Layout, w: number, h: number) {
  L.w = w
  L.h = h
  const s = clamp(Math.min(w / 600, h / 300), 0.62, 1.3)
  L.s = s
  L.yc = h * 0.47
  const margin = clamp(w * 0.115, 42 * s, 120)
  L.x0 = margin
  L.x1 = w - margin
  L.laneGap = 24 * s
  L.capHalf = 41 * s
  L.dup = 6.5 * s
  L.fMicro = `${(7.2 * s).toFixed(2)}px ui-monospace, monospace`
  L.fSmall = `${(8 * s).toFixed(2)}px ui-monospace, monospace`
  L.fBody = `${(PKT_FS * s).toFixed(2)}px ui-monospace, monospace`
  L.fCard = `${(9.2 * s).toFixed(2)}px ui-monospace, monospace`
}

function drawDevice(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  k: number,
  pal: VisualPalette,
) {
  if (k < 0.01) return
  const dw = 14 * s
  const dh = 23 * s
  ctx.save()
  ctx.translate(x, y)
  const sc = 0.72 + 0.28 * k
  ctx.scale(sc, sc)
  ctx.globalAlpha = k
  ctx.fillStyle = pal.bg
  roundRectPath(ctx, -dw / 2, -dh / 2, dw, dh, 3 * s)
  ctx.fill()
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = k * 0.4
  ctx.beginPath()
  ctx.moveTo(-dw / 2 + 3.5 * s, -dh / 2 + 5 * s)
  ctx.lineTo(dw / 2 - 3.5 * s, -dh / 2 + 5 * s)
  ctx.stroke()
  ctx.restore()
}

function drawRelay(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  k: number,
  sealT: number,
  pal: VisualPalette,
) {
  if (k < 0.01) return
  const d = 26 * s
  ctx.save()
  ctx.translate(x, y)
  const sc = 0.72 + 0.28 * k
  ctx.scale(sc, sc)
  ctx.globalAlpha = k
  ctx.fillStyle = pal.bg
  roundRectPath(ctx, -d / 2, -d / 2, d, d, 2 * s)
  ctx.fill()
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 1
  ctx.stroke()
  /* one tick per daemon thread */
  ctx.globalAlpha = k * sealT * 0.55
  ctx.beginPath()
  for (let i = 0; i < 3; i++) {
    const ty = (i - 1) * 6 * s
    ctx.moveTo(-7 * s, ty)
    ctx.lineTo(7 * s, ty)
  }
  ctx.stroke()
  ctx.restore()
}

function drawWeb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  k: number,
  pal: VisualPalette,
) {
  if (k < 0.01) return
  const r = 12.5 * s
  ctx.save()
  ctx.translate(x, y)
  const sc = 0.72 + 0.28 * k
  ctx.scale(sc, sc)
  ctx.globalAlpha = k
  ctx.fillStyle = pal.bg
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = pal.ink
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.globalAlpha = k * 0.42
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 0.46, r, 0, 0, Math.PI * 2)
  ctx.moveTo(-r, 0)
  ctx.lineTo(r, 0)
  ctx.stroke()
  ctx.restore()
}
