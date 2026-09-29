import * as THREE from 'three';
import {surfaceMaterial,surfaceUV} from './surface-materials.js';
import {createPlaza,rebuildSurface} from './map-surfaces.js';

const cache=new WeakMap();
const floors=[['central-plaza','Central pedestrian plaza'],['projects','Projects limestone court'],['achievements','Achievement trophy court'],['career','Career court'],['ferris-wheel','Fairground plaza'],['castle','Courtyard paving']];

/** Existing local floors retain topology, IDs and pose. Only their private UVs
 * and material change; main island terrain and buildings are never remeshed. */
export function refreshExperienceSurfaces(root){
 root.updateMatrixWorld(true);const updated=[];
 root.traverse(node=>{if(!node.isMesh||!node.userData.experienceSurface||node.userData.deleted)return;const signature=node.matrixWorld.elements.join(',')+'|'+node.geometry.uuid+'|'+node.userData.surfaceMaterial;
  if(cache.get(node)===signature)return;
  if(node.userData.mapSurface){rebuildSurface(node);cache.set(node,node.matrixWorld.elements.join(',')+'|'+node.geometry.uuid+'|'+node.userData.surfaceMaterial);updated.push(node);return;}
  const materialName=node.userData.surfaceMaterial??'Slabs',position=node.geometry.attributes.position,uv=new Float32Array(position.count*2),v=new THREE.Vector3();
  // The initial clone separates instance UV edits from definition resources.
  if(!node.geometry.userData.experienceUV){node.geometry=node.geometry.clone();node.geometry.userData.experienceUV=true;}
  for(let i=0;i<position.count;i++){v.fromBufferAttribute(position,i).applyMatrix4(node.matrixWorld);uv.set(surfaceUV(v.x,v.z,materialName),i*2);}node.geometry.setAttribute('uv',new THREE.BufferAttribute(uv,2));node.material=surfaceMaterial(materialName);node.receiveShadow=true;
  Object.assign(node.userData,{materialEdited:true,geometryEdited:true,assetPartEdited:true,surfaceMaterial:materialName});cache.set(node,node.matrixWorld.elements.join(',')+'|'+node.geometry.uuid+'|'+materialName);updated.push(node);
 });return updated;
}

/** Idempotent v6 floor upgrade; intentionally limited to seven named zones. */
export function upgradeExperienceSurfaces(manager){
 const {root}=manager,changed=[],groups=new Set();
 for(const [id,name]of floors){const group=manager.get(id);if(!group||group.userData.experienceSurfaceVersion>=1)continue;let node;group.traverse(n=>{if(n.name.replaceAll('_',' ')===name&&n.isMesh&&!n.userData.deleted)node=n;});
  if(node){node.userData.experienceSurface=true;node.userData.surfaceMaterial='Slabs';changed.push(node);groups.add(group);if(id==='castle'){const castle=group.children.find(n=>n.userData.assetDefinitionId==='v4:northwatch-castle');if(castle)castle.userData.assetInstanceOverride=true;}}
  group.userData.experienceSurfaceVersion=1;
 }
 const harbor=manager.get('harbor');if(harbor&&!(harbor.userData.experienceSurfaceVersion>=1)){
  const building=harbor.children.find(n=>n.userData.assetDefinitionId==='v4:harbor-building');
  if(building){root.updateMatrixWorld(true);const wall=building.getObjectByName('Main walls'),depth=wall?(wall.geometry.parameters?.depth??1)*Math.abs(wall.scale.z):3.8,halfWidth=wall?(wall.geometry.parameters?.width??1)*Math.abs(wall.scale.x)/2+.5:3,front=(wall?.position.z??0)+depth/2+.3;
   const polygon=[[-halfWidth,front],[halfWidth,front],[halfWidth,front+2.2],[-halfWidth,front+2.2]].map(([x,z])=>{const point=building.localToWorld(new THREE.Vector3(x,0,z));harbor.worldToLocal(point);return [point.x,point.z];});
   const node=createPlaza({name:'Harbor building slabs apron',polygon,height:0,material:'Slabs',conformToTerrain:false,offset:.025});node.userData.experienceSurface=true;node.userData.experienceLocalSurface=true;harbor.add(node);manager.register(node,{assetRoot:true});manager.managed.add(node.userData.aw_id);changed.push(node);groups.add(harbor);
  }harbor.userData.experienceSurfaceVersion=1;
 }
 refreshExperienceSurfaces(root);
 // Initial templates must contain the same local floors visible in the world.
 for(const group of groups){const id='experience-template:'+group.userData.experienceId,template=manager.templates.get(id);if(template)manager.saveTemplate(group,template.name,{id});}
 return {changed:changed.map(n=>({id:n.userData.aw_id,name:n.name,added:!!n.userData.added})),groups:[...groups].map(g=>g.name)};
}
