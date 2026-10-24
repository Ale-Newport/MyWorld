import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {MODELS,copyStatus} from '../../scripts/world/compress-models.mjs';
import {verifyModel} from '../../scripts/world/verify-models.mjs';

const root=path.resolve(import.meta.dirname,'../..');
const BUDGET={'AlejandroWorld.glb':2.0e6,'world.glb':1.5e6,'vegetation.glb':1.4e6};

test('every shipped .glb.gz was made from the .glb next to it, in the packed format',()=>{
 for(const model of MODELS)assert.equal(copyStatus(model),'current',`${model}.gz: run node scripts/world/compress-models.mjs`);
});
for(const model of MODELS)test(`${path.basename(model)}.gz is the Blender export within its promised tolerances, and small`,async()=>{
 const {problems,report}=await verifyModel(path.join(root,model),path.join(root,model+'.gz'));
 assert.deepEqual(problems,[]);
 assert.ok(report.indices>0&&report.worst.bounds===0,'indices compared, bounds exact');
 const size=fs.statSync(path.join(root,model+'.gz')).size;
 assert.ok(size<BUDGET[path.basename(model)],`${path.basename(model)}.gz is ${(size/1e6).toFixed(2)} MB`);
});
