import * as THREE from 'three';
import {WORLD_BOUNDS,SEA_LEVEL} from './world-config.js';

export function visibleInWorld(node){for(let n=node;n;n=n.parent)if(!n.visible||n.userData.deleted)return false;return true;}

/** Camera, minimap and flight limits follow authored land, including new islands. */
export function authoredWorldBounds(root,base=WORLD_BOUNDS){
 const bounds={...base},p=new THREE.Vector3();root?.updateMatrixWorld(true);
 root?.traverse(node=>{
  if(!node.userData.terrain||!visibleInWorld(node)||!node.geometry?.attributes.position)return;
  const positions=node.geometry.attributes.position;
  for(let i=0;i<positions.count;i++){
   p.fromBufferAttribute(positions,i).applyMatrix4(node.matrixWorld);if(p.y<SEA_LEVEL+.1)continue;
   bounds.minX=Math.min(bounds.minX,p.x-12);bounds.maxX=Math.max(bounds.maxX,p.x+12);
   bounds.minZ=Math.min(bounds.minZ,p.z-12);bounds.maxZ=Math.max(bounds.maxZ,p.z+12);
  }
 });return bounds;
}

/** Shoreline loops, including holes, rather than tens of thousands of filled
 * triangles. Weld by map coordinate so neighbouring terrain tiles share edges. */
export function mapTerrain(root){
 const edges=new Map(),points=new Map(),p=new THREE.Vector3(),precision=1e4;root.updateMatrixWorld(true);
 const point=v=>{const key=Math.round(v[0]*precision)+','+Math.round(v[2]*precision);if(!points.has(key))points.set(key,[v[0],v[2]]);return key;};
 const edge=(a,b)=>{if(a===b)return;const forward=a<b,key=forward?a+'|'+b:b+'|'+a,prior=edges.get(key),balance=(prior?.balance??0)+(forward?1:-1);if(!balance)edges.delete(key);else edges.set(key,{a:forward?a:b,b:forward?b:a,balance});};
 root.traverse(node=>{
  if(!node.userData.terrain||!visibleInWorld(node)||!node.geometry?.attributes.position)return;
  const a=node.geometry.attributes.position,index=node.geometry.index,vertices=[];
  for(let i=0;i<a.count;i++){p.fromBufferAttribute(a,i).applyMatrix4(node.matrixWorld);vertices.push(p.toArray());}
  const count=index?.count??a.count;
  for(let i=0;i+2<count;i+=3){
   const triangle=[0,1,2].map(j=>vertices[index?index.getX(i+j):i+j]),polygon=[];
   // Clip triangles crossing sea level so coastlines end at the water, not a
   // full grid cell inland. Shared intersections weld to the same map point.
   for(let j=0;j<3;j++){const a=triangle[j],b=triangle[(j+1)%3],inside=a[1]>SEA_LEVEL,nextInside=b[1]>SEA_LEVEL;if(inside)polygon.push(a);if(inside!==nextInside){const t=(SEA_LEVEL-a[1])/(b[1]-a[1]);polygon.push([a[0]+(b[0]-a[0])*t,SEA_LEVEL,a[2]+(b[2]-a[2])*t]);}}
   if(polygon.length<3)continue;
   let area=0;for(let j=0;j<polygon.length;j++){const a=polygon[j],b=polygon[(j+1)%polygon.length];area+=a[0]*b[2]-b[0]*a[2];}if(Math.abs(area)<1e-10)continue;if(area<0)polygon.reverse();
   const ids=polygon.map(point);for(let j=0;j<ids.length;j++)edge(ids[j],ids[(j+1)%ids.length]);
  }
 });
 const outgoing=new Map(),remaining=new Set();for(const e of edges.values()){const a=e.balance>0?e.a:e.b,b=e.balance>0?e.b:e.a,item={a,b};if(!outgoing.has(a))outgoing.set(a,[]);outgoing.get(a).push(item);remaining.add(item);}
 const loops=[];while(remaining.size){const first=remaining.values().next().value,loop=[],start=first.a;let current=first,closed=false;
  while(current){remaining.delete(current);loop.push(points.get(current.a));if(current.b===start){closed=true;break;}const candidates=(outgoing.get(current.b)??[]).filter(e=>remaining.has(e));if(candidates.length<2){current=candidates[0];continue;}
   // At a shared corner choose the leftmost continuation, keeping separate
   // touching islands as separate closed loops instead of drawing a bridge.
   const a=points.get(current.a),b=points.get(current.b),dx=b[0]-a[0],dz=b[1]-a[1];let best=-Infinity,next;
   for(const candidate of candidates){const c=points.get(candidate.b),x=c[0]-b[0],z=c[1]-b[1],turn=Math.atan2(dx*z-dz*x,dx*x+dz*z);if(turn>best){best=turn;next=candidate;}}current=next;
  }
  if(closed&&loop.length>=3){
   const area=loop.reduce((sum,a,i)=>{const b=loop[(i+1)%loop.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
   // Terrain-cut triangulation can leave sub-millimetre slivers at T-junctions.
   // They have no visible map area and should not become dozens of fake holes.
   if(Math.abs(area)>.01)loops.push(loop.map(([x,z])=>[x,-z]));
  }
 }
 return loops;
}
