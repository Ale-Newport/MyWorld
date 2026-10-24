/* What parsing a world document costs in memory, measured in Node (the JS heap of a browser tab cannot be sampled in the middle of a
   synchronous parse): the gunzipped bytes, the text, and the parsed tree, as growth over a forced-GC baseline.

     node --expose-gc scripts/qa/world-doc-memory.mjs public/archipelago/seed/editor-world.json.gz

   Before the compact format (16.96 MB gz, 118 MB of JSON): about 317 MB. After (6.99 MB gz, 33 MB): about 140 MB.
   Node's heap uses 8-byte pointers; Chrome's compresses them, so the same parsed tree is about half that in the player. What the ready player
   keeps of it, and how high the heap goes while it starts, is measured in the browser by scripts/qa/world-bytes-heap.mjs. */
import fs from 'node:fs'
import zlib from 'node:zlib'

if (typeof gc !== 'function') { console.error('run with node --expose-gc'); process.exit(1) }
const mb = (x) => (x / 1048576).toFixed(0)
const file = process.argv[2]
const gz = fs.readFileSync(file)
gc()
const start = process.memoryUsage()
const raw = zlib.gunzipSync(gz), afterGunzip = process.memoryUsage()
const text = raw.toString('utf8'), afterText = process.memoryUsage()
const doc = JSON.parse(text), afterParse = process.memoryUsage()
console.log(`${file.split('/').pop()}: ${mb(gz.length)} MB gz, ${Object.keys(doc).length} keys | gunzipped bytes +${mb(afterGunzip.external - start.external)} MB external | text +${mb(afterText.heapUsed - afterGunzip.heapUsed)} MB heap +${mb(afterText.external - afterGunzip.external)} MB external | parsed tree +${mb(afterParse.heapUsed - afterText.heapUsed)} MB heap | everything held at once: ${mb(afterParse.heapUsed + afterParse.external - start.heapUsed - start.external)} MB`)
