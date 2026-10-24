import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {AssetDefinitions} from '../../public/archipelago/preview/asset-definitions.js';
import {restoreWorldInstances,restoreInstanceRefs} from '../../public/archipelago/preview/world-instances.js';

/* The player reads its world document once. The parsed trees are tens of MB of small objects (31 of the 143 MB the ready world held, measured by
   dropping the module's promises after ready), so the restore must not keep them: the saved userData becomes the nodes' own instead of a copy,
   the pieces are let go of as they are used, and world-storage.js drops its promises. The studio keeps its document whole. */
const state=data=>({name:'n',p:[0,0,0],q:[0,0,0,1],s:[1,1,1],visible:true,data});
function setup(){
 const definitions=new AssetDefinitions(),tree=new THREE.Group();tree.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial()));
 definitions.add({id:'world2:tree',label:'Tree',category:'t',node:tree});
 const editor={assetDefinitions:definitions,root:new THREE.Group(),registry:new Map(),baseline:new Map()};
 const ref=rootId=>({schema:1,definitionId:'world2:tree',version:1,rootId,parentId:null,parts:[0,1].map(i=>({path:i?[0]:[],id:i?rootId+'/1':rootId,state:state({note:'saved '+rootId+'/'+i,nested:{list:[1,2,3]}})}))});
 return {editor,ref};
}

test('consume: a restored node owns the saved userData itself, and the document is let go of as it is used',async()=>{
 const {editor,ref}=setup(),refs=[ref('a'),ref('b')],saved=refs.flatMap(r=>r.parts.map(p=>p.state.data)),added=[{id:'one'},{id:'two'}],seen=[];
 const doc={instanceRefs:refs,added};
 const roots=await restoreWorldInstances(editor,doc,{consume:true,parseObject:async json=>{seen.push(json.id);assert.equal(added[seen.length-1],json,'handed over before it is let go of');const g=new THREE.Group();g.userData.aw_id='added:'+json.id;return g;}});
 assert.deepEqual(seen,['one','two']);
 assert.deepEqual(roots.map(r=>r.userData.aw_id),['added:one','added:two','a','b']);
 const nodes=[...editor.registry.values()].filter(n=>n.userData.note);
 assert.equal(nodes.length,4);
 for(const data of saved)assert.ok(nodes.some(n=>n.userData===data),'the node holds the saved object, not a copy of it');
 assert.equal(doc.added.length,0,'the added list is empty');assert.deepEqual(added,[],'and so is the array the loader walked');
 assert.equal(doc.instanceRefs.length,0,'the reference list is empty');assert.equal(refs.length,0);
});
test('by default (the studio) the document stays whole and the nodes get copies of it',async()=>{
 const {editor,ref}=setup(),refs=[ref('a')],before=JSON.stringify(refs),added=[{id:'one'}];
 const doc={instanceRefs:refs,added};
 await restoreWorldInstances(editor,doc,{parseObject:async json=>{const g=new THREE.Group();g.userData.aw_id='added:'+json.id;return g;}});
 assert.equal(JSON.stringify(doc.instanceRefs),before,'nothing was taken out of the references');assert.equal(doc.added.length,1);assert.equal(doc.added[0].id,'one');
 const node=[...editor.registry.values()].find(n=>n.userData.note==='saved a/1');
 assert.deepEqual(node.userData.nested,{list:[1,2,3]});assert.notEqual(node.userData,refs[0].parts[1].state.data);
 node.userData.nested.list.push(4);assert.deepEqual(refs[0].parts[1].state.data.nested.list,[1,2,3],'editing a node never reaches the document');
});
test('restoreInstanceRefs consumes the list it is given only when asked to',()=>{
 const a=setup(),refs=[a.ref('x')];restoreInstanceRefs(a.editor,refs,{consume:true});assert.equal(refs.length,0);
 const b=setup(),kept=[b.ref('y')];restoreInstanceRefs(b.editor,kept);assert.equal(kept.length,1);
});

/* world-storage.js reads document.body.dataset.player when it loads, so the player's module needs its own copy of it (the query makes it one). */
async function storage(player){
 const files={'/api/world/release':{revision:null,world:{url:'/w.json',size:8},assets:{url:'/a.json',size:8}},'/w.json':{schema:2,states:{}},'/a.json':{schema:1,definitions:[]}},asked=[];
 const had=globalThis.document;globalThis.document={baseURI:'http://localhost/archipelago/preview/index.html',body:{dataset:player?{player:'true'}:{}}};
 const fetched=globalThis.fetch;globalThis.fetch=async url=>{const path=new URL(url,'http://localhost').pathname;asked.push(path);return new Response(JSON.stringify(files[path]),{headers:{'content-type':'application/json'}});};
 try{const mod=await import('../../public/archipelago/preview/world-storage.js?'+(player?'player':'studio'));return {mod,asked,restore:()=>{globalThis.fetch=fetched;if(had===undefined)delete globalThis.document;else globalThis.document=had;}};}
 catch(error){globalThis.fetch=fetched;if(had===undefined)delete globalThis.document;else globalThis.document=had;throw error;}
}
test('the player lets go of the parsed document and definitions, and asking again fetches only the one asked for',async()=>{
 const {mod,asked,restore}=await storage(true);
 try{
  assert.equal(mod.PLAYER_MODE,true);
  await mod.startWorldFileDownloads();
  const doc=await mod.loadWorldDocument(),defs=await mod.loadAssetDefinitions();
  assert.equal(await mod.loadWorldDocument(),doc,'one parse, however many ask');assert.equal(await mod.loadAssetDefinitions(),defs);
  assert.deepEqual(asked,['/api/world/release','/w.json','/a.json']);
  mod.releaseAssetDefinitions();
  assert.equal(await mod.loadWorldDocument(),doc,'releasing one file keeps the other');assert.equal(asked.length,3);
  mod.releaseWorldDocument();
  const again=await mod.loadWorldDocument();
  assert.notEqual(again,doc,'a released document is read afresh if somebody still wants it');assert.deepEqual(asked.slice(3),['/w.json'],'and only that file is fetched, not the definitions');
 }finally{restore();}
});
test('the studio keeps what it loaded: release is a no-op there',async()=>{
 const {mod,asked,restore}=await storage(false);
 try{
  assert.equal(mod.PLAYER_MODE,false);
  const doc=await mod.loadWorldDocument(),defs=await mod.loadAssetDefinitions();
  mod.releaseWorldDocument();mod.releaseAssetDefinitions();
  assert.equal(await mod.loadWorldDocument(),doc);assert.equal(await mod.loadAssetDefinitions(),defs);
  assert.deepEqual(asked,['/api/world/release','/w.json','/a.json']);
 }finally{restore();}
});
