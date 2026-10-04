import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { config } from './config.ts'
import { hasBlob, putBlob, readBlob, sha256 } from './blobs.ts'
import { exists, head, publish, readRevision, saveDraft, seed, type BlobRef, type RevisionMeta } from './revisions.ts'
import { SYSTEM, type Actor } from './audit.ts'
import { ValidationError } from './auth/guard.ts'

/* ============================================================
   THE WORLD DOCUMENT

   /world, the M map and the admin's world editor all read the
   same thing: the Archipelago document HelloWorld's editor saves
   (schema 2 — states, added objects, instance references and
   experience groups applied over AlejandroWorld.glb), plus its
   asset definitions. Both are stored as content-addressed blobs
   and named by a revision; publishing moves a pointer.

   Before the first save the published world is the seed in
   content/seed/world/archipelago, read straight from disk: the
   Archipelago imported from HelloWorld (4ccab18), as saved by the
   portfolio's world editor with its additions (the infield slalom,
   the penguin round-up, the paddock grove and the coastal lookout,
   and the ice props as physics bodies). scripts/world/ rebuilds it.
   ============================================================ */

// Read at run time; next.config's outputFileTracingIncludes ships these two files with the routes that need them.
const SEED_DIR = path.join(/* turbopackIgnore: true */ process.cwd(), 'content', 'seed', 'world', 'archipelago')
const SEED = { world: path.join(SEED_DIR, 'editor-world.json.gz'), assets: path.join(SEED_DIR, 'asset-definitions.json') }

export interface WorldRefs {
  world: BlobRef
  assets: BlobRef
}

let seedRefs: (WorldRefs & { files: Record<string, string> }) | null = null
function seedFiles() {
  if (seedRefs) return seedRefs
  const world = fs.readFileSync(/* turbopackIgnore: true */ SEED.world)
  const assets = fs.readFileSync(/* turbopackIgnore: true */ SEED.assets)
  seedRefs = {
    world: { sha: sha256(world), size: world.byteLength },
    assets: { sha: sha256(assets), size: assets.byteLength },
    files: {} as Record<string, string>,
  }
  seedRefs.files[seedRefs.world.sha] = SEED.world
  seedRefs.files[seedRefs.assets.sha] = SEED.assets
  return seedRefs
}

export function publishedWorld(): { refs: WorldRefs; revision: RevisionMeta | null } {
  if (exists('world')) {
    const { published } = head('world')
    const rev = published && readRevision(published.id)
    if (rev?.blobs?.world && rev.blobs.assets) return { refs: { world: rev.blobs.world, assets: rev.blobs.assets }, revision: published }
  }
  const s = seedFiles()
  return { refs: { world: s.world, assets: s.assets }, revision: null }
}

/** Bytes of a blob, from the store or (for the seed) from disk. */
export function worldBlob(sha: string): Buffer | null {
  if (hasBlob(sha)) return readBlob(sha)
  const file = seedFiles().files[sha]
  return file ? fs.readFileSync(file) : null
}

/** The public may read exactly the blobs of the published world, nothing else (drafts stay private). */
export function isPublishedBlob(sha: string) {
  const { refs } = publishedWorld()
  return sha === refs.world.sha || sha === refs.assets.sha
}

/** The editor's starting point; imports the seed into the store on first use. */
export function draftWorld(actor: Actor = SYSTEM) {
  if (!exists('world')) {
    const s = seedFiles()
    putBlob(fs.readFileSync(/* turbopackIgnore: true */ SEED.world), s.world.sha)
    putBlob(fs.readFileSync(/* turbopackIgnore: true */ SEED.assets), s.assets.sha)
    seed('world', 'world', {
      blobs: { world: s.world, assets: s.assets },
      schemaVersion: 2,
      message: 'Imported the shipped Archipelago (HelloWorld 4ccab18 with the portfolio’s areas) as the first revision',
      actor,
    })
  }
  const current = head('world')
  const rev = readRevision(current.draft!.id)!
  return { head: current, refs: { world: rev.blobs!.world, assets: rev.blobs!.assets } as WorldRefs }
}

/* ---- validation --------------------------------------------- */

export interface WorldProblem { severity: 'error' | 'warning'; message: string }

const KNOWN_BASES = ['AlejandroWorld-v4']
const SHAPES = ['SELF_RIGHTING', 'CAPSULE', 'CONE', 'CYLINDER', 'BOX', 'SPHERE', 'CONVEX_HULL']
type Json = Record<string, unknown>

export function parseWorldBlob(bytes: Buffer): Json {
  const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes, { maxOutputLength: config.maxWorldJsonBytes }) : bytes
  return JSON.parse(raw.toString('utf8'))
}

/**
 * Structural checks on a world document and its asset definitions:
 * schema, base, references between groups, objects and definitions, and
 * the physics values the runtime feeds straight into Rapier.
 */
