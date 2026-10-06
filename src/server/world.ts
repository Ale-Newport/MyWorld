import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import { config } from './config.ts'
import { putBlob, readBlob } from './blobs.ts'
import { exists, head, publish, readRevision, saveDraft, seed, type BlobRef, type RevisionMeta } from './revisions.ts'
import { SYSTEM, type Actor } from './audit.ts'
import { ValidationError } from './auth/guard.ts'
import { driveSpawnProblems } from './world-spawn.ts'

/* ============================================================
   THE WORLD DOCUMENT

   /world, the M map and the admin's world editor all read the
   same thing: the Archipelago document HelloWorld's editor saves
   (schema 2 — states, added objects, instance references and
   experience groups applied over AlejandroWorld.glb), plus its
   asset definitions. Both are stored as content-addressed blobs
   and named by a revision; publishing moves a pointer.

   Before the first save the published world is the seed in
   public/archipelago/seed, a static asset (hashes in world-seed.json): the
   Archipelago imported from HelloWorld (4ccab18), as saved by the
   portfolio's world editor with its additions (the infield slalom,
   the penguin round-up, the paddock grove and the coastal lookout,
   and the ice props as physics bodies). scripts/world/ rebuilds it.
   ============================================================ */

import SEED from './world-seed.json' with { type: 'json' }

/** The seed's two files are static assets (public/archipelago/seed); their hashes are in world-seed.json. */
async function seedBytes(sha: string): Promise<Buffer | null> {
  const file = sha === SEED.world.sha ? SEED.world.path : sha === SEED.assets.sha ? SEED.assets.path : null
  if (!file) return null
  const cf = await cloudflareAssets()
  if (cf) {
    const res = await cf.fetch(new Request(new URL(file, 'https://assets.local')))
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null
  }
  const fs = await import('node:fs')
  const local = path.join(/* turbopackIgnore: true */ process.cwd(), 'public', file)
  return fs.existsSync(local) ? fs.readFileSync(local) : null
}

/** On Cloudflare, the Worker's static-assets binding. */
async function cloudflareAssets(): Promise<{ fetch: (req: Request) => Promise<Response> } | null> {
  if (!onWorkers()) return null
  const { getCloudflareContext } = await import('@opennextjs/cloudflare')
  return ((getCloudflareContext().env as unknown as { ASSETS?: { fetch: (req: Request) => Promise<Response> } }).ASSETS) ?? null
}

