import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {portableObjectJSON,stripSurfaceJSON,shortestFloat32,shortenFloat32Arrays,compactWorldDocument} from '../../public/archipelago/preview/world-instances.js';
import {definitionsToRestore,AssetDefinitions} from '../../public/archipelago/preview/asset-definitions.js';

/* A small deterministic generator, so a failure names its input. */
function lcg(seed){let s=seed>>>0;return()=>((s=(Math.imul(s,1664525)+1013904223)>>>0)/4294967296);}
const digits=v=>String(Math.abs(v)).replace(/e.*/,'').replace('.','').replace(/^0+/,'').replace(/0+$/,'').length;

test('shortestFloat32 is the shortest decimal that is still the same Float32',()=>{
 const random=lcg(7),values=[];
 for(let i=0;i<20000;i++)values.push(Math.fround((random()-.5)*Math.pow(10,Math.floor(random()*12)-6)));
 for(const v of [0.1,0.2,0.3,1/3,Math.PI,1e-7,123456.789,-20.363670349121094,3.4028234663852886e38,1.401298464324817e-45,16777217,0.5,0.25])values.push(Math.fround(v));
 for(const v of values){
  const text=shortestFloat32(v);
  assert.equal(Math.fround(text),v,`${v} → ${text} must be the same Float32`);
  assert.ok(digits(text)<=9,`${text} needs at most 9 digits`);
  let best=9;for(let p=1;p<=9;p++)if(Math.fround(Number(v.toPrecision(p)))===v){best=p;break;}
  // The bisection assumes more digits never hurt; it can only be one digit long at a power of two's narrow side.
  assert.ok(digits(text)<=best+1,`${v}: ${text} is not shortest (${best} digits suffice)`);
 }
 assert.equal(shortestFloat32(Math.fround(-20.363670349121094)),-20.36367,'the audit\'s example');
 assert.equal(shortestFloat32(Math.fround(0.1)),0.1);
});
test('shortestFloat32 leaves everything that is not a Float32 value alone',()=>{
 for(const v of [0,0.1,Math.PI,1e-300,Infinity,-Infinity,NaN,17,1e9])assert.ok(Object.is(shortestFloat32(v),v)||v===0.1&&shortestFloat32(v)===v,`${v} unchanged`);
 assert.ok(Object.is(shortestFloat32(-0),-0));
 assert.equal(shortestFloat32(0.1),0.1,'a double that is not a Float32 is not rounded');
 assert.equal(shortestFloat32(16777216),16777216);
});

test('shortenFloat32Arrays rewrites Float32 text only, and Float32Array.from of it is bit-identical',()=>{
 const random=lcg(11),position=Float32Array.from({length:3000},()=>(random()-.5)*400),json={geometries:[{uuid:'g',data:{attributes:{position:{itemSize:3,type:'Float32Array',array:Array.from(position),normalized:false},id:{itemSize:1,type:'Uint16Array',array:[1,2,3]}},index:{type:'Uint16Array',array:[0,1,2]}}}],object:{instanceMatrix:{itemSize:16,type:'Float32Array',array:Array.from(Float32Array.from({length:32},()=>random()))}},note:'text',empty:[]};
 const before=JSON.stringify(json),originalMatrix=json.object.instanceMatrix.array.slice(),plain=JSON.stringify(json.geometries[0].data.index);
 shortenFloat32Arrays(json);
 const after=json.geometries[0].data.attributes.position.array;
 assert.deepEqual(Array.from(Float32Array.from(after)),Array.from(position),'every Float32 survives');
 assert.deepEqual(Array.from(Float32Array.from(json.object.instanceMatrix.array)),Array.from(Float32Array.from(originalMatrix)));
 assert.equal(JSON.stringify(json.geometries[0].data.index),plain,'integer arrays are not touched');
 assert.deepEqual(json.geometries[0].data.attributes.id.array,[1,2,3]);
 assert.ok(JSON.stringify(json).length<before.length*.75,'the text is at least a quarter shorter');
 // and a loader reads it back as the same geometry
 const geometry=new THREE.BufferGeometryLoader().parse(json.geometries[0]);
 assert.deepEqual(Array.from(geometry.attributes.position.array),Array.from(position));
});

