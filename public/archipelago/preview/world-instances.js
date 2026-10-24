import * as THREE from 'three';
import {PLAYER_MODE} from './world-storage.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const sameArray=(a,b)=>a===b||!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const materials=node=>node.material?(Array.isArray(node.material)?node.material:[node.material]):[];
const placeholderGeometry=uuid=>({uuid,type:'BufferGeometry',data:{attributes:{position:{itemSize:3,type:'Float32Array',array:[],normalized:false}},index:{type:'Uint16Array',array:[]}}});
const asList=v=>v===undefined?[]:Array.isArray(v)?v:[v];
/** Map surfaces (paths, plazas, painted ground) are regenerated from `userData.surfaceDefinition` on every restore:
 * map-surfaces.js rebuildSurfaces replaces their geometry and their material (editor.apply). Their stored triangulation was
 * 70 MB of the 118 MB world document, and each one carried the slabs texture again as base64. This leaves an empty placeholder
 * geometry (the road convention) and drops the texture maps of the materials only those nodes use.
 * Works on Object3D.toJSON() output; idempotent, so it also compacts documents saved before it existed. */
export function stripSurfaceJSON(json){
 const root=json?.object;if(!root)return json;
 const own={geometry:new Set(),material:new Set()},shared={geometry:new Set(),material:new Set()};let found=false;
 const walk=n=>{const surface=!!n.userData?.surfaceDefinition&&n.geometry!==undefined;if(surface)found=true;for(const key of ['geometry','material'])for(const id of asList(n[key]))(surface?own:shared)[key].add(id);n.children?.forEach(walk);};walk(root);
 if(!found)return json;
 json.geometries=(json.geometries??[]).map(g=>own.geometry.has(g.uuid)&&!shared.geometry.has(g.uuid)?placeholderGeometry(g.uuid):g);
 const textures=new Set((json.textures??[]).map(t=>t.uuid));
 for(const m of json.materials??[]){if(!own.material.has(m.uuid)||shared.material.has(m.uuid))continue;for(const key of Object.keys(m))if(typeof m[key]==='string'&&textures.has(m[key]))delete m[key];}
 if(json.textures){const wanted=new Set();for(const m of json.materials??[])for(const v of Object.values(m))if(typeof v==='string'&&textures.has(v))wanted.add(v);
  json.textures=json.textures.filter(t=>wanted.has(t.uuid));const images=new Set(json.textures.map(t=>t.image));if(json.images)json.images=json.images.filter(i=>images.has(i.uuid));
  if(!json.textures.length)delete json.textures;if(json.images&&!json.images.length)delete json.images;}
 return json;
}
/** The shortest decimal that is still the same Float32. Object3D.toJSON writes Float32 attributes as the 17-digit doubles of
 * their values (`-20.363670349121094`); `Float32Array.from` of the shorter text (`-20.36367`) is bit-identical. Only a value
 * that already is a Float32 is touched. */
export function shortestFloat32(v){
 if(v===0||!Number.isFinite(v)||Math.fround(v)!==v)return v;
 if(Number.isInteger(v)&&Math.abs(v)<16777216)return v;
 let lo=1,hi=9;// 9 significant digits always identify a Float32; the shortest one is found by bisection
 while(lo<hi){const mid=(lo+hi)>>1;if(Math.fround(Number(v.toPrecision(mid)))===v)hi=mid;else lo=mid+1;}
 return Number(v.toPrecision(lo));
}
/** Rewrites, in place, every `{type:'Float32Array',array:[...]}` found under `json` with its shortest round-trip decimals. */
export function shortenFloat32Arrays(json){
 const visit=v=>{
  if(!v||typeof v!=='object')return;
  if(Array.isArray(v)){if(v.length&&typeof v[0]==='object')for(const x of v)visit(x);return;}
  if(v.type==='Float32Array'&&Array.isArray(v.array)){const a=v.array;for(let i=0;i<a.length;i++)a[i]=shortestFloat32(a[i]);return;}
  for(const key in v)visit(v[key]);
 };
 visit(json);return json;
}
/** What a world document keeps of its Object3D JSON: regenerated surface geometry out, Float32 text shortened. In place. */
export function compactWorldDocument(doc){
 for(const json of doc.added??[])stripSurfaceJSON(json);
 shortenFloat32Arrays(doc.added);shortenFloat32Arrays(doc.instanceOverrides);return doc;
}
/** Road meshes are regenerated from their curve on restore. Keep authored
 * children/materials, but omit redundant triangulation and generated furniture. */
