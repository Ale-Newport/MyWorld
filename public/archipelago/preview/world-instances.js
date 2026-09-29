import * as THREE from 'three';

const copy=value=>JSON.parse(JSON.stringify(value));
const sameArray=(a,b)=>a===b||!!a&&!!b&&a.length===b.length&&a.every((v,i)=>v===b[i]);
const materials=node=>node.material?(Array.isArray(node.material)?node.material:[node.material]):[];
/** Road meshes are regenerated from their curve on restore. Keep authored
 * children/materials, but omit redundant triangulation and generated furniture. */
export function portableObjectJSON(root){
 const json=root.toJSON();if(!root.userData.road_points||root.userData.geometryEdited)return json;
 json.object.children=(json.object.children??[]).filter(n=>!n.userData?.proceduralDerived);const geometryId=json.object.geometry,used=new Set();
 const walk=n=>{if(n.geometry)used.add(n.geometry);n.children?.forEach(walk);};walk(json.object);
 json.geometries=(json.geometries??[]).filter(g=>used.has(g.uuid)).map(g=>g.uuid===geometryId?{uuid:g.uuid,type:'BufferGeometry',data:{attributes:{position:{itemSize:3,type:'Float32Array',array:[],normalized:false}},index:{type:'Uint16Array',array:[]}}}:g);return json;
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
function applyState(node,state){
 if(!state||![state.p,state.q,state.s].every(Array.isArray)||state.p.length!==3||state.q.length!==4||state.s.length!==3||![...state.p,...state.q,...state.s].every(Number.isFinite))throw Error('Invalid saved asset instance transform');
 node.name=state.name;node.position.fromArray(state.p);node.quaternion.fromArray(state.q);node.scale.fromArray(state.s);node.visible=state.visible!==false;node.userData=copy(state.data??{});
 for(const key of ['castShadow','receiveShadow','frustumCulled','renderOrder'])if(key in state)node[key]=state[key];
 if(Number.isInteger(state.layers))node.layers.mask=state.layers;
 if(state.rotationOrder)node.rotation.order=state.rotationOrder;
 node.matrixAutoUpdate=state.matrixAutoUpdate!==false;if(!node.matrixAutoUpdate&&state.matrix)node.matrix.fromArray(state.matrix);else node.updateMatrix();
}
function prepareRefs(editor,refs=[]){
 return refs.map(ref=>{
  if(ref.schema!==1||!ref.rootId||!Array.isArray(ref.parts))throw Error('Invalid asset instance reference');
  const definition=editor.assetDefinitions?.get(ref.definitionId);if(!definition)throw Error('Missing asset definition '+ref.definitionId+' for '+ref.rootId);
  if(definition.version!==ref.version)throw Error('Asset definition version mismatch for '+ref.definitionId+': save needs '+ref.version+', loaded '+definition.version);
  const root=editor.assetDefinitions.instantiate(ref.definitionId),paths=new Set();let count=0;root.traverse(()=>count++);
  if(ref.parts.length!==count)throw Error('Saved asset part mapping does not match '+ref.definitionId);
  for(const part of ref.parts){const key=JSON.stringify(part.path);if(paths.has(key))throw Error('Duplicate saved asset part path');paths.add(key);const node=atPath(root,part.path);applyState(node,part.state);if(part.id)node.userData.aw_id=part.id;else delete node.userData.aw_id;if(part.uuid)node.uuid=part.uuid;}
  if(root.userData.aw_id!==ref.rootId)throw Error('Saved asset root ID does not match its part mapping');
  root.userData.assetDefinitionId=ref.definitionId;root.userData.assetDefinitionVersion=ref.version;return root;
 });
}
function installRoots(editor,roots){
 const ids=new Set();for(const root of roots)root.traverse(node=>{if(node.userData.proceduralDerived)return;const id=node.userData.aw_id;if(!id)throw Error('Saved world object has no stable ID: '+node.name);if(ids.has(id)||editor.registry.has(id))throw Error('Duplicate saved world object ID: '+id);ids.add(id);});
 // Validate the complete set first; a bad definition, ID or legacy object
 // cannot leave a partially restored world in the live editor.
 for(const root of roots){editor.root.add(root);root.traverse(node=>{if(node.userData.proceduralDerived)return;const id=node.userData.aw_id;editor.registry.set(id,node);editor.baseline?.set(id,{geometry:node.geometry,material:node.material});});}
 editor.root.updateMatrixWorld(true);return roots;
}
/** Restore before Experience parent links and doc.states are applied. IDs come
 * exclusively from the saved mapping; editor.register() must not be used. */
export function restoreInstanceRefs(editor,refs=[]){return installRoots(editor,prepareRefs(editor,refs));}
/** Backwards compatible with schema-2 documents containing only added JSON. */
export async function restoreWorldInstances(editor,doc,{parseObject=json=>new THREE.ObjectLoader().parseAsync(json)}={}){
 const refs=prepareRefs(editor,doc.instanceRefs??[]),added=[];for(const json of doc.added??[])added.push(await parseObject(json));
 return installRoots(editor,[...added,...refs]);
}