const onWorkers = () => !!(globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent?.includes('Cloudflare-Workers')

export interface WorldRefs {
  world: BlobRef
  assets: BlobRef
}

const seedRefs = (): WorldRefs => ({ world: { sha: SEED.world.sha, size: SEED.world.size }, assets: { sha: SEED.assets.sha, size: SEED.assets.size } })

export async function publishedWorld(): Promise<{ refs: WorldRefs; revision: RevisionMeta | null }> {
  try {
    const { published } = await head('world')
    const rev = published && (await readRevision(published.id))
    if (rev?.blobs?.world && rev.blobs.assets) return { refs: { world: rev.blobs.world, assets: rev.blobs.assets }, revision: published }
  } catch (error) {
    // A broken store must not take /world down: serve the shipped world.
    console.error('[world] could not read the published world; serving the seed', error)
  }
  return { refs: seedRefs(), revision: null }
}

/** Bytes of a blob, from the store or (for the seed) from the static assets. */
export async function worldBlob(sha: string): Promise<Buffer | null> {
  // The seed's two files are known by hash: served from the static assets, never the store.
  return (await seedBytes(sha)) ?? (await readBlob(sha))
}

/** The public may read exactly the blobs of the published world, nothing else (drafts stay private). */
export async function isPublishedBlob(sha: string) {
  const { refs } = await publishedWorld()
  return sha === refs.world.sha || sha === refs.assets.sha
}

/** The editor's starting point; imports the seed into the store on first use. */
export async function draftWorld(actor: Actor = SYSTEM) {
  if (!(await exists('world'))) {
    const s = seedRefs()
    for (const ref of [s.world, s.assets]) {
      const bytes = await seedBytes(ref.sha)
      if (!bytes) throw new Error('The shipped world seed is missing from the static assets.')
      await putBlob(bytes, ref.sha)
    }
    await seed('world', 'world', {
      blobs: { world: s.world, assets: s.assets },
      schemaVersion: 2,
      message: 'Imported the shipped Archipelago (HelloWorld 4ccab18 with the portfolio’s areas) as the first revision',
      actor,
    })
  }
  const current = await head('world')
  const rev = (await readRevision(current.draft!.id))!
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
  // A pinned drive spawn must be complete; without the pin the plaza is used (see world-spawn.ts).
  for (const message of driveSpawnProblems(variant)) error(message)
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

/* A world document is ~118 MB once unzipped: more than a Cloudflare Worker's 128 MB
   can parse. Past this size, on Workers, the server checks only what it can — the
   files exist, the world is a gzip of a sane size, the asset definitions are sound —
   and the structural checks are the studio's own (its Validate World runs in the
   editor's browser before every save). Everywhere else everything is checked. */
const FULL_CHECK_MAX = 48 * 1024 * 1024

/** Uncompressed size from a gzip's trailer (ISIZE, mod 2^32). */
const gunzippedSize = (b: Buffer) => (b.length >= 4 && b[0] === 0x1f && b[1] === 0x8b ? b.readUInt32LE(b.length - 4) : b.length)

export async function checkWorld(refs: WorldRefs): Promise<WorldProblem[]> {
  let worldBytes: Buffer | null, assets: Json
  try {
    worldBytes = await worldBlob(refs.world.sha)
    const assetBytes = await worldBlob(refs.assets.sha)
    if (!worldBytes || !assetBytes) throw new ValidationError('A file of this world revision is missing from the store; upload it again.')
    assets = JSON.parse(assetBytes.toString('utf8')) as Json
  } catch (error) {
    if (error instanceof ValidationError) throw error
    throw new ValidationError(`The world file could not be read: ${(error as Error).message}`)
  }
  const size = gunzippedSize(worldBytes)
  if (size > config.maxWorldJsonBytes) throw new ValidationError('The world file is larger than the store accepts.')
  if (onWorkers() && size > FULL_CHECK_MAX) {
    const problems: WorldProblem[] = []
    if (assets.schema !== 1 || !Array.isArray(assets.definitions)) problems.push({ severity: 'error', message: 'Asset definitions are missing or have an unknown schema.' })
    const ids = new Set<string>()
    for (const d of (assets.definitions as Json[] | undefined) ?? []) {
      if (typeof d?.id !== 'string') problems.push({ severity: 'error', message: 'An asset definition has no id.' })
      else if (ids.has(d.id)) problems.push({ severity: 'error', message: `Two asset definitions share the id “${d.id}”.` })
      else ids.add(d.id)
    }
    return problems
  }
  let world: Json
  try {
    world = parseWorldBlob(worldBytes)
  } catch (error) {
    throw new ValidationError(`The world file could not be read: ${(error as Error).message}`)
  }
  return validateWorld(world, assets)
}

export async function saveWorldDraft({ base, refs, message, actor, force }: { base: string | null; refs: WorldRefs; message?: string; actor: Actor; force?: boolean }) {
  await draftWorld(actor)
  const problems = (await checkWorld(refs)).filter((p) => p.severity === 'error')
  if (problems.length) throw new ValidationError(`The world has ${problems.length} problem(s): ${problems.slice(0, 3).map((p) => p.message).join(' ')}`, problems)
  return saveDraft('world', { base, blobs: { world: refs.world, assets: refs.assets }, schemaVersion: 2, message, actor, force })
}

export async function publishWorld({ revisionId, actor }: { revisionId?: string; actor: Actor }) {
  await draftWorld(actor)
  return publish('world', {
    revisionId,
    actor,
    validate: async (rev) => {
      if (!rev.blobs?.world || !rev.blobs.assets) throw new ValidationError('That revision has no world files.')
      const problems = (await checkWorld({ world: rev.blobs.world, assets: rev.blobs.assets })).filter((p) => p.severity === 'error')
      if (problems.length) throw new ValidationError(`Not published: ${problems.length} problem(s). ${problems.slice(0, 3).map((p) => p.message).join(' ')}`, problems)
    },
  })
}