export function validateWorld(world: Json, assets: Json): WorldProblem[] {
  const problems: WorldProblem[] = []
  const error = (message: string) => problems.push({ severity: 'error', message })
  const warn = (message: string) => problems.push({ severity: 'warning', message })
  if (world.schema !== 2) error(`World schema ${String(world.schema)} is not supported (expected 2).`)
  if (!KNOWN_BASES.includes(String(world.base))) error(`Unknown base world “${String(world.base)}”.`)
  const states = world.states as Record<string, Json> | undefined
  if (!states || typeof states !== 'object' || !Object.keys(states).length) error('The world has no object states.')
  if (!Array.isArray(world.added)) error('The world has no list of added objects.')
  if (!Array.isArray(world.instanceRefs)) error('The world has no instance references.')
  const variant = (states?.['v4:world']?.data as Json | undefined)?.worldVariant as Json | undefined
  if (variant?.id !== 'archipelago') error('The world root is not the Archipelago variant.')
  if (assets.schema !== 1 || !Array.isArray(assets.definitions)) error('Asset definitions are missing or have an unknown schema.')
  const definitionIds = new Set<string>()
  for (const d of (assets.definitions as Json[] | undefined) ?? []) {
    if (typeof d?.id !== 'string') { error('An asset definition has no id.'); continue }
    if (definitionIds.has(d.id)) error(`Two asset definitions share the id “${d.id}”.`)
    definitionIds.add(d.id)
  }
  const experiences = world.experiences as Json | undefined
  const groupIds = new Set<string>()
  if (experiences) {
    for (const g of (experiences.groups as Json[]) ?? []) groupIds.add(String(g.id))
    for (const link of (experiences.parentLinks as Json[]) ?? []) {
      const parent = String(link.parentId)
      if (!groupIds.has(parent) && !states?.[parent]) error(`Object ${String(link.id)} is grouped under ${parent}, which does not exist.`)
    }
  }
  for (const ref of (world.instanceRefs as Json[] | undefined) ?? []) {
    const id = String(ref.definitionId ?? '')
    // Custom definitions travel in asset-definitions.json; built-in ones (v4:, world2:…) are generated by the runtime.
    if ((id.startsWith('experience-part:') || id.startsWith('world:')) && !definitionIds.has(id)) error(`An instance refers to the missing asset definition “${id}”.`)
  }
  let pushables = 0
  for (const [id, state] of Object.entries(states ?? {})) {
    const d = state.data as Json | undefined
    if (!d) continue
    if (d.physics_mode !== undefined && !['STATIC', 'DYNAMIC'].includes(String(d.physics_mode))) error(`${id}: physics mode must be STATIC or DYNAMIC.`)
    const range = (key: string, min: number, max: number) => {
      if (d[key] === undefined) return
      const n = Number(d[key])
      if (!Number.isFinite(n) || n < min || n > max) error(`${id}: ${key} ${String(d[key])} is outside ${min}–${max}.`)
    }
    range('friction', 0, 4)
    range('restitution', 0, 1)
    range('linear_damping', 0, 20)
    range('angular_damping', 0, 20)
    if (d.pushable) {
      pushables++
      range('mass', 0.0005, 10)
      range('ballast', 0, 0.9)
      if (!SHAPES.includes(String(d.collider_shape))) error(`${id}: unknown collider shape “${String(d.collider_shape)}”.`)
    } else if (d.physics_mode === 'DYNAMIC') range('mass', 0, 10000)
  }
  if (!pushables) warn('No pushable props are configured; the frozen lake will be static.')
  return problems
}

function readRefs(refs: WorldRefs) {
  const world = worldBlob(refs.world.sha)
  const assets = worldBlob(refs.assets.sha)
  if (!world || !assets) throw new ValidationError('A file of this world revision is missing from the store; upload it again.')
  return { world: parseWorldBlob(world), assets: JSON.parse(assets.toString('utf8')) as Json }
}

export function checkWorld(refs: WorldRefs): WorldProblem[] {
  let parsed
  try {
    parsed = readRefs(refs)
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(`The world file could not be read: ${(error as Error).message}`)
  }
  return validateWorld(parsed.world, parsed.assets)
}

export function saveWorldDraft({ base, refs, message, actor, force }: { base: string | null; refs: WorldRefs; message?: string; actor: Actor; force?: boolean }) {
  draftWorld(actor)
  const problems = checkWorld(refs).filter((p) => p.severity === 'error')
  if (problems.length) throw new ValidationError(`The world has ${problems.length} problem(s): ${problems.slice(0, 3).map((p) => p.message).join(' ')}`, problems)
  return saveDraft('world', { base, blobs: { world: refs.world, assets: refs.assets }, schemaVersion: 2, message, actor, force })
}

export async function publishWorld({ revisionId, actor }: { revisionId?: string; actor: Actor }) {
  draftWorld(actor)
  return publish('world', {
    revisionId,
    actor,
    validate: (rev) => {
      if (!rev.blobs?.world || !rev.blobs.assets) throw new ValidationError('That revision has no world files.')
      const problems = checkWorld({ world: rev.blobs.world, assets: rev.blobs.assets }).filter((p) => p.severity === 'error')
      if (problems.length) throw new ValidationError(`Not published: ${problems.length} problem(s). ${problems.slice(0, 3).map((p) => p.message).join(' ')}`, problems)
    },
  })
}
