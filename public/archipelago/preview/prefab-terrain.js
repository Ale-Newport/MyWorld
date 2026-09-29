import * as THREE from 'three';
import {planarBoolean} from './roads/planar.js';
import {invalidateTerrainQuery} from './terrain-query.js';
const originals=new WeakMap(),rootSignatures=new WeakMap();
export function sourceGroundPatch(terrain,centre,radius=9){
 const source=terrain.geometry,position=source.attributes.position,index=source.index?.array??Array.from({length:position.count},(_,i)=>i),values=[],uv=[];
 const textureUV=source.attributes.uv;
 for(let i=0;i<index.length;i+=3){const points=[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(position,index[i+k]).applyMatrix4(terrain.matrixWorld));const mid=points[0].clone().add(points[1]).add(points[2]).divideScalar(3);if(Math.hypot(mid.x-centre.x,mid.z-centre.z)>radius)continue;for(let k=0;k<3;k++){values.push(points[k].x,points[k].y+.015,points[k].z);if(textureUV)uv.push(textureUV.getX(index[i+k]),textureUV.getY(index[i+k]));}}
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(values,3));if(uv.length)geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.computeVertexNormals();
 const patch=new THREE.Mesh(geo,terrain.material.clone());patch.name='World2 · suelo del hoyo';patch.userData={w2Source:'world2GroundPatch',w2Category:'terrain',w2Role:'visual'};return patch;
}
/** Reversible, contour-exact terrain cuts for authored pits and editable water assets.
 * Original grid vertices keep their order. Intersection vertices are derived and
 * regenerated, so repeated moves, Undo/Redo and terrain brushes do not accumulate
 * geometry or leave jagged 2 m triangular holes at the shoreline.
 */
