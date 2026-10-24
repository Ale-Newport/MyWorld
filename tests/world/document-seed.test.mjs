import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {compactWorldDocument,shortenFloat32Arrays} from '../../public/archipelago/preview/world-instances.js';
import {definitionsToRestore} from '../../public/archipelago/preview/asset-definitions.js';

const root=path.resolve(import.meta.dirname,'../..'),seed=path.join(root,'public/archipelago/seed'),manifest=JSON.parse(fs.readFileSync(path.join(root,'src/server/world-seed.json'),'utf8'));
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const worldBytes=fs.readFileSync(path.join(seed,'editor-world.json.gz')),assetBytes=fs.readFileSync(path.join(seed,'asset-definitions.json'));

test('world-seed.json describes the seed files that are shipped',()=>{
 assert.deepEqual(manifest.world,{path:'/archipelago/seed/editor-world.json.gz',sha:sha(worldBytes),size:worldBytes.length});
 assert.deepEqual(manifest.assets,{path:'/archipelago/seed/asset-definitions.json',sha:sha(assetBytes),size:assetBytes.length});
});
test('the seed world document is compact: surfaces without triangulation or textures, Float32 arrays in their shortest decimals',()=>{
 const doc=JSON.parse(zlib.gunzipSync(worldBytes));
 assert.equal(doc.schema,2);assert.ok(doc.states&&doc.added.length>50&&doc.instanceRefs.length>200,'it is the whole Archipelago');
 let surfaces=0;
 for(const json of doc.added){
  const root=json.object;if(!root.userData?.surfaceDefinition)continue;surfaces++;
  const geometry=json.geometries.find(g=>g.uuid===root.geometry);
  assert.deepEqual(geometry.data.attributes.position.array,[],`${root.name}: no stored triangulation`);
  assert.equal(json.textures,undefined);assert.equal(json.images,undefined);
 }
 assert.ok(surfaces>=10,`the ${surfaces} map surfaces are all there`);
 const text=JSON.stringify(doc);
 assert.ok(text.length<45e6,`the document is ${(text.length/1e6).toFixed(1)} MB of JSON (it was 118)`);assert.ok(worldBytes.length<8e6,`and ${(worldBytes.length/1e6).toFixed(2)} MB gzipped (it was 16.96)`);
 // idempotent: nothing more to strip or shorten
 const again=JSON.stringify(compactWorldDocument(JSON.parse(text)));
 assert.equal(again.length,text.length);assert.equal(again,text);
});
test('the seed asset definitions are in the same compact form, and the player needs only a few of them',()=>{
 const defs=JSON.parse(assetBytes.toString('utf8')),world=JSON.parse(zlib.gunzipSync(worldBytes));
 const text=JSON.stringify(defs);assert.equal(assetBytes.toString('utf8'),text,'written the way JSON.stringify writes it');
 for(const d of defs.definitions)shortenFloat32Arrays(d.object);
 assert.equal(JSON.stringify(defs),text,'Float32 text is already shortest');
 const exists=id=>['v4:pier','world2:collection:explosiveCrates'].includes(id),only=definitionsToRestore(world,exists,defs.definitions),needed=defs.definitions.filter(only);
 assert.deepEqual(defs.definitions.filter(definitionsToRestore(world,exists)).map(d=>d.id),needed.map(d=>d.id),'no shipped definition names another in its own tree: reading the parsed ones adds nothing');
 const bytes=needed.reduce((n,d)=>n+JSON.stringify(d).length,0);
 assert.ok(needed.length<defs.definitions.length&&bytes<.1*text.length,`the player parses ${needed.length} of ${defs.definitions.length} definitions, ${(bytes/1e3).toFixed(0)} KB of ${(text.length/1e3).toFixed(0)} KB`);
 assert.ok(needed.some(d=>d.id==='experience-part:615e6628-d9eb-4fe9-ab44-dfcd7d1dfbdb'),'a definition an instance reference names is among them');
});
