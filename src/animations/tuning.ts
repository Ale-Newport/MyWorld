'use client'

import { createContext, useContext } from 'react'

/* Shared motion controls an effect frame hands to whatever runs
   inside it. `timeScale` multiplies the clock of every Canvas2D
   visual built on useCanvas2D, which is how the library's Speed
   control reaches effects that were written before it existed. */
export interface MotionTuning {
  timeScale: number
}

export const MotionTuningContext = createContext<MotionTuning>({ timeScale: 1 })
export const useMotionTuning = () => useContext(MotionTuningContext)