/** Parametric geometries (BoxGeometry) serialise as their parameters; the world document holds plain BufferGeometry. */
const buffer=g=>new THREE.BufferGeometry().copy(g);
function surfaceMesh({shared=null}={}){
 const geometry=buffer(new THREE.PlaneGeometry(20,20,12,12));
 const texture=new THREE.DataTexture(new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]),2,2);texture.needsUpdate=true;texture.name='slabs';
 const material=shared??new THREE.MeshStandardMaterial({map:texture,name:'Ground_Slabs'});
 const mesh=new THREE.Mesh(geometry,material);mesh.name='Plaza';mesh.userData={surfaceDefinition:{schema:1,kind:'plaza',polygon:[[0,0],[1,0],[1,1],[0,1]],height:0},mapSurface:true,aw_id:'user:1',added:true};
 return mesh;
}
test('a map surface is saved without the triangulation and the textures its definition regenerates',()=>{
 const mesh=surfaceMesh(),full=mesh.toJSON(),json=portableObjectJSON(mesh);
 assert.equal(full.geometries.length,1);assert.equal(full.images.length,1);
 assert.equal(json.object.userData.surfaceDefinition.kind,'plaza','the definition is what is kept');
 const geometry=json.geometries.find(g=>g.uuid===json.object.geometry);
 assert.deepEqual(geometry.data.attributes.position.array,[]);assert.deepEqual(geometry.data.index.array,[]);
 assert.equal(json.textures,undefined);assert.equal(json.images,undefined);
 assert.equal(json.materials[0].map,undefined,'no reference to the dropped texture');
 assert.equal(json.materials[0].name,'Ground_Slabs');
 const restored=new THREE.ObjectLoader().parse(json);
 assert.ok(restored.isMesh);assert.equal(restored.userData.surfaceDefinition.kind,'plaza');assert.equal(restored.geometry.attributes.position.count,0);assert.equal(restored.material.map,null);
 assert.ok(JSON.stringify(json).length<JSON.stringify(full).length/2);
});
test('only surfaces lose their geometry: other objects, shared materials and their textures stay',()=>{
 const group=new THREE.Group(),surface=surfaceMesh(),prop=new THREE.Mesh(buffer(new THREE.BoxGeometry(1,1,1)),surface.material);prop.name='prop';
 group.add(surface,prop);const json=stripSurfaceJSON(group.toJSON());
 const boxId=json.object.children.find(c=>c.name==='prop').geometry;
 assert.ok(json.geometries.find(g=>g.uuid===boxId).data.attributes.position.array.length>0,'the box keeps its vertices');
 assert.equal(json.geometries.find(g=>g.uuid===json.object.children.find(c=>c.name==='Plaza').geometry).data.attributes.position.array.length,0);
 assert.ok(json.materials[0].map,'the material the prop also uses keeps its map');assert.equal(json.textures.length,1);assert.equal(json.images.length,1);
 const plain=new THREE.Mesh(buffer(new THREE.BoxGeometry(1,1,1)),new THREE.MeshBasicMaterial());const before=JSON.stringify(plain.toJSON());
 assert.equal(JSON.stringify(portableObjectJSON(plain)),before,'an object without a surface definition is saved as it was');
});
test('road meshes are still saved without their triangulation and procedural children',()=>{
 const road=new THREE.Mesh(new THREE.PlaneGeometry(12,6),new THREE.MeshStandardMaterial());road.userData={road_points:'[[0,0,0],[1,0,0],[2,0,0]]'};
 const kerb=new THREE.Mesh(buffer(new THREE.BoxGeometry(1,1,1)),new THREE.MeshBasicMaterial());kerb.userData={proceduralDerived:true};road.add(kerb);
 const json=portableObjectJSON(road);
 assert.equal(json.object.children?.length??0,0);assert.deepEqual(json.geometries.find(g=>g.uuid===json.object.geometry).data.attributes.position.array,[]);
 assert.equal(json.geometries.length,1);
});
test('compacting is idempotent and leaves everything else of the document alone',()=>{
 const mesh=surfaceMesh(),doc={schema:2,states:{a:{p:[0.1,0.2,0.30000000000000004]}},instanceRefs:[{id:1}],added:[mesh.toJSON(),new THREE.Mesh(buffer(new THREE.SphereGeometry(1,6,4))).toJSON()],instanceOverrides:[{id:'x',object:new THREE.Mesh(buffer(new THREE.BoxGeometry(1,1,1))).toJSON()}]};
 const states=JSON.stringify(doc.states),once=JSON.stringify(compactWorldDocument(doc)),twice=JSON.stringify(compactWorldDocument(JSON.parse(once)));
 assert.equal(twice,once);assert.equal(JSON.stringify(doc.states),states);
 assert.ok(doc.added[1].geometries[0].data.attributes.position.array.length>0);
});

