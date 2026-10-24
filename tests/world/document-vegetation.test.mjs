import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import {World2Catalog,worldNamesVegetation} from '../../public/archipelago/preview/world2-catalog.js';
import {AssetDefinitions} from '../../public/archipelago/preview/asset-definitions.js';
import {restoreWorldInstances,restoreInstanceRefs} from '../../public/archipelago/preview/world-instances.js';

/* The player does not fetch vegetation.glb.gz up front (it only fills the `nature:*` library entries). A world the studio saved
   after placing one of those entries must still open, so the catalog loads the file as soon as the world document names one. */
const seed=path.resolve(import.meta.dirname,'../../public/archipelago/seed/editor-world.json.gz');
const state=data=>({name:'n',p:[0,0,0],q:[0,0,0,1],s:[1,1,1],visible:true,data});

test('the world document the repository ships names no vegetation entry, so the player skips the file',()=>{
 assert.equal(worldNamesVegetation(JSON.parse(zlib.gunzipSync(fs.readFileSync(seed)))),false);
});
test('a world names a vegetation entry wherever the player could meet one',()=>{
 const named=[
  ['an instance reference to its definition',{instanceRefs:[{definitionId:'world2:nature:treeBody',parts:[]}]}],
  ['a part of an instance reference',{instanceRefs:[{definitionId:'custom:copse',parts:[{state:state({world2Asset:'nature:bush'})}]}]}],
  ['a saved node state',{states:{a:state({}),b:state({assetDefinitionId:'world2:nature:grass'})}}],
  ['an experience group',{experiences:{groups:[{data:{world2Asset:'nature:treeBody'}}]}}],
  ['an added object, deep in its tree',{added:[{object:{userData:{},children:[{userData:{},children:[{userData:{world2Asset:'nature:bush'}}]}]}}]}],
  ['an instance override',{instanceOverrides:[{object:{object:{userData:{},children:[{userData:{assetDefinitionId:'world2:nature:bush'}}]}}}]}],
 ];
 for(const [what,world] of named)assert.equal(worldNamesVegetation(world),true,what);
 const other=[
  ['nothing',undefined],['an empty document',{}],['a null document',null],
  ['other library entries',{instanceRefs:[{definitionId:'world2:collection:nature',parts:[{state:state({world2Asset:'object:natureThing'})}]}],states:{a:state({world2Asset:'bowling',assetDefinitionId:'world2:bowling'})}}],
  ['a name that only ends like one',{states:{a:state({world2Asset:'collection:nature:x',assetDefinitionId:'v4:nature:x'})}}],
  ['malformed parts and trees',{instanceRefs:[{definitionId:5,parts:[null,{}]},null],added:[null,{},{object:{children:[null]}}],instanceOverrides:[{},null]}],
 ];
 for(const [what,world] of other)assert.equal(worldNamesVegetation(world),false,what);
});

const forest=()=>{
 const scene=new THREE.Group(),shared=new THREE.BoxGeometry(1,2,1),material=new THREE.MeshStandardMaterial();
 for(const name of ['treeBody','bush']){const mesh=new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial());mesh.name=name;mesh.position.set(3,0,0);scene.add(mesh);}
 const twin=new THREE.Mesh(shared,material),again=new THREE.Mesh(shared,material);twin.name='twin';again.name='again';scene.add(twin,again);
 return scene;
};
const names=entries=>entries.map(e=>e.id);

