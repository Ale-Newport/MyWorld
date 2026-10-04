import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const blender = process.env.BLENDER_BIN || (existsSync('/Applications/Blender.app/Contents/MacOS/Blender') ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender')
const result = spawnSync(blender, ['--factory-startup', '--background', '--python-exit-code', '1', '--python', path.join(root, 'scripts/export-world2-blender.py'), '--', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' })
if (result.error) console.error('Set BLENDER_BIN to your Blender executable.', result.error.message)
if (result.status !== 0) process.exit(result.status ?? 1)
const map = spawnSync(process.execPath, [path.join(root, 'scripts/world2-map.mjs')], { cwd: root, stdio: 'inherit' })
process.exit(map.status ?? 1)