test('the player parses only the definitions its world can observe',()=>{
 const item=(id,version=1)=>({id,version});
 const world={
  instanceRefs:[{definitionId:'ref',version:1,parts:[{state:{data:{assetDefinitionId:'ref',assetDefinitionVersion:1}}}]}],
  states:{a:{data:{assetDefinitionId:'same',assetDefinitionVersion:1}},b:{data:{assetDefinitionId:'stale',assetDefinitionVersion:1}},c:{data:{assetDefinitionId:'builtin',assetDefinitionVersion:3}},d:{data:{assetDefinitionId:'noversion'}},e:{data:{}}},
  experiences:{groups:[{data:{assetDefinitionId:'group',assetDefinitionVersion:2}}],templates:[{members:[{definitionId:'template-only',definitionVersion:1}]}]},
  added:[{object:{userData:{},children:[{userData:{assetDefinitionId:'nested',assetDefinitionVersion:1},children:[]}]}}],
  instanceOverrides:[{id:'o',object:{object:{userData:{assetDefinitionId:'override',assetDefinitionVersion:1},children:[]}}}],
 };
 const only=definitionsToRestore(world,id=>id==='builtin');
 const parsed=Object.fromEntries([item('ref'),item('same'),item('stale',2),item('builtin',3),item('noversion'),item('group',2),item('template-only'),item('nested'),item('override'),item('unreferenced')].map(i=>[i.id,only(i)]));
 assert.deepEqual(parsed,{ref:true,same:false,stale:true,builtin:true,noversion:true,group:false,'template-only':false,nested:false,override:true,unreferenced:false});
 assert.equal(definitionsToRestore({})(item('x')),false,'a world with no references needs no definition');
});
test('a definition the player parses pulls in the ones its own tree names, however they are ordered',()=>{
 const named=(id,version)=>({userData:{assetDefinitionId:id,assetDefinitionVersion:version},children:[]});
 const item=(id,version=1,children=[])=>({id,version,object:{object:{userData:{},children}}});
 const world={instanceRefs:[{definitionId:'outer',version:1},{definitionId:'top',version:1}]};
 const items=[item('inner',2),item('deepest',5),item('outer',1,[named('inner',1),named('same',1)]),item('same',1),item('free',1),item('top',1,[{userData:{},children:[named('middle',0)]}]),item('middle',1,[named('deepest',1)])];
 const ids=only=>items.filter(only).map(i=>i.id).sort();
 assert.deepEqual(ids(definitionsToRestore(world,()=>false,items)),['deepest','inner','middle','outer','top'],'a stale version named inside a parsed definition (two levels down too) is parsed; a current one and an unnamed one are not');
 assert.deepEqual(ids(definitionsToRestore(world,id=>id==='same',items)),['deepest','inner','middle','outer','same','top'],'a built-in of the same id would be replaced, so it counts');
 assert.deepEqual(ids(definitionsToRestore(world)),['outer','top'],'without the file\'s definitions only the world is read');
 assert.deepEqual(ids(definitionsToRestore({},()=>false,items)),[],'nothing is pulled in by a definition that is not parsed');
});
test('AssetDefinitions.restore skips what it is told to and parses the rest',async()=>{
 const mesh=new THREE.Mesh(buffer(new THREE.BoxGeometry(1,1,1)),new THREE.MeshBasicMaterial()),file={schema:1,definitions:['keep','skip'].map((id,i)=>({id,name:id,version:i+1,object:mesh.toJSON()}))};
 const defs=new AssetDefinitions();await defs.restore(file,{only:item=>item.id==='keep'});
 assert.deepEqual([...defs.definitions.keys()],['keep']);assert.ok(defs.get('keep').node.isMesh);assert.equal(defs.get('keep').version,1);
 const all=new AssetDefinitions();await all.restore(file);assert.deepEqual([...all.definitions.keys()],['keep','skip'],'no filter outside the player: the studio keeps every definition');
 assert.deepEqual(defs.document().definitions.map(d=>d.id),['keep'],'a definition that was not parsed is not part of what a save writes');
});
