import * as THREE from 'three';

export const PHYSICS_PRESETS={
 'Static Decoration':{physics_mode:'STATIC',mass:1,friction:.7,restitution:.02,collision:true,collision_shape:'CONVEX_HULL'},
 'Heavy Static':{physics_mode:'STATIC',mass:5000,friction:.9,restitution:0,collision:true,collision_shape:'TRIMESH'},
 'Light Dynamic':{physics_mode:'DYNAMIC',mass:1,friction:.6,restitution:.2,collision:true,collision_shape:'CONVEX_HULL'},
 'Medium Dynamic':{physics_mode:'DYNAMIC',mass:12,friction:.7,restitution:.08,collision:true,collision_shape:'CONVEX_HULL'},
 'Vehicle Prop':{physics_mode:'DYNAMIC',mass:180,friction:.9,restitution:.01,collision:true,collision_shape:'CONVEX_HULL'},
 'Water Object':{physics_mode:'STATIC',mass:1,friction:.25,restitution:0,collision:false,water:true},
 'No Collision':{physics_mode:'STATIC',mass:1,friction:.7,restitution:0,collision:false},
};
export const MATERIAL_PRESETS={Grass:{color:0x72954d,roughness:1},Wood:{color:0x98704c,roughness:.85},Stone:{color:0x8a908d,roughness:.93},Metal:{color:0xa2acb1,roughness:.3,metalness:.8},Plastic:{color:0xe65b43,roughness:.42},Glass:{color:0xb7e2e5,roughness:.08,transparent:true,opacity:.45},Asphalt:{color:0x374246,roughness:.95},Sand:{color:0xd7bd86,roughness:1},Ice:{color:0x9fdce6,roughness:.13,metalness:.08},Water:{color:0x3babb7,roughness:.2,transparent:true,opacity:.7}};
const copy=v=>JSON.parse(JSON.stringify(v));
export function cloneAsset(node,privateResources=false){
 const result=node.clone(true);result.animations=node.animations.map(a=>a.clone());
 if(privateResources){const geometries=new Map(),materials=new Map(),textures=new Map();result.traverse(n=>{if(n.geometry){if(!geometries.has(n.geometry))geometries.set(n.geometry,n.geometry.clone());n.geometry=geometries.get(n.geometry);}if(n.material){const clone=m=>{if(!materials.has(m)){const x=m.clone();for(const [key,t] of Object.entries(m))if(t?.isTexture){if(!textures.has(t))textures.set(t,t.clone());x[key]=textures.get(t);}materials.set(m,x);}return materials.get(m);};n.material=Array.isArray(n.material)?n.material.map(clone):clone(n.material);}});}
 return result;
}
export function disposeAsset(node){const geometries=new Set(),materials=new Set(),textures=new Set();node.traverse(n=>{if(n.geometry)geometries.add(n.geometry);for(const m of n.material?(Array.isArray(n.material)?n.material:[n.material]):[]){materials.add(m);for(const t of Object.values(m))if(t?.isTexture)textures.add(t);}if(n.isInstancedMesh)n.dispose();});geometries.forEach(x=>x.dispose());materials.forEach(x=>x.dispose());textures.forEach(x=>x.dispose());}
export function assetBounds(root){const b=new THREE.Box3();root.updateWorldMatrix(true,true);root.traverseVisible(o=>{if(!o.isMesh||o.userData.editorOnly||o.userData.w2Role==='collider')return;if(o.isInstancedMesh){o.computeBoundingBox();if(o.boundingBox)b.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld));}else if(o.geometry?.attributes.position){if(!o.geometry.boundingBox)o.geometry.computeBoundingBox();b.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld));}});if(b.isEmpty())b.set(new THREE.Vector3(-.5,0,-.5),new THREE.Vector3(.5,1,.5));return b;}
export function tagAssetParts(root){const counts=new Map();const visit=(node,path)=>{node.userData.assetPartId??=path;const base=String(node.userData.w2Source??node.name??node.type);const ordinal=counts.get(base)??0;counts.set(base,ordinal+1);node.userData.assetRuntimeKey??=base+'#'+ordinal;node.children.forEach((n,i)=>visit(n,path+'/'+i));};visit(root,'root');return root;}
export function cleanDefinition(root){root.traverse(o=>{for(const k of ['aw_id','aw_template','added','assetInstanceOverride','assetDefinitionId','assetDefinitionVersion','privateMaterial'])delete o.userData[k];});root.userData.editable_root=true;return root;}
export function applyPhysicsPreset(node,name){Object.assign(node.userData,PHYSICS_PRESETS[name]??{});node.userData.physicsPreset=name;node.userData.assetPartEdited=true;node.userData.assetPhysicsEdited=true;if(node.userData.w2Role==='physical')node.userData.w2Body=node.userData.physics_mode==='DYNAMIC'?'dynamic':'fixed';}
export function applyMaterialPreset(node,name){const preset=MATERIAL_PRESETS[name];if(!preset)return;node.traverse(n=>{if(!n.material)return;const replace=m=>{const out=m.isMeshStandardMaterial?m.clone():new THREE.MeshStandardMaterial();out.color?.set(preset.color);Object.assign(out,{roughness:.7,metalness:0,transparent:false,opacity:1},preset);if(typeof out.color==='number')out.color=new THREE.Color(preset.color);out.map=null;out.needsUpdate=true;return out;};n.material=Array.isArray(n.material)?n.material.map(replace):replace(n.material);n.userData.materialEdited=true;n.userData.assetPartEdited=true;});node.userData.materialPreset=name;}
function slug(s){return String(s).normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase();}
function metadata(id,label,category,node,extra={}){const bounds=assetBounds(node),material=[];let children=0;node.traverse(o=>{children++;for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])if(m.color)material.push('#'+m.color.getHexString());});return {id,name:label,category,version:1,source:extra.source??(node.userData.world2Asset?'Portfolio / world2 (local copy)':'HelloWorld'),dimensions:bounds.getSize(new THREE.Vector3()).toArray(),pivot:[0,0,0],defaultMaterial:material[0]??null,physicsPreset:node.userData.physicsPreset??'Static Decoration',collisionPreset:node.userData.collision_shape??'Authored',tags:extra.tags??[],thumbnail:null,editableChildren:children,parameters:extra.parameters??node.userData.parameters??null};}

