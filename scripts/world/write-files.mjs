/* Writes a set of files so that a crash or a full disk cannot leave them half done: every file goes to a temporary name next to its
   target first, and only when all of them are written are they renamed over the targets (a rename within a folder is atomic).
   The seed files and src/server/world-seed.json describe one another, so they are written together. */
import fs from 'node:fs'
import path from 'node:path'

/** `entries` is [[file, bytes], ...] with absolute paths. */
export function writeFiles(entries) {
  const staged = []
  try {
    for (const [file, bytes] of entries) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`)
      staged.push([temporary, file]); fs.writeFileSync(temporary, bytes)
    }
  } catch (error) {
    for (const [temporary] of staged) fs.rmSync(temporary, { force: true })
    throw error
  }
  for (const [temporary, file] of staged) fs.renameSync(temporary, file)
}