export function portableObjectJSON(root){
 const json=root.toJSON();if(!root.userData.road_points||root.userData.geometryEdited)return stripSurfaceJSON(json);
 json.object.children=(json.object.children??[]).filter(n=>!n.userData?.proceduralDerived);const geometryId=json.object.geometry,used=new Set();
 const walk=n=>{if(n.geometry)used.add(n.geometry);n.children?.forEach(walk);};walk(json.object);
 json.geometries=(json.geometries??[]).filter(g=>used.has(g.uuid)).map(g=>g.uuid===geometryId?placeholderGeometry(g.uuid):g);return stripSurfaceJSON(json);
}
function sameAnimations(a=[],b=[]){return a.length===b.length&&a.every((clip,i)=>{const other=b[i];return clip.name===other.name&&clip.duration===other.duration&&clip.blendMode===other.blendMode&&clip.tracks.length===other.tracks.length&&clip.tracks.every((track,j)=>{const next=other.tracks[j];return track.name===next.name&&track.ValueTypeName===next.ValueTypeName&&track.getInterpolation()===next.getInterpolation()&&sameArray(track.times,next.times)&&sameArray(track.values,next.values);});});}
function sameObjectContent(node,source){
 if(node.type!==source.type||node.geometry!==source.geometry||!sameArray(materials(node),materials(source))||node.children.length!==source.children.length)return false;
 if(node.userData.assetInstanceOverride||node.userData.geometryEdited||node.isSkinnedMesh)return false;
 if(!sameAnimations(node.animations,source.animations))return false;
 if(node.isInstancedMesh&&(node.count!==source.count||!sameArray(node.instanceMatrix?.array,source.instanceMatrix?.array)||!sameArray(node.instanceColor?.array,source.instanceColor?.array)))return false;
 if(!sameArray(node.morphTargetInfluences,source.morphTargetInfluences)||JSON.stringify(node.morphTargetDictionary)!==JSON.stringify(source.morphTargetDictionary))return false;
 // These properties are not in the editor's transform/metadata state. Keep an
 // independent JSON object whenever an instance has authored content changes.
 if(node.isLight){for(const key of ['intensity','distance','decay','angle','penumbra','width','height'])if(node[key]!==source[key])return false;for(const key of ['color','groundColor'])if(node[key]&&!node[key].equals(source[key]))return false;if(node.shadow&&JSON.stringify(node.shadow.toJSON())!==JSON.stringify(source.shadow?.toJSON()))return false;}
 if(node.isSprite&&!node.center.equals(source.center))return false;
 if(node.isCamera||node.isLOD)return false;
 return true;
}
function reusableParts(instance,definition){
 const parts=[];let valid=true;
 const visit=(node,source,path)=>{if(!valid||!sameObjectContent(node,source)){valid=false;return;}parts.push({node,path});for(let i=0;i<node.children.length;i++)visit(node.children[i],source.children[i],[...path,i]);};
 visit(instance,definition.node,[]);return valid?parts:null;
}
function stateOf(node){if(node.matrixAutoUpdate)node.updateMatrix();return {name:node.name,p:node.position.toArray(),q:node.quaternion.toArray(),s:node.scale.toArray(),visible:node.visible,data:copy(node.userData),castShadow:node.castShadow,receiveShadow:node.receiveShadow,frustumCulled:node.frustumCulled,renderOrder:node.renderOrder,layers:node.layers.mask,matrixAutoUpdate:node.matrixAutoUpdate,...(!node.matrixAutoUpdate?{matrix:node.matrix.toArray()}:{}),...(node.rotation.order!=='XYZ'?{rotationOrder:node.rotation.order}:{})};}
function topRoots(roots){const unique=[...new Set(roots)],chosen=new Set(unique);return unique.filter(node=>{for(let p=node.parent;p;p=p.parent)if(chosen.has(p))return false;return true;});}

/** A definition reference owns no geometry, material, texture or image JSON.
 * Only instances that still use the definition's resources can take this path;
 * custom imports and independent instance edits retain the previous full JSON. */
export function serializeWorldInstances(editor,roots){
 const instanceRefs=[],added=[];
 for(const root of topRoots(roots)){
  root.updateWorldMatrix(true,true);
  const id=root.userData.assetDefinitionId,definition=id&&editor.assetDefinitions?.get(id);
  const parts=definition&&root.userData.assetDefinitionVersion===definition.version&&!root.userData.assetInstanceOverride?reusableParts(root,definition):null;
  if(!parts||!root.userData.aw_id||parts.some(({node})=>!node.userData.proceduralDerived&&!node.userData.aw_id)){added.push(portableObjectJSON(root));continue;}
  instanceRefs.push({schema:1,definitionId:id,version:definition.version,rootId:root.userData.aw_id,parentId:root.parent?.userData.aw_id??null,parts:parts.map(({node,path})=>({path,id:node.userData.aw_id??null,uuid:node.uuid,state:stateOf(node)}))});
 }
 return {instanceRefs,added};
}
function atPath(root,path){if(!Array.isArray(path)||path.some(i=>!Number.isInteger(i)||i<0))throw Error('Invalid asset instance part path');let node=root;for(const i of path)node=node?.children[i];if(!node)throw Error('Asset definition no longer contains saved part '+path.join('/'));return node;}
function applyState(node,state,consume=false){
 if(!state||![state.p,state.q,state.s].every(Array.isArray)||state.p.length!==3||state.q.length!==4||state.s.length!==3||![...state.p,...state.q,...state.s].every(Number.isFinite))throw Error('Invalid saved asset instance transform');
 node.name=state.name;node.position.fromArray(state.p);node.quaternion.fromArray(state.q);node.scale.fromArray(state.s);node.visible=state.visible!==false;node.userData=consume?state.data??{}:copy(state.data??{});
 for(const key of ['castShadow','receiveShadow','frustumCulled','renderOrder'])if(key in state)node[key]=state[key];
 if(Number.isInteger(state.layers))node.layers.mask=state.layers;
 if(state.rotationOrder)node.rotation.order=state.rotationOrder;
 node.matrixAutoUpdate=state.matrixAutoUpdate!==false;if(!node.matrixAutoUpdate&&state.matrix)node.matrix.fromArray(state.matrix);else node.updateMatrix();
}
/** `lenient` (the public player): an instance that cannot be restored (its definition is missing, changed, or does not match the saved
 * parts) is left out with a warning, so one bad instance cannot keep the whole world from opening. The studio stays strict: it must
 * not open a world it cannot restore and then save it without those instances. */
