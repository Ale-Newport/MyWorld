'use client'

import { useMemo } from 'react'
import type { MotionComponent } from '@/content/types'
import { ProjectVisual } from '@/components/project-visuals/ProjectVisual'
import { useSite } from '@/cms/context'
import { bool, str, type EffectProps } from '../types'
import { useLiveProgress } from './kit'

/* The project motion graphics as library blocks. Each one explains
   a project from that project's own data, so the block takes a
   project (by slug) and falls back to the first project that uses
   this motion. Scroll-linked visuals receive the frame's progress. */
export function forMotion(motion: string) {
  function ProjectMotion({ params, progress, active, reducedMotion }: EffectProps) {
    const { allProjects } = useSite()
    const slug = str(params.project, '', 80)
    const scrollLinked = bool(params.scrollLinked, false)
    // The frame writes progress to a ref every frame; a scroll-linked visual needs it as a prop.
    const live = useLiveProgress(progress, scrollLinked && !reducedMotion)
    const project = useMemo(
      () => allProjects.find((p) => p.slug === slug) ?? allProjects.find((p) => p.presentation.motionComponent === motion) ?? allProjects[0],
      [allProjects, slug],
    )
    if (!project) return null
    const shown = { ...project, presentation: { ...project.presentation, motionComponent: motion as MotionComponent } }
    return <ProjectVisual project={shown} active={active} reducedMotion={reducedMotion} interactive={bool(params.interactive, true)} progress={scrollLinked ? live : undefined} />
  }
  ProjectMotion.displayName = `ProjectMotion(${motion})`
  return ProjectMotion
}
