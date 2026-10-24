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

/** The terrain the player can see, exactly: every vertex that rises above the flat sea floor (land, beaches and the shelf that
 * shades the water around them), with no legacy minimum world and no inflation, so the map can frame the island itself.
 * `minY` picks another floor. null when the world has no terrain. */
export function landFootprint(root,{minY}={}){
 const b={minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity},nodes=[];root?.updateMatrixWorld(true);
 root?.traverse(node=>{if(node.userData.terrain&&visibleInWorld(node)&&node.geometry?.attributes.position)nodes.push(node);});
 // Straight over the vertex arrays (86 000 of them in the island's terrain): no vector per vertex.
 const scan=(node,visit)=>{const a=node.geometry.attributes.position,e=node.matrixWorld.elements,raw=a.array&&!a.isInterleavedBufferAttribute&&a.itemSize>=3?a.array:null,step=raw?a.itemSize:3;
  for(let i=0;i<a.count;i++){const x=raw?raw[i*step]:a.getX(i),y=raw?raw[i*step+1]:a.getY(i),z=raw?raw[i*step+2]:a.getZ(i);visit(e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);}};
 if(minY===undefined){minY=Infinity;for(const node of nodes)scan(node,(x,y)=>{if(y<minY)minY=y;});minY+=.002;}
 for(const node of nodes)scan(node,(x,y,z)=>{
  if(y<minY)return;
  if(x<b.minX)b.minX=x;if(x>b.maxX)b.maxX=x;if(z<b.minZ)b.minZ=z;if(z>b.maxZ)b.maxZ=z;
 });
 return Number.isFinite(b.minX)?b:null;
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
