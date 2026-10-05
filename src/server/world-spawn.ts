/* ============================================================
   THE DRIVE SPAWN IN THE WORLD DOCUMENT

   worldVariant (the root's data in the world document) may pin
   where /world starts: `spawn` in map coordinates [x, north,
   height], `spawnHeading` (radians about +Y, the car's nose on
   +X) and `spawnPinned: true`, written by the studio's "Set drive
   spawn here". Without the pin the player starts in the Central
   Plaza and an old `spawn` is legacy data it ignores, so documents
   saved before the pin existed stay valid. Kept apart from
   world.ts (which needs Next's request APIs) so it can be tested.
   ============================================================ */

/** Problems with the pinned drive spawn of a world variant (empty when there is none, or it is complete). */
export function driveSpawnProblems(variant: Record<string, unknown> | undefined): string[] {
  const problems: string[] = []
  if (variant?.spawnPinned !== undefined && typeof variant.spawnPinned !== 'boolean') problems.push('worldVariant.spawnPinned must be true or false.')
  if (variant?.spawnPinned === true) {
    const spawn = variant.spawn
    if (!Array.isArray(spawn) || spawn.length !== 3 || !spawn.every((n) => typeof n === 'number' && Number.isFinite(n))) problems.push('The pinned drive spawn must be [x, north, height] in finite numbers.')
    if (variant.spawnHeading !== undefined && !(typeof variant.spawnHeading === 'number' && Number.isFinite(variant.spawnHeading))) problems.push('The pinned drive spawn heading must be a finite number.')
  }
  return problems
}