function prepareRefs(editor,refs=[],lenient=false,consume=false){
 return refs.flatMap(ref=>{try{
  if(ref.schema!==1||!ref.rootId||!Array.isArray(ref.parts))throw Error('Invalid asset instance reference');
  const definition=editor.assetDefinitions?.get(ref.definitionId);if(!definition)throw Error('Missing asset definition '+ref.definitionId+' for '+ref.rootId);
  if(definition.version!==ref.version)throw Error('Asset definition version mismatch for '+ref.definitionId+': save needs '+ref.version+', loaded '+definition.version);
  const root=editor.assetDefinitions.instantiate(ref.definitionId),paths=new Set();let count=0;root.traverse(()=>count++);
  if(ref.parts.length!==count)throw Error('Saved asset part mapping does not match '+ref.definitionId);
  for(const part of ref.parts){const key=JSON.stringify(part.path);if(paths.has(key))throw Error('Duplicate saved asset part path');paths.add(key);const node=atPath(root,part.path);applyState(node,part.state,consume);if(part.id)node.userData.aw_id=part.id;else delete node.userData.aw_id;if(part.uuid)node.uuid=part.uuid;}
  if(root.userData.aw_id!==ref.rootId)throw Error('Saved asset root ID does not match its part mapping');
  root.userData.assetDefinitionId=ref.definitionId;root.userData.assetDefinitionVersion=ref.version;return [root];
 }catch(error){if(!lenient)throw error;console.warn('Saved asset instance left out ('+(ref?.rootId??'no id')+'): '+error.message);return [];}});
}
function installRoots(editor,roots){
 const ids=new Set();for(const root of roots)root.traverse(node=>{if(node.userData.proceduralDerived)return;const id=node.userData.aw_id;if(!id)throw Error('Saved world object has no stable ID: '+node.name);if(ids.has(id)||editor.registry.has(id))throw Error('Duplicate saved world object ID: '+id);ids.add(id);});
 // Validate the complete set first; a bad definition, ID or legacy object
 // cannot leave a partially restored world in the live editor.
 for(const root of roots){editor.root.add(root);root.traverse(node=>{if(node.userData.proceduralDerived)return;const id=node.userData.aw_id;editor.registry.set(id,node);editor.baseline?.set(id,{geometry:node.geometry,material:node.material});});}
 editor.root.updateMatrixWorld(true);return roots;
}
/** Restore before Experience parent links and doc.states are applied. IDs come
 * exclusively from the saved mapping; editor.register() must not be used.
 * `consume` (the public player): the caller reads the document once and throws it away, so the saved `userData` of each part becomes the restored
 * node's own instead of a JSON copy of it (a stringify/parse round trip per part, and the tree it leaves behind), and each `added` object and the
 * reference list are let go of as soon as they have been turned into nodes, which is when the garbage collector can have them back. The studio
 * keeps its document intact. */
export function restoreInstanceRefs(editor,refs=[],{lenient=PLAYER_MODE,consume=PLAYER_MODE}={}){const roots=installRoots(editor,prepareRefs(editor,refs,lenient,consume));if(consume)refs.length=0;return roots;}
/** Backwards compatible with schema-2 documents containing only added JSON. */
export async function restoreWorldInstances(editor,doc,{parseObject=json=>new THREE.ObjectLoader().parseAsync(json),lenient=PLAYER_MODE,consume=PLAYER_MODE}={}){
 const refs=prepareRefs(editor,doc.instanceRefs??[],lenient,consume),added=[],list=doc.added??[];
 for(let i=0;i<list.length;i++){added.push(await parseObject(list[i]));if(consume)list[i]=null;}
 if(consume){list.length=0;if(doc.instanceRefs)doc.instanceRefs.length=0;}
 return installRoots(editor,[...added,...refs]);
}