test('the catalog adds its vegetation entries once, and only for a world that names one',async()=>{
 const studio=new World2Catalog(new THREE.Group(),forest(),{},{});
 assert.deepEqual(names(studio.entries),['nature:treeBody','nature:bush','nature:twin'],'the studio gets them from the constructor (a shared mesh once)');
 assert.deepEqual(await studio.loadVegetationFor({instanceRefs:[{definitionId:'world2:nature:treeBody',parts:[]}]}),[],'with no vegetationSource there is nothing to fetch');

 const player=new World2Catalog(new THREE.Group(),new THREE.Group(),{},{});let fetched=0;
 assert.equal(player.entries.length,0,'the player starts without them');
 player.vegetationSource=async()=>{fetched++;return {scene:forest()};};
 assert.deepEqual(await player.loadVegetationFor({states:{}}),[]);assert.equal(fetched,0,'nothing in the world names one: the file is not fetched');
 const world={instanceRefs:[{definitionId:'world2:nature:treeBody',parts:[]}]};
 const [first,second]=await Promise.all([player.loadVegetationFor(world),player.loadVegetationFor(world)]);
 assert.equal(fetched,1,'fetched once, however many ask');assert.equal(first,second);
 assert.deepEqual(names(first),names(studio.entries),'the same entries the studio has');
 assert.equal(player.byId.get('nature:bush').label,'bush · World2');
 assert.deepEqual(await player.loadVegetationFor(world),first,'asking again gives the same entries without fetching again');assert.equal(fetched,1);
 const node=player.template(player.byId.get('nature:treeBody'));
 assert.equal(node.userData.world2Asset,'nature:treeBody');assert.equal(node.userData.category,'World2 · naturaleza');
});
test('a vegetation download that failed can be tried again',async()=>{
 const catalog=new World2Catalog(new THREE.Group(),new THREE.Group(),{},{}),world={states:{a:state({world2Asset:'nature:bush'})}};let calls=0;
 catalog.vegetationSource=async()=>{if(++calls===1)throw Error('offline');return {scene:forest()};};
 await assert.rejects(catalog.loadVegetationFor(world),/offline/);
 assert.equal((await catalog.loadVegetationFor(world)).length,3);assert.equal(calls,2);
});

/* One instance that cannot be restored must not keep the public world from opening; the studio must still refuse it. */
function setup(){
 const definitions=new AssetDefinitions(),tree=new THREE.Group();tree.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));
 definitions.add({id:'world2:tree',label:'Tree',category:'t',node:tree});
 const editor={assetDefinitions:definitions,root:new THREE.Group(),registry:new Map(),baseline:new Map()};
 const ref=(rootId,definitionId='world2:tree',{version=1,parts=2}={})=>({schema:1,definitionId,version,rootId,parentId:null,parts:[...Array(parts).keys()].map(i=>({path:i?[i-1]:[],id:i?rootId+'/'+i:rootId,uuid:undefined,state:state({})}))});
 return {editor,ref};
}
const quiet=async run=>{const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args.join(' '));try{return {value:await run(),warnings};}finally{console.warn=warn;}};

test('strict by default: a saved instance without its definition stops the restore and installs nothing',async()=>{
 const {editor,ref}=setup(),doc={instanceRefs:[ref('a'),ref('b','world2:nature:treeBody')]};
 await assert.rejects(restoreWorldInstances(editor,doc),/Missing asset definition world2:nature:treeBody for b/);
 assert.equal(editor.registry.size,0);assert.equal(editor.root.children.length,0);
 assert.throws(()=>restoreInstanceRefs(editor,doc.instanceRefs),/Missing asset definition/);
});
test('lenient (the player): the instances that cannot be restored are left out with a warning, the others come back',async()=>{
 const {editor,ref}=setup();
 const doc={instanceRefs:[ref('a'),ref('b','world2:nature:treeBody'),ref('c','world2:tree',{version:7}),ref('d','world2:tree',{parts:1}),ref('e'),null]};
 const {value,warnings}=await quiet(()=>restoreWorldInstances(editor,doc,{lenient:true}));
 assert.deepEqual(value.map(r=>r.userData.aw_id),['a','e'],'the two sound instances');
 assert.deepEqual([...editor.registry.keys()].sort(),['a','a/1','e','e/1']);assert.equal(editor.root.children.length,2);
 assert.equal(warnings.length,4);
 assert.match(warnings.join('\n'),/\(b\).*Missing asset definition world2:nature:treeBody/);
 assert.match(warnings.join('\n'),/\(c\).*version mismatch/);assert.match(warnings.join('\n'),/\(d\).*part mapping/);assert.match(warnings.join('\n'),/\(no id\)/);
 const again=setup(),{value:roots}=await quiet(()=>restoreInstanceRefs(again.editor,[again.ref('x','world2:gone')],{lenient:true}));
 assert.deepEqual(roots,[]);
});
test('lenient still refuses a document that is corrupt rather than stale: a duplicate id',async()=>{
 const {editor,ref}=setup();
 await assert.rejects(quiet(()=>restoreWorldInstances(editor,{instanceRefs:[ref('a'),ref('a')]},{lenient:true})),/Duplicate saved world object ID: a/);
});