/** Definitions own shared mesh resources. Instance transforms live outside them. */
export class AssetDefinitions {
 constructor(){this.definitions=new Map();this.modified=new Set();}
 add(template){const id=template.id??template.node.userData.assetDefinitionId??(template.node.userData.world2Asset?'world2:'+template.node.userData.world2Asset:'asset:'+slug(template.category)+':'+slug(template.label));if(this.definitions.has(id))return this.definitions.get(id);const node=cleanDefinition(cloneAsset(template.node));node.position.set(0,0,0);tagAssetParts(node);const definition={...metadata(id,template.label,template.category,node,{source:template.source,tags:template.tags,parameters:template.parameters}),node};this.definitions.set(id,definition);return definition;}
 get(id){return this.definitions.get(id);}
 edit(id){const d=this.get(id);if(!d)throw Error('Asset definition missing: '+id);return cloneAsset(d.node,true);}
 instantiate(id){const d=this.get(id);if(!d)throw Error('Asset definition missing: '+id);const node=cloneAsset(d.node);node.userData.assetDefinitionId=id;node.userData.assetDefinitionVersion=d.version;node.userData.editable_root=true;return node;}
 save(id,node,changes={}){const old=this.get(id);if(!old)throw Error('Asset definition missing: '+id);const next=cleanDefinition(cloneAsset(node,true));next.position.set(0,0,0);tagAssetParts(next);const updated={...old,...changes,node:next,version:old.version+1};Object.assign(updated,{dimensions:assetBounds(next).getSize(new THREE.Vector3()).toArray(),editableChildren:0});next.traverse(()=>updated.editableChildren++);this.definitions.set(id,updated);this.modified.add(id);return updated;}
 saveAs(sourceId,node,name){const original=this.get(sourceId);if(!name?.trim())throw Error('Introduce un nombre para el nuevo asset.');let id='custom:'+slug(name),suffix=2;while(this.definitions.has(id))id='custom:'+slug(name)+'-'+suffix++;const next=cleanDefinition(cloneAsset(node,true));next.position.set(0,0,0);tagAssetParts(next);const d={...original,id,name:name.trim(),node:next,version:1,generatorId:original.generatorId??sourceId,source:'HelloWorld · variant of '+original.name,thumbnail:null,dimensions:assetBounds(next).getSize(new THREE.Vector3()).toArray(),editableChildren:0};next.traverse(()=>d.editableChildren++);this.definitions.set(id,d);this.modified.add(id);return d;}
 document(){return {schema:1,savedAt:new Date().toISOString(),definitions:[...this.modified].map(id=>{const {node,...metadata}=this.get(id);return {...metadata,object:node.toJSON()};})};}
 async restore(document){if(document.schema!==1||!Array.isArray(document.definitions))throw Error('Invalid asset definitions');for(const item of document.definitions){if(!item.id||!item.object?.object)throw Error('Invalid asset entry');const {object,...metadata}=item,node=await new THREE.ObjectLoader().parseAsync(object);tagAssetParts(node);this.definitions.set(item.id,{...metadata,node});this.modified.add(item.id);}}
}

