'use client'

import { useEffect, useRef } from 'react'
import { useJourney } from '@/state/journey'

/* ============================================================
   SOUND
   Synthesised, not sampled: a handful of short Web Audio
   gestures weighing zero bytes. Silent until the visitor turns
   it on, and the site is designed to be excellent with it off.
   ============================================================ */

type Cue = 'chapter' | 'click' | 'open' | 'close' | 'pulse'

let ctx: AudioContext | null = null

function ensureContext(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null
    ctx = new Ctor()
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function play(cue: Cue) {
  const ac = ensureContext()
  if (!ac) return
  const now = ac.currentTime
  const gain = ac.createGain()
  gain.connect(ac.destination)

  switch (cue) {
    case 'chapter': {
      // A low, short swell — the sound of a room changing.
      const osc = ac.createOscillator()
      const filter = ac.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.setValueAtTime(420, now)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(58, now)
      osc.frequency.exponentialRampToValueAtTime(38, now + 1.1)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.12, now + 0.08)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.2)
      osc.connect(filter).connect(gain)
      osc.start(now)
      osc.stop(now + 1.25)
      break
    }
    case 'click':
    case 'open':
    case 'close': {
      // Tiny mechanical tick.
      const osc = ac.createOscillator()
      osc.type = 'square'
      const base = cue === 'close' ? 1400 : cue === 'open' ? 2200 : 1800
      osc.frequency.setValueAtTime(base, now)
      osc.frequency.exponentialRampToValueAtTime(base * 0.55, now + 0.035)
      gain.gain.setValueAtTime(0.03, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05)
      osc.connect(gain)
      osc.start(now)
      osc.stop(now + 0.06)
      break
    }
    case 'pulse': {
      const osc = ac.createOscillator()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(660, now)
      gain.gain.setValueAtTime(0.02, now)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
      osc.connect(gain)
      osc.start(now)
      osc.stop(now + 0.24)
      break
    }
  }
}

export function useSound() {
  const enabled = useJourney((s) => s.soundEnabled)
  const chapter = useJourney((s) => s.chapter)
  const indexOpen = useJourney((s) => s.indexOpen)
  const activeProject = useJourney((s) => s.activeProject)
  const first = useRef(true)

  useEffect(() => {
    if (!enabled) return
    if (first.current) { first.current = false; return }
    play('chapter')
  }, [chapter, enabled])

  useEffect(() => { if (enabled) play(indexOpen ? 'open' : 'close') }, [indexOpen, enabled])
  useEffect(() => { if (enabled && activeProject) play('open') }, [activeProject, enabled])

  /* Interface clicks — one delegated listener, no per-button wiring. */
  useEffect(() => {
    if (!enabled) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t?.closest('button, a')) play('click')
    }
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [enabled])

  /* Resume the context on the gesture that enables sound. */
  useEffect(() => { if (enabled) ensureContext() }, [enabled])
}
