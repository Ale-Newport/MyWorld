import {test} from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {MeshoptDecoder} from '../../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
import {packGLB,readGLB,writeGLB,OPTIONS} from '../../scripts/world/compress-models.mjs';
import {inflateGLB,splitGLB,meshoptDecoder,withRetries} from '../../public/archipelago/preview/compressed-gltf.js';

const decoder=async()=>MeshoptDecoder;
function lcg(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
const random=lcg(5);
const typed=a=>Buffer.from(a.buffer,a.byteOffset,a.byteLength);

/** A GLB the way Blender writes one: one buffer view per accessor, Float32 attributes, indices, an image. */
async function sourceGLB({halfWidth=10,uvScale=1,withNormals=true}={}){
 const parts=[],views=[],accessors=[],meshes=[];let offset=0;
 const add=(array,type,componentType,count,extra={},target)=>{const bytes=typed(array);views.push({buffer:0,byteOffset:offset,byteLength:bytes.length,...(target?{target}:{})});parts.push(bytes,Buffer.alloc((4-bytes.length%4)%4));offset+=bytes.length+(4-bytes.length%4)%4;accessors.push({bufferView:views.length-1,componentType,count,type,...extra});return accessors.length-1;};
 const bounds=(array,n)=>({min:Array.from({length:n},(_,c)=>Math.min(...array.filter((_,i)=>i%n===c))),max:Array.from({length:n},(_,c)=>Math.max(...array.filter((_,i)=>i%n===c)))});
 for(let m=0;m<3;m++){
  const vertices=60+m*20,position=Float32Array.from({length:vertices*3},()=>(random()-.5)*2*halfWidth*(m===2?1000:1)),normal=new Float32Array(vertices*3),uv=Float32Array.from({length:vertices*2},()=>random()*uvScale);
  for(let i=0;i<vertices;i++){const x=random()-.5,y=random()-.5,z=random()-.5,l=Math.hypot(x,y,z);normal.set([x/l,y/l,z/l],i*3);}
  normal.set([0,1,0,1,0,0,0,0,-1],0);// axis-aligned normals, as most of the island's are
  const indices=Uint16Array.from({length:(vertices-2)*3},(_,i)=>i%3===0?(i/3)%vertices:i%3===1?(i/3+1)%vertices:(i/3+2)%vertices);
  const color=Float32Array.from({length:vertices*3},()=>random());
  const attributes={POSITION:add(position,'VEC3',5126,vertices,bounds(position,3),34962),...(withNormals?{NORMAL:add(normal,'VEC3',5126,vertices,{},34962)}:{}),TEXCOORD_0:add(uv,'VEC2',5126,vertices,{},34962),COLOR_0:add(color,'VEC3',5126,vertices,{},34962)};
  meshes.push({name:'mesh'+m,primitives:[{attributes,indices:add(indices,'SCALAR',5123,indices.length,{},34963),mode:4,material:0}]});
 }
 // a duplicate of mesh 0's position accessor, as a Blender export of two identical props has
 const again=Float32Array.from(new Float32Array(parts[0].buffer,parts[0].byteOffset,parts[0].length/4));
 accessors.push({bufferView:views.length,componentType:5126,count:again.length/3,type:'VEC3',...bounds(again,3)});views.push({buffer:0,byteOffset:offset,byteLength:again.byteLength,target:34962});parts.push(typed(again));offset+=again.byteLength;
 meshes.push({name:'twin',primitives:[{attributes:{POSITION:accessors.length-1},mode:4}]});
 const png=await sharp(Buffer.from(Array.from({length:16*16*4},(_,i)=>i%4===3?(i>>2)%3===0?0:255:(i*37)&255)),{raw:{width:16,height:16,channels:4}}).png().toBuffer();
 views.push({buffer:0,byteOffset:offset,byteLength:png.length});parts.push(png,Buffer.alloc((4-png.length%4)%4));offset+=png.length+(4-png.length%4)%4;
 const json={asset:{version:'2.0',generator:'test'},scene:0,scenes:[{nodes:[0,1,2,3]}],nodes:meshes.map((_,i)=>({mesh:i,name:'n'+i,translation:[i,0,0]})),meshes,materials:[{name:'m',pbrMetallicRoughness:{baseColorTexture:{index:0}}}],textures:[{source:0}],images:[{name:'tex',mimeType:'image/png',bufferView:views.length-1}],accessors,bufferViews:views,buffers:[{byteLength:offset}]};
 return writeGLB(json,Buffer.concat(parts));
}
function read(glb,index){
 const {json,bin}=splitGLB(glb),a=json.accessors[index],n={SCALAR:1,VEC2:2,VEC3:3}[a.type],view=json.bufferViews[a.bufferView];
 const T={5123:Uint16Array,5125:Uint32Array,5126:Float32Array}[a.componentType],start=view.byteOffset||0;
 return new T(bin.buffer.slice(bin.byteOffset+start,bin.byteOffset+start+a.count*n*T.BYTES_PER_ELEMENT));
}

test('a packed model inflates to the Blender export: indices and colours identical, positions, normals and uvs within the promised steps',async()=>{
 const source=await sourceGLB(),{glb,stats}=await packGLB(source),plain=Buffer.from(await inflateGLB(glb,decoder)),before=readGLB(source),after=readGLB(plain);
 assert.ok(glb.length<source.length,'it is smaller even for random vertices');
 assert.equal(after.json.accessors.length,before.json.accessors.length);
 assert.deepEqual(after.json.nodes,before.json.nodes);assert.deepEqual(after.json.materials,before.json.materials);assert.deepEqual(after.json.meshes,before.json.meshes);
 assert.deepEqual(after.json.accessors.map(({bufferView:_view,...a})=>a),before.json.accessors.map(({bufferView:_view,...a})=>a),'every accessor is defined as it was: Float32, same bounds, no leftovers of the packing');
 for(const key of ['extensionsUsed','extensionsRequired'])assert.equal(after.json[key],undefined,'no extension left for the loader to trip on');
 assert.equal(stats.accessors.shared,1,'the duplicate position accessor shares its compressed bytes');
 const roles=new Map();for(const mesh of before.json.meshes)for(const p of mesh.primitives){for(const [k,a] of Object.entries(p.attributes))roles.set(a,k);if(p.indices!==undefined)roles.set(p.indices,'INDEX');}
 let quantized=0,kept=0;
 for(const [index,role] of roles){
  const a=read(source,index),b=read(plain,index);assert.equal(a.length,b.length,`accessor ${index} length`);
  if(role==='INDEX'||role==='COLOR_0'){assert.deepEqual(Array.from(b),Array.from(a),`${role} identical`);continue;}
  if(role==='POSITION'){
   const def=before.json.accessors[index],span=Math.max(...def.max.map((m,c)=>m-def.min[c])),limit=span/65535/2*1.0001;let worst=0;for(let i=0;i<a.length;i++)worst=Math.max(worst,Math.abs(a[i]-b[i]));
   if(worst===0)kept++;else{quantized++;assert.ok(worst<=limit,`accessor ${index} position error ${worst} within half a step ${limit}`);assert.ok(limit<=OPTIONS.positionHalfStepMetres*1.0001,'and that step is within a quarter of a millimetre');}
   for(let c=0;c<3;c++){const column=Array.from(b).filter((_,i)=>i%3===c);assert.equal(Math.min(...column),def.min[c],'bounds are exact');assert.equal(Math.max(...column),def.max[c]);}
  }else if(role==='NORMAL'){
   let worst=0;for(let i=0;i<a.length;i+=3){const cross=Math.hypot(a[i+1]*b[i+2]-a[i+2]*b[i+1],a[i+2]*b[i]-a[i]*b[i+2],a[i]*b[i+1]-a[i+1]*b[i]);worst=Math.max(worst,Math.atan2(cross,a[i]*b[i]+a[i+1]*b[i+1]+a[i+2]*b[i+2])*180/Math.PI);assert.ok(Math.abs(Math.hypot(b[i],b[i+1],b[i+2])-1)<1e-5,'unit length restored');}
   assert.ok(worst<.25,`normals within a quarter of a degree (${worst})`);
   assert.deepEqual(Array.from(b.slice(0,9)).map(v=>+v.toFixed(5)),[0,1,0,1,0,0,0,0,-1],'axis-aligned normals come back exactly axis-aligned');
  }else if(role==='TEXCOORD_0'){let worst=0;for(let i=0;i<a.length;i++)worst=Math.max(worst,Math.abs(a[i]-b[i]));assert.ok(worst<=1/65535/2*1.0001,`uv error ${worst}`);}
 }
 assert.ok(quantized>=2&&kept>=1,`two meshes are quantised and the 20 m one stays Float32 (${quantized}/${kept})`);
});
test('the image becomes WebP with exactly the same pixels, and the loader sees a plain texture',async()=>{
 const source=await sourceGLB(),{glb,stats}=await packGLB(source),plain=readGLB(Buffer.from(await inflateGLB(glb,decoder))),original=readGLB(source);
 assert.equal(stats.images[0].mime,'image/webp');assert.equal(stats.images[0].nearLossless,false);
 assert.equal(plain.json.images[0].mimeType,'image/webp');assert.equal(plain.json.textures[0].source,0);assert.equal(plain.json.textures[0].extensions,undefined);
 const bytes=(g)=>{const v=g.json.bufferViews[g.json.images[0].bufferView];return g.bin.subarray(v.byteOffset||0,(v.byteOffset||0)+v.byteLength);};
 const a=await sharp(bytes(original)).ensureAlpha().raw().toBuffer(),b=await sharp(bytes(plain)).ensureAlpha().raw().toBuffer();
 assert.equal(Buffer.compare(a,b),0,'lossless: every RGBA byte, including the colours under transparent pixels');
});
test('what is too coarse to quantise stays Float32: normals that are not unit vectors, uvs spanning more than 8, meshes past a quarter of a millimetre',async()=>{
 const source=await sourceGLB({uvScale:40,withNormals:true}),{stats,glb}=await packGLB(source);
 assert.equal(stats.quantized.uv,0);assert.ok(stats.quantized.uvKept>0);assert.equal(stats.quantized.positionKept,1);
 const plain=Buffer.from(await inflateGLB(glb,decoder)),{json}=splitGLB(plain);
 for(const m of readGLB(source).json.meshes){const uv=m.primitives[0].attributes.TEXCOORD_0;if(uv!==undefined)assert.deepEqual(Array.from(read(plain,uv)),Array.from(read(source,uv)),'uvs identical');}
 assert.ok(json.accessors.every(a=>a.componentType!==5123||a.type==='SCALAR'),'no quantised accessor survives inflation');
 const bent=readGLB(await sourceGLB());const view=bent.json.bufferViews[bent.json.accessors.find(a=>a.type==='VEC3'&&a.bufferView===1).bufferView];
 const raw=Buffer.from(bent.bin);new Float32Array(raw.buffer,raw.byteOffset+view.byteOffset,3).set([3,0,0]);
 const odd=await packGLB(writeGLB(bent.json,raw));assert.equal(odd.stats.quantized.normalKept,1,'one non-unit normal keeps its accessor lossless');
});
test('--lossless packs without quantising anything and still reads back identically',async()=>{
 const source=await sourceGLB(),{glb,stats}=await packGLB(source,{lossless:true});
 assert.equal(stats.quantized.position+stats.quantized.normal+stats.quantized.uv,0);
 const plain=Buffer.from(await inflateGLB(glb,decoder));
 for(let i=0;i<readGLB(source).json.accessors.length;i++){const a=read(source,i),b=read(plain,i);assert.deepEqual(Array.from(b),Array.from(a),`accessor ${i}`);}
});
test('a GLB that was not packed passes through untouched, and the decoder is not even asked for',async()=>{
 const source=await sourceGLB(),result=await inflateGLB(source,()=>{throw Error('no decoder needed');});
 assert.equal(Buffer.compare(Buffer.from(result),source),0);
 await assert.rejects(()=>inflateGLB(Buffer.from('nope, not a glb at all'),decoder),/Not a GLB/);
});
test('packing is deterministic, so a copy can be checked against its source',async()=>{
 const source=await sourceGLB(),a=await packGLB(source),b=await packGLB(source);
 assert.equal(Buffer.compare(a.glb,b.glb),0);
 assert.equal(readGLB(a.glb).json.asset.extras.portfolioPack.format,'portfolio-meshopt-1');
});
test('the decoder loads through the same path the player uses, once',async()=>{
 const a=await meshoptDecoder(),b=await meshoptDecoder();
 assert.equal(a,b,'one decoder for every model');await a.ready;assert.equal(typeof a.decodeGltfBuffer,'function');
});
test('withRetries asks again with a new attempt number and gives up with the last error',async()=>{
 const seen=[];
 assert.equal(await withRetries(async attempt=>{seen.push(attempt);if(attempt<2)throw Error('down '+attempt);return 'up';},3,1),'up');
 assert.deepEqual(seen,[0,1,2],'each attempt can name its own URL');
 const tried=[];await assert.rejects(()=>withRetries(async attempt=>{tried.push(attempt);throw Error('still down '+attempt);},3,1),/still down 2/);
 assert.deepEqual(tried,[0,1,2]);
 assert.equal(await withRetries(async()=>7),7,'a load that works is not repeated');
 let calls=0;await withRetries(async()=>{calls++;return 1;});assert.equal(calls,1);
});