export function updatePrefabTerrain(root,force=false){
 root.updateMatrixWorld(true);const cutters=[],terrain=[];
 root.traverse(o=>{
  let visible=true,insidePrefab=false;for(let p=o;p;p=p.parent){if(!p.visible||p.userData.deleted)visible=false;if(p!==o&&(p.userData.world2Asset||p.userData.terrainCut))insidePrefab=true;}
  if(!visible)return;
  const d=o.userData;let local=null;
  if(d.world2Pit){const {centre,radius}=d.world2Pit;local=Array.from({length:48},(_,i)=>[centre[0]+Math.cos(i*Math.PI/24)*radius,centre[1],centre[2]+Math.sin(i*Math.PI/24)*radius]);}
  else if(d.terrainCut&&d.mapCut!==false&&d.mapCut?.enabled!==false){const cut=typeof d.mapCut==='object'?{...d.terrainCut,...d.mapCut}:d.terrainCut;if(cut.contour?.length>=3)local=cut.contour.map(p=>[p[0],0,p[1]]);else if(cut.radius)local=Array.from({length:48},(_,i)=>[Math.cos(i*Math.PI/24)*cut.radius,0,Math.sin(i*Math.PI/24)*cut.radius]);}
  if(local){const poly=local.map(p=>{const v=new THREE.Vector3(...p).applyMatrix4(o.matrixWorld);return [v.x,v.z];});const xs=poly.map(p=>p[0]),zs=poly.map(p=>p[1]);cutters.push({poly,minX:Math.min(...xs),maxX:Math.max(...xs),minZ:Math.min(...zs),maxZ:Math.max(...zs)});}
  if(o.isMesh&&(d.terrain||d.landTile)&&!insidePrefab)terrain.push(o);
 });
 const cutSignature=JSON.stringify(cutters.map(c=>c.poly)),versionSignature=()=>cutSignature+'|'+terrain.map(m=>m.geometry.uuid+':'+m.geometry.attributes.position.version).join('|');if(!force&&versionSignature()===rootSignatures.get(root))return;
 invalidateTerrainQuery(root);let removed=0,split=0;
 for(const mesh of terrain){const g=mesh.geometry,a=g.attributes.position;let original=originals.get(mesh);if(!original||original.geometry!==g){const saved=g.userData.terrainCutSource;original=saved&&Number.isInteger(saved.count)&&saved.count<=a.count&&Array.isArray(saved.indices)?{indices:saved.indices,count:saved.count,groups:saved.groups??g.groups.map(x=>({...x})),geometry:g}:{indices:g.index?Array.from(g.index.array):Array.from({length:a.count},(_,i)=>i),count:a.count,groups:g.groups.map(x=>({...x})),geometry:g};originals.set(mesh,original);g.userData.terrainCutSource={indices:original.indices,count:original.count,groups:original.groups};}const inverse=mesh.matrixWorld.clone().invert(),attrs={};for(const [name,attr] of Object.entries(g.attributes)){if(name==='normal')continue;attrs[name]={size:attr.itemSize,array:Array.from(attr.array.slice(0,original.count*attr.itemSize))};}const kept=[],groups=[];const append=(ids,sourceIndex)=>{const start=kept.length;kept.push(...ids);if(!original.groups.length)return;const materialIndex=original.groups.find(x=>sourceIndex>=x.start&&sourceIndex<x.start+x.count)?.materialIndex??0,last=groups.at(-1);if(last?.materialIndex===materialIndex)last.count+=ids.length;else groups.push({start,count:ids.length,materialIndex});};
  for(let i=0;i<original.indices.length;i+=3){const ids=original.indices.slice(i,i+3),ps=ids.map(j=>new THREE.Vector3().fromBufferAttribute(a,j).applyMatrix4(mesh.matrixWorld)),xs=ps.map(p=>p.x),zs=ps.map(p=>p.z),minX=Math.min(...xs),maxX=Math.max(...xs),minZ=Math.min(...zs),maxZ=Math.max(...zs),near=cutters.filter(c=>c.maxX>minX&&c.minX<maxX&&c.maxZ>minZ&&c.minZ<maxZ);
   if(!near.length){append(ids,i);continue;}
   const poly=ps.map(p=>[p.x,p.z]),den=(ps[1].z-ps[2].z)*(ps[0].x-ps[2].x)+(ps[2].x-ps[1].x)*(ps[0].z-ps[2].z);if(Math.abs(den)<1e-8){append(ids,i);continue;}
   const result=planarBoolean([[poly],near.map(c=>c.poly)],c=>c[0]>0&&!c[1]);if(!result.cells.length){removed++;continue;}
   const area=Math.abs(den)*.5;if(Math.abs(result.area-area)<1e-7){append(ids,i);continue;}split++;
   for(const cell of result.cells){const start=attrs.position.array.length/3;for(const [x,z] of cell){const u=((ps[1].z-ps[2].z)*(x-ps[2].x)+(ps[2].x-ps[1].x)*(z-ps[2].z))/den,v=((ps[2].z-ps[0].z)*(x-ps[2].x)+(ps[0].x-ps[2].x)*(z-ps[2].z))/den,w=1-u-v;const local=new THREE.Vector3(x,u*ps[0].y+v*ps[1].y+w*ps[2].y,z).applyMatrix4(inverse);attrs.position.array.push(...local.toArray());for(const [name,attr] of Object.entries(attrs)){if(name==='position')continue;const source=g.attributes[name];for(let k=0;k<attr.size;k++)attr.array.push(u*source.array[ids[0]*attr.size+k]+v*source.array[ids[1]*attr.size+k]+w*source.array[ids[2]*attr.size+k]);}}
    for(let j=1;j<cell.length-1;j++)append([start,start+j+1,start+j],i);
   }
  }
  for(const [name,attr] of Object.entries(attrs))g.setAttribute(name,new THREE.Float32BufferAttribute(attr.array,attr.size));g.setIndex(kept);g.clearGroups();for(const x of groups)g.addGroup(x.start,x.count,x.materialIndex);g.computeVertexNormals();g.computeBoundingSphere();
 }
 root.userData.terrainCutStats={cutters:cutters.length,removedTriangles:removed,splitTriangles:split};rootSignatures.set(root,versionSignature());
}
