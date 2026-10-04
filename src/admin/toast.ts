'use client'

import { create } from 'zustand'

type Tone = 'default' | 'ok' | 'danger'
interface Toast { id: number; text: string; tone: Tone }

export const useToasts = create<{ items: Toast[]; push: (text: string, tone?: Tone) => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (text, tone = 'default') => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items.slice(-3), { id, text, tone }] }))
    window.setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), tone === 'danger' ? 7000 : 3500)
  },
  drop: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))

export const toast = (text: string, tone?: Tone) => useToasts.getState().push(text, tone)