export function replaceInstanceContent(instance,definition){
 const p=instance.position.clone(),q=instance.quaternion.clone(),s=instance.scale.clone(),name=instance.name;
 const keep={};for(const key of ['aw_id','added','assetInstanceOverride','deleted','locked','mapZone','worldZone','landmark','worldInstance','instanceMetadata'])if(key in instance.userData)keep[key]=copy(instance.userData[key]);
 const source=cloneAsset(definition.node);instance.clear();for(const child of [...source.children])instance.add(child);
 if(instance.isMesh&&source.isMesh){instance.geometry=source.geometry;instance.material=source.material;}
 instance.userData={...copy(source.userData),...keep,assetDefinitionId:definition.id,assetDefinitionVersion:definition.version,editable_root:true};instance.animations=source.animations;
 instance.name=name;instance.position.copy(p);instance.quaternion.copy(q);instance.scale.copy(s);instance.updateWorldMatrix(true,true);return instance;
}

/** Saved part edits are also consumed by World2's regenerated gameplay meshes. */
export function collectRuntimeEdits(root){root.updateWorldMatrix(true,true);const inverse=root.matrixWorld.clone().invert(),edits=[];root.traverse(n=>{if(!n.userData.assetPartEdited)return;const matrix=inverse.clone().multiply(n.matrixWorld);edits.push({key:n.userData.assetRuntimeKey,source:n.userData.w2Source,name:n.name,matrix:matrix.toArray(),visible:n.visible,parentKey:n.parent?.userData.assetRuntimeKey,parentSource:n.parent?.userData.w2Source,parentIsAssetRoot:n.parent===root,data:copy(n.userData),materials:n.material?(Array.isArray(n.material)?n.material:[n.material]):null});});return edits;}
export function applyRuntimeEdits(target,edits,anchor=[0,0,0],{materials=true,sourceOnly=false}={}){
 const keys=new Map(),counts=new Map();target.updateWorldMatrix(true,true);target.traverse(n=>{const base=String(n.userData.w2Source??n.name??n.type),ordinal=counts.get(base)??0;counts.set(base,ordinal+1);keys.set(n.userData.assetRuntimeKey??base+'#'+ordinal,n);});
 const translation=new THREE.Matrix4().makeTranslation(...anchor),changed=[];
 for(const e of edits){let node=keys.get(e.key);if(!node&&e.source)target.traverse(n=>{if(!node&&n.userData.w2Source===e.source)node=n;});if(!node||(sourceOnly&&!e.source))continue;
  if(e.data.assetParentEdited){let parent=e.parentIsAssetRoot?target:keys.get(e.parentKey);if(!parent&&e.parentSource)target.traverse(n=>{if(!parent&&n.userData.w2Source===e.parentSource)parent=n;});if(parent&&parent!==node){let cycle=false;for(let p=parent;p;p=p.parent)if(p===node)cycle=true;if(!cycle)parent.attach(node);}}
  const matrix=translation.clone().multiply(new THREE.Matrix4().fromArray(e.matrix));node.parent?.updateWorldMatrix(true,false);if(node.parent)matrix.premultiply(node.parent.matrixWorld.clone().invert());matrix.decompose(node.position,node.quaternion,node.scale);node.name=e.name;node.visible=e.visible;node.userData={...node.userData,...copy(e.data)};if(materials&&node.material&&e.materials){node.material=e.materials.length===1?e.materials[0].clone():e.materials.map(m=>m.clone());}node.updateWorldMatrix(true,true);changed.push(node);
 }
 return changed;
}

/** Optional author-controlled animation, using metadata that also survives GLB. */
export function animateAssetParts(root,dt){root.traverseVisible(node=>{const a=node.userData.assetAnimation;if(a?.enabled&&['x','y','z'].includes(a.axis))node.rotation[a.axis]+=THREE.MathUtils.degToRad(Number(a.speed)||0)*dt;});}
