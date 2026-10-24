import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/* The server (src/server/world.ts, checkWorld) parses a world document whole to validate it, except on a Cloudflare Worker
   when the document is bigger than FULL_CHECK_MAX: there it checks only the files and the asset definitions, because a
   Worker has 128 MB. Parsing holds the gunzipped bytes, their text and the parsed tree at once (scripts/qa/world-doc-memory.mjs
   measures 140 MB for the 33 MB seed). The studio's compact documents are about 33 MB, so the limit has to sit below that.
   It was 48 MB, a number chosen against the old 118 MB document, and it stopped guarding anything once the document shrank. */
const root=path.resolve(import.meta.dirname,'../..'),MiB=1024*1024,WORKER_MEMORY=128*MiB,HELD_AT_ONCE=4.5;
const source=fs.readFileSync(path.join(root,'src/server/world.ts'),'utf8');
const limit=Number(source.match(/const FULL_CHECK_MAX = (\d+) \* 1024 \* 1024/)?.[1])*MiB;
const seed=fs.readFileSync(path.join(root,'public/archipelago/seed/editor-world.json.gz'));
/** The size a gzip says it unzips to (its trailer, as src/server/world.ts reads it). */
const unzipped=bytes=>bytes.readUInt32LE(bytes.length-4);

test('world.ts still lets a Worker skip the full parse of a big document',()=>{
 assert.ok(limit>0,'FULL_CHECK_MAX is a number of MiB in src/server/world.ts');
 assert.match(source,/onWorkers\(\) && size > FULL_CHECK_MAX/,'checkWorld takes the light path on Workers past the limit');
});
test('the shipped world document is past that limit, so a Worker never parses it whole',()=>{
 const size=unzipped(seed);
 assert.ok(size>limit,`the seed unzips to ${(size/MiB).toFixed(1)} MiB and FULL_CHECK_MAX is ${(limit/MiB).toFixed(0)} MiB: a Worker would parse all of it (${(size*HELD_AT_ONCE/MiB).toFixed(0)} MiB held at once, it has 128). Lower FULL_CHECK_MAX in src/server/world.ts.`);
});
test('a document at the limit still parses within a Worker\'s memory',()=>{
 assert.ok(limit*HELD_AT_ONCE<WORKER_MEMORY,`${(limit/MiB).toFixed(0)} MiB held ${HELD_AT_ONCE} times over is ${(limit*HELD_AT_ONCE/MiB).toFixed(0)} MiB; a Worker has 128. Lower FULL_CHECK_MAX in src/server/world.ts.`);
});
