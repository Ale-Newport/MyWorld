/* Each test file gets its own empty data directory before any server module is
   imported (config reads CMS_DATA_DIR once), so tests never touch .data/. */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function freshDataDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `portfolio-${name}-`))
  process.env.CMS_DATA_DIR = dir
  return dir
}

export const root = path.resolve(import.meta.dirname, '..')
export const load = (rel) => import(path.join(root, rel))
