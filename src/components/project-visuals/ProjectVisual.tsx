'use client'

import { lazy, Suspense, useMemo } from 'react'
import type { Project, MotionComponent } from '@/content/types'
import type { ProjectVisualProps } from './types'
import styles from './visual.module.css'

/* Every project motion graphic is its own chunk. Only the one
   on screen is ever fetched. */
const REGISTRY: Record<MotionComponent, React.LazyExoticComponent<React.ComponentType<ProjectVisualProps>>> = {
  ChessMotion:        lazy(() => import('./ChessMotion').then((m) => ({ default: m.ChessMotion }))),
  StockMotion:        lazy(() => import('./StockMotion').then((m) => ({ default: m.StockMotion }))),
  ThreeBodyMotion:    lazy(() => import('./ThreeBodyMotion').then((m) => ({ default: m.ThreeBodyMotion }))),
  VpnMotion:          lazy(() => import('./VpnMotion').then((m) => ({ default: m.VpnMotion }))),
  GymMotion:          lazy(() => import('./GymMotion').then((m) => ({ default: m.GymMotion }))),
  FocusMotion:        lazy(() => import('./FocusMotion').then((m) => ({ default: m.FocusMotion }))),
  KeyframesMotion:    lazy(() => import('./KeyframesMotion').then((m) => ({ default: m.KeyframesMotion }))),
  LabyrinthMotion:    lazy(() => import('./LabyrinthMotion').then((m) => ({ default: m.LabyrinthMotion }))),
  PrimesMotion:       lazy(() => import('./PrimesMotion').then((m) => ({ default: m.PrimesMotion }))),
  VoxelMotion:        lazy(() => import('./VoxelMotion').then((m) => ({ default: m.VoxelMotion }))),
  CardsMotion:        lazy(() => import('./CardsMotion').then((m) => ({ default: m.CardsMotion }))),
  DotsBoxesMotion:    lazy(() => import('./DotsBoxesMotion').then((m) => ({ default: m.DotsBoxesMotion }))),
  TrainingMotion:     lazy(() => import('./TrainingMotion').then((m) => ({ default: m.TrainingMotion }))),
  CatanMotion:        lazy(() => import('./CatanMotion').then((m) => ({ default: m.CatanMotion }))),
  VideoPlayerMotion:  lazy(() => import('./VideoPlayerMotion').then((m) => ({ default: m.VideoPlayerMotion }))),
  WebsiteMotion:      lazy(() => import('./WebsiteMotion').then((m) => ({ default: m.WebsiteMotion }))),
  LibraryMotion:      lazy(() => import('./LibraryMotion').then((m) => ({ default: m.LibraryMotion }))),
  JobBoardMotion:     lazy(() => import('./JobBoardMotion').then((m) => ({ default: m.JobBoardMotion }))),
  GenericProjectMotion: lazy(() => import('./GenericProjectMotion').then((m) => ({ default: m.GenericProjectMotion }))),
}

interface Props extends Omit<ProjectVisualProps, 'project'> {
  project: Project
}

export function ProjectVisual({ project, ...rest }: Props) {
  const Comp = useMemo(
    () => REGISTRY[project.presentation.motionComponent] ?? REGISTRY.GenericProjectMotion,
    [project.presentation.motionComponent],
  )
  return (
    <Suspense fallback={<div className={styles.wrap} aria-hidden="true" />}>
      <Comp project={project} {...rest} />
    </Suspense>
  )
}
